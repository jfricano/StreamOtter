import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, Json, SourceRecoveryHandlers } from "@streamotter/contracts";
import { initJournal, nodeSupportsJournal } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { observe, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, createTopic, orderValue, produceRaw, startKafkaHarness, testAdmin, uniqueName, type KafkaHarness } from "./helpers.ts";

/**
 * V1.1 slice D against a real broker: the operator reads the quarantined
 * original back from the quarantine topic for show, evaluate and redrive, and
 * reports expired evidence once the topic no longer retains it (F28, F31, F33).
 */

const available = await brokerAvailable();
const skip = !available ? "local Kafka is not running" : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;

const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "kafka-test" }) };
/** Valid JSON whose status is outside the channel's payload schema. */
const shipped = (revision: number) => Buffer.from(orderValue("acme", "ord_1", revision, "shipped" as "done", 100));
const repairedMap = (value: Json) => {
  const record = value as { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
  return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: { ...record.order, status: record.order.status === "shipped" ? "done" : record.order.status } }];
};

async function setup(): Promise<{ topic: string; quarantine: string; state: string; group: string; failureHandling: FailureHandlingConfig }> {
  const topic = await createTopic(1);
  const quarantine = await createTopic(1, [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }]);
  const state = await mkdtemp(join(tmpdir(), "so-kafka-operator-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  return {
    topic, quarantine, state, group: uniqueName("so-group"),
    failureHandling: {
      quarantine: { topic: quarantine, capture: "full-record" },
      sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync", replaySafeMapping: true } }
    } as FailureHandlingConfig
  };
}

describe("V1.1 slice D: operator read-back against Kafka", { skip }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => { await k?.close(); k = undefined; });
  after(() => closeKafkaHelpers());

  async function advancedIncident(s: Awaited<ReturnType<typeof setup>>) {
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state, recovery: { orders: recoverable } });
    k.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const seen = observe(k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 15_000, "live");
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: shipped(3), headers: { trace: Buffer.from([0, 255]) } }]);
    const op = getGatewayOperator(k.gateway);
    const deadline = Date.now() + 20_000;
    for (;;) {
      await k.internals.failuresSettled();
      const [incident] = (await op.listFailures({ state: "all" })).items;
      if (incident?.progress === "advanced") return { op, seen, incident };
      if (Date.now() > deadline) assert.fail(`never advanced: ${JSON.stringify(incident ?? null)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  it("F31 and F33: show, evaluate and redrive read the original back from the quarantine topic", async () => {
    const s = await setup();
    const { op, seen, incident } = await advancedIncident(s);

    const detail = await op.showFailure({ failureId: incident.failureId, includeRaw: true });
    assert.equal(detail.raw?.complete, true, detail.raw?.note ?? "");
    assert.equal(Buffer.from(detail.raw?.valueBase64 ?? "", "base64").toString(), shipped(3).toString(), "the exact original value");
    assert.equal(Buffer.from(detail.raw?.keyBase64 ?? "", "base64").toString(), "ord_1");
    assert.deepEqual(detail.raw?.headers.map(header => [header.name, Buffer.from(header.valueBase64, "base64").toString("hex")]), [["trace", "00ff"]]);

    const stillFails = await op.evaluate({ failureId: incident.failureId, expectedRevision: incident.revision });
    assert.equal(stillFails.validation, "invalid");
    assert.equal(stillFails.plan, null);

    k!.app.mapOverride = repairedMap;
    const evaluation = await op.evaluate({ failureId: incident.failureId, expectedRevision: incident.revision });
    assert.equal(evaluation.eligible, true, evaluation.ineligibleReason ?? "");
    assert.ok(evaluation.plan !== null);
    const result = await op.redrive({ failureId: incident.failureId, planId: evaluation.plan.planId, planFingerprint: evaluation.plan.fingerprint, expectedRevision: incident.revision });
    assert.equal(result.outcome, "reprocessed", result.message);
    await waitFor(() => seen.events.some(event => event.revision === "3"), 15_000, "the redriven state delivered");
    assert.deepEqual(seen.events.at(-1)?.data, { orderId: "ord_1", status: "done", progress: 100 });
  });

  it("F28: evidence deleted from the quarantine topic is reported as expired and no plan is issued", async () => {
    const s = await setup();
    const { op, incident } = await advancedIncident(s);
    await (await testAdmin()).deleteTopicRecords({ topic: s.quarantine, partitions: [{ partition: 0, offset: "-1" }] });
    k!.app.mapOverride = repairedMap;
    const evaluation = await op.evaluate({ failureId: incident.failureId, expectedRevision: incident.revision });
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.ineligibleReason, "evidence-expired");
    assert.equal(evaluation.plan, null);
    const detail = await op.showFailure({ failureId: incident.failureId, includeRaw: true });
    assert.equal(detail.raw?.complete, false);
    assert.equal(detail.raw?.valueBase64, null);
    assert.match(detail.raw?.note ?? "", /expired/);
  });
});
