import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { deferred, observe, orderRecord, sleep, startHarness, waitFor, type Harness } from "./harness.ts";

describe("acceptance 1–3: synchronization", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("1. delivers the snapshot before any update and reaches live only after the drain boundary", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20), orderRecord("acme", "ord_1", 3, "processing", 60)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const gate = deferred();
    h.app.snapshotGate = () => gate.promise;
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const timeline: string[] = [];
    sub.on("state", ({ state }) => timeline.push(`state:${state}`));
    sub.on("data", event => timeline.push(`${event.kind}:${event.revision}`));
    await waitFor(() => h!.app.snapshotCalls === 1, 5_000, "snapshot call");
    assert.equal(await h.advance(2), 2, "updates committed while the snapshot is loading");
    gate.resolve();
    await sub.ready({ timeoutMs: 5_000 });
    assert.deepEqual(timeline, [
      "state:authorizing", "state:synchronizing", "snapshot:1", "update:2", "update:3", "state:live"
    ]);
  });

  it("2a. releases an update that arrived during snapshot loading when the snapshot is older", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 5, "processing", 50)] });
    h.app.put("acme", "alice", "ord_1", 4, "processing", 40);
    const gate = deferred();
    h.app.snapshotReads = "start"; // Snapshot is read at revision 4 before the update lands.
    h.app.snapshotGate = () => gate.promise;
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await waitFor(() => h!.app.snapshotCalls === 1);
    await h.advance(1);
    gate.resolve();
    await sub.ready({ timeoutMs: 5_000 });
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:4", "update:5"]);
    assert.equal(seen.data().at(-1)?.progress, 50);
  });

  it("2b. discards buffered updates already represented by a snapshot that is ahead", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 5, "processing", 50), orderRecord("acme", "ord_1", 6, "processing", 60)] });
    h.app.put("acme", "alice", "ord_1", 4, "processing", 40);
    const gate = deferred();
    h.app.snapshotReads = "end";
    h.app.snapshotGate = () => gate.promise;
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await waitFor(() => h!.app.snapshotCalls === 1);
    await h.advance(2);
    // The authoritative store has already applied both changes when the snapshot is read.
    h.app.put("acme", "alice", "ord_1", 6, "processing", 60);
    gate.resolve();
    await sub.ready({ timeoutMs: 5_000 });
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:6"]);
  });

  it("2c. drops older and duplicate revisions while live", async () => {
    h = await startHarness({
      fixtures: [
        orderRecord("acme", "ord_1", 3, "processing", 30),
        orderRecord("acme", "ord_1", 2, "processing", 20),
        orderRecord("acme", "ord_1", 3, "processing", 30),
        orderRecord("acme", "ord_1", 10, "done", 100)
      ]
    });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready({ timeoutMs: 5_000 });
    assert.equal(await h.advance(4), 4, "older and duplicate records are committed, not paused");
    await waitFor(() => seen.events.length === 3);
    await sleep(50);
    assert.deepEqual(seen.events.map(event => event.revision), ["1", "3", "10"]);
    const filtered = h.internals.traces({ limit: 500, outcome: "filtered" }).items.filter(trace => trace.stage === "queue");
    assert.equal(filtered.length, 2);
  });

  it("compares revisions numerically beyond JavaScript number precision", async () => {
    // Number("9007199254740993") === Number("9007199254740992"); string comparison must not equate them.
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", "9007199254740992", "processing", 1), orderRecord("acme", "ord_1", "9007199254740994", "processing", 2)] });
    h.app.put("acme", "alice", "ord_1", "9007199254740993", "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready({ timeoutMs: 5_000 });
    assert.equal(await h.advance(2), 2);
    await waitFor(() => seen.events.length === 2);
    await sleep(50);
    assert.deepEqual(seen.events.map(event => event.revision), ["9007199254740993", "9007199254740994"]);
  });

  it("3a. overflow during synchronization invalidates the epoch; the old snapshot cannot restore live", async () => {
    const fixtures = Array.from({ length: 6 }, (_, index) => orderRecord("acme", "ord_1", index + 2, "processing", (index + 1) * 10));
    h = await startHarness({ fixtures, limits: { maxPendingFramesPerSubscription: 3 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const firstGate = deferred();
    let calls = 0;
    h.app.snapshotReads = "end";
    h.app.snapshotGate = () => (++calls === 1 ? firstGate.promise : Promise.resolve());
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await waitFor(() => h!.app.snapshotCalls === 1);
    assert.equal(await h.advance(6), 6, "overflow never blocks source progress");
    await waitFor(() => seen.states.includes("stale"), 5_000, "stale after overflow");
    assert.equal(seen.reasons[seen.states.indexOf("stale")], "OVERLOADED");
    h.app.put("acme", "alice", "ord_1", 7, "processing", 60);
    // Release the first snapshot only after its epoch was invalidated.
    firstGate.resolve();
    await sub.ready({ timeoutMs: 5_000 });
    assert.equal(seen.events.filter(event => event.kind === "snapshot").length, 1, "the stale snapshot was never delivered");
    assert.equal(seen.events[0]?.revision, "7");
    assert.deepEqual(seen.states, ["authorizing", "synchronizing", "stale", "authorizing", "synchronizing", "live"]);
  });

  it("3b. a source pause marks the view stale and a resumed source resynchronizes in a new epoch", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20), orderRecord("acme", "ord_1", 3, "processing", 30)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    let failNext = true;
    h.app.mapOverride = value => {
      if (failNext) {
        failNext = false;
        throw new Error("decoder bug");
      }
      const record = value as { tenantId: string; revision: string; order: { orderId: string } };
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready({ timeoutMs: 5_000 });
    assert.equal(await h.advance(2), 0, "the poison record is not committed");
    await waitFor(() => sub.state === "stale");
    assert.equal(seen.reasons.at(-1), "SOURCE_UNAVAILABLE");
    h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    await h.gateway.resumeSource("orders");
    await sub.ready({ timeoutMs: 5_000 });
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:1", "snapshot:2"]);
    assert.deepEqual(seen.states, ["authorizing", "synchronizing", "live", "stale", "authorizing", "synchronizing", "live"]);
  });

  it("does not invoke snapshot handlers repeatedly while waiting for an unavailable source", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.mapOverride = () => { throw new Error("down"); };
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready({ timeoutMs: 5_000 });
    await h.advance(1);
    await waitFor(() => sub.state === "stale");
    const calls = h.app.snapshotCalls;
    const late = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const lateSeen = observe(late);
    await sleep(1_500);
    assert.equal(h.app.snapshotCalls, calls, "no snapshot calls while the source is paused");
    assert.equal(late.state, "stale");
    assert.deepEqual(lateSeen.states, ["authorizing", "stale"]);
    await assert.rejects(late.ready({ timeoutMs: 100 }), { code: "TIMEOUT" });
  });

  it("exhausts three attempts on repeated snapshot timeouts, then recovers through explicit resync", async () => {
    h = await startHarness({ limits: { snapshotTimeoutMs: 150, handlerTimeoutMs: 100 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    let hang = true;
    h.app.snapshotGate = () => (hang ? new Promise(() => undefined) : Promise.resolve());
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    const started = Date.now();
    await assert.rejects(sub.ready({ timeoutMs: 10_000 }), { code: "RESYNC_REQUIRED" });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 3_000 && elapsed < 6_000, `one- then two-second backoff (took ${elapsed} ms)`);
    assert.equal(h.app.snapshotCalls, 3);
    assert.equal(sub.state, "resync-required");
    assert.ok(seen.errors.some(error => error.code === "RESYNC_REQUIRED"));
    hang = false;
    await sub.resync({ timeoutMs: 5_000 });
    assert.equal(sub.state, "live");
    assert.equal(h.app.snapshotCalls, 4);
  });
});
