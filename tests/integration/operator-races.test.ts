import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, FixtureRecord, IncidentSummary, Json, OperatorApi, SourceRecoveryHandlers } from "@streamotter/gateway";
import type { IncidentRecord, IncidentStore } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { observe, orderRecord, OrderApp, startHarness, waitFor, type Harness } from "./harness.ts";

/**
 * Operator mutations that race each other or the failure service's own
 * disposition of the same source (ADR-15C §§5–6, spec §8.3). Each test makes the
 * race happen deterministically; the expected outcomes come from the spec.
 */

const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
const RESYNC = { sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync", replaySafeMapping: true } } } as FailureHandlingConfig;
/** Valid JSON whose mapped status is outside the channel's payload schema: a payload-schema failure. */
const shipped = (revision: number): FixtureRecord => orderRecord("acme", "ord_1", revision, "shipped" as "done", 100);
const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "test" }) };
const repairedMap = (value: Json) => {
  const record = value as { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
  return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: { ...record.order, status: "done" } }];
};

async function only(h: Harness, op: OperatorApi): Promise<IncidentSummary> {
  await h.internals.failuresSettled();
  const page = await op.listFailures({ state: "all" });
  assert.equal(page.items.length, 1, "exactly one incident");
  return page.items[0]!;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

/** A second open incident on the source, written straight to the journal, as a restart or an earlier record would leave it. */
function otherIncident(store: IncidentStore, like: IncidentRecord): IncidentRecord {
  const { revision: _r, firstObservedAt: _f, lastObservedAt: _l, observations: _o, quarantine: _q, quarantineCoordinates: _c, progress: _p,
    recovery: _v, state: _s, resolution: _x, updatedAt: _u, guard: _g, boundaryId: _b, ...fields } = like;
  return store.observe({ ...fields, failureId: `${like.failureId}-other`, position: { kind: "fixture", index: "7" }, observedAt: new Date().toISOString() }).record;
}

describe("operator races (fixture tier)", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("O5: a redrive of an unknown incident is refused as not-found", async () => {
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    const op = getGatewayOperator(h.gateway);
    const result = await op.redrive({ failureId: "f1:does-not-exist", planId: "pl1:x", planFingerprint: "sha256:x", expectedRevision: 0, operationId: "op-missing" });
    assert.equal(result.result, "refused");
    assert.equal(result.outcome, "not-found");
    assert.equal(result.operationId, "op-missing");
  });
});
