import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonicalJson, isJsonValue, isPlainObject, MAX_RECOVERY_CONTEXT_BYTES, policyFor, resolveSourcePolicy, StreamOtterError,
  type ErrorCode, type FailureClass, type FailurePolicy, type GatewayLogger, type Json, type ProjectConfig,
  type ResolvedSourcePolicy, type SourceRecord, type SourceRecoveryHandlers
} from "@streamotter/contracts";
import { sourceRecordId } from "../runtime/identity.ts";
import { describeError, invokeHandler, newId, nowIso, sha256Hex } from "../runtime/util.ts";
import type { ProcessOutcome, SourceAdapter, SourceInput } from "../sources/types.ts";
import { evidenceHash, keyAndHeaderBytes, MAX_CAPTURED_KEY_AND_HEADER_BYTES } from "./evidence.ts";
import type { QuarantineOutcome, QuarantineWriter } from "./quarantine.ts";
import { StaleRevisionError, type EvidenceSummary, type GuardResult, type IncidentEventName, type IncidentRecord, type IncidentStore, type RawEvidence, type StoredBoundary } from "./store.ts";

/** Spec §13: the recovery guard's budget, independent of handlerTimeoutMs. */
export const GUARD_TIMEOUT_MS = 10_000;
const MAX_GUARD_TEXT = 512;

/** The boundary a source's snapshots must acknowledge, as the runtime holds it. */
export type BoundaryInForce = { id: string; context: Json } | null;

/** Reads a consumer group's committed offset for one partition ("-1" or null when none). */
export type CommittedOffsetReader = (source: FailureSource, topic: string, partition: number) => Promise<string | null>;

/** Test-only instrumentation: awaited just before advancePast and just after it reports "advanced". */
export interface AdvanceHooks {
  beforeAdvance?: (failureId: string) => Promise<void>;
  afterAdvance?: (failureId: string) => Promise<void>;
}

/** Progress states that mean the record is still held at its position, or that its advance is unresolved. */
const WATCHED_PROGRESS = new Set<IncidentRecord["progress"]>(["held", "retrying", "advance-pending", "uncertain"]);

type GuardOutcome =
  | { decision: "recoverable"; context: Json; result: GuardResult }
  | { decision: "hold" | "error" | "timeout"; result: GuardResult };

/** What the failure service needs to know about one source. */
export interface FailureSource {
  readonly id: string;
  readonly config: ProjectConfig["sources"][string];
  readonly adapter: SourceAdapter | null;
}

type Pause = Extract<ProcessOutcome, { kind: "pause" }>;

let cachedVersion: string | null = null;
export function gatewayVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
    cachedVersion = typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

/**
 * Owns source-failure incidents for one gateway (ADR-15A). Every failure pauses
 * through the V1 path first; the adapter then calls held(), and the work here
 * (journal, quarantine write) runs outside the fetch loop, one record at a time
 * per source. Nothing here commits a source offset: quarantine-hold keeps the
 * record's position uncommitted, and continuation is slice C's guarded path.
 */
export class FailureService {
  readonly store: IncidentStore;
  readonly #config: ProjectConfig;
  readonly #logger: GatewayLogger;
  readonly #quarantine: QuarantineWriter | null;
  readonly #fingerprints: IncidentRecord["fingerprints"];
  readonly #maxSourceRecordBytes: number;
  readonly #chains = new Map<string, Promise<void>>();
  /** The sources whose failure chain the current async context is running in, so run() can nest without waiting on itself. */
  readonly #inChain = new AsyncLocalStorage<ReadonlySet<string>>();
  /** Positions handed to held() whose disposition has not started, and whether the record committed meanwhile. */
  readonly #queued = new Map<string, boolean>();
  readonly #policies = new Map<string, ResolvedSourcePolicy>();
  /** Sources with an incident that a later successful commit could resolve; keeps the commit path cheap. */
  readonly #watched = new Set<string>();
  readonly #clusterIds = new Map<string, string>();
  /** Set when a journal write failed; readiness reports it until a later write succeeds. */
  #journalError: string | null = null;
  readonly #guards: Readonly<Record<string, SourceRecoveryHandlers>>;
  readonly #onBoundary: (sourceId: string, boundary: BoundaryInForce) => void;
  readonly #stopSignal: AbortSignal;
  /** Sources with an application retire() call running, so acknowledgments don't pile up. */
  readonly #retiring = new Set<string>();
  readonly #hooks: AdvanceHooks;

  constructor(options: {
    config: ProjectConfig;
    store: IncidentStore;
    logger: GatewayLogger;
    quarantine: QuarantineWriter | null;
    configFingerprint: string;
    handlerBuildId: string;
    maxSourceRecordBytes: number;
    /** handlers.sources: recovery guards for quarantine-resync sources. */
    guards?: Readonly<Record<string, SourceRecoveryHandlers>>;
    /** Applies the boundary in force to the source runtime, so every later snapshot must acknowledge it. */
    onBoundary?: (sourceId: string, boundary: BoundaryInForce) => void;
    stopSignal?: AbortSignal;
    /** Test-only crash points around the offset advance. */
    hooks?: AdvanceHooks;
  }) {
    this.#hooks = options.hooks ?? {};
    this.#guards = options.guards ?? {};
    this.#onBoundary = options.onBoundary ?? (() => undefined);
    this.#stopSignal = options.stopSignal ?? new AbortController().signal;
    this.store = options.store;
    this.#config = options.config;
    this.#logger = options.logger;
    this.#quarantine = options.quarantine;
    this.#maxSourceRecordBytes = options.maxSourceRecordBytes;
    for (const sourceId of Object.keys(options.config.sources)) {
      this.#policies.set(sourceId, resolveSourcePolicy(options.config.failureHandling, sourceId));
    }
    this.#fingerprints = {
      config: options.configFingerprint,
      handlerBuildId: options.handlerBuildId,
      policyRevision: sha256Hex(options.config.failureHandling ?? null).slice(0, 16),
      gatewayVersion: gatewayVersion()
    };
  }

  get journalError(): string | null {
    return this.#journalError;
  }

  /** Records the Kafka cluster ID a source reads from, as confirmed at startup. */
  setClusterId(sourceId: string, clusterId: string): void {
    this.#clusterIds.set(sourceId, clusterId);
  }

  /**
   * Startup checks against the journal: an open incident from another source
   * generation refuses startup, because its positions no longer name the same
   * records (ADR-15A §3). Rebaselining is an operator command (slice D).
   */
  async start(sources: Iterable<FailureSource>, committedOffset?: CommittedOffsetReader): Promise<void> {
    for (const source of sources) {
      const open = this.store.open(source.id);
      const stale = open.find(incident => incident.generation !== source.config.generation);
      if (stale !== undefined) {
        throw new StreamOtterError("CONFIG_INVALID", {
          message: `Source "${source.id}" has an open incident (${stale.failureId}) from generation "${stale.generation}", but the configuration names generation "${source.config.generation}". Resolve the open incidents before changing the generation, or close them with "streamotter sources rebaseline" (gateway stopped).`
        });
      }
      // Restore the boundary before the source can become ready, so no snapshot after a restart skips it (spec §6, F23).
      const boundary = this.store.boundary(source.id);
      if (boundary !== null && boundary.generation === source.config.generation) this.#onBoundary(source.id, { id: boundary.boundaryId, context: boundary.context });
      for (const incident of open) {
        if (incident.progress === "advance-pending" || incident.progress === "uncertain") await this.#reconcile(source, incident, committedOffset);
      }
      if (this.store.open(source.id).some(incident => WATCHED_PROGRESS.has(incident.progress))) this.#watched.add(source.id);
    }
  }

  /**
   * An advance was prepared (or could not be confirmed) before the last stop.
   * The group's committed offset decides what happened; a missing barrier is
   * never inferred and an unexplained position holds (spec §6, F16, F17).
   */
  async #reconcile(source: FailureSource, incident: IncidentRecord, committedOffset: CommittedOffsetReader | undefined): Promise<void> {
    const position = incident.position;
    const mismatch = this.#clusterMismatch(source, incident);
    if (mismatch !== null) {
      // Another cluster's committed offsets say nothing about this advance.
      this.#update(incident, { progress: "uncertain", diagnosis: mismatch }, "held", "cluster-mismatch at startup");
      return;
    }
    if (position.kind !== "kafka") {
      this.#update(incident, { progress: "held" }, "held", "the fixture restarted from its first record, so the advance is evaluated again when the record is reached");
      return;
    }
    let committed: string | null;
    try {
      committed = committedOffset === undefined ? null : await committedOffset(source, position.topic, position.partition);
    } catch (error) {
      this.#update(incident, { progress: "uncertain" }, "held", `the committed offset could not be read at startup (${(error as Error).name}); the source stays held`);
      return;
    }
    const next = (BigInt(position.offset) + 1n).toString();
    if (committed === next) {
      this.#update(incident, { progress: "advanced", state: "resolved", resolution: `advanced past under recovery boundary ${incident.boundaryId ?? "(none)"}; confirmed at startup` },
        "advance-confirmed", "the group's committed offset shows the advance happened before the restart");
    } else if (committed === null || committed === "-1" || BigInt(committed) <= BigInt(position.offset)) {
      this.#update(incident, { progress: "held" }, "held", "the advance was never committed; the record is evaluated again when it is redelivered");
    } else {
      this.#update(incident, {
        progress: "uncertain",
        diagnosis: `Source progress moved: the group's committed offset ${committed} is past ${next}, which this gateway did not record. The source stays held.`
      }, "held", "unexplained group position at startup");
    }
  }

  policy(sourceId: string): ResolvedSourcePolicy {
    return this.#policies.get(sourceId) ?? resolveSourcePolicy(undefined, sourceId);
  }

  /** Called by the adapter once it is paused at the failing record. Serialized per source. */
  held(source: FailureSource, input: SourceInput, outcome: Pause): Promise<void> {
    this.#queued.set(positionKey(source.id, input.position), false);
    const previous = this.#chains.get(source.id) ?? Promise.resolve();
    const next = previous.then(() => this.#inSource(source.id, () => this.#dispose(source, input, outcome))).catch(error => {
      this.#logger.error("Failure handling stopped with an unexpected error; the source stays paused", { sourceId: source.id, error: (error as Error).name });
    });
    this.#chains.set(source.id, next);
    return next;
  }

  /**
   * Runs operator work in the source's failure chain, after any disposition
   * already queued and before any queued later, so an operator action never
   * interleaves with the guarded continuation of the same source. Work that
   * already runs in the source's chain (an operator action that retries the
   * source, which calls beforeRetry) runs directly instead of waiting on itself.
   */
  run<T>(sourceId: string, work: () => Promise<T> | T): Promise<T> {
    if (this.#inChain.getStore()?.has(sourceId) === true) return Promise.resolve().then(work);
    const previous = this.#chains.get(sourceId) ?? Promise.resolve();
    const result = previous.then(() => this.#inSource(sourceId, work));
    this.#chains.set(sourceId, result.then(() => undefined, () => undefined));
    return result;
  }

  #inSource<T>(sourceId: string, work: () => Promise<T> | T): Promise<T> | T {
    return this.#inChain.run(new Set([...(this.#inChain.getStore() ?? []), sourceId]), work);
  }

  /** Resolves when every queued disposition has finished; for tests and shutdown. */
  async settled(): Promise<void> {
    await Promise.all(this.#chains.values());
  }

  /**
   * A record at a held position was processed and committed after a retry or a
   * restart. The incident is resolved as processed; nothing was skipped. The
   * source stays watched while any other incident is open, including an
   * advance that is pending or uncertain, which a commit never resolves.
   */
  committed(sourceId: string, position: SourceRecord["position"]): void {
    if (this.#queued.size > 0) {
      const key = positionKey(sourceId, position);
      if (this.#queued.has(key)) this.#queued.set(key, true);
    }
    if (!this.#watched.has(sourceId)) return;
    let open: IncidentRecord[];
    try {
      open = this.store.open(sourceId);
    } catch {
      return;
    }
    let remaining = 0;
    for (const incident of open) {
      if ((incident.progress === "held" || incident.progress === "retrying") && samePosition(incident.position, position)) {
        this.#update(incident, { progress: "processed", state: "resolved", resolution: "processed after retry" }, "resolved", "the original record processed successfully");
      } else {
        remaining++;
      }
    }
    if (remaining === 0) this.#watched.delete(sourceId);
  }

  /**
   * Checks a record about to be processed against open incidents. Reading a
   * later offset on the partition of a held record means the group position
   * moved without an advance this gateway recorded (retention removed the held
   * record, an offset reset, or another consumer committed): the source holds
   * instead of silently treating the gap as progress (F27, F30). An uncertain
   * advance (unconfirmed, or unexplained at startup) holds every record of the
   * source until a restart reconciles it (spec §6). Returns why, or null.
   */
  positionProblem(sourceId: string, position: SourceRecord["position"]): string | null {
    if (!this.#watched.has(sourceId) || position.kind !== "kafka") return null;
    let open: IncidentRecord[];
    try {
      open = this.store.open(sourceId);
    } catch (error) {
      return `the failure journal could not be read: ${(error as Error).message.slice(0, 200)}`;
    }
    const uncertain = open.find(incident => incident.progress === "uncertain");
    if (uncertain !== undefined) {
      return `incident ${uncertain.failureId} has an unresolved advance (uncertain); the source stays held until a restart reconciles it from the group's committed offset`;
    }
    for (const incident of open) {
      const held = incident.position;
      if (held.kind !== "kafka" || held.topic !== position.topic || held.partition !== position.partition) continue;
      if (!WATCHED_PROGRESS.has(incident.progress)) continue;
      if (BigInt(position.offset) <= BigInt(held.offset)) continue;
      const reason = `partition ${held.topic}/${held.partition} is at offset ${position.offset}, past the held record at offset ${held.offset}, with no recorded advance`;
      if (!incident.diagnosis.startsWith("Source progress moved")) {
        this.#update(incident, { diagnosis: `Source progress moved: ${reason}. The record may have expired or the group offset was changed outside StreamOtter.` }, "held", "position-moved");
      }
      return reason;
    }
    return null;
  }

  /**
   * The guarded form of resumeSource for a source with failure handling
   * (ADR-15C §6): it retries the held record and never skips it. Refused while an
   * advance is pending or uncertain, and while a quarantine-resync source's circuit is open.
   * Runs in the source's failure chain, so a disposition already queued for the
   * held record opens its incident before the retry marks it retrying.
   */
  beforeRetry(sourceId: string, reason: string): Promise<void> {
    return this.run(sourceId, () => this.#markRetrying(sourceId, reason));
  }

  #markRetrying(sourceId: string, reason: string): void {
    const open = this.store.open(sourceId);
    const blocking = open.find(incident => incident.progress === "advance-pending" || incident.progress === "uncertain");
    if (blocking !== undefined) {
      throw new StreamOtterError("SOURCE_UNAVAILABLE", {
        message: `Source "${sourceId}" has an unresolved advance for incident ${blocking.failureId}; it cannot be retried until that is reconciled.`,
        details: { status: 409, reason: "advance-unresolved" }
      });
    }
    const policy = this.policy(sourceId);
    const resync = policy.invalidJson === "quarantine-resync" || policy.invalidPublicPayload === "quarantine-resync";
    if (resync && open.length > 0 && this.store.circuit(sourceId).state === "open") {
      throw new StreamOtterError("SOURCE_UNAVAILABLE", {
        message: `Source "${sourceId}" has an open automatic-continuation circuit; reopen it after correcting the cause, then retry.`,
        details: { status: 409, reason: "circuit-open" }
      });
    }
    for (const incident of open) {
      if (incident.progress !== "held") continue;
      this.#update(incident, { progress: "retrying" }, "retrying", reason);
    }
  }

  async stop(): Promise<void> {
    await this.settled();
    await this.#quarantine?.stop();
    this.store.close();
  }

  // --- disposition ----------------------------------------------------------------

  async #dispose(source: FailureSource, input: SourceInput, outcome: Pause): Promise<void> {
    const key = positionKey(source.id, input.position);
    const processed = this.#queued.get(key) === true;
    this.#queued.delete(key);
    if (processed) {
      // A retry processed and committed the record before this disposition ran: the source is no longer paused at it.
      this.#logger.info("A held record processed before its failure was recorded; no incident is opened", { sourceId: source.id, failureClass: outcome.failureClass });
      return;
    }
    const failureClass = outcome.failureClass;
    const policy = policyFor(this.policy(source.id), failureClass);
    const raw = rawEvidence(input);
    const summary = this.#summarize(source, raw, policy);
    const failureId = `f1:${sourceRecordId(this.#config.projectId, source.id, source.config.generation, input.position)}`;
    const observedAt = nowIso();
    let record: IncidentRecord;
    try {
      const result = this.store.observe({
        failureId,
        sourceId: source.id,
        generation: source.config.generation,
        position: { ...input.position },
        clusterId: source.config.kind === "kafka" ? this.#clusterIds.get(source.id) ?? null : null,
        timestamp: input.timestamp ?? null,
        failureClass,
        stage: outcome.stage ?? (failureClass === "revision-conflict" ? "queue" : isValidateClass(failureClass) ? "validate" : "map"),
        errorCode: outcome.code,
        channel: outcome.channel ?? null,
        policy,
        diagnosis: outcome.diagnosis ?? defaultDiagnosis(failureClass, outcome.code),
        evidence: summary,
        fingerprints: this.#fingerprints,
        observedAt
      });
      this.#journalError = null;
      record = result.record;
      this.#watched.add(source.id);
      this.#emit(record, "detected", failureClass);
      if (result.conflict) {
        this.#update(record, { diagnosis: "The redelivered record's bytes differ from the evidence captured for the same position. This is an integrity failure: the source stays held and is never quarantined or skipped." }, "held", "evidence-conflict");
        return;
      }
      if (record.progress === "retrying") record = this.#update(record, { progress: "held" }, "held", "the retried record failed again");
    } catch (error) {
      this.#journalError = (error as Error).message;
      this.#logger.error("The failure journal could not record an incident; the source stays paused and nothing is skipped", {
        sourceId: source.id, failureClass, error: (error as Error).message.slice(0, 200)
      });
      return;
    }

    // Quarantine and continuation both name the record by its position, which another cluster does not share (ADR-15A §3).
    if (policy !== "pause" && this.#holdOnClusterMismatch(source, record)) return;
    if (policy === "pause") {
      if (record.recovery !== "not-applicable" || record.quarantine !== "not-required") return;
      this.#emit(record, "held", "pause policy");
      return;
    }

    // quarantine-hold stops at acknowledged evidence. quarantine-resync always writes a fresh acknowledged copy
    // before it may advance: an older acknowledgment may have expired (spec §6 step 4).
    if (record.quarantine === "acknowledged" && policy === "quarantine-hold") {
      this.#emit(record, "held", "evidence already quarantined");
      return;
    }
    if (summary.completeness !== "complete" || raw === null) {
      this.#update(record, { recovery: "held" }, "held", "evidence is incomplete, so it cannot be quarantined; repair and retry");
      return;
    }
    record = this.#update(record, { quarantine: "pending", recovery: "held" }, "captured", summary.location === "local" ? "local evidence" : "writing to the quarantine topic");
    const outcomeOfWrite = await this.#write(source, record, raw);
    switch (outcomeOfWrite.kind) {
      case "acknowledged": {
        const quarantined = this.#update(record, {
          quarantine: "acknowledged",
          quarantineCoordinates: outcomeOfWrite.partition < 0 ? null : { partition: outcomeOfWrite.partition, offset: outcomeOfWrite.offset }
        }, "quarantined", summary.location === "local" ? "stored as local fixture evidence, not Kafka" : `acknowledged at partition ${outcomeOfWrite.partition}`);
        if (policy === "quarantine-resync" && quarantined !== record) await this.#continue(source, quarantined);
        return;
      }
      case "unknown":
        this.#update(record, { quarantine: "unknown" }, "quarantine-unknown", outcomeOfWrite.reason);
        return;
      case "failed":
        this.#update(record, { quarantine: "failed" }, "held", `quarantine write refused: ${outcomeOfWrite.reason}`);
        return;
    }
  }

  // --- guarded continuation (quarantine-resync, ADR-15B) ----------------------------

  /**
   * After an acknowledged quarantine write: check the circuit, ask the recovery
   * guard, persist the cumulative boundary and the intent to advance in one
   * journal transaction, apply the boundary to the runtime, and only then move
   * the source offset past the record. Every failure leaves the record held.
   */
  async #continue(source: FailureSource, record: IncidentRecord): Promise<void> {
    const sourceId = source.id;
    const limit = this.policy(sourceId).automaticAdvanceLimit;
    let circuit;
    try {
      circuit = this.store.circuit(sourceId);
      const now = Date.now();
      const recent = circuit.advances.filter(at => now - Date.parse(at) < limit.windowMs);
      if (circuit.state === "open" || recent.length >= limit.incidents) {
        if (circuit.state !== "open") {
          circuit = this.store.updateCircuit(sourceId, circuit.revision, {
            state: "open", advances: recent, openedAt: nowIso(),
            reason: `${recent.length} distinct automatic advances within ${limit.windowMs} ms`
          });
          this.#logger.error("Automatic continuation stopped: the circuit breaker opened", { sourceId, advances: recent.length, windowMs: limit.windowMs });
        }
        this.#update(record, { recovery: "held" }, "held", "the automatic continuation circuit is open; reopen it after correcting the cause");
        return;
      }
    } catch (error) {
      this.#journalError = (error as Error).message;
      this.#update(record, { recovery: "held" }, "held", "the circuit state could not be read; the record stays held");
      return;
    }

    const guard = this.#guards[sourceId];
    if (guard === undefined) {
      this.#update(record, { recovery: "held" }, "held", "no recovery guard is registered for this source");
      return;
    }
    let prior: StoredBoundary | null;
    try {
      prior = this.store.boundary(sourceId);
    } catch (error) {
      this.#journalError = (error as Error).message;
      return;
    }
    if (prior !== null && prior.generation !== source.config.generation) prior = null;
    if (this.#holdOnClusterMismatch(source, record)) return;
    const pending = this.#update(record, { recovery: "guard-pending" }, "held", "running the recovery guard");
    if (pending === record) return;
    const outcome = await this.#runGuard(guard, source, pending, prior);
    if (this.#stopSignal.aborted) {
      this.#releaseGuard(pending, "the gateway stopped while the recovery guard ran; the record stays held");
      return;
    }

    // Recheck after the await: a stop, a newer observation or an operator action wins over this result (F18, F25).
    const current = this.store.get(pending.failureId);
    if (current === null || current.revision !== pending.revision || current.state !== "open" || current.progress !== "held") {
      this.#logger.warn("A recovery guard result arrived for an incident that changed meanwhile; it was ignored", { failureId: pending.failureId });
      return;
    }
    if (outcome.decision !== "recoverable") {
      const why = outcome.decision === "hold" ? `the recovery guard decided to hold: ${outcome.result.reason ?? ""}` : `the recovery guard ${outcome.decision === "timeout" ? "timed out" : "failed"}: ${outcome.result.reason ?? ""}`;
      this.#update(current, { recovery: outcome.decision === "hold" ? "denied" : "held", guard: outcome.result }, "held", why);
      return;
    }

    if (this.#holdOnClusterMismatch(source, current)) return;
    const boundaryId = `rb1:${randomBytes(16).toString("hex")}`;
    let prepared: IncidentRecord;
    try {
      prepared = this.store.prepareAdvance({
        failureId: current.failureId,
        expectedRevision: current.revision,
        boundary: { boundaryId, context: outcome.context, expectedPrior: prior?.boundaryId ?? null },
        guard: outcome.result,
        at: nowIso()
      }).record;
      this.#journalError = null;
    } catch (error) {
      if (error instanceof StaleRevisionError) {
        // The incident or the source's boundary changed since the guard ran; that change decides what happens next.
        this.#logger.warn("The advance was not prepared because the incident or boundary changed meanwhile", { failureId: current.failureId });
      } else {
        this.#journalError = (error as Error).message;
        this.#logger.error("The recovery boundary could not be persisted; the record stays held and the offset does not move", {
          failureId: current.failureId, error: (error as Error).message.slice(0, 200)
        });
      }
      this.#releaseGuard(current, "the advance could not be prepared; the record stays held");
      return;
    }
    this.#emit(prepared, "advance-pending", boundaryId);
    // Every snapshot from here on must acknowledge the new boundary, before any later record can be delivered.
    this.#onBoundary(sourceId, { id: boundaryId, context: outcome.context });

    await this.#hooks.beforeAdvance?.(prepared.failureId);
    const adapter = source.adapter;
    let result: Awaited<ReturnType<NonNullable<FailureSource["adapter"]>["advancePast"]>>;
    try {
      result = adapter === null ? "not-held" : await adapter.advancePast({ position: prepared.position });
    } catch {
      result = "uncertain";
    }
    if (result === "advanced") await this.#hooks.afterAdvance?.(prepared.failureId);
    switch (result) {
      case "advanced":
        this.#update(prepared, { progress: "advanced", state: "resolved", resolution: `advanced past under recovery boundary ${boundaryId}` },
          "advance-confirmed", "committed past the record and confirmed by read-back; snapshots must acknowledge the boundary");
        this.#emit(prepared, "snapshot-recovery-required", boundaryId);
        return;
      case "not-held":
        // Nothing was committed (stop or rebalance). The cumulative boundary stays in force, which only adds obligations.
        this.#update(prepared, { progress: "held" }, "held", "the source was no longer paused at this record; nothing was committed and it will be evaluated again");
        return;
      case "uncertain":
        this.#watched.add(sourceId);
        this.#update(prepared, { progress: "uncertain" }, "held", "the advance could not be confirmed; the source stays paused until it is reconciled");
        return;
    }
  }

  /**
   * Puts recovery back to "held" when the guard's turn ended without an
   * advance, so the incident does not read as guard-pending (which refuses
   * operator actions) after a stop or a failed prepare. Best effort: a journal
   * that cannot be written leaves it as it is, and a changed incident is left alone.
   */
  #releaseGuard(pending: IncidentRecord, detail: string): void {
    let current: IncidentRecord | null;
    try {
      current = this.store.get(pending.failureId);
    } catch {
      return;
    }
    if (current === null || current.revision !== pending.revision || current.recovery !== "guard-pending") return;
    this.#update(current, { recovery: "held" }, "held", detail);
  }

  /**
   * ADR-15A §3: an incident records the Kafka cluster it was captured on, and
   * the gateway never advances on another one, because the same coordinates may
   * name a different record there. Returns the integrity diagnosis, or null.
   */
  #clusterMismatch(source: FailureSource, incident: IncidentRecord): string | null {
    if (source.config.kind !== "kafka" || incident.clusterId === null) return null;
    const current = this.#clusterIds.get(source.id) ?? null;
    if (current === incident.clusterId) return null;
    return `Kafka cluster mismatch: the incident was captured on cluster ${incident.clusterId}, but the source now reads ${current === null ? "a cluster whose ID is unknown" : `cluster ${current}`}. The same position may name a different record, so this is an integrity failure: the source stays held and is never advanced. If the source moved to another cluster, change its generation and rebaseline.`;
  }

  /** Holds the incident with the cluster-mismatch diagnosis when there is one; true when it did. */
  #holdOnClusterMismatch(source: FailureSource, record: IncidentRecord): boolean {
    const mismatch = this.#clusterMismatch(source, record);
    if (mismatch === null) return false;
    this.#logger.error("The incident was captured on another Kafka cluster; the source stays held and is never advanced", { failureId: record.failureId, sourceId: source.id });
    this.#update(record, { diagnosis: mismatch, recovery: "held" }, "held", "cluster-mismatch");
    return true;
  }

  async #runGuard(guard: SourceRecoveryHandlers, source: FailureSource, record: IncidentRecord, prior: StoredBoundary | null): Promise<GuardOutcome> {
    const result = (decision: GuardResult["decision"], reason: string | null, evidenceRef: string | null = null): GuardResult =>
      ({ decision, reason: reason === null ? null : reason.slice(0, MAX_GUARD_TEXT), evidenceRef, at: nowIso() });
    const outcome = await invokeHandler(
      context => guard.recover({
        ...context,
        sourceId: source.id,
        generation: source.config.generation,
        incident: {
          failureId: record.failureId,
          failureClass: record.failureClass as "invalid-json" | "payload-schema",
          position: { ...record.position },
          evidenceHash: record.evidence.hash
        },
        prior: prior === null ? null : { id: prior.boundaryId, context: prior.context }
      }),
      { timeoutMs: GUARD_TIMEOUT_MS, requestId: newId(), parent: this.#stopSignal }
    );
    if (outcome.kind === "aborted") return { decision: "error", result: result("error", "cancelled because the gateway is stopping") };
    if (outcome.kind === "timeout") return { decision: "timeout", result: result("timeout", `no answer within ${GUARD_TIMEOUT_MS} ms`) };
    if (outcome.kind === "error") return { decision: "error", result: result("error", `recover threw ${JSON.stringify(describeError(outcome.error))}`) };
    const value: unknown = outcome.value;
    if (isPlainObject(value) && value["decision"] === "hold" && typeof value["reason"] === "string") {
      return { decision: "hold", result: result("hold", value["reason"]) };
    }
    if (isPlainObject(value) && value["decision"] === "recoverable") {
      const context = value["context"];
      const evidenceRef = value["evidenceRef"];
      if (!isJsonValue(context)) return { decision: "error", result: result("error", "recover returned a context that is not JSON") };
      if (Buffer.byteLength(canonicalJson(context)) > MAX_RECOVERY_CONTEXT_BYTES) {
        return { decision: "error", result: result("error", `recover returned a context above ${MAX_RECOVERY_CONTEXT_BYTES} bytes`) };
      }
      if (typeof evidenceRef !== "string" || evidenceRef.length === 0 || evidenceRef.length > MAX_GUARD_TEXT) {
        return { decision: "error", result: result("error", "recover must return an evidenceRef of 1 to 512 characters") };
      }
      return { decision: "recoverable", context, result: result("recoverable", null, evidenceRef) };
    }
    return { decision: "error", result: result("error", "recover returned neither {decision: \"hold\", reason} nor {decision: \"recoverable\", context, evidenceRef}") };
  }

  /**
   * A snapshot acknowledged the source's boundary. With boundaryRetirement
   * "application", ask the application whether the boundary can retire; the
   * store refuses while any of its incidents is still held (ADR-15B §4).
   * Serialized with the source's other failure work.
   */
  acknowledged(sourceId: string, boundaryId: string): void {
    const policy = this.#policies.get(sourceId);
    const retire = this.#guards[sourceId]?.retire;
    if (policy?.boundaryRetirement !== "application" || retire === undefined || this.#retiring.has(sourceId)) return;
    this.#retiring.add(sourceId);
    const previous = this.#chains.get(sourceId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const boundary = this.store.getBoundary(boundaryId);
      if (boundary === null || boundary.state !== "in-force") return;
      const outcome = await invokeHandler(
        context => retire({ ...context, sourceId, boundary: { id: boundary.boundaryId, context: boundary.context } }),
        { timeoutMs: GUARD_TIMEOUT_MS, requestId: newId(), parent: this.#stopSignal }
      );
      if (outcome.kind !== "ok" || outcome.value !== true) {
        if (outcome.kind === "error" || outcome.kind === "timeout") this.#logger.warn("The boundary retire handler did not answer; the boundary stays in force", { sourceId, boundaryId, outcome: outcome.kind });
        return;
      }
      try {
        this.store.retireBoundary(boundaryId, boundary.revision, { mode: "application", reason: "retire() returned true after an acknowledged snapshot", operationId: null });
      } catch (error) {
        this.#logger.info("The boundary was not retired", { sourceId, boundaryId, reason: (error as Error).message.slice(0, 200) });
        return;
      }
      if (this.store.boundary(sourceId) === null) this.#onBoundary(sourceId, null);
      this.#logger.info("Recovery boundary retired by the application", { sourceId, boundaryId });
    }).catch(error => {
      this.#logger.error("Boundary retirement failed", { sourceId, error: (error as Error).name });
    }).finally(() => { this.#retiring.delete(sourceId); });
    this.#chains.set(sourceId, next);
  }

  async #write(source: FailureSource, record: IncidentRecord, raw: RawEvidence): Promise<QuarantineOutcome> {
    if (source.config.kind === "fixture") {
      try {
        this.store.putEvidence(record.failureId, raw);
        return { kind: "acknowledged", partition: -1, offset: "-1" };
      } catch (error) {
        return { kind: "failed", reason: (error as Error).message };
      }
    }
    if (this.#quarantine === null) return { kind: "failed", reason: "no quarantine topic is configured" };
    return this.#quarantine.publish({ failureId: record.failureId, envelope: JSON.stringify(this.#envelope(record)), evidence: raw });
  }

  /** The spec §5.2 metadata, as compact JSON for the envelope header. Never includes payload bytes. */
  #envelope(record: IncidentRecord): Json {
    const position = record.position;
    return {
      envelopeVersion: 1,
      projectId: this.#config.projectId,
      sourceId: record.sourceId,
      generation: record.generation,
      sourceRecordId: record.failureId.slice(3),
      failureId: record.failureId,
      position: position.kind === "kafka"
        ? { clusterId: record.clusterId, topic: position.topic, partition: position.partition, offset: position.offset }
        : { fixtureIndex: position.index },
      timestamp: record.timestamp,
      evidence: { ...record.evidence },
      diagnosis: {
        failureClass: record.failureClass, stage: record.stage, code: record.errorCode, channel: record.channel,
        observedAt: record.firstObservedAt, impact: "source-wide"
      },
      provenance: { ...record.fingerprints }
    } as Json;
  }

  #summarize(source: FailureSource, raw: RawEvidence | null, policy: FailurePolicy): EvidenceSummary {
    const location = policy === "pause" ? "none" : source.config.kind === "fixture" ? "local" : "kafka";
    if (raw === null) return { location: "none", completeness: "unavailable", valueBytes: null, keyBytes: null, headerCount: 0, hash: "" };
    const complete = (raw.value?.byteLength ?? 0) <= this.#maxSourceRecordBytes && keyAndHeaderBytes(raw) <= MAX_CAPTURED_KEY_AND_HEADER_BYTES;
    return {
      location,
      completeness: complete ? "complete" : "incomplete",
      valueBytes: raw.value?.byteLength ?? null,
      keyBytes: raw.key?.byteLength ?? null,
      headerCount: raw.headers.length,
      hash: evidenceHash(raw)
    };
  }

  #update(record: IncidentRecord, patch: Parameters<IncidentStore["update"]>[2], event: IncidentEventName, detail: string): IncidentRecord {
    try {
      const updated = this.store.update(record.failureId, record.revision, patch, { event, detail, operationId: null });
      this.#emit(updated, event, detail);
      return updated;
    } catch (error) {
      this.#journalError = (error as Error).message;
      this.#logger.error("The failure journal could not record a state change; the source stays paused", {
        failureId: record.failureId, event, error: (error as Error).message.slice(0, 200)
      });
      return record;
    }
  }

  /** Structured lifecycle event (spec §11.2): metadata only, never payloads. */
  #emit(record: IncidentRecord, event: IncidentEventName, detail: string): void {
    this.#logger.info("Source failure", { failureId: record.failureId, sourceId: record.sourceId, event, detail: detail.slice(0, 200), revision: record.revision });
  }
}

function isValidateClass(failureClass: FailureClass): boolean {
  return failureClass === "invalid-json" || failureClass === "tombstone" || failureClass === "oversize";
}

function defaultDiagnosis(failureClass: FailureClass, code: ErrorCode): string {
  return `${failureClass} (${code})`;
}

/** The record's original bytes as the adapter saw them. A fixture JSON value is encoded as UTF-8 JSON. */
function rawEvidence(input: SourceInput): RawEvidence | null {
  const encoder = new TextEncoder();
  const key = input.keyBytes !== undefined ? input.keyBytes : input.key === null ? null : encoder.encode(input.key);
  let value: Uint8Array | null;
  if (input.bytes !== undefined) value = input.bytes;
  else if (input.value !== undefined) value = encoder.encode(JSON.stringify(input.value));
  else return null;
  return { key: key === null ? null : new Uint8Array(key), value: value === null ? null : new Uint8Array(value), headers: (input.headers ?? []).map(header => ({ name: header.name, value: new Uint8Array(header.value) })) };
}

function positionKey(sourceId: string, position: SourceRecord["position"]): string {
  return position.kind === "kafka" ? `${sourceId}\u0000${position.topic}\u0000${position.partition}\u0000${position.offset}` : `${sourceId}\u0000${position.index}`;
}

function samePosition(a: SourceRecord["position"], b: SourceRecord["position"]): boolean {
  if (a.kind === "fixture" && b.kind === "fixture") return a.index === b.index;
  if (a.kind === "kafka" && b.kind === "kafka") return a.topic === b.topic && a.partition === b.partition && a.offset === b.offset;
  return false;
}
