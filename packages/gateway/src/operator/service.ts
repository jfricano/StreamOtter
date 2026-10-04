import { randomBytes } from "node:crypto";
import {
  PLAN_TTL_MS, QUARANTINE_ELIGIBLE_CLASSES, StreamOtterError, validateOperatorRequest,
  type EvaluateRequest, type EvaluationResult, type ExportFailureRequest, type FailureClass, type Gateway, type GatewayLogger,
  type IncidentDetail, type IncidentNextAction, type IncidentSummary, type Json, type ListFailuresRequest, type OperationResult,
  type OperatorApi, type OperatorSourceStatus, type OperatorStatus, type Page, type ProjectConfig, type RawEvidenceView,
  type ReassessRequest, type RedriveRequest, type ReopenCircuitRequest, type ReproductionBundle, type ResolvedSourcePolicy,
  type RetireBoundaryRequest, type RetryCurrentRequest, type ShowFailureRequest, type SourceRecord, type SourceStatus, type Trace
} from "@streamotter/contracts";
import { evidenceHash } from "../failures/evidence.ts";
import type { QuarantineReader, QuarantineTopicReport } from "../failures/quarantine.ts";
import { gatewayVersion, type BoundaryInForce, type FailureService } from "../failures/service.ts";
import { StaleRevisionError, type CircuitState, type IncidentRecord, type OperationKind, type RawEvidence, type StoredOperation } from "../failures/store.ts";
import { getGatewayInternals, type OperatorPrepared, type RedriveOutcome } from "../runtime/gateway.ts";
import type { TraceQuery } from "../runtime/traces.ts";
import { nowIso, sha256Hex } from "../runtime/util.ts";

/** The operator service of a running gateway with failure handling (ADR-15C §1). */
export function getGatewayOperator(gateway: Gateway): OperatorApi {
  const operator = getGatewayInternals(gateway).operator();
  if (operator === null) {
    throw new StreamOtterError("UNSUPPORTED_CAPABILITY", { message: "This gateway has no failure handling configured, so it has no operator service." });
  }
  return operator;
}

/** What the operator service needs from the gateway runtime. */
export interface OperatorHost {
  readonly mode: "development" | "production";
  readonly config: ProjectConfig;
  readonly fingerprint: string;
  readonly handlerBuildId: string;
  readonly logger: GatewayLogger;
  state(): string;
  source(sourceId: string): SourceStatus | null;
  traces(query: TraceQuery): Page<Trace>;
  quarantineReport(): QuarantineTopicReport | null;
  quarantineReader(): QuarantineReader | null;
  /** The guarded resume of a paused source (ADR-15C §6): retries the held record, never skips it. */
  retry(sourceId: string): Promise<void>;
  evaluateRecord(sourceId: string, raw: RawEvidence, position: SourceRecord["position"]): Promise<OperatorPrepared>;
  redriveRecord(sourceId: string, raw: RawEvidence, position: SourceRecord["position"], expectedOutputHash: string): Promise<RedriveOutcome>;
  setBoundary(sourceId: string, boundary: BoundaryInForce): void;
}

/** Test-only instrumentation for crash and lost-response tests (F35). */
export interface OperatorHooks {
  /** Awaited after an operation's intent is recorded and before it acts. */
  afterIntent?: (operationId: string, kind: OperationKind) => Promise<void>;
}

/** How long a retry or reassess waits for the redelivered record to settle before reporting "retrying". */
export const SETTLE_TIMEOUT_MS = 15_000;
const MAX_PLANS = 64;
const MAX_CONCURRENT_EVALUATIONS = 2;
const HISTORY_LIMIT = 50;
const BUNDLE_TRACE_LIMIT = 50;

interface Plan {
  planId: string;
  failureId: string;
  sourceId: string;
  incidentRevision: number;
  generation: string;
  evidenceHash: string;
  outputHash: string;
  fingerprint: string;
  expiresAtMs: number;
}

type Evidence =
  | { kind: "found"; raw: RawEvidence }
  | { kind: "missing"; reason: "evidence-unavailable" | "evidence-expired"; message: string };

type Draft = Omit<OperationResult, "operationId">;

const refused = (outcome: string, message: string, incidentRevision: number | null = null): Draft =>
  ({ result: "refused", outcome, incidentRevision, message });

/**
 * One operator service per gateway (ADR-15C §1): the in-process API, the local
 * socket and the development routes all call this. Reads are metadata unless raw
 * evidence is explicitly requested. Every mutation names the incident (or
 * circuit, or boundary) revision it expects, records its intent before acting
 * and its result after, and reports refusals as results, never exceptions.
 */
export class OperatorService implements OperatorApi {
  readonly #host: OperatorHost;
  readonly #failures: FailureService;
  readonly #hooks: OperatorHooks;
  readonly #plans = new Map<string, Plan>();
  #evaluations = 0;

  constructor(host: OperatorHost, failures: FailureService, hooks: OperatorHooks = {}) {
    this.#host = host;
    this.#failures = failures;
    this.#hooks = hooks;
    // A crash between an operation's intent and its result leaves it pending; it can only be reported as unknown (spec §8.3, F35).
    for (const operation of failures.store.abandonPendingOperations(nowIso())) {
      host.logger.warn("An operator operation was interrupted by a restart; its outcome is unknown and it is not rerun", {
        operationId: operation.operationId, kind: operation.kind, sourceId: operation.sourceId
      });
    }
  }

  // --- reads ------------------------------------------------------------------------

  async status(): Promise<OperatorStatus> {
    const store = this.#failures.store;
    const usage = store.usage();
    const report = this.#host.quarantineReport();
    const topic = this.#host.config.failureHandling?.quarantine?.topic ?? null;
    return {
      gateway: {
        mode: this.#host.mode, version: gatewayVersion(), configFingerprint: this.#host.fingerprint,
        handlerBuildId: this.#host.handlerBuildId, state: this.#host.state()
      },
      store: {
        kind: store.kind, durable: store.kind === "sqlite", path: store.path, sizeBytes: usage.sizeBytes, limitBytes: usage.limitBytes, schemaVersion: usage.schemaVersion
      },
      quarantine: topic === null ? null : {
        topic, maxMessageBytes: report?.maxMessageBytes ?? null, minInsyncReplicas: report?.minInsyncReplicas ?? null, replicationFactor: report?.replicationFactor ?? null
      },
      sources: Object.keys(this.#host.config.sources).map(sourceId => this.#sourceStatus(sourceId))
    };
  }

  async listFailures(request: ListFailuresRequest): Promise<Page<IncidentSummary>> {
    const query = validateOperatorRequest("listFailures", request);
    const page = this.#failures.store.list(query);
    const circuits = new Map<string, CircuitState>();
    const circuitOf = (sourceId: string) => {
      let circuit = circuits.get(sourceId);
      if (circuit === undefined) circuits.set(sourceId, circuit = this.#failures.store.circuit(sourceId));
      return circuit;
    };
    return { items: page.items.map(record => this.#summary(record, circuitOf(record.sourceId))), nextCursor: page.nextCursor };
  }

  async showFailure(request: ShowFailureRequest): Promise<IncidentDetail & { raw?: RawEvidenceView }> {
    const { failureId, includeRaw } = validateOperatorRequest("showFailure", request);
    const record = this.#require(failureId);
    const detail = this.#detail(record);
    if (includeRaw !== true) return detail;
    return { ...detail, raw: rawView(await this.#evidence(record)) };
  }

  async exportFailure(request: ExportFailureRequest): Promise<ReproductionBundle> {
    const { failureId, includeRaw } = validateOperatorRequest("exportFailure", request);
    const record = this.#require(failureId);
    const incident = this.#detail(record);
    const evidence = includeRaw === true ? await this.#evidence(record) : null;
    const bundle: ReproductionBundle = {
      bundleVersion: 1,
      createdAt: nowIso(),
      gateway: { mode: this.#host.mode, version: gatewayVersion(), configFingerprint: this.#host.fingerprint, handlerBuildId: this.#host.handlerBuildId },
      incident,
      traces: this.#host.traces({ sourceId: record.sourceId, limit: BUNDLE_TRACE_LIMIT }).items,
      policy: policySummary(this.#failures.policy(record.sourceId)),
      expectedBehavior: expectedBehavior(record.failureClass),
      remedy: incident.explanation.nextAction,
      evidence: {
        included: evidence?.kind === "found",
        location: record.evidence.location,
        completeness: record.evidence.completeness,
        note: evidence === null
          ? "Original bytes are not included. Export with includeRaw to add them; they may contain production data."
          : evidence.kind === "found" ? "Original bytes are included as base64. Treat them as untrusted data." : evidence.message
      }
    };
    if (evidence !== null) bundle.raw = rawView(evidence);
    return bundle;
  }

  // --- evaluation and redrive (ADR-15C §5) ---------------------------------------------

  async evaluate(request: EvaluateRequest): Promise<EvaluationResult> {
    const { failureId, expectedRevision } = validateOperatorRequest("evaluate", request);
    const ineligible = (stage: string, reason: string, message: string): EvaluationResult =>
      ({ validation: "invalid", errors: [{ stage, failureClass: null, message }], outputs: [], eligible: false, ineligibleReason: reason, plan: null });
    const record = this.#failures.store.get(failureId);
    if (record === null) return ineligible("request", "not-found", `No incident ${failureId}.`);
    if (record.revision !== expectedRevision) return ineligible("request", "stale-revision", `Incident ${failureId} is at revision ${record.revision}, not ${expectedRevision}.`);
    const generation = this.#host.config.sources[record.sourceId]?.generation;
    if (generation !== record.generation) {
      return ineligible("request", "generation-changed", `The incident is from source generation "${record.generation}"; the source is now "${generation ?? "(removed)"}". Its position no longer names the same record.`);
    }
    if (this.#evaluations >= MAX_CONCURRENT_EVALUATIONS) throw new StreamOtterError("OVERLOADED", { message: "Too many evaluations are running; try again shortly." });
    this.#evaluations++;
    try {
      const evidence = await this.#evidence(record);
      if (evidence.kind === "missing") return ineligible("evidence", evidence.reason, evidence.message);
      const prepared = await this.#host.evaluateRecord(record.sourceId, evidence.raw, record.position);
      if (prepared.kind === "abandon") throw new StreamOtterError("SOURCE_UNAVAILABLE", { message: "The gateway is stopping; nothing was evaluated." });
      if (prepared.kind === "problem") {
        return {
          validation: "invalid",
          errors: [{ stage: prepared.stage, failureClass: prepared.failureClass, message: prepared.reason }],
          outputs: [],
          eligible: false,
          ineligibleReason: "still-fails",
          plan: null
        };
      }
      const outputs = prepared.outputs.map(output => ({ channel: output.channel, channelVersion: output.channelVersion, routing: "privileged" as const, revision: output.revision }));
      const blocked = this.#redriveBlocker(record);
      if (blocked !== null) return { validation: "valid", errors: [], outputs, eligible: false, ineligibleReason: blocked.outcome, plan: null };
      const plan = this.#issuePlan(record, prepared.outputs, prepared.outputHash);
      return { validation: "valid", errors: [], outputs, eligible: true, ineligibleReason: null, plan: { planId: plan.planId, fingerprint: plan.fingerprint, expiresAt: new Date(plan.expiresAtMs).toISOString() } };
    } finally {
      this.#evaluations--;
    }
  }

  async redrive(request: RedriveRequest): Promise<OperationResult> {
    const input = validateOperatorRequest("redrive", request);
    const record = this.#failures.store.get(input.failureId);
    // An unknown incident has no source to journal the operation under; it is refused before anything is recorded.
    if (record === null) return { operationId: input.operationId ?? `op1:${randomBytes(16).toString("hex")}`, ...refused("not-found", `No incident ${input.failureId}.`) };
    const { operationId: _supplied, ...rest } = input;
    return this.#mutate("redrive", record.sourceId, input.failureId, rest, input.operationId, async operationId => {
      const plan = this.#plans.get(input.planId);
      if (plan === undefined) return refused("plan-unknown", "No such plan, or it was already used. Plans are single use, kept in memory for 5 minutes and end when the gateway restarts; evaluate again.");
      if (plan.failureId !== input.failureId) return refused("plan-mismatch", "That plan was issued for a different incident.");
      if (Date.now() >= plan.expiresAtMs) {
        this.#plans.delete(plan.planId);
        return refused("plan-expired", "The plan expired; evaluate again and approve the new plan.");
      }
      if (plan.fingerprint !== input.planFingerprint) return refused("fingerprint-changed", "The plan fingerprint does not match the approved plan.");
      const current = this.#failures.store.get(input.failureId);
      if (current === null) return refused("not-found", `No incident ${input.failureId}.`);
      if (current.revision !== input.expectedRevision || current.revision !== plan.incidentRevision) {
        return refused("stale-revision", `Incident ${current.failureId} is at revision ${current.revision}; the plan was issued at ${plan.incidentRevision}. Evaluate again.`, current.revision);
      }
      if (this.#host.config.sources[current.sourceId]?.generation !== plan.generation) return refused("generation-changed", "The source generation changed since the plan was issued.", current.revision);
      const blocked = this.#redriveBlocker(current);
      if (blocked !== null) return { ...blocked, incidentRevision: current.revision };
      // A plan approves exactly one redrive. It is claimed here, before the first await, together with every other
      // plan of this incident (all issued at this revision, which the redrive's own operator event supersedes), so a
      // concurrent redrive of the incident finds no plan (plan-unknown) instead of mapping and admitting the record twice.
      for (const [planId, other] of this.#plans) if (other.failureId === plan.failureId) this.#plans.delete(planId);
      const evidence = await this.#evidence(current);
      if (evidence.kind === "missing") return refused(evidence.reason, evidence.message, current.revision);
      if (evidenceHash(evidence.raw) !== plan.evidenceHash) return refused("fingerprint-changed", "The stored evidence changed since the plan was issued.", current.revision);
      const latest = this.#failures.store.get(current.failureId);
      if (latest === null || latest.revision !== current.revision) {
        return refused("stale-revision", `Incident ${current.failureId} changed while the redrive was being prepared; evaluate again.`, latest?.revision ?? null);
      }
      await this.#hooks.afterIntent?.(operationId, "redrive");
      const outcome = await this.#host.redriveRecord(current.sourceId, evidence.raw, current.position, plan.outputHash);
      const draft = redriveResult(outcome, current.revision);
      return { ...draft, incidentRevision: this.#note(current, operationId, `redrive: ${draft.outcome}`) ?? current.revision };
    });
  }

  // --- source mutations ------------------------------------------------------------------

  async retryCurrent(request: RetryCurrentRequest): Promise<OperationResult> {
    const input = validateOperatorRequest("retryCurrent", request);
    return this.#mutate("retry-current", input.sourceId, input.failureId, input, undefined, async operationId => {
      const checked = this.#heldIncident(input.sourceId, input.failureId, input.expectedRevision);
      if ("result" in checked) return checked;
      const policy = this.#failures.policy(input.sourceId);
      if (usesResync(policy) && this.#failures.store.circuit(input.sourceId).state === "open") {
        return refused("circuit-open", "The source's automatic-continuation circuit is open. Reopen it after correcting the cause, then retry.", checked.revision);
      }
      return this.#redeliver(checked, operationId, `retry-current${input.reason === undefined ? "" : `: ${input.reason}`}`);
    });
  }

  async reassess(request: ReassessRequest): Promise<OperationResult> {
    const input = validateOperatorRequest("reassess", request);
    return this.#mutate("reassess", input.sourceId, input.failureId, input, undefined, async operationId => {
      const checked = this.#heldIncident(input.sourceId, input.failureId, input.expectedRevision);
      if ("result" in checked) return checked;
      if (!QUARANTINE_ELIGIBLE_CLASSES.includes(checked.failureClass)) {
        return refused("integrity-class", `${checked.failureClass} is an integrity failure; it is never skipped. Repair the cause and retry.`, checked.revision);
      }
      if (checked.policy !== "quarantine-resync") {
        return refused("policy-not-resync", `The policy for this incident is ${checked.policy}; only quarantine-resync incidents have a recovery guard to reassess.`, checked.revision);
      }
      if (checked.recovery !== "held" && checked.recovery !== "denied") {
        return refused("not-held", `Recovery is ${checked.recovery}; only a held or denied recovery can be reassessed.`, checked.revision);
      }
      if (this.#failures.store.circuit(input.sourceId).state === "open") {
        return refused("circuit-open", "The automatic-continuation circuit is open. Reopen it after correcting the cause, then reassess.", checked.revision);
      }
      // Reassessment redelivers the held record: a fresh quarantine copy is written and acknowledged, then the guard runs again (spec §6 step 4).
      return this.#redeliver(checked, operationId, "reassess: run the recovery guard again");
    });
  }

  async reopenCircuit(request: ReopenCircuitRequest): Promise<OperationResult> {
    const input = validateOperatorRequest("reopenCircuit", request);
    return this.#mutate("reopen-circuit", input.sourceId, null, input, undefined, () => this.#failures.run(input.sourceId, async () => {
      if (this.#host.source(input.sourceId) === null) return refused("not-found", `Unknown source "${input.sourceId}".`);
      const circuit = this.#failures.store.circuit(input.sourceId);
      if (circuit.revision !== input.expectedCircuitRevision) {
        return refused("stale-revision", `The circuit is at revision ${circuit.revision}, not ${input.expectedCircuitRevision}.`);
      }
      if (circuit.state !== "open") return refused("circuit-closed", "The circuit is already closed.");
      try {
        this.#failures.store.updateCircuit(input.sourceId, circuit.revision, { state: "closed", advances: [], openedAt: null, reason: `reopened by an operator: ${input.reason}` });
      } catch (error) {
        if (error instanceof StaleRevisionError) return refused("stale-revision", error.message);
        throw error;
      }
      this.#host.logger.warn("Automatic-continuation circuit reopened by an operator", { sourceId: input.sourceId });
      return {
        result: "completed",
        outcome: "circuit-reopened",
        incidentRevision: null,
        message: "The circuit is closed. Records already held stay held until they are reassessed or retried; nothing was approved."
      };
    }));
  }

  async retireBoundary(request: RetireBoundaryRequest): Promise<OperationResult> {
    const input = validateOperatorRequest("retireBoundary", request);
    return this.#mutate("retire-boundary", input.sourceId, null, input, undefined, operationId => this.#failures.run(input.sourceId, async () => {
      if (this.#host.source(input.sourceId) === null) return refused("not-found", `Unknown source "${input.sourceId}".`);
      const mode = this.#failures.policy(input.sourceId).boundaryRetirement;
      if (mode !== "operator") {
        return refused("retirement-mode", `Source "${input.sourceId}" retires boundaries by ${mode}; operator retirement must be enabled with boundaryRetirement "operator" (ADR-15B §4).`);
      }
      const boundary = this.#failures.store.getBoundary(input.boundaryId);
      if (boundary === null || boundary.sourceId !== input.sourceId) return refused("not-found", `No boundary ${input.boundaryId} on source "${input.sourceId}".`);
      try {
        this.#failures.store.retireBoundary(input.boundaryId, input.expectedRevision, { mode: "operator", reason: input.reason, operationId });
      } catch (error) {
        if (error instanceof StaleRevisionError) return refused("stale-revision", error.message);
        const reason = error instanceof StreamOtterError ? error.details?.["reason"] : undefined;
        if (typeof reason === "string") return refused(reason, (error as Error).message);
        throw error;
      }
      if (this.#failures.store.boundary(input.sourceId) === null) this.#host.setBoundary(input.sourceId, null);
      this.#host.logger.warn("Recovery boundary retired by an operator; snapshots no longer acknowledge it", { sourceId: input.sourceId, boundaryId: input.boundaryId, operationId });
      return {
        result: "completed",
        outcome: "boundary-retired",
        incidentRevision: null,
        message: "The boundary is retired. Snapshots no longer have to acknowledge it; StreamOtter cannot check that they reflect the quarantined record."
      };
    }));
  }

  // --- internals -----------------------------------------------------------------------

  /**
   * Records intent, acts, and records the result (spec §8.3). A caller-supplied
   * operation ID that already completed returns its recorded result; one left
   * pending by a crash is unknown and never rerun.
   */
  async #mutate(kind: OperationKind, sourceId: string, failureId: string | null, request: object, suppliedId: string | undefined,
    act: (operationId: string) => Promise<Draft>): Promise<OperationResult> {
    const operationId = suppliedId ?? `op1:${randomBytes(16).toString("hex")}`;
    const requestHash = `sha256:${sha256Hex({ kind, request: request as Json })}`;
    let begun: { operation: StoredOperation; created: boolean };
    try {
      begun = this.#failures.store.beginOperation({ operationId, kind, sourceId, failureId, requestHash, at: nowIso() });
    } catch (error) {
      return { operationId, result: "refused", outcome: "journal-unavailable", incidentRevision: null, message: `The operation could not be recorded, so nothing was done: ${(error as Error).message.slice(0, 200)}` };
    }
    if (!begun.created) return { ...replay(begun.operation, requestHash), operationId };
    let draft: Draft;
    try {
      draft = await act(operationId);
    } catch (error) {
      this.#host.logger.error("An operator operation failed unexpectedly; its outcome is unknown", { operationId, kind, error: (error as Error).name });
      draft = { result: "unknown", outcome: "unknown", incidentRevision: null, message: "The operation stopped with an unexpected error; its effect is unknown. Check status before trying again." };
    }
    const result: OperationResult = { operationId, ...draft };
    try {
      this.#failures.store.finishOperation(operationId, draft.result === "unknown" ? "unknown" : "completed", result as unknown as Json);
    } catch (error) {
      this.#host.logger.error("The result of an operator operation could not be recorded", { operationId, kind, error: (error as Error).message.slice(0, 200) });
    }
    this.#host.logger.info("Operator operation", { operationId, kind, sourceId, result: draft.result, outcome: draft.outcome, caller: "local caller with access" });
    return result;
  }

  /** The incident, checked as the held record of its source at the expected revision; or the refusal. */
  #heldIncident(sourceId: string, failureId: string, expectedRevision: number): IncidentRecord | Draft {
    const source = this.#host.source(sourceId);
    if (source === null) return refused("not-found", `Unknown source "${sourceId}".`);
    const record = this.#failures.store.get(failureId);
    if (record === null || record.sourceId !== sourceId) return refused("not-found", `No incident ${failureId} on source "${sourceId}".`);
    if (record.revision !== expectedRevision) return refused("stale-revision", `Incident ${failureId} is at revision ${record.revision}, not ${expectedRevision}.`, record.revision);
    if (record.state !== "open") return refused("not-held", `Incident ${failureId} is resolved (${record.resolution ?? record.progress}).`, record.revision);
    if (record.progress === "advance-pending" || record.progress === "uncertain") {
      return refused("advance-unresolved", "An advance of this record is unresolved; it is reconciled from the group's committed offset at restart.", record.revision);
    }
    if (record.progress !== "held") return refused("not-held", `Incident ${failureId} is ${record.progress}, not held.`, record.revision);
    if (record.recovery === "guard-pending") return refused("in-progress", "The recovery guard is running for this record.", record.revision);
    if (source.status !== "paused") return refused("not-held", `Source "${sourceId}" is ${source.status}, not paused at the record.`, record.revision);
    return record;
  }

  /** Retries the held record (redelivery) and reports where it settled. */
  async #redeliver(record: IncidentRecord, operationId: string, detail: string): Promise<Draft> {
    this.#note(record, operationId, detail);
    try {
      await this.#host.retry(record.sourceId);
    } catch (error) {
      const latest = this.#failures.store.get(record.failureId);
      return refused(error instanceof StreamOtterError && typeof error.details?.["reason"] === "string" ? error.details["reason"] as string : "not-held",
        (error as Error).message, latest?.revision ?? null);
    }
    const settled = await this.#settle(record.failureId, record.sourceId);
    const revision = settled?.revision ?? null;
    if (settled === null) return { result: "unknown", outcome: "unknown", incidentRevision: null, message: "The incident could not be read after the retry." };
    if (settled.state === "resolved" && settled.progress === "processed") {
      return { result: "completed", outcome: "retried", incidentRevision: revision, message: "The held record processed successfully on retry; nothing was skipped. Subscribers synchronize normally." };
    }
    if (settled.progress === "advanced") {
      return { result: "completed", outcome: "advanced", incidentRevision: revision, message: "The recovery guard approved and the source advanced past the quarantined record; snapshots must acknowledge the boundary." };
    }
    if (settled.progress === "held") {
      return { result: "completed", outcome: "held", incidentRevision: revision, message: `The record is held again: ${settled.diagnosis.slice(0, 300)}` };
    }
    return { result: "completed", outcome: settled.progress === "retrying" ? "retrying" : settled.progress, incidentRevision: revision, message: "The record was redelivered and has not settled yet; check its status." };
  }

  async #settle(failureId: string, sourceId: string): Promise<IncidentRecord | null> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      await this.#failures.settled();
      const record = this.#failures.store.get(failureId);
      if (record === null) return null;
      const source = this.#host.source(sourceId);
      const moving = record.progress === "retrying" || record.progress === "advance-pending" || record.recovery === "guard-pending";
      if (!moving && (record.state === "resolved" || source?.status === "paused")) return record;
      if (Date.now() >= deadline || this.#host.state() !== "running") return record;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /** Adds an audited "operator" event to the incident. Returns the new revision, or null if it could not be written. */
  #note(record: IncidentRecord, operationId: string, detail: string): number | null {
    try {
      const latest = this.#failures.store.get(record.failureId) ?? record;
      return this.#failures.store.update(latest.failureId, latest.revision, {}, { event: "operator", detail: detail.slice(0, 512), operationId }).revision;
    } catch (error) {
      this.#host.logger.warn("The operator event could not be recorded on the incident", { failureId: record.failureId, operationId, error: (error as Error).message.slice(0, 200) });
      return null;
    }
  }

  /** Why a redrive of this incident is not allowed, or null (spec §8.3). */
  #redriveBlocker(record: IncidentRecord): Draft | null {
    if (record.state !== "resolved" || record.progress !== "advanced") {
      return record.state === "open"
        ? refused("not-advanced", "The record is still held at its position. Repair the cause and use retry-current; redrive is only for a record that was already advanced past.")
        : refused("not-advanced", "The record was processed normally; there is nothing to redrive.");
    }
    if (!QUARANTINE_ELIGIBLE_CLASSES.includes(record.failureClass)) return refused("integrity-class", `${record.failureClass} records are never redriven.`);
    if (!this.#failures.policy(record.sourceId).replaySafeMapping) {
      return refused("not-replay-safe", `Source "${record.sourceId}" does not declare replaySafeMapping, which stored redrive requires.`);
    }
    for (const incident of this.#failures.store.open(record.sourceId)) {
      const fault = integrityFault(incident, () => this.#failures.store.events(incident.failureId));
      if (fault !== null) return refused("integrity-fault-open", `Source "${record.sourceId}" has an unresolved source-integrity fault: ${fault} (${incident.failureId}); resolve it first.`);
    }
    if (this.#host.state() !== "running") return refused("gateway-not-running", "The gateway is not running.");
    return null;
  }

  #issuePlan(record: IncidentRecord, outputs: readonly { channel: string; channelVersion: number }[], outputHash: string): Plan {
    const now = Date.now();
    for (const [planId, plan] of this.#plans) if (plan.expiresAtMs <= now) this.#plans.delete(planId);
    while (this.#plans.size >= MAX_PLANS) this.#plans.delete(this.#plans.keys().next().value as string);
    const channelVersions = [...new Set(outputs.map(output => `${output.channel}@${output.channelVersion}`))].sort();
    const fingerprint = `sha256:${sha256Hex({
      failureId: record.failureId, incidentRevision: record.revision, generation: record.generation, evidenceHash: record.evidence.hash,
      config: this.#host.fingerprint, handlerBuildId: this.#host.handlerBuildId, channelVersions, outputHash
    })}`;
    const plan: Plan = {
      planId: `pl1:${randomBytes(16).toString("hex")}`,
      failureId: record.failureId,
      sourceId: record.sourceId,
      incidentRevision: record.revision,
      generation: record.generation,
      evidenceHash: record.evidence.hash,
      outputHash,
      fingerprint,
      expiresAtMs: now + PLAN_TTL_MS
    };
    this.#plans.set(plan.planId, plan);
    return plan;
  }

  /** Reads the incident's original bytes back from where they were captured, and checks them against the evidence hash. */
  async #evidence(record: IncidentRecord): Promise<Evidence> {
    const missing = (reason: "evidence-unavailable" | "evidence-expired", message: string): Evidence => ({ kind: "missing", reason, message });
    if (record.evidence.completeness !== "complete") return missing("evidence-unavailable", `Evidence was ${record.evidence.completeness} at capture, so the original bytes are not available.`);
    if (record.evidence.location === "local") {
      const raw = this.#failures.store.getEvidence(record.failureId);
      if (raw === null) return missing("evidence-unavailable", "The local fixture evidence is no longer stored.");
      if (evidenceHash(raw) !== record.evidence.hash) return missing("evidence-unavailable", "The stored local evidence does not match the captured evidence hash.");
      return { kind: "found", raw };
    }
    if (record.evidence.location !== "kafka") return missing("evidence-unavailable", "No original bytes were captured for this incident.");
    if (record.quarantine !== "acknowledged" || record.quarantineCoordinates === null) {
      return missing("evidence-unavailable", "The quarantine topic never acknowledged a copy of this record, so there is nothing to read back.");
    }
    const reader = this.#host.quarantineReader();
    if (reader === null) return missing("evidence-unavailable", "No quarantine reader is available on this gateway.");
    const read = await reader.read({
      failureId: record.failureId,
      partition: record.quarantineCoordinates.partition,
      offset: record.quarantineCoordinates.offset,
      evidenceHash: record.evidence.hash
    });
    switch (read.kind) {
      case "found": return { kind: "found", raw: read.evidence };
      case "expired": return missing("evidence-expired", `The quarantined copy has expired from the topic: ${read.reason}`);
      case "mismatch": return missing("evidence-unavailable", `The record at the quarantine coordinates is not this incident's evidence: ${read.reason}`);
      case "unavailable": return missing("evidence-unavailable", `The quarantine topic could not be read: ${read.reason}`);
    }
  }

  #require(failureId: string): IncidentRecord {
    const record = this.#failures.store.get(failureId);
    if (record === null) throw new StreamOtterError("INVALID_REQUEST", { message: `No incident ${failureId}.`, details: { status: 404, reason: "not-found" } });
    return record;
  }

  #sourceStatus(sourceId: string): OperatorSourceStatus {
    const store = this.#failures.store;
    const policy = this.#failures.policy(sourceId);
    const status = this.#host.source(sourceId);
    const open = store.open(sourceId);
    const held = open.find(incident => incident.progress === "held" || incident.progress === "retrying" || incident.progress === "uncertain" || incident.progress === "advance-pending");
    const circuit = store.circuit(sourceId);
    const now = Date.now();
    const boundary = store.boundary(sourceId);
    const item: OperatorSourceStatus = {
      sourceId,
      status: status?.status ?? "stopped",
      policy: policySummary(policy),
      heldIncident: held === undefined ? null : { failureId: held.failureId, revision: held.revision },
      openIncidents: open.length,
      circuit: {
        state: circuit.state,
        revision: circuit.revision,
        recentIncidents: circuit.advances.filter(at => now - Date.parse(at) < policy.automaticAdvanceLimit.windowMs).length,
        windowMs: policy.automaticAdvanceLimit.windowMs,
        limit: policy.automaticAdvanceLimit.incidents,
        reason: circuit.reason
      },
      boundary: boundary === null ? null : { boundaryId: boundary.boundaryId, revision: boundary.revision, retirement: policy.boundaryRetirement, since: boundary.createdAt }
    };
    if (status?.reason !== undefined) item.reason = status.reason;
    return item;
  }

  #summary(record: IncidentRecord, circuit: CircuitState): IncidentSummary {
    return {
      failureId: record.failureId,
      revision: record.revision,
      sourceId: record.sourceId,
      generation: record.generation,
      position: { ...record.position },
      clusterId: record.clusterId,
      failureClass: record.failureClass,
      stage: record.stage,
      errorCode: record.errorCode,
      channel: record.channel,
      impact: "source-wide",
      policy: record.policy,
      state: record.state,
      resolution: record.resolution,
      firstObservedAt: record.firstObservedAt,
      lastObservedAt: record.lastObservedAt,
      observations: record.observations,
      evidence: { ...record.evidence },
      quarantine: record.quarantine,
      progress: record.progress,
      recovery: record.recovery,
      nextAction: nextAction(record, circuit, this.#failures.policy(record.sourceId))
    };
  }

  #detail(record: IncidentRecord): IncidentDetail {
    const store = this.#failures.store;
    const circuit = store.circuit(record.sourceId);
    const summary = this.#summary(record, circuit);
    const policy = this.#failures.policy(record.sourceId);
    const boundary = record.boundaryId === null ? null : store.getBoundary(record.boundaryId);
    return {
      ...summary,
      diagnosis: { message: record.diagnosis },
      quarantineCoordinates: record.quarantineCoordinates === null ? null : { ...record.quarantineCoordinates },
      boundary: boundary === null ? null : { boundaryId: boundary.boundaryId, revision: boundary.revision, state: boundary.state, retirement: policy.boundaryRetirement },
      guard: record.guard === null ? null : { ...record.guard },
      fingerprints: { ...record.fingerprints },
      history: store.events(record.failureId, HISTORY_LIMIT).map(event => ({ at: event.at, event: event.event, detail: event.detail, operationId: event.operationId })),
      explanation: explain(record, summary.nextAction, boundary?.state ?? null, circuit)
    };
  }
}

// --- pure helpers ---------------------------------------------------------------------

/**
 * Event details the failure service records for a source-integrity fault on an
 * eligible-class incident: redelivered bytes that differ from the captured
 * evidence, and group progress that moved past a held record with no recorded advance.
 */
const INTEGRITY_EVENT_DETAILS: ReadonlyMap<string, string> = new Map([
  ["evidence-conflict", "the redelivered bytes differ from the captured evidence"],
  ["position-moved", "the source position moved past a held record without a recorded advance"]
]);

/** Why an open incident is an unresolved source-integrity fault (spec §8.3), or null. */
function integrityFault(incident: IncidentRecord, events: () => readonly { detail: string | null }[]): string | null {
  if (!QUARANTINE_ELIGIBLE_CLASSES.includes(incident.failureClass)) return `an unresolved ${incident.failureClass} incident`;
  if (incident.progress === "uncertain") return "an advance that could not be confirmed";
  for (const event of events()) {
    const fault = event.detail === null ? undefined : INTEGRITY_EVENT_DETAILS.get(event.detail);
    if (fault !== undefined) return fault;
  }
  return null;
}

function usesResync(policy: ResolvedSourcePolicy): boolean {
  return policy.invalidJson === "quarantine-resync" || policy.invalidPublicPayload === "quarantine-resync";
}

function policySummary(policy: ResolvedSourcePolicy): OperatorSourceStatus["policy"] {
  return {
    invalidJson: policy.invalidJson,
    invalidPublicPayload: policy.invalidPublicPayload,
    transientMapperRetries: policy.transientMapperRetries,
    replaySafeMapping: policy.replaySafeMapping,
    boundaryRetirement: policy.boundaryRetirement
  };
}

function nextAction(record: IncidentRecord, circuit: CircuitState, policy: ResolvedSourcePolicy): IncidentNextAction {
  if (record.state === "resolved") return record.progress === "advanced" && policy.replaySafeMapping && record.evidence.completeness === "complete" ? "evaluate" : "none";
  if (record.progress === "advance-pending" || record.progress === "uncertain" || record.progress === "retrying") return "none";
  if (record.policy === "quarantine-resync" && QUARANTINE_ELIGIBLE_CLASSES.includes(record.failureClass) && (record.recovery === "held" || record.recovery === "denied")) {
    return circuit.state === "open" ? "reopen-circuit" : "reassess";
  }
  return "repair-and-retry";
}

const CLASS_TEXT: Readonly<Record<FailureClass, { what: string; expected: string }>> = {
  "invalid-json": { what: "The record's value is not valid UTF-8 JSON.", expected: "Every record value on this source decodes as UTF-8 JSON within the nesting limit." },
  "payload-schema": { what: "The mapped data does not match the channel's payload schema.", expected: "map returns data that satisfies the channel's payload schema." },
  "mapper-transient": { what: "The map handler reported a transient failure on every allowed attempt.", expected: "map succeeds once its dependency is available again." },
  "mapper-error": { what: "The map handler threw.", expected: "map returns an array of outputs for every record on the source." },
  "mapper-timeout": { what: "The map handler did not answer within handlerTimeoutMs.", expected: "map answers within handlerTimeoutMs." },
  "routing-invalid": { what: "map returned an output with an invalid shape, tenant, params or revision.", expected: "Every output has a tenant, valid params, a canonical revision and JSON data." },
  "revision-conflict": { what: "The same revision was mapped to different data.", expected: "A revision always maps to the same data; a change of state carries a higher revision." },
  "tombstone": { what: "The record is a tombstone (null value), which StreamOtter does not interpret.", expected: "Deletion is published as explicit state, not as a tombstone." },
  "oversize": { what: "The record exceeds maxSourceRecordBytes.", expected: "Records stay within maxSourceRecordBytes." }
};

function expectedBehavior(failureClass: FailureClass): string {
  return CLASS_TEXT[failureClass].expected;
}

function explain(record: IncidentRecord, action: IncidentNextAction, boundaryState: string | null, circuit: CircuitState): IncidentDetail["explanation"] {
  const position = record.position.kind === "kafka"
    ? `${record.position.topic}/${record.position.partition} offset ${record.position.offset}`
    : `fixture record ${record.position.index}`;
  const evidence = record.evidence.location === "local"
    ? `Local fixture evidence, not Kafka (${record.evidence.completeness}).`
    : record.evidence.location === "kafka"
      ? record.quarantine === "acknowledged"
        ? `A copy is in the quarantine topic${record.quarantineCoordinates === null ? "" : ` at partition ${record.quarantineCoordinates.partition}, offset ${record.quarantineCoordinates.offset}`} (${record.evidence.completeness} capture).`
        : `Quarantine write ${record.quarantine}; capture ${record.evidence.completeness}.`
      : "No original bytes were captured.";
  let disposition: string;
  if (record.progress === "advanced") disposition = `The source advanced past ${position} under a recovery boundary; the record was not delivered.`;
  else if (record.progress === "processed") disposition = `The record at ${position} processed normally after a retry; nothing was skipped.`;
  else if (record.progress === "advance-pending" || record.progress === "uncertain") disposition = `An advance past ${position} is unresolved; the source stays held until it is reconciled from the group's committed offset.`;
  else if (record.progress === "retrying") disposition = `The record at ${position} is being retried.`;
  else disposition = `The source is held at ${position}; nothing after it has been processed or committed.`;
  const snapshots = record.boundaryId === null
    ? null
    : boundaryState === "in-force"
      ? `Every snapshot on source "${record.sourceId}" must acknowledge recovery boundary ${record.boundaryId} before subscribers can be live.`
      : `Recovery boundary ${record.boundaryId} is ${boundaryState ?? "no longer stored"}.`;
  const next: Record<IncidentNextAction, string> = {
    "repair-and-retry": `${CLASS_TEXT[record.failureClass].what} Repair the cause (the publisher, the mapping or the schema), then retry the held record with retry-current. It is never skipped.`,
    "reassess": "Correct whatever made the recovery guard hold, then reassess to run the guard again on a fresh quarantine copy.",
    "evaluate": "Optionally evaluate the stored original against the current mapping; if it now maps cleanly, an approved redrive admits it through the normal revision filter.",
    "reopen-circuit": `Automatic continuation stopped: ${circuit.reason ?? "too many advances in the window"}. Find the cause, reopen the circuit, then reassess.`,
    "none": record.state === "resolved" ? "Nothing; the incident is resolved." : "Nothing yet; the gateway reconciles this on its own."
  };
  return { whatFailed: `${CLASS_TEXT[record.failureClass].what} (${record.errorCode} at ${record.stage})`, evidence, disposition, snapshots, nextAction: next[action] };
}

function rawView(evidence: Evidence): RawEvidenceView {
  if (evidence.kind === "missing") return { keyBase64: null, valueBase64: null, headers: [], complete: false, note: evidence.message };
  const { raw } = evidence;
  return {
    keyBase64: raw.key === null ? null : Buffer.from(raw.key).toString("base64"),
    valueBase64: raw.value === null ? null : Buffer.from(raw.value).toString("base64"),
    headers: raw.headers.map(header => ({ name: header.name, valueBase64: Buffer.from(header.value).toString("base64") })),
    complete: true,
    note: null
  };
}

function replay(operation: StoredOperation, requestHash: string): Draft {
  if (operation.requestHash !== requestHash) {
    return refused("operation-id-reused", "That operation ID was already used for a different request.");
  }
  if (operation.state === "pending") return refused("operation-in-progress", "That operation is still running.");
  if (operation.state === "unknown" && operation.result === null) {
    return { result: "unknown", outcome: "unknown", incidentRevision: null, message: "The gateway stopped between recording this operation and its result, so its effect is unknown. It is not rerun: check status, evaluate again and approve a new plan with a new operation ID." };
  }
  const stored = operation.result as unknown as OperationResult;
  return { result: stored.result, outcome: stored.outcome, incidentRevision: stored.incidentRevision, message: stored.message };
}

function redriveResult(outcome: RedriveOutcome, revision: number): Draft {
  switch (outcome.kind) {
    case "abandon":
      return { result: "failed", outcome: "gateway-stopping", incidentRevision: revision, message: "The gateway is stopping; nothing was admitted." };
    case "changed":
      return refused("fingerprint-changed", "The record now maps to different output than the approved plan; nothing was admitted. Evaluate again.", revision);
    case "problem":
      return {
        result: "failed",
        outcome: outcome.failureClass === "revision-conflict" ? "revision-conflict" : "failed",
        incidentRevision: revision,
        message: outcome.failureClass === "revision-conflict"
          ? "The record maps to an existing revision with different data; nothing was admitted. This is an integrity failure to repair at the source."
          : `The record still fails at ${outcome.stage}: ${outcome.reason.slice(0, 300)}`
      };
    case "admitted": {
      const { queued, filtered, inactive, overflow } = outcome.counts;
      const counts = `${queued} queued, ${filtered} at or below current state, ${inactive} inactive, ${overflow} over budget`;
      return queued > 0
        ? { result: "completed", outcome: "reprocessed", incidentRevision: revision, message: `Admitted through the revision filter (${counts}). This is not evidence that a browser received it.` }
        : { result: "completed", outcome: "superseded", incidentRevision: revision, message: `No subscription needed it (${counts}); current state already supersedes it or snapshots establish it.` };
    }
  }
}
