import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, describe, it } from "node:test";
import { createClient } from "@streamotter/client";
import { DEFAULT_SOCKET_PATH, EVENTS, PROTOCOL_VERSION, type Hello } from "@streamotter/contracts";
import { FAR_FUTURE, observe, orderRecord, sleep, startHarness, waitFor, type Harness, type TestChannels } from "./harness.ts";

// The tests package has no socket.io server dependency; borrow the gateway's.
type FakeSocket = { emit(event: string, payload: unknown): void; disconnect(close: boolean): void };
type FakeServer = { on(event: "connection", listener: (socket: FakeSocket) => void): void; listen(port: number): void; close(): Promise<void>; httpServer: import("node:http").Server };
const { Server } = createRequire(new URL("../../packages/gateway/package.json", import.meta.url))("socket.io") as { Server: new (options: { path: string }) => FakeServer };

describe("client control requests stay in step with the gateway", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it("unsubscribing before the subscribe is acknowledged releases it on the gateway", async () => {
    h = await startHarness({ limits: { receiptTimeoutMs: 1_000 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("acme", "alice", "ord_2", 1, "queued", 0);
    const client = h.client();
    const keep = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_2" } });
    const seenKeep = observe(keep);
    await keep.ready({ timeoutMs: 5_000 });
    const brief = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(brief.state, "authorizing", "the subscribe is on the wire");
    await brief.unsubscribe();
    await sleep(100);
    assert.equal(h.internals.subscriptionCount(), 1);
    await sleep(1_500); // Longer than receiptTimeoutMs: an orphaned snapshot would have dropped the connection.
    assert.ok(!seenKeep.states.includes("stale"), "the other subscription was never disturbed");
  });

  it("a resync refused over the rate limit is retried instead of freezing in authorizing", async () => {
    h = await startHarness({ limits: { controlRequestsPerSecond: 5 } });
    const client = h.client();
    const subs = [];
    for (let i = 0; i < 12; i++) h.app.put("acme", "alice", `ord_${i}`, 1, "queued", 0);
    for (let wave = 0; wave < 2; wave++) {
      for (let i = 0; i < 6; i++) subs.push(client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${wave * 6 + i}` } }));
      await Promise.all(subs.map(s => s.ready({ timeoutMs: 5_000 })));
      await sleep(2_100); // Refill the burst.
    }
    const seen = subs.map(s => observe(s));
    const results = await Promise.allSettled(subs.map(s => s.resync({ timeoutMs: 8_000 })));
    assert.ok(seen.some(s => s.errors.some(e => e.code === "OVERLOADED")), "some resyncs were refused");
    assert.deepEqual(results.map(r => r.status), subs.map(() => "fulfilled"));
    assert.deepEqual(subs.map(s => s.state), subs.map(() => "live"));
    assert.equal(client.state, "connected");
  });

  it("unsubscribing many subscriptions at once releases every one on the gateway", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_9", 2, "processing", 20)], limits: { controlRequestsPerSecond: 5, receiptTimeoutMs: 1_000 } });
    const client = h.client();
    const subs = [];
    for (let i = 0; i < 12; i++) h.app.put("acme", "alice", `ord_${i}`, 1, "queued", 0);
    for (let wave = 0; wave < 2; wave++) {
      for (let i = 0; i < 6; i++) subs.push(client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${wave * 6 + i}` } }));
      await Promise.all(subs.map(s => s.ready({ timeoutMs: 5_000 })));
      await sleep(2_100);
    }
    const keep = subs[0]!;
    const seenKeep = observe(keep);
    await Promise.all(subs.slice(1).map(s => s.unsubscribe())); // 11 requests against a burst of 10.
    assert.equal(h.internals.subscriptionCount(), 1);
    await h.advance(1); // An update for ord_9, which was unsubscribed.
    await sleep(1_500);
    assert.ok(!seenKeep.states.includes("stale"), "the remaining subscription was never disturbed");
  });

  it("resync() during a source pause stays stale until the source resumes", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready({ timeoutMs: 5_000 });
    const seen = observe(sub);
    h.app.mapOverride = () => { throw new Error("boom"); };
    assert.equal(await h.advance(1), 0);
    assert.equal(h.internals.sources()[0]?.status, "paused");
    await waitFor(() => sub.state === "stale", 2_000, "stale while paused");
    const resynced = sub.resync({ timeoutMs: 8_000 });
    await sleep(300);
    assert.equal(sub.state, "stale", "the paused source is still reported");
    assert.ok(!seen.states.includes("authorizing"));
    h.app.mapOverride = null;
    await h.internals.resumeSource("orders");
    await resynced;
    assert.equal(sub.state, "live");
  });

  it("a resync that runs out of attempts before a new epoch ends in resync-required", async () => {
    h = await startHarness({ limits: { handlerTimeoutMs: 50, maxSyncAttempts: 1 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready({ timeoutMs: 5_000 });
    h.app.authorizeOverride = () => new Promise<boolean>(() => undefined); // Authorize times out under the old epoch.
    await assert.rejects(sub.resync({ timeoutMs: 3_000 }), (error: { code?: string }) => error.code === "RESYNC_REQUIRED");
    assert.equal(sub.state, "resync-required");
    h.app.authorizeOverride = null;
    await sub.resync({ timeoutMs: 5_000 });
    assert.equal(sub.state, "live");
  });

  it("a hello and a close read together reconnect instead of leaving the client connected to nothing", async () => {
    const io = new Server({ path: DEFAULT_SOCKET_PATH });
    let connections = 0;
    io.on("connection", socket => {
      connections++;
      const hello: Hello = {
        protocolVersion: PROTOCOL_VERSION, configVersions: [1], transport: "socket.io", deliveryModes: ["state"], operations: ["subscribe", "unsubscribe", "resync", "receipt"],
        connectionId: `c${connections}`, identityKey: "alice", authExpiresAt: FAR_FUTURE
      };
      socket.emit(EVENTS.hello, hello);
      if (connections === 1) socket.disconnect(true); // Same tick: the client reads both together.
    });
    io.listen(0);
    const { port } = io.httpServer.address() as import("node:net").AddressInfo;
    const client = createClient<TestChannels>({ origin: `http://127.0.0.1:${port}`, getToken: () => "alice@acme" });
    try {
      client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
      await waitFor(() => connections === 2, 3_000, "a second connection");
    } finally {
      await client.close();
      await io.close();
    }
  });
});
