import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayLogger, ProjectConfig } from "@streamotter/contracts";
import type { QuarantineOutcome, QuarantineWrite, QuarantineWriter } from "../src/failures/quarantine.ts";
import { FailureService, type FailureSource } from "../src/failures/service.ts";
import { MemoryIncidentStore } from "../src/failures/store.ts";
import type { SourceInput } from "../src/sources/types.ts";

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
