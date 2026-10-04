import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { resolve as resolvePath } from "node:path";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import kafkajs, { type Admin, type Consumer, type ISocketFactory, type Kafka as KafkaClient, type KafkaConfig, type SASLOptions } from "kafkajs";
import { StreamOtterError, type DiagnosticStep, type GatewayLogger, type KafkaConnection, type Source, type SourceRecord } from "@streamotter/contracts";
import { patchKafkaJsRequestQueue } from "./kafkajs-patch.ts";
import { flattenKafkaHeaders } from "../failures/evidence.ts";
import type { AdvanceResult, HeldPosition, SourceAdapter, SourceInput, SourceSink } from "./types.ts";

const { Kafka, logLevel } = kafkajs;
if (!patchKafkaJsRequestQueue()) {
  process.emitWarning("StreamOtter's KafkaJS request-queue fix applies only to kafkajs 2.2.4; idle Kafka connections may spin a 1 ms timer.", { code: "STREAMOTTER_KAFKAJS_PATCH" });
}

export interface ResolvedKafkaConnection {
  readonly brokers: readonly string[];
  readonly tls: boolean;
  readonly ca: string | null;
  readonly sasl: { mechanism: "plain" | "scram-sha-256" | "scram-sha-512"; username: string; password: string } | null;
}

/** Resolves environment secret references and CA files. Never logs resolved values. */
export async function resolveKafkaConnection(profile: KafkaConnection, configDir: string): Promise<ResolvedKafkaConnection> {
  let sasl: ResolvedKafkaConnection["sasl"] = null;
  if (profile.sasl !== undefined) {
    // process.env inherits Object.prototype, so a name like "constructor" must not count as set.
    const read = (name: string) => Object.hasOwn(process.env, name) ? process.env[name] : undefined;
    const missing = [profile.sasl.username.env, profile.sasl.password.env].filter(name => {
      const value = read(name);
      return typeof value !== "string" || value === "";
    });
    if (missing.length > 0) {
      throw new StreamOtterError("CONFIG_INVALID", {
        message: `Missing environment variable${missing.length > 1 ? "s" : ""} ${missing.join(", ")} referenced by the Kafka connection profile.`
      });
    }
    sasl = {
      mechanism: profile.sasl.mechanism,
      username: read(profile.sasl.username.env) as string,
      password: read(profile.sasl.password.env) as string
    };
  }
  let ca: string | null = null;
  if (profile.tls !== false && profile.tls.caFile !== undefined) {
    const path = resolvePath(configDir, profile.tls.caFile);
    try {
      ca = await readFile(path, "utf8");
    } catch {
      throw new StreamOtterError("CONFIG_INVALID", { message: `The CA file ${profile.tls.caFile} could not be read.` });
    }
  }
  return { brokers: [...profile.brokers], tls: profile.tls !== false, ca, sasl };
}

/**
 * Socket factory equivalent to KafkaJS's default, but tracking every socket so
 * stop() can guarantee release. KafkaJS can leave a broker connection open after
 * reconnecting through a broker restart.
 */
export class TrackedSockets {
  readonly #open = new Set<Socket>();

  readonly factory: ISocketFactory = ({ host, port, ssl, onConnect }) => {
    const socket: Socket = ssl
      ? tlsConnect({ host, port, ...(isIP(host) === 0 ? { servername: host } : {}), ...(typeof ssl === "object" ? ssl : {}) } as ConnectionOptions, onConnect)
      : netConnect({ host, port }, onConnect);
    socket.setKeepAlive(true, 60_000);
    this.#open.add(socket);
    socket.once("close", () => this.#open.delete(socket));
    return socket;
  };

  get size(): number {
    return this.#open.size;
  }

  /**
   * Destroys remaining sockets with an error so KafkaJS runs its own error path:
   * it rejects queued requests, disconnects, and stops the connection's timers.
   */
  destroyAll(): void {
    for (const socket of this.#open) socket.destroy(new Error("closed by StreamOtter during shutdown"));
    this.#open.clear();
  }
}

/** Client settings a caller may override; the quarantine writer uses a shorter request deadline (ADR-15A §5). */
export interface KafkaClientOverrides {
  requestTimeout?: number;
}

export function kafkaConfig(
  clientId: string,
  connection: ResolvedKafkaConnection,
  sink: Pick<SourceSink, "logger"> | null,
  sockets: TrackedSockets,
  quiet: () => boolean = () => false,
  overrides: KafkaClientOverrides = {}
): KafkaConfig {
  const config: KafkaConfig = {
    clientId,
    socketFactory: sockets.factory,
    brokers: [...connection.brokers],
    connectionTimeout: 3_000,
    authenticationTimeout: 10_000,
    requestTimeout: overrides.requestTimeout ?? 30_000,
    retry: { initialRetryTime: 300, maxRetryTime: 5_000, retries: 8 },
    logLevel: logLevel.ERROR,
    logCreator: () => entry => {
      // Forward only the namespace and message; KafkaJS extras can include request details.
      if (quiet()) return;
      const message = String(entry.log.message).slice(0, 300);
      if (message.startsWith("Offset out of range, resetting")) {
        // The consumer moved to its startFrom offset: records were skipped or will be read again.
        const { topic, partition } = entry.log as { topic?: unknown; partition?: unknown };
        sink?.logger.warn("Kafka offset out of range; the consumer reset to its startFrom offset, so records may be skipped or read again", {
          namespace: entry.namespace, message,
          ...(typeof topic === "string" ? { topic } : {}), ...(typeof partition === "number" ? { partition } : {})
        });
        return;
      }
      sink?.logger.warn("Kafka client", { namespace: entry.namespace, message });
    }
  };
  if (connection.tls) config.ssl = connection.ca === null ? true : { ca: [connection.ca] };
  if (connection.sasl !== null) {
    config.sasl = { mechanism: connection.sasl.mechanism, username: connection.sasl.username, password: connection.sasl.password } as SASLOptions;
  }
  return config;
}

/** A KafkaJS client on a resolved profile with socket tracking, for clients other than the source consumer. */
export function createTrackedKafka(
  clientId: string, connection: ResolvedKafkaConnection, logger: GatewayLogger, overrides: KafkaClientOverrides = {}
): { kafka: KafkaClient; sockets: TrackedSockets } {
  const sockets = new TrackedSockets();
  return { kafka: new Kafka(kafkaConfig(clientId, connection, { logger }, sockets, () => false, overrides)), sockets };
}

/**
 * Reads a consumer group's committed offset for one partition with a
 * short-lived admin client, before the source's consumer starts (startup
 * reconciliation of prepared advances, spec §6). "-1" means nothing committed.
 */
export async function readCommittedOffset(
  connection: ResolvedKafkaConnection, clientId: string, groupId: string, topic: string, partition: number, logger: GatewayLogger
): Promise<string | null> {
  const { kafka, sockets } = createTrackedKafka(clientId, connection, logger);
  const admin = kafka.admin();
  try {
    await admin.connect();
    const offsets = await admin.fetchOffsets({ groupId, topics: [topic] });
    return offsets.find(entry => entry.topic === topic)?.partitions.find(entry => entry.partition === partition)?.offset ?? null;
  } finally {
    await admin.disconnect().catch(() => undefined);
    sockets.destroyAll();
  }
}

function nextOffset(offset: string): string {
  return (BigInt(offset) + 1n).toString();
}

/** How long without fetch/heartbeat activity before a healthy source is considered degraded. */
const WATCHDOG_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 3_000;
/** How long startup waits for each step of reading the group's start position before going on without it. */
const START_POSITION_TIMEOUT_MS = 5_000;
/** Few, short retries for that read, so KafkaJS gives up on its own close to the deadline instead of retrying for 25 seconds. */
const START_POSITION_RETRY = { initialRetryTime: 300, maxRetryTime: 1_000, retries: 2 };

/**
 * KafkaJS adapter with explicit progress management: auto-commit and automatic
 * batch resolution are disabled, records are processed in partition order with
 * heartbeats, and the next offset is committed only after the gateway finishes
 * processing a record. A poison record pauses the whole source and seeks back so
 * resume retries the same record; nothing after it is committed.
 */
export class KafkaSourceAdapter implements SourceAdapter {
  readonly kind = "kafka" as const;
  readonly #sourceId: string;
  readonly #source: Extract<Source, { kind: "kafka" }>;
  readonly #connection: ResolvedKafkaConnection;
  readonly #sink: SourceSink;
  readonly #onCommit: (position: SourceRecord["position"]) => void;
  readonly #beforeCommit: ((sourceId: string, position: SourceRecord["position"]) => Promise<void>) | undefined;
  readonly #clientId: string;
  #consumer: Consumer | null = null;
  #kafka: KafkaClient | null = null;
  #admin: Admin | null = null;
  /** The admin client reading start positions while startup does, and its sockets; stop() closes both. */
  #startAdmin: { admin: Admin; sockets: TrackedSockets } | null = null;
  /** Counts the consumer's COMMIT_OFFSETS events; a commit that raised none did not happen. */
  #commitEvents = 0;
  /** The record the source is paused at, if a process() call returned pause. */
  #held: { topic: string; partition: number; offset: string } | null = null;
  /** Partitions assigned at the last group join, and a counter that changes on every rejoin. */
  #assignment: Map<string, Set<number>> | null = null;
  #assignmentEpoch = 0;
  #status: "starting" | "healthy" | "degraded" | "paused" | "stopped" = "starting";
  #paused = false;
  #rebalancing = false;
  #stopping = false;
  #lastActivity = Date.now();
  /** The record being processed and since when, so the watchdog can say a quiet broker coincides with a slow record. */
  #processing: { position: Extract<SourceRecord["position"], { kind: "kafka" }>; since: number } | null = null;
  #watchdog: NodeJS.Timeout | null = null;
  #joined: (() => void) | null = null;
  /** Records processed whose commit failed, per partition, retried until a later commit or a rebalance supersedes them. */
  readonly #uncommitted = new Map<string, { position: Extract<SourceRecord["position"], { kind: "kafka" }>; epoch: number }>();
  /** Serializes offset commits so a retried commit can never land after, and move back, a later one. */
  #commits: Promise<unknown> = Promise.resolve();
  #retrying = false;
  /**
   * startFrom "latest": the high-water marks read before the consumer started, for partitions the group
   * had no committed offset on. Committed once the first assignment is fetching (null after that), so a
   * restart before the first record's commit resumes here instead of at a later "latest".
   */
  #startPositions: Map<string, string> | null = null;
  #startJoin: Map<string, Set<number>> | null = null;
  #startCommit: Promise<void> | null = null;
  readonly #sockets = new TrackedSockets();

  constructor(options: {
    projectId: string;
    sourceId: string;
    source: Extract<Source, { kind: "kafka" }>;
    connection: ResolvedKafkaConnection;
    sink: SourceSink;
    onCommit: (position: SourceRecord["position"]) => void;
    beforeCommit?: (sourceId: string, position: SourceRecord["position"]) => Promise<void>;
  }) {
    this.#sourceId = options.sourceId;
    this.#source = options.source;
    this.#connection = options.connection;
    this.#sink = options.sink;
    this.#onCommit = options.onCommit;
    this.#beforeCommit = options.beforeCommit;
    this.#clientId = `streamotter-${options.projectId}-${options.sourceId}`;
  }

  async start(): Promise<void> {
    const kafka = new Kafka(kafkaConfig(this.#clientId, this.#connection, this.#sink, this.#sockets, () => this.#stopping));
    this.#kafka = kafka;
    const consumer = kafka.consumer({
      groupId: this.#source.consumerGroup,
      sessionTimeout: 30_000,
      heartbeatInterval: HEARTBEAT_INTERVAL_MS,
      maxWaitTimeInMs: 1_000,
      allowAutoTopicCreation: false,
      retry: { initialRetryTime: 300, maxRetryTime: 5_000, retries: 8, restartOnFailure: async () => !this.#stopping }
    });
    this.#consumer = consumer;
    this.#instrument(consumer);
    const joined = new Promise<void>(resolve => { this.#joined = resolve; });
    await consumer.connect();
    await consumer.subscribe({ topics: [...this.#source.topics], fromBeginning: this.#source.startFrom === "earliest" });
    await this.#readStartPositions();
    if (this.#stopping) return;
    await consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently: 1,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        if (this.#paused) {
          // A consumer that crashed and restarted while paused has lost KafkaJS's own pause state;
          // without it, returning unresolved would fetch the same records again in a tight loop.
          this.#reapplyPause();
          return;
        }
        // Nothing is processed before the start position is recorded, so a record's commit never precedes it.
        if (this.#startCommit !== null) await this.#startCommit;
        for (const message of batch.messages) {
          if (this.#paused || this.#stopping || !isRunning() || isStale()) return;
          const position = { kind: "kafka" as const, topic: batch.topic, partition: batch.partition, offset: message.offset };
          const timestamp = Number(message.timestamp);
          const input: SourceInput = {
            key: message.key === null ? null : message.key.toString("utf8"),
            bytes: message.value,
            keyBytes: message.key,
            headers: flattenKafkaHeaders(message.headers),
            timestamp: Number.isFinite(timestamp) && timestamp >= 0 ? new Date(timestamp).toISOString() : null,
            position,
            heartbeat
          };
          // KafkaJS heartbeats only between batches. Keep the group membership (and the watchdog) alive
          // while one record takes long, or the group evicts this member and the record is redelivered forever.
          const beating = setInterval(() => { heartbeat().catch(() => undefined); }, HEARTBEAT_INTERVAL_MS);
          let outcome: Awaited<ReturnType<SourceSink["process"]>>;
          this.#processing = { position, since: Date.now() };
          try {
            outcome = await this.#sink.process(input);
          } finally {
            clearInterval(beating);
            this.#processing = null;
          }
          if (outcome.kind === "abandon") return;
          if (outcome.kind === "hold") {
            this.#pauseAt(batch.topic, batch.partition, message.offset);
            return;
          }
          if (outcome.kind === "pause") {
            this.#pauseAt(batch.topic, batch.partition, message.offset);
            this.#held = { topic: batch.topic, partition: batch.partition, offset: message.offset };
            const sink = this.#sink;
            // Disposition runs after eachBatch returns, never inside the fetch loop (ADR-15A §1).
            setImmediate(() => sink.held(input, outcome));
            return;
          }
          resolveOffset(message.offset);
          if (this.#beforeCommit !== undefined) await this.#beforeCommit(this.#sourceId, position);
          if (this.#stopping) return;
          // Taken before the commit: a crash or rebalance while it runs makes the retry stale, not current.
          const epoch = this.#assignmentEpoch;
          try {
            await this.#commit(consumer, position);
            this.#onCommit(position);
          } catch (error) {
            // Processing completed; a failed commit only means this record can be redelivered. It is retried
            // in the background, so the last record before a quiet period doesn't stay uncommitted.
            this.#uncommitted.set(`${batch.topic}:${batch.partition}`, { position, epoch });
            this.#sink.logger.warn("Kafka offset commit failed; the record may be redelivered", {
              sourceId: this.#sourceId, topic: batch.topic, partition: batch.partition, offset: message.offset,
              error: (error as Error).name
            });
            return;
          }
          await heartbeat();
        }
      }
    });
    await joined;
    if (this.#stopping) return; // stop() released the wait; it has already cleared any watchdog.
    this.#watchdog = setInterval(() => {
      this.#checkWatchdog();
      this.#retryCommits();
    }, 1_000);
    this.#watchdog.unref();
  }

  async stop(deadline: number): Promise<void> {
    this.#stopping = true;
    if (this.#watchdog !== null) clearInterval(this.#watchdog);
    this.#joined?.();
    const consumer = this.#consumer;
    const admin = this.#admin;
    this.#admin = null;
    if (admin !== null) await admin.disconnect().catch(() => undefined);
    const startAdmin = this.#startAdmin;
    this.#startAdmin = null;
    if (startAdmin !== null) {
      // Its sockets first: disconnect waits for a request in flight, which a silent broker answers only at the request timeout.
      startAdmin.sockets.destroyAll();
      await startAdmin.admin.disconnect().catch(() => undefined);
    }
    if (consumer !== null) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        consumer.disconnect().catch(() => undefined),
        new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); })
      ]);
      clearTimeout(timer);
    }
    if (this.#sockets.size > 0) {
      this.#sink.logger.info("Closing Kafka connections the client left open", { sourceId: this.#sourceId, count: this.#sockets.size });
      this.#sockets.destroyAll();
    }
    this.#status = "stopped";
  }

  async resume(): Promise<void> {
    if (!this.#paused || this.#consumer === null) return;
    this.#paused = false;
    this.#held = null;
    this.#setStatus("healthy");
    this.#consumer.resume(this.#source.topics.map(topic => ({ topic })));
  }

  async check(deadline: number): Promise<DiagnosticStep[]> {
    return runKafkaDiagnostics(this.#connection, this.#source.topics, deadline);
  }

  /**
   * Commits exactly offset + 1 for the held record, reads the group's committed
   * offset back through the admin client, lets the caller record the advance, and
   * only then seeks past the record and resumes. Any doubt (a failed commit, a failed or different read-back, or a
   * rebalance while waiting) is "uncertain" and the source stays paused. This is
   * deliberately stricter than the ordinary commit path, where a failed commit
   * only means a record may be redelivered.
   */
  async advancePast(held: HeldPosition): Promise<AdvanceResult> {
    const consumer = this.#consumer;
    const current = this.#held;
    const position = held.position;
    if (consumer === null || this.#kafka === null || this.#stopping || !this.#paused || current === null || position.kind !== "kafka") return "not-held";
    if (current.topic !== position.topic || current.partition !== position.partition || current.offset !== position.offset) return "not-held";
    if (this.#assignment?.get(position.topic)?.has(position.partition) !== true) return "not-held";
    const epoch = this.#assignmentEpoch;
    const next = nextOffset(position.offset);
    try {
      await this.#commit(consumer, position);
    } catch (error) {
      this.#sink.logger.warn("Advancing past a held record failed at commit; the source stays paused", {
        sourceId: this.#sourceId, topic: position.topic, partition: position.partition, offset: position.offset, error: (error as Error).name
      });
      return "uncertain";
    }
    let committed: string | null = null;
    // stop() disconnects only the admin client it finds, so none may be created or left connected once it has begun.
    // The commit may have landed, so the advance is uncertain and restart reconciles it.
    if (this.#stopping) return "uncertain";
    try {
      const admin = this.#admin ??= this.#kafka.admin();
      await admin.connect();
      if (this.#stopping) {
        await admin.disconnect().catch(() => undefined);
        return "uncertain";
      }
      const offsets = await admin.fetchOffsets({ groupId: this.#source.consumerGroup, topics: [position.topic] });
      committed = offsets.find(entry => entry.topic === position.topic)?.partitions.find(entry => entry.partition === position.partition)?.offset ?? null;
    } catch (error) {
      this.#sink.logger.warn("The committed offset could not be read back; the source stays paused", {
        sourceId: this.#sourceId, topic: position.topic, partition: position.partition, error: (error as Error).name
      });
      return "uncertain";
    }
    if (committed !== next || epoch !== this.#assignmentEpoch || this.#held !== current || this.#stopping) {
      this.#sink.logger.warn("The committed offset did not match after advancing; the source stays paused", {
        sourceId: this.#sourceId, topic: position.topic, partition: position.partition, expected: next, observed: committed
      });
      return "uncertain";
    }
    this.#onCommit(position);
    // The caller records the advance before anything after the record can be consumed (spec §6).
    if (held.confirmed !== undefined && !(await held.confirmed().catch(() => false))) {
      this.#sink.logger.warn("The advance is committed but was not recorded; the source stays paused until a restart reconciles it", {
        sourceId: this.#sourceId, topic: position.topic, partition: position.partition, offset: position.offset
      });
      return "advanced";
    }
    if (this.#stopping) return "advanced";
    this.#held = null;
    this.#paused = false;
    consumer.seek({ topic: position.topic, partition: position.partition, offset: next });
    this.#setStatus("healthy");
    consumer.resume(this.#source.topics.map(topic => ({ topic })));
    return "advanced";
  }

  /**
   * Commits the offset after a record, in order with every other commit. A
   * success supersedes any failed commit still waiting on that partition.
   */
  #commit(consumer: Consumer, position: Extract<SourceRecord["position"], { kind: "kafka" }>, still: () => boolean = () => true): Promise<boolean> {
    const key = `${position.topic}:${position.partition}`;
    const commit = this.#commits.then(async () => {
      // Checked in turn, so a retry queued behind a later commit doesn't move the offset back.
      if (!still()) return false;
      await this.#commitOffsets(consumer, [{ topic: position.topic, partition: position.partition, offset: nextOffset(position.offset) }]);
      const pending = this.#uncommitted.get(key);
      if (pending !== undefined && BigInt(pending.position.offset) <= BigInt(position.offset)) this.#uncommitted.delete(key);
      return true;
    });
    this.#commits = commit.catch(() => undefined);
    return commit;
  }

  /**
   * KafkaJS resolves commitOffsets without committing while its consumer is not running (between a
   * crash or stop and the restarted consumer's join), so a commit counts only if it raised COMMIT_OFFSETS.
   * Callers serialize commits through #commits, so the event seen during the call is this commit's.
   */
  async #commitOffsets(consumer: Consumer, offsets: { topic: string; partition: number; offset: string }[]): Promise<void> {
    const before = this.#commitEvents;
    await consumer.commitOffsets(offsets);
    if (this.#commitEvents === before) {
      const error = new Error("The Kafka consumer was not running, so the offset was not committed.");
      error.name = "KafkaConsumerNotRunning";
      throw error;
    }
  }

  /** Retries failed commits still current: none after a rebalance, when the partition's next owner starts from the committed offset. */
  #retryCommits(): void {
    const consumer = this.#consumer;
    if (consumer === null || this.#stopping || this.#rebalancing || this.#retrying || this.#uncommitted.size === 0) return;
    this.#retrying = true;
    void (async () => {
      for (const [key, pending] of [...this.#uncommitted]) {
        if (pending.epoch !== this.#assignmentEpoch) {
          if (this.#uncommitted.get(key) === pending) this.#uncommitted.delete(key);
          continue;
        }
        // Skipped when a later commit or a rebalance superseded it, or the source began stopping, while it waited.
        const current = () => this.#uncommitted.get(key) === pending && pending.epoch === this.#assignmentEpoch && !this.#stopping && !this.#rebalancing;
        try {
          if (!(await this.#commit(consumer, pending.position, current))) continue;
        } catch {
          continue; // Still pending; the next tick tries again.
        }
        this.#sink.logger.info("Kafka offset commit succeeded on retry", {
          sourceId: this.#sourceId, topic: pending.position.topic, partition: pending.position.partition, offset: pending.position.offset
        });
        this.#onCommit(pending.position);
      }
    })().finally(() => { this.#retrying = false; });
  }

  /**
   * Reads the group's committed offsets and each partition's retained range
   * before the consumer starts. Warns about a committed offset outside that
   * range, which Kafka silently resets to startFrom (records skipped or read
   * again). With startFrom "latest", remembers the high-water mark of every
   * partition with nothing committed: it is at or before wherever the consumer
   * will start, so committing it can never skip a record. Best effort; a
   * failure only logs.
   */
  async #readStartPositions(): Promise<void> {
    // stop() disconnects only the admin client it finds, so none may be created once it has begun.
    if (this.#stopping) return;
    let abandoned = false;
    const sockets = new TrackedSockets();
    const config = kafkaConfig(this.#clientId, this.#connection, this.#sink, sockets, () => this.#stopping || abandoned);
    // A client of its own with few retries. A connection KafkaJS still opens after the read was given up
    // is closed at once, so its retrier ends quickly instead of reconnecting behind the source's back.
    const admin = new Kafka({
      ...config,
      retry: START_POSITION_RETRY,
      socketFactory: options => {
        const socket = sockets.factory(options);
        if (abandoned || this.#stopping) socket.destroy(new Error("start position read abandoned"));
        return socket;
      }
    }).admin();
    this.#startAdmin = { admin, sockets };
    const latest = this.#source.startFrom === "latest";
    const starts = new Map<string, string>();
    let failed = false;
    try {
      await withDeadline(admin.connect(), Date.now() + START_POSITION_TIMEOUT_MS, "Kafka connect");
      const deadline = Date.now() + START_POSITION_TIMEOUT_MS;
      const committed = await withDeadline(admin.fetchOffsets({ groupId: this.#source.consumerGroup, topics: [...this.#source.topics] }), deadline, "offset fetch");
      for (const { topic, partitions } of committed) {
        const ranges = new Map((await withDeadline(admin.fetchTopicOffsets(topic), deadline, "topic offsets")).map(entry => [entry.partition, entry]));
        for (const { partition, offset } of partitions) {
          const range = ranges.get(partition);
          if (range === undefined) continue;
          if (offset === "-1") {
            if (latest) starts.set(`${topic}:${partition}`, range.high);
          } else if (BigInt(offset) < BigInt(range.low) || BigInt(offset) > BigInt(range.high)) {
            this.#sink.logger.warn("The consumer group's committed offset is outside the partition's retained range; Kafka resets it to the startFrom offset, so records may be skipped or read again", {
              sourceId: this.#sourceId, topic, partition, committed: offset, low: range.low, high: range.high, startFrom: this.#source.startFrom
            });
          }
        }
      }
      if (latest && starts.size > 0) this.#startPositions = starts;
    } catch (error) {
      failed = true;
      if (!this.#stopping) {
        this.#sink.logger.warn(latest
          ? "The consumer group's start position could not be read; a restart before the first commit starts from the latest offset again"
          : "The consumer group's committed offsets could not be read, so an offset outside the retained range is not reported", {
          sourceId: this.#sourceId, error: (error as Error).name
        });
      }
    } finally {
      abandoned = true;
      if (this.#startAdmin?.admin === admin) this.#startAdmin = null;
      // After a failure a request may still be waiting, and disconnect would wait for it; closing the sockets ends it.
      if (failed) sockets.destroyAll();
      await admin.disconnect().catch(() => undefined);
      sockets.destroyAll();
    }
  }

  /** Commits the start positions read before the consumer started, for the partitions of the first assignment that still have none. */
  #commitStartPositions(consumer: Consumer): void {
    const starts = this.#startPositions;
    const assignment = this.#startJoin;
    this.#startPositions = null;
    this.#startJoin = null;
    if (starts === null || assignment === null) return;
    const offsets = [...assignment].flatMap(([topic, partitions]) => [...partitions]
      .filter(partition => starts.has(`${topic}:${partition}`))
      .map(partition => ({ topic, partition, offset: starts.get(`${topic}:${partition}`) as string })));
    if (offsets.length === 0) return;
    const commit = this.#commits.then(async () => {
      if (this.#stopping) return;
      try {
        await this.#commitOffsets(consumer, offsets);
        this.#sink.logger.info("Recorded the latest start position for partitions with no committed offset", { sourceId: this.#sourceId, partitions: offsets.length });
      } catch (error) {
        this.#sink.logger.warn("The start position could not be committed; a restart before the first commit starts from the latest offset again", {
          sourceId: this.#sourceId, error: (error as Error).name
        });
      }
    }).finally(() => { if (this.#startCommit === commit) this.#startCommit = null; });
    this.#startCommit = commit;
    this.#commits = commit;
  }

  #reapplyPause(): void {
    this.#consumer?.pause(this.#source.topics.map(name => ({ topic: name })));
  }

  #pauseAt(topic: string, partition: number, offset: string): void {
    const consumer = this.#consumer;
    this.#paused = true;
    this.#status = "paused";
    if (consumer === null) return;
    consumer.pause(this.#source.topics.map(name => ({ topic: name })));
    consumer.seek({ topic, partition, offset });
  }

  #setStatus(status: "healthy" | "degraded", reason?: "SOURCE_UNAVAILABLE"): void {
    if (this.#stopping || this.#paused) return;
    if (this.#status === status) return;
    this.#status = status;
    this.#sink.setStatus(status, reason);
  }

  #activity(): void {
    this.#lastActivity = Date.now();
    if (this.#status === "degraded" && !this.#rebalancing) this.#setStatus("healthy");
  }

  #checkWatchdog(): void {
    if (this.#status === "healthy" && Date.now() - this.#lastActivity > WATCHDOG_MS) {
      const processing = this.#processing;
      if (processing === null) {
        this.#sink.logger.warn("Kafka source has had no broker activity; marking it degraded", { sourceId: this.#sourceId });
      } else {
        // Heartbeats continue while a record is processed, so silence here means the broker isn't answering them,
        // not just that the record is slow. Name the record so the two can be told apart in the log.
        this.#sink.logger.warn("Kafka source has had no broker activity while a record is processing; heartbeats are not reaching the broker, marking it degraded", {
          sourceId: this.#sourceId, topic: processing.position.topic, partition: processing.position.partition, offset: processing.position.offset,
          processingMs: Date.now() - processing.since
        });
      }
      this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    }
  }

  #instrument(consumer: Consumer): void {
    const { events } = consumer;
    consumer.on(events.GROUP_JOIN, event => {
      this.#assignment = new Map(Object.entries(event.payload.memberAssignment).map(([topic, partitions]) => [topic, new Set(partitions)]));
      this.#assignmentEpoch++;
      this.#rebalancing = false;
      // Only the first assignment: positions read at startup say nothing about partitions gained later.
      if (this.#startPositions !== null && this.#startJoin === null) this.#startJoin = this.#assignment;
      else if (this.#startPositions !== null) {
        // The group rejoined before the first assignment fetched; another member may have committed since.
        this.#sink.logger.warn("The consumer group rebalanced before the start position was committed; a restart before the first commit starts from the latest offset again", {
          sourceId: this.#sourceId, partitions: this.#startPositions.size
        });
        this.#startPositions = null;
        this.#startJoin = null;
      }
      this.#lastActivity = Date.now();
      if (this.#paused) this.#reapplyPause();
      this.#setStatus("healthy");
      const joined = this.#joined;
      this.#joined = null;
      joined?.();
    });
    consumer.on(events.REBALANCING, () => {
      // Continuity cannot be assumed across a rebalance; subscriptions resynchronize after rejoin.
      this.#rebalancing = true;
      this.#assignment = null;
      this.#assignmentEpoch++;
      this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
    // KafkaJS ignores a commit until the consumer is running, which it is once it fetches.
    consumer.on(events.FETCH_START, () => { if (this.#startJoin !== null) this.#commitStartPositions(consumer); });
    consumer.on(events.FETCH, () => this.#activity());
    consumer.on(events.HEARTBEAT, () => this.#activity());
    consumer.on(events.COMMIT_OFFSETS, () => {
      this.#commitEvents++;
      this.#activity();
    });
    consumer.on(events.CRASH, event => {
      this.#sink.logger.warn("Kafka consumer crashed", {
        sourceId: this.#sourceId,
        error: event.payload.error.name,
        restart: event.payload.restart
      });
      this.#lostAssignment();
      this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
    consumer.on(events.DISCONNECT, () => {
      if (!this.#stopping) this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
    consumer.on(events.STOP, () => {
      this.#lostAssignment();
      if (!this.#stopping) this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
  }

  /** The consumer stopped (a crash restarts it): its assignment is gone and failed commits are no longer current. */
  #lostAssignment(): void {
    this.#assignment = null;
    this.#assignmentEpoch++;
  }
}

export function createKafkaSourceAdapter(options: ConstructorParameters<typeof KafkaSourceAdapter>[0]): KafkaSourceAdapter {
  return new KafkaSourceAdapter(options);
}

function splitBroker(broker: string): { host: string; port: number } {
  const index = broker.lastIndexOf(":");
  const host = broker.slice(0, index).replace(/^\[|\]$/g, "");
  return { host, port: Number(broker.slice(index + 1)) };
}

function withDeadline<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), Math.max(1, deadline - Date.now()));
      timer.unref(); // The raced promise keeps the process alive while it is needed.
    })
  ]).finally(() => clearTimeout(timer));
}

/**
 * Staged diagnostics for an existing profile: resolve → connect → tls →
 * authenticate → metadata. Messages name brokers and stages, never credentials.
 */
export async function runKafkaDiagnostics(connection: ResolvedKafkaConnection, topics: readonly string[], deadline: number): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];
  const skipRest = (from: DiagnosticStep["stage"][], message: string) => {
    for (const stage of from) steps.push({ stage, outcome: "skipped", message });
  };
  const brokers = connection.brokers.map(splitBroker);
  const resolved: { host: string; port: number }[] = [];
  for (const broker of brokers) {
    try {
      await withDeadline(lookup(broker.host), deadline, "DNS lookup");
      resolved.push(broker);
    } catch {
      // Reported below.
    }
  }
  if (resolved.length === 0) {
    steps.push({ stage: "resolve", outcome: "failed", message: `No broker host could be resolved (${connection.brokers.join(", ")}).` });
    skipRest(["connect", "tls", "authenticate", "metadata"], "Skipped because no broker resolved.");
    return steps;
  }
  steps.push({ stage: "resolve", outcome: "ok", message: `Resolved ${resolved.length} of ${brokers.length} broker host(s).` });

  let reachable: { host: string; port: number } | null = null;
  for (const broker of resolved) {
    const ok = await withDeadline(new Promise<boolean>(resolve => {
      const socket = netConnect({ host: broker.host, port: broker.port });
      socket.setTimeout(3_000, () => { socket.destroy(); resolve(false); });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    }), deadline, "TCP connect").catch(() => false);
    if (ok) {
      reachable = broker;
      break;
    }
  }
  if (reachable === null) {
    steps.push({ stage: "connect", outcome: "failed", message: "No broker accepted a TCP connection. Check the address, port, and network path." });
    skipRest(["tls", "authenticate", "metadata"], "Skipped because no broker was reachable.");
    return steps;
  }
  steps.push({ stage: "connect", outcome: "ok", message: `Connected to ${reachable.host}:${reachable.port}.` });

  if (connection.tls) {
    const target = reachable;
    const tlsResult = await withDeadline(new Promise<string | null>(resolve => {
      const options: ConnectionOptions = { host: target.host, port: target.port };
      if (!/^[\d.]+$|:/.test(target.host)) options.servername = target.host;
      if (connection.ca !== null) options.ca = [connection.ca];
      const socket = tlsConnect(options);
      socket.setTimeout(5_000, () => { socket.destroy(); resolve("The TLS handshake timed out."); });
      socket.once("secureConnect", () => { socket.destroy(); resolve(null); });
      socket.once("error", (error: NodeJS.ErrnoException) => resolve(`The TLS handshake failed (${error.code ?? error.name}). Check the CA file and that the listener uses TLS.`));
    }), deadline, "TLS").catch(() => "The TLS handshake timed out.");
    if (tlsResult !== null) {
      steps.push({ stage: "tls", outcome: "failed", message: tlsResult });
      skipRest(["authenticate", "metadata"], "Skipped because TLS failed.");
      return steps;
    }
    steps.push({ stage: "tls", outcome: "ok", message: "TLS handshake succeeded and the certificate is trusted." });
  } else {
    steps.push({ stage: "tls", outcome: "skipped", message: "TLS is disabled for this development profile." });
  }

  const sockets = new TrackedSockets();
  const admin = new Kafka({ ...kafkaConfig("streamotter-source-check", connection, null, sockets, () => true), retry: { retries: 0 } }).admin();
  try {
    await withDeadline(admin.connect(), deadline, "Kafka connect");
    steps.push(connection.sasl === null
      ? { stage: "authenticate", outcome: "skipped", message: "No SASL mechanism is configured." }
      : { stage: "authenticate", outcome: "ok", message: `SASL ${connection.sasl.mechanism.toUpperCase()} authentication succeeded.` });
  } catch (error) {
    const name = (error as Error).name;
    const authFailure = /SASL|Authentication/i.test(name) || /SASL|Authentication/i.test((error as Error).message);
    steps.push({
      stage: "authenticate",
      outcome: "failed",
      message: authFailure
        ? `SASL authentication failed (${name}). Check the credential environment variables and mechanism.`
        : `The Kafka protocol connection failed (${name}).`
    });
    steps.push({ stage: "metadata", outcome: "skipped", message: "Skipped because the connection failed." });
    await admin.disconnect().catch(() => undefined);
    sockets.destroyAll();
    return steps;
  }
  try {
    const existing = new Set(await withDeadline(admin.listTopics(), deadline, "metadata"));
    const missing = topics.filter(topic => !existing.has(topic));
    if (missing.length > 0) {
      steps.push({ stage: "metadata", outcome: "failed", message: `Configured topic(s) not found: ${missing.join(", ")}.` });
    } else {
      const metadata = await withDeadline(admin.fetchTopicMetadata({ topics: [...topics] }), deadline, "metadata");
      const partitions = metadata.topics.reduce((sum, topic) => sum + topic.partitions.length, 0);
      steps.push({ stage: "metadata", outcome: "ok", message: `Found ${topics.length} topic(s) with ${partitions} partition(s).` });
    }
  } catch (error) {
    steps.push({ stage: "metadata", outcome: "failed", message: `Metadata request failed (${(error as Error).name}).` });
  } finally {
    await admin.disconnect().catch(() => undefined);
    sockets.destroyAll();
  }
  return steps;
}
