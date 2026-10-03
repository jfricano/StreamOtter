import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, FixtureRecord, Json, SourceRecoveryHandlers } from "@streamotter/gateway";
import { initJournal, nodeSupportsJournal, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { observe, orderRecord, OrderApp, sleep, startHarness, waitFor, type Harness } from "./harness.ts";

/**
 * V1.1 slice C at the fixture tier: the recovery guard, the cumulative
 * boundary, snapshot acknowledgment, retirement and the circuit breaker
 * (ADR-15B, spec §§4, 6, 7). Expected values come from the spec, not from the
 * gateway, and the guards here are test doubles: a guard that says
 * "recoverable" proves nothing about the domain (acceptance plan §1).
 */

const RESYNC: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-resync" } } };
const bad = (key = "ord_1", raw = "{not json"): FixtureRecord => ({ key, raw });

interface GuardCall { failureId: string; prior: { id: string; context: Json } | null; evidenceHash: string }

/** A guard that records its inputs and answers from a script. */
function scriptedGuard(answers: ((call: GuardCall) => unknown)[]): { guard: SourceRecoveryHandlers; calls: GuardCall[] } {
  const calls: GuardCall[] = [];
  const guard: SourceRecoveryHandlers = {
    recover: ({ incident, prior }) => {
      const call = { failureId: incident.failureId, prior: prior === null ? null : { id: prior.id, context: prior.context }, evidenceHash: incident.evidenceHash };
      calls.push(call);
      const answer = answers.shift() ?? (() => ({ decision: "hold", reason: "no scripted answer" }));
      return answer(call) as never;
    }
  };
  return { guard, calls };
}

const watermark = (value: number) => () => ({ decision: "recoverable", context: { watermark: value }, evidenceRef: `outbox:${value}` });

async function incidents(h: Harness): Promise<IncidentRecord[]> {
  await h.internals.failuresSettled();
  return [...(h.internals.incidentStore() as IncidentStore).list({ state: "all" }).items];
}

describe("V1.1 slice C: guarded continuation (fixture tier)", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("F21: a recoverable guard installs a boundary before the advance, and snapshots must acknowledge it", async () => {
    const { guard, calls } = scriptedGuard([watermark(7)]);
    h = await startHarness({
      failureHandling: RESYNC, recovery: { orders: guard },
      fixtures: [bad(), orderRecord("acme", "ord_1", 3, "processing", 30)]
    });
    h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live before the incident");
    assert.deepEqual(h.app.recoveryInputs, [null], "no boundary before the incident");

    assert.equal(await h.advance(1), 0, "the bad record itself is not committed by processing");
    await h.internals.failuresSettled();
    const [incident] = await incidents(h);
    assert.ok(incident !== undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.prior, null);
    assert.equal(calls[0]?.evidenceHash, incident.evidence.hash);
    assert.equal(incident.progress, "advanced");
    assert.equal(incident.state, "resolved");
    assert.equal(incident.recovery, "boundary-in-force");
    assert.equal(incident.guard?.decision, "recoverable");
    assert.equal(incident.guard?.evidenceRef, "outbox:7");
    assert.match(incident.boundaryId ?? "", /^rb1:[0-9a-f]{32}$/);
    const store = h.internals.incidentStore() as IncidentStore;
    const events = store.events(incident.failureId).map(event => event.event);
    assert.ok(events.indexOf("quarantined") < events.indexOf("advance-pending"), "evidence is acknowledged before the barrier");
    assert.ok(events.indexOf("advance-pending") < events.indexOf("advance-confirmed"), "the barrier is durable before the advance");
    const boundary = store.boundary("orders");
    assert.equal(boundary?.boundaryId, incident.boundaryId);
    assert.deepEqual(boundary?.context, { watermark: 7 });
    assert.deepEqual(boundary?.failureIds, [incident.failureId]);

    await waitFor(() => h!.internals.sources()[0]?.status === "healthy", 5_000, "healthy after the advance");
    await waitFor(() => seen.states.at(-1) === "live", 5_000, "live again after resynchronizing");
    assert.deepEqual(h.app.recoveryInputs.at(-1), { boundaryId: incident.boundaryId, context: { watermark: 7 } });
    assert.equal(await h.advance(1), 1, "the next record follows in order");
  });

  it("F22: a snapshot that omits or mismatches the acknowledgment never reaches live", async () => {
    for (const ack of ["none", "wrong"] as const) {
      const { guard } = scriptedGuard([watermark(1)]);
      h = await startHarness({ failureHandling: RESYNC, recovery: { orders: guard }, fixtures: [bad()] });
      h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
      h.app.recoveryAck = ack;
      assert.equal(await h.advance(1), 0);
      await h.internals.failuresSettled();
      await waitFor(() => h!.internals.sources()[0]?.status === "healthy", 5_000, "healthy");
      const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
      await sleep(1_500);
      assert.ok(!seen.states.includes("live"), `${ack}: no false live`);
      assert.equal(seen.states.at(-1), "stale");
      const rejected = h.internals.traces({ limit: 100, outcome: "rejected" }).items.filter(trace => trace.stage === "snapshot");
      assert.ok(rejected.length >= 1);
      assert.ok(rejected.every(trace => trace.errorCode === "SOURCE_UNAVAILABLE"));
      await h.close();
      h = undefined;
    }
  });

  it("an acknowledgment returned with no boundary in force is an invalid snapshot", async () => {
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: scriptedGuard([]).guard } });
    h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    h.app.recoveryAck = "always";
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("failed"), 5_000, "failed");
    assert.ok(!seen.states.includes("live"));
    assert.equal(seen.reasons.at(-1), "INVALID_PAYLOAD");
  });

  it("F20: hold, throw, invalid result, oversize context and a missing evidence reference all keep the record held", async () => {
    const answers: [string, () => unknown, IncidentRecord["recovery"], string][] = [
      ["hold", () => ({ decision: "hold", reason: "outbox not caught up" }), "denied", "hold"],
      ["throw", () => { throw new Error("database down"); }, "held", "error"],
      ["invalid", () => ({ decision: "maybe" }), "held", "error"],
      ["oversize", () => ({ decision: "recoverable", context: { pad: "x".repeat(20_000) }, evidenceRef: "r" }), "held", "error"],
      ["no evidence", () => ({ decision: "recoverable", context: { watermark: 1 } }), "held", "error"]
    ];
    for (const [name, answer, recovery, decision] of answers) {
      h = await startHarness({ failureHandling: RESYNC, recovery: { orders: scriptedGuard([answer]).guard }, fixtures: [bad(), orderRecord("acme", "ord_1", 3, "done", 100)] });
      assert.equal(await h.advance(1), 0);
      const [incident] = await incidents(h);
      assert.equal(incident?.progress, "held", name);
      assert.equal(incident?.recovery, recovery, name);
      assert.equal(incident?.guard?.decision, decision, name);
      assert.equal(incident?.quarantine, "acknowledged", `${name}: evidence is still kept`);
      assert.equal((h.internals.incidentStore() as IncidentStore).boundary("orders"), null, `${name}: no boundary`);
      assert.equal(h.internals.sources()[0]?.status, "paused", name);
      await h.close();
      h = undefined;
    }
  });

  it("F20: a guard that never answers times out after 10 seconds and holds", { timeout: 20_000 }, async () => {
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: scriptedGuard([() => new Promise(() => undefined)]).guard }, fixtures: [bad()] });
    const started = Date.now();
    assert.equal(await h.advance(1), 0);
    const [incident] = await incidents(h);
    assert.ok(Date.now() - started >= 9_900);
    assert.equal(incident?.guard?.decision, "timeout");
    assert.equal(incident?.progress, "held");
  });

  it("F06: an integrity failure under a resync policy never reaches the guard", async () => {
    const { guard, calls } = scriptedGuard([watermark(1)]);
    h = await startHarness({
      failureHandling: { sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync" } } },
      recovery: { orders: guard }, fixtures: [orderRecord("acme", "ord_1", 3, "done", 100)]
    });
    h.app.mapOverride = value => [{ tenantId: "", params: { orderId: "ord_1" }, revision: "3", data: (value as { order: Json }).order }];
    assert.equal(await h.advance(1), 0);
    const [incident] = await incidents(h);
    assert.equal(incident?.failureClass, "routing-invalid");
    assert.equal(incident?.policy, "pause");
    assert.equal(calls.length, 0);
  });

  it("F24: a second incident gets the prior boundary and the new one carries both obligations", async () => {
    const { guard, calls } = scriptedGuard([
      watermark(10),
      call => ({ decision: "recoverable", context: { watermark: 20, carried: call.prior?.context ?? null }, evidenceRef: "outbox:20" })
    ]);
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: guard }, fixtures: [bad("ord_1"), bad("ord_2", "{also bad")] });
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    await waitFor(() => h!.internals.sources()[0]?.status === "healthy", 5_000, "healthy");
    const first = (h.internals.incidentStore() as IncidentStore).boundary("orders");
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    const store = h.internals.incidentStore() as IncidentStore;
    const second = store.boundary("orders");
    assert.equal(calls[1]?.prior?.id, first?.boundaryId);
    assert.deepEqual(calls[1]?.prior?.context, { watermark: 10 });
    assert.deepEqual(second?.context, { watermark: 20, carried: { watermark: 10 } });
    assert.equal(second?.supersedes, first?.boundaryId);
    assert.equal(second?.failureIds.length, 2);
    assert.equal(store.getBoundary(first?.boundaryId as string)?.state, "superseded");
  });

  it("F26: the circuit opens on the next incident once the window's limit is reached", async () => {
    const { guard, calls } = scriptedGuard([watermark(1), watermark(2), watermark(3)]);
    h = await startHarness({
      failureHandling: { sources: { orders: { invalidJson: "quarantine-resync", automaticAdvanceLimit: { incidents: 2, windowMs: 60_000 } } } },
      recovery: { orders: guard }, fixtures: [bad("a"), bad("b"), bad("c")]
    });
    for (let index = 0; index < 2; index++) {
      assert.equal(await h.advance(1), 0);
      await h.internals.failuresSettled();
      await waitFor(() => h!.internals.sources()[0]?.status === "healthy", 5_000, "healthy");
    }
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    const store = h.internals.incidentStore() as IncidentStore;
    const open = store.open("orders");
    assert.equal(open.length, 1);
    assert.equal(open[0]?.progress, "held");
    assert.equal(open[0]?.quarantine, "acknowledged", "the third is still captured");
    assert.equal(calls.length, 2, "the guard is not consulted once the circuit is open");
    assert.equal(store.circuit("orders").state, "open");
    assert.equal(h.internals.sources()[0]?.status, "paused");
  });

  it("application retirement retires the boundary after an acknowledged snapshot, never while its incident is held", async () => {
    const retired: string[] = [];
    const { guard } = scriptedGuard([watermark(5)]);
    h = await startHarness({
      failureHandling: { sources: { orders: { invalidJson: "quarantine-resync", boundaryRetirement: "application" } } },
      recovery: { orders: { ...guard, retire: ({ boundary }) => { retired.push(boundary.id); return true; } } },
      fixtures: [bad()]
    });
    h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    const boundary = (h.internals.incidentStore() as IncidentStore).boundary("orders");
    assert.ok(boundary !== null);
    const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 5_000, "live with the acknowledgment");
    await waitFor(() => retired.length === 1, 5_000, "retire called");
    await h.internals.failuresSettled();
    const store = h.internals.incidentStore() as IncidentStore;
    assert.equal(store.boundary("orders"), null);
    assert.equal(store.getBoundary(boundary.boundaryId)?.retirement?.mode, "application");
    // Later snapshots no longer receive the boundary.
    const later = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => later.states.includes("live"), 5_000, "live without a boundary");
    assert.equal(h.app.recoveryInputs.at(-1), null);
  });

  it("F25: a guard answer that arrives after stop is ignored and nothing advances", async () => {
    let release: (() => void) | undefined;
    const { guard } = scriptedGuard([() => new Promise(resolve => { release = () => resolve({ decision: "recoverable", context: {}, evidenceRef: "late" }); })]);
    h = await startHarness({ failureHandling: RESYNC, recovery: { orders: guard }, fixtures: [bad()] });
    assert.equal(await h.advance(1), 0);
    await waitFor(() => release !== undefined, 5_000, "guard running");
    const store = h.internals.incidentStore() as IncidentStore;
    await h.close();
    h = undefined;
    release?.();
    await sleep(50);
    const [incident] = store.list({ state: "all" }).items;
    assert.notEqual(incident?.progress, "advanced");
    assert.equal(store.boundary("orders"), null);
  });

  it("F42: an independent source keeps flowing while another is held", async () => {
    const { createGateway, silentLogger } = await import("@streamotter/gateway");
    const { getGatewayInternals } = await import("@streamotter/gateway/internals");
    const { orderConfig } = await import("./harness.ts");
    const base = orderConfig();
    const app = new OrderApp();
    const gateway = createGateway({
      config: {
        ...base,
        sources: { ...base.sources, other: { kind: "fixture", generation: "other-1", fixtureRef: "other" } },
        failureHandling: { sources: { orders: { invalidJson: "quarantine-hold" } } }
      },
      handlers: app.handlers(),
      mode: "development",
      logger: silentLogger,
      development: { principals: {}, fixtures: { orders: [bad()], other: [orderRecord("acme", "x", 1, "queued", 0), orderRecord("acme", "x", 2, "done", 100)] } }
    });
    await gateway.start();
    const internals = getGatewayInternals(gateway);
    try {
      assert.equal(await internals.advanceFixture("orders", 1), 0);
      assert.equal(await internals.advanceFixture("other", 2), 2);
      const statuses = Object.fromEntries(internals.sources().map(source => [source.sourceId, source.status]));
      assert.deepEqual(statuses, { orders: "paused", other: "healthy" });
    } finally {
      await gateway.stop();
    }
  });
});

describe("V1.1 slice C: recovery state across restarts", { skip: nodeSupportsJournal() ? false : "the journal needs Node 24.15 or newer" }, () => {
  it("F23 and F26: the boundary and an open circuit survive a restart; new subscriptions must acknowledge it", async () => {
    const state = await mkdtemp(join(tmpdir(), "so-resync-"));
    initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "fixture-1", kind: "fixture" }]);
    const failureHandling: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-resync", automaticAdvanceLimit: { incidents: 1, windowMs: 3_600_000 } } } };
    let h = await startHarness({ failureHandling, stateDirectory: state, recovery: { orders: scriptedGuard([watermark(9)]).guard }, fixtures: [bad("a"), bad("b")] });
    assert.equal(await h.advance(1), 0);
    await h.internals.failuresSettled();
    await waitFor(() => h.internals.sources()[0]?.status === "healthy", 5_000, "healthy");
    assert.equal(await h.advance(1), 0, "the second incident trips the circuit");
    await h.internals.failuresSettled();
    const boundaryId = (h.internals.incidentStore() as IncidentStore).boundary("orders")?.boundaryId;
    assert.ok(boundaryId !== undefined);
    await h.close();

    h = await startHarness({ failureHandling, stateDirectory: state, recovery: { orders: scriptedGuard([]).guard }, fixtures: [] });
    try {
      const store = h.internals.incidentStore() as IncidentStore;
      assert.equal(store.boundary("orders")?.boundaryId, boundaryId);
      assert.equal(store.circuit("orders").state, "open");
      h.app.put("acme", "alice", "ord_1", 2, "processing", 20);
      const seen = observe(h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
      await waitFor(() => seen.states.includes("live"), 5_000, "live with the restored boundary");
      assert.equal(h.app.recoveryInputs.at(-1)?.boundaryId, boundaryId, "a subscription created after the restart receives the boundary");
    } finally {
      await h.close();
    }
  });
});
