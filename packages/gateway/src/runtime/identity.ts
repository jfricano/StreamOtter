import type { Principal, Revocation, SourceRecord } from "@streamotter/contracts";
import { isJsonValue, isPlainObject, parseUtcTimestamp } from "@streamotter/contracts/internal";
import { sha256Hex } from "./util.ts";

const MAX_IDENTITY_FIELD = 512;

/** True for a non-empty string of at most MAX_IDENTITY_FIELD characters. */
function isIdentityField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTITY_FIELD;
}

/** Validates a principal returned by trusted server code; returns a reason when invalid. */
export function principalProblem(value: unknown, now = Date.now()): string | null {
  if (!isPlainObject(value)) return "principal must be an object";
  for (const key of ["subject", "tenantId", "sessionId"] as const) {
    if (!isIdentityField(value[key])) return `principal.${key} must be a non-empty string`;
  }
  const expiresAt = parseUtcTimestamp(value["expiresAt"]);
  if (!Number.isFinite(expiresAt)) return "principal.expiresAt must be a UTC RFC3339 timestamp";
  if (expiresAt <= now) return "principal.expiresAt must be in the future";
  if (!isPlainObject(value["claims"]) || !isJsonValue(value["claims"])) return "principal.claims must be a JSON object";
  return null;
}

/** Copies a validated principal so later mutation by application code has no effect. */
export function freezePrincipal(principal: Principal): Principal {
  return Object.freeze({
    subject: principal.subject,
    tenantId: principal.tenantId,
    sessionId: principal.sessionId,
    expiresAt: principal.expiresAt,
    claims: deepFreeze(structuredClone(principal.claims))
  });
}

/** Freezes `value` and every object nested in it, in place. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Opaque, stable key scoped to project, tenant, and subject; changes when the account changes. */
export function identityKey(projectId: string, principal: Principal): string {
  return sha256Hex(["identity", projectId, principal.tenantId, principal.subject]).slice(0, 32);
}

/** Stable ID of a source record: the hash of project, source, source generation and position. */
export function sourceRecordId(projectId: string, sourceId: string, generation: string, position: SourceRecord["position"]): string {
  return sha256Hex([projectId, sourceId, generation, position]);
}

/** Stable ID of the update event a source record yields for one channel, tenant, parameter set and revision. */
export function updateEventId(recordId: string, channel: string, version: number, tenantId: string, canonicalParams: string, revision: string): string {
  return sha256Hex([recordId, channel, version, tenantId, canonicalParams, revision]);
}

interface RevocationEntry { seq: number; at: number; selector: Revocation; canonicalParams: string | null }

/**
 * Short-lived, in-memory record of revocations so operations that were already
 * pending when a revocation arrived cannot complete with stale access. This is
 * not a durable revocation database: applications update their own policy first.
 */
export class RevocationLog {
  readonly #retentionMs: number;
  #entries: RevocationEntry[] = [];
  #seq = 0;

  /** Creates an empty log that forgets entries older than `retentionMs`. */
  constructor(retentionMs: number) {
    this.#retentionMs = retentionMs;
  }

  /** Sequence number of the latest revocation; capture it before a pending operation and pass it to revokedSince. */
  get sequence(): number {
    return this.#seq;
  }

  /** Records a revocation, pruning expired entries and dropping the oldest once 10,000 are held. `canonicalParams` narrows a channel revocation to one parameter set, or null for all. */
  add(selector: Revocation, canonicalParams: string | null): void {
    const now = Date.now();
    this.#entries = this.#entries.filter(entry => now - entry.at <= this.#retentionMs);
    if (this.#entries.length >= 10_000) this.#entries.shift();
    this.#entries.push({ seq: ++this.#seq, at: now, selector, canonicalParams });
  }

  /** True if a revocation recorded after `sinceSeq` matches this principal (and channel, if given). */
  revokedSince(sinceSeq: number, principal: Principal, channel?: { name: string; version: number; canonicalParams: string }): boolean {
    for (const entry of this.#entries) {
      if (entry.seq <= sinceSeq) continue;
      if (matchesPrincipal(entry.selector, principal) && entry.selector.kind !== "channel") return true;
      if (entry.selector.kind === "channel" && channel !== undefined && matchesPrincipal(entry.selector, principal)
        && entry.selector.channel === channel.name && entry.selector.channelVersion === channel.version
        && (entry.canonicalParams === null || entry.canonicalParams === channel.canonicalParams)) {
        return true;
      }
    }
    return false;
  }
}

/** True if the selector names this principal: same tenant and, by kind, the same session or subject. */
export function matchesPrincipal(selector: Revocation, principal: Principal): boolean {
  if (selector.tenantId !== principal.tenantId) return false;
  switch (selector.kind) {
    case "session": return selector.sessionId === principal.sessionId;
    case "subject":
    case "channel": return selector.subject === principal.subject;
    default: return false;
  }
}
