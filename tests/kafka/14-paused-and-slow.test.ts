/**
 * A paused source stays paused through a consumer crash, and a record that takes longer than the
 * group session timeout is still committed once.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { after, it } from "node:test";
import kafkajs from "kafkajs";
import type { Json } from "@streamotter/contracts";
import { sleep, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produce, startKafkaHarness } from "./helpers.ts";

// Capture every consumer the gateway creates so we can observe its instrumentation events.
const consumers: kafkajs.Consumer[] = [];
const originalConsumer = kafkajs.Kafka.prototype.consumer;
kafkajs.Kafka.prototype.consumer = function (this: kafkajs.Kafka, ...args: Parameters<kafkajs.Kafka["consumer"]>) {
  const consumer = originalConsumer.apply(this, args);
  consumers.push(consumer);
  return consumer;
};

// Network blackhole switch for Kafka sockets created through node:net.
const originalConnect = net.connect;
let blackhole = false;
const openSockets = new Set<net.Socket>();
(net as unknown as { connect: unknown }).connect = function (...args: unknown[]) {
  const options = args[0] as { host: string; port: number };
  const target = blackhole && typeof options === "object" && options.port === 19092 ? { ...options, port: 1 } : options;
  const socket = (originalConnect as (...a: unknown[]) => net.Socket)(target, ...args.slice(1));
  openSockets.add(socket);
  socket.once("close", () => openSockets.delete(socket));
  return socket;
};
syncBuiltinESMExports();

const available = await brokerAvailable();
after(() => closeKafkaHelpers());

it("stays paused, without fetching in a loop, after the consumer crashes and restarts", { skip: available ? false : "no broker", timeout: 180_000 }, async () => {
  const topic = await createTopic(2);
  const k = await startKafkaHarness({ topic });
  try {
    const mapped: string[] = [];
    k.app.mapOverride = (value: Json) => {
      const record = value as { tenantId: string; revision: string; order: { orderId: string } };
      mapped.push(record.revision);
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    const consumer = consumers.at(-1)!;
    const counts = { fetch: 0, startBatch: 0, crash: 0, join: 0 };
    consumer.on(consumer.events.FETCH, () => { counts.fetch++; });
    consumer.on(consumer.events.START_BATCH_PROCESS, () => { counts.startBatch++; });
    consumer.on(consumer.events.CRASH, e => { counts.crash++; console.log("CRASH restart=", e.payload.restart, e.payload.error.name); });
    consumer.on(consumer.events.GROUP_JOIN, () => { counts.join++; });

    await produce(topic, [
      { key: "a", value: "{poison", partition: 0 },
      ...Array.from({ length: 50 }, (_, i) => ({ key: "a", value: orderValue("acme", "ord_1", i + 2, "processing", 1), partition: 0 })),
      ...Array.from({ length: 50 }, (_, i) => ({ key: "b", value: orderValue("acme", "ord_2", i + 2, "processing", 1), partition: 1 }))
    ]);
    await waitFor(() => k.internals.sources()[0]?.status === "paused", 15_000, "paused");
    await sleep(1_000);
    // Partition 1 may be processed before the poison in partition 0 pauses the source; nothing moves after that.
    const committedWhenPaused = await committedOffsets(k.group, topic);
    const mappedWhenPaused = mapped.length;
    assert.equal(committedWhenPaused[0], "-1");

    // Cut the broker off long enough for KafkaJS to exhaust its retries and crash with restart.
    blackhole = true;
    for (const socket of openSockets) socket.destroy(new Error("test blackhole"));
    await waitFor(() => counts.crash > 0, 120_000, "crash");
    blackhole = false;
    const joins = counts.join;
    await waitFor(() => counts.join > joins, 60_000, "rejoin after crash");
    await sleep(1_000);
    assert.notDeepEqual(consumer.paused(), [], "KafkaJS's own pause is restored after the restart");
    const mid = { ...counts };
    await sleep(5_000);
    assert.ok(counts.startBatch - mid.startBatch < 50, `a paused source handed out ${counts.startBatch - mid.startBatch} batches in 5 s`);
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.deepEqual(await committedOffsets(k.group, topic), committedWhenPaused);
    assert.equal(mapped.length, mappedWhenPaused);
  } finally {
    blackhole = false;
    await k.close();
  }
});

it("commits a record whose processing outlasts the group session timeout, once", { skip: available ? false : "no broker", timeout: 120_000 }, async () => {
  const topic = await createTopic(1);
  const warnings: string[] = [];
  const k = await startKafkaHarness({
    topic, limits: { handlerTimeoutMs: 40_000 },
    logger: { info() {}, warn(message) { warnings.push(message); }, error(message) { warnings.push(message); } }
  });
  try {
    let calls = 0;
    k.app.mapOverride = async (value: Json) => {
      calls++;
      const record = value as { tenantId: string; revision: string; order: { orderId: string } };
      await sleep(31_000); // Longer than the 30-second session timeout.
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    await produce(topic, [{ key: "a", value: orderValue("acme", "ord_1", 2, "processing", 1) }]);
    const deadline = Date.now() + 60_000;
    while ((await committedOffsets(k.group, topic))[0] !== "1") {
      assert.ok(Date.now() < deadline, "the record was never committed");
      await sleep(500);
    }
    assert.equal(calls, 1);
    assert.deepEqual(warnings.filter(message => /degraded|commit failed/.test(message)), []);
  } finally {
    await k.close();
  }
});
