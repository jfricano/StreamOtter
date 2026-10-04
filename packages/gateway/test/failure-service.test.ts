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
