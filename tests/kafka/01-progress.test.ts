import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produce, startKafkaHarness, testAdmin, type KafkaHarness } from "./helpers.ts";

const available = await brokerAvailable();

describe("Kafka 4.1.2 via KafkaJS 2.2.4: delivery and explicit progress", { skip: available ? false : "local Kafka is not running (pnpm kafka:start)" }, () => {
  let k: KafkaHarness | undefined;
  after(async () => {
    await k?.close();
    await closeKafkaHelpers();
  });

  it("starts only after the consumer group is joined and delivers snapshot then live updates", async () => {
    k = await startKafkaHarness();
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    assert.deepEqual(k.internals.sources(), [{ sourceId: "orders", kind: "kafka", status: "healthy" }]);
    const sub = k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    await produce(k.topic, [
      { key: "ord_1", value: orderValue("acme", "ord_1", 2, "processing", 40) },
      { key: "ord_1", value: orderValue("acme", "ord_1", 3, "done", 100) }
    ]);
    await waitFor(() => seen.events.length === 3, 10_000, "two updates from Kafka");
    assert.deepEqual(seen.events.map(event => `${event.kind}:${event.revision}`), ["snapshot:1", "update:2", "update:3"]);
  });

  it("commits the next offset only after each record is processed (auto-commit disabled)", async () => {
    assert.ok(k !== undefined);
    await produce(k.topic, [
      { key: "a", value: orderValue("acme", "ord_x", 1, "queued", 0), partition: 0 },
      { key: "b", value: orderValue("acme", "ord_y", 1, "queued", 0), partition: 1 },
      { key: "c", value: orderValue("acme", "ord_z", 1, "queued", 0), partition: 1 }
    ]);
    const topicOffsets = await (await testAdmin()).fetchTopicOffsets(k.topic);
    const expected = Object.fromEntries(topicOffsets.map(entry => [entry.partition, entry.high]));
    let committed: Record<number, string> = {};
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      committed = await committedOffsets(k.group, k.topic);
      if (Object.entries(expected).every(([partition, high]) => committed[Number(partition)] === high || (high === "0" && committed[Number(partition)] === "-1"))) break;
      await sleep(200);
    }
    for (const [partition, high] of Object.entries(expected)) {
      assert.equal(committed[Number(partition)] === "-1" ? "0" : committed[Number(partition)], high, `partition ${partition}`);
    }
    const commits = k.internals.traces({ limit: 500 }).items.filter(trace => trace.stage === "commit");
    assert.ok(commits.length >= 5, "each processed record produced a commit trace");
  });

  it("reports staged source diagnostics against the live broker", async () => {
    assert.ok(k !== undefined);
    const steps = await k.internals.checkSource("orders");
    assert.deepEqual(steps.map(step => `${step.stage}:${step.outcome}`), ["resolve:ok", "connect:ok", "tls:skipped", "authenticate:skipped", "metadata:ok"]);
  });

  it("honors startFrom for a new consumer group: latest skips history, earliest reads it", async () => {
    const topic = await createTopic(1);
    await produce(topic, [{ key: "ord_h", value: orderValue("acme", "ord_h", 7, "done", 100) }]);
    for (const startFrom of ["latest", "earliest"] as const) {
      const harness = await startKafkaHarness({ topic, startFrom });
      await sleep(1_500);
      const mapped = harness.internals.traces({ limit: 100 }).items.filter(trace => trace.stage === "map").length;
      assert.equal(mapped, startFrom === "earliest" ? 1 : 0, startFrom);
      await harness.close();
    }
  });
});
