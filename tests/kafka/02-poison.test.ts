import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import type { Json } from "@streamotter/contracts";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produce, startKafkaHarness, type KafkaHarness } from "./helpers.ts";

const available = await brokerAvailable();

async function waitForCommitted(k: KafkaHarness, partition: number, offset: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await committedOffsets(k.group, k.topic))[partition] === offset) return;
    await sleep(100);
  }
  assert.fail(`partition ${partition} never committed ${offset}; committed ${JSON.stringify(await committedOffsets(k.group, k.topic))}`);
}

describe("Kafka poison records pause without advancing their partition", { skip: available ? false : "local Kafka is not running" }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => { await k?.close(); k = undefined; });
  after(() => closeKafkaHelpers());

  it("pauses on invalid JSON, commits nothing at or after it, and retries the same record on resume", async () => {
    const topic = await createTopic(2);
    k = await startKafkaHarness({ topic });
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const mapped: string[] = [];
    k.app.mapOverride = (value: Json) => {
      const record = value as { tenantId: string; revision: string; order: { orderId: string } };
      mapped.push(record.revision);
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    const sub = k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await sub.ready();

    await produce(topic, [{ key: "ord_1", value: orderValue("acme", "ord_1", 2, "processing", 20), partition: 0 }]);
    await waitForCommitted(k, 0, "1");
    await produce(topic, [
      { key: "ord_1", value: "{not json", partition: 0 },
      { key: "ord_1", value: orderValue("acme", "ord_1", 3, "processing", 30), partition: 0 }
    ]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 10_000, "paused");
    assert.equal(k.internals.sources()[0]?.reason, "INVALID_PAYLOAD");
    await waitFor(() => sub.state === "stale");
    // Records produced to another partition while paused are not consumed or committed either.
    await produce(topic, [{ key: "other", value: orderValue("acme", "ord_other", 1, "queued", 0), partition: 1 }]);
    await sleep(2_000);
    const whilePaused = await committedOffsets(k.group, topic);
    assert.equal(whilePaused[0], "1", "the poison offset (1) and everything after it stay uncommitted");
    assert.equal(whilePaused[1], "-1", "the whole source is paused");
    assert.deepEqual(mapped, ["2"]);

    // Resuming without a correction pauses again on the same record: it is never skipped.
    await k.gateway.resumeSource("orders");
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 10_000, "paused again");
    assert.equal((await committedOffsets(k.group, topic))[0], "1");
    const failures = k.internals.traces({ limit: 500, outcome: "rejected" }).items.filter(trace => trace.stage === "validate");
    assert.equal(failures.length, 2, "both attempts rejected the same malformed record at validation");
  });

  it("retries the same record after a handler correction and then continues in order", async () => {
    const topic = await createTopic(1);
    k = await startKafkaHarness({ topic });
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    let fixed = false;
    const mapped: string[] = [];
    k.app.mapOverride = (value: Json) => {
      const record = value as { tenantId: string; revision: string; order: { orderId: string; progress: number } };
      mapped.push(record.revision);
      if (!fixed && record.revision === "3") throw new Error("decoder cannot handle revision 3 yet");
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    const sub = k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    await produce(topic, [2, 3, 4].map(revision => ({ key: "ord_1", value: orderValue("acme", "ord_1", revision, "processing", revision * 10) })));
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 10_000, "paused");
    assert.equal(k.internals.sources()[0]?.reason, "HANDLER_FAILED");
    await sleep(1_000);
    assert.equal((await committedOffsets(k.group, topic))[0], "1", "revision 2 committed; revision 3 and 4 not");
    fixed = true;
    k.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    await k.gateway.resumeSource("orders");
    await waitForCommitted(k, 0, "3");
    assert.deepEqual(mapped, ["2", "3", "3", "4"], "the failed record was retried, then the next one");
    await waitFor(() => sub.state === "live" && seen.events.at(-1)?.revision === "4", 10_000, "caught up");
  });

  it("pauses on a tombstone instead of inventing deletion semantics", async () => {
    const topic = await createTopic(1);
    k = await startKafkaHarness({ topic });
    await produce(topic, [{ key: "ord_1", value: null }]);
    await waitFor(() => k!.internals.sources()[0]?.status === "paused", 10_000, "paused");
    assert.equal(k.internals.sources()[0]?.reason, "INVALID_PAYLOAD");
    assert.equal((await committedOffsets(k.group, topic))[0], "-1");
  });
});
