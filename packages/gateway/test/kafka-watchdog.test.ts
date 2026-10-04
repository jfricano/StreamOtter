import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import kafkajs, { type Consumer } from "kafkajs";
import { KafkaSourceAdapter } from "../src/sources/kafka.ts";
import type { SourceSink } from "../src/sources/types.ts";

/**
 * The degraded watchdog (V1_API §13: 12 seconds without fetch/heartbeat activity marks the source
 * degraded), driven through a fake KafkaJS consumer and mocked timers, so no broker is needed.
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
  async run(): Promise<void> {
    this.emit(EVENTS.GROUP_JOIN, { memberAssignment: { orders: [0] } });
  }
  async disconnect(): Promise<void> {}
}

async function startAdapter(t: TestContext): Promise<{ adapter: KafkaSourceAdapter; consumer: FakeConsumer; statuses: string[] }> {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  const consumer = new FakeConsumer();
  t.mock.method(kafkajs.Kafka.prototype, "consumer", () => consumer as unknown as Consumer);
  const statuses: string[] = [];
  const quiet = () => undefined;
  const sink: SourceSink = {
    process: async () => ({ kind: "commit" }),
    setStatus: (status, reason) => { statuses.push(reason === undefined ? status : `${status}:${reason}`); },
    held: () => undefined,
    logger: { info: quiet, warn: quiet, error: quiet },
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
  return { adapter, consumer, statuses };
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

  it("stops watching once the source is stopped", async t => {
    const { adapter, statuses } = await startAdapter(t);
    await adapter.stop(Date.now() + 1_000);
    idle(t, 30_000);
    assert.deepEqual(statuses, ["healthy"]);
  });
});
