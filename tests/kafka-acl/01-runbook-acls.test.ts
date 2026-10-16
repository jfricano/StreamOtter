import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import type { DataFrame, Json, SourceRecoveryHandlers, SubscriptionFrame } from "@streamotter/contracts";
import { nodeSupportsJournal, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import { ack, rawConnect } from "../integration/raw.ts";
import { orderValue, startKafkaHarness, uniqueName, type KafkaHarness } from "../kafka/helpers.ts";
import {
  aclBrokerAvailable, closeAclHelpers, committedOffset, createAclTopic, currentGatewayAcls, failureSetup, gatewayAcls, GATEWAY_CONNECTION,
  grant, groupsWithPrefix, produceRaw, READ_GROUP_PREFIX, revokeAllGatewayAcls, SKIP_MESSAGE
} from "./helpers.ts";

/**
 * The gateway against a Kafka 4.1.2 broker with StandardAuthorizer and no allow-everyone fallback,
 * connecting as a principal that holds exactly V1's source ACLs plus the rows of the runbook's
 * table (docs/guides/source-failures.md §6.1), and nothing else. Every path the runbook says those
 * ACLs are for runs end to end: the startup check, the quarantine write, the guarded advance and
 * its read-back, evidence read-back for show, export, evaluate and redrive (with the throwaway group
 * deleted afterwards), retry-current, and the startup reconciliation of an unconfirmed advance.
 */

const skip = !(await aclBrokerAvailable()) ? SKIP_MESSAGE : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;
const APP_ORIGIN = "http://localhost:3000";

const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "acl-test" }) };
/** Valid JSON whose status is outside the channel's payload schema. */
const shipped = (revision: number) => Buffer.from(orderValue("acme", "ord_1", revision, "shipped" as "done", 100));
const good = (revision: number) => Buffer.from(orderValue("acme", "ord_1", revision, "processing", revision * 10));
const repairedMap = (value: Json) => {
  const record = value as { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
  return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: { ...record.order, status: record.order.status === "shipped" ? "done" : record.order.status } }];
};

async function incident(k: KafkaHarness, done: (incident: IncidentRecord) => boolean, timeoutMs = 20_000): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await k.internals.failuresSettled();
    const [found] = (k.internals.incidentStore() as IncidentStore).list({ state: "all" }).items;
    if (found !== undefined && done(found)) return found;
    if (Date.now() > deadline) assert.fail(`incident never reached the expected state: ${JSON.stringify(found ?? null)}`);
    await sleep(100);
  }
}

async function waitForCommitted(group: string, topic: string, offset: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (await committedOffset(group, topic) !== offset) {
    if (Date.now() > deadline) assert.fail(`never committed ${offset}; committed ${await committedOffset(group, topic)}`);
    await sleep(100);
  }
}

describe("the gateway on an ACL-enabled broker with exactly the runbook's ACLs", { skip }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => {
    await k?.close();
    k = undefined;
    await revokeAllGatewayAcls();
  });
  after(() => closeAclHelpers());

  it("a plain state channel works in production with only V1's source ACLs", { timeout: 60_000 }, async () => {
    await revokeAllGatewayAcls();
    const topic = await createAclTopic(1);
    const group = uniqueName("so-acl-group");
    const acls = gatewayAcls({ topic, group });
    await grant(acls["source-topic-read"], acls["source-group-read"]);
    assert.deepEqual(await currentGatewayAcls(), [`GROUP:${group}:READ`, `TOPIC:${topic}:READ`]);

    k = await startKafkaHarness({ topic, group, connection: GATEWAY_CONNECTION, mode: "production" });
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const steps = await k.internals.checkSource("orders");
    assert.deepEqual(steps.map(step => `${step.stage}:${step.outcome}`), ["resolve:ok", "connect:ok", "tls:ok", "authenticate:ok", "metadata:ok"]);

    const { socket } = await rawConnect(k.origin, { token: "alice@acme", protocolVersion: 1 }, { origin: APP_ORIGIN });
    const frames: DataFrame[] = [];
    const states: SubscriptionFrame[] = [];
    socket.on("so:data", (frame: DataFrame) => {
      frames.push(frame);
      socket.emit("so:receipt", { subscriptionId: frame.subscriptionId, epoch: frame.epoch, sequence: frame.sequence });
    });
    socket.on("so:state", (frame: SubscriptionFrame) => states.push(frame));
    try {
      const result = await ack(socket, "so:subscribe", {
        requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" }
      });
      assert.equal(result.ok, true);
      await waitFor(() => states.some(frame => frame.state === "live"), 15_000, "live");
      await produceRaw(topic, [{ key: Buffer.from("ord_1"), value: good(2) }]);
      await waitFor(() => frames.at(-1)?.event.revision === "2", 15_000, "update delivered");
      await waitForCommitted(group, topic, "1");
    } finally {
      socket.close();
    }
  });

  it("quarantine-hold: the startup check, the quarantine write, show and export read-back, and retry-current", { timeout: 90_000 }, async () => {
    await revokeAllGatewayAcls();
    const s = await failureSetup("quarantine-hold");
    await grant(...Object.values(gatewayAcls(s)));
    assert.deepEqual(await currentGatewayAcls(), [
      `GROUP:${READ_GROUP_PREFIX}*:DELETE`, `GROUP:${READ_GROUP_PREFIX}*:READ`, `GROUP:${s.group}:READ`,
      `TOPIC:${s.quarantine}:DESCRIBE`, `TOPIC:${s.quarantine}:DESCRIBE_CONFIGS`, `TOPIC:${s.quarantine}:READ`, `TOPIC:${s.quarantine}:WRITE`,
      `TOPIC:${s.topic}:READ`
    ].sort());

    k = await startKafkaHarness({ topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state });
    const op = getGatewayOperator(k.gateway);
    const status = await op.status();
    assert.deepEqual(status.quarantine, { topic: s.quarantine, maxMessageBytes: 2 * 1024 * 1024, minInsyncReplicas: 1, replicationFactor: 1 }, "Describe and DescribeConfigs");

    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const seen = observe(k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 15_000, "live");
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json"), headers: { trace: Buffer.from([0, 255]) } }]);
    const held = await incident(k, item => item.quarantine === "acknowledged");
    assert.equal(held.failureClass, "invalid-json");
    assert.equal(held.progress, "held");
    assert.ok(held.clusterId !== null && held.clusterId.length > 0);
    await waitFor(() => seen.states.at(-1) === "stale", 10_000, "stale while held");
    assert.equal(await committedOffset(s.group, s.topic), "-1", "the held record is never committed");

    const detail = await op.showFailure({ failureId: held.failureId, includeRaw: true });
    assert.equal(detail.raw?.complete, true, detail.raw?.note ?? "");
    assert.equal(Buffer.from(detail.raw?.valueBase64 ?? "", "base64").toString(), "{not json");
    assert.deepEqual(detail.raw?.headers.map(header => [header.name, Buffer.from(header.valueBase64, "base64").toString("hex")]), [["trace", "00ff"]]);
    const bundle = await op.exportFailure({ failureId: held.failureId, includeRaw: true });
    assert.equal(bundle.raw?.complete, true, bundle.raw?.note ?? "");
    assert.equal(Buffer.from(bundle.raw?.valueBase64 ?? "", "base64").toString(), "{not json");
    assert.deepEqual(await groupsWithPrefix(READ_GROUP_PREFIX), [], "each read's throwaway group was deleted");

    const current = await incident(k, item => item.failureId === held.failureId);
    const retried = await op.retryCurrent({ sourceId: "orders", failureId: held.failureId, expectedRevision: current.revision });
    assert.equal(retried.result, "completed", retried.message);
    assert.equal(retried.outcome, "held", retried.message);
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.equal(await committedOffset(s.group, s.topic), "-1");
  });

  it("quarantine-resync: the guarded advance, then evaluate and redrive from the quarantine topic", { timeout: 90_000 }, async () => {
    await revokeAllGatewayAcls();
    const s = await failureSetup("quarantine-resync");
    await grant(...Object.values(gatewayAcls(s)));
    k = await startKafkaHarness({
      topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state, recovery: { orders: recoverable }
    });
    k.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    const seen = observe(k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 15_000, "live");
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: shipped(3) }, { key: Buffer.from("ord_1"), value: good(4) }]);
    const advanced = await incident(k, item => item.progress === "advanced");
    assert.equal(advanced.failureClass, "payload-schema");
    assert.equal(advanced.quarantine, "acknowledged");
    await waitForCommitted(s.group, s.topic, "2");
    await waitFor(() => seen.events.some(event => event.revision === "4"), 15_000, "the next record delivered");

    const op = getGatewayOperator(k.gateway);
    k.app.mapOverride = repairedMap;
    const evaluation = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
    assert.equal(evaluation.eligible, true, evaluation.ineligibleReason ?? "");
    assert.ok(evaluation.plan !== null);
    const result = await op.redrive({
      failureId: advanced.failureId, planId: evaluation.plan.planId, planFingerprint: evaluation.plan.fingerprint, expectedRevision: advanced.revision
    });
    assert.equal(result.result, "completed", result.message);
    assert.equal(result.outcome, "superseded", "revision 4 is already newer than the redriven revision 3");
    assert.deepEqual(await groupsWithPrefix(READ_GROUP_PREFIX), [], "each read's throwaway group was deleted");
  });

  it("an advance whose journal write was lost is confirmed at restart from the group's committed offset", { timeout: 120_000 }, async () => {
    await revokeAllGatewayAcls();
    const s = await failureSetup("quarantine-resync");
    await grant(...Object.values(gatewayAcls(s)));
    const harness = { topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state, recovery: { orders: recoverable } };
    // The commit lands, but recording "advanced" fails, so the incident stays advance-pending.
    k = await startKafkaHarness({ ...harness, internal: { advanceHooks: { afterAdvance: async () => { throw new Error("journal write lost"); } } } });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }, { key: Buffer.from("ord_1"), value: good(2) }]);
    const pending = await incident(k, item => item.progress === "advance-pending");
    await waitForCommitted(s.group, s.topic, "1");
    assert.equal(k.internals.sources()[0]?.status, "paused", "nothing after the record is consumed while the advance is unrecorded");
    await k.close();

    k = await startKafkaHarness(harness);
    const confirmed = await incident(k, item => item.progress === "advanced");
    assert.equal(confirmed.failureId, pending.failureId);
    const events = (k.internals.incidentStore() as IncidentStore).events(confirmed.failureId).map(event => event.event);
    assert.ok(events.includes("advance-confirmed"));
    assert.equal(events.filter(event => event === "advance-pending").length, 1, "confirmed from the committed offset, not advanced again");
    await waitForCommitted(s.group, s.topic, "2");
  });
});
