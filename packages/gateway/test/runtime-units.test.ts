import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_LIMITS, type Result, type Schema } from "@streamotter/contracts";
import { ByteBudget, SubscriptionBudget } from "../src/runtime/budget.ts";
import type { ChannelRuntime, GatewayCore } from "../src/runtime/core.ts";
import { RevocationLog } from "../src/runtime/identity.ts";
import { ClientSession } from "../src/runtime/session.ts";
import { TraceBuffer } from "../src/runtime/traces.ts";
import { invokeHandler, Semaphore, silentLogger, TokenBucket } from "../src/runtime/util.ts";

const principal = { subject: "alice", tenantId: "acme", sessionId: "s1", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} };

describe("trace buffer", () => {
  it("bounds entries and bytes, pages forward, and expires evicted cursors", () => {
    const traces = new TraceBuffer(5, 1_000_000);
    for (let i = 0; i < 3; i++) traces.record({ requestId: `r${i}`, stage: "source", outcome: "ok", sourceId: "orders" });
    const first = traces.page({ limit: 100 });
    assert.deepEqual(first.items.map(item => item.requestId), ["r0", "r1", "r2"]);
    for (let i = 3; i < 5; i++) traces.record({ requestId: `r${i}`, stage: "map", outcome: i === 4 ? "failed" : "ok", sourceId: "orders" });
    const next = traces.page({ limit: 100, cursor: first.nextCursor! });
    assert.deepEqual(next.items.map(item => item.requestId), ["r3", "r4"]);
    assert.deepEqual(traces.page({ limit: 100, cursor: next.nextCursor!, outcome: "failed" }).items, []);
    assert.deepEqual(traces.page({ limit: 1, outcome: "failed" }).items.map(item => item.requestId), ["r4"]);
    for (let i = 5; i < 12; i++) traces.record({ requestId: `r${i}`, stage: "send", outcome: "ok" });
    assert.equal(traces.size, 5, "entry bound");
    assert.throws(() => traces.page({ limit: 10, cursor: first.nextCursor! }), { code: "TRACE_CURSOR_EXPIRED" });
    assert.throws(() => traces.page({ limit: 10, cursor: "@@@" }), { code: "INVALID_REQUEST" });
    const otherRun = new TraceBuffer(5, 1_000_000).page({ limit: 1 }).nextCursor!;
    assert.throws(() => traces.page({ limit: 10, cursor: otherRun }), { code: "TRACE_CURSOR_EXPIRED" });
  });

  it("evicts oldest entries to respect the byte budget", () => {
    const traces = new TraceBuffer(10_000, 1_000);
    for (let i = 0; i < 100; i++) traces.record({ requestId: `request-${i}`, stage: "queue", outcome: "ok", channel: "orderStatus", sourceId: "orders" });
    const sizes = traces.page({ limit: 500 }).items.map(item => JSON.stringify(item).length);
    assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 1_000);
    assert.ok(traces.size < 100 && traces.size > 0);
  });
});

describe("budgets, admission, and limits", () => {
  it("reserves across subscription, connection, and gateway levels atomically", () => {
    const gateway = new ByteBudget(1_000);
    const connection = new ByteBudget(600, gateway);
    const a = new SubscriptionBudget(2, 500, connection);
    assert.equal(a.tryReserve(400), true);
    assert.equal(a.tryReserve(200), false, "subscription bytes (400 + 200 > 500)");
    assert.equal(a.tryReserve(50), true);
    assert.equal(a.tryReserve(10), false, "subscription frames (2)");
    a.release(50);
    const b = new SubscriptionBudget(10, 1_000, new ByteBudget(1_000, gateway));
    assert.equal(b.tryReserve(650), false, "gateway bytes (400 + 650 > 1000)");
    assert.equal(gateway.used, 400, "a failed reservation changes nothing");
    assert.equal(b.tryReserve(600), true);
    assert.equal(gateway.used, 1_000);
    const c = new SubscriptionBudget(10, 1_000, connection);
    assert.equal(c.tryReserve(150), false, "gateway full");
    b.release(600);
    assert.equal(c.tryReserve(250), false, "connection bytes (400 + 250 > 600)");
    assert.equal(c.tryReserve(200), true);
    assert.equal(connection.used, 600);
  });

  it("limits concurrent holders and honors deadlines and aborts while waiting", async () => {
    const semaphore = new Semaphore(1);
    const controller = new AbortController();
    assert.equal(await semaphore.acquire(controller.signal, Date.now() + 1_000), true);
    assert.equal(await semaphore.acquire(controller.signal, Date.now() + 30), false, "deadline while waiting");
    const waiting = semaphore.acquire(controller.signal, Date.now() + 1_000);
    semaphore.release();
    assert.equal(await waiting, true, "handed to the next waiter");
    const aborted = new AbortController();
    const cancelled = semaphore.acquire(aborted.signal, Date.now() + 1_000);
    aborted.abort();
    assert.equal(await cancelled, false);
  });

  it("rate-limits with a refilling token bucket", async () => {
    const bucket = new TokenBucket(20, 40);
    let accepted = 0;
    for (let i = 0; i < 60; i++) if (bucket.take()) accepted++;
    assert.equal(accepted, 40);
    await new Promise(resolve => setTimeout(resolve, 110));
    assert.equal(bucket.take(), true, "refilled after ~100 ms");
  });

  it("ignores late handler results after timeout or abort", async () => {
    let lateSignal: AbortSignal | undefined;
    const timedOut = await invokeHandler(async ({ signal }) => {
      lateSignal = signal;
      await new Promise(resolve => setTimeout(resolve, 100));
      return "late";
    }, { timeoutMs: 20, requestId: "r" });
    assert.deepEqual(timedOut, { kind: "timeout" });
    assert.equal(lateSignal?.aborted, true, "the handler's signal was aborted");
    const parent = new AbortController();
    const pending = invokeHandler(() => new Promise(() => undefined), { timeoutMs: 1_000, requestId: "r", parent: parent.signal });
    parent.abort();
    assert.deepEqual(await pending, { kind: "aborted" });
    assert.deepEqual(await invokeHandler(() => { throw new Error("boom"); }, { timeoutMs: 100, requestId: "r" }).then(outcome => outcome.kind), "error");
  });
});

describe("revocation log", () => {
  it("matches only revocations recorded after an operation started", () => {
    const log = new RevocationLog(60_000);
    log.add({ kind: "subject", tenantId: "acme", subject: "alice" }, null);
    const started = log.sequence;
    assert.equal(log.revokedSince(started, principal), false, "earlier revocations are the application's policy, not the log's");
    log.add({ kind: "channel", tenantId: "acme", subject: "alice", channel: "orderStatus", channelVersion: 1 }, '{"orderId":"o1"}');
    const channel = { name: "orderStatus", version: 1, canonicalParams: '{"orderId":"o1"}' };
    assert.equal(log.revokedSince(started, principal), false, "a channel revocation does not revoke the session");
    assert.equal(log.revokedSince(started, principal, channel), true);
    assert.equal(log.revokedSince(started, principal, { ...channel, canonicalParams: '{"orderId":"o2"}' }), false);
    assert.equal(log.revokedSince(started, { ...principal, tenantId: "globex" }, channel), false);
    log.add({ kind: "session", tenantId: "acme", sessionId: "s1" }, null);
    assert.equal(log.revokedSince(started, principal), true);
  });
});

describe("client session", () => {
  const paramsSchema: Schema = {
    type: "object", additionalProperties: false, required: ["orderId"], properties: { orderId: { type: "string", minLength: 1, maxLength: 128 } }
  };
  function session(mode: GatewayCore["mode"]) {
    const traces = new TraceBuffer(100, 1_000_000);
    const core = { mode, limits: DEFAULT_LIMITS, traces, logger: silentLogger, gatewayBudget: new ByteBudget(1_000_000) } as unknown as GatewayCore;
    const channel = { name: "orderStatus", version: 1, paramsSchema, source: { id: "orders" } } as unknown as ChannelRuntime;
    const transport = { sendHello() {}, sendState() {}, sendData() {}, sendError() {}, bufferedBytes: () => 0, close() {} };
    const client = new ClientSession({
      owner: { core, channel: name => (name === "orderStatus" ? channel : undefined), sessionClosed() {} },
      transport, principal, identityKey: "k", previewSessionId: null
    });
    const subscribe = (channelName: string, params: unknown) => {
      let result: Result<unknown> | undefined;
      client.handleSubscribe(
        { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: channelName, channelVersion: 1, params },
        (value: Result<unknown>) => { result = value; }
      );
      return result!.ok ? null : result!.error;
    };
    return { subscribe, traces };
  }

  it("answers schema-invalid parameters like an unknown channel in production", () => {
    const production = session("production");
    const unknown = production.subscribe("secretChannel", {});
    const invalid = production.subscribe("orderStatus", {});
    assert.equal(unknown?.code, "FORBIDDEN");
    assert.deepEqual({ ...invalid, requestId: "" }, { ...unknown, requestId: "" }, "no channel or parameter names are revealed");
    assert.deepEqual(production.traces.page({ limit: 10 }).items.map(trace => trace.errorCode), ["CHANNEL_NOT_FOUND", "INVALID_PARAMS"]);
    // Channel-independent checks still say what is wrong.
    assert.equal(production.subscribe("secretChannel", { orderId: "x".repeat(5_000) })?.code, "INVALID_PARAMS");
    const development = session("development").subscribe("orderStatus", {});
    assert.equal(development?.code, "INVALID_PARAMS");
    assert.match(development?.message ?? "", /orderId/);
  });
});
