import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, HealthResponse } from "@streamotter/contracts";
import { createGatewayRuntime, MemoryIncidentStore } from "@streamotter/gateway/internals";
import { orderConfig, orderRecord, OrderApp, startHarness, type Harness } from "./harness.ts";

/**
 * The read-only health listener (ADR-15C §4, V1.1 API §8) on a running gateway,
 * with and without failure handling (F43 at the fixture tier). Expected reasons
 * come from what each test does to the source, not from the gateway's own state.
 */

const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
const silent = { info() {}, warn() {}, error() {} };

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function probe(origin: string, path: string, init?: RequestInit): Promise<{ status: number; body: HealthResponse | null; headers: Headers }> {
  const response = await fetch(`${origin}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) as HealthResponse, headers: response.headers };
}

describe("health listener (ADR-15C §4)", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("answers live and ready with ok, no-store and no CORS; everything else is 404 with no body", async () => {
    const port = await freePort();
    h = await startHarness({ health: { port } });
    const origin = `http://127.0.0.1:${port}`;
    for (const path of ["/health/live", "/health/ready"]) {
      const answer = await probe(origin, path, { headers: { origin: "https://evil.example" } });
      assert.equal(answer.status, 200, path);
      assert.deepEqual(answer.body, { status: "ok", reasons: [] });
      assert.equal(answer.headers.get("cache-control"), "no-store");
      assert.equal(answer.headers.get("access-control-allow-origin"), null);
      assert.match(answer.headers.get("content-type") ?? "", /^application\/json/);
    }
    for (const [path, method] of [["/health", "GET"], ["/health/ready?verbose=1", "GET"], ["/health/live/", "GET"], ["/management/v1/health", "GET"], ["/health/ready", "POST"], ["/health/live", "OPTIONS"]] as const) {
      const answer = await probe(origin, path, { method });
      assert.equal(answer.status, 404, `${method} ${path}`);
      assert.equal(answer.body, null);
    }
    assert.equal((await fetch(`${origin}/health/ready`, { method: "HEAD" })).status, 200);
  });

  it("ready reports source-held while a V1 source is paused on a poison record, and never names it; live stays ok", async () => {
    const port = await freePort();
    h = await startHarness({ health: { port }, fixtures: [{ key: "ord_secret_topic", raw: "{not json" }] });
    await h.advance(1);
    const origin = `http://127.0.0.1:${port}`;
    const ready = await probe(origin, "/health/ready");
    assert.equal(ready.status, 503);
    assert.deepEqual(ready.body, { status: "unavailable", reasons: ["source-held"] });
    assert.doesNotMatch(JSON.stringify(ready.body), /orders|ord_secret|f1:/);
    assert.equal((await probe(origin, "/health/live")).status, 200);
    await h.gateway.resumeSource("orders").catch(() => undefined);
  });

  it("ready reports source-held for a quarantine-hold incident", async () => {
    const port = await freePort();
    h = await startHarness({ health: { port }, failureHandling: HOLD, fixtures: [{ key: "ord_1", raw: "{not json" }, orderRecord("acme", "ord_2", 1, "queued", 0)] });
    await h.advance(1);
    await h.internals.failuresSettled();
    const ready = await probe(`http://127.0.0.1:${port}`, "/health/ready");
    assert.deepEqual(ready.body, { status: "unavailable", reasons: ["source-held"] });
  });

  it("ready reports journal while the incident store cannot record, alongside the held source", async () => {
    class FailingStore extends MemoryIncidentStore {
      override observe(): never { throw new Error("disk I/O error"); }
    }
    const port = await freePort();
    const { gateway } = createGatewayRuntime({
      config: { ...orderConfig(), failureHandling: HOLD },
      handlers: new OrderApp().handlers(),
      mode: "development",
      logger: silent,
      health: { port },
      development: { principals: {}, fixtures: { orders: [{ key: "ord_1", raw: "{not json" }] } }
    } as never, { incidentStore: new FailingStore() });
    await gateway.start();
    try {
      const { getGatewayInternals } = await import("@streamotter/gateway/internals");
      const internals = getGatewayInternals(gateway);
      await internals.advanceFixture("orders", 1);
      await internals.failuresSettled();
      const ready = await probe(`http://127.0.0.1:${port}`, "/health/ready");
      assert.deepEqual(ready.body, { status: "unavailable", reasons: ["source-held", "journal"] });
    } finally {
      await gateway.stop({ timeoutMs: 2_000 });
    }
  });

  it("closes with the gateway, and a port in use fails startup and rolls back", async () => {
    const port = await freePort();
    h = await startHarness({ health: { port } });
    await h.close();
    h = undefined;
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health/live`));

    const blocker = createServer();
    await new Promise<void>(resolve => blocker.listen(port, "127.0.0.1", resolve));
    try {
      await assert.rejects(startHarness({ health: { port } }), (error: { code: string; message: string }) => error.code === "SOURCE_UNAVAILABLE" && /in use/.test(error.message));
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()));
    }
  });

  it("refuses invalid options at construction", () => {
    for (const health of [{ port: -1 }, { port: 70_000 }, { port: 1.5 }, { host: "", port: 1 }, { port: 1, path: "/x" }, "7402", null]) {
      assert.throws(() => createGatewayRuntime({
        config: orderConfig(), handlers: new OrderApp().handlers(), mode: "development", logger: silent,
        development: { principals: {}, fixtures: { orders: [] } }, health
      } as never), (error: { code: string }) => error.code === "CONFIG_INVALID", JSON.stringify(health));
    }
  });
});
