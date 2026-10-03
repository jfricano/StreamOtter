import kafkajs, { type Admin, type Producer } from "kafkajs";
import { StreamOtterError, type GatewayLogger } from "@streamotter/contracts";
import { createTrackedKafka, type ResolvedKafkaConnection, type TrackedSockets } from "../sources/kafka.ts";
import { MAX_ENVELOPE_HEADER_BYTES, QUARANTINE_HEADROOM_BYTES } from "./evidence.ts";
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
      const name = `src.${header.name}`;
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
