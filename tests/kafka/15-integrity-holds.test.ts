import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig } from "@streamotter/contracts";
import { initJournal, nodeSupportsJournal, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import {
  brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produceRaw, startKafkaHarness, testAdmin, uniqueName,
  type KafkaHarness
} from "./helpers.ts";

/**
 * Source-integrity holds against a real broker (runbook §6.4 and §6.5): a held
 * record removed by retention is held again after a retry, never left
 * "retrying"; a different record at a held offset is an evidence conflict and
 * never resolves the incident; and an incident from another Kafka cluster holds
 * the source before anything from the cluster it now reads is processed.
 */

const available = await brokerAvailable();
const skip = !available ? "local Kafka is not running" : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;

async function setup(): Promise<{ topic: string; state: string; group: string; failureHandling: FailureHandlingConfig }> {
  const topic = await createTopic(1);
  const quarantine = await createTopic(1, [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }]);
  const state = await mkdtemp(join(tmpdir(), "so-kafka-integrity-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  return {
    topic, state, group: uniqueName("so-group"),
    failureHandling: { quarantine: { topic: quarantine, capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-hold" } } }
  };
}

async function incidents(k: KafkaHarness): Promise<IncidentRecord[]> {
  await k.internals.failuresSettled();
  return [...(k.internals.incidentStore() as IncidentStore).list({ state: "all" }).items];
}

async function heldIncident(k: KafkaHarness): Promise<IncidentRecord> {
  await waitFor(() => k.internals.sources()[0]?.status === "paused", 15_000, "paused");
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [incident] = await incidents(k);
    if (incident?.quarantine === "acknowledged") return incident;
    if (Date.now() > deadline) assert.fail(`never quarantined: ${JSON.stringify(incident ?? null)}`);
    await sleep(100);
  }
}

const valid = (revision: number) => Buffer.from(orderValue("acme", "ord_1", revision, "done", 100));

describe("source-integrity holds against Kafka", { skip }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => { await k?.close(); k = undefined; });
  after(() => closeKafkaHelpers());

  it("F1: after retention removes the held record, retry-current reports held with the moved diagnosis, every time", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    k.app.put("acme", "alice", "ord_1", 1, "processing", 10);
    const seen = observe(k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }, { key: Buffer.from("ord_1"), value: valid(2) }]);
    const held = await heldIncident(k);
    assert.equal(held.position.kind === "kafka" && held.position.offset, "0");

    // Retention removes the held record while it is held.
    const admin = await testAdmin();
    await admin.fetchTopicMetadata({ topics: [s.topic] }); // the shared admin client learns the new topic's leader
    await admin.deleteTopicRecords({ topic: s.topic, partitions: [{ partition: 0, offset: "1" }] });
    const op = getGatewayOperator(k.gateway);
    let revision = held.revision;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: revision });
      assert.equal(result.result, "completed", result.message);
      assert.equal(result.outcome, "held", `attempt ${attempt}: ${result.message}`);
      assert.match(result.message, /Source progress moved/);
      const detail = await op.showFailure({ failureId: held.failureId });
      assert.equal(detail.state, "open");
      assert.equal(detail.progress, "held", "never left retrying");
      assert.equal(detail.nextAction, "repair-and-retry");
      assert.match(detail.explanation.nextAction, /rebaseline the source/);
      revision = detail.revision;
    }
    assert.equal(k.internals.sources()[0]?.status, "paused");
    // KafkaJS records its "earliest" sentinel (-2) when it resets the out-of-range position; nothing past the record after the gap is committed.
    assert.ok(["-1", "-2"].includes((await committedOffsets(s.group, s.topic))[0] ?? ""), "the record after the gap is not processed or committed");
    assert.equal(seen.events.some(event => event.revision === "2"), false, "nor delivered");
  });

  it("F4: a different record at the held offset (a re-created topic) is an evidence conflict and never resolves the incident", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }]);
    const held = await heldIncident(k);
    await k.close();
    k = undefined;

    // The topic is re-created under the same name without a generation change, and a valid record now sits at offset 0.
    const admin = await testAdmin();
    await admin.deleteTopics({ topics: [s.topic], timeout: 15_000 });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if (await admin.createTopics({ topics: [{ topic: s.topic, numPartitions: 1 }], waitForLeaders: true })) break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
      }
      await sleep(500);
    }
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: valid(2) }]);

    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    k.app.put("acme", "alice", "ord_1", 1, "processing", 10);
    const seen = observe(k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => k!.internals.sources()[0]?.reason === "SOURCE_UNAVAILABLE", 15_000, "held");
    const [incident] = await incidents(k);
    assert.equal(incident?.failureId, held.failureId);
    assert.equal(incident?.state, "open", "not resolved as the original record");
    assert.match(incident?.diagnosis ?? "", /^The redelivered record's bytes differ from the evidence captured/);
    assert.equal(incident?.evidence.hash, held.evidence.hash, "the original evidence is kept");
    await sleep(1_000);
    assert.equal(seen.events.some(event => event.revision === "2"), false, "the other record was not delivered");
    assert.notEqual((await committedOffsets(s.group, s.topic))[0], "1", "nor committed");
  });

  it("F5: an incident captured on another cluster holds the source at startup, before any record of this cluster is processed", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: valid(2) }, { key: Buffer.from("ord_1"), value: Buffer.from("{not json") }]);
    const held = await heldIncident(k);
    assert.equal(held.position.kind === "kafka" && held.position.offset, "1");
    assert.equal((await committedOffsets(s.group, s.topic))[0], "1");
    await k.close();
    k = undefined;

    // As if the incident had been captured on another cluster: rewrite its recorded cluster ID in the stopped gateway's journal.
    const db = new DatabaseSync(join(s.state, "journal.sqlite"));
    db.prepare("UPDATE incidents SET record = json_set(record, '$.clusterId', 'another-cluster') WHERE failure_id = ?").run(held.failureId);
    db.close();
    // And this cluster has a record below the held offset to read: move the group back to it.
    await (await testAdmin()).setOffsets({ groupId: s.group, topic: s.topic, partitions: [{ partition: 0, offset: "0" }] });

    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state });
    const store = k.internals.incidentStore() as IncidentStore;
    const atStart = store.get(held.failureId);
    assert.match(atStart?.diagnosis ?? "", /^Kafka cluster mismatch: the incident was captured on cluster another-cluster/, "diagnosed at startup");
    await waitFor(() => k!.internals.sources()[0]?.reason === "SOURCE_UNAVAILABLE", 15_000, "held");
    await sleep(1_000);
    const [incident] = await incidents(k);
    assert.equal(incident?.state, "open");
    assert.match(incident?.diagnosis ?? "", /^Kafka cluster mismatch/, "not reported as position-moved");
    assert.equal(incident?.observations, held.observations, "the record at the held offset was not evaluated on this cluster");
    assert.equal((await committedOffsets(s.group, s.topic))[0], "0", "the record below the held offset was not processed from this cluster");
    const detail = await getGatewayOperator(k.gateway).showFailure({ failureId: held.failureId });
    assert.equal(detail.nextAction, "repair-and-retry");
    assert.match(detail.explanation.nextAction, /another Kafka cluster/);
  });
});
