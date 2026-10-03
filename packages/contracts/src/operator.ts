import { StreamOtterError } from "./errors.ts";
import type { BoundaryRetirement, FailureClass, FailurePolicy } from "./failures.ts";
import { isPlainObject } from "./primitives.ts";
import type { ErrorCode, Page, SourceRecord, SourceStatus, StreamError, Trace } from "./types.ts";

/**
 * The V1.1 operator API (docs/releases/v1.1/V1_1_API.md §6, ADR-15C §1). One
 * `OperatorApi` is reached in-process, over the local socket, and through the
 * development management routes. Browser-safe: no Node.js imports.
 */

export type IncidentProgress = "held" | "retrying" | "advance-pending" | "advanced" | "processed" | "uncertain";
export type IncidentRecovery = "not-applicable" | "guard-pending" | "held" | "boundary-in-force" | "denied";
export type IncidentQuarantine = "not-required" | "pending" | "unknown" | "acknowledged" | "failed";
export type IncidentNextAction = "repair-and-retry" | "reassess" | "evaluate" | "reopen-circuit" | "none";
export type IncidentEventName =
  | "detected" | "retrying" | "captured" | "quarantine-unknown" | "quarantined" | "held"
  | "advance-pending" | "advance-confirmed" | "snapshot-recovery-required" | "operator" | "resolved";

export interface IncidentSummary {
  /** "f1:" + sourceRecordId (ADR-15A §3). */
  failureId: string;
  /** Increments on every change; every mutation names the revision it expects. */
  revision: number;
  sourceId: string;
  generation: string;
  position: SourceRecord["position"];
  /** Kafka cluster ID at capture; null for fixtures. */
  clusterId: string | null;
  failureClass: FailureClass;
  stage: "validate" | "map" | "queue";
  /** The existing public error code, unchanged. */
  errorCode: ErrorCode;
  channel: string | null;
  /** V1.1 never narrows impact (spec §7.1). */
  impact: "source-wide";
  policy: FailurePolicy;
  state: "open" | "resolved";
  resolution: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  observations: number;
  evidence: {
    location: "kafka" | "local" | "none";
    completeness: "complete" | "incomplete" | "unavailable" | "expired";
    valueBytes: number | null;
    keyBytes: number | null;
    headerCount: number;
    /** "sha256:<hex>" over key, value and headers, or "" when nothing was captured. */
    hash: string;
  };
  quarantine: IncidentQuarantine;
  progress: IncidentProgress;
  recovery: IncidentRecovery;
  nextAction: IncidentNextAction;
}

export interface IncidentEvent {
  at: string;
  event: IncidentEventName;
  detail: string | null;
  operationId: string | null;
}

export interface IncidentDetail extends IncidentSummary {
  /** Sanitized; never payload text. */
  diagnosis: { message: string };
  quarantineCoordinates: { partition: number; offset: string } | null;
  /** The boundary this incident's advance installed, with its current state. */
  boundary: { boundaryId: string; revision: number; state: "in-force" | "superseded" | "retired"; retirement: BoundaryRetirement } | null;
  guard: { decision: "hold" | "recoverable" | "error" | "timeout"; reason: string | null; evidenceRef: string | null; at: string } | null;
  fingerprints: { config: string; handlerBuildId: string; policyRevision: string; gatewayVersion: string };
  /** Bounded, newest last. */
  history: readonly IncidentEvent[];
  /** Plain-language explanation for the console and CLI (spec §10). */
  explanation: {
    whatFailed: string;
    evidence: string;
    disposition: string;
    snapshots: string | null;
    nextAction: string;
  };
}

/** Original record bytes. Only in-process and over the local socket; never over WHC-1. */
export interface RawEvidenceView {
  keyBase64: string | null;
  valueBase64: string | null;
  headers: readonly { name: string; valueBase64: string }[];
  /** False when the bytes could not be read back in full (expired, unavailable, or mismatched). */
  complete: boolean;
  /** Why the bytes are absent or incomplete, when they are. */
  note: string | null;
}

export interface OperationResult {
  /** Caller-supplied for idempotency (redrive), else generated. */
  operationId: string;
  result: "completed" | "refused" | "failed" | "unknown";
  /**
   * What happened, for example "retried", "held", "advanced", "reprocessed", "superseded",
   * "circuit-reopened", "boundary-retired", or a refusal reason such as "stale-revision",
   * "integrity-class", "plan-expired", "fingerprint-changed", "evidence-unavailable",
   * "circuit-open", "not-held".
   */
  outcome: string;
  incidentRevision: number | null;
  message: string;
}

export interface EvaluationOutput {
  channel: string;
  channelVersion: number;
  routing: "privileged";
  revision: string;
}

export interface EvaluationResult {
  validation: "valid" | "invalid";
  errors: readonly { stage: string; failureClass: FailureClass | null; message: string }[];
  /** Privileged metadata: what the record maps to now. Never evidence that a browser received anything. */
  outputs: readonly EvaluationOutput[];
  /** Whether a redrive of this plan may run. */
  eligible: boolean;
  ineligibleReason: string | null;
  /** Issued only when eligible; expires after PLAN_TTL_MS. */
  plan: { planId: string; fingerprint: string; expiresAt: string } | null;
}

export interface OperatorSourceStatus {
  sourceId: string;
  status: SourceStatus["status"];
  reason?: ErrorCode;
  policy: { invalidJson: FailurePolicy; invalidPublicPayload: FailurePolicy; transientMapperRetries: number; replaySafeMapping: boolean; boundaryRetirement: BoundaryRetirement };
  heldIncident: { failureId: string; revision: number } | null;
  openIncidents: number;
  circuit: { state: "closed" | "open"; revision: number; recentIncidents: number; windowMs: number; limit: number; reason: string | null };
  boundary: { boundaryId: string; revision: number; retirement: BoundaryRetirement; since: string } | null;
}

export interface OperatorStatus {
  gateway: { mode: "development" | "production"; version: string; configFingerprint: string; handlerBuildId: string; state: string };
  store: { kind: "sqlite" | "memory"; durable: boolean; path: string | null; sizeBytes: number; limitBytes: number; schemaVersion: number };
  quarantine: { topic: string | null; maxMessageBytes: number | null; minInsyncReplicas: number | null; replicationFactor: number | null } | null;
  sources: readonly OperatorSourceStatus[];
}

/** A reproduction bundle (spec §10, F40). Versioned; raw bytes only when explicitly requested. */
export interface ReproductionBundle {
  bundleVersion: 1;
  createdAt: string;
  gateway: { mode: "development" | "production"; version: string; configFingerprint: string; handlerBuildId: string };
  incident: IncidentDetail;
  /** Recent traces of the incident's source, bounded. */
  traces: readonly Trace[];
  policy: OperatorSourceStatus["policy"];
  expectedBehavior: string;
  remedy: string;
  evidence: { included: boolean; location: IncidentSummary["evidence"]["location"]; completeness: IncidentSummary["evidence"]["completeness"]; note: string };
  raw?: RawEvidenceView;
}

export interface ListFailuresRequest { sourceId?: string; state?: "open" | "resolved" | "all"; limit?: number; cursor?: string }
export interface ShowFailureRequest { failureId: string; includeRaw?: boolean }
export interface ExportFailureRequest { failureId: string; includeRaw?: boolean }
export interface RetryCurrentRequest { sourceId: string; failureId: string; expectedRevision: number; reason?: string }
export interface ReassessRequest { sourceId: string; failureId: string; expectedRevision: number }
export interface ReopenCircuitRequest { sourceId: string; expectedCircuitRevision: number; reason: string }
export interface RetireBoundaryRequest { sourceId: string; boundaryId: string; expectedRevision: number; reason: string }
export interface EvaluateRequest { failureId: string; expectedRevision: number }
export interface RedriveRequest { failureId: string; planId: string; planFingerprint: string; expectedRevision: number; operationId?: string }

/** The operator service. Every method resolves to the shape shown or rejects with a StreamOtterError (INVALID_REQUEST for malformed input). */
export interface OperatorApi {
  status(): Promise<OperatorStatus>;
  listFailures(request: ListFailuresRequest): Promise<Page<IncidentSummary>>;
  showFailure(request: ShowFailureRequest): Promise<IncidentDetail & { raw?: RawEvidenceView }>;
  exportFailure(request: ExportFailureRequest): Promise<ReproductionBundle>;
  retryCurrent(request: RetryCurrentRequest): Promise<OperationResult>;
  reassess(request: ReassessRequest): Promise<OperationResult>;
  reopenCircuit(request: ReopenCircuitRequest): Promise<OperationResult>;
  retireBoundary(request: RetireBoundaryRequest): Promise<OperationResult>;
  evaluate(request: EvaluateRequest): Promise<EvaluationResult>;
  redrive(request: RedriveRequest): Promise<OperationResult>;
}

export type OperatorOperation = keyof OperatorApi;
export interface OperatorRequests {
  status: Record<string, never>;
  listFailures: ListFailuresRequest;
  showFailure: ShowFailureRequest;
  exportFailure: ExportFailureRequest;
  retryCurrent: RetryCurrentRequest;
  reassess: ReassessRequest;
  reopenCircuit: ReopenCircuitRequest;
  retireBoundary: RetireBoundaryRequest;
  evaluate: EvaluateRequest;
  redrive: RedriveRequest;
}

export const OPERATOR_OPERATIONS: readonly OperatorOperation[] = Object.freeze([
  "status", "listFailures", "showFailure", "exportFailure", "retryCurrent", "reassess", "reopenCircuit", "retireBoundary", "evaluate", "redrive"
] as const satisfies readonly OperatorOperation[]);

/** Operations that change state. */
export const OPERATOR_MUTATIONS: readonly OperatorOperation[] = Object.freeze(["retryCurrent", "reassess", "reopenCircuit", "retireBoundary", "redrive"] as const);

/** How long an evaluation plan stays valid (ADR-15C §5). */
export const PLAN_TTL_MS = 5 * 60_000;
/** Largest page of failures. */
export const MAX_FAILURE_PAGE = 200;
/** Longest free-text reason an operator may give. */
export const MAX_OPERATOR_REASON = 512;

// --- local IPC (API §7, ADR-15C §3) ------------------------------------------------

export const OPERATOR_IPC_VERSION = 1 as const;
/** Largest request line, including the trailing newline. */
export const OPERATOR_IPC_MAX_REQUEST_BYTES = 65_536;
/** Socket and token file names inside `<stateDirectory>/run/`. */
export const OPERATOR_SOCKET_FILE = "operator.sock";
export const OPERATOR_TOKEN_FILE = "operator.token";

export interface OperatorIpcRequest<O extends OperatorOperation = OperatorOperation> {
  v: 1;
  id: string;
  token: string;
  op: O;
  args: OperatorRequests[O];
}
export type OperatorIpcResponse =
  | { v: 1; id: string; ok: true; data: unknown }
  | { v: 1; id: string; ok: false; error: StreamError };

/** CLI exit status for an operation result (API §10, D7): 0 completed, 3 refused, 1 failed, 4 unknown. */
export function operationExitCode(result: OperationResult["result"]): 0 | 1 | 3 | 4 {
  switch (result) {
    case "completed": return 0;
    case "refused": return 3;
    case "failed": return 1;
    case "unknown": return 4;
  }
}

// --- request validation --------------------------------------------------------------

function invalid(message: string): StreamOtterError {
  return new StreamOtterError("INVALID_REQUEST", { message });
}

function fields(value: unknown, required: readonly string[], optional: readonly string[]): Record<string, unknown> {
  if (value === undefined && required.length === 0) return {};
  if (!isPlainObject(value)) throw invalid("The request must be a JSON object.");
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw invalid(`Unknown field "${key.slice(0, 64)}".`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) throw invalid(`"${key}" is required.`);
  }
  return value;
}

function id(value: unknown, name: string, max = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid(`${name} must be a non-empty string of at most ${max} characters without control characters.`);
  }
  return value;
}

function revision(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(`${name} must be a non-negative integer.`);
  return value;
}

function reason(value: unknown, name: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_OPERATOR_REASON) {
    throw invalid(`${name} must be a non-empty string of at most ${MAX_OPERATOR_REASON} characters.`);
  }
  return value;
}

function flag(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalid(`${name} must be true or false.`);
  return value;
}

function assign<T extends object>(target: T, key: string, value: unknown): T {
  if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  return target;
}

/**
 * Validates operator request arguments strictly: unknown fields, wrong types and
 * out-of-range values throw INVALID_REQUEST. Shared by every caller so the
 * socket, the management routes and the in-process API refuse identically.
 */
export function validateOperatorRequest<O extends OperatorOperation>(op: O, args: unknown): OperatorRequests[O] {
  switch (op) {
    case "status":
      fields(args, [], []);
      return {} as OperatorRequests[O];
    case "listFailures": {
      const a = fields(args, [], ["sourceId", "state", "limit", "cursor"]);
      const out: ListFailuresRequest = {};
      if (a["sourceId"] !== undefined) out.sourceId = id(a["sourceId"], "sourceId", 128);
      if (a["state"] !== undefined) {
        if (a["state"] !== "open" && a["state"] !== "resolved" && a["state"] !== "all") throw invalid("state must be open, resolved or all.");
        out.state = a["state"];
      }
      if (a["limit"] !== undefined) {
        const limit = a["limit"];
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_FAILURE_PAGE) throw invalid(`limit must be an integer from 1 to ${MAX_FAILURE_PAGE}.`);
        out.limit = limit;
      }
      if (a["cursor"] !== undefined) out.cursor = id(a["cursor"], "cursor", 256);
      return out as OperatorRequests[O];
    }
    case "showFailure":
    case "exportFailure": {
      const a = fields(args, ["failureId"], ["includeRaw"]);
      return assign({ failureId: id(a["failureId"], "failureId") }, "includeRaw", flag(a["includeRaw"], "includeRaw")) as OperatorRequests[O];
    }
    case "retryCurrent": {
      const a = fields(args, ["sourceId", "failureId", "expectedRevision"], ["reason"]);
      return assign({
        sourceId: id(a["sourceId"], "sourceId", 128), failureId: id(a["failureId"], "failureId"), expectedRevision: revision(a["expectedRevision"], "expectedRevision")
      }, "reason", reason(a["reason"], "reason", false)) as OperatorRequests[O];
    }
    case "reassess": {
      const a = fields(args, ["sourceId", "failureId", "expectedRevision"], []);
      return { sourceId: id(a["sourceId"], "sourceId", 128), failureId: id(a["failureId"], "failureId"), expectedRevision: revision(a["expectedRevision"], "expectedRevision") } as OperatorRequests[O];
    }
    case "reopenCircuit": {
      const a = fields(args, ["sourceId", "expectedCircuitRevision", "reason"], []);
      return {
        sourceId: id(a["sourceId"], "sourceId", 128), expectedCircuitRevision: revision(a["expectedCircuitRevision"], "expectedCircuitRevision"), reason: reason(a["reason"], "reason", true)
      } as OperatorRequests[O];
    }
    case "retireBoundary": {
      const a = fields(args, ["sourceId", "boundaryId", "expectedRevision", "reason"], []);
      return {
        sourceId: id(a["sourceId"], "sourceId", 128), boundaryId: id(a["boundaryId"], "boundaryId", 128),
        expectedRevision: revision(a["expectedRevision"], "expectedRevision"), reason: reason(a["reason"], "reason", true)
      } as OperatorRequests[O];
    }
    case "evaluate": {
      const a = fields(args, ["failureId", "expectedRevision"], []);
      return { failureId: id(a["failureId"], "failureId"), expectedRevision: revision(a["expectedRevision"], "expectedRevision") } as OperatorRequests[O];
    }
    case "redrive": {
      const a = fields(args, ["failureId", "planId", "planFingerprint", "expectedRevision"], ["operationId"]);
      return assign({
        failureId: id(a["failureId"], "failureId"), planId: id(a["planId"], "planId", 128), planFingerprint: id(a["planFingerprint"], "planFingerprint", 128),
        expectedRevision: revision(a["expectedRevision"], "expectedRevision")
      }, "operationId", a["operationId"] === undefined ? undefined : id(a["operationId"], "operationId", 128)) as OperatorRequests[O];
    }
    default:
      throw invalid(`Unknown operator operation "${String(op).slice(0, 64)}".`);
  }
}

export function isOperatorOperation(value: unknown): value is OperatorOperation {
  return typeof value === "string" && (OPERATOR_OPERATIONS as readonly string[]).includes(value);
}
