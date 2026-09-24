import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { deferred, observe, orderRecord, sleep, startHarness, waitFor, type Harness } from "./harness.ts";

describe("acceptance 4: access fails closed", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("routes by verified tenant: another tenant's identical parameters never reach this subscriber", async () => {
    h = await startHarness({ fixtures: [orderRecord("globex", "ord_1", 2, "done", 100), orderRecord("acme", "ord_1", 2, "processing", 50)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("globex", "bob", "ord_1", 1, "queued", 0);
    const alice = h.client("alice@acme").subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const bob = h.client("bob@globex").subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const aliceSeen = observe(alice);
    const bobSeen = observe(bob);
    await Promise.all([alice.ready(), bob.ready()]);
    await h.advance(2);
    await waitFor(() => aliceSeen.events.length === 2 && bobSeen.events.length === 2);
    await sleep(50);
    assert.deepEqual(aliceSeen.data().map(order => order.progress), [0, 50]);
    assert.deepEqual(bobSeen.data().map(order => order.progress), [0, 100]);
  });

  it("denies cross-tenant and unauthorized subscriptions with FORBIDDEN", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const crossTenant = h.client("mallory@globex").subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const sameTenant = h.client("carol@acme").subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(crossTenant);
    await assert.rejects(crossTenant.ready(), { code: "FORBIDDEN", retryable: false });
    await assert.rejects(sameTenant.ready(), { code: "FORBIDDEN" });
    assert.equal(crossTenant.state, "failed");
    assert.deepEqual(seen.states, ["authorizing", "failed"]);
    assert.equal(seen.events.length, 0);
    assert.equal(h.app.snapshotCalls, 0, "no snapshot is loaded for a denied subscription");
  });

  it("does not accept a tenant from channel parameters", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const client = h.client("mallory@globex");
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1", tenantId: "acme" } as never });
    await assert.rejects(sub.ready(), { code: "INVALID_PARAMS" });
  });

  it("fails closed when authorize throws", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.authorizeOverride = () => { throw new Error("policy service down"); };
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await assert.rejects(sub.ready(), { code: "HANDLER_FAILED" });
    assert.equal(h.app.snapshotCalls, 0);
  });

  it("rejects an expired token and suspends retries until reconnect()", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.tokenExpiry.set("alice@acme#old", "2020-01-01T00:00:00.000Z");
    let token = "alice@acme#old";
    const client = h.client(() => token);
    const states: string[] = [];
    client.on("state", change => states.push(change.state));
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await assert.rejects(sub.ready(), { code: "UNAUTHENTICATED" });
    assert.equal(client.state, "auth-required");
    const callsWhileSuspended = h.app.authenticateCalls;
    await sleep(700);
    assert.equal(h.app.authenticateCalls, callsWhileSuspended, "no automatic retries after authentication rejection");
    token = "alice@acme#fresh";
    await client.reconnect();
    await sub.ready();
    assert.equal(sub.state, "live");
    assert.deepEqual(states, ["connecting", "auth-required", "connecting", "connected"]);
  });

  it("stops delivery at token expiry and resynchronizes after reauthentication", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.tokenExpiry.set("alice@acme#first", new Date(Date.now() + 1_200).toISOString());
    const tokens = ["alice@acme#first", "alice@acme#second"];
    const client = h.client(() => tokens.shift() ?? "alice@acme#second");
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    await waitFor(() => seen.states.includes("stale"), 5_000, "stale at expiry");
    assert.equal(seen.reasons[seen.states.indexOf("stale")], "UNAUTHENTICATED");
    await waitFor(() => seen.states.lastIndexOf("live") > seen.states.indexOf("stale"), 5_000, "live after reauthentication");
    assert.equal(h.app.snapshotCalls, 2);
    assert.equal(client.state, "connected");
  });

  it("refreshes the connection before token expiry without an account switch", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.tokenExpiry.set("alice@acme#short", new Date(Date.now() + 31_000).toISOString());
    let calls = 0;
    const client = h.client(() => (++calls === 1 ? "alice@acme#short" : "alice@acme#long"));
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    await waitFor(() => calls === 2 && h!.app.snapshotCalls === 2 && sub.state === "live", 5_000, "refresh");
    assert.equal(sub.state, "live");
    assert.ok(!seen.errors.some(error => error.code === "UNAUTHENTICATED"));
  });

  it("revocation while authorization is pending prevents access even if authorize later allows it", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const gate = deferred();
    h.app.authorizeGate = () => gate.promise;
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await waitFor(() => h!.app.authorizeCalls === 1);
    const result = await h.gateway.revoke({ kind: "channel", tenantId: "acme", subject: "alice", channel: "orderStatus", channelVersion: 1 });
    assert.deepEqual(result, { closedSubscriptions: 1, closedConnections: 0 });
    gate.resolve();
    await assert.rejects(sub.ready(), { code: "FORBIDDEN" });
    await sleep(100);
    assert.equal(h.app.snapshotCalls, 0);
    assert.equal(seen.events.length, 0);
    assert.ok(!seen.states.includes("live"));
  });

  it("revocation while the snapshot is pending discards it", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("acme", "alice", "ord_2", 1, "queued", 0);
    const gate = deferred();
    h.app.snapshotGate = () => gate.promise;
    const client = h.client();
    const revoked = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const kept = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_2" } });
    const seen = observe(revoked);
    await waitFor(() => h!.app.snapshotCalls === 2);
    const result = await h.gateway.revoke({
      kind: "channel", tenantId: "acme", subject: "alice", channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" }
    });
    assert.equal(result.closedSubscriptions, 1);
    gate.resolve();
    await kept.ready();
    await assert.rejects(revoked.ready(), { code: "FORBIDDEN" });
    assert.equal(seen.events.length, 0);
  });

  it("revoking a session closes its connection and reconnection cannot restore access", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const client = h.client("alice@acme#s1");
    const other = h.client("alice@acme#s2");
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const otherSub = other.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await Promise.all([sub.ready(), otherSub.ready()]);
    h.app.revokedSessions.add("s1"); // The application updates durable policy first.
    const result = await h.gateway.revoke({ kind: "session", tenantId: "acme", sessionId: "s1" });
    assert.deepEqual(result, { closedSubscriptions: 1, closedConnections: 1 });
    await waitFor(() => client.state === "auth-required");
    assert.equal(sub.state, "stale");
    await assert.rejects(client.reconnect({ timeoutMs: 3_000 }), { code: "UNAUTHENTICATED" });
    assert.equal(otherSub.state, "live", "other sessions are unaffected");
  });

  it("revocation during a pending authentication rejects the late principal", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const gate = deferred();
    h.app.authenticateGate = () => gate.promise;
    const client = h.client("alice@acme#s1");
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await waitFor(() => h!.app.authenticateCalls === 1);
    await h.gateway.revoke({ kind: "subject", tenantId: "acme", subject: "alice" });
    gate.resolve();
    await assert.rejects(sub.ready(), { code: "UNAUTHENTICATED" });
    assert.equal(client.state, "auth-required");
  });

  it("closes prior subscriptions when the authenticated identity changes", async () => {
    h = await startHarness();
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("acme", "bob", "ord_2", 1, "queued", 0);
    let token = "alice@acme";
    const client = h.client(() => token);
    const aliceView = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(aliceView);
    await aliceView.ready();
    token = "bob@acme";
    await client.reconnect();
    assert.equal(aliceView.state, "closed");
    assert.equal(seen.reasons.at(-1), "UNAUTHENTICATED");
    assert.ok(seen.errors.some(error => error.code === "UNAUTHENTICATED"));
    const bobView = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_2" } });
    await bobView.ready();
    assert.equal(h.app.snapshotCalls, 2);
  });
});
