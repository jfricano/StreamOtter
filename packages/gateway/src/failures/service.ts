import { readFileSync } from "node:fs";
import {
  policyFor, resolveSourcePolicy, StreamOtterError,
  type ErrorCode, type FailureClass, type FailurePolicy, type GatewayLogger, type Json, type ProjectConfig,
  type ResolvedSourcePolicy, type SourceRecord
} from "@streamotter/contracts";
import { sourceRecordId } from "../runtime/identity.ts";
import { nowIso, sha256Hex } from "../runtime/util.ts";
import type { ProcessOutcome, SourceAdapter, SourceInput } from "../sources/types.ts";
import { evidenceHash, keyAndHeaderBytes, MAX_CAPTURED_KEY_AND_HEADER_BYTES } from "./evidence.ts";
import type { QuarantineOutcome, QuarantineWriter } from "./quarantine.ts";
import type { EvidenceSummary, IncidentEventName, IncidentRecord, IncidentStore, RawEvidence } from "./store.ts";

/** What the failure service needs to know about one source. */
export interface FailureSource {
  readonly id: string;
  readonly config: ProjectConfig["sources"][string];
  readonly adapter: SourceAdapter | null;
}

type Pause = Extract<ProcessOutcome, { kind: "pause" }>;

let cachedVersion: string | null = null;
function gatewayVersion(): string {
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
  readonly #policies = new Map<string, ResolvedSourcePolicy>();
  /** Sources with an incident that a later successful commit could resolve; keeps the commit path cheap. */
  readonly #watched = new Set<string>();
  readonly #clusterIds = new Map<string, string>();
  /** Set when a journal write failed; readiness reports it until a later write succeeds. */
  #journalError: string | null = null;

  constructor(options: {
    config: ProjectConfig;
    store: IncidentStore;
    logger: GatewayLogger;
    quarantine: QuarantineWriter | null;
    configFingerprint: string;
    handlerBuildId: string;
    maxSourceRecordBytes: number;
  }) {
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
  start(sources: Iterable<FailureSource>): void {
    for (const source of sources) {
      const open = this.store.open(source.id);
      const stale = open.find(incident => incident.generation !== source.config.generation);
      if (stale !== undefined) {
        throw new StreamOtterError("CONFIG_INVALID", {
          message: `Source "${source.id}" has an open incident (${stale.failureId}) from generation "${stale.generation}", but the configuration names generation "${source.config.generation}". Resolve or rebaseline the open incidents before changing the generation.`
        });
      }
      if (open.some(incident => incident.progress === "held" || incident.progress === "retrying")) this.#watched.add(source.id);
    }
  }

  policy(sourceId: string): ResolvedSourcePolicy {
    return this.#policies.get(sourceId) ?? resolveSourcePolicy(undefined, sourceId);
  }

  /** Called by the adapter once it is paused at the failing record. Serialized per source. */
  held(source: FailureSource, input: SourceInput, outcome: Pause): Promise<void> {
    const previous = this.#chains.get(source.id) ?? Promise.resolve();
    const next = previous.then(() => this.#dispose(source, input, outcome)).catch(error => {
      this.#logger.error("Failure handling stopped with an unexpected error; the source stays paused", { sourceId: source.id, error: (error as Error).name });
    });
    this.#chains.set(source.id, next);
    return next;
  }

  /** Resolves when every queued disposition has finished; for tests and shutdown. */
  async settled(): Promise<void> {
    await Promise.all(this.#chains.values());
  }

  /**
   * A record at a held position was processed and committed after a retry or a
   * restart. The incident is resolved as processed; nothing was skipped.
   */
  committed(sourceId: string, position: SourceRecord["position"]): void {
    if (!this.#watched.has(sourceId)) return;
    let open: IncidentRecord[];
    try {
      open = this.store.open(sourceId);
    } catch {
      return;
    }
    let remaining = 0;
    for (const incident of open) {
      if (incident.progress !== "held" && incident.progress !== "retrying") continue;
      if (!samePosition(incident.position, position)) {
        remaining++;
        continue;
      }
      this.#update(incident, { progress: "processed", state: "resolved", resolution: "processed after retry" }, "resolved", "the original record processed successfully");
    }
    if (remaining === 0) this.#watched.delete(sourceId);
  }

  /**
   * Checks a record about to be processed against open incidents. Reading a
   * later offset on the partition of a held record means the group position
   * moved without an advance this gateway recorded (retention removed the held
   * record, an offset reset, or another consumer committed): the source holds
   * instead of silently treating the gap as progress (F27, F30). Returns why, or null.
   */
  positionProblem(sourceId: string, position: SourceRecord["position"]): string | null {
    if (!this.#watched.has(sourceId) || position.kind !== "kafka") return null;
    let open: IncidentRecord[];
    try {
      open = this.store.open(sourceId);
    } catch (error) {
      return `the failure journal could not be read: ${(error as Error).message.slice(0, 200)}`;
    }
    for (const incident of open) {
      const held = incident.position;
      if (held.kind !== "kafka" || held.topic !== position.topic || held.partition !== position.partition) continue;
      if (incident.progress !== "held" && incident.progress !== "retrying") continue;
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
   * advance is pending or uncertain.
   */
  beforeRetry(sourceId: string, reason: string): void {
    const open = this.store.open(sourceId);
    const blocking = open.find(incident => incident.progress === "advance-pending" || incident.progress === "uncertain");
    if (blocking !== undefined) {
      throw new StreamOtterError("SOURCE_UNAVAILABLE", {
        message: `Source "${sourceId}" has an unresolved advance for incident ${blocking.failureId}; it cannot be retried until that is reconciled.`,
        details: { status: 409, reason: "advance-unresolved" }
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

    if (policy === "pause") {
      if (record.recovery !== "not-applicable" || record.quarantine !== "not-required") return;
      this.#emit(record, "held", "pause policy");
      return;
    }

    // quarantine-hold (quarantine-resync continues in slice C; until then construction refuses it).
    if (record.quarantine === "acknowledged") {
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
      case "acknowledged":
        this.#update(record, {
          quarantine: "acknowledged",
          quarantineCoordinates: outcomeOfWrite.partition < 0 ? null : { partition: outcomeOfWrite.partition, offset: outcomeOfWrite.offset }
        }, "quarantined", summary.location === "local" ? "stored as local fixture evidence, not Kafka" : `acknowledged at partition ${outcomeOfWrite.partition}`);
        return;
      case "unknown":
        this.#update(record, { quarantine: "unknown" }, "quarantine-unknown", outcomeOfWrite.reason);
        return;
      case "failed":
        this.#update(record, { quarantine: "failed" }, "held", `quarantine write refused: ${outcomeOfWrite.reason}`);
        return;
    }
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

function samePosition(a: SourceRecord["position"], b: SourceRecord["position"]): boolean {
  if (a.kind === "fixture" && b.kind === "fixture") return a.index === b.index;
  if (a.kind === "kafka" && b.kind === "kafka") return a.topic === b.topic && a.partition === b.partition && a.offset === b.offset;
  return false;
}
