/**
 * Workbench host contract (WHC-1) on the server side: native capability discovery, and
 * createManagementHandler mounted under a host route behind a fake host session check.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { WORKBENCH_OPERATIONS, type Result, type WorkbenchDiscovery, type WorkbenchOperation } from "@streamotter/contracts";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { createManagementHandler, startManagementServer, type ManagementServer } from "@streamotter/gateway/management";
import { FAR_FUTURE, OrderApp, orderConfig, orderRecord, startHarness, type Harness } from "./harness.ts";

const NATIVE_OPERATIONS: readonly WorkbenchOperation[] = [
  "capabilities", "health", "sources", "channels", "config", "config.validate", "config.export", "traces",
  "source-checks", "sources.resume", "preview-sessions", "dev.principals", "dev.fixtures.advance", "dev.disconnect", "workbench"
];
const API_BASE = "/host/api/v1";
const SESSION = "session=visitor-1";

interface Response<T> { status: number; body: Result<T>; headers: Headers }

/** A minimal host: the handler is mounted under API_BASE after a cookie check; everything else is the host's 404. */
async function startHost(options: Parameters<typeof createManagementHandler>[0]): Promise<{ origin: string; server: Server; close(): Promise<void> }> {
  const handler = createManagementHandler(options);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://host.invalid");
    if (url.pathname.startsWith(`${API_BASE}/`)) {
      void handler(request, response, url.pathname.slice(API_BASE.length));
      return;
    }
    response.statusCode = 404;
    response.end("host 404");
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin, server,
    close: () => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); })
  };
}

describe("workbench host contract (WHC-1): server side", () => {
  let h: Harness;
  let native: ManagementServer;
  let host: Awaited<ReturnType<typeof startHost>>;
  let full: Awaited<ReturnType<typeof startHost>>;
  const authorized: string[] = [];

  async function request<T = unknown>(origin: string, method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Response<T>> {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
      ...(options.body === undefined ? {} : { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) })
    });
    const text = await response.text();
    return { status: response.status, body: (text === "" ? null : JSON.parse(text)) as Result<T>, headers: response.headers };
  }
  const visitor = { cookie: SESSION, "x-streamotter-workbench": "1" };
  const hosted = <T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = visitor) =>
    request<T>(host.origin, method, `${API_BASE}${path}`, { ...(body === undefined ? {} : { body }), headers });
  const nativeCall = <T = unknown>(method: string, path: string, body?: unknown) =>
    request<T>(native.origin, method, `/management/v1${path}`, { ...(body === undefined ? {} : { body }), headers: { authorization: `Bearer ${native.token}` } });

  before(async () => {
    h = await startHarness({
      principals: { alice: { subject: "alice", tenantId: "acme", sessionId: "dev-alice", expiresAt: FAR_FUTURE, claims: {} } },
      fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)]
    });
    native = await startManagementServer({ gateway: h.gateway, port: 0, workbenchDir: null });
    host = await startHost({
      gateway: h.gateway,
      // A sandbox-style allowlist: no traces, no export, no resume; failures.list is listed but not implemented yet.
      operations: ["health", "sources", "channels", "config", "config.validate", "source-checks", "preview-sessions", "dev.principals", "failures.list"],
      authorize: (incoming: IncomingMessage) => {
        authorized.push(incoming.url ?? "");
        return incoming.headers.cookie === SESSION;
      }
    });
    full = await startHost({ gateway: h.gateway, operations: WORKBENCH_OPERATIONS, authorize: () => true, maxBodyBytes: 1_048_576 });
  });
  after(async () => {
    await host?.close();
    await full?.close();
    await native?.close();
    await h?.close();
  });

  it("native: GET /management/v1/workbench reports every native operation behind the token", async () => {
    assert.equal((await request(native.origin, "GET", "/management/v1/workbench")).status, 401);
    const discovery = await nativeCall<WorkbenchDiscovery>("GET", "/workbench");
    assert.equal(discovery.status, 200);
    assert.deepEqual(discovery.body.ok && discovery.body.data, { hostContract: 1, operations: NATIVE_OPERATIONS, limits: { maxRequestBytes: 1_048_576 } });
    assert.equal((await nativeCall("GET", "/workbench?x=1")).status, 400, "no query parameters");
  });

  it("refuses production gateways and invalid options", () => {
    const production = createGateway({
      config: {
        ...orderConfig(),
        connections: { cluster: { brokers: ["localhost:9093"], tls: {} } },
        sources: { orders: { kind: "kafka", generation: "g", connectionRef: "cluster", topics: ["t"], consumerGroup: "g", codec: "json", startFrom: "latest" } }
      },
      handlers: new OrderApp().handlers(), mode: "production", logger: silentLogger
    });
    assert.throws(() => createManagementHandler({ gateway: production, operations: ["health"], authorize: () => true }), { code: "FORBIDDEN" });
    assert.throws(() => createManagementHandler({ gateway: h.gateway, operations: ["sources.retire-boundary" as WorkbenchOperation], authorize: () => true }), { code: "INVALID_REQUEST" });
    for (const maxBodyBytes of [0, 1_048_577, 1.5]) {
      assert.throws(() => createManagementHandler({ gateway: h.gateway, operations: ["health"], authorize: () => true, maxBodyBytes }), { code: "INVALID_REQUEST" });
    }
  });

  it("calls the host's authorize first and ignores Authorization headers", async () => {
    authorized.length = 0;
    const anonymous = await hosted("GET", "/health", undefined, {});
    assert.equal(anonymous.status, 401);
    assert.equal(!anonymous.body.ok && anonymous.body.error.code, "UNAUTHENTICATED");
    const bearer = await hosted("GET", "/health", undefined, { authorization: `Bearer ${native.token}` });
    assert.equal(bearer.status, 401, "a valid native management token is not a credential here");
    assert.equal((await hosted("GET", "/no-such-route", undefined, {})).status, 401, "authorization runs before routing");
    assert.equal((await hosted("POST", "/config/export", { config: {} }, {})).status, 401);
    assert.equal(authorized.length, 4);
    const withSession = await hosted("GET", "/health", undefined, { cookie: SESSION, authorization: "Bearer nonsense" });
    assert.equal(withSession.status, 200, "a stray Authorization header is ignored");
    assert.equal(withSession.headers.get("cache-control"), "no-store");
    assert.equal(withSession.headers.get("x-request-id"), withSession.body.requestId);
    assert.equal(withSession.headers.get("access-control-allow-origin"), null);
  });

  it("reports the allowlist that is implemented, and the body limit, through discovery", async () => {
    const discovery = await hosted<WorkbenchDiscovery>("GET", "/workbench");
    assert.equal(discovery.status, 200);
    assert.deepEqual(discovery.body.ok && discovery.body.data, {
      hostContract: 1,
      operations: ["health", "sources", "channels", "config", "config.validate", "source-checks", "preview-sessions", "dev.principals", "workbench"],
      limits: { maxRequestBytes: 65_536 }
    });
    const everything = await request<WorkbenchDiscovery>(full.origin, "GET", `${API_BASE}/workbench`);
    assert.deepEqual(everything.body.ok && everything.body.data.operations, NATIVE_OPERATIONS, "unimplemented V1.1 operations are never advertised");
  });

  it("refuses unlisted operations with 403 before reading a body", async () => {
    for (const [method, path, body] of [
      ["GET", "/traces", undefined], ["GET", "/capabilities", undefined], ["POST", "/config/export", { config: {} }],
      ["POST", "/sources/resume", { sourceId: "orders" }], ["POST", "/dev/fixtures/advance", { sourceId: "orders", count: 1 }],
      ["POST", "/dev/disconnect", "{not json"]
    ] as const) {
      const response = await hosted(method, path, body);
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(!response.body.ok && response.body.error.code, "FORBIDDEN");
    }
    assert.equal((await hosted("GET", "/failures")).status, 404, "an allowed but unimplemented operation has no route yet");
  });

  it("requires X-StreamOtter-Workbench: 1 on POST", async () => {
    const missing = await hosted("POST", "/config/validate", { config: {} }, { cookie: SESSION });
    assert.equal(missing.status, 403);
    assert.match(!missing.body.ok ? missing.body.error.message : "", /X-StreamOtter-Workbench/);
    assert.equal((await hosted("POST", "/config/validate", { config: {} }, { cookie: SESSION, "x-streamotter-workbench": "0" })).status, 403);
    assert.equal((await hosted("POST", "/config/validate", { config: {} })).status, 200);
    assert.equal((await hosted("GET", "/health", undefined, { cookie: SESSION })).status, 200, "GETs change nothing and need no header");
  });

  it("enforces the body limit (64 KiB by default) and the shared validation", async () => {
    const big = await hosted("POST", "/config/validate", { config: {}, padding: "x".repeat(70_000) });
    assert.equal(big.status, 413);
    assert.match(!big.body.ok ? big.body.error.message : "", /64 KiB/);
    assert.equal((await hosted("POST", "/preview-sessions", { fixturePrincipalRef: "alice", claims: { admin: true } })).status, 400);
    assert.equal((await hosted("POST", "/preview-sessions", { fixturePrincipalRef: "nobody" })).status, 404);
    assert.equal((await hosted("GET", "/health?verbose=1")).status, 400);
    const preview = await hosted<{ token: string; previewSessionId: string }>("POST", "/preview-sessions", { fixturePrincipalRef: "alice" });
    assert.equal(preview.status, 200);
    assert.ok(preview.body.ok && preview.body.data.token.length > 0);
  });

  it("serves API routes only, never static files", async () => {
    for (const path of ["/", "/index.html", "/app.js", "/favicon.svg", "/workbench-host.json"]) {
      const response = await hosted("GET", path);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    }
    assert.equal((await hosted("OPTIONS", "/health")).status, 404);
    assert.equal((await hosted("DELETE", "/health")).status, 404);
  });

  it("answers exactly like the native server for the same requests", async () => {
    const cases: [string, string, unknown?][] = [
      ["GET", "/health"], ["GET", "/channels"], ["GET", "/dev/principals"], ["GET", "/capabilities"],
      ["GET", "/traces?limit=501"], ["GET", "/traces?outcome=nope"], ["GET", "/traces?cursor=bm9wZTox"], ["GET", "/config?x=1"],
      ["POST", "/config/validate", { config: {} }], ["POST", "/config/validate", { config: {}, extra: 1 }], ["POST", "/config/validate", "{not json"],
      ["POST", "/config/export", { config: { projectId: "x" } }], ["POST", "/config/export", orderConfig()],
      ["POST", "/dev/fixtures/advance", { sourceId: "orders", count: 101 }], ["POST", "/dev/fixtures/advance", { sourceId: "missing", count: 1 }],
      ["POST", "/dev/disconnect", { previewSessionId: "unknown" }], ["POST", "/source-checks", { sourceId: "missing" }],
      ["POST", "/sources/resume", { sourceId: "orders" }], ["GET", "/missing"], ["DELETE", "/health"]
    ];
    for (const [method, path, body] of cases) {
      const fromNative = await nativeCall(method, path, body);
      const fromHost = await request(full.origin, method, `${API_BASE}${path}`, { ...(body === undefined ? {} : { body }), headers: { "x-streamotter-workbench": "1" } });
      const summary = (response: Response<unknown>) => response.body.ok
        ? { status: response.status, data: response.body.data }
        : { status: response.status, code: response.body.error.code, message: response.body.error.message, details: response.body.error.details ?? null };
      const normalize = (value: ReturnType<typeof summary>) => JSON.parse(JSON.stringify(value).replace(/"(requestId|traceId|at)":"[^"]*"/g, "\"$1\":\"*\""));
      assert.deepEqual(normalize(summary(fromHost)), normalize(summary(fromNative)), `${method} ${path}`);
    }
  });
});
