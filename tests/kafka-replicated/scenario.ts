import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LIMITS, type FailureHandlingConfig, type SourceRecoveryHandlers } from "@streamotter/contracts";
import { silentLogger } from "@streamotter/gateway";
import { initJournal, KafkaQuarantineReader, type IncidentRecord, type IncidentStore, type InternalGatewayOptions } from "@streamotter/gateway/internals";
import { sleep } from "../integration/harness.ts";
import { orderValue, startKafkaHarness, type KafkaHarness } from "../kafka/helpers.ts";
import { headerValues, readPartition, recordingLogger, REPLICATED, type LedgerEntry } from "./helpers.ts";

/**
 * The F47 scenario pieces shared by the replicated tests: the declared quarantine
 * topic policy, a guarded-continuation gateway on the replicated cluster, the
 * test's own record builders, and the check of what the topic holds against the
 * test's ledger.
 */

/** ADR-15A §4: the quarantine topic holds maxSourceRecordBytes plus 80 KiB of headers; the test uses exactly that minimum. */
export const QUARANTINE_MAX_MESSAGE_BYTES = String(DEFAULT_LIMITS.maxSourceRecordBytes + 80 * 1024);
export const QUARANTINE_MIN_ISR = "2";
export const quarantineTopicConfig = [
  { name: "min.insync.replicas", value: QUARANTINE_MIN_ISR },
  { name: "max.message.bytes", value: QUARANTINE_MAX_MESSAGE_BYTES },
  { name: "unclean.leader.election.enable", value: "false" }
];

export const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "kafka-replicated-test" }) };

export interface ReplicatedGateway {
  k: KafkaHarness;
  logger: ReturnType<typeof recordingLogger>;
  state: string;
}

/** A quarantine-resync gateway with a recoverable guard and a fresh journal, consuming `topic` from the replicated cluster. */
export async function startReplicatedGateway(options: {
  topic: string; quarantine: string; group: string; guard?: SourceRecoveryHandlers; internal?: InternalGatewayOptions;
}): Promise<ReplicatedGateway> {
  const state = await mkdtemp(join(tmpdir(), "so-kafka-replicated-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  const failureHandling: FailureHandlingConfig = {
    quarantine: { topic: options.quarantine, capture: "full-record" },
    // The scenario quarantines a burst of distinct bad records on purpose; the
    // circuit breaker is not under test here, so it allows the documented maximum.
    sources: { orders: { invalidJson: "quarantine-resync", automaticAdvanceLimit: { incidents: 20, windowMs: 1_000 } } }
  };
  const logger = recordingLogger();
  const k = await startKafkaHarness({
    topic: options.topic, group: options.group, failureHandling, stateDirectory: state, recovery: { orders: options.guard ?? recoverable },
    connection: { brokers: REPLICATED, tls: false }, logger, ...(options.internal === undefined ? {} : { internal: options.internal })
  });
  return { k, logger, state };
}

/** A bad record: invalid JSON with an invalid UTF-8 sequence, a binary key and repeated binary headers, unique per index. */
export function badRecord(index: number, padding = 0): { kind: "bad"; key: Buffer; value: Buffer; headers: { name: string; value: Buffer }[] } {
  return {
    kind: "bad",
    key: Buffer.from([0xff, 0x00, index & 0xff, 0x80]),
    value: Buffer.concat([Buffer.from(`{"bad": ${index}, "pad": "${"x".repeat(padding)}`), Buffer.from([0xc3, 0x28]), Buffer.from(`${index}`)]),
    headers: [
      { name: "trace", value: Buffer.from(`t-${index}`) },
      { name: "trace", value: Buffer.from([0x00, 0xff, index & 0xff]) },
      { name: "other", value: Buffer.from("x") }
    ]
  };
}

export function goodRecord(revision: number): { kind: "good"; key: Buffer; value: Buffer } {
  return { kind: "good", key: Buffer.from("ord_1"), value: Buffer.from(orderValue("acme", "ord_1", revision, "processing", revision % 100)) };
}

export async function incidents(k: KafkaHarness): Promise<IncidentRecord[]> {
  await k.internals.failuresSettled();
  return [...(k.internals.incidentStore() as IncidentStore).list({ state: "all", limit: 200 }).items];
}

export function incidentAt(list: IncidentRecord[], offset: string): IncidentRecord | undefined {
  return list.find(incident => incident.position.kind === "kafka" && incident.position.offset === offset);
}

export function eventsOf(k: KafkaHarness, failureId: string): { event: string; detail: string | null; at: string }[] {
  return (k.internals.incidentStore() as IncidentStore).events(failureId).map(({ event, detail, at }) => ({ event, detail, at }));
}

/** Waits until the incident for the record at `offset` satisfies the predicate. */
export async function waitForIncident(k: KafkaHarness, offset: string, done: (incident: IncidentRecord) => boolean, label: string, timeoutMs = 60_000): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const incident = incidentAt(await incidents(k), offset);
    if (incident !== undefined && done(incident)) return incident;
    if (Date.now() > deadline) assert.fail(`incident at offset ${offset} never reached ${label}: ${JSON.stringify(incident ?? null)}`);
    await sleep(50);
  }
}

/** True when the consumed quarantine record carries exactly the ledger entry's key, value and headers (as src.*). */
export function matchesLedger(message: { key: Buffer | null; value: Buffer | null; headers?: unknown }, entry: LedgerEntry): boolean {
  const record = message as Parameters<typeof headerValues>[0];
  if (record.key === null || !record.key.equals(entry.key)) return false;
  if (record.value === null || !record.value.equals(entry.value)) return false;
  for (const name of new Set(entry.headers.map(header => header.name))) {
    const expected = entry.headers.filter(header => header.name === name).map(header => header.value);
    const actual = headerValues(record, `src.${name}`);
    if (actual.length !== expected.length || actual.some((value, index) => !value.equals(expected[index]!))) return false;
  }
  return true;
}

export interface EvidenceCheck {
  /** Records in the quarantine topic up to its high watermark. */
  records: number;
  /** Quarantine records per source offset. */
  copies: Map<string, number>;
  /** Acknowledged incidents whose coordinates were checked byte for byte. */
  acknowledgedChecked: number;
}

/**
 * Reads the quarantine topic with a plain consumer and checks it against the
 * test's ledger, never against the gateway's own view:
 *  - every record in the topic is a byte-exact copy of a bad record the test produced;
 *  - every incident the journal calls acknowledged has its record at its coordinates,
 *    with its failure ID, byte-identical to the ledger entry at the incident's source offset;
 *  - every bad record below `committed` (that is, every record the source moved past) has evidence.
 */
export async function checkEvidence(options: {
  quarantine: string;
  ledger: LedgerEntry[];
  acknowledged: IncidentRecord[];
  committed: string | null;
}): Promise<EvidenceCheck> {
  const messages = await readPartition(options.quarantine);
  const byOffset = new Map(messages.map(message => [message.offset, message]));
  const ledgerByOffset = new Map(options.ledger.map(entry => [entry.offset, entry]));
  const copies = new Map<string, number>();
  for (const message of messages) {
    const envelope = JSON.parse(String(headerValues(message, "streamotter-envelope")[0] ?? "{}")) as { position?: { offset?: string } };
    const sourceOffset = envelope.position?.offset ?? "";
    const entry = ledgerByOffset.get(sourceOffset);
    assert.ok(entry !== undefined && entry.kind === "bad", `quarantine offset ${message.offset} names source offset ${sourceOffset}, which is not a bad record the test produced`);
    assert.ok(matchesLedger(message, entry), `quarantine offset ${message.offset} is not a byte-exact copy of source offset ${sourceOffset}`);
    copies.set(sourceOffset, (copies.get(sourceOffset) ?? 0) + 1);
  }
  for (const incident of options.acknowledged) {
    assert.equal(incident.quarantine, "acknowledged");
    assert.ok(incident.position.kind === "kafka");
    const coordinates = incident.quarantineCoordinates;
    assert.ok(coordinates !== null && coordinates.partition === 0, `incident ${incident.failureId} has no partition-0 coordinates`);
    const message = byOffset.get(coordinates.offset);
    assert.ok(message !== undefined, `acknowledged evidence for source offset ${incident.position.offset} is missing at quarantine offset ${coordinates.offset} (high watermark ${messages.length})`);
    assert.equal(String(headerValues(message, "streamotter-failure-id")[0]), incident.failureId);
    const entry = ledgerByOffset.get(incident.position.offset);
    assert.ok(entry !== undefined && entry.kind === "bad", `incident at source offset ${incident.position.offset} is not a bad record in the ledger`);
    assert.ok(matchesLedger(message, entry), `acknowledged evidence at quarantine offset ${coordinates.offset} differs from the produced bytes`);
  }
  if (options.committed !== null) {
    const committed = BigInt(options.committed);
    for (const entry of options.ledger) {
      if (entry.kind !== "bad" || BigInt(entry.offset) >= committed) continue;
      assert.ok((copies.get(entry.offset) ?? 0) >= 1, `the source moved past bad record ${entry.offset} without evidence in the quarantine topic`);
    }
  }
  return { records: messages.length, copies, acknowledgedChecked: options.acknowledged.length };
}

/**
 * Reads each acknowledged incident's evidence back through the production
 * KafkaQuarantineReader (failure ID and evidence hash checked by the reader) and
 * compares the returned bytes with the ledger. An "unavailable" read is retried
 * up to four times, as an operator would, and reported; "expired" or "mismatch"
 * fails at once. Returns how long the reads took and the transient reasons seen.
 */
export async function checkWithReader(
  quarantine: string, acknowledged: IncidentRecord[], ledger: LedgerEntry[], avoid: readonly number[] = []
): Promise<{ ms: number; unavailable: string[] }> {
  const brokers = REPLICATED.filter((_, index) => !avoid.includes(index + 1));
  const reader = new KafkaQuarantineReader({
    topic: quarantine, connection: { brokers, tls: false, ca: null, sasl: null }, logger: silentLogger,
    maxSourceRecordBytes: DEFAULT_LIMITS.maxSourceRecordBytes, clientId: `so-repl-reader-${Date.now()}`
  });
  const started = Date.now();
  const unavailable: string[] = [];
  try {
    for (const incident of acknowledged) {
      const coordinates = incident.quarantineCoordinates;
      assert.ok(coordinates !== null && incident.position.kind === "kafka");
      const sourceOffset = incident.position.offset;
      let read = await reader.read({ failureId: incident.failureId, ...coordinates, evidenceHash: incident.evidence.hash, timeoutMs: 20_000 });
      for (let attempt = 1; attempt < 5 && read.kind === "unavailable"; attempt++) {
        unavailable.push(read.reason);
        await sleep(1_000);
        read = await reader.read({ failureId: incident.failureId, ...coordinates, evidenceHash: incident.evidence.hash, timeoutMs: 20_000 });
      }
      assert.equal(read.kind, "found", `the reader did not find source offset ${sourceOffset}'s evidence: ${JSON.stringify(read)}`);
      if (read.kind !== "found") continue;
      const entry = ledger.find(item => item.offset === sourceOffset);
      assert.ok(entry !== undefined);
      assert.ok(read.evidence.key !== null && Buffer.from(read.evidence.key).equals(entry.key));
      assert.ok(read.evidence.value !== null && Buffer.from(read.evidence.value).equals(entry.value));
      assert.deepEqual(read.evidence.headers.map(header => [header.name, Buffer.from(header.value)]), entry.headers.map(header => [header.name, header.value]));
    }
  } finally {
    await reader.stop();
  }
  return { ms: Date.now() - started, unavailable };
}
