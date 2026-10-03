import {
  StreamOtterError,
  type ErrorCode, type FailureClass, type FailurePolicy, type Page, type SourceRecord
} from "@streamotter/contracts";

/**
 * The incident store: decision state for source failures (ADR-15A §2). Two
 * implementations share this interface: SqliteIncidentStore (durable, one file
 * per project, exclusively owned) and MemoryIncidentStore (development only,
 * never durable). Every method is synchronous so a state change and its event
 * commit together. The store holds decision state and, for local evidence and
 * the pending raw spool, original bytes; it is not a delivery-history store.
 */

export type QuarantineState = "not-required" | "pending" | "unknown" | "acknowledged" | "failed";
export type ProgressState = "held" | "retrying" | "advance-pending" | "advanced" | "processed" | "uncertain";
export type RecoveryState = "not-applicable" | "guard-pending" | "held" | "boundary-in-force" | "denied";
export type EvidenceCompleteness = "complete" | "incomplete" | "unavailable" | "expired";
export type IncidentEventName =
  | "detected" | "retrying" | "captured" | "quarantine-unknown" | "quarantined" | "held"
  | "advance-pending" | "advance-confirmed" | "snapshot-recovery-required" | "operator" | "resolved";

export interface HeaderBytes { name: string; value: Uint8Array }

/** Original record bytes. Untrusted data: never parsed for instructions, never rendered as markup. */
export interface RawEvidence {
  key: Uint8Array | null;
  value: Uint8Array | null;
  headers: readonly HeaderBytes[];
}

export interface EvidenceSummary {
  location: "kafka" | "local" | "none";
  completeness: EvidenceCompleteness;
  valueBytes: number | null;
  keyBytes: number | null;
  headerCount: number;
  /** "sha256:<hex>" over key, value and headers (evidence.ts), or "" when nothing was captured. */
  hash: string;
}

export interface IncidentRecord {
  failureId: string;
  /** Increments on every change; mutations name the revision they expect. */
  revision: number;
  sourceId: string;
  generation: string;
  position: SourceRecord["position"];
  clusterId: string | null;
  timestamp: string | null;
  failureClass: FailureClass;
  stage: "validate" | "map" | "queue";
  errorCode: ErrorCode;
  channel: string | null;
  policy: FailurePolicy;
  diagnosis: string;
  firstObservedAt: string;
  lastObservedAt: string;
  observations: number;
  evidence: EvidenceSummary;
  quarantine: QuarantineState;
  quarantineCoordinates: { partition: number; offset: string } | null;
  progress: ProgressState;
  recovery: RecoveryState;
  state: "open" | "resolved";
  resolution: string | null;
  fingerprints: { config: string; handlerBuildId: string; policyRevision: string; gatewayVersion: string };
  updatedAt: string;
}

export interface IncidentEvent {
  at: string;
  event: IncidentEventName;
  detail: string | null;
  operationId: string | null;
}

/** A new observation of a failing record. */
export type NewObservation = Omit<IncidentRecord,
  "revision" | "firstObservedAt" | "lastObservedAt" | "observations" | "quarantine" | "quarantineCoordinates"
  | "progress" | "recovery" | "state" | "resolution" | "updatedAt"> & { observedAt: string };

export interface ObservationResult {
  record: IncidentRecord;
  /** True when this failureId was not in the store before. */
  created: boolean;
  /** True when the stored evidence hash differs from this observation's: an integrity failure (spec §5.2). */
  conflict: boolean;
}

/** Fields a state transition may change. */
export type IncidentPatch = Partial<Pick<IncidentRecord,
  "quarantine" | "quarantineCoordinates" | "progress" | "recovery" | "state" | "resolution" | "evidence" | "diagnosis">>;

export interface IncidentQuery {
  sourceId?: string;
  state?: "open" | "resolved" | "all";
  /** 1–200; default 50. */
  limit?: number;
  /** Opaque cursor from a previous page. */
  cursor?: string;
}

export interface SourceIdentity { sourceId: string; generation: string; kind: "kafka" | "fixture" }

export interface StoreUsage {
  sizeBytes: number;
  limitBytes: number;
  spoolBytes: number;
  spoolLimitBytes: number;
  schemaVersion: number;
}

export interface IncidentStore {
  readonly kind: "sqlite" | "memory";
  readonly path: string | null;
  /**
   * Checks the store belongs to this project and records the configured sources.
   * Refuses (SOURCE_UNAVAILABLE) a different project, or a source whose generation
   * changed while it still has open incidents. A changed generation with nothing
   * open is recorded. A new source is added.
   */
  claim(projectId: string, sources: readonly SourceIdentity[]): void;
  get(failureId: string): IncidentRecord | null;
  events(failureId: string, limit?: number): IncidentEvent[];
  /**
   * Inserts the incident, or counts another observation of an existing one and
   * reopens it if it had been resolved. Adds a "detected" event. Throws when the
   * store is full (journal limit) rather than evicting anything.
   */
  observe(observation: NewObservation): ObservationResult;
  /** Applies a transition if the incident is at expectedRevision; otherwise throws a stale-revision error. */
  update(failureId: string, expectedRevision: number, patch: IncidentPatch, event: Omit<IncidentEvent, "at"> & { at?: string }): IncidentRecord;
  list(query: IncidentQuery): Page<IncidentRecord>;
  /** Open incidents of a source, oldest first. */
  open(sourceId: string): IncidentRecord[];
  /** Stores original bytes (local evidence or the pending raw spool). Throws when the spool budget is exceeded. */
  putEvidence(failureId: string, evidence: RawEvidence): void;
  getEvidence(failureId: string): RawEvidence | null;
  deleteEvidence(failureId: string): void;
  usage(): StoreUsage;
  close(): void;
}

/** Spec §13 budgets. */
export const JOURNAL_LIMIT_BYTES = 256 * 1024 * 1024;
export const SPOOL_LIMIT_BYTES = 16 * 1024 * 1024;
export const MAX_EVENTS_PER_INCIDENT = 200;

export class StaleRevisionError extends StreamOtterError {
  constructor(failureId: string, expected: number, actual: number) {
    super("INVALID_REQUEST", { message: `Incident ${failureId} is at revision ${actual}, not ${expected}.`, details: { status: 409, reason: "stale-revision" } });
  }
}

export function storeFull(message: string): StreamOtterError {
  return new StreamOtterError("OVERLOADED", { message, details: { reason: "journal-full" } });
}

export function evidenceBytes(evidence: RawEvidence): number {
  return (evidence.key?.byteLength ?? 0) + (evidence.value?.byteLength ?? 0)
    + evidence.headers.reduce((sum, header) => sum + Buffer.byteLength(header.name) + header.value.byteLength, 0);
}

function encodeCursor(index: number): string {
  return Buffer.from(`m:${index}`).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^m:(\d{1,9})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (match === null) throw new StreamOtterError("INVALID_REQUEST", { message: "Invalid cursor." });
  return Number(match[1]);
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new StreamOtterError("INVALID_REQUEST", { message: "limit must be an integer from 1 to 200." });
  return limit;
}

/**
 * Development-only store. Never durable: a restart loses every incident. Status
 * reports it as "memory" so nobody mistakes it for the journal.
 */
export class MemoryIncidentStore implements IncidentStore {
  readonly kind = "memory" as const;
  readonly path = null;
  readonly #incidents = new Map<string, IncidentRecord>();
  readonly #events = new Map<string, IncidentEvent[]>();
  readonly #evidence = new Map<string, RawEvidence>();
  readonly #order: string[] = [];
  readonly #maxIncidents: number;

  constructor(options: { maxIncidents?: number } = {}) {
    this.#maxIncidents = options.maxIncidents ?? 10_000;
  }

  claim(): void {
    // Nothing persists across runs, so there is no earlier owner to check.
  }

  get(failureId: string): IncidentRecord | null {
    const record = this.#incidents.get(failureId);
    return record === undefined ? null : structuredClone(record);
  }

  events(failureId: string, limit = MAX_EVENTS_PER_INCIDENT): IncidentEvent[] {
    return structuredClone((this.#events.get(failureId) ?? []).slice(-limit));
  }

  observe(observation: NewObservation): ObservationResult {
    const { observedAt, ...fields } = observation;
    const existing = this.#incidents.get(observation.failureId);
    if (existing === undefined) {
      if (this.#incidents.size >= this.#maxIncidents) throw storeFull("The in-memory incident store is full.");
      const record: IncidentRecord = {
        ...structuredClone(fields),
        revision: 1,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        observations: 1,
        quarantine: "not-required",
        quarantineCoordinates: null,
        progress: "held",
        recovery: "not-applicable",
        state: "open",
        resolution: null,
        updatedAt: observedAt
      };
      this.#incidents.set(record.failureId, record);
      this.#order.push(record.failureId);
      this.#addEvent(record.failureId, { at: observedAt, event: "detected", detail: record.failureClass, operationId: null });
      return { record: structuredClone(record), created: true, conflict: false };
    }
    const conflict = existing.evidence.hash !== "" && fields.evidence.hash !== "" && existing.evidence.hash !== fields.evidence.hash;
    existing.revision++;
    existing.lastObservedAt = observedAt;
    existing.observations++;
    existing.updatedAt = observedAt;
    if (existing.state === "resolved") {
      existing.state = "open";
      existing.resolution = null;
      existing.progress = "held";
    }
    if (!conflict) {
      existing.failureClass = fields.failureClass;
      existing.stage = fields.stage;
      existing.errorCode = fields.errorCode;
      existing.channel = fields.channel;
      existing.diagnosis = fields.diagnosis;
    }
    this.#addEvent(existing.failureId, { at: observedAt, event: "detected", detail: conflict ? "evidence-conflict" : fields.failureClass, operationId: null });
    return { record: structuredClone(existing), created: false, conflict };
  }

  update(failureId: string, expectedRevision: number, patch: IncidentPatch, event: Omit<IncidentEvent, "at"> & { at?: string }): IncidentRecord {
    const existing = this.#incidents.get(failureId);
    if (existing === undefined) throw new StreamOtterError("INVALID_REQUEST", { message: `Unknown incident ${failureId}.`, details: { status: 404 } });
    if (existing.revision !== expectedRevision) throw new StaleRevisionError(failureId, expectedRevision, existing.revision);
    const at = event.at ?? new Date().toISOString();
    Object.assign(existing, structuredClone(patch));
    existing.revision++;
    existing.updatedAt = at;
    this.#addEvent(failureId, { at, event: event.event, detail: event.detail, operationId: event.operationId });
    return structuredClone(existing);
  }

  list(query: IncidentQuery): Page<IncidentRecord> {
    const limit = clampLimit(query.limit);
    const start = decodeCursor(query.cursor);
    const state = query.state ?? "open";
    const items: IncidentRecord[] = [];
    let index = start;
    for (; index < this.#order.length && items.length < limit; index++) {
      const record = this.#incidents.get(this.#order[index] as string) as IncidentRecord;
      if (query.sourceId !== undefined && record.sourceId !== query.sourceId) continue;
      if (state !== "all" && record.state !== state) continue;
      items.push(structuredClone(record));
    }
    return { items, nextCursor: index < this.#order.length ? encodeCursor(index) : null };
  }

  open(sourceId: string): IncidentRecord[] {
    return this.#order
      .map(id => this.#incidents.get(id) as IncidentRecord)
      .filter(record => record.sourceId === sourceId && record.state === "open")
      .map(record => structuredClone(record));
  }

  putEvidence(failureId: string, evidence: RawEvidence): void {
    const used = [...this.#evidence.values()].reduce((sum, item) => sum + evidenceBytes(item), 0);
    if (used + evidenceBytes(evidence) > SPOOL_LIMIT_BYTES) throw storeFull("The raw evidence spool is full.");
    this.#evidence.set(failureId, structuredClone(evidence));
  }

  getEvidence(failureId: string): RawEvidence | null {
    const evidence = this.#evidence.get(failureId);
    return evidence === undefined ? null : structuredClone(evidence);
  }

  deleteEvidence(failureId: string): void {
    this.#evidence.delete(failureId);
  }

  usage(): StoreUsage {
    const spoolBytes = [...this.#evidence.values()].reduce((sum, item) => sum + evidenceBytes(item), 0);
    return { sizeBytes: spoolBytes, limitBytes: JOURNAL_LIMIT_BYTES, spoolBytes, spoolLimitBytes: SPOOL_LIMIT_BYTES, schemaVersion: 1 };
  }

  close(): void {
    // Nothing to release.
  }

  #addEvent(failureId: string, event: IncidentEvent): void {
    const list = this.#events.get(failureId) ?? [];
    list.push(event);
    if (list.length > MAX_EVENTS_PER_INCIDENT) list.splice(0, list.length - MAX_EVENTS_PER_INCIDENT);
    this.#events.set(failureId, list);
  }
}
