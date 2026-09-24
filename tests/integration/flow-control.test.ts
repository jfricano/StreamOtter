import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { DataFrame, ErrorFrame, SubscriptionFrame } from "@streamotter/contracts";
import { observe, orderRecord, sleep, startHarness, waitFor, type Harness } from "./harness.ts";
import { ack, rawConnect } from "./raw.ts";

function stalledRecorder(socket: import("socket.io-client").Socket) {
  const record = { data: [] as DataFrame[], states: [] as SubscriptionFrame[], errors: [] as ErrorFrame[], disconnected: false };
  socket.on("so:data", (frame: DataFrame) => record.data.push(frame));
  socket.on("so:state", (frame: SubscriptionFrame) => record.states.push(frame));
  socket.on("so:error", (frame: ErrorFrame) => record.errors.push(frame));
  socket.on("disconnect", () => { record.disconnected = true; });
  return record;
}

describe("acceptance 5: slow clients are bounded and isolated", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("keeps exactly one data frame in flight per subscription until its receipt", async () => {
    const fixtures = [2, 3, 4].map(revision => orderRecord("acme", "ord_1", revision, "processing", revision * 10));
    h = await startHarness({ fixtures, limits: { receiptTimeoutMs: 5_000 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const { socket } = await rawConnect(h.origin, { token: "alice@acme", protocolVersion: 1 });
    const seen = stalledRecorder(socket);
    const subscriptionId = crypto.randomUUID();
    await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId, channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" } });
    await waitFor(() => seen.data.length === 1);
    await h.advance(3);
    await sleep(100);
    assert.equal(seen.data.length, 1, "no second frame before the snapshot receipt");
    for (let sequence = 1; sequence <= 3; sequence++) {
      socket.emit("so:receipt", { subscriptionId, epoch: seen.data[0]!.epoch, sequence });
      await waitFor(() => seen.data.length === sequence + 1);
      await sleep(30);
      assert.equal(seen.data.length, sequence + 1, `exactly one frame released per receipt (${sequence})`);
    }
    socket.emit("so:receipt", { subscriptionId, epoch: seen.data[0]!.epoch, sequence: 4 });
    await waitFor(() => seen.states.some(frame => frame.state === "live"));
    socket.close();
  });

  it("disconnects a stalled client without blocking source progress or healthy clients", async () => {
    const fixtures = Array.from({ length: 30 }, (_, index) => orderRecord("acme", "ord_1", index + 2, "processing", Math.min(100, index + 1)));
    h = await startHarness({ fixtures, limits: { receiptTimeoutMs: 400, maxPendingFramesPerSubscription: 50 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const healthy = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const healthySeen = observe(healthy);
    await healthy.ready();

    const { socket } = await rawConnect(h.origin, { token: "alice@acme", protocolVersion: 1 });
    const stalled = stalledRecorder(socket);
    await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" } });
    await waitFor(() => stalled.data.length === 1);
    assert.equal(h.internals.connectionCount(), 2);

    const started = Date.now();
    h.app.put("acme", "alice", "ord_1", 31, "processing", 30);
    assert.equal(await h.advance(30), 30, "every record is committed despite the stalled subscriber");
    assert.ok(Date.now() - started < 400, "source progress did not wait for the stalled client's receipt timeout");
    await waitFor(() => stalled.disconnected, 5_000, "stalled client disconnect");
    assert.ok(stalled.errors.some(frame => frame.error.code === "OVERLOADED"));
    await waitFor(() => healthySeen.events.at(-1)?.revision === "31", 5_000, "healthy client caught up");
    assert.equal(healthy.state, "live");
    assert.deepEqual(healthySeen.events.map(event => Number(event.revision)), Array.from({ length: 31 }, (_, index) => index + 1));
    await waitFor(() => h!.internals.connectionCount() === 1 && h!.internals.pendingBytes() === 0, 5_000, "released budgets");
  });

  it("invalidates a subscription whose queue overflows while live, then resynchronizes", async () => {
    const fixtures = Array.from({ length: 12 }, (_, index) => orderRecord("acme", "ord_1", index + 2, "processing", index + 1));
    h = await startHarness({ fixtures, limits: { receiptTimeoutMs: 3_000, maxPendingFramesPerSubscription: 4 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const { socket } = await rawConnect(h.origin, { token: "alice@acme", protocolVersion: 1 });
    const seen = stalledRecorder(socket);
    const subscriptionId = crypto.randomUUID();
    await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId, channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" } });
    await waitFor(() => seen.data.length === 1);
    const firstEpoch = seen.data[0]!.epoch;
    socket.emit("so:receipt", { subscriptionId, epoch: firstEpoch, sequence: 1 });
    await waitFor(() => seen.states.some(frame => frame.state === "live"));
    h.app.put("acme", "alice", "ord_1", 13, "processing", 12);
    await h.advance(12);
    await waitFor(() => seen.states.some(frame => frame.state === "stale" && frame.reason === "OVERLOADED"), 3_000, "stale on overflow");
    await waitFor(() => seen.states.some(frame => frame.state === "synchronizing" && frame.epoch !== firstEpoch));
    const snapshot = seen.data.at(-1)!;
    assert.notEqual(snapshot.epoch, firstEpoch);
    assert.equal(snapshot.event.kind, "snapshot");
    assert.equal(snapshot.event.revision, "13");
    // Late receipts for the invalidated epoch are ignored.
    socket.emit("so:receipt", { subscriptionId, epoch: firstEpoch, sequence: 2 });
    socket.emit("so:receipt", { subscriptionId, epoch: snapshot.epoch, sequence: 1 });
    await waitFor(() => seen.states.filter(frame => frame.state === "live").length === 2);
    socket.close();
  });

  it("enforces the gateway-wide pending byte budget across connections", async () => {
    const fixtures = Array.from({ length: 40 }, (_, index) => orderRecord("acme", "ord_1", index + 2, "processing", index % 100));
    const limits = {
      maxDataFrameBytes: 1_024, maxPendingBytesPerSubscription: 3_000, maxPendingBytesPerConnection: 3_000,
      maxPendingBytesGateway: 4_000, maxPendingFramesPerSubscription: 100, receiptTimeoutMs: 10_000
    };
    h = await startHarness({ fixtures, limits });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sockets = await Promise.all([0, 1, 2].map(() => rawConnect(h!.origin, { token: "alice@acme", protocolVersion: 1 })));
    const recorders = sockets.map(({ socket }) => stalledRecorder(socket));
    for (const { socket } of sockets) {
      await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" } });
    }
    await waitFor(() => recorders.every(record => record.data.length === 1));
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      await h.advance(1);
      peak = Math.max(peak, h.internals.pendingBytes());
    }
    assert.ok(peak <= limits.maxPendingBytesGateway, `gateway pending bytes peaked at ${peak}`);
    await waitFor(() => recorders.some(record => record.states.some(frame => frame.state === "stale" && frame.reason === "OVERLOADED")), 3_000, "overflow");
    for (const { socket } of sockets) socket.close();
  });
});

describe("configured bounds: snapshots, connections, and frame size", () => {
  it("admits at most maxConcurrentSnapshots and counts the wait toward snapshotTimeoutMs", async () => {
    const h = await startHarness({ limits: { maxConcurrentSnapshots: 1, snapshotTimeoutMs: 600 } });
    try {
      for (const id of ["ord_1", "ord_2", "ord_3"]) h.app.put("acme", "alice", id, 1, "queued", 0);
      let inFlight = 0;
      let peak = 0;
      const release: (() => void)[] = [];
      h.app.snapshotGate = () => new Promise<void>(resolve => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        release.push(() => { inFlight--; resolve(); });
      });
      const client = h.client();
      const [first, second] = ["ord_1", "ord_2"].map(orderId => client.subscribe("orderStatus", { channelVersion: 1, params: { orderId } }));
      await waitFor(() => h.app.snapshotCalls === 1);
      await sleep(100);
      assert.equal(h.app.snapshotCalls, 1, "the second snapshot waits for admission");
      release.shift()?.();
      await first!.ready();
      await waitFor(() => h.app.snapshotCalls === 2);
      release.shift()?.();
      await second!.ready();
      assert.equal(peak, 1);
      // A waiter that cannot be admitted before the deadline fails the attempt with TIMEOUT.
      h.app.snapshotGate = () => new Promise<void>(resolve => { release.push(resolve); });
      const blocker = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_3" } });
      await waitFor(() => h.app.snapshotCalls === 3);
      const starved = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
      const seen = observe(starved);
      await waitFor(() => seen.states.includes("stale"), 3_000, "admission timeout");
      assert.equal(seen.reasons[seen.states.indexOf("stale")], "TIMEOUT");
      for (const done of release.splice(0)) done();
      void blocker;
    } finally {
      await h.close();
    }
  });

  it("rejects connections beyond maxConnections with OVERLOADED", async () => {
    const h = await startHarness({ limits: { maxConnections: 2 } });
    try {
      const auth = { token: "alice@acme", protocolVersion: 1 };
      const open = [await rawConnect(h.origin, auth), await rawConnect(h.origin, auth)];
      const { rawConnectError } = await import("./raw.ts");
      assert.equal((await rawConnectError(h.origin, auth)).code, "OVERLOADED");
      open[0]!.socket.close();
      await waitFor(() => h.internals.connectionCount() === 1);
      const again = await rawConnect(h.origin, auth);
      again.socket.close();
      open[1]!.socket.close();
    } finally {
      await h.close();
    }
  });
});
