import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createClient } from "@streamotter/client";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { deferred, FAR_FUTURE, observe, OrderApp, orderConfig, orderRecord, sleep, startHarness, waitFor, type Harness, type TestChannels } from "./harness.ts";

const PRINCIPALS = {
  alice: { subject: "alice", tenantId: "acme", sessionId: "preview-alice", expiresAt: FAR_FUTURE, claims: {} }
};

describe("acceptance 7: lifecycle, cleanup, and recovery", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    mock.restoreAll();
    await h?.close();
    h = undefined;
  });

  it("starts in the next microtask so synchronously attached listeners miss nothing", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    assert.equal(sub.state, "idle");
    const seen = observe(sub);
    await sub.ready();
    assert.equal(seen.events[0]?.kind, "snapshot");
    assert.equal(seen.states[0], "authorizing");
  });

  it("unsubscribe cancels locally, is idempotent, and releases gateway state", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const client = h.client();
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    assert.equal(h.internals.subscriptionCount(), 1);
    const first = sub.unsubscribe();
    assert.equal(sub.state, "closed", "closed immediately, before the gateway acknowledges");
    assert.equal(sub.unsubscribe(), first);
    await first;
    await waitFor(() => h!.internals.subscriptionCount() === 0);
    await h.advance(1);
    await sleep(50);
    assert.equal(seen.events.length, 1, "no delivery after unsubscribe");
    assert.equal(client.state, "connected", "the shared client stays open");
    await assert.rejects(sub.ready(), { code: "CANCELLED" });
    await assert.rejects(sub.resync(), { code: "CANCELLED" });
  });

  it("close() closes subscriptions, rejects waiters, and makes the client permanently closed", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const gate = deferred();
    h.app.snapshotGate = () => gate.promise;
    const client = h.client();
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const waiting = sub.ready();
    await waitFor(() => h!.app.snapshotCalls === 1);
    await client.close();
    await assert.rejects(waiting, { code: "CLIENT_CLOSED" });
    assert.equal(client.state, "closed");
    assert.equal(sub.state, "closed");
    assert.throws(() => client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }), { code: "CLIENT_CLOSED" });
    await assert.rejects(client.reconnect(), { code: "CLIENT_CLOSED" });
    await waitFor(() => h!.internals.connectionCount() === 0);
    gate.resolve();
  });

  it("per-waiter timeouts and signals do not cancel the subscription", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const gate = deferred();
    h.app.snapshotGate = () => gate.promise;
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const controller = new AbortController();
    const cancelled = sub.ready({ signal: controller.signal });
    const patient = sub.ready({ timeoutMs: 5_000 });
    await assert.rejects(sub.ready({ timeoutMs: 50 }), { code: "TIMEOUT" });
    controller.abort();
    await assert.rejects(cancelled, { code: "CANCELLED" });
    gate.resolve();
    await patient;
    assert.equal(sub.state, "live");
  });

  it("concurrent resync calls join one synchronization", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    h.app.put("acme", "alice", "ord_1", 5, "processing", 50);
    await Promise.all([sub.resync(), sub.resync(), sub.resync()]);
    assert.equal(h.app.snapshotCalls, 2);
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:1", "snapshot:5"]);
    assert.deepEqual(seen.states, ["authorizing", "synchronizing", "live", "authorizing", "synchronizing", "live"]);
  });

  it("recovers a preview connection after a forced disconnect with a fresh snapshot", async () => {
    h = await startHarness({ principals: PRINCIPALS, fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const preview = h.internals.createPreviewSession("alice");
    const client = h.client(preview.token);
    const states: string[] = [];
    client.on("state", change => states.push(change.state));
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    // The application's state changes; its change event reaches the source only after the disconnect.
    // Updating the store first keeps the outcome independent of how fast the client reconnects.
    h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const statesBefore = seen.states.length;
    h.internals.disconnectPreviewSession(preview.previewSessionId);
    // Recorded by the state listener: `stale` can be brief, because reconnection starts after 0–500 ms of jitter.
    await waitFor(() => seen.states.slice(statesBefore).includes("stale"), 2_000, "stale after disconnect");
    // Changes during the outage are not replayed; the snapshot carries current state.
    await h.advance(1);
    await waitFor(() => sub.state === "live" && seen.events.length === 2, 5_000, "resynchronized");
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:1", "snapshot:2"]);
    assert.deepEqual(states, ["connecting", "connected", "reconnecting", "connected"]);
  });

  it("fails the subscription with HANDLER_FAILED when a data listener throws and stops server delivery", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const logged = mock.method(console, "error", () => undefined);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const errors: string[] = [];
    sub.on("error", error => errors.push(error.code));
    sub.on("data", () => { throw new Error("render bug"); });
    await assert.rejects(sub.ready(), { code: "HANDLER_FAILED" });
    assert.equal(sub.state, "failed");
    assert.deepEqual(errors, ["HANDLER_FAILED"]);
    assert.equal(logged.mock.callCount(), 1);
    await waitFor(() => h!.internals.subscriptionCount() === 0);
  });

  it("treats a rejected listener promise as a local handler failure", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    mock.method(console, "error", () => undefined);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const failed = new Promise<string>(resolve => sub.on("state", ({ state }) => { if (state === "failed") resolve(state); }));
    sub.on("data", async () => { throw new Error("async render bug"); });
    assert.equal(await failed, "failed");
  });

  it("logs error-listener failures without recursive error emission", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const logged = mock.method(console, "error", () => undefined);
    h.app.authorizeOverride = () => false;
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    let calls = 0;
    sub.on("error", () => { calls++; throw new Error("listener bug"); });
    await assert.rejects(sub.ready(), { code: "FORBIDDEN" });
    assert.equal(calls, 1);
    assert.equal(logged.mock.callCount(), 1);
  });

  it("fails on snapshot handler errors and invalid snapshot payloads", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("acme", "alice", "ord_2", 1, "queued", 0);
    h.app.orders.get("acme/ord_2")!.state.progress = 250;
    const client = h.client();
    const missing = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    h.app.snapshotGate = async () => { throw new Error("database down"); };
    await assert.rejects(missing.ready(), { code: "HANDLER_FAILED" });
    h.app.snapshotGate = null;
    const invalid = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_2" } });
    await assert.rejects(invalid.ready(), { code: "INVALID_PAYLOAD" });
  });

  it("refuses a snapshot that regresses below delivered state", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 3, "processing", 30);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    await assert.rejects(sub.resync({ timeoutMs: 8_000 }), { code: "RESYNC_REQUIRED" });
    assert.deepEqual(seen.events.map(event => event.revision), ["3"], "the regressed snapshot was never delivered");
    assert.equal(sub.state, "resync-required");
  });

  it("suspends when getToken fails and recovers on reconnect()", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    let fail = true;
    const client = h.client(() => {
      if (fail) throw new Error("session storage unavailable");
      return "alice@acme";
    });
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await assert.rejects(sub.ready(), { code: "UNAUTHENTICATED" });
    assert.equal(client.state, "auth-required");
    fail = false;
    await client.reconnect();
    await sub.ready();
  });

  it("retries rate-limited subscribes with bounded backoff instead of failing", async () => {
    h = await startHarness({ limits: { controlRequestsPerSecond: 1 } });
    for (let i = 1; i <= 4; i++) h.app.put("acme", "alice", `ord_${i}`, 1, "queued", 0);
    const client = h.client();
    const subs = [1, 2, 3, 4].map(i => client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${i}` } }));
    const seen = subs.map(observe);
    await Promise.all(subs.map(sub => sub.ready({ timeoutMs: 8_000 })));
    assert.ok(seen.some(record => record.reasons.includes("OVERLOADED")), "at least one subscribe was rate limited");
    assert.ok(subs.every(sub => sub.state === "live"));
  });

  it("rejects unsupported V2/V3 subscription options clearly", async () => {
    h = await startHarness();
    const client = h.client();
    assert.throws(
      () => client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "x" }, recovery: { cursor: "c" } } as never),
      { code: "UNSUPPORTED_CAPABILITY" }
    );
    assert.equal(typeof (client as unknown as Record<string, unknown>)["command"], "undefined");
  });

  it("shares start() while starting, returns the address while running, and cannot restart after stop()", async () => {
    const app = new OrderApp();
    const gateway = createGateway<TestChannels>({
      config: orderConfig(), handlers: app.handlers(), mode: "development",
      development: { principals: {}, fixtures: { orders: [] } }, logger: silentLogger
    });
    const [a, b] = await Promise.all([gateway.start(), gateway.start()]);
    assert.deepEqual(a, b);
    assert.deepEqual(await gateway.start(), a);
    const client = createClient<TestChannels>({ origin: a.origin, getToken: () => "alice@acme" });
    app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready();
    await Promise.all([gateway.stop(), gateway.stop()]);
    await waitFor(() => sub.state === "stale");
    assert.equal(client.state === "reconnecting" || client.state === "connecting", true);
    await assert.rejects(gateway.start(), { code: "INVALID_REQUEST" });
    await client.close();
  });
});
