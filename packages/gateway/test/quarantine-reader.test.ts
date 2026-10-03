import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IHeaders } from "kafkajs";
import type { GatewayLogger } from "@streamotter/contracts";
import { evidenceHash, sourceHeadersFromQuarantine } from "../src/failures/evidence.ts";
import { KafkaQuarantineReader, quarantineCoordinateIssue, verifyQuarantineRecord } from "../src/failures/quarantine.ts";
import type { RawEvidence } from "../src/failures/store.ts";

/** The pure parts of reading quarantine evidence back: coordinate checks, header reconstruction and record verification. */

const silent: GatewayLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const evidence: RawEvidence = {
  key: Buffer.from([0xff, 0x00, 0x7f, 0x80]),
  value: Buffer.from([0x7b, 0xc3, 0x28, 0x7d]),
  headers: [
    { name: "trace", value: Buffer.from("a") },
    { name: "trace", value: Buffer.from([0x00, 0xff]) },
    { name: "other", value: Buffer.from("x") }
  ]
};

/** The record as KafkaJS decodes what KafkaQuarantineWriter wrote: its own headers first, then src.<name>, repeated values as arrays. */
function asRead(failureId: string, raw: RawEvidence): { key: Buffer | null; value: Buffer | null; headers: IHeaders } {
  const headers: Record<string, Buffer | Buffer[]> = {
    "streamotter-envelope": Buffer.from(JSON.stringify({ envelopeVersion: 1, failureId })),
    "streamotter-failure-id": Buffer.from(failureId)
  };
  for (const header of raw.headers) {
    const name = `src.${header.name}`;
    const existing = headers[name];
    const value = Buffer.from(header.value);
    headers[name] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return { key: raw.key === null ? null : Buffer.from(raw.key), value: raw.value === null ? null : Buffer.from(raw.value), headers };
}

function bytesOf(raw: RawEvidence) {
  return {
    key: raw.key === null ? null : Buffer.from(raw.key),
    value: raw.value === null ? null : Buffer.from(raw.value),
    headers: raw.headers.map(header => ({ name: header.name, value: Buffer.from(header.value) }))
  };
}

describe("quarantine coordinates", () => {
  it("accepts a partition number and a canonical decimal offset", () => {
    for (const offset of ["0", "7", "41", "9223372036854775807"]) assert.equal(quarantineCoordinateIssue(0, offset), null, offset);
    assert.equal(quarantineCoordinateIssue(2 ** 31 - 1, "0"), null);
  });

  it("refuses negative or fractional partitions and offsets that are not decimal Kafka offsets", () => {
    for (const partition of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
      assert.match(quarantineCoordinateIssue(partition, "0") ?? "", /partition/, String(partition));
    }
    for (const offset of ["-1", "", "abc", "01", "1e3", " 1", "1 ", "0x10", "1.0", "+1", "9223372036854775808", "99999999999999999999"]) {
      assert.match(quarantineCoordinateIssue(0, offset) ?? "", /offset/, JSON.stringify(offset));
    }
    assert.match(quarantineCoordinateIssue(0, 5 as unknown as string) ?? "", /offset/);
  });
});

describe("quarantine header reconstruction", () => {
  it("returns the src.* headers in order with the prefix removed, one entry per repeated value", () => {
    const headers = sourceHeadersFromQuarantine(asRead("fail_1", evidence).headers);
    assert.deepEqual(bytesOf({ key: null, value: null, headers }).headers, bytesOf(evidence).headers);
  });

  it("drops StreamOtter's own headers, keeps a name that itself starts with src., and reads string values as UTF-8", () => {
    const headers = sourceHeadersFromQuarantine({
      "streamotter-envelope": Buffer.from("{}"),
      "streamotter-failure-id": Buffer.from("fail_1"),
      "src.src.inner": Buffer.from("1"),
      "src.text": "é",
      unrelated: Buffer.from("x")
    });
    assert.deepEqual(headers.map(header => [header.name, Buffer.from(header.value).toString("utf8")]), [["src.inner", "1"], ["text", "é"]]);
    assert.deepEqual(sourceHeadersFromQuarantine(undefined), []);
  });
});

describe("quarantine record verification", () => {
  const hash = evidenceHash(evidence);

  it("returns the original evidence when the failure ID and the evidence hash match", () => {
    const read = verifyQuarantineRecord(asRead("fail_1", evidence), "fail_1", hash);
    assert.equal(read.kind, "found");
    if (read.kind === "found") assert.deepEqual(bytesOf(read.evidence), bytesOf(evidence));
  });

  it("keeps a missing key and no headers absent", () => {
    const bare: RawEvidence = { key: null, value: Buffer.from(""), headers: [] };
    const read = verifyQuarantineRecord(asRead("fail_2", bare), "fail_2", evidenceHash(bare));
    assert.equal(read.kind, "found");
    if (read.kind === "found") {
      assert.equal(read.evidence.key, null);
      assert.equal(read.evidence.value?.byteLength, 0);
      assert.deepEqual(read.evidence.headers, []);
    }
  });

  it("copies the bytes out of the fetched buffer", () => {
    const record = asRead("fail_1", evidence);
    const read = verifyQuarantineRecord(record, "fail_1", hash);
    record.value?.fill(0);
    assert.ok(read.kind === "found" && Buffer.from(read.evidence.value ?? []).equals(Buffer.from(evidence.value ?? [])));
  });

  it("names the failed check without quoting record bytes", () => {
    const record = asRead("fail_1", evidence);
    const cases: [string, ReturnType<typeof verifyQuarantineRecord>, RegExp][] = [
      ["no ID", verifyQuarantineRecord({ ...record, headers: { ...record.headers, "streamotter-failure-id": undefined } }, "fail_1", hash), /no streamotter-failure-id/],
      ["two IDs", verifyQuarantineRecord({ ...record, headers: { ...record.headers, "streamotter-failure-id": [Buffer.from("fail_1"), Buffer.from("fail_1")] } }, "fail_1", hash), /more than one/],
      ["other failure", verifyQuarantineRecord(record, "fail_2", hash), /different failure/],
      ["changed value", verifyQuarantineRecord({ ...record, value: Buffer.from([0x7b, 0xc3, 0x28, 0x7e]) }, "fail_1", hash), /evidence hash/],
      ["null value", verifyQuarantineRecord({ ...record, value: null }, "fail_1", hash), /evidence hash/],
      ["lost header", verifyQuarantineRecord({ ...record, headers: { ...record.headers, "src.other": undefined } }, "fail_1", hash), /evidence hash/],
      ["reordered values", verifyQuarantineRecord({ ...record, headers: { ...record.headers, "src.trace": [Buffer.from([0x00, 0xff]), Buffer.from("a")] } }, "fail_1", hash), /evidence hash/]
    ];
    for (const [label, read, reason] of cases) {
      assert.equal(read.kind, "mismatch", label);
      if (read.kind === "mismatch") {
        assert.match(read.reason, reason, label);
        assert.ok(!/[\u0080-￿]/.test(read.reason) && !read.reason.includes("fail_"), `${label}: no record bytes or IDs in the reason`);
      }
    }
  });
});

describe("KafkaQuarantineReader without a broker", () => {
  const unreachable = { brokers: ["127.0.0.1:1"], tls: false, ca: null, sasl: null } as const;
  const reader = () => new KafkaQuarantineReader({ topic: "orders.quarantine", connection: unreachable, logger: silent, maxSourceRecordBytes: 1024, clientId: "unit" });
  const request = { failureId: "fail_1", partition: 0, offset: "0", evidenceHash: "sha256:00" };

  it("refuses bad coordinates and a bad timeout without contacting Kafka", async () => {
    const quarantine = reader();
    for (const bad of [{ partition: -1 }, { offset: "-1" }, { offset: "abc" }, { timeoutMs: 0 }, { timeoutMs: Number.NaN }]) {
      const read = await quarantine.read({ ...request, ...bad });
      assert.equal(read.kind, "unavailable", JSON.stringify(bad));
      assert.equal(quarantine.openSockets, 0);
    }
    await quarantine.stop();
  });

  it("reports an unreachable broker as unavailable by error type and releases its sockets", async () => {
    const quarantine = reader();
    const read = await quarantine.read({ ...request, timeoutMs: 2_000 });
    assert.equal(read.kind, "unavailable");
    if (read.kind === "unavailable") {
      assert.match(read.reason, /^the quarantine topic could not be read \(KafkaJS\w+\)$|^the read did not finish within 2000 ms$/);
      assert.ok(!read.reason.includes("127.0.0.1"));
    }
    // KafkaJS keeps retrying its seed broker for longer than the read; stop() does not wait for that.
    const stopping = Date.now();
    await quarantine.stop();
    assert.ok(Date.now() - stopping < 10_000, "stop() returns within its grace periods");
    assert.equal(quarantine.openSockets, 0);
  });

  it("refuses every read after stop()", async () => {
    const quarantine = reader();
    await quarantine.stop();
    assert.deepEqual(await quarantine.read(request), { kind: "unavailable", reason: "the quarantine reader is stopped" });
    await quarantine.stop();
  });
});
