import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, FixtureRecord, OperationResult, ProjectConfig, SourceRecoveryHandlers } from "@streamotter/gateway";
import { initJournal, nodeSupportsJournal, openJournal, rebaselineSource, type IncidentStore } from "@streamotter/gateway/internals";
import { orderConfig, startHarness, type Harness } from "./harness.ts";

/**
 * `sources rebaseline` (spec §14, ADR-15B §4): after a source's generation
 * changes, the incidents of the old generation can be closed offline, with a
 * reason and an operation ID, and their boundary retired. Incidents of the
 * configured generation are never touched, and a running gateway's lock refuses it.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/cli/src/main.ts");
const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
const RESYNC = { sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync" } } } as FailureHandlingConfig;
const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "rebaseline-test" }) };
const badJson: FixtureRecord = { key: "ord_1", raw: "{not json" };

function withGeneration(failureHandling: FailureHandlingConfig, generation: string): ProjectConfig {
  const config = { ...orderConfig(), failureHandling } as unknown as ProjectConfig;
  return { ...config, sources: { orders: { ...config.sources["orders"]!, generation } } } as ProjectConfig;
}

async function journal(): Promise<string> {
  const state = await mkdtemp(join(tmpdir(), "so-rebaseline-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "fixture-1", kind: "fixture" }]);
  return state;
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, ["--conditions=streamotter-source", "--no-warnings", CLI, ...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => done({ code: code ?? -1, stdout, stderr }));
  });
}

describe("sources rebaseline", { skip: !nodeSupportsJournal() && "the journal needs Node 24.15 or newer" }, () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("closes the old generation's held incident after a generation change, so the gateway can start again", async () => {
    const state = await journal();
    h = await startHarness({ stateDirectory: state, failureHandling: HOLD, fixtures: [badJson] });
    await h.advance(1);
    await h.internals.failuresSettled();
    const [held] = h.internals.incidentStore()!.open("orders");
    assert.ok(held !== undefined && held.progress === "held");

    // While the gateway runs, its journal lock refuses an offline rebaseline.
    assert.throws(() => rebaselineSource({ stateDirectory: state, config: withGeneration(HOLD, "fixture-2"), sourceId: "orders", reason: "topic recreated" }),
      (error: { code: string }) => error.code === "SOURCE_UNAVAILABLE");
    await h.close();
    h = undefined;

    // Same generation: nothing to rebaseline; a held record in the current generation is a retry-current case.
    const same = rebaselineSource({ stateDirectory: state, config: withGeneration(HOLD, "fixture-1"), sourceId: "orders", reason: "trying to skip" });
    assert.equal(same.result, "refused");
    assert.equal(same.outcome, "nothing-to-rebaseline");
    let store = openJournal(state, { projectId: "order-dashboard" });
    assert.equal(store.open("orders").length, 1, "untouched");
    store.close();

    // A changed generation is refused at startup until the old incidents are rebaselined (ADR-15A §3).
    await assert.rejects(startHarness({ stateDirectory: state, failureHandling: HOLD, generation: "fixture-2" }), (error: { code: string; message: string }) => error.code === "SOURCE_UNAVAILABLE" && /sources rebaseline/.test(error.message));
    const result = rebaselineSource({ stateDirectory: state, config: withGeneration(HOLD, "fixture-2"), sourceId: "orders", reason: "topic recreated from the outbox" });
    assert.equal(result.result, "completed", result.message);
    assert.equal(result.outcome, "rebaselined");
    assert.deepEqual(result.closed, [held.failureId]);
    assert.match(result.operationId, /^op1:[0-9a-f]{32}$/);

    store = openJournal(state, { projectId: "order-dashboard" });
    try {
      const closed = store.get(held.failureId)!;
      assert.equal(closed.state, "resolved");
      assert.equal(closed.resolution, "rebaselined to generation fixture-2");
      const last = store.events(held.failureId).at(-1)!;
      assert.equal(last.event, "operator");
      assert.equal(last.operationId, result.operationId);
      assert.match(last.detail ?? "", /topic recreated from the outbox/);
    } finally {
      store.close();
    }
    h = await startHarness({ stateDirectory: state, failureHandling: HOLD, generation: "fixture-2" });
    assert.equal(h.internals.incidentStore()!.open("orders").length, 0);
  });

  it("retires the old generation's boundary, and the CLI requires --confirm and a reason", async () => {
    const state = await journal();
    h = await startHarness({ stateDirectory: state, failureHandling: RESYNC, recovery: { orders: recoverable }, fixtures: [badJson] });
    await h.advance(1);
    await h.internals.failuresSettled();
    const boundary = h.internals.incidentStore()!.boundary("orders");
    assert.ok(boundary !== null);
    await h.close();
    h = undefined;

    const configPath = join(state, "..", `${state.split("/").at(-1)}-config.json`);
    await writeFile(configPath, JSON.stringify(withGeneration(RESYNC, "fixture-2")));
    const base = ["sources", "rebaseline", "--config", configPath, "--state-dir", state, "--source", "orders"];
    const unconfirmed = await runCli([...base, "--reason", "new topic"]);
    assert.equal(unconfirmed.code, 2);
    assert.match(unconfirmed.stderr, /--confirm orders/);
    const noReason = await runCli([...base, "--confirm", "orders"]);
    assert.equal(noReason.code, 2);
    const done = await runCli([...base, "--reason", "new topic", "--confirm", "orders", "--json"]);
    assert.equal(done.code, 0, done.stderr);
    const result = JSON.parse(done.stdout) as OperationResult & { retiredBoundary: string | null };
    assert.equal(result.outcome, "rebaselined");
    assert.equal(result.retiredBoundary, boundary.boundaryId);
    const store = openJournal(state, { projectId: "order-dashboard" });
    try {
      assert.equal(store.boundary("orders"), null, "no boundary in force");
      assert.equal(store.getBoundary(boundary.boundaryId)?.state, "retired");
    } finally {
      store.close();
    }
    const again = await runCli([...base, "--reason", "new topic", "--confirm", "orders"]);
    assert.equal(again.code, 3, "nothing left: refused");
  });

  it("rebaselines one source of several and leaves the others' open incidents and generations alone", async () => {
    const state = await mkdtemp(join(tmpdir(), "so-rebaseline-"));
    const stored = [
      { sourceId: "orders", generation: "g1", kind: "kafka" as const },
      { sourceId: "payments", generation: "g1", kind: "kafka" as const },
      { sourceId: "refunds", generation: "g1", kind: "kafka" as const }
    ];
    initJournal(state, "p", stored);
    let store = openJournal(state, { projectId: "p" });
    store.claim("p", stored);
    for (const source of stored) store.observe(openIncident(`f1:${source.sourceId}`, source.sourceId));
    store.close();
    // The operator re-created the orders and payments topics; refunds was removed from the configuration but still has an open incident.
    const config = {
      projectId: "p",
      sources: { orders: { kind: "kafka", generation: "g2" }, payments: { kind: "kafka", generation: "g2" } }
    } as unknown as ProjectConfig;

    const orders = rebaselineSource({ stateDirectory: state, config, sourceId: "orders", reason: "orders topic re-created" });
    assert.equal(orders.result, "completed", orders.message);
    assert.deepEqual(orders.closed, ["f1:orders"]);
    store = openJournal(state, { projectId: "p" });
    assert.equal(store.get("f1:orders")?.state, "resolved");
    assert.equal(store.get("f1:payments")?.state, "open", "another source's incident is not touched");
    assert.equal(store.get("f1:refunds")?.state, "open");
    assert.deepEqual(store.sources(), [{ ...stored[0]!, generation: "g2" }, stored[1], stored[2]], "only the rebaselined source's generation changed");
    store.close();

    // The other changed source can be rebaselined in turn: neither blocks the other.
    const payments = rebaselineSource({ stateDirectory: state, config, sourceId: "payments", reason: "payments topic re-created" });
    assert.equal(payments.result, "completed", payments.message);
    store = openJournal(state, { projectId: "p" });
    assert.equal(store.get("f1:payments")?.state, "resolved");
    assert.equal(store.get("f1:refunds")?.state, "open", "a removed source is the gateway's startup check to refuse, not rebaseline's");
    store.close();
  });
});

function openIncident(failureId: string, sourceId: string): Parameters<IncidentStore["observe"]>[0] {
  return {
    failureId, sourceId, generation: "g1", position: { kind: "kafka", topic: sourceId, partition: 0, offset: "42" }, clusterId: "c", timestamp: null,
    failureClass: "invalid-json", stage: "validate", errorCode: "INVALID_PAYLOAD", channel: null, policy: "quarantine-hold", diagnosis: "bad json",
    evidence: { location: "kafka", completeness: "complete", valueBytes: 1, keyBytes: null, headerCount: 0, hash: `sha256:${"a".repeat(64)}` },
    fingerprints: { config: "c", handlerBuildId: "h", policyRevision: "p", gatewayVersion: "v" }, observedAt: "2026-10-03T00:00:00.000Z"
  };
}
