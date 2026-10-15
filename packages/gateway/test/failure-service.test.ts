import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayLogger, ProjectConfig, SourceRecoveryHandlers } from "@streamotter/contracts";
import type { QuarantineOutcome, QuarantineWrite, QuarantineWriter } from "../src/failures/quarantine.ts";
import { FailureService, type FailureSource } from "../src/failures/service.ts";
import { MemoryIncidentStore, type IncidentStore } from "../src/failures/store.ts";
import { FixtureSourceAdapter } from "../src/sources/fixture.ts";
import type { AdvanceResult, HeldPosition, SourceAdapter, SourceInput, SourceSink } from "../src/sources/types.ts";

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

describe("FailureService local evidence retention", () => {
  it("expires local fixture evidence older than seven days when it starts", t => {
    const store = new MemoryIncidentStore();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    store.putEvidence("f1:old", { key: null, value: new Uint8Array(4), headers: [] });
    t.mock.timers.reset();
    store.putEvidence("f1:recent", { key: null, value: new Uint8Array(4), headers: [] });
    new FailureService({
      config, store, logger: silent, quarantine: null,
      configFingerprint: "c".repeat(64), handlerBuildId: "build-7", maxSourceRecordBytes: 1_048_576
    });
    assert.equal(store.getEvidence("f1:old"), null);
    assert.notEqual(store.getEvidence("f1:recent"), null);
  });

  it("expires local fixture evidence older than seven days before it stores more", async t => {
    const store = new MemoryIncidentStore();
    const failures = new FailureService({
      config, store, logger: silent, quarantine: null,
      configFingerprint: "c".repeat(64), handlerBuildId: "build-7", maxSourceRecordBytes: 1_048_576
    });
    // Stored after the startup prune ran, as in a gateway left running for over a week.
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() - 8 * 24 * 60 * 60 * 1000 });
    store.putEvidence("f1:old", { key: null, value: new Uint8Array(4), headers: [] });
    t.mock.timers.reset();
    const fixture: FailureSource = { ...source, config: { ...source.config, kind: "fixture" } as FailureSource["config"] };
    await failures.held(fixture, { ...input, position: { kind: "fixture", index: "0" } }, pause);
    assert.equal(store.getEvidence("f1:old"), null);
    const [incident] = store.open("orders");
    assert.equal(incident?.evidence.location, "local");
    assert.notEqual(store.getEvidence(incident?.failureId as string), null, "the new evidence is stored");
  });
});

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
    if (this.result === "advanced") {
      // Like the real adapters: the advance is committed, then the caller records it, and only then does consumption resume.
      if (held.confirmed !== undefined && !(await held.confirmed())) return "advanced";
      this.resumed++;
    }
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

describe("FailureService cluster identity (ADR-15A §3)", () => {
  const holdGuard: SourceRecoveryHandlers = { recover: async () => ({ decision: "hold", reason: "not yet" }) };

  it("never quarantines or advances an incident captured on another Kafka cluster", async () => {
    const store = claimed();
    const first = resync(store, { guard: holdGuard, clusterId: "cluster-a" });
    await first.failures.held(first.source, plain, pause);
    assert.equal(store.open("orders")[0]?.clusterId, "cluster-a");

    // The profile now points at another cluster with the same generation, and the record at the same coordinates fails.
    const adapter = new FakeAdapter("advanced");
    const writer = new ScriptedWriter([{ kind: "acknowledged", partition: 0, offset: "5" }]);
    const second = resync(store, { adapter, writer, clusterId: "cluster-b" });
    await second.failures.start([second.source], async () => "41");
    await second.failures.held(second.source, plain, pause);
    const [incident] = store.open("orders");
    assert.equal(adapter.calls.length, 0, "never advanced");
    assert.equal(writer.writes.length, 0, "never quarantined under the other cluster's coordinates");
    assert.equal(incident?.progress, "held");
    assert.equal(incident?.recovery, "held");
    assert.match(incident?.diagnosis ?? "", /^Kafka cluster mismatch: .*cluster-a.*cluster cluster-b/);
  });

  it("checks the cluster again after the guard, before the advance is prepared", async () => {
    const store = claimed();
    const adapter = new FakeAdapter("advanced");
    let failures!: FailureService;
    const guard: SourceRecoveryHandlers = { recover: async () => { failures.setClusterId("orders", "cluster-b"); return { decision: "recoverable", context: { watermark: 1 }, evidenceRef: "outbox:1" }; } };
    const built = resync(store, { adapter, guard, clusterId: "cluster-a" });
    failures = built.failures;
    await failures.held(built.source, plain, pause);
    assert.equal(adapter.calls.length, 0);
    assert.equal(store.boundary("orders"), null, "no boundary was prepared");
    assert.match(store.open("orders")[0]?.diagnosis ?? "", /^Kafka cluster mismatch/);
  });

  it("does not reconcile a prepared advance against another cluster's committed offset", async () => {
    const store = claimed();
    const first = resync(store, { clusterId: "cluster-a" });
    await first.failures.held(first.source, plain, pause);
    const [held] = store.list({ state: "all" }).items;
    store.update(held?.failureId as string, held?.revision as number, { progress: "advance-pending", state: "open", resolution: null }, { event: "advance-pending", detail: null, operationId: null });

    const second = resync(store, { adapter: null, clusterId: "cluster-b" });
    await second.failures.start([second.source], async () => "42");
    const [incident] = store.open("orders");
    assert.equal(incident?.progress, "uncertain", "offset + 1 on cluster-b confirms nothing about cluster-a");
    assert.match(incident?.diagnosis ?? "", /^Kafka cluster mismatch/);
  });
});

describe("FailureService retries and queued dispositions", () => {
  it("opens no incident for a record that processed and committed before its disposition ran", async () => {
    const store = claimed();
    const { failures, source } = resync(store, { policy: "pause", adapter: null, guard: null });
    const pending = failures.held(source, plain, pause);
    failures.committed("orders", plain.position);
    await pending;
    assert.deepEqual(store.open("orders"), []);
    assert.equal(failures.positionProblem("orders", at(0, "42")), null, "the next record is not held as progress moved");
  });

  it("a retry waits for the queued disposition, so the held record's incident exists and is marked retrying", async () => {
    const store = claimed();
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const writer: QuarantineWriter = {
      publish: async () => { await released; return { kind: "acknowledged", partition: 0, offset: "1" }; },
      stop: async () => undefined
    };
    const { failures, source } = resync(store, { policy: "quarantine-hold", writer, adapter: null, guard: null });
    void failures.held(source, plain, pause);
    let retried = false;
    const retry = failures.beforeRetry("orders", "operator retry").then(() => { retried = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(retried, false, "the retry waits while the quarantine write is in flight");
    release();
    await retry;
    const [incident] = store.open("orders");
    assert.equal(incident?.progress, "retrying");
    assert.equal(incident?.quarantine, "acknowledged");
    failures.committed("orders", plain.position);
    assert.deepEqual(store.open("orders"), [], "the retried record resolves its incident when it commits");
  });

  it("an operator action already in the source's chain can retry without waiting on itself", async () => {
    const store = claimed();
    const { failures, source } = resync(store, { policy: "pause", adapter: null, guard: null });
    await failures.held(source, plain, pause);
    await failures.run("orders", () => failures.beforeRetry("orders", "operator retry"));
    assert.equal(store.open("orders")[0]?.progress, "retrying");
  });
});

describe("FailureService guard exits", () => {
  it("puts recovery back to held when the gateway stops while the guard runs", async () => {
    const store = claimed();
    const controller = new AbortController();
    const guard: SourceRecoveryHandlers = { recover: () => new Promise(() => { controller.abort(); }) };
    const adapter = new FakeAdapter("advanced");
    const { failures, source } = resync(store, { guard, adapter, stopSignal: controller.signal });
    await failures.held(source, plain, pause);
    const [incident] = store.open("orders");
    assert.equal(incident?.progress, "held");
    assert.equal(incident?.recovery, "held", "not left guard-pending, which refuses operator actions");
    assert.equal(adapter.calls.length, 0);
  });

  it("puts recovery back to held when the advance cannot be prepared", async () => {
    const store = claimed();
    const errors: string[] = [];
    const logger: GatewayLogger = { info: () => undefined, warn: () => undefined, error: message => { errors.push(message); } };
    const adapter = new FakeAdapter("advanced");
    const { failures, source } = resync(store, { adapter, logger });
    store.prepareAdvance = () => { throw new Error("disk I/O error"); };
    await failures.held(source, plain, pause);
    const [incident] = store.open("orders");
    assert.equal(incident?.recovery, "held");
    assert.equal(adapter.calls.length, 0);
    assert.ok(errors.some(message => /recovery boundary could not be persisted/.test(message)));
  });
});

describe("FailureService recording a confirmed advance", () => {
  /** Fails the journal write that records the advance, like a full or broken journal at that moment. */
  function failAdvanceRecord(store: IncidentStore): void {
    const update = store.update.bind(store);
    store.update = (failureId, revision, patch, event) => {
      if (event.event === "advance-confirmed") throw new Error("disk I/O error");
      return update(failureId, revision, patch, event);
    };
  }

  it("keeps the source paused when the advance cannot be journaled, and a restart confirms it", async () => {
    const store = claimed();
    const adapter = new FakeAdapter("advanced");
    const { failures, source } = resync(store, { adapter });
    const update = store.update;
    failAdvanceRecord(store);
    await failures.held(source, plain, pause);
    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.resumed, 0, "nothing after the record is consumed while the journal says advance-pending");
    assert.equal(store.open("orders")[0]?.progress, "advance-pending");

    store.update = update;
    const restarted = resync(store, { adapter: null });
    await restarted.failures.start([restarted.source], async () => "42");
    const [incident] = store.list({ state: "all" }).items;
    assert.equal(incident?.progress, "advanced", "offset + 1 confirms the gateway's own advance, never 'progress moved'");
  });

  it("the fixture adapter resumes only after the advance is recorded", async () => {
    const fixtureConfig = {
      ...configFor("quarantine-resync"),
      sources: { orders: { kind: "fixture", generation: "orders-1", fixtureRef: "orders" } }
    } as unknown as ProjectConfig;
    const store = new MemoryIncidentStore();
    store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "fixture" }]);
    const failures = new FailureService({
      config: fixtureConfig, store, logger: silent, quarantine: null, configFingerprint: "c".repeat(64), handlerBuildId: "build-7",
      maxSourceRecordBytes: 1_048_576, guards: { orders: recoverable }
    });
    let source!: FailureSource;
    const sink: SourceSink = {
      process: async () => ({ kind: "pause", code: "INVALID_PAYLOAD", failureClass: "invalid-json", stage: "validate", channel: null, diagnosis: "bad JSON" }),
      setStatus: () => undefined,
      held: (input, outcome) => { void failures.held(source, input, outcome); },
      logger: silent,
      stopSignal: new AbortController().signal
    };
    const fixture = new FixtureSourceAdapter([{ key: "ord_1", raw: "{not json" }, { key: "ord_2", raw: "{}" }], sink, position => failures.committed("orders", position));
    source = { id: "orders", config: fixtureConfig.sources["orders"] as FailureSource["config"], adapter: fixture };
    failAdvanceRecord(store);
    await fixture.advance(1);
    await failures.settled();
    assert.equal(store.open("orders")[0]?.progress, "advance-pending");
    assert.equal(fixture.position.paused, true, "the fixture stays paused while the advance is unrecorded");
  });
});

describe("FailureService superseded changes", () => {
  it("a quarantine write that finishes after an operator retry is recorded, and is not a journal failure", async () => {
    const store = claimed();
    let failures!: FailureService;
    const writer: QuarantineWriter = {
      publish: async write => {
        // While the write is in flight, an operator retries (revision bump) and the retried record processes and commits.
        const current = store.get(write.failureId) as NonNullable<ReturnType<IncidentStore["get"]>>;
        store.update(current.failureId, current.revision, { progress: "retrying" }, { event: "operator", detail: "retry-current", operationId: "op-1" });
        failures.committed("orders", plain.position);
        return { kind: "acknowledged", partition: 3, offset: "17" };
      },
      stop: async () => undefined
    };
    const built = resync(store, { policy: "quarantine-hold", writer, adapter: null, guard: null });
    failures = built.failures;
    await failures.held(built.source, plain, pause);
    const [incident] = store.list({ state: "all" }).items;
    assert.equal(failures.journalError, null, "readiness does not report a journal failure");
    assert.equal(incident?.state, "resolved");
    assert.equal(incident?.progress, "processed");
    assert.equal(incident?.quarantine, "acknowledged", "the copy that was written is recorded, not left pending");
    assert.deepEqual(incident?.quarantineCoordinates, { partition: 3, offset: "17" });
  });
});

describe("FailureService a held record that is gone (runbook §6.4)", () => {
  it("a retry of a record retention removed is held again with the moved diagnosis, and can be retried again", async () => {
    const store = claimed();
    const { failures, source } = resync(store, { policy: "quarantine-hold", adapter: null, guard: null });
    await failures.held(source, plain, pause);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await failures.beforeRetry("orders", "operator retry");
      assert.equal(store.open("orders")[0]?.progress, "retrying");
      // The redelivered position is past the held offset: the record at 41 is gone.
      assert.match(failures.positionProblem("orders", at(0, "45")) ?? "", /past the held record at offset 41/);
      const [incident] = store.open("orders");
      assert.equal(incident?.progress, "held", `attempt ${attempt}: held again, never left retrying`);
      assert.match(incident?.diagnosis ?? "", /^Source progress moved: partition orders\/0 is at offset 45/);
    }
    const moved = store.events(store.open("orders")[0]?.failureId as string).filter(event => event.detail === "position-moved");
    assert.equal(moved.length, 2, "each settled retry is recorded");
  });

  it("a retry that pauses again at one held record returns every other retried incident of the source to held", async () => {
    const store = claimed();
    const { failures, source } = resync(store, { policy: "quarantine-hold", adapter: null, guard: null });
    const other: SourceInput = { ...plain, key: "ord_2", keyBytes: Buffer.from("ord_2"), position: at(1, "7") };
    await failures.held(source, plain, pause);
    await failures.held(source, other, pause);
    // The resume redelivers from every held partition, so both are retried.
    await failures.beforeRetry("orders", "operator retry");
    assert.deepEqual(store.open("orders").map(incident => incident.progress), ["retrying", "retrying"]);

    // Partition 1 is redelivered first and fails again: the source pauses, and partition 0 is never redelivered.
    failures.sourceHeld("orders", other.position);
    const byPartition = (partition: number) => store.open("orders").find(incident => incident.position.kind === "kafka" && incident.position.partition === partition);
    assert.equal(byPartition(0)?.progress, "held", "not stranded in retrying");
    assert.match(store.events(byPartition(0)?.failureId as string).at(-1)?.detail ?? "", /paused again at orders\/1 offset 7 before this record was redelivered/);
    assert.equal(byPartition(1)?.progress, "retrying", "the record paused at settles through its own disposition");
    await failures.held(source, other, pause);
    assert.equal(byPartition(1)?.progress, "held");
    assert.match(store.events(byPartition(1)?.failureId as string).at(-1)?.detail ?? "", /failed again/);

    // Both can be retried again.
    await failures.beforeRetry("orders", "operator retry");
    assert.deepEqual(store.open("orders").map(incident => incident.progress), ["retrying", "retrying"]);
  });

  it("an incident persisted as retrying is held again at startup, because no retry runs in a new process", async () => {
    const store = claimed();
    const first = resync(store, { policy: "quarantine-hold", adapter: null, guard: null });
    await first.failures.held(first.source, plain, pause);
    await first.failures.beforeRetry("orders", "operator retry");
    assert.equal(store.open("orders")[0]?.progress, "retrying");

    const second = resync(store, { policy: "quarantine-hold", adapter: null, guard: null });
    await second.failures.start([second.source], async () => "-1");
    const [incident] = store.open("orders");
    assert.equal(incident?.progress, "held");
    assert.match(store.events(incident?.failureId as string).at(-1)?.detail ?? "", /restarted during a retry/);
  });
});

describe("FailureService a different record at a held position (runbook §6.5)", () => {
  const corrected: SourceInput = { ...plain, bytes: Buffer.from(JSON.stringify({ tenantId: "acme", revision: "2", order: { orderId: "ord_1", status: "done", progress: 100 } })) };

  it("Kafka: a record whose bytes differ is held as an evidence conflict before it is processed, and never resolves the incident", async () => {
    const store = claimed();
    const { failures, source } = resync(store, { policy: "quarantine-hold", adapter: null, guard: null });
    await failures.held(source, plain, pause);
    const [held] = store.open("orders");
    assert.equal(failures.positionProblem("orders", plain.position, plain), null, "the same bytes are the held record");

    assert.match(failures.positionProblem("orders", corrected.position, corrected) ?? "", /different bytes than the evidence .*evidence-conflict/);
    let [incident] = store.open("orders");
    assert.match(incident?.diagnosis ?? "", /^The redelivered record's bytes differ from the evidence captured/);
    assert.equal(incident?.evidence.hash, held?.evidence.hash, "the original evidence is kept");
    assert.equal(store.events(held?.failureId as string).at(-1)?.detail, "evidence-conflict");
    // Even a commit reported at the position (which the hold prevents) never resolves it as the original record.
    failures.committed("orders", corrected.position);
    [incident] = store.open("orders");
    assert.equal(incident?.state, "open");

    // A retry that meets the conflicting record again settles as held, not retrying.
    await failures.beforeRetry("orders", "operator retry");
    assert.notEqual(failures.positionProblem("orders", corrected.position, corrected), null);
    assert.equal(store.open("orders")[0]?.progress, "held");
  });

  it("fixture: a corrected record at the held position resolves as a corrected record, keeping the original evidence", async () => {
    const store = new MemoryIncidentStore();
    store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "fixture" }]);
    const fixtureConfig = { ...configFor("quarantine-hold"), sources: { orders: { kind: "fixture", generation: "orders-1", fixtureRef: "orders" } } } as unknown as ProjectConfig;
    const failures = new FailureService({
      config: fixtureConfig, store, logger: silent, quarantine: null, configFingerprint: "c".repeat(64), handlerBuildId: "build-7", maxSourceRecordBytes: 1_048_576
    });
    const fixture: FailureSource = { id: "orders", config: fixtureConfig.sources["orders"] as FailureSource["config"], adapter: null };
    const bad: SourceInput = { key: "ord_1", bytes: Buffer.from("{not json"), keyBytes: Buffer.from("ord_1"), headers: [], timestamp: null, position: { kind: "fixture", index: "2" } };
    await failures.held(fixture, bad, pause);
    const [held] = store.open("orders");
    assert.equal(held?.evidence.location, "local");

    const { bytes: _bytes, ...rest } = bad;
    const fixed: SourceInput = { ...rest, value: { tenantId: "acme", revision: "3", order: { orderId: "ord_1", status: "done", progress: 100 } } };
    assert.equal(failures.positionProblem("orders", fixed.position, fixed), null, "the corrected fixture record is processed");
    failures.committed("orders", fixed.position);
    const [resolved] = store.list({ state: "all" }).items;
    assert.equal(resolved?.state, "resolved");
    assert.equal(resolved?.progress, "processed");
    assert.equal(resolved?.resolution, "a corrected record at the same position processed");
    assert.match(store.events(held?.failureId as string).at(-1)?.detail ?? "", /different record .* the original record did not/);
    assert.equal(resolved?.evidence.hash, held?.evidence.hash);
    assert.equal(Buffer.from(store.getEvidence(held?.failureId as string)?.value as Uint8Array).toString(), "{not json", "the original evidence is kept");
  });

  it("fixture: the unchanged record that processes resolves as the original", async () => {
    const store = new MemoryIncidentStore();
    store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "fixture" }]);
    const fixtureConfig = { ...configFor("pause"), sources: { orders: { kind: "fixture", generation: "orders-1", fixtureRef: "orders" } } } as unknown as ProjectConfig;
    const failures = new FailureService({
      config: fixtureConfig, store, logger: silent, quarantine: null, configFingerprint: "c".repeat(64), handlerBuildId: "build-7", maxSourceRecordBytes: 1_048_576
    });
    const fixture: FailureSource = { id: "orders", config: fixtureConfig.sources["orders"] as FailureSource["config"], adapter: null };
    const record: SourceInput = { key: "ord_1", value: { a: 1 }, keyBytes: Buffer.from("ord_1"), headers: [], timestamp: null, position: { kind: "fixture", index: "0" } };
    await failures.held(fixture, record, { ...pause, code: "HANDLER_FAILED", failureClass: "mapper-error", stage: "map" });
    assert.equal(failures.positionProblem("orders", record.position, { ...record, value: { a: 1 } }), null);
    failures.committed("orders", record.position);
    assert.equal(store.list({ state: "all" }).items[0]?.resolution, "processed after retry");
  });
});

describe("FailureService an incident from another Kafka cluster (runbook §6.4)", () => {
  it("holds at startup with the cluster-mismatch diagnosis, and nothing from the other cluster is processed or resolves it", async () => {
    const store = claimed();
    const first = resync(store, { policy: "quarantine-hold", guard: null, clusterId: "cluster-a" });
    await first.failures.held(first.source, plain, pause);
    const [held] = store.open("orders");

    const second = resync(store, { policy: "quarantine-hold", guard: null, adapter: null, clusterId: "cluster-b" });
    assert.deepEqual([...await second.failures.start([second.source], async () => "-1")], ["orders"], "reported to hold from startup, before any record");
    let [incident] = store.open("orders");
    assert.match(incident?.diagnosis ?? "", /^Kafka cluster mismatch: the incident was captured on cluster cluster-a, but the source now reads cluster cluster-b/);
    assert.equal(store.events(held?.failureId as string).at(-1)?.detail, "cluster-mismatch at startup");

    // Every record of the source holds: below the held offset, at it (even a record that would process), past it, and on other partitions.
    for (const position of [at(0, "40"), at(0, "41"), at(0, "42"), at(3, "0")]) {
      assert.match(second.failures.positionProblem("orders", position, { ...plain, position, bytes: Buffer.from("{}") }) ?? "", /captured on Kafka cluster cluster-a, but the source now reads cluster cluster-b/);
    }
    second.failures.committed("orders", plain.position);
    [incident] = store.open("orders");
    assert.equal(incident?.state, "open", "a commit on the other cluster never resolves it");
    assert.match(incident?.diagnosis ?? "", /^Kafka cluster mismatch/, "not reported as position-moved");

    // A retry could never settle here, because nothing from this cluster is processed: it is refused, and the incident stays held.
    await assert.rejects(second.failures.beforeRetry("orders", "operator retry"),
      (error: { details?: Record<string, unknown> }) => error.details?.["reason"] === "cluster-mismatch");
    assert.equal(store.open("orders")[0]?.progress, "held");

    // Back on the original cluster, the record processes and resolves the incident.
    const third = resync(store, { policy: "quarantine-hold", guard: null, adapter: null, clusterId: "cluster-a" });
    assert.equal((await third.failures.start([third.source], async () => "-1")).size, 0, "not held from startup on the original cluster");
    assert.equal(third.failures.positionProblem("orders", plain.position, plain), null);
    third.failures.committed("orders", plain.position);
    assert.equal(store.list({ state: "all" }).items[0]?.state, "resolved");
  });

  it("an unknown current cluster (a source that no longer quarantines) is not by itself a reason to hold", async () => {
    const store = claimed();
    const first = resync(store, { policy: "quarantine-hold", guard: null, clusterId: "cluster-a" });
    await first.failures.held(first.source, plain, pause);
    const second = resync(store, { policy: "pause", guard: null, adapter: null, clusterId: null });
    assert.equal((await second.failures.start([second.source], async () => "-1")).size, 0);
    assert.equal(second.failures.positionProblem("orders", plain.position, plain), null);
    second.failures.committed("orders", plain.position);
    assert.equal(store.list({ state: "all" }).items[0]?.progress, "processed");
  });
});
