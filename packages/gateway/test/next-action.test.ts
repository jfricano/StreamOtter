import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FailurePolicy, GatewayLogger, IncidentDetail, ProjectConfig } from "@streamotter/contracts";
import type { QuarantineOutcome, QuarantineWriter } from "../src/failures/quarantine.ts";
import { FailureService, type FailureSource } from "../src/failures/service.ts";
import { MemoryIncidentStore } from "../src/failures/store.ts";
import { OperatorService, type OperatorHost } from "../src/operator/service.ts";
import type { ProcessOutcome, SourceInput } from "../src/sources/types.ts";

/**
 * The next action and its explanation are class-aware (runbook §6.5): they never
 * point at a step that can't succeed, such as retrying bytes that can't be
 * repaired, fixing a guard that never ran, or waiting on a record that is gone.
 */

const silent: GatewayLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
type Pause = Extract<ProcessOutcome, { kind: "pause" }>;
const invalidJson: Pause = { kind: "pause", code: "INVALID_PAYLOAD", failureClass: "invalid-json", stage: "validate", channel: null, diagnosis: "bad JSON" };
const tombstone: Pause = { kind: "pause", code: "INVALID_PAYLOAD", failureClass: "tombstone", stage: "validate", channel: null, diagnosis: "tombstone" };
const record = (bytes: Buffer | null): SourceInput => ({ key: "k", bytes, keyBytes: Buffer.from("k"), headers: [], timestamp: null, position: { kind: "kafka", topic: "orders", partition: 0, offset: "41" } });

async function incident(policy: FailurePolicy, outcome: Pause, input: SourceInput, write: QuarantineOutcome, after?: (failures: FailureService) => void): Promise<IncidentDetail> {
  const config = {
    configVersion: 1, projectId: "order-dashboard",
    sources: { orders: { kind: "kafka", generation: "orders-1", connectionRef: "cluster", topics: ["orders"], consumerGroup: "g", codec: "json", startFrom: "earliest" } },
    failureHandling: { quarantine: { topic: "orders.quarantine", capture: "full-record" }, sources: { orders: { invalidJson: policy } } }
  } as unknown as ProjectConfig;
  const store = new MemoryIncidentStore();
  store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  const writer: QuarantineWriter = { publish: async () => write, stop: async () => undefined };
  const failures = new FailureService({
    config, store, logger: silent, quarantine: writer, configFingerprint: "c".repeat(64), handlerBuildId: "b", maxSourceRecordBytes: 1 << 20,
    guards: policy === "quarantine-resync" ? { orders: { recover: async () => ({ decision: "hold", reason: "not yet" }) } } : {}
  });
  failures.setClusterId("orders", "cluster-a");
  const source: FailureSource = { id: "orders", config: config.sources["orders"] as FailureSource["config"], adapter: null };
  await failures.held(source, input, outcome);
  after?.(failures);
  const host: OperatorHost = {
    mode: "development", config, fingerprint: "c", handlerBuildId: "b", logger: silent, state: () => "running",
    source: () => ({ sourceId: "orders", kind: "kafka", status: "paused" }), traces: () => ({ items: [], nextCursor: null }),
    quarantineReport: () => null, quarantineReader: () => null, retry: async () => undefined,
    evaluateRecord: async () => { throw new Error("not used"); }, redriveRecord: async () => { throw new Error("not used"); }, setBoundary: () => undefined
  };
  const [held] = store.open("orders");
  return new OperatorService(host, failures).showFailure({ failureId: held?.failureId as string });
}

const acknowledged: QuarantineOutcome = { kind: "acknowledged", partition: 0, offset: "1" };

describe("class-aware next actions (runbook §6.5)", () => {
  it("held invalid JSON is not told to repair and retry the bytes: switch to quarantine-resync, or rebaseline", async () => {
    const detail = await incident("quarantine-hold", invalidJson, record(Buffer.from("{bad")), acknowledged);
    assert.equal(detail.nextAction, "repair-and-retry");
    assert.match(detail.explanation.nextAction, /can't be repaired in place, so a retry fails the same way/);
    assert.match(detail.explanation.nextAction, /quarantine-resync .* or rebaseline/);
  });

  it("a tombstone is fixed at the publisher and rebaselined past", async () => {
    const detail = await incident("quarantine-hold", tombstone, record(null), acknowledged);
    assert.equal(detail.policy, "pause");
    assert.match(detail.explanation.nextAction, /Fix the publisher, then rebaseline past the record/);
    assert.doesNotMatch(detail.explanation.nextAction, /retry the held record/);
  });

  it("a failed quarantine write points at the quarantine topic, not at a guard that never ran", async () => {
    const resync = await incident("quarantine-resync", invalidJson, record(Buffer.from("{bad")), { kind: "failed", reason: "UNKNOWN_TOPIC_OR_PARTITION" });
    assert.equal(resync.guard, null, "the guard never ran");
    assert.equal(resync.nextAction, "reassess");
    assert.match(resync.explanation.nextAction, /quarantine write was refused, so the recovery guard did not run. Fix the quarantine topic/);
    assert.doesNotMatch(resync.explanation.nextAction, /made the recovery guard hold/);

    const hold = await incident("quarantine-hold", invalidJson, record(Buffer.from("{bad")), { kind: "unknown", reason: "REQUEST_TIMEOUT" });
    assert.equal(hold.nextAction, "repair-and-retry");
    assert.match(hold.explanation.nextAction, /quarantine write got no definite answer.*Fix the quarantine topic.*then retry-current/);
  });

  it("a guard that answered hold is reassessed after correcting what it checks", async () => {
    const detail = await incident("quarantine-resync", invalidJson, record(Buffer.from("{bad")), acknowledged);
    assert.equal(detail.recovery, "denied");
    assert.equal(detail.nextAction, "reassess");
    assert.match(detail.explanation.nextAction, /The recovery guard answered hold/);
  });

  it("a record that is gone from its position points at the rebaseline, and a reassess is not offered for it", async () => {
    const detail = await incident("quarantine-resync", invalidJson, record(Buffer.from("{bad")), acknowledged,
      failures => { failures.positionProblem("orders", { kind: "kafka", topic: "orders", partition: 0, offset: "50" }); });
    assert.match(detail.diagnosis.message, /^Source progress moved/);
    assert.equal(detail.progress, "held");
    assert.equal(detail.nextAction, "repair-and-retry");
    assert.match(detail.explanation.nextAction, /A retry holds again unless the record is back at its position. If it is gone, rebaseline the source/);
  });
});
