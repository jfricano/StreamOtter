import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";
import type { FailureHandlingConfig, FixtureRecord, Json, OperatorApi, SourceRecoveryHandlers } from "@streamotter/gateway";
import { initJournal, nodeSupportsJournal, type IncidentStore } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { deferred, observe, orderRecord, OrderApp, startHarness, waitFor, type Harness } from "./harness.ts";

/**
 * V1.1 slice D at the fixture tier: the operator service (ADR-15C), retry,
 * reassessment, the circuit, operator retirement, and evaluate/redrive. The
 * expected outcomes come from the spec and the ADRs; guards are test doubles.
 */

const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
const resync = (extra: Record<string, unknown> = {}): FailureHandlingConfig =>
  ({ sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync", replaySafeMapping: true, ...extra } } }) as FailureHandlingConfig;
const badJson = (key = "ord_1"): FixtureRecord => ({ key, raw: "{not json" });
/** Valid JSON whose mapped status is outside the channel's payload schema: a payload-schema failure. */
const shipped = (revision: number): FixtureRecord => orderRecord("acme", "ord_1", revision, "shipped" as "done", 100);
const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "test" }) };

/** A guard whose answer the test controls. */
function switchableGuard(initial: "hold" | "recoverable"): { guard: SourceRecoveryHandlers; set(answer: "hold" | "recoverable"): void } {
  let answer = initial;
  return {
    guard: { recover: () => answer === "hold" ? { decision: "hold", reason: "watermark not reached" } : { decision: "recoverable", context: { watermark: 9 }, evidenceRef: "outbox:9" } },
    set(next) { answer = next; }
  };
}

/** Maps the invalid "shipped" status to "done", as a repaired mapping would. */
const repairedMap = (value: Json) => {
  const record = value as { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
  return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: { ...record.order, status: record.order.status === "shipped" ? "done" : record.order.status } }];
};

async function only(h: Harness, op: OperatorApi) {
  await h.internals.failuresSettled();
  const page = await op.listFailures({ state: "all" });
  assert.equal(page.items.length, 1, "exactly one incident");
  return page.items[0]!;
}

describe("V1.1 slice D: operator service (fixture tier)", () => {
  let h: Harness | undefined;
  afterEach(async () => { mock.timers.reset(); await h?.close(); h = undefined; });

  it("status, list and show describe a held incident without payload text", async () => {
    h = await startHarness({ failureHandling: HOLD, fixtures: [{ key: "ord_1", raw: "{\"x\": \"<script>alert(1)</script>\"" }] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const summary = await only(h, op);
    assert.equal(summary.failureClass, "invalid-json");
    assert.equal(summary.impact, "source-wide");
    assert.equal(summary.quarantine, "acknowledged");
    assert.equal(summary.progress, "held");
    assert.equal(summary.state, "open");
    assert.equal(summary.nextAction, "repair-and-retry");

    const status = await op.status();
    assert.equal(status.store.kind, "memory");
    assert.equal(status.store.durable, false);
    assert.equal(status.quarantine, null);
    const [source] = status.sources;
    assert.equal(source?.status, "paused");
    assert.deepEqual(source?.heldIncident, { failureId: summary.failureId, revision: summary.revision });
    assert.equal(source?.circuit.state, "closed");

    const detail = await op.showFailure({ failureId: summary.failureId });
    assert.equal(detail.raw, undefined, "raw bytes only on request");
    assert.match(detail.explanation.evidence, /Local fixture evidence, not Kafka/);
    assert.match(detail.explanation.disposition, /held at fixture record 0/);
    assert.ok(!JSON.stringify(detail).includes("script"), "no payload text in metadata (F39)");
    assert.deepEqual(detail.history.map(event => event.event), ["detected", "captured", "quarantined"]);

    const withRaw = await op.showFailure({ failureId: summary.failureId, includeRaw: true });
    assert.equal(withRaw.raw?.complete, true);
    assert.equal(Buffer.from(withRaw.raw?.valueBase64 ?? "", "base64").toString(), "{\"x\": \"<script>alert(1)</script>\"");

    const bundle = await op.exportFailure({ failureId: summary.failureId });
    assert.equal(bundle.bundleVersion, 1);
    assert.equal(bundle.raw, undefined);
    assert.equal(bundle.evidence.included, false);
    assert.ok(bundle.traces.length > 0);
    assert.ok(!JSON.stringify(bundle).includes("script"), "the default bundle carries no payload (F40)");
    const rawBundle = await op.exportFailure({ failureId: summary.failureId, includeRaw: true });
    assert.equal(rawBundle.evidence.included, true);
    assert.ok(rawBundle.raw?.valueBase64);

    await assert.rejects(op.showFailure({ failureId: "f1:nope" }), (error: { code: string }) => error.code === "INVALID_REQUEST");
  });

  it("F19: retry-current after a repair processes the exact held record; nothing is skipped or published", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: HOLD, fixtures: [shipped(3), orderRecord("acme", "ord_1", 4, "done", 100)] });
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const op = getGatewayOperator(h.gateway);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    assert.equal(await h.advance(1), 0);
    const held = await only(h, op);
    assert.equal(held.failureClass, "payload-schema");

    const stale = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: held.revision - 1 });
    assert.equal(stale.result, "refused");
    assert.equal(stale.outcome, "stale-revision");
    const missing = await op.retryCurrent({ sourceId: "orders", failureId: "f1:none", expectedRevision: 0 });
    assert.equal(missing.outcome, "not-found");

    const failedAgain = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: held.revision, reason: "before the fix" });
    assert.equal(failedAgain.result, "completed");
    assert.equal(failedAgain.outcome, "held");

    app.mapOverride = repairedMap;
    const current = await only(h, op);
    const retried = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: current.revision, reason: "mapping fixed" });
    assert.equal(retried.result, "completed", retried.message);
    assert.equal(retried.outcome, "retried");
    assert.match(retried.operationId, /^op1:[0-9a-f]{32}$/);
    const resolved = await op.showFailure({ failureId: held.failureId });
    assert.equal(resolved.state, "resolved");
    assert.equal(resolved.progress, "processed");
    assert.ok(resolved.history.some(event => event.event === "operator" && event.operationId === failedAgain.operationId));
    // Subscribers resynchronize from the authoritative snapshot after the hold; the record itself was processed, not skipped.
    await waitFor(() => seen.states.at(-1) === "live", 5_000, "live again after the retry");
    assert.equal(await h.advance(1), 1, "later records flow");
    await waitFor(() => seen.events.some(event => event.revision === "4"), 5_000, "the next record");
    const again = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: resolved.revision });
    assert.equal(again.outcome, "not-held");
  });

  it("reassess runs the guard again after a hold, and refuses integrity classes and non-resync policies", async () => {
    const control = switchableGuard("hold");
    h = await startHarness({ failureHandling: resync(), recovery: { orders: control.guard }, fixtures: [badJson(), orderRecord("acme", "ord_1", 4, "done", 100)] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const denied = await only(h, op);
    assert.equal(denied.recovery, "denied");
    assert.equal(denied.nextAction, "reassess");

    control.set("recoverable");
    const result = await op.reassess({ sourceId: "orders", failureId: denied.failureId, expectedRevision: denied.revision });
    assert.equal(result.result, "completed", result.message);
    assert.equal(result.outcome, "advanced");
    const advanced = await op.showFailure({ failureId: denied.failureId });
    assert.equal(advanced.progress, "advanced");
    assert.equal(advanced.boundary?.state, "in-force");
    assert.equal(advanced.nextAction, "evaluate");
    const after = await op.reassess({ sourceId: "orders", failureId: denied.failureId, expectedRevision: advanced.revision });
    assert.equal(after.outcome, "not-held");
  });

  it("reassess refuses an integrity failure and a quarantine-hold incident", async () => {
    const app = new OrderApp();
    app.mapOverride = () => { throw new Error("mapper bug"); };
    h = await startHarness({ app, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [orderRecord("acme", "ord_1", 3, "done", 100)] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const mapperError = await only(h, op);
    assert.equal(mapperError.failureClass, "mapper-error");
    assert.equal(mapperError.nextAction, "repair-and-retry");
    const refusedIntegrity = await op.reassess({ sourceId: "orders", failureId: mapperError.failureId, expectedRevision: mapperError.revision });
    assert.equal(refusedIntegrity.outcome, "integrity-class");
    await h.close();

    h = await startHarness({ failureHandling: HOLD, fixtures: [badJson()] });
    const holdOp = getGatewayOperator(h.gateway);
    await h.advance(1);
    const held = await only(h, holdOp);
    const refusedPolicy = await holdOp.reassess({ sourceId: "orders", failureId: held.failureId, expectedRevision: held.revision });
    assert.equal(refusedPolicy.outcome, "policy-not-resync");
  });

  it("reopen-circuit needs the circuit's revision, closes it, and approves nothing by itself", async () => {
    h = await startHarness({
      failureHandling: resync({ automaticAdvanceLimit: { incidents: 1, windowMs: 60_000 } }),
      recovery: { orders: recoverable },
      fixtures: [badJson("ord_1"), badJson("ord_2")]
    });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    await h.internals.failuresSettled();
    await h.advance(1);
    await h.internals.failuresSettled();
    const status = await op.status();
    const circuit = status.sources[0]!.circuit;
    assert.equal(circuit.state, "open");
    const [second] = (await op.listFailures({ state: "open" })).items;
    assert.equal(second?.nextAction, "reopen-circuit");
    assert.equal((await op.reassess({ sourceId: "orders", failureId: second!.failureId, expectedRevision: second!.revision })).outcome, "circuit-open");
    assert.equal((await op.retryCurrent({ sourceId: "orders", failureId: second!.failureId, expectedRevision: second!.revision })).outcome, "circuit-open");
    await assert.rejects(h.internals.resumeSource("orders"), (error: { details?: { reason?: string } }) => error.details?.reason === "circuit-open",
      "the legacy resume respects the circuit too (ADR-15C §6)");

    const stale = await op.reopenCircuit({ sourceId: "orders", expectedCircuitRevision: circuit.revision + 1, reason: "fixed" });
    assert.equal(stale.outcome, "stale-revision");
    const reopened = await op.reopenCircuit({ sourceId: "orders", expectedCircuitRevision: circuit.revision, reason: "publisher fixed" });
    assert.equal(reopened.outcome, "circuit-reopened");
    assert.equal((await op.listFailures({ state: "open" })).items[0]?.progress, "held", "still held until reassessed");
    const again = await op.reopenCircuit({ sourceId: "orders", expectedCircuitRevision: circuit.revision + 1, reason: "again" });
    assert.equal(again.outcome, "circuit-closed");

    const current = (await op.listFailures({ state: "open" })).items[0]!;
    const reassessed = await op.reassess({ sourceId: "orders", failureId: current.failureId, expectedRevision: current.revision });
    assert.equal(reassessed.outcome, "advanced", reassessed.message);
  });

  it("retire-boundary works only in operator mode, and then snapshots stop acknowledging", async () => {
    h = await startHarness({ failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [badJson()] });
    let op = getGatewayOperator(h.gateway);
    await h.advance(1);
    await h.internals.failuresSettled();
    let boundary = (await op.status()).sources[0]!.boundary!;
    const refusedMode = await op.retireBoundary({ sourceId: "orders", boundaryId: boundary.boundaryId, expectedRevision: boundary.revision, reason: "checked" });
    assert.equal(refusedMode.outcome, "retirement-mode");
    await h.close();

    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: resync({ boundaryRetirement: "operator" }), recovery: { orders: recoverable }, fixtures: [badJson()] });
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    op = getGatewayOperator(h.gateway);
    await h.advance(1);
    await h.internals.failuresSettled();
    boundary = (await op.status()).sources[0]!.boundary!;
    const stale = await op.retireBoundary({ sourceId: "orders", boundaryId: boundary.boundaryId, expectedRevision: boundary.revision + 1, reason: "checked" });
    assert.equal(stale.outcome, "stale-revision");
    const retired = await op.retireBoundary({ sourceId: "orders", boundaryId: boundary.boundaryId, expectedRevision: boundary.revision, reason: "verified the order store by hand" });
    assert.equal(retired.outcome, "boundary-retired", retired.message);
    assert.equal((await op.status()).sources[0]!.boundary, null);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    assert.equal(app.recoveryInputs.at(-1), null, "no acknowledgment is asked for after retirement");
    const store = h.internals.incidentStore() as IncidentStore;
    assert.equal(store.getBoundary(boundary.boundaryId)?.retirement?.operationId, retired.operationId);
  });

  it("retire-boundary is refused while the boundary's own advance is unresolved (ADR-15B §4)", async () => {
    h = await startHarness({
      failureHandling: resync({ boundaryRetirement: "operator" }), recovery: { orders: recoverable }, fixtures: [badJson()],
      // A crash point after the commit, before its result is journaled: the incident stays advance-pending, as after a lost commit response.
      internal: { advanceHooks: { afterAdvance: async () => { throw new Error("simulated crash point"); } } }
    });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const incident = await only(h, op);
    assert.equal(incident.progress, "advance-pending");
    const boundary = (await op.status()).sources[0]!.boundary!;
    const refused = await op.retireBoundary({ sourceId: "orders", boundaryId: boundary.boundaryId, expectedRevision: boundary.revision, reason: "looks fine" });
    assert.equal(refused.result, "refused", refused.message);
    assert.equal(refused.outcome, "advance-unresolved");
    assert.equal((await op.status()).sources[0]!.boundary?.boundaryId, boundary.boundaryId, "the boundary stays in force");
  });

  it("F31: evaluate runs the current mapping on the stored original without committing, tracing or delivering", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const op = getGatewayOperator(h.gateway);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    await h.advance(1);
    const advanced = await only(h, op);
    assert.equal(advanced.progress, "advanced");

    const stillFails = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.equal(stillFails.validation, "invalid");
    assert.equal(stillFails.errors[0]?.failureClass, "payload-schema");
    assert.equal(stillFails.plan, null);

    app.mapOverride = repairedMap;
    const pipelineTraces = () => h!.internals.traces({ limit: 1_000 }).items.filter(trace => trace.stage === "validate" || trace.stage === "map").length;
    const traces = pipelineTraces();
    const events = seen.events.length;
    const evaluation = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.equal(evaluation.validation, "valid");
    assert.deepEqual(evaluation.outputs, [{ channel: "orderStatus", channelVersion: 1, routing: "privileged", revision: "3" }]);
    assert.equal(evaluation.eligible, true);
    assert.match(evaluation.plan?.planId ?? "", /^pl1:/);
    assert.match(evaluation.plan?.fingerprint ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.ok(Date.parse(evaluation.plan!.expiresAt) - Date.now() > 4 * 60_000);
    assert.equal(pipelineTraces(), traces, "no pipeline traces");
    assert.equal(seen.events.length, events, "nothing delivered");
    assert.equal((await op.showFailure({ failureId: advanced.failureId })).revision, advanced.revision, "the incident is unchanged");

    const stale = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision + 1 });
    assert.equal(stale.ineligibleReason, "stale-revision");
  });

  it("F33 and F35: an approved redrive admits through the revision filter once; the same operation ID returns the recorded result", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const op = getGatewayOperator(h.gateway);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    await h.advance(1);
    const advanced = await only(h, op);
    app.mapOverride = repairedMap;
    const { plan } = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.ok(plan !== null);

    const wrong = await op.redrive({ failureId: advanced.failureId, planId: plan.planId, planFingerprint: `sha256:${"0".repeat(64)}`, expectedRevision: advanced.revision });
    assert.equal(wrong.outcome, "fingerprint-changed");
    const request = { failureId: advanced.failureId, planId: plan.planId, planFingerprint: plan.fingerprint, expectedRevision: advanced.revision, operationId: "op-redrive-1" };
    const result = await op.redrive(request);
    assert.equal(result.result, "completed", result.message);
    assert.equal(result.outcome, "reprocessed");
    assert.equal(result.operationId, "op-redrive-1");
    await waitFor(() => seen.events.some(event => event.revision === "3"), 5_000, "the redriven state delivered");
    assert.deepEqual(seen.events.at(-1)?.data, { orderId: "ord_1", status: "done", progress: 100 });
    assert.equal(seen.states.at(-1), "live");

    const delivered = seen.events.length;
    const replayed = await op.redrive(request);
    assert.deepEqual(replayed, result, "the recorded result, not a second run");
    const reused = await op.redrive({ ...request, expectedRevision: advanced.revision + 5 });
    assert.equal(reused.outcome, "operation-id-reused");
    const planUsed = await op.redrive({ ...request, operationId: "op-redrive-2" });
    assert.equal(planUsed.outcome, "plan-unknown", "a plan approves one redrive");
    assert.equal(seen.events.length, delivered);
    const history = (await op.showFailure({ failureId: advanced.failureId })).history;
    assert.ok(history.some(event => event.event === "operator" && event.operationId === "op-redrive-1"));
  });

  it("F34: redriving a record older than current state is superseded and sends nothing", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [shipped(3), orderRecord("acme", "ord_1", 4, "done", 100)] });
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const op = getGatewayOperator(h.gateway);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    await h.advance(1);
    await h.internals.failuresSettled();
    await h.advance(1);
    await waitFor(() => seen.events.some(event => event.revision === "4"), 5_000, "revision 4");
    const advanced = await only(h, op);
    app.mapOverride = repairedMap;
    const { plan } = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    const events = seen.events.length;
    const result = await op.redrive({ failureId: advanced.failureId, planId: plan!.planId, planFingerprint: plan!.fingerprint, expectedRevision: advanced.revision });
    assert.equal(result.outcome, "superseded", result.message);
    assert.equal(seen.events.length, events, "no client frame");
    assert.equal(seen.events.at(-1)?.revision, "4", "no regression");
  });

  it("F32: a changed mapped output or an expired plan is refused; a new evaluation is required", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const advanced = await only(h, op);
    app.mapOverride = repairedMap;
    const first = (await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision })).plan!;
    app.mapOverride = value => (repairedMap(value) as { data: { progress: number } }[]).map(output => ({ ...output, data: { ...output.data, progress: 50 } }));
    const changed = await op.redrive({ failureId: advanced.failureId, planId: first.planId, planFingerprint: first.fingerprint, expectedRevision: advanced.revision });
    assert.equal(changed.result, "refused");
    assert.equal(changed.outcome, "fingerprint-changed");

    const second = (await op.evaluate({ failureId: advanced.failureId, expectedRevision: (await op.showFailure({ failureId: advanced.failureId })).revision })).plan!;
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    mock.timers.tick(5 * 60_000 + 1);
    const current = await op.showFailure({ failureId: advanced.failureId });
    const expired = await op.redrive({ failureId: advanced.failureId, planId: second.planId, planFingerprint: second.fingerprint, expectedRevision: current.revision });
    assert.equal(expired.outcome, "plan-expired");
  });

  it("F36: no bulk, edited-payload, arbitrary-topic or unsafe-mapper redrive", async () => {
    const app = new OrderApp();
    h = await startHarness({ app, failureHandling: resync({ replaySafeMapping: false }), recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    const op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const advanced = await only(h, op);
    app.mapOverride = repairedMap;
    const evaluation = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.equal(evaluation.validation, "valid");
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.ineligibleReason, "not-replay-safe");
    assert.equal(evaluation.plan, null);
    const base = { failureId: advanced.failureId, planId: "pl1:x", planFingerprint: "sha256:x", expectedRevision: advanced.revision };
    for (const extra of [{ failureIds: [advanced.failureId] }, { payload: "{}" }, { topic: "orders" }, { force: true }]) {
      await assert.rejects(op.redrive({ ...base, ...extra } as never), (error: { code: string }) => error.code === "INVALID_REQUEST");
    }
    await assert.rejects(op.redrive({ ...base, failureId: "*" , expectedRevision: -1 }), (error: { code: string }) => error.code === "INVALID_REQUEST");
  });

  it("F35: an operation interrupted between intent and result is unknown after a restart and never rerun", { skip: !nodeSupportsJournal() && "the journal needs Node 24.15 or newer" }, async () => {
    const state = await mkdtemp(join(tmpdir(), "so-operator-"));
    initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "fixture-1", kind: "fixture" }]);
    const app = new OrderApp();
    const reached = deferred();
    const release = deferred();
    h = await startHarness({
      app, stateDirectory: state, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [shipped(3)],
      internal: { operatorHooks: { afterIntent: async () => { reached.resolve(); await release.promise; } } }
    });
    let op = getGatewayOperator(h.gateway);
    await h.advance(1);
    const advanced = await only(h, op);
    app.mapOverride = repairedMap;
    const { plan } = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    const request = { failureId: advanced.failureId, planId: plan!.planId, planFingerprint: plan!.fingerprint, expectedRevision: advanced.revision, operationId: "op-crash" };
    const inFlight = op.redrive(request);
    await reached.promise;
    // The gateway stops with the operation's intent recorded and no result: as far as the journal knows, a crash.
    const store = h.internals.incidentStore() as IncidentStore;
    assert.equal(store.getOperation("op-crash")?.state, "pending");
    await h.close();
    h = undefined;
    release.resolve();
    await inFlight.catch(() => undefined);

    h = await startHarness({ app, stateDirectory: state, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [shipped(3)] });
    op = getGatewayOperator(h.gateway);
    const after = await op.redrive(request);
    assert.equal(after.result, "unknown");
    assert.equal(after.operationId, "op-crash");
    assert.match(after.message, /not rerun/);
  });
});
