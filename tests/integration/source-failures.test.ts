import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Json } from "@streamotter/contracts";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { getGatewayInternals } from "@streamotter/gateway/internals";
import { createClient } from "@streamotter/client";
import { observe, orderRecord, sleep, startHarness, waitFor, type Harness } from "./harness.ts";

type Value = { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
const toState = (value: Json) => {
  const record = value as Value;
  return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
};

describe("acceptance 6 (fixture): unprocessable records pause without skipping", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("pauses on a handler failure, rejects further advancement, and retries the same record on resume", async () => {
    const fixtures = [2, 3, 4].map(revision => orderRecord("acme", "ord_1", revision, "processing", revision * 10));
    h = await startHarness({ fixtures });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const seenRecords: string[] = [];
    let broken = true;
    h.app.mapOverride = value => {
      if (broken && (value as Value).revision === "3") throw new Error("cannot decode");
      return toState(value);
    };
    const originalMap = h.app.mapOverride;
    h.app.mapOverride = value => {
      seenRecords.push((value as Value).revision);
      return originalMap(value);
    };
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    assert.equal(await h.advance(3), 1, "only the record before the poison record commits");
    assert.deepEqual(h.internals.sources(), [{ sourceId: "orders", kind: "fixture", status: "paused", reason: "HANDLER_FAILED" }]);
    await waitFor(() => sub.state === "stale");
    await assert.rejects(h.advance(1), { code: "SOURCE_UNAVAILABLE", details: { status: 409 } });
    const failures = h.internals.traces({ limit: 500, outcome: "failed" }).items;
    assert.equal(failures.at(-1)?.stage, "map");
    assert.equal(failures.at(-1)?.errorCode, "HANDLER_FAILED");

    broken = false; // The operator deploys a fix, then resumes.
    h.app.put("acme", "alice", "ord_1", 3, "processing", 30);
    await h.gateway.resumeSource("orders");
    assert.equal(h.internals.sources()[0]?.status, "healthy");
    assert.deepEqual(seenRecords, ["2", "3", "3"], "resume retried the same record, not the next one");
    await sub.ready();
    assert.equal(await h.advance(1), 1);
    await waitFor(() => seen.events.at(-1)?.revision === "4");
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:1", "update:2", "snapshot:3", "update:4"]);
  });

  it("validates every output of a record before admitting any of them", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.mapOverride = value => {
      const [valid] = toState(value);
      return [valid, { ...valid!, params: { orderId: "ord_2" }, data: { orderId: "ord_2", status: "processing", progress: 101 } }];
    };
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    assert.equal(await h.advance(1), 0);
    assert.equal(h.internals.sources()[0]?.reason, "INVALID_PAYLOAD");
    await sleep(50);
    assert.deepEqual(seen.events.map(event => event.revision), ["1"], "the valid output was not admitted either");
  });

  it("pauses on a revision conflict against current state", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 1, "processing", 99)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready();
    assert.equal(await h.advance(1), 0);
    assert.equal(h.internals.sources()[0]?.reason, "REVISION_CONFLICT");
    await waitFor(() => sub.state === "stale");
  });

  for (const [label, override, limits, reason] of [
    ["a non-array map result", () => ({ not: "an array" }), {}, "INVALID_PAYLOAD"],
    ["a malformed revision", (value: Json) => [{ ...toState(value)[0]!, revision: "01" }], {}, "INVALID_PAYLOAD"],
    ["an empty tenant", (value: Json) => [{ ...toState(value)[0]!, tenantId: "" }], {}, "INVALID_PAYLOAD"],
    ["an unexpected output field", (value: Json) => [{ ...toState(value)[0]!, principal: "admin" }], {}, "INVALID_PAYLOAD"],
    ["too many outputs", (value: Json) => [...toState(value), ...toState(value), ...toState(value)], { maxMapOutputs: 2 }, "INVALID_PAYLOAD"],
    ["a map timeout", () => new Promise(() => undefined), { handlerTimeoutMs: 100 }, "TIMEOUT"],
    ["an oversized record", toState, { maxSourceRecordBytes: 20 }, "INVALID_PAYLOAD"]
  ] as const) {
    it(`pauses on ${label}`, async () => {
      h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)], limits });
      h.app.mapOverride = override as (value: Json) => unknown;
      assert.equal(await h.advance(1), 0);
      assert.deepEqual(h.internals.sources()[0], { sourceId: "orders", kind: "fixture", status: "paused", reason });
    });
  }

  it("commits records that map to no outputs and records them as filtered", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20), orderRecord("acme", "ord_1", 3, "processing", 30)] });
    h.app.mapOverride = () => [];
    assert.equal(await h.advance(2), 2);
    const traces = h.internals.traces({ limit: 100 }).items;
    assert.equal(traces.filter(trace => trace.stage === "map" && trace.outcome === "filtered").length, 2);
    assert.equal(traces.filter(trace => trace.stage === "commit").length, 2);
    assert.equal(h.internals.sources()[0]?.status, "healthy");
  });

  it("rejects mapped updates and snapshots whose data frame exceeds maxDataFrameBytes", async () => {
    const long = "x".repeat(1_500);
    const gateway = createGateway({
      config: {
        configVersion: 1, projectId: "notes",
        gateway: { host: "127.0.0.1", port: 0, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:3000"] },
        connections: {},
        sources: { notes: { kind: "fixture", generation: "f1", fixtureRef: "notes" } },
        schemas: {
          NoteParams: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
          Note: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", maxLength: 4_000 } } }
        },
        channels: { note: { version: 1, source: "notes", paramsSchema: "NoteParams", payloadSchema: "Note", handlersRef: "note", delivery: { kind: "state", overflow: "resync" } } },
        limits: { maxDataFrameBytes: 1_024 }
      },
      handlers: {
        authenticate: () => ({ subject: "a", tenantId: "t", sessionId: "s", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} }),
        channels: {
          note: {
            authorize: () => true,
            map: ({ record }) => [{ tenantId: "t", params: { id: "n1" }, revision: "2", data: { text: (record.value as { text: string }).text } }],
            snapshot: ({ params }) => ({ revision: "1", data: { text: params.id === "big" ? long : "short" } })
          }
        }
      },
      mode: "development",
      development: { principals: {}, fixtures: { notes: [{ key: null, value: { text: long } }] } },
      logger: silentLogger
    });
    const { origin } = await gateway.start();
    const client = createClient<Record<string, { params: { id: string }; data: Json; version: 1 }>>({ origin, getToken: () => "t" });
    try {
      await assert.rejects(client.subscribe("note", { channelVersion: 1, params: { id: "big" } }).ready(), { code: "INVALID_PAYLOAD" });
      assert.equal(await getGatewayInternals(gateway).advanceFixture("notes", 1), 0);
      assert.deepEqual(getGatewayInternals(gateway).sources()[0], { sourceId: "notes", kind: "fixture", status: "paused", reason: "INVALID_PAYLOAD" });
    } finally {
      await client.close();
      await gateway.stop();
    }
  });

  it("keeps payloads and credentials out of operator traces", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_secret_7731", 2, "processing", 42)] });
    h.app.put("acme", "alice", "ord_secret_7731", 1, "queued", 0);
    const sub = h.client("alice@acme#tok9981").subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_secret_7731" } });
    await sub.ready();
    await h.advance(1);
    await sleep(50);
    const traces = JSON.stringify(h.internals.traces({ limit: 500 }).items);
    assert.ok(traces.includes("\"stage\":\"receipt\""));
    for (const secret of ["ord_secret_7731", "tok9981", "alice", "acme", "processing"]) {
      assert.ok(!traces.includes(secret), `trace output must not include ${secret}`);
    }
  });
});
