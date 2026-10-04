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

  it("O1: one plan redrives once even when two redrives of it run concurrently, and a second plan of the same incident is spent too", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const op = getGatewayOperator(h.gateway);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    await h.advance(1);
    const advanced = await only(h, op);
    assert.equal(advanced.progress, "advanced");
    app.mapOverride = repairedMap;
    const first = (await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision })).plan!;
    const second = (await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision })).plan!;
    let mapCalls = 0;
    app.mapOverride = value => { mapCalls++; return repairedMap(value); };
    const request = (plan: typeof first, operationId: string) =>
      op.redrive({ failureId: advanced.failureId, planId: plan.planId, planFingerprint: plan.fingerprint, expectedRevision: advanced.revision, operationId });

    const results = await Promise.all([request(first, "op-a"), request(first, "op-b"), request(second, "op-c")]);
    assert.deepEqual(results.map(result => result.outcome), ["reprocessed", "plan-unknown", "plan-unknown"], JSON.stringify(results));
    assert.equal(mapCalls, 1, "the record is mapped once");
    const history = (await op.showFailure({ failureId: advanced.failureId })).history.filter(event => event.event === "operator");
    assert.deepEqual(history.map(event => event.operationId), ["op-a"], "one operator event");
  });

  it("O5: a redrive of an unknown incident is refused as not-found", async () => {
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    const op = getGatewayOperator(h.gateway);
    const result = await op.redrive({ failureId: "f1:does-not-exist", planId: "pl1:x", planFingerprint: "sha256:x", expectedRevision: 0, operationId: "op-missing" });
    assert.equal(result.result, "refused");
    assert.equal(result.outcome, "not-found");
    assert.equal(result.operationId, "op-missing");
  });

  it("O2: a retry sent while the quarantine copy is being written waits for that disposition and is then refused as stale", async () => {
    const app = new OrderApp();
    const port = await freePort();
    h = await startHarness({ app, failureHandling: HOLD, fixtures: [shipped(3)], health: { port } });
    const op = getGatewayOperator(h.gateway);
    const store = h.internals.incidentStore()! as IncidentStore;
    const update = store.update.bind(store);
    let retry: Promise<Awaited<ReturnType<OperatorApi["retryCurrent"]>>> | null = null;
    // The operator acts in the quarantine-write window: right after "captured", before "quarantined".
    store.update = (failureId, revision, patch, event) => {
      const updated = update(failureId, revision, patch, event);
      if (event.event === "captured" && retry === null) {
        app.mapOverride = repairedMap;
        retry = op.retryCurrent({ sourceId: "orders", failureId, expectedRevision: updated.revision, reason: "mapping fixed" });
      }
      return updated;
    };
    await h.advance(1);
    const result = await retry!;
    assert.equal(result.result, "refused", result.message);
    assert.equal(result.outcome, "stale-revision");
    const incident = await op.showFailure({ failureId: (await only(h, op)).failureId });
    assert.equal(incident.quarantine, "acknowledged");
    assert.equal(incident.progress, "held");
    assert.equal(incident.revision, result.incidentRevision);
    assert.deepEqual(incident.history.map(event => event.event), ["detected", "captured", "quarantined"]);
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    const body = await ready.text();
    assert.ok(!body.includes("journal"), body);

    const retried = await op.retryCurrent({ sourceId: "orders", failureId: incident.failureId, expectedRevision: incident.revision, reason: "mapping fixed" });
    assert.equal(retried.outcome, "retried", retried.message);
  });

  it("O6: evaluate and redrive are blocked while another incident on the source has an evidence conflict or an uncertain advance", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const advanced = await only(h, op);
    app.mapOverride = repairedMap;
    const plan = (await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision })).plan!;
    assert.ok(plan !== null);
    const store = h.internals.incidentStore()! as IncidentStore;

    const conflict = otherIncident(store, store.get(advanced.failureId)!);
    const marked = store.update(conflict.failureId, conflict.revision, {}, { event: "held", detail: "evidence-conflict", operationId: null });
    const evaluation = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.ineligibleReason, "integrity-fault-open");
    const redrive = await op.redrive({ failureId: advanced.failureId, planId: plan.planId, planFingerprint: plan.fingerprint, expectedRevision: advanced.revision });
    assert.equal(redrive.outcome, "integrity-fault-open", redrive.message);

    store.update(marked.failureId, marked.revision, { state: "resolved", progress: "processed", resolution: "test" }, { event: "resolved", detail: "test", operationId: null });
    const uncertain = otherIncident(store, { ...store.get(advanced.failureId)!, failureId: `${advanced.failureId}-2` });
    store.update(uncertain.failureId, uncertain.revision, { progress: "uncertain" }, { event: "held", detail: "the advance could not be confirmed", operationId: null });
    const again = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.equal(again.ineligibleReason, "integrity-fault-open");
  });

  it("O7: a retry the gateway refuses records no operator event and leaves the incident's revision as it was", async () => {
    h = await startHarness({ failureHandling: HOLD, fixtures: [shipped(3)] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const held = await only(h, op);
    const store = h.internals.incidentStore()! as IncidentStore;
    const other = otherIncident(store, store.get(held.failureId)!);
    store.update(other.failureId, other.revision, { progress: "uncertain" }, { event: "held", detail: "the advance could not be confirmed", operationId: null });

    const result = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: held.revision });
    assert.equal(result.result, "refused");
    assert.equal(result.outcome, "advance-unresolved");
    assert.equal(result.incidentRevision, held.revision);
    const after = await op.showFailure({ failureId: held.failureId });
    assert.equal(after.revision, held.revision, "the console's revision still holds");
    assert.ok(!after.history.some(event => event.event === "operator"), "no event for an action that did not happen");
  });
});
