import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import kafkajs, { type AclEntry, type Admin, type Producer } from "kafkajs";
import type { FailureHandlingConfig, KafkaConnection } from "@streamotter/gateway";
import { initJournal } from "@streamotter/gateway/internals";
import { sleep } from "../integration/harness.ts";
import { ROOT, uniqueName } from "../kafka/helpers.ts";

/**
 * Helpers for the ACL tier. They talk only to the broker from scripts/kafka/acl-start.sh, which
 * runs StandardAuthorizer with allow.everyone.if.no.acl.found=false. Setup (topics, records, ACLs)
 * goes through the super user `admin`; the gateway connects as `streamotter-gateway` over TLS with
 * SCRAM-SHA-512 and can do only what a test granted it.
 */

const { Kafka, logLevel, AclResourceTypes, AclOperationTypes, AclPermissionTypes, ResourcePatternTypes } = kafkajs;

export const ADMIN_BROKERS = ["127.0.0.1:39092"];
export const GATEWAY_BROKERS = ["localhost:39094"];
export const ACL_CA_FILE = resolve(ROOT, ".local/kafka-acl/certs/ca.pem");
export const GATEWAY_USER = "streamotter-gateway";
export const GATEWAY_PRINCIPAL = `User:${GATEWAY_USER}`;
export const SKIP_MESSAGE = "the ACL broker is not running (start it with ./scripts/kafka/acl-start.sh)";
/** orderConfig's project ID: evidence read-back uses groups named streamotter-<projectId>-quarantine-read-<uuid>. */
export const READ_GROUP_PREFIX = "streamotter-order-dashboard-quarantine-read-";

process.env["SO_ACL_GATEWAY_USER"] = GATEWAY_USER;
process.env["SO_ACL_GATEWAY_PASSWORD"] = "streamotter-acl-gateway-secret";

/** The gateway's connection profile: TLS with the ACL broker's CA, SCRAM-SHA-512 as streamotter-gateway. */
export const GATEWAY_CONNECTION: KafkaConnection = {
  brokers: GATEWAY_BROKERS,
  tls: { caFile: ACL_CA_FILE },
  sasl: { mechanism: "scram-sha-512", username: { env: "SO_ACL_GATEWAY_USER" }, password: { env: "SO_ACL_GATEWAY_PASSWORD" } }
};

const SASL = { mechanism: "plain" as const, username: "admin", password: "streamotter-acl-admin-secret" };
const kafka = new Kafka({ clientId: "streamotter-acl-tests", brokers: ADMIN_BROKERS, sasl: SASL, logLevel: logLevel.NOTHING, retry: { retries: 5 } });
let adminPromise: Promise<Admin> | null = null;
let producerPromise: Promise<Producer> | null = null;

export function aclAdmin(): Promise<Admin> {
  adminPromise ??= (async () => {
    const admin = kafka.admin();
    await admin.connect();
    return admin;
  })();
  return adminPromise;
}

/** True when the ACL broker answers the admin user and enforces ACLs (an ACL listing only works with an authorizer). */
export async function aclBrokerAvailable(): Promise<boolean> {
  const probe = new Kafka({ clientId: "probe", brokers: ADMIN_BROKERS, sasl: SASL, logLevel: logLevel.NOTHING, retry: { retries: 0 }, connectionTimeout: 1_000 }).admin();
  try {
    await probe.connect();
    await probe.describeAcls({
      resourceType: AclResourceTypes.ANY, resourcePatternType: ResourcePatternTypes.ANY,
      operation: AclOperationTypes.ANY, permissionType: AclPermissionTypes.ANY
    });
    return true;
  } catch {
    return false;
  } finally {
    await probe.disconnect().catch(() => undefined);
  }
}

export async function createAclTopic(partitions = 1, configEntries: { name: string; value: string }[] = []): Promise<string> {
  const topic = uniqueName("so-acl");
  const admin = await aclAdmin();
  await admin.createTopics({ topics: [{ topic, numPartitions: partitions, configEntries }], waitForLeaders: true });
  const deadline = Date.now() + 15_000;
  for (;;) {
    const metadata = await admin.fetchTopicMetadata({ topics: [topic] }).catch(() => null);
    const found = metadata?.topics[0]?.partitions ?? [];
    if (found.length === partitions && found.every(partition => partition.leader >= 0)) return topic;
    if (Date.now() > deadline) throw new Error(`Topic ${topic} has no leaders for all ${partitions} partitions after 15 s`);
    await sleep(200);
  }
}

/** Produces records as the admin user, byte for byte. */
export async function produceRaw(topic: string, messages: { key: Buffer | null; value: Buffer | null; headers?: Record<string, Buffer> }[]): Promise<void> {
  producerPromise ??= (async () => {
    const producer = kafka.producer({ allowAutoTopicCreation: false });
    await producer.connect();
    return producer;
  })();
  await (await producerPromise).send({ topic, acks: -1, messages: messages.map(message => ({ ...message })) });
}

export async function committedOffset(group: string, topic: string): Promise<string> {
  const result = await (await aclAdmin()).fetchOffsets({ groupId: group, topics: [topic] });
  return result[0]?.partitions.find(entry => entry.partition === 0)?.offset ?? "-1";
}

export async function groupsWithPrefix(prefix: string): Promise<string[]> {
  const { groups } = await (await aclAdmin()).listGroups();
  return groups.map(group => group.groupId).filter(groupId => groupId.startsWith(prefix));
}

/** One ACL the gateway's principal holds, by the runbook row it comes from. */
export type GatewayAcl =
  | "source-topic-read" | "source-group-read"
  | "quarantine-describe" | "quarantine-describe-configs" | "quarantine-write" | "quarantine-read"
  | "read-group-read" | "read-group-delete";

const allow = (resourceType: kafkajs.AclResourceTypes, resourceName: string, operation: kafkajs.AclOperationTypes, prefixed = false): AclEntry => ({
  resourceType, resourceName, resourcePatternType: prefixed ? ResourcePatternTypes.PREFIXED : ResourcePatternTypes.LITERAL,
  principal: GATEWAY_PRINCIPAL, host: "*", operation, permissionType: AclPermissionTypes.ALLOW
});

/**
 * The gateway principal's ACLs: V1's source permissions (Read on the source topic and on the
 * source's consumer group, which include Describe) and the rows of the runbook's table in
 * docs/guides/source-failures.md §6.1. Nothing else: no cluster ACL, no wildcard.
 */
export function gatewayAcls(names: { topic: string; group: string; quarantine?: string }): Record<GatewayAcl, AclEntry | null> {
  const { topic, group, quarantine } = names;
  return {
    "source-topic-read": allow(AclResourceTypes.TOPIC, topic, AclOperationTypes.READ),
    "source-group-read": allow(AclResourceTypes.GROUP, group, AclOperationTypes.READ),
    "quarantine-describe": quarantine === undefined ? null : allow(AclResourceTypes.TOPIC, quarantine, AclOperationTypes.DESCRIBE),
    "quarantine-describe-configs": quarantine === undefined ? null : allow(AclResourceTypes.TOPIC, quarantine, AclOperationTypes.DESCRIBE_CONFIGS),
    "quarantine-write": quarantine === undefined ? null : allow(AclResourceTypes.TOPIC, quarantine, AclOperationTypes.WRITE),
    "quarantine-read": quarantine === undefined ? null : allow(AclResourceTypes.TOPIC, quarantine, AclOperationTypes.READ),
    "read-group-read": quarantine === undefined ? null : allow(AclResourceTypes.GROUP, READ_GROUP_PREFIX, AclOperationTypes.READ, true),
    "read-group-delete": quarantine === undefined ? null : allow(AclResourceTypes.GROUP, READ_GROUP_PREFIX, AclOperationTypes.DELETE, true)
  };
}

const ANY_GATEWAY_ACL = {
  resourceType: AclResourceTypes.ANY, resourcePatternType: ResourcePatternTypes.ANY, principal: GATEWAY_PRINCIPAL,
  operation: AclOperationTypes.ANY, permissionType: AclPermissionTypes.ANY
};

/** KafkaJS's ACL enums are plain objects at run time, without reverse mappings. */
function enumName(table: object, value: number): string {
  return Object.entries(table).find(([, entry]) => entry === value)?.[0] ?? String(value);
}

/** "TOPIC:name:WRITE", or "GROUP:prefix*:READ" for a prefixed pattern. */
function aclName(resource: { resourceType: number; resourceName: string; resourcePatternType: number }, operation: number): string {
  const pattern = resource.resourcePatternType === ResourcePatternTypes.PREFIXED ? "*" : "";
  return `${enumName(AclResourceTypes, resource.resourceType)}:${resource.resourceName}${pattern}:${enumName(AclOperationTypes, operation)}`;
}

/** Every ACL the gateway's principal holds now, as aclName strings, sorted. */
export async function currentGatewayAcls(): Promise<string[]> {
  const { resources } = await (await aclAdmin()).describeAcls(ANY_GATEWAY_ACL);
  return resources.flatMap(resource => resource.acls.map(acl => aclName(resource, acl.operation))).sort();
}

async function settle(expected: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await expected())) {
    if (Date.now() > deadline) throw new Error(`ACLs did not settle: ${label}; now ${JSON.stringify(await currentGatewayAcls())}`);
    await sleep(100);
  }
}

const key = (acl: AclEntry) => aclName(acl, acl.operation);

/** Removes every ACL of the gateway's principal, so each test starts from nothing (and no earlier test's Write lingers). */
export async function revokeAllGatewayAcls(): Promise<void> {
  await (await aclAdmin()).deleteAcls({ filters: [ANY_GATEWAY_ACL] });
  await settle(async () => (await currentGatewayAcls()).length === 0, "no gateway ACLs");
}

/** Grants the given ACLs (nulls ignored) and waits until the broker lists them. */
export async function grant(...acls: (AclEntry | null)[]): Promise<void> {
  const entries = acls.filter(acl => acl !== null);
  if (entries.length === 0) return;
  await (await aclAdmin()).createAcls({ acl: entries });
  await settle(async () => {
    const now = new Set(await currentGatewayAcls());
    return entries.every(acl => now.has(key(acl)));
  }, `granted ${entries.map(key).join(", ")}`);
}

/** Revokes the given ACLs (nulls ignored) and waits until the broker no longer lists them. */
export async function revoke(...acls: (AclEntry | null)[]): Promise<void> {
  const entries = acls.filter(acl => acl !== null);
  if (entries.length === 0) return;
  await (await aclAdmin()).deleteAcls({
    filters: entries.map(acl => ({
      resourceType: acl.resourceType, resourceName: acl.resourceName, resourcePatternType: acl.resourcePatternType,
      principal: acl.principal, host: acl.host, operation: acl.operation, permissionType: acl.permissionType
    }))
  });
  await settle(async () => {
    const now = new Set(await currentGatewayAcls());
    return entries.every(acl => !now.has(key(acl)));
  }, `revoked ${entries.map(key).join(", ")}`);
}

/** A source topic, a quarantine topic sized for the default record limit, a journal, and the failureHandling section. */
export async function failureSetup(policy: "quarantine-hold" | "quarantine-resync"): Promise<{
  topic: string; quarantine: string; group: string; state: string; failureHandling: FailureHandlingConfig;
}> {
  const topic = await createAclTopic(1);
  const quarantine = await createAclTopic(1, [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }]);
  const state = await mkdtemp(join(tmpdir(), "so-kafka-acl-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  return {
    topic, quarantine, state, group: uniqueName("so-acl-group"),
    failureHandling: {
      quarantine: { topic: quarantine, capture: "full-record" },
      sources: { orders: policy === "quarantine-resync"
        ? { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync", replaySafeMapping: true }
        : { invalidJson: "quarantine-hold" } }
    } as FailureHandlingConfig
  };
}

/** A free loopback port, for the health listener. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

/** The health listener's readiness answer. */
export async function readiness(port: number): Promise<{ status: number; reasons: string[] }> {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
  return { status: response.status, reasons: ((await response.json()) as { reasons: string[] }).reasons };
}

export async function closeAclHelpers(): Promise<void> {
  const producer = producerPromise;
  producerPromise = null;
  if (producer !== null) await (await producer).disconnect().catch(() => undefined);
  const admin = adminPromise;
  adminPromise = null;
  if (admin !== null) await (await admin).disconnect().catch(() => undefined);
}
