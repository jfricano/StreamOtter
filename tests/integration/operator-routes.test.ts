/**
 * The V1.1 operator routes of the development management API (V1_1_API.md §9, WHC-1 §5): their
 * mapping onto the operator service, argument validation, the 64 KiB failure-body limit, discovery,
 * and the rule that raw evidence never crosses them (F37). The gateway's operator service is
 * replaced by a scripted fake on the internals object the management router reads.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  WORKBENCH_OPERATIONS, type IncidentDetail, type OperationResult, type OperatorStatus, type Page, type IncidentSummary, type ReproductionBundle,
  type Result, type WorkbenchDiscovery, type WorkbenchOperation
} from "@streamotter/contracts";
import { createManagementHandler, startManagementServer, type ManagementServer } from "@streamotter/gateway/management";
import { FakeOperator, RAW_MARKER } from "./fake-operator.ts";
import { orderRecord, startHarness, type Harness } from "./harness.ts";

const API_BASE = "/host/api/v1";
const FAILURE_OPERATIONS: readonly WorkbenchOperation[] = [
  "operator.status", "failures.list", "failures.show", "failures.export", "failures.evaluate", "failures.redrive",
  "sources.retry-current", "sources.reassess", "sources.reopen-circuit"
];
const NATIVE_OPERATIONS: readonly WorkbenchOperation[] = [
  "capabilities", "health", "sources", "channels", "config", "config.validate", "config.export", "traces",
  "source-checks", "sources.resume", "preview-sessions", "dev.principals", "dev.fixtures.advance", "dev.disconnect", "workbench"
];
/** One request per operator route, valid against the fake's incident set. */
const ROUTE_CASES: readonly [WorkbenchOperation, "GET" | "POST", string, unknown?][] = [
  ["operator.status", "GET", "/operator/status"],
  ["failures.list", "GET", "/failures"],
  ["failures.show", "GET", `/failures/${encodeURIComponent("f1:orders:fixture:3")}`],
  ["failures.export", "POST", "/failures/export", { failureId: "f1:orders:fixture:3" }],
  ["failures.evaluate", "POST", "/failures/evaluate", { failureId: "f1:orders:fixture:3", expectedRevision: 4 }],
  ["failures.redrive", "POST", "/failures/redrive", { failureId: "f1:orders:fixture:7", planId: "plan-1", planFingerprint: "sha256:plan1", expectedRevision: 9 }],
  ["sources.retry-current", "POST", "/sources/retry-current", { sourceId: "orders", failureId: "f1:orders:fixture:3", expectedRevision: 4 }],
  ["sources.reassess", "POST", "/sources/reassess", { sourceId: "notes", failureId: "f1:notes:fixture:5", expectedRevision: 3 }],
  ["sources.reopen-circuit", "POST", "/sources/reopen-circuit", { sourceId: "notes", expectedCircuitRevision: 7, reason: "fixed the producer" }]
];

interface Response<T> { status: number; body: Result<T>; text: string }

async function request<T = unknown>(url: string, method: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Response<T>> {
  const response = await fetch(url, {
    method,
    headers: { ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers },
    ...(options.body === undefined ? {} : { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) })
  });
  const text = await response.text();
  return { status: response.status, body: (text === "" ? null : JSON.parse(text)) as Result<T>, text };
}

const data = <T>(response: Response<T>): T => {
  assert.ok(response.body.ok, `expected success, got ${response.status} ${response.text}`);
  return response.body.data;
};
const code = (response: Response<unknown>) => response.body.ok ? null : response.body.error.code;

describe("V1.1 operator routes (development management API)", () => {
  let h: Harness;
  let fake: FakeOperator;
  let native: ManagementServer;
  let server: Server;
  let origin: string;
  const handlers = new Map<string, ReturnType<typeof createManagementHandler>>();

  const nativeCall = <T = unknown>(method: string, path: string, body?: unknown) =>
    request<T>(`${native.origin}/management/v1${path}`, method, { ...(body === undefined ? {} : { body }), headers: { authorization: `Bearer ${native.token}` } });
  const hosted = <T = unknown>(mount: string, method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-streamotter-workbench": "1" }) =>
    request<T>(`${origin}/${mount}${API_BASE}${path}`, method, { ...(body === undefined ? {} : { body }), headers });

  before(async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    native = await startManagementServer({ gateway: h.gateway, port: 0, workbenchDir: null });
    const mount = (name: string, options: Omit<Parameters<typeof createManagementHandler>[0], "gateway" | "authorize">) =>
      handlers.set(name, createManagementHandler({ gateway: h.gateway, authorize: () => true, ...options }));
    mount("full", { operations: WORKBENCH_OPERATIONS, maxBodyBytes: 1_048_576 });
    mount("no-failures", { operations: NATIVE_OPERATIONS });
    mount("list-only", { operations: ["health", "failures.list"] });
    server = createServer((incoming, response) => {
      const url = new URL(incoming.url ?? "/", "http://host.invalid");
      const [, name = "", ...rest] = url.pathname.split("/");
      const handler = handlers.get(name);
      const inner = `/${rest.join("/")}`;
      if (handler === undefined || !inner.startsWith(`${API_BASE}/`)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      void handler(incoming, response, `${inner.slice(API_BASE.length)}${url.search}`);
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    fake = new FakeOperator();
    // The router reads the operator through the gateway's internals on every request.
    h.internals.operator = () => fake;
  });
  after(async () => {
    await new Promise<void>(done => { if (server === undefined) done(); else { server.close(() => done()); server.closeAllConnections(); } });
    await native?.close();
    await h?.close();
  });

  it("without an operator service the routes are unimplemented (404) and discovery omits them", async () => {
    h.internals.operator = () => null;
    assert.deepEqual(data(await nativeCall<WorkbenchDiscovery>("GET", "/workbench")).operations, NATIVE_OPERATIONS);
    assert.deepEqual(data(await hosted<WorkbenchDiscovery>("full", "GET", "/workbench")).operations, NATIVE_OPERATIONS);
    for (const [operation, method, path, body] of ROUTE_CASES) {
      for (const response of [await nativeCall(method, path, body), await hosted("full", method, path, body)]) {
        assert.equal(response.status, 404, `${operation}: ${response.text}`);
        assert.equal(code(response), "INVALID_REQUEST");
      }
    }
  });

  it("discovery lists the failure operations only when an operator exists and they are allowlisted", async () => {
    const all = [...NATIVE_OPERATIONS.slice(0, -1), "workbench", ...FAILURE_OPERATIONS];
    assert.deepEqual(data(await nativeCall<WorkbenchDiscovery>("GET", "/workbench")), { hostContract: 1, operations: all, limits: { maxRequestBytes: 1_048_576 } });
    assert.deepEqual(data(await hosted<WorkbenchDiscovery>("full", "GET", "/workbench")).operations, all);
    assert.deepEqual(data(await hosted<WorkbenchDiscovery>("no-failures", "GET", "/workbench")).operations, NATIVE_OPERATIONS);
    assert.deepEqual(data(await hosted<WorkbenchDiscovery>("list-only", "GET", "/workbench")).operations, ["health", "workbench", "failures.list"]);
    assert.ok(!all.includes("sources.retire-boundary" as WorkbenchOperation));
  });

  it("createManagementHandler answers 403 for failure operations its allowlist excludes (F37)", async () => {
    for (const [operation, method, path, body] of ROUTE_CASES) {
      const response = await hosted("no-failures", method, path, body);
      assert.equal(response.status, 403, operation);
      assert.equal(code(response), "FORBIDDEN");
      if (operation !== "failures.list") assert.equal((await hosted("list-only", method, path, body)).status, 403, operation);
    }
    assert.equal((await hosted("list-only", "GET", "/failures")).status, 200);
    assert.deepEqual(fake.calls.map(call => call.op), ["listFailures"], "nothing unlisted reached the operator");
  });

  it("sources.retire-boundary is never a route", async () => {
    const body = { sourceId: "orders", boundaryId: "b-orders-2", expectedRevision: 2, reason: "test" };
    assert.equal((await nativeCall("POST", "/sources/retire-boundary", body)).status, 404);
    assert.equal((await hosted("full", "POST", "/sources/retire-boundary", body)).status, 404);
    assert.deepEqual(fake.callsOf("retireBoundary"), []);
  });

  it("maps each route onto the operator service with validated arguments", async () => {
    const status = data(await nativeCall<OperatorStatus>("GET", "/operator/status"));
    assert.equal(status.store.kind, "memory");
    const page = data(await nativeCall<Page<IncidentSummary>>("GET", "/failures?sourceId=orders&state=all&limit=1"));
    assert.deepEqual(page.items.map(item => item.failureId), ["f1:orders:fixture:3"]);
    assert.equal(page.nextCursor, "c:1");
    const next = data(await nativeCall<Page<IncidentSummary>>("GET", `/failures?sourceId=orders&state=all&limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`));
    assert.deepEqual(next.items.map(item => item.failureId), ["f1:orders:fixture:7"]);
    data(await nativeCall("GET", "/failures"));
    const detail = data(await nativeCall<IncidentDetail>("GET", `/failures/${encodeURIComponent("f1:orders:fixture:3")}`));
    assert.equal(detail.revision, 4);
    for (const [, method, path, body] of ROUTE_CASES.slice(3)) data(await nativeCall(method, path, body));
    assert.deepEqual(fake.calls, [
      { op: "status", args: {} },
      { op: "listFailures", args: { sourceId: "orders", state: "all", limit: 1 } },
      { op: "listFailures", args: { sourceId: "orders", state: "all", limit: 1, cursor: "c:1" } },
      { op: "listFailures", args: {} },
      { op: "showFailure", args: { failureId: "f1:orders:fixture:3" } },
      { op: "exportFailure", args: { failureId: "f1:orders:fixture:3" } },
      { op: "evaluate", args: { failureId: "f1:orders:fixture:3", expectedRevision: 4 } },
      { op: "redrive", args: { failureId: "f1:orders:fixture:7", planId: "plan-1", planFingerprint: "sha256:plan1", expectedRevision: 9 } },
      { op: "retryCurrent", args: { sourceId: "orders", failureId: "f1:orders:fixture:3", expectedRevision: 4 } },
      { op: "reassess", args: { sourceId: "notes", failureId: "f1:notes:fixture:5", expectedRevision: 3 } },
      { op: "reopenCircuit", args: { sourceId: "notes", expectedCircuitRevision: 7, reason: "fixed the producer" } }
    ]);
  });

  it("the native server and createManagementHandler answer the operator routes identically", async () => {
    for (const [operation, method, path, body] of ROUTE_CASES) {
      fake = new FakeOperator();
      const fromNative = await nativeCall(method, path, body);
      fake = new FakeOperator();
      const fromHost = await hosted("full", method, path, body);
      assert.equal(fromHost.status, fromNative.status, operation);
      assert.deepEqual(fromHost.body.ok && fromHost.body.data, fromNative.body.ok && fromNative.body.data, operation);
    }
  });

  it("validates query parameters of GET /failures", async () => {
    for (const query of [
      "?verbose=1", "?limit=abc", "?limit=0", "?limit=201", "?limit=1.5", "?limit=-1", "?limit=", "?state=closed", "?state=",
      "?sourceId=", "?cursor=", "?limit=1&limit=2", "?includeRaw=true", `?sourceId=${"s".repeat(129)}`
    ]) {
      const response = await nativeCall("GET", `/failures${query}`);
      assert.equal(response.status, 400, `${query}: ${response.text}`);
      assert.equal(code(response), "INVALID_REQUEST");
    }
    assert.equal((await nativeCall("GET", "/failures?limit=200")).status, 200);
    assert.equal((await nativeCall("GET", "/operator/status?verbose=1")).status, 400);
    assert.equal((await nativeCall("GET", `/failures/${encodeURIComponent("f1:orders:fixture:3")}?includeRaw=true`)).status, 400, "no raw flag on show");
    assert.deepEqual(fake.callsOf("listFailures"), [{ limit: 200 }]);
    assert.deepEqual(fake.callsOf("showFailure"), []);
  });

  it("decodes a URL-encoded failure ID exactly once and validates it", async () => {
    assert.equal(data(await nativeCall<IncidentDetail>("GET", "/failures/f1:orders:fixture:3")).failureId, "f1:orders:fixture:3", "unencoded colons also work");
    const twice = await nativeCall("GET", `/failures/${encodeURIComponent(encodeURIComponent("f1:orders:fixture:3"))}`);
    assert.equal(twice.status, 404, "decoded once, %253A stays %3A and names no incident");
    assert.equal(data(await hosted<IncidentDetail>("full", "GET", "/failures/f1%3Aorders%3Afixture%3A3")).revision, 4);
    assert.deepEqual(fake.callsOf("showFailure"), [
      { failureId: "f1:orders:fixture:3" }, { failureId: "f1%3Aorders%3Afixture%3A3" }, { failureId: "f1:orders:fixture:3" }
    ]);
    for (const path of ["/failures/%E0%A4%A", "/failures/f1%0Ainjected", `/failures/${"x".repeat(513)}`, "/failures/a%2Fb%00"]) {
      const response = await nativeCall("GET", path);
      assert.equal(response.status, 400, path);
    }
    assert.equal((await nativeCall("GET", "/failures/")).status, 404, "an empty ID is no route");
    assert.equal((await nativeCall("GET", "/failures/a/b")).status, 404, "one segment only");
    assert.equal(fake.callsOf("showFailure").length, 3);
  });

  it("validates failure-operation bodies with the shared operator validation", async () => {
    const cases: [string, unknown][] = [
      ["/failures/evaluate", { failureId: "f1:orders:fixture:3" }],
      ["/failures/evaluate", { failureId: "f1:orders:fixture:3", expectedRevision: "4" }],
      ["/failures/evaluate", { failureId: "f1:orders:fixture:3", expectedRevision: -1 }],
      ["/failures/evaluate", { failureId: "f1:orders:fixture:3", expectedRevision: 4, extra: true }],
      ["/failures/evaluate", [1]],
      ["/failures/redrive", { failureId: "f1:orders:fixture:7", planId: "plan-1", expectedRevision: 9 }],
      ["/sources/retry-current", { sourceId: "orders", failureId: "f1:orders:fixture:3" }],
      ["/sources/retry-current", { sourceId: "orders", failureId: "f1:orders:fixture:3", expectedRevision: 4, reason: "" }],
      ["/sources/reassess", { sourceId: "notes", failureId: "f1:notes:fixture:5", expectedRevision: 3, reason: "x" }],
      ["/sources/reopen-circuit", { sourceId: "notes", expectedCircuitRevision: 7 }],
      ["/sources/reopen-circuit", { sourceId: "notes", expectedCircuitRevision: 7, reason: "   " }],
      ["/sources/reopen-circuit", { sourceId: "notes", expectedCircuitRevision: 7, reason: "x".repeat(513) }],
      ["/failures/export", { failureId: "" }],
      ["/failures/export", { failureId: "f1:orders:fixture:3", format: "zip" }]
    ];
    for (const [path, body] of cases) {
      const response = await nativeCall("POST", path, body);
      assert.equal(response.status, 400, `${path} ${JSON.stringify(body)}: ${response.text}`);
      assert.equal(code(response), "INVALID_REQUEST");
    }
    assert.equal((await nativeCall("POST", "/failures/evaluate", "{not json")).status, 400);
    assert.deepEqual(fake.calls, [], "nothing invalid reached the operator");
    assert.equal((await hosted("full", "POST", "/sources/retry-current", ROUTE_CASES[6]![3], {})).status, 403, "the handler's CSRF header guard applies");
  });

  it("limits failure-operation bodies to 64 KiB even when the router allows more", async () => {
    const padded = { failureId: "f1:orders:fixture:3", expectedRevision: 4, padding: "x".repeat(70_000) };
    for (const response of [await nativeCall("POST", "/failures/evaluate", padded), await hosted("full", "POST", "/failures/evaluate", padded)]) {
      assert.equal(response.status, 413);
      assert.match(!response.body.ok ? response.body.error.message : "", /64 KiB/);
    }
    for (const [, method, path] of ROUTE_CASES.filter(([, method]) => method === "POST")) {
      assert.equal((await nativeCall(method, path, { padding: "x".repeat(66_000) })).status, 413, path);
    }
    // A 70 KB body under the limit of other routes is still read: config.validate answers, it is not refused for size.
    assert.equal((await nativeCall("POST", "/config/validate", { config: { padding: "x".repeat(70_000) } })).status, 200);
    assert.equal((await hosted("full", "POST", "/config/validate", { config: { padding: "x".repeat(70_000) } })).status, 200);
    assert.deepEqual(fake.calls, []);
  });

  it("F37: export refuses includeRaw and never returns raw evidence, even when the service offers it", async () => {
    for (const includeRaw of [true, false, "yes"]) {
      const response = await nativeCall("POST", "/failures/export", { failureId: "f1:orders:fixture:3", includeRaw });
      assert.equal(response.status, 400);
      assert.match(!response.body.ok ? response.body.error.message : "", /never exported/);
    }
    assert.deepEqual(fake.callsOf("exportFailure"), []);
    fake.leakRaw = true;
    for (const response of [await nativeCall<ReproductionBundle>("POST", "/failures/export", { failureId: "f1:orders:fixture:3" }),
      await hosted<ReproductionBundle>("full", "POST", "/failures/export", { failureId: "f1:orders:fixture:3" })]) {
      const bundle = data(response);
      assert.equal(Object.hasOwn(bundle, "raw"), false);
      assert.equal(bundle.evidence.included, false);
      assert.equal(bundle.incident.failureId, "f1:orders:fixture:3");
      assert.ok(!response.text.includes(RAW_MARKER) && !response.text.includes(Buffer.from(RAW_MARKER).toString("base64")) && !response.text.includes("valueBase64"));
    }
    for (const response of [await nativeCall<IncidentDetail>("GET", "/failures/f1%3Aorders%3Afixture%3A3"), await hosted("full", "GET", "/failures/f1%3Aorders%3Afixture%3A3")]) {
      assert.equal(response.status, 200);
      assert.equal(Object.hasOwn(data(response) as object, "raw"), false);
      assert.ok(!response.text.includes("valueBase64"));
    }
    for (const call of [...fake.callsOf("exportFailure"), ...fake.callsOf("showFailure")]) assert.equal(Object.hasOwn(call as object, "includeRaw"), false, "never asks for raw");
  });

  it("returns a refused OperationResult as a normal 200 response", async () => {
    const stale = await nativeCall<OperationResult>("POST", "/sources/retry-current", { sourceId: "orders", failureId: "f1:orders:fixture:3", expectedRevision: 3 });
    assert.equal(stale.status, 200);
    assert.deepEqual(data(stale), { operationId: "op-1", result: "refused", outcome: "stale-revision", incidentRevision: 4, message: "The incident is at revision 4." });
    fake.results.redrive = { operationId: "op-x", result: "refused", outcome: "plan-expired", incidentRevision: 9, message: "The plan expired." };
    const expired = await hosted<OperationResult>("full", "POST", "/failures/redrive", ROUTE_CASES[5]![3]);
    assert.equal(expired.status, 200);
    assert.equal(data(expired).outcome, "plan-expired");
  });

  it("maps operator errors through the usual error envelope", async () => {
    const missing = await nativeCall("GET", `/failures/${encodeURIComponent("f1:nope:1")}`);
    assert.equal(missing.status, 404);
    assert.equal(code(missing), "INVALID_REQUEST");
    assert.match(!missing.body.ok ? missing.body.error.message : "", /Unknown failure/);
    fake.status = async () => { throw new Error("boom: /var/secret/path"); };
    const fault = await nativeCall("GET", "/operator/status");
    assert.equal(fault.status, 500);
    assert.equal(code(fault), "INTERNAL");
    assert.ok(!fault.text.includes("/var/secret/path"));
  });
});
