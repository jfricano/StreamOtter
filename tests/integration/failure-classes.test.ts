import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { GatewayLogger, Json } from "@streamotter/contracts";
import { TransientMappingError } from "@streamotter/gateway";
import { orderRecord, startHarness, type Harness } from "./harness.ts";

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
