import { createHash } from "node:crypto";
import type { HeaderBytes, RawEvidence } from "./store.ts";

/** Spec §13: key and headers together may add at most 64 KiB to a complete capture. */
export const MAX_CAPTURED_KEY_AND_HEADER_BYTES = 64 * 1024;
/** ADR-15A §4: the quarantine topic must hold maxSourceRecordBytes plus this much. */
export const QUARANTINE_HEADROOM_BYTES = 80 * 1024;
/** ADR-15A §4: the metadata header is compact JSON of at most 16 KiB. */
export const MAX_ENVELOPE_HEADER_BYTES = 16 * 1024;

function lengthPrefixed(hash: ReturnType<typeof createHash>, bytes: Uint8Array | null): void {
  const length = Buffer.alloc(9);
  if (bytes === null) {
    length.writeUInt8(0, 0);
    hash.update(length);
    return;
  }
  length.writeUInt8(1, 0);
  length.writeBigUInt64BE(BigInt(bytes.byteLength), 1);
  hash.update(length);
  hash.update(bytes);
}

/**
 * Content hash of captured evidence: key, value and headers in order, each
 * length-prefixed with a null marker, so null and empty differ and no two
 * different records share an encoding.
 */
export function evidenceHash(evidence: RawEvidence): string {
  const hash = createHash("sha256");
  hash.update("streamotter-evidence-v1");
  lengthPrefixed(hash, evidence.key);
  lengthPrefixed(hash, evidence.value);
  lengthPrefixed(hash, Buffer.from(String(evidence.headers.length)));
  for (const header of evidence.headers) {
    lengthPrefixed(hash, Buffer.from(header.name, "utf8"));
    lengthPrefixed(hash, header.value);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Flattens KafkaJS headers into an ordered list, one entry per value, so a key
 * repeated on the wire keeps every value. KafkaJS decodes repeated keys into an
 * array in arrival order.
 */
export function flattenKafkaHeaders(headers: Readonly<Record<string, Buffer | string | (Buffer | string)[] | undefined>> | undefined): HeaderBytes[] {
  const list: HeaderBytes[] = [];
  if (headers === undefined) return list;
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      list.push({ name, value: typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value) });
    }
  }
  return list;
}

export function keyAndHeaderBytes(evidence: RawEvidence): number {
  return (evidence.key?.byteLength ?? 0) + evidence.headers.reduce((sum, header) => sum + Buffer.byteLength(header.name) + header.value.byteLength, 0);
}
