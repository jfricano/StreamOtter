import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig } from "@streamotter/contracts";
import { initJournal, nodeSupportsJournal, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { sleep, waitFor } from "../integration/harness.ts";
import {
  closeKafkaHelpers, committedOffsets, createTopic, brokerAvailable, produceRaw, readTopic, startKafkaHarness, testAdmin,
  uniqueName, type KafkaHarness
} from "./helpers.ts";

/**
 * V1.1 slice B against a real broker: byte-preserving quarantine evidence,
 * the held offset never committed, one incident across restarts, a moved group
 * position held rather than treated as progress, and a long hold that keeps
 * group membership.
 */

const available = await brokerAvailable();
const skip = !available ? "local Kafka is not running" : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;
const QUARANTINE_TOPIC_BYTES = String(2 * 1024 * 1024);

async function setup(options: { partitions?: number; quarantineBytes?: string; quarantineTopic?: string } = {}): Promise<{
  topic: string; quarantine: string; state: string; group: string; failureHandling: FailureHandlingConfig;
}> {
  const topic = await createTopic(options.partitions ?? 1);
  const quarantine = options.quarantineTopic ?? await createTopic(1, [{ name: "max.message.bytes", value: options.quarantineBytes ?? QUARANTINE_TOPIC_BYTES }]);
  const state = await mkdtemp(join(tmpdir(), "so-kafka-journal-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  return {
    topic, quarantine, state, group: uniqueName("so-group"),
    failureHandling: { quarantine: { topic: quarantine, capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-hold" } } }
  };
}

async function incidentsOf(k: KafkaHarness): Promise<IncidentRecord[]> {
  await k.internals.failuresSettled();
  return [...(k.internals.incidentStore() as IncidentStore).list({ state: "all" }).items];
}

async function firstIncident(k: KafkaHarness, done: (incident: IncidentRecord) => boolean, timeoutMs = 15_000): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [incident] = await incidentsOf(k);
    if (incident !== undefined && done(incident)) return incident;
    if (Date.now() > deadline) assert.fail(`incident never reached the expected state: ${JSON.stringify(incident ?? null)}`);
    await sleep(100);
  }
}

describe("V1.1 slice B: quarantine-hold against Kafka", { skip }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => { await k?.close(); k = undefined; });
  after(() => closeKafkaHelpers());

  it("F10: quarantines the original bytes, headers and timestamp verbatim and never commits the held offset", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    const key = Buffer.from([0xff, 0x00, 0x7f, 0x80]);
    const value = Buffer.from([0x7b, 0xc3, 0x28, 0x7d]); // "{", an invalid UTF-8 sequence, "}"
    const timestamp = "1791000000000";
    await produceRaw(s.topic, [{ key, value, timestamp, headers: { trace: [Buffer.from("a"), Buffer.from([0x00, 0xff])], other: Buffer.from("x") } }]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "paused");
    const incident = await firstIncident(k, item => item.quarantine === "acknowledged");
    assert.equal(incident.failureClass, "invalid-json");
    assert.equal(incident.evidence.location, "kafka");
    assert.equal(incident.evidence.completeness, "complete");
    assert.equal(incident.evidence.valueBytes, 4);
    assert.equal(incident.evidence.keyBytes, 4);
    assert.equal(incident.evidence.headerCount, 3);
    assert.equal(incident.timestamp, new Date(Number(timestamp)).toISOString());
    assert.ok(incident.clusterId !== null && incident.clusterId.length > 0);
    assert.deepEqual(incident.position, { kind: "kafka", topic: s.topic, partition: 0, offset: "0" });
    assert.deepEqual(incident.quarantineCoordinates, { partition: 0, offset: "0" });

    const [written, ...extra] = await readTopic(s.quarantine, 1);
    assert.equal(extra.length, 0, "exactly one quarantine record");
    assert.ok(written !== undefined);
    assert.deepEqual(written.key, key);
    assert.deepEqual(written.value, value);
    const headers = written.headers ?? {};
    assert.deepEqual(headers["src.trace"], [Buffer.from("a"), Buffer.from([0x00, 0xff])], "repeated header values keep their order");
    assert.deepEqual(headers["src.other"], Buffer.from("x"));
    assert.equal(String(headers["streamotter-failure-id"]), incident.failureId);
    const envelope = JSON.parse(String(headers["streamotter-envelope"])) as Record<string, unknown>;
    assert.equal(envelope["envelopeVersion"], 1);
    assert.equal(envelope["failureId"], incident.failureId);
    assert.deepEqual(envelope["position"], { clusterId: incident.clusterId, topic: s.topic, partition: 0, offset: "0" });
    assert.ok(!JSON.stringify(envelope).includes("Ã"), "the envelope carries no payload bytes");
    assert.equal((await committedOffsets(s.group, s.topic))[0], "-1", "the held record is never committed");
  });

  it("holds a tombstone without quarantining it, because the class is not eligible", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: null }]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "paused");
    const [incident] = await incidentsOf(k);
    assert.equal(incident?.failureClass, "tombstone");
    assert.equal(incident?.policy, "pause");
    assert.equal(incident?.quarantine, "not-required");
    assert.equal((await readTopic(s.quarantine, 0, 1_000)).length, 0);
  });

  it("F15: after a restart the redelivered record is the same incident and is not quarantined again", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "paused");
    const first = await firstIncident(k, item => item.quarantine === "acknowledged");
    await k.close();

    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "paused after restart");
    await firstIncident(k, item => item.observations === 2);
    const items = await incidentsOf(k);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.failureId, first?.failureId);
    assert.equal(items[0]?.observations, 2);
    assert.equal(items[0]?.quarantine, "acknowledged");
    assert.equal((await readTopic(s.quarantine, 1)).length, 1, "no second quarantine write");
    assert.equal((await committedOffsets(s.group, s.topic))[0], "-1");
  });

  it("F27/F30: a group position moved past the held record outside StreamOtter holds the source", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await produceRaw(s.topic, [
      { key: Buffer.from("ord_1"), value: Buffer.from("{not json") },
      { key: Buffer.from("ord_1"), value: Buffer.from(JSON.stringify({ tenantId: "acme", revision: "2", order: { orderId: "ord_1", status: "done", progress: 100 } })) }
    ]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "paused");
    await firstIncident(k, item => item.quarantine === "acknowledged");
    await k.close();
    k = undefined;

    // Someone moves the group past the held record by hand.
    await (await testAdmin()).setOffsets({ groupId: s.group, topic: s.topic, partitions: [{ partition: 0, offset: "1" }] });

    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "held after the move");
    assert.equal(k.internals.sources()[0]?.reason, "SOURCE_UNAVAILABLE");
    const incident = await firstIncident(k, item => item.diagnosis.startsWith("Source progress moved"));
    assert.equal(incident.state, "open");
    await sleep(1_000);
    assert.equal((await committedOffsets(s.group, s.topic))[0], "1", "the record after the gap is not processed or committed");
  });

  it("refuses to start when the quarantine topic is missing or too small for the largest record", async () => {
    const missing = await setup({ quarantineTopic: uniqueName("so-missing") });
    await assert.rejects(
      startKafkaHarness({ topic: missing.topic, group: missing.group, failureHandling: missing.failureHandling, stateDirectory: missing.state }),
      (error: { code: string; message: string }) => { assert.equal(error.code, "CONFIG_INVALID"); assert.match(error.message, /quarantine topic is missing/); return true; }
    );
    const small = await setup({ quarantineBytes: "100000" });
    await assert.rejects(
      startKafkaHarness({ topic: small.topic, group: small.group, failureHandling: small.failureHandling, stateDirectory: small.state }),
      (error: { code: string; message: string }) => { assert.equal(error.code, "CONFIG_INVALID"); assert.match(error.message, /max\.message\.bytes \(100000\)/); return true; }
    );
  });

  it("a hold longer than the session timeout keeps group membership without a rebalance", { timeout: 120_000 }, async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 15_000, "paused");
    const admin = await testAdmin();
    const before = (await admin.describeGroups([s.group])).groups[0];
    await sleep(35_000);
    const later = (await admin.describeGroups([s.group])).groups[0];
    assert.equal(later?.state, "Stable");
    assert.equal(later?.members.length, 1);
    assert.equal(later?.members[0]?.memberId, before?.members[0]?.memberId, "the same member, so no rejoin happened");
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.equal((await committedOffsets(s.group, s.topic))[0], "-1");
  });
});
