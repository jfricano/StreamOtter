import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayLogger, ProjectConfig, SourceRecoveryHandlers } from "@streamotter/contracts";
import type { QuarantineOutcome, QuarantineWrite, QuarantineWriter } from "../src/failures/quarantine.ts";
import { FailureService, type FailureSource } from "../src/failures/service.ts";
import { MemoryIncidentStore, type IncidentStore } from "../src/failures/store.ts";
import type { AdvanceResult, HeldPosition, SourceAdapter, SourceInput } from "../src/sources/types.ts";

/** F14 and F11 at the unit tier: quarantine outcomes drive incident state, and nothing is ever reported as success without an acknowledgment. */

const silent: GatewayLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const config = {
  configVersion: 1,
  projectId: "order-dashboard",
  sources: { orders: { kind: "kafka", generation: "orders-1", connectionRef: "cluster", topics: ["orders"], consumerGroup: "g", codec: "json", startFrom: "earliest" } },
  failureHandling: { quarantine: { topic: "orders.quarantine", capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-hold" } } }
} as unknown as ProjectConfig;

const source: FailureSource = { id: "orders", config: config.sources["orders"] as FailureSource["config"], adapter: null };

const input: SourceInput = {
  key: "ord_1",
  bytes: Buffer.from("{not json"),
  keyBytes: Buffer.from("ord_1"),
  headers: [{ name: "trace", value: Buffer.from("t1") }],
  timestamp: "2026-10-03T00:00:00.000Z",
  position: { kind: "kafka", topic: "orders", partition: 0, offset: "41" }
};
const pause = { kind: "pause", code: "INVALID_PAYLOAD", failureClass: "invalid-json", stage: "validate", channel: null, diagnosis: "bad JSON" } as const;

class ScriptedWriter implements QuarantineWriter {
  readonly writes: QuarantineWrite[] = [];
  readonly outcomes: QuarantineOutcome[];
  constructor(outcomes: QuarantineOutcome[]) { this.outcomes = outcomes; }
  async publish(write: QuarantineWrite): Promise<QuarantineOutcome> {
    this.writes.push(write);
    return this.outcomes.shift() ?? { kind: "failed", reason: "no scripted outcome" };
  }
  async stop(): Promise<void> {}
}

function service(writer: QuarantineWriter, maxSourceRecordBytes = 1_048_576): FailureService {
  const failures = new FailureService({
    config, store: new MemoryIncidentStore(), logger: silent, quarantine: writer,
    configFingerprint: "c".repeat(64), handlerBuildId: "build-7", maxSourceRecordBytes
  });
  failures.setClusterId("orders", "cluster-a");
  return failures;
}

describe("FailureService quarantine outcomes", () => {
  it("F14: an unknown write is never success; a later acknowledged write completes the same incident", async () => {
    const writer = new ScriptedWriter([{ kind: "unknown", reason: "REQUEST_TIMEOUT" }, { kind: "acknowledged", partition: 2, offset: "9" }]);
    const failures = service(writer);
    await failures.held(source, input, pause);
    let [incident] = failures.store.open("orders");
    assert.equal(incident?.quarantine, "unknown");
    assert.equal(incident?.progress, "held");
    assert.equal(incident?.quarantineCoordinates, null);

    await failures.held(source, input, pause);
    [incident] = failures.store.open("orders");
    assert.equal(failures.store.list({ state: "all" }).items.length, 1, "the duplicate shares the stable incident identity");
    assert.equal(incident?.quarantine, "acknowledged");
    assert.deepEqual(incident?.quarantineCoordinates, { partition: 2, offset: "9" });
    assert.equal(writer.writes.length, 2);
    assert.equal(writer.writes[0]?.failureId, writer.writes[1]?.failureId);
    assert.deepEqual(failures.store.events(incident?.failureId as string).map(event => event.event),
      ["detected", "captured", "quarantine-unknown", "detected", "captured", "quarantined"]);
  });

  it("a definite refusal is recorded as failed and the record stays held", async () => {
    const failures = service(new ScriptedWriter([{ kind: "failed", reason: "TOPIC_AUTHORIZATION_FAILED" }]));
    await failures.held(source, input, pause);
    const [incident] = failures.store.open("orders");
    assert.equal(incident?.quarantine, "failed");
    assert.equal(incident?.progress, "held");
  });

  it("the envelope is compact metadata with provenance and no payload bytes", async () => {
    const writer = new ScriptedWriter([{ kind: "acknowledged", partition: 0, offset: "0" }]);
    await service(writer).held(source, input, pause);
    const envelope = JSON.parse(writer.writes[0]?.envelope as string) as Record<string, unknown>;
    assert.equal(envelope["envelopeVersion"], 1);
    assert.deepEqual(envelope["position"], { clusterId: "cluster-a", topic: "orders", partition: 0, offset: "41" });
    assert.deepEqual((envelope["provenance"] as Record<string, unknown>)["handlerBuildId"], "build-7");
    assert.ok(!(writer.writes[0]?.envelope as string).includes("not json"));
    assert.deepEqual(Buffer.from(writer.writes[0]?.evidence.value as Uint8Array).toString(), "{not json");
  });

  it("F11: evidence above the capture budget is never written", async () => {
    const writer = new ScriptedWriter([{ kind: "acknowledged", partition: 0, offset: "0" }]);
    const failures = service(writer, 4);
    await failures.held(source, input, pause);
    const [incident] = failures.store.open("orders");
    assert.equal(incident?.evidence.completeness, "incomplete");
    assert.equal(writer.writes.length, 0);
    assert.equal(incident?.recovery, "held");
  });

  it("a held record that commits later resolves as processed; other records leave it open", async () => {
    const failures = service(new ScriptedWriter([{ kind: "acknowledged", partition: 0, offset: "0" }]));
    await failures.held(source, input, pause);
    failures.committed("orders", { kind: "kafka", topic: "orders", partition: 1, offset: "41" });
    assert.equal(failures.store.open("orders").length, 1);
    failures.committed("orders", input.position);
    assert.equal(failures.store.open("orders").length, 0);
    assert.equal(failures.store.list({ state: "all" }).items[0]?.progress, "processed");
  });

  it("positionProblem flags only a later offset on the held partition", async () => {
    const failures = service(new ScriptedWriter([{ kind: "acknowledged", partition: 0, offset: "0" }]));
    await failures.held(source, input, pause);
    assert.equal(failures.positionProblem("orders", { kind: "kafka", topic: "orders", partition: 0, offset: "41" }), null);
    assert.equal(failures.positionProblem("orders", { kind: "kafka", topic: "orders", partition: 1, offset: "99" }), null);
    assert.match(failures.positionProblem("orders", { kind: "kafka", topic: "orders", partition: 0, offset: "42" }) ?? "", /past the held record at offset 41/);
  });
});

// --- guarded continuation and progress watching -----------------------------------------

type Policy = "quarantine-hold" | "quarantine-resync" | "pause";

function configFor(policy: Policy): ProjectConfig {
  return { ...config, failureHandling: { quarantine: { topic: "orders.quarantine", capture: "full-record" }, sources: { orders: { invalidJson: policy } } } } as unknown as ProjectConfig;
}

const plain: SourceInput = { key: "ord_1", bytes: Buffer.from("{not json"), keyBytes: Buffer.from("ord_1"), headers: [], timestamp: null, position: { kind: "kafka", topic: "orders", partition: 0, offset: "41" } };
const at = (partition: number, offset: string) => ({ kind: "kafka" as const, topic: "orders", partition, offset });

class FakeAdapter implements SourceAdapter {
  readonly kind = "kafka" as const;
  readonly calls: HeldPosition[] = [];
  result: AdvanceResult;
  resumed = 0;
  constructor(result: AdvanceResult) { this.result = result; }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async resume(): Promise<void> { this.resumed++; }
  async check(): Promise<[]> { return []; }
  async advancePast(held: HeldPosition): Promise<AdvanceResult> {
    this.calls.push(held);
    if (this.result === "advanced") this.resumed++;
    return this.result;
  }
}

const recoverable: SourceRecoveryHandlers = { recover: async () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "outbox:1" }) };

function resync(store: IncidentStore, options: {
  policy?: Policy; adapter?: SourceAdapter | null; guard?: SourceRecoveryHandlers | null; clusterId?: string | null; writer?: QuarantineWriter;
  stopSignal?: AbortSignal; logger?: GatewayLogger;
} = {}): { failures: FailureService; source: FailureSource } {
  const policyConfig = configFor(options.policy ?? "quarantine-resync");
  const failures = new FailureService({
    config: policyConfig, store, logger: options.logger ?? silent, quarantine: options.writer ?? new ScriptedWriter(Array.from({ length: 10 }, (_, offset) => ({ kind: "acknowledged" as const, partition: 0, offset: String(offset) }))),
    configFingerprint: "c".repeat(64), handlerBuildId: "build-7", maxSourceRecordBytes: 1_048_576,
    guards: options.guard === null ? {} : { orders: options.guard ?? recoverable },
    ...(options.stopSignal === undefined ? {} : { stopSignal: options.stopSignal })
  });
  if (options.clusterId !== null) failures.setClusterId("orders", options.clusterId ?? "cluster-a");
  return { failures, source: { id: "orders", config: policyConfig.sources["orders"] as FailureSource["config"], adapter: options.adapter === undefined ? new FakeAdapter("advanced") : options.adapter } };
}

function claimed(): MemoryIncidentStore {
  const store = new MemoryIncidentStore();
  store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  return store;
}

describe("FailureService progress watching", () => {
  it("keeps holding an unexplained position after restart when another partition commits (spec §6)", async () => {
    const store = claimed();
    const first = resync(store, { adapter: new FakeAdapter("uncertain") });
    await first.failures.held(first.source, plain, pause);
    assert.equal(store.open("orders")[0]?.progress, "uncertain");

    // Restart: the group's committed offset is 50, past 42, which this gateway never recorded.
    const second = resync(store, { adapter: null });
    await second.failures.start([second.source], async () => "50");
    assert.match(store.open("orders")[0]?.diagnosis ?? "", /^Source progress moved/);
    assert.notEqual(second.failures.positionProblem("orders", at(0, "50")), null);
    assert.notEqual(second.failures.positionProblem("orders", at(1, "7")), null, "an uncertain advance holds the whole source");
    // Even if a record on another partition had committed, the unexplained position stays watched.
    second.failures.committed("orders", at(1, "7"));
    assert.notEqual(second.failures.positionProblem("orders", at(0, "50")), null);
    assert.equal(store.open("orders")[0]?.progress, "uncertain");
  });
});
