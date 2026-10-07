import type { Json, Revision } from "./types.ts";

/** Maximum nesting depth of a schema and of a JSON value: 16 levels. */
export const MAX_NESTING_DEPTH = 16;
/**
 * Nesting allowed when a whole project configuration is canonicalized (fingerprints, export). Each
 * nested object schema adds two levels (`properties` and the key), so a schema at the full
 * MAX_NESTING_DEPTH sits about twice as deep in the configuration.
 */
export const MAX_CONFIG_DEPTH = 2 * MAX_NESTING_DEPTH + 8;
/**
 * Pattern for project, source, channel, schema and connection-profile IDs: a letter followed by
 * up to 63 letters, digits, `_` or `-`.
 */
export const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Pattern for a canonical {@link Revision}: an unsigned decimal integer of at most 39 digits, without leading zeros. */
export const REVISION_PATTERN = /^(?:0|[1-9][0-9]{0,38})$/;
/** Pattern for a UUID in 8-4-4-4-12 hexadecimal form, in either case. Version and variant digits are not checked. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** Returns true when `value` is a string matching {@link IDENTIFIER_PATTERN}. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

/** Returns true when `value` is a string matching {@link UUID_PATTERN}. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Returns true when `value` is a canonical revision string matching {@link REVISION_PATTERN}. */
export function isRevision(value: unknown): value is Revision {
  return typeof value === "string" && REVISION_PATTERN.test(value);
}

/** Numeric comparison of canonical revisions without converting to number. */
export function compareRevisions(a: Revision, b: Revision): -1 | 0 | 1 {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Parses a UTC RFC3339 timestamp; returns NaN when malformed. */
export function parseUtcTimestamp(value: unknown): number {
  if (typeof value !== "string" || !RFC3339_UTC_PATTERN.test(value)) return Number.NaN;
  return Date.parse(value);
}

/** Returns true when `value` is a non-array object whose prototype is `Object.prototype` or `null`. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** UTF-8 byte length without allocating an encoded copy. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++; } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Number of Unicode code points in `text`: a surrogate pair counts once, and so does an unpaired
 * surrogate. Schema `minLength` and `maxLength` are measured this way.
 */
export function codePointLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    length++;
  }
  return length;
}

/**
 * Checks that a value is plain JSON data within the nesting limit: finite
 * numbers, plain objects/arrays, no undefined or functions.
 */
export function isJsonValue(value: unknown, depth = 1): value is Json {
  if (depth > MAX_NESTING_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
  if (isPlainObject(value)) return Object.values(value).every(item => isJsonValue(item, depth + 1));
  return false;
}

/**
 * Drops object properties whose value is undefined, as JSON.stringify does, so `{ note: row.note }`
 * with no note means "no note" rather than non-JSON data. TypeScript's optional properties accept
 * undefined unless exactOptionalPropertyTypes is on. Anything else is returned unchanged for
 * isJsonValue to judge, including undefined array items.
 */
export function withoutUndefinedProperties(value: unknown, depth = 1): unknown {
  if (depth > MAX_NESTING_DEPTH) return value;
  if (Array.isArray(value)) return value.map(item => withoutUndefinedProperties(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    Object.defineProperty(copy, key, { value: withoutUndefinedProperties(item, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

/**
 * Canonical JSON: sorted object keys, -0 normalized to 0, no whitespace.
 * Throws on values that are not JSON data.
 */
export function canonicalJson(value: unknown, maxDepth = MAX_NESTING_DEPTH): string {
  return JSON.stringify(canonicalize(value, 1, maxDepth));
}

function canonicalize(value: unknown, depth: number, maxDepth: number): Json {
  if (depth > maxDepth) throw new TypeError("Value exceeds the maximum nesting depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers are not JSON data");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(item => canonicalize(item, depth + 1, maxDepth));
  if (isPlainObject(value)) {
    const sorted: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined) continue;
      Object.defineProperty(sorted, key, { value: canonicalize(item, depth + 1, maxDepth), enumerable: true, writable: true, configurable: true });
    }
    return sorted;
  }
  throw new TypeError("Value is not JSON data");
}

/** Pretty canonical JSON (sorted keys, two-space indent, trailing newline) for files. */
export function canonicalJsonPretty(value: unknown, maxDepth = MAX_NESTING_DEPTH): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value, maxDepth)) as Json, null, 2)}\n`;
}
