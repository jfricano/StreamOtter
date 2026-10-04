import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import kafkajs, { type Admin, type Producer } from "kafkajs";
import type { GatewayLogger, Json } from "@streamotter/gateway";
import { sleep } from "../integration/harness.ts";
import { ROOT, uniqueName } from "../kafka/helpers.ts";

/**
 * Helpers for the replicated-broker tier (acceptance F47). They talk only to the
 * three-broker cluster from scripts/kafka/replicated-start.sh, never to the
 * single-node development broker the tests/kafka tier uses.
 */

const { Kafka, logLevel } = kafkajs;
const run = promisify(execFile);

export const REPLICATED = ["127.0.0.1:29092", "127.0.0.1:29093", "127.0.0.1:29094"];
export const BROKER_IDS = [1, 2, 3] as const;
export const SKIP_MESSAGE = "the replicated Kafka cluster is not running (start it with ./scripts/kafka/replicated-start.sh)";

const kafka = new Kafka({ clientId: "streamotter-replicated-tests", brokers: REPLICATED, logLevel: logLevel.NOTHING, retry: { retries: 8, maxRetryTime: 2_000 } });
let adminPromise: Promise<Admin> | null = null;
let producerPromise: Promise<Producer> | null = null;

export function replicatedAdmin(): Promise<Admin> {
  adminPromise ??= (async () => {
    const admin = kafka.admin();
    await admin.connect();
    return admin;
  })();
  return adminPromise;
}

/** True when all three brokers of the replicated cluster are registered and reachable. */
export async function replicatedAvailable(): Promise<boolean> {
  const probe = new Kafka({ clientId: "probe", brokers: REPLICATED, logLevel: logLevel.NOTHING, retry: { retries: 0 }, connectionTimeout: 1_000 }).admin();
  try {
    await probe.connect();
    const { brokers } = await probe.describeCluster();
    await probe.disconnect();
    return brokers.length === 3;
  } catch {
    await probe.disconnect().catch(() => undefined);
    return false;
  }
}

/** SIGKILLs one broker through the cluster script and returns the time it was killed. */
export async function killBroker(id: number): Promise<number> {
  await run(resolve(ROOT, "scripts/kafka/replicated-stop.sh"), ["--node", String(id), "--kill"]);
  return Date.now();
}

/** Starts one broker through the cluster script; resolves when it answers API requests. */
export async function startBroker(id: number): Promise<void> {
  await run(resolve(ROOT, "scripts/kafka/replicated-start.sh"), ["--node", String(id)], { timeout: 120_000 });
}

/** Starts any broker that is not running, so a failed test never leaves the next one with a degraded cluster. */
export async function restoreCluster(): Promise<void> {
  await run(resolve(ROOT, "scripts/kafka/replicated-start.sh"), [], { timeout: 300_000 });
}

export interface PartitionState { leader: number; replicas: number[]; isr: number[] }

const avoidingAdmins = new Map<string, Promise<Admin>>();

/**
 * An admin client bootstrapped only from the brokers not in `avoid`, so metadata
 * polls during a failure are not slowed by retries against a broker the test killed.
 */
function adminAvoiding(avoid: readonly number[]): Promise<Admin> {
  if (avoid.length === 0) return replicatedAdmin();
  const key = [...avoid].sort().join(",");
  let admin = avoidingAdmins.get(key);
  if (admin === undefined) {
    const brokers = BROKER_IDS.filter(id => !avoid.includes(id)).map(id => REPLICATED[id - 1]!);
    admin = (async () => {
      const client = new Kafka({ clientId: "streamotter-replicated-probe", brokers, logLevel: logLevel.NOTHING, retry: { retries: 2, maxRetryTime: 500 } }).admin();
      await client.connect();
      return client;
    })();
    avoidingAdmins.set(key, admin);
  }
  return admin;
}

/** Partition 0's leader, replicas and ISR as the cluster metadata reports them now. */
export async function partitionState(topic: string, avoid: readonly number[] = []): Promise<PartitionState> {
  const metadata = await (await adminAvoiding(avoid)).fetchTopicMetadata({ topics: [topic] });
  const partition = metadata.topics[0]?.partitions.find(entry => entry.partitionId === 0);
  if (partition === undefined) throw new Error(`no metadata for ${topic}/0`);
  return { leader: partition.leader, replicas: [...partition.replicas], isr: [...partition.isr].sort() };
}

/** Polls partition metadata (from brokers not in `avoid`) until the predicate holds; returns the matching state. */
export async function waitForPartition(
  topic: string, predicate: (state: PartitionState) => boolean, label: string, timeoutMs = 60_000, avoid: readonly number[] = []
): Promise<PartitionState> {
  const deadline = Date.now() + timeoutMs;
  let last: PartitionState | null = null;
  for (;;) {
    last = await partitionState(topic, avoid).catch(() => last);
    if (last !== null && predicate(last)) return last;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label} on ${topic}: last ${JSON.stringify(last)}`);
    await sleep(50);
  }
}

/**
 * Creates a one-partition topic with replication factor 3 whose preferred
 * leader is `leader`, and waits until that broker leads with all three replicas in sync.
 */
export async function createReplicatedTopic(leader: number, configEntries: { name: string; value: string }[] = []): Promise<string> {
  const topic = uniqueName("so-repl");
  const replicas = [leader, ...BROKER_IDS.filter(id => id !== leader)];
  await (await replicatedAdmin()).createTopics({
    topics: [{ topic, replicaAssignment: [{ partition: 0, replicas }], configEntries }],
    waitForLeaders: true
  });
  await waitForPartition(topic, state => state.leader === leader && state.isr.length === 3, "leader and full ISR", 30_000);
  return topic;
}

/** Java's String.hashCode, which Kafka uses to place a group on a __consumer_offsets partition. */
function javaHashCode(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0;
  return hash;
}

/**
 * A fresh consumer group ID whose coordinator (the leader of its __consumer_offsets
 * partition) is the given broker, so a test can keep the group coordinator off
 * the brokers it kills.
 */
export async function groupCoordinatedBy(broker: number): Promise<string> {
  const admin = await replicatedAdmin();
  // Looking up any group's coordinator makes the broker create __consumer_offsets on first use.
  await admin.describeGroups([uniqueName("so-warmup")]).catch(() => undefined);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const metadata = await admin.fetchTopicMetadata({ topics: ["__consumer_offsets"] }).catch(() => null);
    const partitions = metadata?.topics[0]?.partitions ?? [];
    if (partitions.length > 0 && partitions.every(partition => partition.leader >= 0)) {
      const leaders = new Map(partitions.map(partition => [partition.partitionId, partition.leader]));
      if (![...leaders.values()].includes(broker)) throw new Error(`broker ${broker} leads no __consumer_offsets partition: ${JSON.stringify([...leaders])}`);
      for (let attempt = 0; attempt < 1_000; attempt++) {
        const group = uniqueName("so-repl-group");
        // Kafka's Utils.abs: Math.abs, with Integer.MIN_VALUE mapped to 0.
        const hash = javaHashCode(group);
        if (leaders.get((hash === -(2 ** 31) ? 0 : Math.abs(hash)) % partitions.length) === broker) return group;
      }
    }
    if (Date.now() > deadline) throw new Error("__consumer_offsets has no leaders");
    await sleep(200);
  }
}

/** One record the test produced: its own expected-results ledger, independent of the gateway. */
export interface LedgerEntry {
  offset: string;
  kind: "bad" | "good";
  key: Buffer;
  value: Buffer;
  headers: { name: string; value: Buffer }[];
  producedAt: number;
}

type Produced = { kind: "bad" | "good"; key: Buffer; value: Buffer; headers?: { name: string; value: Buffer }[] };

/** Produces one record with acks=all and returns its ledger entry with the offset the broker assigned. */
export async function produceOne(topic: string, record: Produced): Promise<LedgerEntry> {
  const [entry] = await produceBatch(topic, [record]);
  return entry!;
}

/** Produces records in one request (one batch, consecutive offsets) with acks=all; returns their ledger entries. */
export async function produceBatch(topic: string, records: Produced[]): Promise<LedgerEntry[]> {
  producerPromise ??= (async () => {
    const producer = kafka.producer({ allowAutoTopicCreation: false, retry: { retries: 10, maxRetryTime: 2_000 } });
    await producer.connect();
    return producer;
  })();
  const producer = await producerPromise;
  const messages = records.map(record => {
    const headers: Record<string, Buffer[]> = {};
    for (const header of record.headers ?? []) (headers[header.name] ??= []).push(header.value);
    return { key: record.key, value: record.value, headers, partition: 0 };
  });
  const [result] = await producer.send({ topic, acks: -1, timeout: 10_000, messages });
  if (result === undefined || result.baseOffset === undefined) throw new Error(`no offset for records produced to ${topic}`);
  const base = BigInt(result.baseOffset);
  const producedAt = Date.now();
  return records.map((record, index) => ({
    offset: String(base + BigInt(index)), kind: record.kind, key: record.key, value: record.value, headers: record.headers ?? [], producedAt
  }));
}

/** The partition's high watermark: the end of what is committed to the in-sync replicas. */
export async function highWatermark(topic: string): Promise<bigint> {
  const offsets = await (await replicatedAdmin()).fetchTopicOffsets(topic);
  return BigInt(offsets.find(entry => entry.partition === 0)?.high ?? "0");
}

/** Every record in partition 0 up to the current high watermark, read by a plain consumer with raw bytes and headers. */
export async function readPartition(topic: string, timeoutMs = 30_000): Promise<kafkajs.KafkaMessage[]> {
  const end = await highWatermark(topic);
  if (end === 0n) return [];
  const consumer = kafka.consumer({ groupId: uniqueName("so-repl-reader"), maxBytes: 4 * 1024 * 1024 });
  const messages: kafkajs.KafkaMessage[] = [];
  await consumer.connect();
  try {
    await consumer.subscribe({ topics: [topic], fromBeginning: true });
    await consumer.run({ autoCommit: false, eachMessage: async ({ message }) => { messages.push(message); } });
    const deadline = Date.now() + timeoutMs;
    while (!messages.some(message => BigInt(message.offset) >= end - 1n)) {
      if (Date.now() > deadline) throw new Error(`read ${messages.length} records of ${topic}, never reached offset ${end - 1n}`);
      await sleep(100);
    }
  } finally {
    await consumer.disconnect();
  }
  return messages.filter(message => BigInt(message.offset) < end);
}

export async function committedOffset(group: string, topic: string): Promise<string> {
  const result = await (await replicatedAdmin()).fetchOffsets({ groupId: group, topics: [topic] });
  return result[0]?.partitions.find(entry => entry.partition === 0)?.offset ?? "-1";
}

/** A gateway logger that keeps warnings and errors so a run can report what the gateway saw. */
export interface LogEntry { at: number; level: string; message: string; fields: Readonly<Record<string, Json>> | undefined }

export function recordingLogger(): GatewayLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: () => undefined,
    warn: (message, fields) => { entries.push({ at: Date.now(), level: "warn", message, fields }); },
    error: (message, fields) => { entries.push({ at: Date.now(), level: "error", message, fields }); }
  };
}

/** Header values of a consumed record, in order, with every value as a Buffer. */
export function headerValues(message: kafkajs.KafkaMessage, name: string): Buffer[] {
  const value = message.headers?.[name];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(entry => Buffer.from(entry as Buffer | string));
}

export async function closeReplicatedHelpers(): Promise<void> {
  const producer = producerPromise;
  producerPromise = null;
  if (producer !== null) await (await producer).disconnect().catch(() => undefined);
  const admin = adminPromise;
  adminPromise = null;
  if (admin !== null) await (await admin).disconnect().catch(() => undefined);
  const others = [...avoidingAdmins.values()];
  avoidingAdmins.clear();
  await Promise.all(others.map(async other => (await other).disconnect().catch(() => undefined)));
}

/** Kafka's preferred-leader election for every partition, so leadership is back where topic creation put it. */
export async function electPreferredLeaders(): Promise<void> {
  await run(resolve(ROOT, ".local/kafka/bin/kafka-leader-election.sh"), [
    "--bootstrap-server", REPLICATED.join(","), "--election-type", "PREFERRED", "--all-topic-partitions"
  ], { env: { ...process.env, LOG_DIR: resolve(ROOT, ".local/kafka-replicated/tool-logs") } }).catch(() => undefined);
}

/** The topic's effective settings that define the declared durability policy. */
export async function topicSettings(topic: string): Promise<Record<string, string>> {
  const names = ["min.insync.replicas", "max.message.bytes", "unclean.leader.election.enable"];
  const result = await (await replicatedAdmin()).describeConfigs({
    includeSynonyms: false, resources: [{ type: kafkajs.ConfigResourceTypes.TOPIC, name: topic, configNames: names }]
  });
  return Object.fromEntries((result.resources[0]?.configEntries ?? []).map(entry => [entry.configName, entry.configValue]));
}

/** The broker ID that coordinates the group, as kafka-consumer-groups.sh reports it (the group must have joined once). */
export async function groupCoordinator(group: string): Promise<number> {
  const { stdout } = await run(resolve(ROOT, ".local/kafka/bin/kafka-consumer-groups.sh"), [
    "--bootstrap-server", REPLICATED.join(","), "--describe", "--group", group, "--state"
  ], { env: { ...process.env, LOG_DIR: resolve(ROOT, ".local/kafka-replicated/tool-logs") } });
  const match = /^\S+\s+\S+\s+\((\d+)\)/m.exec(stdout.split("\n").find(line => line.startsWith(group)) ?? "");
  if (match === null) throw new Error(`no coordinator in: ${stdout}`);
  return Number(match[1]);
}
