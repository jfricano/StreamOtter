import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import kafkajs, { type Admin } from "kafkajs";
import { createClient, type Client } from "@streamotter/client";
import {
  silentLogger, type GatewayLogger, type KafkaConnection, type Limits, type ProjectConfig
} from "@streamotter/gateway";
import { createGatewayRuntime, getGatewayInternals, type GatewayInternals, type InternalGatewayOptions } from "@streamotter/gateway/internals";
import { OrderApp, orderConfig, type TestChannels } from "../integration/harness.ts";
import type { Gateway } from "@streamotter/gateway";

const { Kafka, logLevel } = kafkajs;

export const ROOT = resolve(import.meta.dirname, "../..");
export const CA_FILE = resolve(ROOT, ".local/kafka-certs/ca.pem");
export const UNTRUSTED_CA_FILE = resolve(ROOT, ".local/kafka-certs/untrusted-ca.pem");
export const PLAINTEXT = ["127.0.0.1:19092"];
export const TLS = ["localhost:19093"];
export const SASL_TLS = ["localhost:19094"];
export const SASL_USER = "streamotter";
export const SASL_PASSWORD = "streamotter-local-secret";

const admin: Admin = new Kafka({ clientId: "streamotter-tests", brokers: PLAINTEXT, logLevel: logLevel.NOTHING, retry: { retries: 3 } }).admin();
let adminConnected: Promise<void> | null = null;

export async function testAdmin(): Promise<Admin> {
  adminConnected ??= admin.connect();
  await adminConnected;
  return admin;
}

/** True when the local broker from scripts/kafka/start.sh is reachable. */
export async function brokerAvailable(): Promise<boolean> {
  const probe = new Kafka({ clientId: "probe", brokers: PLAINTEXT, logLevel: logLevel.NOTHING, retry: { retries: 0 }, connectionTimeout: 1_000 }).admin();
  try {
    await probe.connect();
    await probe.disconnect();
    return true;
  } catch {
    return false;
  }
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/**
 * Resolves once the consumer group has no members, for example after a SIGKILLed member's
 * session has expired. A replacement started earlier would spend that wait inside its own
 * startup deadline, which equals the session timeout.
 */
export async function waitForEmptyGroup(groupId: string, timeoutMs = 45_000): Promise<void> {
  const client = await testAdmin();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { groups } = await client.describeGroups([groupId]);
    if ((groups[0]?.members.length ?? 0) === 0) return;
    if (Date.now() > deadline) throw new Error(`Consumer group ${groupId} still has members after ${timeoutMs} ms`);
    await new Promise(done => setTimeout(done, 500));
  }
}

export async function createTopic(partitions = 3): Promise<string> {
  const topic = uniqueName("so-test");
  const client = await testAdmin();
  try {
    await client.createTopics({ topics: [{ topic, numPartitions: partitions }], waitForLeaders: true });
  } catch (error) {
    // A broker that has only just started can report the new topic's partitions as unknown while
    // their leaders are elected. The topic was created; wait for its leaders below instead.
    if ((error as { type?: string }).type !== "UNKNOWN_TOPIC_OR_PARTITION") throw error;
  }
  const deadline = Date.now() + 15_000;
  for (;;) {
    const metadata = await client.fetchTopicMetadata({ topics: [topic] }).catch(() => null);
    const found = metadata?.topics[0]?.partitions ?? [];
    if (found.length === partitions && found.every(partition => partition.leader >= 0)) return topic;
    if (Date.now() > deadline) throw new Error(`Topic ${topic} has no leaders for all ${partitions} partitions after 15 s`);
    await new Promise(done => setTimeout(done, 200));
  }
}

let producerPromise: Promise<kafkajs.Producer> | null = null;

export async function produce(topic: string, messages: { key: string | null; value: string | null; partition?: number }[]): Promise<void> {
  producerPromise ??= (async () => {
    const producer = new Kafka({ clientId: "streamotter-tests-producer", brokers: PLAINTEXT, logLevel: logLevel.NOTHING }).producer();
    await producer.connect();
    return producer;
  })();
  const producer = await producerPromise;
  await producer.send({ topic, messages: messages.map(message => ({ ...message })) });
}

export function orderValue(tenantId: string, orderId: string, revision: number, status: "queued" | "processing" | "done", progress: number): string {
  return JSON.stringify({ tenantId, revision: String(revision), order: { orderId, status, progress } });
}

export async function committedOffsets(groupId: string, topic: string): Promise<Record<number, string>> {
  const result = await (await testAdmin()).fetchOffsets({ groupId, topics: [topic] });
  const offsets: Record<number, string> = {};
  for (const partition of result[0]?.partitions ?? []) offsets[partition.partition] = partition.offset;
  return offsets;
}

/** Disconnects the shared admin and producer so the test process can exit. */
export async function closeKafkaHelpers(): Promise<void> {
  const producer = producerPromise;
  producerPromise = null;
  if (producer !== null) await (await producer).disconnect().catch(() => undefined);
  if (adminConnected !== null) {
    adminConnected = null;
    await admin.disconnect().catch(() => undefined);
  }
}

export function kafkaConfig(options: {
  topic: string;
  group: string;
  connection?: KafkaConnection;
  startFrom?: "latest" | "earliest";
  limits?: Partial<Limits>;
  port?: number;
}): ProjectConfig<TestChannels> {
  const base = orderConfig(options.limits);
  return {
    ...base,
    gateway: { ...base.gateway, port: options.port ?? 0 },
    connections: { cluster: options.connection ?? { brokers: PLAINTEXT, tls: false } },
    sources: {
      orders: {
        kind: "kafka", generation: "orders-1", connectionRef: "cluster", topics: [options.topic],
        consumerGroup: options.group, codec: "json", startFrom: options.startFrom ?? "earliest"
      }
    }
  };
}

export interface KafkaHarness {
  gateway: Gateway;
  internals: GatewayInternals;
  origin: string;
  app: OrderApp;
  topic: string;
  group: string;
  clients: Client<TestChannels>[];
  client(token?: string): Client<TestChannels>;
  close(): Promise<void>;
}

export async function startKafkaHarness(options: {
  topic?: string;
  group?: string;
  app?: OrderApp;
  connection?: KafkaConnection;
  mode?: "development" | "production";
  startFrom?: "latest" | "earliest";
  limits?: Partial<Limits>;
  port?: number;
  logger?: GatewayLogger;
  internal?: InternalGatewayOptions;
} = {}): Promise<KafkaHarness> {
  const topic = options.topic ?? await createTopic();
  const group = options.group ?? uniqueName("so-group");
  const app = options.app ?? new OrderApp();
  const mode = options.mode ?? "development";
  const { gateway } = createGatewayRuntime<TestChannels>({
    config: kafkaConfig({
      topic, group,
      ...(options.connection === undefined ? {} : { connection: options.connection }),
      ...(options.startFrom === undefined ? {} : { startFrom: options.startFrom }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(options.port === undefined ? {} : { port: options.port })
    }),
    handlers: app.handlers(),
    mode,
    ...(mode === "development" ? { development: { principals: {}, fixtures: {} } } : {}),
    logger: options.logger ?? silentLogger,
    configDir: ROOT
  }, options.internal ?? {});
  const { origin } = await gateway.start();
  const clients: Client<TestChannels>[] = [];
  return {
    gateway, internals: getGatewayInternals(gateway), origin, app, topic, group, clients,
    client(token = "alice@acme") {
      const client = createClient<TestChannels>({ origin, getToken: () => token });
      clients.push(client);
      return client;
    },
    async close() {
      await Promise.all(clients.map(client => client.close()));
      await gateway.stop({ timeoutMs: 5_000 });
    }
  };
}
