import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, FixtureRecord, SourceRecoveryHandlers } from "@streamotter/gateway";
import { initJournal, nodeSupportsJournal, openJournal } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { observe, orderRecord, OrderApp, startHarness, waitFor, type Harness } from "./harness.ts";

/**
 * F48 at the fixture tier (spec §14): upgrading a V1 deployment to failure
 * handling keeps its progress; the journal and its recovery boundaries survive
 * restarts; and removing failureHandling while the journal still holds a
 * boundary or an open incident is refused instead of silently dropping it.
 */

const resync = (extra: Record<string, unknown> = {}): FailureHandlingConfig =>
  ({ sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync", ...extra } } }) as FailureHandlingConfig;
const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "upgrade-test" }) };
const badJson: FixtureRecord = { key: "ord_1", raw: "{not json" };

async function journal(): Promise<string> {
  const state = await mkdtemp(join(tmpdir(), "so-upgrade-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "fixture-1", kind: "fixture" }]);
  return state;
}

const skip = !nodeSupportsJournal() && "the journal needs Node 24.15 or newer";

describe("F48: upgrade and downgrade with failure handling", { skip }, () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("a V1 configuration upgraded to failure handling keeps serving, and an unchanged V1 configuration ignores nothing", async () => {
    const app = new OrderApp();
    app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h = await startHarness({ app, fixtures: [orderRecord("acme", "ord_1", 2, "processing", 50)] });
    assert.equal(h.internals.incidentStore(), null, "V1: no incident store");
    await h.close();

    const state = await journal();
    h = await startHarness({ app, stateDirectory: state, failureHandling: HOLD, fixtures: [orderRecord("acme", "ord_1", 2, "processing", 50)] });
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    await h.advance(1);
    await waitFor(() => seen.events.some(event => event.revision === "2"), 5_000, "delivered after the upgrade");
    assert.equal((h.internals.incidentStore()?.kind), "sqlite");
  });

  it("keeps the boundary across restarts and refuses to start without failureHandling until it is retired", async () => {
    const state = await journal();
    const app = new OrderApp();
    app.put("acme", "alice", "ord_1", 2, "processing", 20);
    h = await startHarness({ app, stateDirectory: state, failureHandling: resync({ boundaryRetirement: "operator" }), recovery: { orders: recoverable }, fixtures: [badJson] });
    await h.advance(1);
    await h.internals.failuresSettled();
    const boundary = (await getGatewayOperator(h.gateway).status()).sources[0]!.boundary!;
    assert.ok(boundary !== null, "an advance put a boundary in force");
    await h.close();
    h = undefined;

    // Same configuration: the obligation is still enforced after a restart.
    h = await startHarness({ app, stateDirectory: state, failureHandling: resync({ boundaryRetirement: "operator" }), recovery: { orders: recoverable } });
    assert.equal((await getGatewayOperator(h.gateway).status()).sources[0]?.boundary?.boundaryId, boundary.boundaryId);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    assert.equal(app.recoveryInputs.at(-1)?.boundaryId, boundary.boundaryId, "the snapshot after restart acknowledged the boundary");
    await h.close();
    h = undefined;

    // Downgrade by configuration: refused, and the journal is left exactly as it was.
    await assert.rejects(startHarness({ app, stateDirectory: state }), (error: { code: string; details?: { reason?: string; boundarySources?: string[] } }) =>
      error.code === "CONFIG_INVALID" && error.details?.reason === "failure-handling-removed" && error.details.boundarySources?.[0] === "orders");
    const store = openJournal(state, { projectId: "order-dashboard" });
    try {
      assert.equal(store.boundary("orders")?.boundaryId, boundary.boundaryId, "nothing was erased");
    } finally {
      store.close();
    }

    // The supported path: retire with failure handling still on, then remove it.
    h = await startHarness({ app, stateDirectory: state, failureHandling: resync({ boundaryRetirement: "operator" }), recovery: { orders: recoverable } });
    const op = getGatewayOperator(h.gateway);
    const current = (await op.status()).sources[0]!.boundary!;
    const retired = await op.retireBoundary({ sourceId: "orders", boundaryId: current.boundaryId, expectedRevision: current.revision, reason: "downgrade after checking the order store" });
    assert.equal(retired.outcome, "boundary-retired", retired.message);
    await h.close();
    h = await startHarness({ app, stateDirectory: state });
    assert.equal(h.internals.incidentStore(), null, "started without failure handling once nothing was outstanding");
  });

  it("allows dropping failureHandling together with a generation change that retires the boundary", async () => {
    const state = await journal();
    h = await startHarness({ stateDirectory: state, failureHandling: resync(), recovery: { orders: recoverable }, fixtures: [badJson] });
    await h.advance(1);
    await h.internals.failuresSettled();
    assert.ok((await getGatewayOperator(h.gateway).status()).sources[0]?.boundary, "a generation-mode boundary is in force");
    await h.close();
    h = undefined;

    // ADR-15B §4: the new generation retires the old generation's boundary, so nothing is outstanding.
    h = await startHarness({ stateDirectory: state, generation: "fixture-2" });
    assert.equal(h.internals.incidentStore(), null);
    await h.close();
    h = undefined;

    // The old generation's boundary still counts when the generation is unchanged.
    await assert.rejects(startHarness({ stateDirectory: state }), (error: { code: string; details?: { boundarySources?: string[] } }) =>
      error.code === "CONFIG_INVALID" && error.details?.boundarySources?.[0] === "orders");
  });

  it("refuses to drop failureHandling while an incident is still open", async () => {
    const state = await journal();
    h = await startHarness({ stateDirectory: state, failureHandling: HOLD, fixtures: [badJson] });
    await h.advance(1);
    await h.internals.failuresSettled();
    await h.close();
    h = undefined;
    await assert.rejects(startHarness({ stateDirectory: state }), (error: { code: string; details?: { reason?: string; openIncidentSources?: string[] } }) =>
      error.code === "CONFIG_INVALID" && error.details?.reason === "failure-handling-removed" && error.details.openIncidentSources?.[0] === "orders");
  });
});
