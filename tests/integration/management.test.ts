import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { canonicalJson, canonicalJsonPretty, StreamOtterError, type Result } from "@streamotter/contracts";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { startManagementServer, type ManagementServer } from "@streamotter/gateway/management";
import { createGatewayRuntime } from "@streamotter/gateway/internals";
import { deferred, FAR_FUTURE, observe, sleep, OrderApp, orderConfig, orderRecord, startHarness, waitFor, type Harness, type TestChannels } from "./harness.ts";
import { createHash } from "node:crypto";
import { Agent, request as httpRequest } from "node:http";

const PRINCIPALS = {
  alice: { subject: "alice", tenantId: "acme", sessionId: "dev-alice", expiresAt: FAR_FUTURE, claims: { plan: "pro" } },
  mallory: { subject: "mallory", tenantId: "globex", sessionId: "dev-mallory", expiresAt: FAR_FUTURE, claims: {} }
};

describe("management API (development only)", () => {
  let h: Harness;
  let m: ManagementServer;
  let workbenchDir: string;

  async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Result<T>; headers: Headers }> {
    const response = await fetch(`${m.origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${m.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as Result<T>, headers: response.headers };
  }

  before(async () => {
    h = await startHarness({
      principals: PRINCIPALS,
      fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20), orderRecord("acme", "ord_1", 3, "processing", 30)]
    });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    workbenchDir = await mkdtemp(join(tmpdir(), "streamotter-workbench-"));
    await writeFile(join(workbenchDir, "index.html"), "<!doctype html><title>Workbench</title>");
    m = await startManagementServer({ gateway: h.gateway, port: 0, workbenchDir });
  });
  after(async () => {
    await m.close();
    await h.close();
  });

  it("requires the bearer token and sets no-store, request IDs, and no CORS", async () => {
    const anonymous = await fetch(`${m.origin}/management/v1/health`);
    assert.equal(anonymous.status, 401);
    const body = await anonymous.json() as Result<unknown>;
    assert.equal(!body.ok && body.error.code, "UNAUTHENTICATED");
    const wrong = await fetch(`${m.origin}/management/v1/health`, { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);
    const response = await call("GET", "/management/v1/health");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.body.requestId.length > 0);
    assert.equal(response.headers.get("x-request-id"), response.body.requestId);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(response.body.ok && response.body.data, { ready: true, sources: [{ sourceId: "orders", kind: "fixture", status: "healthy" }] });
  });

  it("enforces the exact workbench origin, or a same-origin Referer for GETs", async () => {
    assert.equal((await call("GET", "/management/v1/health", undefined, { origin: "http://localhost:5173" })).status, 403);
    assert.equal((await call("GET", "/management/v1/health", undefined, { origin: m.origin })).status, 200);
    assert.equal((await call("GET", "/management/v1/health", undefined, { referer: `${m.origin}/` })).status, 200);
    assert.equal((await call("GET", "/management/v1/health", undefined, { referer: "http://evil.example/" })).status, 403);
    assert.equal((await call("POST", "/management/v1/config/validate", { config: {} }, { referer: `${m.origin}/` })).status, 403);
    assert.equal((await call("POST", "/management/v1/config/validate", { config: {} }, { origin: m.origin })).status, 200);
  });

  it("serves capabilities, sources, channels, active config, and development principals", async () => {
    const capabilities = await call("GET", "/management/v1/capabilities");
    assert.deepEqual(capabilities.body.ok && capabilities.body.data, {
      protocolVersion: 1, configVersions: [1], transport: "socket.io", deliveryModes: ["state"], operations: ["subscribe", "unsubscribe", "resync", "receipt"]
    });
    const channels = await call("GET", "/management/v1/channels");
    assert.deepEqual(channels.body.ok && channels.body.data, {
      items: [{ name: "orderStatus", version: 1, source: "orders", delivery: "state", paramsSchema: "OrderParams", payloadSchema: "OrderState" }]
    });
    const config = await call<{ config: unknown; fingerprint: string }>("GET", "/management/v1/config");
    assert.ok(config.body.ok);
    if (config.body.ok) {
      assert.equal(config.body.data.fingerprint, createHash("sha256").update(canonicalJson(config.body.data.config)).digest("hex"));
    }
    const principals = await call("GET", "/management/v1/dev/principals");
    assert.deepEqual(principals.body.ok && principals.body.data, {
      items: [{ ref: "alice", tenantId: "acme", subject: "alice" }, { ref: "mallory", tenantId: "globex", subject: "mallory" }]
    });
  });

  it("validates candidate configuration without applying it and exports canonical JSON", async () => {
    const candidate = { ...orderConfig(), projectId: "renamed" };
    const validation = await call<{ valid: boolean; issues: unknown[] }>("POST", "/management/v1/config/validate", { config: candidate });
    assert.deepEqual(validation.body.ok && validation.body.data, { valid: true, issues: [] });
    const invalid = await call<{ valid: boolean; issues: { code: string }[] }>("POST", "/management/v1/config/validate", { config: { ...candidate, extra: 1 } });
    assert.equal(invalid.status, 200, "a valid:false report is still a successful operation");
    assert.equal(invalid.body.ok && invalid.body.data.valid, false);
    const exported = await call<{ filename: string; content: string; fingerprint: string }>("POST", "/management/v1/config/export", { config: candidate });
    assert.ok(exported.body.ok);
    if (exported.body.ok) {
      assert.equal(exported.body.data.filename, "streamotter.json");
      assert.equal(exported.body.data.content, canonicalJsonPretty(candidate));
      assert.equal(exported.body.data.fingerprint, createHash("sha256").update(canonicalJson(candidate)).digest("hex"));
    }
    const refused = await call("POST", "/management/v1/config/export", { config: { ...candidate, extra: 1 } });
    assert.equal(refused.status, 400);
    assert.equal(!refused.body.ok && refused.body.error.code, "CONFIG_INVALID");
    const active = await call<{ config: { projectId: string } }>("GET", "/management/v1/config");
    assert.equal(active.body.ok && active.body.data.config.projectId, "order-dashboard", "editing a candidate never changes the running gateway");
  });

  it("runs the preview workflow: preview session, subscribe, advance fixtures, inspect traces, disconnect", async () => {
    const preview = await call<{ token: string; expiresAt: string; previewSessionId: string }>("POST", "/management/v1/preview-sessions", { fixturePrincipalRef: "alice" });
    assert.ok(preview.body.ok);
    if (!preview.body.ok) return;
    const ttl = Date.parse(preview.body.data.expiresAt) - Date.now();
    assert.ok(ttl > 290_000 && ttl <= 300_000, "five-minute preview token");
    const sub = h.client(preview.body.data.token).subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    const advanced = await call<{ advanced: number }>("POST", "/management/v1/dev/fixtures/advance", { sourceId: "orders", count: 2 });
    assert.deepEqual(advanced.body.ok && advanced.body.data, { advanced: 2 });
    await waitFor(() => seen.events.length === 3);
    h.app.put("acme", "alice", "ord_1", 3, "processing", 30); // The application's store reflects published state.

    const first = await call<{ items: { stage: string }[]; nextCursor: string }>("GET", "/management/v1/traces?limit=5");
    assert.ok(first.body.ok);
    if (!first.body.ok) return;
    assert.equal(first.body.data.items.length, 5);
    await call("POST", "/management/v1/dev/disconnect", { previewSessionId: preview.body.data.previewSessionId });
    await waitFor(() => sub.state !== "live");
    await waitFor(() => sub.state === "live", 5_000, "reconnected with the same preview token");
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:1", "update:2", "update:3", "snapshot:3"]);
    const next = await call<{ items: { stage: string; outcome: string }[] }>("GET", `/management/v1/traces?cursor=${first.body.data.nextCursor}&outcome=ok`);
    assert.ok(next.body.ok && next.body.data.items.length > 0 && next.body.data.items.every(item => item.outcome === "ok"));
  });

  it("maps errors to the specified HTTP statuses", async () => {
    const statusOf = async (method: string, path: string, body?: unknown) => (await call(method, path, body)).status;
    assert.equal(await statusOf("POST", "/management/v1/preview-sessions", { fixturePrincipalRef: "nobody" }), 404);
    assert.equal(await statusOf("POST", "/management/v1/preview-sessions", { fixturePrincipalRef: "alice", claims: { admin: true } }), 400);
    assert.equal(await statusOf("POST", "/management/v1/dev/fixtures/advance", { sourceId: "orders", count: 101 }), 400);
    assert.equal(await statusOf("POST", "/management/v1/dev/fixtures/advance", { sourceId: "missing", count: 1 }), 404);
    assert.equal(await statusOf("POST", "/management/v1/dev/disconnect", { previewSessionId: "unknown" }), 404);
    assert.equal(await statusOf("POST", "/management/v1/sources/resume", { sourceId: "orders" }), 200, "already healthy is a no-op");
    assert.equal(await statusOf("POST", "/management/v1/source-checks", { sourceId: "missing" }), 404);
    assert.equal(await statusOf("GET", "/management/v1/health?verbose=1"), 400);
    assert.equal(await statusOf("GET", "/management/v1/traces?limit=501"), 400);
    assert.equal(await statusOf("GET", "/management/v1/traces?cursor=bm9wZTox"), 410);
    assert.equal(await statusOf("POST", "/management/v1/config/validate", "{not json"), 400);
    assert.equal(await statusOf("POST", "/management/v1/config/validate", { config: {}, padding: "x".repeat(1_100_000) }), 413);
    assert.equal(await statusOf("DELETE", "/management/v1/health"), 404);
    // fetch refuses a GET body, so send one directly.
    const getWithBody = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ ignored: true });
      const request = httpRequest(`${m.origin}/management/v1/health`, {
        method: "GET",
        headers: { authorization: `Bearer ${m.token}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }
      }, response => { response.resume(); resolve(response.statusCode ?? 0); });
      request.on("error", reject);
      request.end(body);
    });
    assert.equal(getWithBody, 400);
    const checks = await call<{ steps: { stage: string; outcome: string }[] }>("POST", "/management/v1/source-checks", { sourceId: "orders" });
    assert.deepEqual(checks.body.ok && checks.body.data.steps.map(step => step.stage), ["resolve", "connect", "tls", "authenticate", "metadata"]);
  });

  it("answers 429 past the request rate, and 503 and 504 for an unavailable dependency and a deadline", async () => {
    const local = await startHarness();
    const server = await startManagementServer({ gateway: local.gateway, port: 0, workbenchDir: null });
    try {
      const request = (method: string, path: string, body?: unknown) => fetch(`${server.origin}${path}`, {
        method, headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      // The internals object is shared with the router, so a dependency failure surfaces through the real server.
      const realCheck = local.internals.checkSource;
      try {
        local.internals.checkSource = async () => { throw new StreamOtterError("SOURCE_UNAVAILABLE", { message: "The broker is unreachable." }); };
        const unavailable = await request("POST", "/management/v1/source-checks", { sourceId: "orders" });
        assert.equal(unavailable.status, 503);
        const unavailableBody = await unavailable.json() as Result<unknown>;
        assert.equal(!unavailableBody.ok && unavailableBody.error.code, "SOURCE_UNAVAILABLE");
        local.internals.checkSource = async () => { throw new StreamOtterError("TIMEOUT", { message: "The source check exceeded its deadline." }); };
        const timedOut = await request("POST", "/management/v1/source-checks", { sourceId: "orders" });
        assert.equal(timedOut.status, 504);
        const timedOutBody = await timedOut.json() as Result<unknown>;
        assert.equal(!timedOutBody.ok && timedOutBody.error.code, "TIMEOUT");
        assert.equal(timedOut.headers.get("cache-control"), "no-store");
      } finally {
        local.internals.checkSource = realCheck;
      }
      // 100 requests per second with a burst of 200: a burst of 400 must be refused in part. The burst
      // goes over a few kept-alive connections rather than 400 at once, so it measures the rate limit,
      // not the listen backlog (macOS caps it at 128 and resets the connections past it).
      const agent = new Agent({ keepAlive: true, maxSockets: 8 });
      const health = (): Promise<number | string | false> => new Promise((resolve, reject) => {
        const req = httpRequest(`${server.origin}/management/v1/health`, { agent, headers: { authorization: `Bearer ${server.token}` } }, response => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", chunk => { text += chunk; });
          response.on("end", () => {
            try {
              const body = JSON.parse(text) as Result<unknown>;
              resolve(response.statusCode === 429 ? (!body.ok && body.error.code) : response.statusCode ?? 0);
            } catch (error) {
              reject(error);
            }
          });
          response.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });
      let statuses: (number | string | false)[];
      try {
        statuses = await Promise.all(Array.from({ length: 400 }, health));
      } finally {
        agent.destroy();
      }
      assert.ok(statuses.includes("OVERLOADED"), "some requests were rate limited with OVERLOADED");
      assert.ok(statuses.includes(200));
      assert.deepEqual(new Set(statuses), new Set([200, "OVERLOADED"]));
    } finally {
      await server.close();
      await local.close();
    }
  });

  it("runs at most two source checks at once and answers a third with 429", async () => {
    const app = new OrderApp();
    const { gateway, runtime } = createGatewayRuntime<TestChannels>({
      config: orderConfig(), handlers: app.handlers(), mode: "development",
      development: { principals: {}, fixtures: { orders: [] } }, logger: silentLogger
    });
    await gateway.start();
    const server = await startManagementServer({ gateway, port: 0, workbenchDir: null });
    const release = deferred();
    let running = 0;
    const realCheck = runtime.checkSource.bind(runtime);
    runtime.checkSource = async source => {
      running++;
      await release.promise;
      return realCheck(source);
    };
    try {
      const check = () => fetch(`${server.origin}/management/v1/source-checks`, {
        method: "POST", headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" }, body: JSON.stringify({ sourceId: "orders" })
      });
      const first = [check(), check()];
      await waitFor(() => running === 2, 5_000, "two checks running");
      const third = await Promise.race([check(), sleep(3_000).then(() => null)]);
      assert.ok(third !== null, "the third check was answered without waiting for a slot");
      assert.equal(third.status, 429);
      const thirdBody = await third.json() as Result<unknown>;
      assert.equal(!thirdBody.ok && thirdBody.error.code, "OVERLOADED");
      release.resolve();
      assert.deepEqual((await Promise.all(first)).map(response => response.status), [200, 200]);
      assert.equal((await check()).status, 200, "a slot frees once a check finishes");
    } finally {
      release.resolve();
      await server.close();
      await gateway.stop({ timeoutMs: 2_000 });
    }
  });

  it("reports 409 for fixture advancement and a 200 ready:false health while the source is paused, then resumes", async () => {
    const local = await startHarness({ fixtures: [orderRecord("acme", "ord_9", 1, "queued", 0), orderRecord("acme", "ord_9", 2, "done", 100)] });
    let broken = true;
    local.app.mapOverride = value => {
      if (broken) throw new Error("bad");
      const record = value as { tenantId: string; revision: string; order: { orderId: string } };
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    const server = await startManagementServer({ gateway: local.gateway, port: 0, workbenchDir: null });
    const post = (path: string, body: unknown) => fetch(`${server.origin}${path}`, {
      method: "POST", headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" }, body: JSON.stringify(body)
    });
    assert.deepEqual(await (await post("/management/v1/dev/fixtures/advance", { sourceId: "orders", count: 2 })).json().then(r => (r as { data: unknown }).data), { advanced: 0 });
    assert.equal((await post("/management/v1/dev/fixtures/advance", { sourceId: "orders", count: 1 })).status, 409);
    const health = await fetch(`${server.origin}/management/v1/health`, { headers: { authorization: `Bearer ${server.token}` } });
    assert.equal(health.status, 200, "health answers 200 even when not ready");
    const healthBody = await health.json() as Result<{ ready: boolean; sources: { sourceId: string; status: string }[] }>;
    assert.equal(healthBody.ok && healthBody.data.ready, false);
    assert.deepEqual(healthBody.ok && healthBody.data.sources.map(source => [source.sourceId, source.status]), [["orders", "paused"]]);
    broken = false;
    const resumed = await (await post("/management/v1/sources/resume", { sourceId: "orders" })).json() as Result<unknown>;
    assert.deepEqual(resumed.ok && resumed.data, { sourceId: "orders", kind: "fixture", status: "healthy" });
    await server.close();
    await local.close();
  });

  it("serves the workbench from the same origin with a restrictive CSP and blocks traversal", async () => {
    const page = await fetch(`${m.origin}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Workbench/);
    const csp = page.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, new RegExp(`connect-src 'self' ${h.origin.replace(/[.:/]/g, "\\$&")}`));
    assert.equal((await fetch(`${m.origin}/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await fetch(`${m.origin}/missing.js`)).status, 404);
  });

  it("refuses to start for a production gateway", async () => {
    const production = createGateway({
      config: {
        ...orderConfig(),
        connections: { cluster: { brokers: ["localhost:9093"], tls: {} } },
        sources: { orders: { kind: "kafka", generation: "g", connectionRef: "cluster", topics: ["t"], consumerGroup: "g", codec: "json", startFrom: "latest" } }
      },
      handlers: new OrderApp().handlers(), mode: "production", logger: silentLogger
    });
    await assert.rejects(startManagementServer({ gateway: production, port: 0 }), { code: "FORBIDDEN" });
  });
});
