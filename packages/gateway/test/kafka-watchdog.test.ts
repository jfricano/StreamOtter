import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import kafkajs, { type Admin, type Consumer, type EachBatchPayload } from "kafkajs";
import { KafkaSourceAdapter } from "../src/sources/kafka.ts";
import type { SourceSink } from "../src/sources/types.ts";

type Outcome = Awaited<ReturnType<SourceSink["process"]>>;

/**
 * The degraded watchdog (V1_API §13: 12 seconds without fetch/heartbeat activity marks the source
 * degraded), driven through a fake KafkaJS consumer and admin client and mocked timers, so no broker
 * is needed.
 */

const EVENTS = {
  GROUP_JOIN: "group-join", REBALANCING: "rebalancing", FETCH: "fetch", HEARTBEAT: "heartbeat",
  COMMIT_OFFSETS: "commit-offsets", CRASH: "crash", DISCONNECT: "disconnect", STOP: "stop"
} as const;

class FakeConsumer {
  readonly events = EVENTS;
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();
  on(name: string, listener: (event: unknown) => void): () => void {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), listener]);
    return () => undefined;
  }
  emit(name: string, payload: unknown = {}): void {
    for (const listener of this.#listeners.get(name) ?? []) listener({ payload });
  }
  async connect(): Promise<void> {}
  async subscribe(): Promise<void> {}
  #eachBatch: ((payload: EachBatchPayload) => Promise<void>) | null = null;
  async run(config: { eachBatch: (payload: EachBatchPayload) => Promise<void> }): Promise<void> {
    this.#eachBatch = config.eachBatch;
    this.emit(EVENTS.GROUP_JOIN, { memberAssignment: { orders: [0] } });
  }
  async disconnect(): Promise<void> {}
  /** Delivers one record the way KafkaJS does; its heartbeat reaches no broker, so it emits no HEARTBEAT event. */
  deliver(offset: string): Promise<void> {
    assert.ok(this.#eachBatch !== null, "the consumer is running");
    const batch = { topic: "orders", partition: 0, messages: [{ offset, key: null, value: Buffer.from("{}"), timestamp: "0", headers: {} }] };
    return this.#eachBatch({
      batch, resolveOffset: () => undefined, heartbeat: async () => undefined, isRunning: () => true, isStale: () => false
    } as unknown as EachBatchPayload);
  }
}

/** The start-position read at startup; it finds nothing committed, without waiting on a real connection. */
const fakeAdmin = {
  connect: async () => undefined,
  disconnect: async () => undefined,
  fetchOffsets: async () => [],
  fetchTopicOffsets: async () => []
};

async function startAdapter(t: TestContext, process: () => Promise<Outcome> = async () => ({ kind: "commit" })): Promise<{
  adapter: KafkaSourceAdapter; consumer: FakeConsumer; statuses: string[]; warnings: [string, Record<string, unknown> | undefined][];
}> {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  const consumer = new FakeConsumer();
  t.mock.method(kafkajs.Kafka.prototype, "consumer", () => consumer as unknown as Consumer);
  t.mock.method(kafkajs.Kafka.prototype, "admin", () => fakeAdmin as unknown as Admin);
  const statuses: string[] = [];
  const warnings: [string, Record<string, unknown> | undefined][] = [];
  const quiet = () => undefined;
  const sink: SourceSink = {
    process,
    setStatus: (status, reason) => { statuses.push(reason === undefined ? status : `${status}:${reason}`); },
    held: () => undefined,
    logger: { info: quiet, warn: (message, fields) => { warnings.push([message, fields]); }, error: quiet },
    stopSignal: new AbortController().signal
  };
  const adapter = new KafkaSourceAdapter({
    projectId: "watchdog",
    sourceId: "orders",
    source: { kind: "kafka", generation: "g1", connectionRef: "cluster", topics: ["orders"], consumerGroup: "watchdog", codec: "json", startFrom: "latest" },
    connection: { brokers: ["127.0.0.1:1"], tls: false, ca: null, sasl: null },
    sink,
    onCommit: () => undefined
  });
  await adapter.start();
  return { adapter, consumer, statuses, warnings };
}

function idle(t: TestContext, ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += 1_000) t.mock.timers.tick(1_000);
}

describe("Kafka source degraded watchdog", () => {
  it("marks a joined source degraded after 12 seconds without broker activity", async t => {
    const { adapter, statuses } = await startAdapter(t);
    try {
      assert.deepEqual(statuses, ["healthy"]);
      idle(t, 12_000);
      assert.deepEqual(statuses, ["healthy"], "12 seconds of silence is still within the window");
      idle(t, 1_000);
      assert.deepEqual(statuses, ["healthy", "degraded:SOURCE_UNAVAILABLE"]);
      idle(t, 10_000);
      assert.equal(statuses.length, 2, "degraded is reported once");
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });

  it("stays healthy while fetches and heartbeats continue, and recovers on the next activity", async t => {
    const { adapter, consumer, statuses } = await startAdapter(t);
    try {
      for (let round = 0; round < 6; round++) {
        idle(t, 8_000);
        consumer.emit(round % 2 === 0 ? EVENTS.FETCH : EVENTS.HEARTBEAT);
      }
      assert.deepEqual(statuses, ["healthy"], "48 seconds with activity every 8 seconds");
      idle(t, 13_000);
      assert.deepEqual(statuses, ["healthy", "degraded:SOURCE_UNAVAILABLE"]);
      consumer.emit(EVENTS.FETCH);
      assert.deepEqual(statuses, ["healthy", "degraded:SOURCE_UNAVAILABLE", "healthy"]);
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });

  it("names the record and how long it has been processing when the watchdog fires during processing", async t => {
    let finish: (outcome: Outcome) => void = () => undefined;
    const { adapter, consumer, statuses, warnings } = await startAdapter(t, () => new Promise(resolve => { finish = resolve; }));
    try {
      const delivered = consumer.deliver("41");
      idle(t, 13_000);
      assert.deepEqual(statuses, ["healthy", "degraded:SOURCE_UNAVAILABLE"]);
      assert.equal(warnings.length, 1);
      assert.deepEqual(warnings[0]?.[1], { sourceId: "orders", topic: "orders", partition: 0, offset: "41", processingMs: 13_000 });
      finish({ kind: "abandon" });
      await delivered;
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });

  it("stops watching once the source is stopped", async t => {
    const { adapter, statuses } = await startAdapter(t);
    await adapter.stop(Date.now() + 1_000);
    idle(t, 30_000);
    assert.deepEqual(statuses, ["healthy"]);
  });
});
