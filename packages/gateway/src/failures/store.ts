import {
  canonicalJson, MAX_RECOVERY_CONTEXT_BYTES, StreamOtterError,
  type ErrorCode, type FailureClass, type FailurePolicy, type Json, type Page, type SourceRecord
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
  /** The last recovery-guard outcome for this incident (quarantine-resync only). */
  guard: GuardResult | null;
  /** The boundary this incident's advance installed, once prepared. */
  boundaryId: string | null;
  updatedAt: string;
}

/** One recovery-guard run, recorded on the incident (ADR-15B §2). reason and evidenceRef are at most 512 characters. */
export interface GuardResult {
  decision: "hold" | "recoverable" | "error" | "timeout";
  reason: string | null;
  evidenceRef: string | null;
  at: string;
}

/**
 * A cumulative recovery boundary (ADR-15B §§2–4). At most one is in force per
 * source; a new one supersedes the previous one in the same transaction.
 * Boundaries are decision state: never pruned while in force.
 */
export interface StoredBoundary {
  /** "rb1:" + random, assigned by the gateway. */
  boundaryId: string;
  sourceId: string;
  generation: string;
  /** The guard's cumulative context, at most 16 KiB of canonical JSON. */
  context: Json;
  /** Increments on every change; retirement names the revision it expects. */
  revision: number;
  state: "in-force" | "superseded" | "retired";
  /** Incidents whose advance installed or carried this boundary, oldest first. */
  failureIds: string[];
  /** The boundary this one replaced, if any. */
  supersedes: string | null;
  createdAt: string;
  retiredAt: string | null;
  retirement: { mode: "generation" | "application" | "operator" | "superseded"; reason: string | null; operationId: string | null } | null;
}

/** Automatic-advance circuit breaker for one source (spec §4: five distinct incidents per rolling 60 s). */
export interface CircuitState {
  sourceId: string;
  state: "closed" | "open";
  /** ISO times of distinct automatic advances still inside the window, oldest first; at most 20 entries. */
  advances: string[];
  openedAt: string | null;
  /** Why it opened, or the operator's reason for the last reopen. */
  reason: string | null;
  revision: number;
}

/** What prepareAdvance writes, atomically with the incident moving to advance-pending. */
export interface PrepareAdvance {
  failureId: string;
  expectedRevision: number;
  /** The new cumulative boundary. expectedPrior must name the boundary in force now (or null), or the call throws StaleRevisionError. */
  boundary: { boundaryId: string; context: Json; expectedPrior: string | null };
  guard: GuardResult;
  /** The time this distinct automatic advance is counted at in the circuit. */
  at: string;
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
  | "progress" | "recovery" | "state" | "resolution" | "updatedAt" | "guard" | "boundaryId"> & { observedAt: string };

export interface ObservationResult {
  record: IncidentRecord;
  /** True when this failureId was not in the store before. */
  created: boolean;
  /** True when the stored evidence hash differs from this observation's: an integrity failure (spec §5.2). */
  conflict: boolean;
}

/** Fields a state transition may change. */
export type IncidentPatch = Partial<Pick<IncidentRecord,
  "quarantine" | "quarantineCoordinates" | "progress" | "recovery" | "state" | "resolution" | "evidence" | "diagnosis" | "guard" | "boundaryId">>;

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
   * open is recorded, and every in-force boundary of the old generation is retired
   * with mode "generation" (ADR-15B §4). A new source is added.
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

  // --- recovery state (slice C) ---------------------------------------------------

  /** The boundary in force for a source, or null. */
  boundary(sourceId: string): StoredBoundary | null;
  getBoundary(boundaryId: string): StoredBoundary | null;
  /**
   * In one transaction (ADR-15A ordering step 5, spec §6 step 6):
   * - checks the incident is at expectedRevision and open, and that the source's
   *   in-force boundary is boundary.expectedPrior;
   * - marks the prior boundary superseded and inserts the new one in force, with
   *   failureIds = prior.failureIds + this incident;
   * - sets the incident's progress "advance-pending", recovery "boundary-in-force",
   *   guard and boundaryId, with an "advance-pending" event;
   * - appends `at` to the source's circuit advances (dropping entries beyond 20).
   * Nothing is written when any check fails. Besides a stale revision or prior
   * (StaleRevisionError) it refuses, with details.reason: an unknown incident
   * (404); "incident-resolved", "boundary-exists" (the ID is taken), and
   * "generation-changed" (the incident's generation is not the source's claimed
   * one) with 409; "context-not-json", "context-too-large" and
   * "guard-text-too-long" with 400. An incident already in the prior's
   * failureIds is not listed twice.
   */
  prepareAdvance(input: PrepareAdvance): { record: IncidentRecord; boundary: StoredBoundary };
  /**
   * Retires an in-force boundary at expectedRevision. Refuses (409) while any incident it lists in failureIds is open with progress "held" or "retrying"
   * ("incident-held"), and when it is no longer in force ("boundary-not-in-force"). Mode "superseded" is refused (400): only prepareAdvance supersedes.
   */
  retireBoundary(boundaryId: string, expectedRevision: number, retirement: NonNullable<StoredBoundary["retirement"]>, at?: string): StoredBoundary;
  /** The source's circuit; a closed circuit with no advances, revision 0, when none is stored. */
  circuit(sourceId: string): CircuitState;
  /** Replaces the circuit's state at expectedRevision (StaleRevisionError otherwise). */
  updateCircuit(sourceId: string, expectedRevision: number, next: Pick<CircuitState, "state" | "advances" | "openedAt" | "reason">): CircuitState;

  usage(): StoreUsage;
  close(): void;
}

/** Spec §13 budgets. */
export const JOURNAL_LIMIT_BYTES = 256 * 1024 * 1024;
export const SPOOL_LIMIT_BYTES = 16 * 1024 * 1024;
export const MAX_EVENTS_PER_INCIDENT = 200;

/** A mutation named a revision (of an incident, boundary or circuit) or a prior boundary that is no longer current. */
export class StaleRevisionError extends StreamOtterError {
  constructor(failureId: string, expected: number, actual: number, message = `Incident ${failureId} is at revision ${actual}, not ${expected}.`) {
    super("INVALID_REQUEST", { message, details: { status: 409, reason: "stale-revision" } });
  }
}

/** A request the current state refuses (HTTP 409), with a machine-readable reason. Nothing was written. */
export function conflict(reason: string, message: string, details: Record<string, Json> = {}): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message, details: { status: 409, reason, ...details } });
}

export function unknownIncident(failureId: string): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message: `Unknown incident ${failureId}.`, details: { status: 404 } });
}

export function unknownBoundary(boundaryId: string): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message: `Unknown recovery boundary ${boundaryId}.`, details: { status: 404 } });
}

function invalid(reason: string, message: string): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message, details: { status: 400, reason } });
}

/** Distinct automatic advances kept per circuit. */
export const MAX_CIRCUIT_ADVANCES = 20;
/** Guard reason and evidenceRef limit, in characters (ADR-15B §2). */
export const MAX_GUARD_TEXT = 512;

/** The circuit of a source that has none stored. */
export function defaultCircuit(sourceId: string): CircuitState {
  return { sourceId, state: "closed", advances: [], openedAt: null, reason: null, revision: 0 };
}

/** Checks updateCircuit's input and returns the stored form, with advances capped. */
export function checkCircuit(sourceId: string, next: Pick<CircuitState, "state" | "advances" | "openedAt" | "reason">, revision: number): CircuitState {
  if (next.state !== "closed" && next.state !== "open") throw invalid("circuit-state", `A circuit is closed or open, not "${String(next.state)}".`);
  if (!Array.isArray(next.advances) || next.advances.some(item => typeof item !== "string")) throw invalid("circuit-advances", "Circuit advances must be a list of ISO times.");
  return { sourceId, state: next.state, advances: capAdvances(next.advances), openedAt: next.openedAt, reason: next.reason, revision };
}

/** Keeps the newest MAX_CIRCUIT_ADVANCES entries, oldest first. */
export function capAdvances(advances: readonly string[]): string[] {
  return advances.slice(Math.max(0, advances.length - MAX_CIRCUIT_ADVANCES));
}

/**
 * Checks what prepareAdvance would store before anything is read or written:
 * a boundary ID, a context that is JSON within 16 KiB canonically, and guard
 * text within 512 characters. Returns the context's canonical JSON text.
 */
export function checkPrepareAdvance(input: PrepareAdvance): string {
  if (typeof input.boundary.boundaryId !== "string" || input.boundary.boundaryId === "") throw invalid("boundary-id", "A boundary ID is required.");
  let context: string;
  try {
    context = canonicalJson(input.boundary.context);
  } catch (error) {
    throw invalid("context-not-json", `The recovery context is not JSON data: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (Buffer.byteLength(context) > MAX_RECOVERY_CONTEXT_BYTES) {
    throw invalid("context-too-large", `The recovery context is ${Buffer.byteLength(context)} bytes of canonical JSON; the limit is ${MAX_RECOVERY_CONTEXT_BYTES}.`);
  }
  for (const field of ["reason", "evidenceRef"] as const) {
    const text = input.guard[field];
    if (text !== null && [...text].length > MAX_GUARD_TEXT) throw invalid("guard-text-too-long", `The guard's ${field} is longer than ${MAX_GUARD_TEXT} characters.`);
  }
  return context;
}

/**
 * The checks prepareAdvance makes against current state, shared by both stores.
 * Throws without side effects; `generation` is the source's claimed generation,
 * or null when the store has no record of it.
 */
export function checkAdvanceState(input: PrepareAdvance, record: IncidentRecord | null, prior: StoredBoundary | null, generation: string | null, exists: boolean): IncidentRecord {
  if (record === null) throw unknownIncident(input.failureId);
  if (record.revision !== input.expectedRevision) throw new StaleRevisionError(input.failureId, input.expectedRevision, record.revision);
  if (record.state !== "open") throw conflict("incident-resolved", `Incident ${input.failureId} is resolved; there is nothing to advance past.`, { failureId: input.failureId });
  if (generation !== null && record.generation !== generation) {
    throw conflict("generation-changed",
      `Incident ${input.failureId} belongs to generation ${record.generation} of source ${record.sourceId}, which is now at generation ${generation}.`,
      { failureId: input.failureId, sourceId: record.sourceId });
  }
  const inForce = prior?.boundaryId ?? null;
  if (inForce !== input.boundary.expectedPrior) {
    throw new StaleRevisionError(input.failureId, input.expectedRevision, record.revision,
      `Source ${record.sourceId} has ${inForce === null ? "no boundary" : `boundary ${inForce}`} in force, not ${input.boundary.expectedPrior ?? "none"}.`);
  }
  if (exists) throw conflict("boundary-exists", `Recovery boundary ${input.boundary.boundaryId} already exists.`, { boundaryId: input.boundary.boundaryId });
  return record;
}

/** The new in-force boundary: cumulative failureIds (oldest first, no repeats) and a link to the one it supersedes. */
export function nextBoundary(input: PrepareAdvance, record: IncidentRecord, prior: StoredBoundary | null, canonicalContext: string): StoredBoundary {
  const failureIds = [...(prior?.failureIds ?? [])];
  if (!failureIds.includes(record.failureId)) failureIds.push(record.failureId);
  return {
    boundaryId: input.boundary.boundaryId,
    sourceId: record.sourceId,
    generation: record.generation,
    context: JSON.parse(canonicalContext) as Json,
    revision: 1,
    state: "in-force",
    failureIds,
    supersedes: prior?.boundaryId ?? null,
    createdAt: input.at,
    retiredAt: null,
    retirement: null
  };
}

/** The incident after prepareAdvance, and its event. */
export function advancedIncident(input: PrepareAdvance, record: IncidentRecord): { record: IncidentRecord; event: IncidentEvent } {
  const next: IncidentRecord = {
    ...record,
    progress: "advance-pending",
    recovery: "boundary-in-force",
    guard: structuredClone(input.guard),
    boundaryId: input.boundary.boundaryId,
    revision: record.revision + 1,
    updatedAt: input.at
  };
  return { record: next, event: { at: input.at, event: "advance-pending", detail: input.boundary.boundaryId, operationId: null } };
}

/** Checks retireBoundary's request against the boundary and the incidents it lists. */
export function checkRetirement(boundaryId: string, boundary: StoredBoundary | null, expectedRevision: number,
  retirement: NonNullable<StoredBoundary["retirement"]>, incidents: (failureId: string) => IncidentRecord | null): StoredBoundary {
  if (boundary === null) throw unknownBoundary(boundaryId);
  if (boundary.revision !== expectedRevision) {
    throw new StaleRevisionError(boundaryId, expectedRevision, boundary.revision, `Recovery boundary ${boundaryId} is at revision ${boundary.revision}, not ${expectedRevision}.`);
  }
  if (!["generation", "application", "operator"].includes(retirement.mode)) {
    throw invalid("retirement-mode", `A boundary is retired by generation, application or operator, not "${retirement.mode}"; superseding happens only in prepareAdvance.`);
  }
  if (boundary.state !== "in-force") throw conflict("boundary-not-in-force", `Recovery boundary ${boundaryId} is ${boundary.state}, not in force.`, { boundaryId, state: boundary.state });
  for (const failureId of boundary.failureIds) {
    const record = incidents(failureId);
    if (record !== null && record.state === "open" && (record.progress === "held" || record.progress === "retrying")) {
      throw conflict("incident-held", `Recovery boundary ${boundaryId} cannot be retired while incident ${failureId} is still ${record.progress}.`, { boundaryId, failureId });
    }
  }
  return boundary;
}

/** A boundary moved out of force (retired or superseded). */
export function endBoundary(boundary: StoredBoundary, retirement: NonNullable<StoredBoundary["retirement"]>, at: string): StoredBoundary {
  return {
    ...boundary,
    state: retirement.mode === "superseded" ? "superseded" : "retired",
    revision: boundary.revision + 1,
    retiredAt: at,
    retirement: structuredClone(retirement)
  };
}

/** The reason recorded when a generation change retires a boundary. */
export function generationRetirement(sourceId: string, from: string, to: string): NonNullable<StoredBoundary["retirement"]> {
  return { mode: "generation", reason: `Source ${sourceId} changed from generation ${from} to ${to}.`, operationId: null };
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
  readonly #boundaries = new Map<string, StoredBoundary>();
  /** The in-force boundary ID of each source. */
  readonly #inForce = new Map<string, string>();
  readonly #circuits = new Map<string, CircuitState>();
  /** Generations from the last claim(), so a boundary is never installed for a superseded generation. */
  readonly #generations = new Map<string, string>();
  readonly #maxIncidents: number;
  readonly #spoolLimitBytes: number;

  constructor(options: { maxIncidents?: number; spoolLimitBytes?: number } = {}) {
    this.#maxIncidents = options.maxIncidents ?? 10_000;
    this.#spoolLimitBytes = options.spoolLimitBytes ?? SPOOL_LIMIT_BYTES;
  }

  /**
   * Nothing persists across runs, so there is no earlier owner or generation to
   * refuse; the gateway's own startup check reports open incidents of another
   * generation. Within one run, a source whose generation changed with nothing
   * open has its in-force boundary retired, as in the journal.
   */
  claim(_projectId: string, sources: readonly SourceIdentity[]): void {
    const at = new Date().toISOString();
    for (const source of sources) {
      this.#generations.set(source.sourceId, source.generation);
      const boundary = this.#inForceBoundary(source.sourceId);
      if (boundary === null || boundary.generation === source.generation || this.open(source.sourceId).length > 0) continue;
      this.#boundaries.set(boundary.boundaryId, endBoundary(boundary, generationRetirement(source.sourceId, boundary.generation, source.generation), at));
      this.#inForce.delete(source.sourceId);
    }
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
        guard: null,
        boundaryId: null,
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
    if (existing === undefined) throw unknownIncident(failureId);
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
    // Replacing a failure's evidence frees the old copy, so it does not count against the new one.
    const replaced = this.#evidence.get(failureId);
    const used = [...this.#evidence.values()].reduce((sum, item) => sum + evidenceBytes(item), 0) - (replaced === undefined ? 0 : evidenceBytes(replaced));
    if (used + evidenceBytes(evidence) > this.#spoolLimitBytes) throw storeFull("The raw evidence spool is full.");
    this.#evidence.set(failureId, structuredClone(evidence));
  }

  getEvidence(failureId: string): RawEvidence | null {
    const evidence = this.#evidence.get(failureId);
    return evidence === undefined ? null : structuredClone(evidence);
  }

  deleteEvidence(failureId: string): void {
    this.#evidence.delete(failureId);
  }

  boundary(sourceId: string): StoredBoundary | null {
    const boundary = this.#inForceBoundary(sourceId);
    return boundary === null ? null : structuredClone(boundary);
  }

  getBoundary(boundaryId: string): StoredBoundary | null {
    const boundary = this.#boundaries.get(boundaryId);
    return boundary === undefined ? null : structuredClone(boundary);
  }

  prepareAdvance(input: PrepareAdvance): { record: IncidentRecord; boundary: StoredBoundary } {
    const context = checkPrepareAdvance(input);
    const existing = this.#incidents.get(input.failureId) ?? null;
    const prior = existing === null ? null : this.#inForceBoundary(existing.sourceId);
    const record = checkAdvanceState(input, existing, prior, existing === null ? null : this.#generations.get(existing.sourceId) ?? null,
      this.#boundaries.has(input.boundary.boundaryId));
    // Every check has passed; from here nothing throws, so the four changes land together.
    const boundary = nextBoundary(input, record, prior, context);
    const advanced = advancedIncident(input, record);
    if (prior !== null) this.#boundaries.set(prior.boundaryId, endBoundary(prior, { mode: "superseded", reason: null, operationId: null }, input.at));
    this.#boundaries.set(boundary.boundaryId, boundary);
    this.#inForce.set(boundary.sourceId, boundary.boundaryId);
    this.#incidents.set(record.failureId, advanced.record);
    this.#addEvent(record.failureId, advanced.event);
    const circuit = this.circuit(record.sourceId);
    this.#circuits.set(record.sourceId, { ...circuit, advances: capAdvances([...circuit.advances, input.at]), revision: circuit.revision + 1 });
    return { record: structuredClone(advanced.record), boundary: structuredClone(boundary) };
  }

  retireBoundary(boundaryId: string, expectedRevision: number, retirement: NonNullable<StoredBoundary["retirement"]>, at = new Date().toISOString()): StoredBoundary {
    const boundary = checkRetirement(boundaryId, this.#boundaries.get(boundaryId) ?? null, expectedRevision, retirement, failureId => this.#incidents.get(failureId) ?? null);
    const retired = endBoundary(boundary, retirement, at);
    this.#boundaries.set(boundaryId, retired);
    this.#inForce.delete(boundary.sourceId);
    return structuredClone(retired);
  }

  circuit(sourceId: string): CircuitState {
    return structuredClone(this.#circuits.get(sourceId) ?? defaultCircuit(sourceId));
  }

  updateCircuit(sourceId: string, expectedRevision: number, next: Pick<CircuitState, "state" | "advances" | "openedAt" | "reason">): CircuitState {
    const current = this.circuit(sourceId);
    if (current.revision !== expectedRevision) {
      throw new StaleRevisionError(sourceId, expectedRevision, current.revision, `The circuit of source ${sourceId} is at revision ${current.revision}, not ${expectedRevision}.`);
    }
    const updated = checkCircuit(sourceId, next, current.revision + 1);
    this.#circuits.set(sourceId, updated);
    return structuredClone(updated);
  }

  usage(): StoreUsage {
    const spoolBytes = [...this.#evidence.values()].reduce((sum, item) => sum + evidenceBytes(item), 0);
    return { sizeBytes: spoolBytes, limitBytes: JOURNAL_LIMIT_BYTES, spoolBytes, spoolLimitBytes: this.#spoolLimitBytes, schemaVersion: 1 };
  }

  close(): void {
    // Nothing to release.
  }

  #inForceBoundary(sourceId: string): StoredBoundary | null {
    const boundaryId = this.#inForce.get(sourceId);
    return boundaryId === undefined ? null : this.#boundaries.get(boundaryId) ?? null;
  }

  #addEvent(failureId: string, event: IncidentEvent): void {
    const list = this.#events.get(failureId) ?? [];
    list.push(event);
    if (list.length > MAX_EVENTS_PER_INCIDENT) list.splice(0, list.length - MAX_EVENTS_PER_INCIDENT);
    this.#events.set(failureId, list);
  }
}
