import {
  isJsonValue, isPlainObject, parseUtcTimestamp, type Principal, type Revocation, type SourceRecord
} from "@streamotter/contracts";
import { sha256Hex } from "./util.ts";

const MAX_IDENTITY_FIELD = 512;

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
    claims: Object.freeze(structuredClone(principal.claims))
  });
}

/** Opaque, stable key scoped to project, tenant, and subject; changes when the account changes. */
export function identityKey(projectId: string, principal: Principal): string {
  return sha256Hex(["identity", projectId, principal.tenantId, principal.subject]).slice(0, 32);
}

export function sourceRecordId(projectId: string, sourceId: string, generation: string, position: SourceRecord["position"]): string {
  return sha256Hex([projectId, sourceId, generation, position]);
}

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

  constructor(retentionMs: number) {
    this.#retentionMs = retentionMs;
  }

  get sequence(): number {
    return this.#seq;
  }

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

export function matchesPrincipal(selector: Revocation, principal: Principal): boolean {
  if (selector.tenantId !== principal.tenantId) return false;
  switch (selector.kind) {
    case "session": return selector.sessionId === principal.sessionId;
    case "subject":
    case "channel": return selector.subject === principal.subject;
    default: return false;
  }
}
