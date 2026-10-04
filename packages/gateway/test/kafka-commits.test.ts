import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { describe, it, type TestContext } from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import kafkajs, { type Admin, type Consumer, type EachBatchPayload } from "kafkajs";
import { KafkaSourceAdapter } from "../src/sources/kafka.ts";
import type { SourceSink } from "../src/sources/types.ts";

/**
 * Offset commits and start positions of the Kafka source, driven through a fake KafkaJS consumer
 * (and a fake admin client where the broker's answers matter), so no broker is needed.
 */

const EVENTS = {
  GROUP_JOIN: "group-join", REBALANCING: "rebalancing", FETCH_START: "fetch-start", FETCH: "fetch", HEARTBEAT: "heartbeat",
  COMMIT_OFFSETS: "commit-offsets", CRASH: "crash", DISCONNECT: "disconnect", STOP: "stop"
} as const;

type Offsets = { topic: string; partition: number; offset: string }[];

class FakeConsumer {
  readonly events = EVENTS;
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();
  eachBatch: ((payload: EachBatchPayload) => Promise<void>) | null = null;
  /** Like KafkaJS: a running consumer commits and raises COMMIT_OFFSETS; a stopped one resolves without committing. */
  running = true;
  failNextCommit = false;
  readonly committed: Offsets[] = [];
  on(name: string, listener: (event: unknown) => void): () => void {
    this.#listeners.set(name, [...(this.#listeners.get(name) ?? []), listener]);
    return () => undefined;
  }
  emit(name: string, payload: unknown = {}): void {
    for (const listener of this.#listeners.get(name) ?? []) listener({ payload });
  }
  async connect(): Promise<void> {}
  async subscribe(): Promise<void> {}
  async run(config: { eachBatch: (payload: EachBatchPayload) => Promise<void> }): Promise<void> {
    this.eachBatch = config.eachBatch;
    this.emit(EVENTS.GROUP_JOIN, { memberAssignment: { orders: [0] } });
  }
  async commitOffsets(offsets: Offsets): Promise<void> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw Object.assign(new Error("request timed out"), { name: "KafkaJSRequestTimeoutError" });
    }
    if (!this.running) return;
    this.committed.push(offsets);
    this.emit(EVENTS.COMMIT_OFFSETS, { topics: offsets });
  }
  pause(): void {}
  resume(): void {}
  seek(): void {}
  async disconnect(): Promise<void> {}
}

/** An admin client reporting no committed offset on orders/0, whose high-water mark is 42. */
const fakeAdmin = {
  connect: async () => undefined,
  disconnect: async () => undefined,
  fetchOffsets: async () => [{ topic: "orders", partitions: [{ partition: 0, offset: "-1" }] }],
  fetchTopicOffsets: async () => [{ partition: 0, offset: "42", high: "42", low: "0" }]
};

interface Started {
  adapter: KafkaSourceAdapter;
  consumer: FakeConsumer;
  commits: string[];
  logs: { level: string; message: string }[];
}

async function startAdapter(t: TestContext, options: { admin?: "fake" | "real"; brokers?: string[] } = {}): Promise<Started> {
  const consumer = new FakeConsumer();
  t.mock.method(kafkajs.Kafka.prototype, "consumer", () => consumer as unknown as Consumer);
  if (options.admin !== "real") t.mock.method(kafkajs.Kafka.prototype, "admin", () => fakeAdmin as unknown as Admin);
  const commits: string[] = [];
  const logs: { level: string; message: string }[] = [];
  const sink: SourceSink = {
    process: async () => ({ kind: "commit" }),
    setStatus: () => undefined,
    held: () => undefined,
    logger: {
      info: message => { logs.push({ level: "info", message }); },
      warn: message => { logs.push({ level: "warn", message }); },
      error: message => { logs.push({ level: "error", message }); }
    },
    stopSignal: new AbortController().signal
  };
  const adapter = new KafkaSourceAdapter({
    projectId: "commits",
    sourceId: "orders",
    source: { kind: "kafka", generation: "g1", connectionRef: "cluster", topics: ["orders"], consumerGroup: "commits", codec: "json", startFrom: "latest" },
    connection: { brokers: options.brokers ?? ["127.0.0.1:1"], tls: false, ca: null, sasl: null },
    sink,
    onCommit: position => { if (position.kind === "kafka") commits.push(position.offset); }
  });
  await adapter.start();
  return { adapter, consumer, commits, logs };
}

/** Delivers one record through the consumer's eachBatch. */
async function deliver(consumer: FakeConsumer, offset: string): Promise<void> {
  assert.ok(consumer.eachBatch !== null);
  await consumer.eachBatch({
    batch: { topic: "orders", partition: 0, messages: [{ offset, key: null, value: Buffer.from("{}"), timestamp: "0", headers: {} }] },
    resolveOffset: () => undefined,
    heartbeat: async () => undefined,
    isRunning: () => true,
    isStale: () => false
  } as unknown as EachBatchPayload);
}

/** One tick of the adapter's one-second timer, which retries failed commits, then lets the retry finish. */
async function tick(t: TestContext): Promise<void> {
  t.mock.timers.tick(1_000);
  for (let i = 0; i < 5; i++) await flush();
}

describe("Kafka source offset commits", () => {
  it("does not report a commit the stopped consumer skipped, and commits it on retry once it runs again", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { adapter, consumer, commits, logs } = await startAdapter(t);
    try {
      consumer.running = false; // A crash stopped the runner; KafkaJS resolves commitOffsets without committing.
      await deliver(consumer, "5");
      assert.deepEqual(commits, [], "a skipped commit is not reported as committed");
      assert.ok(logs.some(log => log.message.startsWith("Kafka offset commit failed")));
      consumer.running = true;
      await tick(t);
      assert.deepEqual(commits, ["5"]);
      assert.deepEqual(consumer.committed, [[{ topic: "orders", partition: 0, offset: "6" }]]);
      assert.ok(logs.some(log => log.message === "Kafka offset commit succeeded on retry"));
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });

  it("drops a failed commit's retry when the consumer crashes instead of reporting it committed", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { adapter, consumer, commits, logs } = await startAdapter(t);
    try {
      consumer.failNextCommit = true;
      await deliver(consumer, "5");
      assert.deepEqual(commits, []);
      // KafkaJS stops the runner, then reports the crash and restarts the consumer, which rejoins later.
      consumer.running = false;
      consumer.emit(EVENTS.STOP);
      consumer.emit(EVENTS.CRASH, { error: { name: "KafkaJSConnectionError" }, restart: true });
      await tick(t);
      await tick(t);
      assert.deepEqual(commits, [], "the retry did not report a commit");
      assert.deepEqual(consumer.committed, []);
      assert.ok(!logs.some(log => log.message === "Kafka offset commit succeeded on retry"));
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });

  it("commits the start position when the first assignment fetches", async t => {
    const { adapter, consumer } = await startAdapter(t);
    try {
      consumer.emit(EVENTS.FETCH_START);
      await flush();
      assert.deepEqual(consumer.committed, [[{ topic: "orders", partition: 0, offset: "42" }]]);
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });

  it("warns when a rebalance before the first fetch discards the start position", async t => {
    const { adapter, consumer, logs } = await startAdapter(t);
    try {
      consumer.emit(EVENTS.REBALANCING);
      consumer.emit(EVENTS.GROUP_JOIN, { memberAssignment: { orders: [0] } });
      consumer.emit(EVENTS.FETCH_START);
      await flush();
      assert.deepEqual(consumer.committed, [], "the start position is not committed after a rejoin");
      assert.ok(logs.some(log => log.level === "warn" && log.message.startsWith("The consumer group rebalanced before the start position was committed")));
    } finally {
      await adapter.stop(Date.now() + 1_000);
    }
  });
});

describe("Kafka source start-position read", () => {
  it("leaves no connection to an unresponsive broker once the read gives up", async t => {
    // Accepts connections and never answers, so KafkaJS's first request waits out its 30-second timeout.
    const open = new Set<Socket>();
    let accepted = 0;
    const server = createServer(socket => {
      accepted++;
      open.add(socket);
      socket.on("error", () => undefined);
      socket.resume(); // Reads and drops the requests, so the client closing is seen.
      socket.once("close", () => open.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    let started: Started | undefined;
    try {
      const begin = Date.now();
      started = await startAdapter(t, { admin: "real", brokers: [`127.0.0.1:${port}`] });
      const took = Date.now() - begin;
      assert.ok(took >= 4_500 && took < 6_500, `startup waited for the 5-second deadline only (${took} ms)`);
      assert.ok(accepted >= 1, "the admin client reached the broker");
      assert.ok(started.logs.some(log => log.message.startsWith("The consumer group's start position could not be read")));
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(open.size, 0, "the admin connection was closed when the read gave up");
      const acceptedAfter = accepted;
      await new Promise(resolve => setTimeout(resolve, 2_000)); // Longer than KafkaJS's retry backoff.
      assert.equal(open.size, 0, "KafkaJS did not reconnect after the read gave up");
      assert.equal(accepted, acceptedAfter);
      const stopping = Date.now();
      await started.adapter.stop(Date.now() + 5_000);
      assert.ok(Date.now() - stopping < 1_000, "stop() returned promptly");
    } finally {
      for (const socket of open) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
