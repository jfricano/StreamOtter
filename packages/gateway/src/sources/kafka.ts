import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { resolve as resolvePath } from "node:path";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import kafkajs, { type Consumer, type ISocketFactory, type KafkaConfig, type SASLOptions } from "kafkajs";
import { StreamOtterError, type DiagnosticStep, type KafkaConnection, type Source, type SourceRecord } from "@streamotter/contracts";
import { patchKafkaJsRequestQueue } from "./kafkajs-patch.ts";
import type { SourceAdapter, SourceSink } from "./types.ts";

const { Kafka, logLevel } = kafkajs;
patchKafkaJsRequestQueue();

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
    const missing = [profile.sasl.username.env, profile.sasl.password.env].filter(name => {
      const value = process.env[name];
      return value === undefined || value === "";
    });
    if (missing.length > 0) {
      throw new StreamOtterError("CONFIG_INVALID", {
        message: `Missing environment variable${missing.length > 1 ? "s" : ""} ${missing.join(", ")} referenced by the Kafka connection profile.`
      });
    }
    sasl = {
      mechanism: profile.sasl.mechanism,
      username: process.env[profile.sasl.username.env] as string,
      password: process.env[profile.sasl.password.env] as string
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

function kafkaConfig(
  clientId: string,
  connection: ResolvedKafkaConnection,
  sink: SourceSink | null,
  sockets: TrackedSockets,
  quiet: () => boolean = () => false
): KafkaConfig {
  const config: KafkaConfig = {
    clientId,
    socketFactory: sockets.factory,
    brokers: [...connection.brokers],
    connectionTimeout: 3_000,
    authenticationTimeout: 10_000,
    requestTimeout: 30_000,
    retry: { initialRetryTime: 300, maxRetryTime: 5_000, retries: 8 },
    logLevel: logLevel.ERROR,
    logCreator: () => entry => {
      // Forward only the namespace and message; KafkaJS extras can include request details.
      if (quiet()) return;
      sink?.logger.warn("Kafka client", { namespace: entry.namespace, message: String(entry.log.message).slice(0, 300) });
    }
  };
  if (connection.tls) config.ssl = connection.ca === null ? true : { ca: [connection.ca] };
  if (connection.sasl !== null) {
    config.sasl = { mechanism: connection.sasl.mechanism, username: connection.sasl.username, password: connection.sasl.password } as SASLOptions;
  }
  return config;
}

function nextOffset(offset: string): string {
  return (BigInt(offset) + 1n).toString();
}

/** How long without fetch/heartbeat activity before a healthy source is considered degraded. */
const WATCHDOG_MS = 12_000;

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
  readonly #onCommit: () => void;
  readonly #beforeCommit: ((sourceId: string, position: SourceRecord["position"]) => Promise<void>) | undefined;
  readonly #clientId: string;
  #consumer: Consumer | null = null;
  #status: "starting" | "healthy" | "degraded" | "paused" | "stopped" = "starting";
  #paused = false;
  #rebalancing = false;
  #stopping = false;
  #lastActivity = Date.now();
  #watchdog: NodeJS.Timeout | null = null;
  #joined: (() => void) | null = null;
  readonly #sockets = new TrackedSockets();

  constructor(options: {
    projectId: string;
    sourceId: string;
    source: Extract<Source, { kind: "kafka" }>;
    connection: ResolvedKafkaConnection;
    sink: SourceSink;
    onCommit: () => void;
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
    const consumer = kafka.consumer({
      groupId: this.#source.consumerGroup,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      maxWaitTimeInMs: 1_000,
      allowAutoTopicCreation: false,
      retry: { initialRetryTime: 300, maxRetryTime: 5_000, retries: 8, restartOnFailure: async () => !this.#stopping }
    });
    this.#consumer = consumer;
    this.#instrument(consumer);
    const joined = new Promise<void>(resolve => { this.#joined = resolve; });
    await consumer.connect();
    await consumer.subscribe({ topics: [...this.#source.topics], fromBeginning: this.#source.startFrom === "earliest" });
    await consumer.run({
      autoCommit: false,
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently: 1,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        for (const message of batch.messages) {
          if (this.#paused || this.#stopping || !isRunning() || isStale()) return;
          const position = { kind: "kafka" as const, topic: batch.topic, partition: batch.partition, offset: message.offset };
          const outcome = await this.#sink.process({
            key: message.key === null ? null : message.key.toString("utf8"),
            bytes: message.value,
            position
          });
          if (outcome.kind === "abandon") return;
          if (outcome.kind === "pause") {
            this.#pauseAt(batch.topic, batch.partition, message.offset);
            return;
          }
          resolveOffset(message.offset);
          if (this.#beforeCommit !== undefined) await this.#beforeCommit(this.#sourceId, position);
          if (this.#stopping) return;
          try {
            await consumer.commitOffsets([{ topic: batch.topic, partition: batch.partition, offset: nextOffset(message.offset) }]);
            this.#onCommit();
          } catch (error) {
            // Processing completed; a failed commit only means this record can be redelivered.
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
    this.#watchdog = setInterval(() => this.#checkWatchdog(), 1_000);
    this.#watchdog.unref();
  }

  async stop(deadline: number): Promise<void> {
    this.#stopping = true;
    if (this.#watchdog !== null) clearInterval(this.#watchdog);
    this.#joined?.();
    const consumer = this.#consumer;
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
    this.#setStatus("healthy");
    this.#consumer.resume(this.#source.topics.map(topic => ({ topic })));
  }

  async check(deadline: number): Promise<DiagnosticStep[]> {
    return runKafkaDiagnostics(this.#connection, this.#source.topics, deadline);
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
      this.#sink.logger.warn("Kafka source has had no broker activity; marking it degraded", { sourceId: this.#sourceId });
      this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    }
  }

  #instrument(consumer: Consumer): void {
    const { events } = consumer;
    consumer.on(events.GROUP_JOIN, () => {
      this.#rebalancing = false;
      this.#lastActivity = Date.now();
      this.#setStatus("healthy");
      const joined = this.#joined;
      this.#joined = null;
      joined?.();
    });
    consumer.on(events.REBALANCING, () => {
      // Continuity cannot be assumed across a rebalance; subscriptions resynchronize after rejoin.
      this.#rebalancing = true;
      this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
    consumer.on(events.FETCH, () => this.#activity());
    consumer.on(events.HEARTBEAT, () => this.#activity());
    consumer.on(events.COMMIT_OFFSETS, () => this.#activity());
    consumer.on(events.CRASH, event => {
      this.#sink.logger.warn("Kafka consumer crashed", {
        sourceId: this.#sourceId,
        error: event.payload.error.name,
        restart: event.payload.restart
      });
      this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
    consumer.on(events.DISCONNECT, () => {
      if (!this.#stopping) this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
    consumer.on(events.STOP, () => {
      if (!this.#stopping) this.#setStatus("degraded", "SOURCE_UNAVAILABLE");
    });
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
