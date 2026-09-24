import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { DataFrame, ErrorFrame, Result, SubscriptionFrame } from "@streamotter/contracts";
import { sleep, startHarness, waitFor, type Harness } from "./harness.ts";
import { ack, rawConnect, rawConnectError } from "./raw.ts";

const AUTH = { token: "alice@acme", protocolVersion: 1 };
const uuid = () => crypto.randomUUID();
const subscribe = (overrides: Record<string, unknown> = {}) => ({
  requestId: uuid(), subscriptionId: uuid(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" }, ...overrides
});

describe("Socket.IO protocol v1 contract", () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({ limits: { maxSubscriptionsPerConnection: 3, receiptTimeoutMs: 5_000 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    for (let i = 2; i <= 5; i++) h.app.put("acme", "alice", `ord_${i}`, 1, "queued", 0);
  });
  after(() => h.close());

  it("sends capabilities and an opaque identity key in so:hello", async () => {
    const { socket, hello } = await rawConnect(h.origin, AUTH);
    assert.deepEqual({ ...hello, connectionId: "x", authExpiresAt: "x", identityKey: "x" }, {
      protocolVersion: 1, configVersions: [1], transport: "socket.io", deliveryModes: ["state"],
      operations: ["subscribe", "unsubscribe", "resync", "receipt"], connectionId: "x", identityKey: "x", authExpiresAt: "x"
    });
    assert.ok(!hello.identityKey.includes("alice") && !hello.identityKey.includes("acme"));
    const second = await rawConnect(h.origin, { token: "alice@acme#other", protocolVersion: 1 });
    assert.equal(second.hello.identityKey, hello.identityKey, "scoped to tenant and subject, not session");
    const bob = await rawConnect(h.origin, { token: "bob@acme", protocolVersion: 1 });
    assert.notEqual(bob.hello.identityKey, hello.identityKey);
    for (const s of [socket, second.socket, bob.socket]) s.close();
  });

  it("rejects malformed and spoofed handshakes with structured errors", async () => {
    assert.equal((await rawConnectError(h.origin, { token: "alice@acme", protocolVersion: 1, principal: { subject: "admin" } })).code, "INVALID_REQUEST");
    assert.equal((await rawConnectError(h.origin, { token: "alice@acme", protocolVersion: 2 })).code, "UNSUPPORTED_CAPABILITY");
    assert.equal((await rawConnectError(h.origin, { token: "", protocolVersion: 1 })).code, "UNAUTHENTICATED");
    assert.equal((await rawConnectError(h.origin, { token: "a".repeat(8_193), protocolVersion: 1 })).code, "UNAUTHENTICATED");
    assert.equal((await rawConnectError(h.origin, { token: "nobody", protocolVersion: 1 })).code, "UNAUTHENTICATED");
    assert.equal((await rawConnectError(h.origin, AUTH, { origin: "https://evil.example" })).code, "FORBIDDEN");
    const allowed = await rawConnect(h.origin, AUTH, { origin: "http://localhost:3000" });
    allowed.socket.close();
  });

  it("acknowledges subscribe before sending that subscription's frames", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    const order: string[] = [];
    socket.on("so:state", (frame: SubscriptionFrame) => order.push(`state:${frame.state}`));
    socket.on("so:data", () => order.push("data"));
    // Record the acknowledgement in its callback: a promise continuation could run after
    // later frames from the same socket read, which would misstate wire order.
    socket.emit("so:subscribe", subscribe(), (result: Result<unknown>) => order.push(`ack:${result.ok}`));
    await waitFor(() => order.includes("data"));
    assert.deepEqual(order.slice(0, 3), ["ack:true", "state:synchronizing", "data"]);
    socket.close();
  });

  it("makes identical subscribe retries idempotent and rejects conflicting reuse", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    const request = subscribe();
    const first = await ack(socket, "so:subscribe", request);
    const retry = await ack(socket, "so:subscribe", request);
    assert.deepEqual(retry, first, "the cached result is returned for an identical retry");
    const sameSubscription = await ack(socket, "so:subscribe", { ...request, requestId: uuid() });
    assert.equal(sameSubscription.ok, true, "same subscription ID and contract is idempotent");
    const changedContract = await ack(socket, "so:subscribe", { ...request, requestId: uuid(), params: { orderId: "ord_2" } });
    assert.equal(!changedContract.ok && changedContract.error.code, "INVALID_REQUEST");
    const reusedRequestId = await ack(socket, "so:subscribe", { ...request, subscriptionId: uuid() });
    assert.equal(!reusedRequestId.ok && reusedRequestId.error.code, "INVALID_REQUEST");
    socket.close();
  });

  it("answers unrecognized channels, versions, and source names with the public FORBIDDEN code", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    for (const overrides of [{ channel: "privateKafkaTopic" }, { channelVersion: 2 }, { channel: "orders" }, { channel: "orders.status" }]) {
      const result = await ack(socket, "so:subscribe", subscribe(overrides));
      assert.equal(!result.ok && result.error.code, "FORBIDDEN", JSON.stringify(overrides));
      assert.ok(!result.ok && !JSON.stringify(result.error).includes("orders.status"));
    }
    const operator = h.internals.traces({ limit: 500, outcome: "rejected" }).items.map(trace => trace.errorCode);
    assert.ok(operator.includes("CHANNEL_NOT_FOUND") && operator.includes("CHANNEL_VERSION_UNSUPPORTED"));
    socket.close();
  });

  it("validates requests: UUIDs, parameters, unknown fields, and unknown operations", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    const codeOf = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
    assert.equal(codeOf(await ack(socket, "so:subscribe", subscribe({ subscriptionId: "not-a-uuid" }))), "INVALID_REQUEST");
    assert.equal(codeOf(await ack(socket, "so:subscribe", subscribe({ params: { orderId: 5 } }))), "INVALID_PARAMS");
    assert.equal(codeOf(await ack(socket, "so:subscribe", subscribe({ params: { orderId: "x".repeat(5_000) } }))), "INVALID_PARAMS");
    assert.equal(codeOf(await ack(socket, "so:subscribe", subscribe({ recovery: { cursor: "c" } }))), "UNSUPPORTED_CAPABILITY");
    assert.equal(codeOf(await ack(socket, "so:command", { name: "requestOrderRefresh" })), "UNSUPPORTED_CAPABILITY");
    const errors: ErrorFrame[] = [];
    socket.on("so:error", (frame: ErrorFrame) => errors.push(frame));
    socket.emit("so:history", { after: "cursor" });
    await waitFor(() => errors.length === 1);
    assert.equal(errors[0]?.error.code, "UNSUPPORTED_CAPABILITY");
    assert.equal(codeOf(await ack(socket, "so:unsubscribe", { requestId: uuid(), subscriptionId: uuid() })), "ok", "already absent is success");
    assert.equal(codeOf(await ack(socket, "so:resync", { requestId: uuid(), subscriptionId: uuid() })), "INVALID_REQUEST");
    socket.close();
  });

  it("enforces the per-connection subscription limit", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    const results = [];
    for (let i = 1; i <= 4; i++) results.push(await ack(socket, "so:subscribe", subscribe({ params: { orderId: `ord_${i}` } })));
    assert.deepEqual(results.map(result => result.ok), [true, true, true, false]);
    assert.equal(!results[3]!.ok && results[3]!.error.code, "OVERLOADED");
    socket.close();
  });

  it("rate-limits control requests per connection (20/s, burst 40)", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    const results = await Promise.all(Array.from({ length: 60 }, () => ack(socket, "so:unsubscribe", { requestId: uuid(), subscriptionId: uuid() })));
    const limited = results.filter(result => !result.ok && result.error.code === "OVERLOADED").length;
    assert.ok(limited >= 15 && limited <= 20, `expected about 20 limited requests, got ${limited}`);
    socket.close();
  });

  it("closes connections that send control frames above maxControlFrameBytes", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    let disconnected = false;
    socket.on("disconnect", () => { disconnected = true; });
    socket.emit("so:unsubscribe", { requestId: uuid(), subscriptionId: uuid(), padding: "x".repeat(20_000) }, () => undefined);
    await waitFor(() => disconnected, 3_000, "disconnect");
  });

  it("treats duplicate receipts as harmless, ignores unsolicited ones, and resynchronizes on a future receipt", async () => {
    const { socket } = await rawConnect(h.origin, AUTH);
    const data: DataFrame[] = [];
    const states: SubscriptionFrame[] = [];
    const errors: ErrorFrame[] = [];
    socket.on("so:data", (frame: DataFrame) => data.push(frame));
    socket.on("so:state", (frame: SubscriptionFrame) => states.push(frame));
    socket.on("so:error", (frame: ErrorFrame) => errors.push(frame));
    const request = subscribe();
    await ack(socket, "so:subscribe", request);
    await waitFor(() => data.length === 1);
    const epoch = data[0]!.epoch;
    socket.emit("so:receipt", { subscriptionId: request.subscriptionId, epoch, sequence: 1 });
    socket.emit("so:receipt", { subscriptionId: request.subscriptionId, epoch, sequence: 1 });
    socket.emit("so:receipt", { subscriptionId: uuid(), epoch, sequence: 7 });
    await waitFor(() => states.some(frame => frame.state === "live"));
    await sleep(50);
    assert.equal(errors.length, 0);
    socket.emit("so:receipt", { subscriptionId: request.subscriptionId, epoch, sequence: 9 });
    await waitFor(() => errors.length === 1 && states.some(frame => frame.state === "stale"));
    assert.equal(errors[0]?.error.code, "INVALID_REQUEST");
    assert.equal(states.find(frame => frame.state === "stale")?.reason, "INVALID_REQUEST");
    await waitFor(() => states.filter(frame => frame.state === "synchronizing").length === 2, 3_000);
    assert.notEqual(states.filter(frame => frame.state === "synchronizing")[1]?.epoch, epoch);
    socket.emit("so:receipt", { subscriptionId: request.subscriptionId, epoch: "x", sequence: "one" });
    await waitFor(() => errors.length === 2);
    assert.equal(errors[1]?.error.code, "INVALID_REQUEST");
    socket.close();
  });
});
