import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { GatewayLogger, Json } from "@streamotter/contracts";
import { silentLogger, TransientMappingError, type FailureHandlingConfig, type SourceRecoveryHandlers } from "@streamotter/gateway";
import { createGatewayRuntime, getGatewayInternals, type IncidentRecord } from "@streamotter/gateway/internals";
import { orderConfig, orderRecord, OrderApp, startHarness, type Harness } from "./harness.ts";

/**
 * ADR-15B §1: every pause carries a trusted internal failure class, separate from
 * the public error code. The expected classes below are written out by hand from
 * the ADR's table, not derived from the gateway.
 */
type Value = { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
const valid = (value: Json) => {
  const record = value as Value;
  return { tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order };
};

function capturingLogger(): { logger: GatewayLogger; pauses: Record<string, Json>[] } {
  const pauses: Record<string, Json>[] = [];
  const logger: GatewayLogger = {
    info: () => undefined,
    warn: (message, fields) => { if (message.startsWith("Source paused")) pauses.push({ ...(fields ?? {}) }); },
    error: () => undefined
  };
  return { logger, pauses };
}

const cases: { name: string; code: string; failureClass: string; map?: (value: Json) => unknown; limits?: Record<string, number> }[] = [
  { name: "a map handler that throws", code: "HANDLER_FAILED", failureClass: "mapper-error", map: () => { throw new Error("boom"); } },
  { name: "a TransientMappingError", code: "HANDLER_FAILED", failureClass: "mapper-transient", map: () => { throw new TransientMappingError("pricing service unavailable"); } },
  { name: "a map handler that times out", code: "TIMEOUT", failureClass: "mapper-timeout", map: () => new Promise(() => undefined), limits: { handlerTimeoutMs: 50 } },
  { name: "map not returning an array", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: value => valid(value) },
  { name: "too many outputs", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: value => [valid(value), valid(value)], limits: { maxMapOutputs: 1 } },
  { name: "an output that is not an object", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: () => ["nope"] },
  { name: "an unexpected output field", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: value => [{ ...valid(value), extra: true }] },
  { name: "an empty tenant", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: value => [{ ...valid(value), tenantId: "" }] },
  { name: "invalid parameters", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: value => [{ ...valid(value), params: { orderId: 7 } }] },
  { name: "a non-canonical revision", code: "INVALID_PAYLOAD", failureClass: "routing-invalid", map: value => [{ ...valid(value), revision: "02" }] },
  { name: "a payload schema violation with valid routing", code: "INVALID_PAYLOAD", failureClass: "payload-schema", map: value => [{ ...valid(value), data: { orderId: "ord_1", status: "processing", progress: 101 } }] },
  { name: "a record above maxSourceRecordBytes", code: "INVALID_PAYLOAD", failureClass: "oversize", limits: { maxSourceRecordBytes: 16 } }
];

describe("V1.1 slice A: trusted failure classes (ADR-15B §1)", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  for (const testCase of cases) {
    it(`classifies ${testCase.name} as ${testCase.failureClass} and keeps the public code ${testCase.code}`, async () => {
      const { logger, pauses } = capturingLogger();
      h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)], logger, ...(testCase.limits === undefined ? {} : { limits: testCase.limits }) });
      if (testCase.map !== undefined) h.app.mapOverride = testCase.map;
      assert.equal(await h.advance(1), 0, "the failing record is not committed");
      assert.equal(h.internals.sources()[0]?.status, "paused");
      assert.equal(h.internals.sources()[0]?.reason, testCase.code);
      assert.equal(pauses.length, 1);
      assert.equal(pauses[0]?.["failureClass"], testCase.failureClass);
      assert.equal(pauses[0]?.["code"], testCase.code);
    });
  }

  it("classifies an equal revision with different data as revision-conflict", async () => {
    const { logger, pauses } = capturingLogger();
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 1, "processing", 99)], logger });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready();
    assert.equal(await h.advance(1), 0);
    assert.equal(pauses[0]?.["failureClass"], "revision-conflict");
    assert.equal(pauses[0]?.["code"], "REVISION_CONFLICT");
  });

  it("recognizes TransientMappingError by brand, not by message text", async () => {
    const { logger, pauses } = capturingLogger();
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)], logger });
    h.app.mapOverride = () => {
      const lookalike = new Error("transient");
      lookalike.name = "TransientMappingError";
      throw lookalike;
    };
    assert.equal(await h.advance(1), 0);
    assert.equal(pauses[0]?.["failureClass"], "mapper-error");
  });
});

/**
 * INV-03 and ADR-15B §1: a quarantine-eligible problem must never mask an
 * integrity or mapper problem in the same record. With failure handling
 * configured, the gateway keeps evaluating every output, every channel and the
 * conflict check after a payload-schema problem and classifies the record by
 * the most severe class found.
 */
describe("V1.1: a record with several problems is classified by the most severe one", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  const RESYNC: FailureHandlingConfig = { sources: { orders: { invalidPublicPayload: "quarantine-resync" } } };
  const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "multi-defect" }) };
  const schemaFailure = (value: Json) => ({ ...valid(value), data: { ...(value as Value).order, progress: 999 } });

  async function incidents(harness: Harness): Promise<IncidentRecord[]> {
    await harness.internals.failuresSettled();
    return [...harness.internals.incidentStore()!.list({ state: "all" }).items];
  }

  it("a routing-invalid output after a payload-schema output holds the record instead of advancing past it", async () => {
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [orderRecord("acme", "ord_1", 3, "processing", 30)] });
    h.app.mapOverride = value => [schemaFailure(value), { ...valid(value), tenantId: "", revision: "not-a-revision" }];
    assert.equal(await h.advance(1), 0);
    const [incident] = await incidents(h);
    assert.equal(incident?.failureClass, "routing-invalid");
    assert.equal(incident?.errorCode, "INVALID_PAYLOAD");
    assert.equal(incident?.progress, "held", "an integrity failure is never advanced past");
    assert.equal(incident?.recovery, "not-applicable");
    assert.equal(h.internals.sources()[0]?.status, "paused");
  });

  it("a later channel's mapper still runs, and its exception outranks an earlier payload-schema output", async () => {
    const base = orderConfig();
    const config = {
      ...base,
      channels: { ...base.channels, audit: { ...base.channels.orderStatus, handlersRef: "audit" } },
      failureHandling: RESYNC
    };
    const app = new OrderApp();
    app.mapOverride = value => [schemaFailure(value)];
    const handlers = app.handlers() as unknown as { channels: Record<string, Record<string, unknown>>; sources?: unknown };
    let auditCalls = 0;
    handlers.channels["audit"] = { ...handlers.channels["orderStatus"], map: () => { auditCalls++; throw new Error("audit mapper bug"); } };
    handlers.sources = { orders: recoverable };
    const { gateway } = createGatewayRuntime({
      config, handlers, mode: "development", logger: silentLogger,
      development: { principals: {}, fixtures: { orders: [orderRecord("acme", "ord_1", 3, "processing", 30)] } }
    } as never);
    await gateway.start();
    try {
      const internals = getGatewayInternals(gateway);
      assert.equal(await internals.advanceFixture("orders", 1), 0);
      await internals.failuresSettled();
      const [incident] = [...internals.incidentStore()!.list({ state: "all" }).items];
      assert.equal(auditCalls, 1, "the second channel's mapper was evaluated");
      assert.equal(incident?.failureClass, "mapper-error");
      assert.equal(incident?.errorCode, "HANDLER_FAILED");
      assert.equal(incident?.channel, "audit");
      assert.equal(incident?.progress, "held");
    } finally {
      await gateway.stop({ timeoutMs: 2_000 });
    }
  });

  it("a revision conflict outranks an earlier payload-schema output", async () => {
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [orderRecord("acme", "ord_1", 1, "processing", 99)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready();
    h.app.mapOverride = value => [schemaFailure(value), valid(value)];
    assert.equal(await h.advance(1), 0);
    const [incident] = await incidents(h);
    assert.equal(incident?.failureClass, "revision-conflict");
    assert.equal(incident?.errorCode, "REVISION_CONFLICT");
    assert.equal(incident?.progress, "held");
  });

  it("checks the data frame size before the payload schema", async () => {
    const { logger, pauses } = capturingLogger();
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)], logger, limits: { maxDataFrameBytes: 1_024 } });
    // The status fails the schema's enum and makes the frame larger than the limit.
    h.app.mapOverride = value => [{ ...valid(value), data: { ...(value as Value).order, status: "x".repeat(2_000) } }];
    assert.equal(await h.advance(1), 0);
    assert.equal(pauses[0]?.["failureClass"], "routing-invalid");
    assert.equal(pauses[0]?.["code"], "INVALID_PAYLOAD");
  });

  it("without failureHandling keeps V1: the first problem is reported and later mappers are not run", async () => {
    const { logger, pauses } = capturingLogger();
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 3, "processing", 30)], logger });
    let calls = 0;
    h.app.mapOverride = value => { calls++; return [schemaFailure(value), { ...valid(value), tenantId: "" }]; };
    assert.equal(await h.advance(1), 0);
    assert.equal(calls, 1);
    assert.equal(h.internals.sources()[0]?.reason, "INVALID_PAYLOAD");
    assert.equal(pauses.length, 1);
    assert.equal(pauses[0]?.["failureClass"], "payload-schema");
    assert.match(String(pauses[0]?.["reason"]), /^output 0: data /);
  });
});

/** IncidentDetail.diagnosis is sanitized and never carries payload text (V1_1_API.md §5.2). */
describe("V1.1: incident diagnoses never quote payload text", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
  const SECRET = "SSN=078-05-1120";

  it("names a mapper error without its message, in the incident and the log line alike", async () => {
    const { logger, pauses } = capturingLogger();
    h = await startHarness({ failureHandling: HOLD, logger, fixtures: [{ key: "k", value: { tenantId: "acme", revision: "1", embedded: SECRET } }] });
    h.app.mapOverride = value => { JSON.parse((value as { embedded: string }).embedded); return []; };
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    const [incident] = [...h.internals.incidentStore()!.list({ state: "all" }).items];
    assert.equal(incident?.failureClass, "mapper-error");
    assert.equal(incident?.diagnosis, "map handler threw SyntaxError");
    assert.equal(pauses[0]?.["reason"], "map handler threw SyntaxError");
    assert.ok(!JSON.stringify(pauses[0]).includes("078-05"), JSON.stringify(pauses[0]));
  });

  it("keeps an error code but never a payload-derived property name", async () => {
    h = await startHarness({ failureHandling: HOLD, fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.mapOverride = value => [{ ...valid(value), data: { ...(value as Value).order, [SECRET]: true } }];
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    const [incident] = [...h.internals.incidentStore()!.list({ state: "all" }).items];
    assert.equal(incident?.failureClass, "payload-schema");
    assert.ok(!incident!.diagnosis.includes("078-05"), incident!.diagnosis);
    await h.close();

    h = await startHarness({ failureHandling: HOLD, fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.mapOverride = () => { throw Object.assign(new Error(`lookup failed for ${SECRET}`), { code: "ELOOKUP" }); };
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    const [thrown] = [...h.internals.incidentStore()!.list({ state: "all" }).items];
    assert.equal(thrown?.diagnosis, "map handler threw Error (code ELOOKUP)");
  });
});

/**
 * The "Source paused" log line is metadata only (V1_1_SOURCE_FAILURE_SPEC.md §5.3):
 * its reason is the same sanitized diagnosis an incident gets, with or without
 * failureHandling, and never quotes record data.
 */
describe("the Source paused log line never quotes record data", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  const SECRET = "SSN=078-05-1120";
  const cases: { name: string; map: (value: Json) => unknown; reason: string }[] = [
    { name: "a JSON.parse error quoting its input", map: () => { JSON.parse(SECRET); return []; }, reason: "map handler threw SyntaxError" },
    { name: "an error message with a code", map: () => { throw Object.assign(new Error(`lookup failed for ${SECRET}`), { code: "ELOOKUP" }); }, reason: "map handler threw Error (code ELOOKUP)" },
    { name: "a TransientMappingError message", map: () => { throw new TransientMappingError(`pricing failed for ${SECRET}`); }, reason: "map handler threw TransientMappingError" },
    { name: "a thrown non-Error", map: () => { throw SECRET; }, reason: "map handler threw a non-Error string" },
    { name: "an unexpected output field named by the record", map: value => [{ ...valid(value), [SECRET]: true }], reason: "output 0: unexpected field" },
    { name: "a params property the schema doesn't allow", map: value => [{ ...valid(value), params: { orderId: "ord_1", [SECRET]: "x" } }], reason: "output 0: params: a property is not allowed by the schema" },
    { name: "a data property the schema doesn't allow", map: value => [{ ...valid(value), data: { ...(value as Value).order, [SECRET]: true } }], reason: "output 0: data: a property is not allowed by the schema" }
  ];

  for (const withFailureHandling of [false, true]) {
    for (const testCase of cases) {
      it(`logs ${testCase.name} by its diagnosis only${withFailureHandling ? " (with failureHandling)" : ""}`, async () => {
        const { logger, pauses } = capturingLogger();
        h = await startHarness({
          fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)],
          logger,
          ...(withFailureHandling ? { failureHandling: { sources: { orders: { invalidPublicPayload: "quarantine-hold" } } } } : {})
        });
        h.app.mapOverride = testCase.map;
        assert.equal(await h.advance(1), 0);
        assert.equal(pauses.length, 1);
        assert.equal(pauses[0]?.["reason"], testCase.reason);
        assert.ok(!JSON.stringify(pauses[0]).includes("078-05"), JSON.stringify(pauses[0]));
        assert.deepEqual(Object.keys(pauses[0]!).sort(), ["channel", "code", "failureClass", "position", "reason", "sourceId"]);
        if (withFailureHandling) {
          await h.internals.failuresSettled();
          const [incident] = [...h.internals.incidentStore()!.list({ state: "all" }).items];
          assert.equal(incident?.diagnosis, testCase.reason, "the log line and the incident share one diagnosis");
        }
      });
    }
  }
});
