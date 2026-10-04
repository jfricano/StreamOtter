import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import kafkajs from "kafkajs";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produce, startKafkaHarness, testAdmin, uniqueName, type KafkaHarness } from "./helpers.ts";

// Capture every consumer the gateway creates, to observe its commits in the order they were made.
const consumers: kafkajs.Consumer[] = [];
const commits: { topic: string; partition: number; offset: string }[] = [];
const originalConsumer = kafkajs.Kafka.prototype.consumer;
kafkajs.Kafka.prototype.consumer = function (this: kafkajs.Kafka, ...args: Parameters<kafkajs.Kafka["consumer"]>) {
  const consumer = originalConsumer.apply(this, args);
  consumer.on(consumer.events.COMMIT_OFFSETS, event => {
    for (const { topic, partitions } of event.payload.topics) {
      for (const { partition, offset } of partitions) commits.push({ topic, partition: Number(partition), offset: String(offset) });
    }
  });
  consumers.push(consumer);
  return consumer;
};

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
    const commitTraces = k.internals.traces({ limit: 500 }).items.filter(trace => trace.stage === "commit");
    assert.ok(commitTraces.length >= 5, "each processed record produced a commit trace");
    // Within each partition, every record's next offset is committed once, in record order, with none skipped.
    for (const [partition, high] of Object.entries(expected)) {
      const sequence = commits.filter(commit => commit.topic === k!.topic && commit.partition === Number(partition)).map(commit => commit.offset);
      assert.deepEqual(sequence, Array.from({ length: Number(high) }, (_, index) => String(index + 1)), `commit order on partition ${partition}`);
    }
  });

  it("retries a failed commit of the last record without waiting for another record", async () => {
    const topic = await createTopic(1);
    const harness = await startKafkaHarness({ topic });
    try {
      const consumer = consumers.at(-1)!;
      const commitOffsets = consumer.commitOffsets.bind(consumer);
      let failures = 0;
      consumer.commitOffsets = async offsets => {
        if (failures++ === 0) throw new Error("injected commit failure");
        return commitOffsets(offsets);
      };
      await produce(topic, [{ key: "ord_r", value: orderValue("acme", "ord_r", 1, "queued", 0) }]);
      const deadline = Date.now() + 15_000;
      while ((await committedOffsets(harness.group, topic))[0] !== "1") {
        assert.ok(Date.now() < deadline, "the failed commit was never retried");
        await sleep(200);
      }
      assert.ok(failures >= 2);
    } finally {
      await harness.close();
    }
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

  it("with startFrom latest, commits the start position so a restart before any record skips nothing produced meanwhile", async () => {
    const topic = await createTopic(1);
    const group = uniqueName("so-group");
    await produce(topic, [{ key: "ord_h", value: orderValue("acme", "ord_h", 7, "done", 100) }]);
    const first = await startKafkaHarness({ topic, group, startFrom: "latest" });
    try {
      const deadline = Date.now() + 10_000;
      while ((await committedOffsets(group, topic))[0] !== "1") {
        assert.ok(Date.now() < deadline, "the start position was never committed");
        await sleep(200);
      }
    } finally {
      await first.close();
    }
    await produce(topic, [{ key: "ord_n", value: orderValue("acme", "ord_n", 1, "queued", 0) }]);
    const second = await startKafkaHarness({ topic, group, startFrom: "latest" });
    try {
      await waitFor(() => second.internals.traces({ limit: 100 }).items.some(trace => trace.stage === "map"), 10_000, "the record produced while stopped");
      assert.equal(second.internals.traces({ limit: 100 }).items.filter(trace => trace.stage === "map").length, 1);
    } finally {
      await second.close();
    }
  });

  it("warns when the group's committed offset is outside the retained range, which Kafka resets silently", async () => {
    const topic = await createTopic(1);
    const group = uniqueName("so-group");
    await produce(topic, [{ key: "ord_h", value: orderValue("acme", "ord_h", 7, "done", 100) }]);
    await (await testAdmin()).setOffsets({ groupId: group, topic, partitions: [{ partition: 0, offset: "100" }] });
    const warnings: { message: string; fields: unknown }[] = [];
    const harness = await startKafkaHarness({
      topic, group, logger: { info() {}, warn(message, fields) { warnings.push({ message, fields }); }, error() {} }
    });
    try {
      const warning = warnings.find(entry => /outside the partition's retained range/.test(entry.message));
      assert.ok(warning !== undefined, "an out-of-range committed offset is reported");
      assert.deepEqual(warning.fields, { sourceId: "orders", topic, partition: 0, committed: "100", low: "0", high: "1", startFrom: "earliest" });
    } finally {
      await harness.close();
    }
  });
});
