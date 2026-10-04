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
 * array in arrival order. It folds them with `obj[key] === undefined`, which
 * sees inherited properties, so a header named constructor, toString or
 * __proto__ arrives as [inherited, value]: anything that is neither a Buffer
 * nor a string came from Object.prototype, not the wire, and is skipped.
 */
export function flattenKafkaHeaders(headers: Readonly<Record<string, Buffer | string | (Buffer | string)[] | undefined>> | undefined): HeaderBytes[] {
  const list: HeaderBytes[] = [];
  if (headers === undefined) return list;
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value !== "string" && !(value instanceof Uint8Array)) continue;
      list.push({ name, value: typeof value === "string" ? Buffer.from(value, "utf8") : new Uint8Array(value) });
    }
  }
  return list;
}

/** ADR-15A §4: the quarantine record carries each original header under this prefix, next to its own streamotter-* headers. */
export const SOURCE_HEADER_PREFIX = "src.";

/**
 * Reverses the quarantine writer's header mapping for a record read back from
 * the quarantine topic: the src.* headers in order, one entry per value, with
 * the prefix removed. Flattening the prefixed names first (rather than
 * rebuilding an object keyed by the original names) keeps the order the record
 * carries, which is the order flattenKafkaHeaders produced at capture.
 */
export function sourceHeadersFromQuarantine(headers: Readonly<Record<string, Buffer | string | (Buffer | string)[] | undefined>> | undefined): HeaderBytes[] {
  return flattenKafkaHeaders(headers)
    .filter(header => header.name.startsWith(SOURCE_HEADER_PREFIX))
    .map(header => ({ name: header.name.slice(SOURCE_HEADER_PREFIX.length), value: header.value }));
}

export function keyAndHeaderBytes(evidence: RawEvidence): number {
  return (evidence.key?.byteLength ?? 0) + evidence.headers.reduce((sum, header) => sum + Buffer.byteLength(header.name) + header.value.byteLength, 0);
}
