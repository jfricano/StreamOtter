import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { silentLogger } from "@streamotter/gateway";
import { evidenceHash, type RawEvidence } from "@streamotter/gateway/internals";
import { KafkaQuarantineReader, KafkaQuarantineWriter, type QuarantineRead } from "../../packages/gateway/src/failures/quarantine.ts";
import type { ResolvedKafkaConnection } from "../../packages/gateway/src/sources/kafka.ts";
import { sleep } from "../integration/harness.ts";
import {
  brokerAvailable, closeKafkaHelpers, committedOffsets, committedOffsetsOnTopic, createTopic, groupsWithPrefix, PLAINTEXT, testAdmin,
  uniqueName
} from "./helpers.ts";

/**
 * V1.1 slice D against a real broker: the quarantine reader returns exactly the
 * evidence the writer stored, reports expiry (F28) and mismatches by name,
 * stays within its read budget (F41), never moves a committed offset, and
 * leaves no consumer group or socket behind.
 */

const available = await brokerAvailable();
const skip = !available ? "local Kafka is not running" : false;
const connection: ResolvedKafkaConnection = { brokers: PLAINTEXT, tls: false, ca: null, sasl: null };
const MAX_SOURCE_RECORD_BYTES = 1024 * 1024;

interface Written { failureId: string; partition: number; offset: string; evidence: RawEvidence; hash: string }

async function quarantineTopic(partitions = 1): Promise<string> {
  return createTopic(partitions, [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }]);
}

/** Writes each evidence record through the production writer, so the topic holds the real quarantine format. */
async function writeAll(topic: string, records: RawEvidence[]): Promise<Written[]> {
  const writer = new KafkaQuarantineWriter({
    topic, connection, logger: silentLogger, maxSourceRecordBytes: MAX_SOURCE_RECORD_BYTES, clientId: uniqueName("so-qwriter")
  });
  await writer.start();
  try {
    const written: Written[] = [];
    for (const evidence of records) {
      const failureId = `fail_${uniqueName("q")}`;
      const outcome = await writer.publish({ failureId, envelope: JSON.stringify({ envelopeVersion: 1, failureId }), evidence });
      assert.equal(outcome.kind, "acknowledged");
      if (outcome.kind !== "acknowledged") throw new Error("unreachable");
      written.push({ failureId, partition: outcome.partition, offset: outcome.offset, evidence, hash: evidenceHash(evidence) });
    }
    return written;
  } finally {
    await writer.stop();
  }
}

function newReader(topic: string): { reader: KafkaQuarantineReader; clientId: string } {
  const clientId = uniqueName("so-qreader");
  return { reader: new KafkaQuarantineReader({ topic, connection, logger: silentLogger, maxSourceRecordBytes: MAX_SOURCE_RECORD_BYTES, clientId }), clientId };
}

function request(record: Written, overrides: Partial<{ failureId: string; partition: number; offset: string; evidenceHash: string; timeoutMs: number }> = {}) {
  return { failureId: record.failureId, partition: record.partition, offset: record.offset, evidenceHash: record.hash, ...overrides };
}

/** Evidence as plain Buffers, so deepEqual compares bytes rather than Uint8Array subclasses. */
function bytesOf(evidence: RawEvidence) {
  return {
    key: evidence.key === null ? null : Buffer.from(evidence.key),
    value: evidence.value === null ? null : Buffer.from(evidence.value),
    headers: evidence.headers.map(header => ({ name: header.name, value: Buffer.from(header.value) }))
  };
}

function assertFound(read: QuarantineRead, record: Written): void {
  assert.equal(read.kind, "found", JSON.stringify(read));
  if (read.kind !== "found") return;
  assert.deepEqual(bytesOf(read.evidence), bytesOf(record.evidence));
  assert.equal(evidenceHash(read.evidence), record.hash);
}

/** The reader released every socket and left no throwaway group behind. */
async function assertCleanedUp(reader: KafkaQuarantineReader, clientId: string): Promise<void> {
  await reader.idle();
  assert.equal(reader.openSockets, 0, "every socket is closed");
  assert.deepEqual(await groupsWithPrefix(clientId), [], "no throwaway consumer group remains");
}

const binary: RawEvidence = {
  key: Buffer.from([0xff, 0x00, 0x7f, 0x80]),
  value: Buffer.from([0x7b, 0xc3, 0x28, 0x7d]), // "{", an invalid UTF-8 sequence, "}"
  headers: [
    { name: "trace", value: Buffer.from("a") },
    { name: "trace", value: Buffer.from([0x00, 0xff]) },
    { name: "other", value: Buffer.from("x") },
    { name: "empty", value: Buffer.alloc(0) }
  ]
};
const bare: RawEvidence = { key: null, value: Buffer.from("not json"), headers: [] };

describe("V1.1 slice D: quarantine reader against Kafka", { skip }, () => {
  after(() => closeKafkaHelpers());

  it("returns the written evidence byte for byte and leaves every committed offset and group as it was", async () => {
    const topic = await quarantineTopic();
    const [first, second] = await writeAll(topic, [binary, bare]);
    assert.ok(first !== undefined && second !== undefined);
    const known = uniqueName("so-known");
    await (await testAdmin()).setOffsets({ groupId: known, topic, partitions: [{ partition: 0, offset: "1" }] });
    const before = await committedOffsetsOnTopic(topic);
    assert.deepEqual(before, { [known]: { 0: "1" } });

    const { reader, clientId } = newReader(topic);
    try {
      assertFound(await reader.read(request(first)), first);
      await assertCleanedUp(reader, clientId);
      const plain = await reader.read(request(second));
      assertFound(plain, second);
      assert.ok(plain.kind === "found" && plain.evidence.key === null && plain.evidence.headers.length === 0, "no key and no headers stay absent");
      await assertCleanedUp(reader, clientId);
      // Two reads at once run one after the other and both succeed.
      const [a, b] = await Promise.all([reader.read(request(first)), reader.read(request(second))]);
      assertFound(a, first);
      assertFound(b, second);
      await assertCleanedUp(reader, clientId);
    } finally {
      await reader.stop();
    }
    assert.deepEqual(await committedOffsetsOnTopic(topic), before, "no group gained or moved a committed offset on the quarantine topic");
    assert.deepEqual(await committedOffsets(known, topic), { 0: "1" });
  });

  it("reads the right record from a multi-partition topic", async () => {
    const topic = await quarantineTopic(3);
    const records = await writeAll(topic, [binary, bare, binary, bare, binary, bare]);
    assert.ok(new Set(records.map(record => record.partition)).size > 1, "the records span partitions");
    const { reader, clientId } = newReader(topic);
    try {
      for (const record of records) assertFound(await reader.read(request(record)), record);
      await assertCleanedUp(reader, clientId);
    } finally {
      await reader.stop();
    }
  });

  it("F28: an offset deleted from the topic is expired, while a later one is still found", async () => {
    const topic = await quarantineTopic();
    const [gone, , kept] = await writeAll(topic, [binary, bare, binary]);
    assert.ok(gone !== undefined && kept !== undefined);
    await (await testAdmin()).deleteTopicRecords({ topic, partitions: [{ partition: 0, offset: kept.offset }] });
    const { reader, clientId } = newReader(topic);
    try {
      const read = await reader.read(request(gone));
      assert.equal(read.kind, "expired", JSON.stringify(read));
      assert.match(read.reason, /earliest retained offset 2/);
      assertFound(await reader.read(request(kept)), kept);
      await assertCleanedUp(reader, clientId);
    } finally {
      await reader.stop();
    }
  });

  it("reports a wrong failure ID, a wrong evidence hash and coordinates past the end as mismatches without payload bytes", async () => {
    const topic = await quarantineTopic();
    const [record, other] = await writeAll(topic, [binary, bare]);
    assert.ok(record !== undefined && other !== undefined);
    const { reader, clientId } = newReader(topic);
    try {
      const wrongId = await reader.read(request(record, { failureId: other.failureId }));
      assert.equal(wrongId.kind, "mismatch");
      assert.match(wrongId.reason, /streamotter-failure-id/);
      const wrongHash = await reader.read(request(record, { evidenceHash: other.hash }));
      assert.equal(wrongHash.kind, "mismatch");
      assert.match(wrongHash.reason, /evidence hash/);
      const pastEnd = await reader.read(request(record, { offset: "2" }));
      assert.equal(pastEnd.kind, "mismatch");
      assert.match(pastEnd.reason, /no record at that offset/);
      const noPartition = await reader.read(request(record, { partition: 4 }));
      assert.equal(noPartition.kind, "mismatch");
      assert.match(noPartition.reason, /no partition 4/);
      for (const read of [wrongId, wrongHash, pastEnd, noPartition]) {
        assert.ok(!read.reason.includes("not json") && !read.reason.includes("Ã"), "reasons carry no record bytes");
      }
      await assertCleanedUp(reader, clientId);
    } finally {
      await reader.stop();
    }
  });

  it("a missing topic is unavailable, with no group left behind", async () => {
    const { reader, clientId } = newReader(uniqueName("so-missing"));
    try {
      const read = await reader.read({ failureId: "fail_x", partition: 0, offset: "0", evidenceHash: "sha256:00" });
      assert.equal(read.kind, "unavailable");
      assert.match(read.reason, /does not exist \(UNKNOWN_TOPIC_OR_PARTITION\)/);
      await assertCleanedUp(reader, clientId);
      const topics = await (await testAdmin()).listTopics();
      assert.ok(!topics.includes(reader.topic), "the read never creates the topic");
    } finally {
      await reader.stop();
    }
  });

  it("F41: a read that exceeds its budget is unavailable and releases everything, at any point it is cut off", async () => {
    const topic = await quarantineTopic();
    const [record] = await writeAll(topic, [binary]);
    assert.ok(record !== undefined);
    const { reader, clientId } = newReader(topic);
    try {
      const started = Date.now();
      const read = await reader.read(request(record, { timeoutMs: 1 }));
      assert.deepEqual(read, { kind: "unavailable", reason: "the read did not finish within 1 ms" });
      assert.ok(Date.now() - started < 1_000, "a read cut off by its deadline returns then, and is cleaned up in the background");
      await assertCleanedUp(reader, clientId);
      // Cut the read off at different stages (admin, group join, fetch): each one is either
      // complete or unavailable, and none leaves a socket or a group behind.
      for (const timeoutMs of [5, 10, 15, 20, 25, 30, 40, 60, 150, 300]) {
        const outcome = await reader.read(request(record, { timeoutMs }));
        if (outcome.kind === "found") assertFound(outcome, record);
        else assert.deepEqual(outcome, { kind: "unavailable", reason: `the read did not finish within ${timeoutMs} ms` });
        await assertCleanedUp(reader, clientId);
      }
      assertFound(await reader.read(request(record)), record);
      await assertCleanedUp(reader, clientId);
    } finally {
      await reader.stop();
    }
    assert.deepEqual(await committedOffsetsOnTopic(topic), {}, "no read committed an offset");
  });

  it("stop() abandons a read in progress at any stage, releases it, and refuses later reads", async () => {
    const topic = await quarantineTopic();
    const [record] = await writeAll(topic, [binary]);
    assert.ok(record !== undefined);
    for (const after of [0, 10, 20, 30, 50]) {
      const { reader, clientId } = newReader(topic);
      const pending = reader.read(request(record));
      await sleep(after);
      await reader.stop();
      const read = await pending;
      if (read.kind === "found") assertFound(read, record);
      else assert.deepEqual(read, { kind: "unavailable", reason: "the quarantine reader is stopped" });
      assert.deepEqual(await reader.read(request(record)), { kind: "unavailable", reason: "the quarantine reader is stopped" });
      assert.equal(reader.openSockets, 0);
      assert.deepEqual(await groupsWithPrefix(clientId), []);
    }
  });
});
