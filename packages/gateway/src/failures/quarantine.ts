import { randomUUID } from "node:crypto";
import kafkajs, { type Admin, type Consumer, type IHeaders, type Producer } from "kafkajs";
import { StreamOtterError, type GatewayLogger } from "@streamotter/contracts";
import { createTrackedKafka, type ResolvedKafkaConnection, type TrackedSockets } from "../sources/kafka.ts";
import {
  evidenceHash, MAX_ENVELOPE_HEADER_BYTES, QUARANTINE_HEADROOM_BYTES, SOURCE_HEADER_PREFIX, sourceHeadersFromQuarantine
} from "./evidence.ts";
import type { RawEvidence } from "./store.ts";

const { ConfigResourceTypes } = kafkajs;

/** One quarantine write. The envelope is metadata only; the evidence carries the original bytes verbatim (ADR-15A §4). */
export interface QuarantineWrite {
  failureId: string;
  envelope: string;
  evidence: RawEvidence;
}

/**
 * acknowledged: the broker confirmed the write with acks=all at these coordinates.
 * unknown: the request may or may not have been appended (timeout, lost response). Never success.
 * failed: the broker definitely refused it (authorization, size, missing topic).
 */
export type QuarantineOutcome =
  | { kind: "acknowledged"; partition: number; offset: string }
  | { kind: "unknown"; reason: string }
  | { kind: "failed"; reason: string };

/** What the failure service needs from a quarantine destination; KafkaQuarantineWriter is the only production one. */
export interface QuarantineWriter {
  publish(write: QuarantineWrite): Promise<QuarantineOutcome>;
  stop(): Promise<void>;
}

/**
 * Reading one quarantined record back (evaluate, redrive, raw views):
 * found: the record at the coordinates carries this failure's ID header and its
 *   reconstructed key, value and src.* headers hash to the incident's evidence hash;
 * expired: the offset is below the partition's earliest retained offset (retention or deletion);
 * mismatch: a record is there but it is not this failure's evidence (wrong failure ID or hash);
 * unavailable: anything else (broker unreachable, authorization, timeout, missing topic).
 */
export type QuarantineRead =
  | { kind: "found"; evidence: RawEvidence }
  | { kind: "expired"; reason: string }
  | { kind: "mismatch"; reason: string }
  | { kind: "unavailable"; reason: string };

export interface QuarantineReadRequest {
  failureId: string;
  partition: number;
  offset: string;
  /** The incident's "sha256:<hex>" evidence hash, checked against what is read. */
  evidenceHash: string;
  /** Bounded scan budget; default 10 s. */
  timeoutMs?: number;
}

/** Reads quarantine evidence back from the topic. KafkaQuarantineReader is the only production one. */
export interface QuarantineReader {
  read(request: QuarantineReadRequest): Promise<QuarantineRead>;
  stop(): Promise<void>;
}

export interface QuarantineTopicReport {
  topic: string;
  clusterId: string;
  partitions: number;
  replicationFactor: number;
  maxMessageBytes: number;
  minInsyncReplicas: number | null;
}

/** Broker errors that prove the record was not appended. Everything else is treated as unknown. */
const DEFINITE_REFUSALS = new Set([
  "TOPIC_AUTHORIZATION_FAILED", "CLUSTER_AUTHORIZATION_FAILED", "MESSAGE_TOO_LARGE", "RECORD_LIST_TOO_LARGE",
  "UNKNOWN_TOPIC_OR_PARTITION", "INVALID_TOPIC_EXCEPTION", "INVALID_RECORD", "CORRUPT_MESSAGE", "INVALID_REQUIRED_ACKS",
  "SASL_AUTHENTICATION_FAILED", "TRANSACTIONAL_ID_AUTHORIZATION_FAILED"
]);

function brokerErrorType(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const type = (current as { type?: unknown }).type;
    if (typeof type === "string") return type;
    current = (current as { originalError?: unknown; cause?: unknown }).originalError ?? (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Writes quarantine evidence to the pre-provisioned topic on the project's one
 * Kafka cluster: an idempotent producer, acks=all, one request in flight, no
 * automatic topic creation, a 10-second request deadline and two retries
 * (ADR-15A §5). A timeout is reported as unknown, never as success.
 */
export class KafkaQuarantineWriter implements QuarantineWriter {
  readonly topic: string;
  readonly #connection: ResolvedKafkaConnection;
  readonly #logger: GatewayLogger;
  readonly #maxSourceRecordBytes: number;
  readonly #clientId: string;
  #producer: Producer | null = null;
  #sockets: TrackedSockets | null = null;
  #report: QuarantineTopicReport | null = null;

  constructor(options: { topic: string; connection: ResolvedKafkaConnection; logger: GatewayLogger; maxSourceRecordBytes: number; clientId: string }) {
    this.topic = options.topic;
    this.#connection = options.connection;
    this.#logger = options.logger;
    this.#maxSourceRecordBytes = options.maxSourceRecordBytes;
    this.#clientId = options.clientId;
  }

  get report(): QuarantineTopicReport | null {
    return this.#report;
  }

  /**
   * Reads the cluster ID and the topic's settings, refuses a topic that cannot
   * hold the largest accepted record plus headroom, then connects the producer.
   */
  async start(): Promise<QuarantineTopicReport> {
    const { kafka, sockets } = createTrackedKafka(this.#clientId, this.#connection, this.#logger);
    this.#sockets = sockets;
    const admin: Admin = kafka.admin();
    try {
      await admin.connect();
      const cluster = await admin.describeCluster();
      const metadata = await admin.fetchTopicMetadata({ topics: [this.topic] }).catch(() => null);
      const topicMetadata = metadata?.topics.find(entry => entry.name === this.topic);
      if (topicMetadata === undefined || topicMetadata.partitions.length === 0) {
        throw new StreamOtterError("CONFIG_INVALID", { message: `The quarantine topic is missing; provision it before enabling quarantine (automatic topic creation is never used).` });
      }
      const configs = await admin.describeConfigs({
        includeSynonyms: false,
        resources: [{ type: ConfigResourceTypes.TOPIC, name: this.topic, configNames: ["max.message.bytes", "min.insync.replicas"] }]
      });
      const entries = configs.resources[0]?.configEntries ?? [];
      const read = (name: string) => {
        const value = entries.find(entry => entry.configName === name)?.configValue;
        return value === undefined ? null : Number(value);
      };
      const maxMessageBytes = read("max.message.bytes");
      const required = this.#maxSourceRecordBytes + QUARANTINE_HEADROOM_BYTES;
      if (maxMessageBytes === null || !(maxMessageBytes >= required)) {
        throw new StreamOtterError("CONFIG_INVALID", {
          message: `The quarantine topic's max.message.bytes (${maxMessageBytes ?? "unknown"}) is below the ${required} bytes needed to hold the largest accepted record (maxSourceRecordBytes plus 80 KiB of headers).`
        });
      }
      this.#report = {
        topic: this.topic,
        clusterId: cluster.clusterId,
        partitions: topicMetadata.partitions.length,
        replicationFactor: Math.min(...topicMetadata.partitions.map(partition => partition.replicas.length)),
        maxMessageBytes,
        minInsyncReplicas: read("min.insync.replicas")
      };
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
    const producer = kafka.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
      retry: { initialRetryTime: 300, maxRetryTime: 2_000, retries: 2 }
    });
    await producer.connect();
    this.#producer = producer;
    return this.#report;
  }

  async publish(write: QuarantineWrite): Promise<QuarantineOutcome> {
    const producer = this.#producer;
    if (producer === null) return { kind: "failed", reason: "the quarantine producer is not connected" };
    if (Buffer.byteLength(write.envelope) > MAX_ENVELOPE_HEADER_BYTES) return { kind: "failed", reason: "the envelope exceeds 16 KiB" };
    const headers: Record<string, Buffer | Buffer[]> = {
      "streamotter-envelope": Buffer.from(write.envelope, "utf8"),
      "streamotter-failure-id": Buffer.from(write.failureId, "utf8")
    };
    for (const header of write.evidence.headers) {
      const name = `${SOURCE_HEADER_PREFIX}${header.name}`;
      const value = Buffer.from(header.value);
      const existing = headers[name];
      headers[name] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
    }
    try {
      const [result] = await producer.send({
        topic: this.topic,
        acks: -1,
        timeout: 10_000,
        messages: [{
          key: write.evidence.key === null ? null : Buffer.from(write.evidence.key),
          value: write.evidence.value === null ? null : Buffer.from(write.evidence.value),
          headers
        }]
      });
      if (result === undefined || result.errorCode !== 0 || result.baseOffset === undefined) {
        return { kind: "unknown", reason: "the broker response did not confirm an offset" };
      }
      return { kind: "acknowledged", partition: result.partition, offset: result.baseOffset };
    } catch (error) {
      const type = brokerErrorType(error);
      if (type !== null && DEFINITE_REFUSALS.has(type)) return { kind: "failed", reason: type };
      return { kind: "unknown", reason: type ?? (error as Error).name };
    }
  }

  async stop(): Promise<void> {
    const producer = this.#producer;
    this.#producer = null;
    if (producer !== null) await producer.disconnect().catch(() => undefined);
    this.#sockets?.destroyAll();
  }
}

const FAILURE_ID_HEADER = "streamotter-failure-id";
const DEFAULT_READ_TIMEOUT_MS = 10_000;
/** How long a finished or abandoned read may spend on each disconnect or group deletion before its sockets are destroyed. */
const READ_CLEANUP_GRACE_MS = 2_000;
/** How long cleanup waits for a read's in-flight KafkaJS calls (a group join, a connect retry) before giving up on them. */
const READ_SETTLE_LIMIT_MS = 30_000;
/** Record batch and fetch response framing on top of the record's own bytes, so one fetch can return the whole record. */
const FETCH_FRAMING_BYTES = 4 * 1024;
/** Short client retries: the whole read has its own deadline, and an abandoned read should give up quickly. */
const READ_RETRY = { initialRetryTime: 100, maxRetryTime: 1_000, retries: 3 };
const MAX_KAFKA_OFFSET = 2n ** 63n - 1n;
/** The throwaway consumer's session: also how long a member whose leave was lost can keep its group from being deleted. */
const READ_SESSION_TIMEOUT_MS = 10_000;
/** How long cleanup lets disconnected sockets finish closing before destroying them. */
const SOCKET_CLOSE_WAIT_MS = 500;
const STOPPED: QuarantineRead = { kind: "unavailable", reason: "the quarantine reader is stopped" };

/** Coordinates a read refuses without contacting Kafka; null when they are well formed. */
export function quarantineCoordinateIssue(partition: number, offset: string): string | null {
  if (!Number.isSafeInteger(partition) || partition < 0 || partition > 2 ** 31 - 1) return "the quarantine partition is not a valid partition number";
  if (typeof offset !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(offset) || BigInt(offset) > MAX_KAFKA_OFFSET) {
    return "the quarantine offset is not a decimal Kafka offset";
  }
  return null;
}

/**
 * Checks the record read at an incident's quarantine coordinates: exactly one
 * streamotter-failure-id header naming this failure, and key, value and src.*
 * headers (prefix removed, in order) hashing to the incident's evidence hash.
 * Reasons name the check that failed and never carry record bytes.
 */
export function verifyQuarantineRecord(
  record: { key: Buffer | null; value: Buffer | null; headers?: IHeaders | undefined },
  failureId: string,
  expectedHash: string
): QuarantineRead {
  const id = record.headers?.[FAILURE_ID_HEADER];
  if (id === undefined) return { kind: "mismatch", reason: "the record at these coordinates has no streamotter-failure-id header" };
  if (Array.isArray(id)) return { kind: "mismatch", reason: "the record at these coordinates has more than one streamotter-failure-id header" };
  if (!Buffer.from(id).equals(Buffer.from(failureId, "utf8"))) {
    return { kind: "mismatch", reason: "the record at these coordinates belongs to a different failure (streamotter-failure-id differs)" };
  }
  const evidence: RawEvidence = {
    key: record.key === null ? null : new Uint8Array(record.key),
    value: record.value === null ? null : new Uint8Array(record.value),
    headers: sourceHeadersFromQuarantine(record.headers)
  };
  if (evidenceHash(evidence) !== expectedHash) {
    return { kind: "mismatch", reason: "the record's key, value and headers do not match the incident's evidence hash" };
  }
  return { kind: "found", evidence };
}

/** The broker error type, or the innermost error class name: never a message, which could quote request details. */
function errorKind(error: unknown): string {
  const type = brokerErrorType(error);
  if (type !== null) return type;
  let name = "Error";
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (/^[A-Za-z0-9_]{1,64}$/.test(current.name)) name = current.name;
    current = (current as { originalError?: unknown }).originalError ?? current.cause;
  }
  return name;
}

function unavailable(error: unknown): QuarantineRead {
  const kind = errorKind(error);
  if (kind.endsWith("_AUTHORIZATION_FAILED") || kind === "SASL_AUTHENTICATION_FAILED") {
    return { kind: "unavailable", reason: `not authorized to read the quarantine topic (${kind})` };
  }
  if (kind === "UNKNOWN_TOPIC_OR_PARTITION" || kind === "INVALID_TOPIC_EXCEPTION") {
    return { kind: "unavailable", reason: `the quarantine topic does not exist (${kind})` };
  }
  return { kind: "unavailable", reason: `the quarantine topic could not be read (${kind})` };
}

/** The per-group error types of a refused group deletion, or null when the failure was not a per-group refusal. */
function groupDeletionErrors(error: unknown): string[] | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const groups = (current as { groups?: unknown }).groups;
    if (Array.isArray(groups) && groups.length > 0) return groups.map(entry => brokerErrorType((entry as { error?: unknown }).error) ?? "unknown");
    current = (current as { originalError?: unknown; cause?: unknown }).originalError ?? (current as { cause?: unknown }).cause;
  }
  return null;
}

function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
  return { promise, cancel: () => clearTimeout(timer) };
}

type Within<T> = { kind: "fulfilled"; value: T } | { kind: "rejected"; error: unknown } | { kind: "timeout" };

/** Waits for a step at most ms, or until hurry settles; the step's own failure is returned, never thrown. */
async function within<T>(step: Promise<T>, ms: number, hurry?: Promise<void>): Promise<Within<T>> {
  const limit = delay(ms);
  const stops: Promise<Within<T>>[] = [
    step.then(value => ({ kind: "fulfilled", value }) as const, (error: unknown) => ({ kind: "rejected", error }) as const),
    limit.promise.then(() => ({ kind: "timeout" }) as const)
  ];
  if (hurry !== undefined) stops.push(hurry.then(() => ({ kind: "timeout" }) as const));
  try {
    return await Promise.race(stops);
  } finally {
    limit.cancel();
  }
}

const ABANDONED: QuarantineRead = { kind: "unavailable", reason: "the read was abandoned" };

class AbandonedRead extends Error {}

/**
 * One read's clients: an admin for partition offsets, a short-lived consumer
 * in a throwaway group that never commits, and an admin to delete that group
 * afterwards. Once abandoned it starts nothing new. close() can run again
 * after in-flight KafkaJS calls settle, to release anything they reconnected.
 */
class QuarantineReadAttempt {
  readonly #topic: string;
  readonly #kafka: ReturnType<typeof createTrackedKafka>["kafka"];
  readonly #sockets: TrackedSockets;
  readonly #logger: GatewayLogger;
  readonly #fetchBytes: number;
  readonly #groupId: string;
  #admin: Admin | null = null;
  #consumer: Consumer | null = null;
  /** The consumer's run(): settles once it has joined the group, or failed to. */
  #running: Promise<void> | null = null;
  /** A consumer may have joined the throwaway group, which still has to be deleted. */
  #groupInUse = false;
  #closed = false;
  /** Ends the wait for the record. */
  #settle: (outcome: QuarantineRead) => void = () => undefined;

  constructor(options: { topic: string; connection: ResolvedKafkaConnection; logger: GatewayLogger; clientId: string; fetchBytes: number }) {
    const { kafka, sockets } = createTrackedKafka(options.clientId, options.connection, options.logger);
    this.#topic = options.topic;
    this.#kafka = kafka;
    this.#sockets = sockets;
    this.#logger = options.logger;
    this.#fetchBytes = options.fetchBytes;
    this.#groupId = `${options.clientId}-quarantine-read-${randomUUID()}`;
  }

  get openSockets(): number {
    return this.#sockets.size;
  }

  /** Never rejects: every failure becomes a read outcome. */
  async run(request: QuarantineReadRequest): Promise<QuarantineRead> {
    try {
      return await this.#run(request);
    } catch (error) {
      return this.#closed ? ABANDONED : unavailable(error);
    }
  }

  #ensureOpen(): void {
    if (this.#closed) throw new AbandonedRead();
  }

  async #run(request: QuarantineReadRequest): Promise<QuarantineRead> {
    const admin = this.#kafka.admin({ retry: READ_RETRY });
    this.#admin = admin;
    await admin.connect();
    this.#ensureOpen();
    const offsets = await admin.fetchTopicOffsets(this.#topic);
    this.#ensureOpen();
    const range = offsets.find(entry => entry.partition === request.partition);
    if (range === undefined) return { kind: "mismatch", reason: `the quarantine topic has no partition ${request.partition}` };
    const offset = BigInt(request.offset);
    if (offset < BigInt(range.low)) {
      return { kind: "expired", reason: `the record is below the partition's earliest retained offset ${range.low} (removed by retention or deletion)` };
    }
    if (offset >= BigInt(range.high)) return { kind: "mismatch", reason: "no record at that offset: the partition ends before it" };

    const consumer = this.#kafka.consumer({
      groupId: this.#groupId,
      allowAutoTopicCreation: false,
      sessionTimeout: READ_SESSION_TIMEOUT_MS,
      heartbeatInterval: 1_000,
      maxWaitTimeInMs: 250,
      maxBytes: this.#fetchBytes,
      maxBytesPerPartition: this.#fetchBytes,
      retry: { ...READ_RETRY, restartOnFailure: async () => false }
    });
    this.#consumer = consumer;
    const outcome = new Promise<QuarantineRead>(resolve => { this.#settle = resolve; });
    consumer.on(consumer.events.CRASH, event => this.#settle(unavailable(event.payload.error)));
    await consumer.connect();
    this.#ensureOpen();
    await consumer.subscribe({ topics: [this.#topic], fromBeginning: false });
    this.#ensureOpen();
    this.#groupInUse = true;
    let taken = false;
    this.#running = consumer.run({
      autoCommit: false,
      eachMessage: async ({ partition, message, pause }) => {
        if (partition !== request.partition || taken) return;
        taken = true;
        pause();
        // Fetches start at the sought offset, so the first record is either the one asked for or the next one after a gap.
        this.#settle(message.offset === request.offset
          ? verifyQuarantineRecord(message, request.failureId, request.evidenceHash)
          : { kind: "mismatch", reason: "no record at that offset: the partition skips it" });
      }
    }).catch((error: unknown) => this.#settle(unavailable(error)));
    // KafkaJS has no manual assignment: the sole member of a fresh group is assigned every
    // partition, so seek the one asked for (applied once assigned) and pause the others.
    consumer.seek({ topic: this.#topic, partition: request.partition, offset: request.offset });
    const others = offsets.map(entry => entry.partition).filter(partition => partition !== request.partition);
    if (others.length > 0) consumer.pause([{ topic: this.#topic, partitions: others }]);
    return outcome;
  }

  /** Stops waiting for the record and starts nothing new; close() releases what is open. */
  abandon(): void {
    this.#closed = true;
    this.#settle(ABANDONED);
  }

  /**
   * Releases everything the read opened, in order: lets a group join in flight
   * finish so the consumer's leave follows it, disconnects the consumer,
   * deletes the throwaway group, disconnects the admin and destroys every
   * remaining socket. Safe to repeat. hurry (shortly after the reader stops)
   * cuts the long waits short.
   */
  async close(hurry: Promise<void>): Promise<void> {
    this.abandon();
    const consumer = this.#consumer;
    if (consumer !== null) {
      if (this.#running !== null) await within(this.#running, READ_SETTLE_LIMIT_MS, hurry);
      await within(consumer.disconnect(), READ_CLEANUP_GRACE_MS);
    }
    if (this.#groupInUse) await this.#deleteGroup(hurry);
    const admin = this.#admin;
    if (admin !== null) await within(admin.disconnect(), READ_CLEANUP_GRACE_MS);
    // A disconnect ends its sockets but they close only when the broker answers; give them a moment before destroying the rest.
    const closing = Date.now() + SOCKET_CLOSE_WAIT_MS;
    while (this.#sockets.size > 0 && Date.now() < closing) await delay(10).promise;
    this.#sockets.destroyAll();
  }

  /** Best effort: a group that cannot be deleted is logged by ID, never a failed read. */
  async #deleteGroup(hurry: Promise<void>): Promise<void> {
    // A member whose leave was lost keeps the group non-empty until its session expires; keep trying until then.
    const giveUp = Date.now() + READ_SESSION_TIMEOUT_MS + READ_CLEANUP_GRACE_MS;
    const admin = this.#kafka.admin({ retry: READ_RETRY });
    let failure = "timeout";
    try {
      const connected = await within(admin.connect(), READ_CLEANUP_GRACE_MS);
      if (connected.kind === "rejected") failure = errorKind(connected.error);
      if (connected.kind !== "fulfilled") return;
      for (;;) {
        const deleted = await within(admin.deleteGroups([this.#groupId]), READ_CLEANUP_GRACE_MS);
        const errors = deleted.kind === "rejected" ? groupDeletionErrors(deleted.error) : null;
        if (deleted.kind === "fulfilled" || errors?.every(type => type === "GROUP_ID_NOT_FOUND") === true) {
          this.#groupInUse = false;
          return;
        }
        failure = deleted.kind === "timeout" ? "timeout" : errors?.join(", ") ?? errorKind(deleted.error);
        if (errors?.includes("NON_EMPTY_GROUP") !== true || Date.now() > giveUp) return;
        if ((await within(delay(500).promise, 1_000, hurry)).kind === "timeout") return;
      }
    } finally {
      if (this.#groupInUse) this.#logger.warn("Could not delete a quarantine read's throwaway consumer group", { groupId: this.#groupId, error: failure });
      await within(admin.disconnect(), READ_CLEANUP_GRACE_MS);
    }
  }
}

/**
 * Reads one quarantined record back by its coordinates (evaluate, redrive and
 * raw views; spec §8.2). Each read checks the partition's offsets with an
 * admin client, then takes exactly the record at that offset with a
 * short-lived consumer in a throwaway group: auto-commit off, fetches bounded
 * by maxSourceRecordBytes plus header headroom, the group deleted afterwards.
 * Reads run one at a time, each within its own deadline (default 10 s). A read
 * that completes returns once its clients are released; one cut off by its
 * deadline returns at once and is released in the background, before the next
 * read starts (waiting at most a grace period for KafkaJS calls still in
 * flight) and before idle() and stop() return.
 */
export class KafkaQuarantineReader implements QuarantineReader {
  readonly topic: string;
  readonly #connection: ResolvedKafkaConnection;
  readonly #logger: GatewayLogger;
  readonly #maxSourceRecordBytes: number;
  readonly #clientId: string;
  /** Settles once the previous read and its cleanup have finished. */
  #queue: Promise<void> = Promise.resolve();
  /** Attempts not yet fully released. */
  readonly #attempts = new Set<QuarantineReadAttempt>();
  /** Final closes still waiting for an abandoned attempt's KafkaJS calls to settle. */
  readonly #sweeps = new Set<Promise<void>>();
  #stopped = false;
  #signalStop: () => void = () => undefined;
  /** Settles when stop() is called. */
  readonly #stopping = new Promise<void>(resolve => { this.#signalStop = resolve; });
  #signalHurry: () => void = () => undefined;
  /** Settles a grace period after stop(), cutting cleanup's long waits on KafkaJS short. */
  readonly #hurry = new Promise<void>(resolve => { this.#signalHurry = resolve; });
  #abort: (() => void) | null = null;

  constructor(options: { topic: string; connection: ResolvedKafkaConnection; logger: GatewayLogger; maxSourceRecordBytes: number; clientId: string }) {
    this.topic = options.topic;
    this.#connection = options.connection;
    this.#logger = options.logger;
    this.#maxSourceRecordBytes = options.maxSourceRecordBytes;
    this.#clientId = options.clientId;
  }

  /** Sockets still open across this reader's reads. */
  get openSockets(): number {
    let total = 0;
    for (const attempt of this.#attempts) total += attempt.openSockets;
    return total;
  }

  /** Resolves once every read started so far, including the cleanup of reads cut off by their deadline, has finished. */
  async idle(): Promise<void> {
    await this.#queue;
    await Promise.all(this.#sweeps);
  }

  async read(request: QuarantineReadRequest): Promise<QuarantineRead> {
    const issue = quarantineCoordinateIssue(request.partition, request.offset);
    if (issue !== null) return { kind: "unavailable", reason: issue };
    const timeoutMs = request.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { kind: "unavailable", reason: "the read timeout is not a positive number of milliseconds" };
    if (this.#stopped) return STOPPED;
    const deadline = Date.now() + timeoutMs;
    const timedOut: QuarantineRead = { kind: "unavailable", reason: `the read did not finish within ${timeoutMs} ms` };

    // One read at a time; waiting for the previous one counts against this read's deadline.
    const previous = this.#queue;
    let release: () => void = () => undefined;
    const slot = new Promise<void>(resolve => { release = resolve; });
    this.#queue = previous.then(() => slot);
    const turn = await within(previous, timeoutMs, this.#stopping);
    if (turn.kind !== "fulfilled" || this.#stopped) {
      release();
      return this.#stopped ? STOPPED : timedOut;
    }

    const attempt = new QuarantineReadAttempt({
      topic: this.topic,
      connection: this.#connection,
      logger: this.#logger,
      clientId: this.#clientId,
      fetchBytes: this.#maxSourceRecordBytes + QUARANTINE_HEADROOM_BYTES + FETCH_FRAMING_BYTES
    });
    this.#attempts.add(attempt);
    const work = attempt.run(request);
    const aborted = new Promise<void>(resolve => { this.#abort = resolve; });
    const finished = await within(work, Math.max(0, deadline - Date.now()), aborted);
    this.#abort = null;
    if (finished.kind !== "fulfilled") attempt.abandon();
    const cleanup = (async () => {
      await attempt.close(this.#hurry);
      // A KafkaJS call still in flight (a connect retry, say) can reconnect after the close, so
      // close again once it settles. The next read waits for that only a grace period.
      const sweep = within(work, READ_SETTLE_LIMIT_MS, this.#hurry)
        .then(() => attempt.close(this.#hurry))
        .catch(() => undefined)
        .then(() => {
          this.#attempts.delete(attempt);
          this.#sweeps.delete(sweep);
        });
      this.#sweeps.add(sweep);
      await within(sweep, READ_CLEANUP_GRACE_MS);
      release();
    })();
    if (finished.kind !== "fulfilled") return this.#stopped ? STOPPED : timedOut;
    await cleanup;
    return finished.value;
  }

  /** Abandons a read in progress, waits for every read's cleanup, and makes later reads unavailable. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#signalStop();
    setTimeout(this.#signalHurry, READ_CLEANUP_GRACE_MS).unref();
    this.#abort?.();
    await this.idle();
  }
}
