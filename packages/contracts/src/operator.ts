import { StreamOtterError } from "./errors.ts";
import type { BoundaryRetirement, FailureClass, FailurePolicy } from "./failures.ts";
import { isPlainObject } from "./primitives.ts";
import type { ErrorCode, Page, SourceRecord, SourceStatus, StreamError, Trace } from "./types.ts";

/**
 * The V1.1 operator API (docs/releases/v1.1/V1_1_API.md §6, ADR-15C §1). One
 * `OperatorApi` is reached in-process, over the local socket, and through the
 * development management routes. Browser-safe: no Node.js imports.
 */

/**
 * What happened to the source position at an incident's record:
 *
 * - `held`: the source is stopped at the record; nothing after it is processed or committed.
 * - `retrying`: the record is being processed again after a retry.
 * - `advance-pending`: a recovery boundary is installed and the move past the record is not yet confirmed.
 * - `advanced`: the source moved past the record under a recovery boundary; the record was not delivered.
 * - `processed`: the record processed normally on a retry; nothing was skipped.
 * - `uncertain`: an advance could not be confirmed; the whole source holds until a restart reconciles it from the group's committed offset.
 */
export type IncidentProgress = "held" | "retrying" | "advance-pending" | "advanced" | "processed" | "uncertain";
/**
 * Where an incident stands with the recovery guard, which only `quarantine-resync` runs:
 *
 * - `not-applicable`: no quarantine or recovery applies, for example under the `pause` policy.
 * - `guard-pending`: the recovery guard is running.
 * - `held`: the record stays held without an approval, for example under `quarantine-hold`, with an open circuit, or after the guard threw, timed out or gave an invalid answer.
 * - `boundary-in-force`: the guard approved and this incident's advance installed a recovery boundary.
 * - `denied`: the guard answered `hold`.
 */
export type IncidentRecovery = "not-applicable" | "guard-pending" | "held" | "boundary-in-force" | "denied";
/**
 * Whether a copy of the record is in the quarantine topic (or, for a fixture source, the local store):
 *
 * - `not-required`: no quarantine write was attempted, for example under the `pause` policy.
 * - `pending`: a write is in progress.
 * - `unknown`: the write got no definite answer. Never treated as success.
 * - `acknowledged`: the copy was acknowledged (or stored locally for a fixture source).
 * - `failed`: the write was refused.
 */
export type IncidentQuarantine = "not-required" | "pending" | "unknown" | "acknowledged" | "failed";
/**
 * The supported next step for an incident, also explained in words in {@link IncidentDetail}'s `explanation`:
 *
 * - `repair-and-retry`: repair the cause, then retry the held record with {@link OperatorApi.retryCurrent}.
 * - `reassess`: correct what made the recovery guard hold, then run it again with {@link OperatorApi.reassess}.
 * - `evaluate`: the record was advanced past and may be redriven; {@link OperatorApi.evaluate} checks it against the current mapping.
 * - `reopen-circuit`: the source's automatic-continuation circuit is open; find the cause, then {@link OperatorApi.reopenCircuit} and reassess.
 * - `none`: nothing to do. The incident is resolved, or the gateway is still working on it or reconciles it at restart.
 */
export type IncidentNextAction = "repair-and-retry" | "reassess" | "evaluate" | "reopen-circuit" | "none";
/**
 * Lifecycle events in an incident's history, also logged with metadata only:
 *
 * - `detected`: the failing record was observed, the first time or again.
 * - `retrying`: a retry of the held record started.
 * - `captured`: the evidence was captured and a quarantine write started.
 * - `quarantine-unknown`: the quarantine write got no definite answer.
 * - `quarantined`: the quarantine copy was acknowledged.
 * - `held`: the record stays held; `detail` says why.
 * - `advance-pending`: a recovery boundary was installed and an advance past the record prepared.
 * - `advance-confirmed`: the advance was committed and confirmed, or confirmed at startup.
 * - `snapshot-recovery-required`: snapshots on the source must acknowledge the new recovery boundary. Logged after an advance; not stored in the history.
 * - `operator`: an operator action, carrying its operation ID.
 * - `resolved`: the held record processed successfully.
 */
export type IncidentEventName =
  | "detected" | "retrying" | "captured" | "quarantine-unknown" | "quarantined" | "held"
  | "advance-pending" | "advance-confirmed" | "snapshot-recovery-required" | "operator" | "resolved";

/**
 * One incident: a source record that failed, identified by its position, with
 * its evidence, quarantine, progress and recovery kept as separate facts.
 * {@link OperatorApi.listFailures} returns these.
 */
export interface IncidentSummary {
  /** "f1:" + sourceRecordId (ADR-15A §3). */
  failureId: string;
  /** Increments on every change; every mutation names the revision it expects. */
  revision: number;
  /** The source the record came from. */
  sourceId: string;
  /** The source generation the record was read under. A position names the same record only within one generation. */
  generation: string;
  /** Where the record is: Kafka topic, partition and offset, or a fixture index. */
  position: SourceRecord["position"];
  /** Kafka cluster ID at capture; null for fixtures, or when the cluster ID was not known. */
  clusterId: string | null;
  /** How the failure was classified. Only `invalid-json` and `payload-schema` can take a quarantine policy. */
  failureClass: FailureClass;
  /** Where processing failed: `validate` (decoding and record limits), `map` (the map handler and its outputs) or `queue` (the revision check against current state). */
  stage: "validate" | "map" | "queue";
  /** The existing public error code, unchanged. */
  errorCode: ErrorCode;
  /** The failing channel when known, else null. */
  channel: string | null;
  /** V1.1 never narrows impact (spec §7.1). */
  impact: "source-wide";
  /** The failure policy that applied to this record's class when the incident was first observed. */
  policy: FailurePolicy;
  /** `open` while the incident still needs something; `resolved` once the record processed, was advanced past, or the source was rebaselined. */
  state: "open" | "resolved";
  /** How the incident was resolved, in words (for example "processed after retry"), or null while it is open. */
  resolution: string | null;
  /** When the failing record was first observed (ISO 8601). */
  firstObservedAt: string;
  /** When the failing record was last observed (ISO 8601). */
  lastObservedAt: string;
  /** How many times the record has been observed failing, including redeliveries. */
  observations: number;
  /** What was captured of the original record. Metadata only; the bytes themselves are a {@link RawEvidenceView}. */
  evidence: {
    /** Where the original bytes are kept: `kafka` (the quarantine topic), `local` (the local store, for fixture sources) or `none`. */
    location: "kafka" | "local" | "none";
    /** Whether the original bytes were captured in full. `incomplete` means the record exceeded the capture limits; `unavailable` means no bytes were captured. */
    completeness: "complete" | "incomplete" | "unavailable" | "expired";
    /** Size of the record value in bytes; null for a tombstone or when nothing was captured. */
    valueBytes: number | null;
    /** Size of the record key in bytes; null when the record has no key or nothing was captured. */
    keyBytes: number | null;
    /** Number of record headers. */
    headerCount: number;
    /** "sha256:<hex>" over key, value and headers, or "" when nothing was captured. */
    hash: string;
  };
  /** Whether a copy of the record is in the quarantine topic. */
  quarantine: IncidentQuarantine;
  /** What happened to the source position at the record. */
  progress: IncidentProgress;
  /** What the recovery guard decided. */
  recovery: IncidentRecovery;
  /** The supported next step. */
  nextAction: IncidentNextAction;
}

/** One entry in an incident's history. */
export interface IncidentEvent {
  /** When the event happened (ISO 8601). */
  at: string;
  /** The lifecycle event. */
  event: IncidentEventName;
  /** Short context, such as the failure class, why the record is held, or a boundary ID; null when there is none. */
  detail: string | null;
  /** The operator operation that caused the event, or null. */
  operationId: string | null;
}

/** An incident in full, as {@link OperatorApi.showFailure} returns it. */
export interface IncidentDetail extends IncidentSummary {
  /** Sanitized; never payload text. */
  diagnosis: { message: string };
  /** Where the acknowledged copy is in the quarantine topic (offset as a decimal string), or null when there is no acknowledged Kafka copy. */
  quarantineCoordinates: { partition: number; offset: string } | null;
  /** The boundary this incident's advance installed, with its current state. */
  boundary: { boundaryId: string; revision: number; state: "in-force" | "superseded" | "retired"; retirement: BoundaryRetirement } | null;
  /**
   * The last recovery-guard result (quarantine-resync only), or null if the guard never ran. `decision` is the
   * guard's answer, `error` when it threw or answered invalidly, or `timeout` after 10 seconds.
   * `reason` and `evidenceRef` are at most 512 characters.
   */
  guard: { decision: "hold" | "recoverable" | "error" | "timeout"; reason: string | null; evidenceRef: string | null; at: string } | null;
  /**
   * Identities recorded when the incident was first observed: the configuration fingerprint, the handler
   * build ID (`handlerBuildId` gateway option), a revision of the `failureHandling` configuration, and the gateway version.
   */
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
  /** The record key as base64; null when the record has no key or the bytes could not be read. */
  keyBase64: string | null;
  /** The record value as base64; null for a tombstone or when the bytes could not be read. */
  valueBase64: string | null;
  /** The record headers in order, each value as base64. */
  headers: readonly { name: string; valueBase64: string }[];
  /** False when the bytes could not be read back in full (expired, unavailable, or mismatched). */
  complete: boolean;
  /** Why the bytes are absent or incomplete, when they are. */
  note: string | null;
}

/**
 * The result of an operator mutation. A refusal is a result (`result: "refused"`
 * with a specific `outcome`), not an exception, so tooling can show it.
 */
export interface OperationResult {
  /** Caller-supplied for idempotency (redrive), else generated. */
  operationId: string;
  /**
   * How the operation ended (see {@link operationExitCode} for the CLI exit status):
   *
   * - `completed`: it ran; `outcome` says what happened (`held`, for example, is a completed retry).
   * - `refused`: the request was understood and declined.
   * - `failed`: it ran and did not succeed, for example a redrive whose record still fails.
   * - `unknown`: its effect is unknown, for example after a restart interrupted it. It is never rerun.
   */
  result: "completed" | "refused" | "failed" | "unknown";
  /**
   * What happened, for example "retried", "held", "advanced", "reprocessed", "superseded",
   * "circuit-reopened", "boundary-retired", or a refusal reason such as "stale-revision",
   * "integrity-class", "plan-expired", "fingerprint-changed", "evidence-unavailable",
   * "circuit-open", "not-held".
   */
  outcome: string;
  /** The incident's revision after the operation, or null when the operation concerns no incident or the revision is not known. */
  incidentRevision: number | null;
  /** A human-readable explanation of the result. */
  message: string;
}

/** One output the evaluated record would map to now. Its routing identity (tenant and parameters) is not included. */
export interface EvaluationOutput {
  /** The channel the output is for. */
  channel: string;
  /** The version of that channel. */
  channelVersion: number;
  /** Always "privileged": routing identities are privileged metadata and are withheld. */
  routing: "privileged";
  /** The revision the output carries. */
  revision: string;
}

/**
 * What {@link OperatorApi.evaluate} returns: a dry run of an incident's stored
 * original record through the current mapping. Nothing is delivered, traced or
 * committed. An unknown or stale request is reported here, not thrown.
 */
export interface EvaluationResult {
  /** `valid` when the record now maps cleanly; `invalid` when it still fails or could not be evaluated. */
  validation: "valid" | "invalid";
  /**
   * Why the record does not map cleanly, or why it could not be evaluated; empty when valid. `stage` is
   * the processing stage that failed, or "request" or "evidence" for a problem with the request or the stored evidence.
   */
  errors: readonly { stage: string; failureClass: FailureClass | null; message: string }[];
  /** Privileged metadata: what the record maps to now. Never evidence that a browser received anything. */
  outputs: readonly EvaluationOutput[];
  /** Whether a redrive of this plan may run. */
  eligible: boolean;
  /**
   * Why no plan was issued, or null when eligible. For example "not-advanced", "not-replay-safe",
   * "integrity-fault-open", "still-fails", "evidence-expired", "evidence-unavailable", "stale-revision"
   * or "generation-changed".
   */
  ineligibleReason: string | null;
  /** Issued only when eligible; expires after PLAN_TTL_MS. */
  plan: { planId: string; fingerprint: string; expiresAt: string } | null;
}

/** Failure-handling state of one configured source, as part of {@link OperatorStatus}. */
export interface OperatorSourceStatus {
  /** The source ID. */
  sourceId: string;
  /** The source's runtime status; "stopped" when the runtime reports none. */
  status: SourceStatus["status"];
  /** The error code behind the current status, when the runtime reports one. */
  reason?: ErrorCode;
  /** The source's failure policy, with defaults applied. */
  policy: { invalidJson: FailurePolicy; invalidPublicPayload: FailurePolicy; transientMapperRetries: number; replaySafeMapping: boolean; boundaryRetirement: BoundaryRetirement };
  /** The open incident the source is stopped at (held, retrying, or with an unresolved advance), or null. */
  heldIncident: { failureId: string; revision: number } | null;
  /** The number of open incidents on the source. */
  openIncidents: number;
  /**
   * The automatic-continuation circuit breaker for quarantine-resync. `revision` is what
   * {@link ReopenCircuitRequest} names; `recentIncidents` counts distinct automatic advances inside the
   * current window of `windowMs` milliseconds, against `limit`; `reason` says why it last opened, or the
   * operator's reason for the last reopen.
   */
  circuit: { state: "closed" | "open"; revision: number; recentIncidents: number; windowMs: number; limit: number; reason: string | null };
  /**
   * The recovery boundary in force on the source, or null. `revision` is what {@link RetireBoundaryRequest}
   * names, `retirement` is the source's configured `boundaryRetirement`, and `since` is when the boundary was created (ISO 8601).
   */
  boundary: { boundaryId: string; revision: number; retirement: BoundaryRetirement; since: string } | null;
}

/** What {@link OperatorApi.status} returns. */
export interface OperatorStatus {
  /** The gateway's mode, version, configuration fingerprint, handler build ID and lifecycle state. */
  gateway: { mode: "development" | "production"; version: string; configFingerprint: string; handlerBuildId: string; state: string };
  /**
   * The incident store: `sqlite` (the durable journal at `path`) or `memory` (development without a state
   * directory; never durable, `path` null), with its size and limit in bytes and its schema version.
   */
  store: { kind: "sqlite" | "memory"; durable: boolean; path: string | null; sizeBytes: number; limitBytes: number; schemaVersion: number };
  /** The quarantine topic, or null when none is configured. Its Kafka settings are null until the topic has been described. */
  quarantine: { topic: string | null; maxMessageBytes: number | null; minInsyncReplicas: number | null; replicationFactor: number | null } | null;
  /** One entry per configured source. */
  sources: readonly OperatorSourceStatus[];
}

/** A reproduction bundle (spec §10, F40). Versioned; raw bytes only when explicitly requested. */
export interface ReproductionBundle {
  /** The bundle format version. */
  bundleVersion: 1;
  /** When the bundle was created (ISO 8601). */
  createdAt: string;
  /** The exporting gateway's mode, version, configuration fingerprint and handler build ID. */
  gateway: { mode: "development" | "production"; version: string; configFingerprint: string; handlerBuildId: string };
  /** The incident in full, without raw bytes. */
  incident: IncidentDetail;
  /** Recent traces of the incident's source, bounded. */
  traces: readonly Trace[];
  /** The source's current failure policy. */
  policy: OperatorSourceStatus["policy"];
  /** What a record of the incident's failure class is expected to satisfy, in words. */
  expectedBehavior: string;
  /** The supported next step, in words (the same text as `incident.explanation.nextAction`). */
  remedy: string;
  /** Whether the original bytes are included, where the evidence is kept, how complete it is, and a note explaining it. */
  evidence: { included: boolean; location: IncidentSummary["evidence"]["location"]; completeness: IncidentSummary["evidence"]["completeness"]; note: string };
  /** The original bytes, present only when `includeRaw` was requested. When they could not be read, `complete` is false and `note` says why. */
  raw?: RawEvidenceView;
}

/** Arguments of {@link OperatorApi.listFailures}. Every field is optional. */
export interface ListFailuresRequest {
  /** Only incidents of this source (at most 128 characters). */
  sourceId?: string;
  /** Which incidents to list; default "open". */
  state?: "open" | "resolved" | "all";
  /** Page size, 1 to {@link MAX_FAILURE_PAGE}; default 50. */
  limit?: number;
  /** The `nextCursor` of the previous page, to continue from it. */
  cursor?: string
}
/** Arguments of {@link OperatorApi.showFailure}. */
export interface ShowFailureRequest {
  /** The incident to show. */
  failureId: string;
  /** Also read back the original bytes; default false. The development management routes never return raw bytes. */
  includeRaw?: boolean
}
/** Arguments of {@link OperatorApi.exportFailure}. */
export interface ExportFailureRequest {
  /** The incident to export. */
  failureId: string;
  /** Also read back the original bytes into the bundle; default false. The development management routes refuse it. */
  includeRaw?: boolean
}
/** Arguments of {@link OperatorApi.retryCurrent}. */
export interface RetryCurrentRequest {
  /** The source paused at the record. */
  sourceId: string;
  /** The held incident on that source. */
  failureId: string;
  /** The incident revision you saw. A different current revision is refused as "stale-revision". */
  expectedRevision: number;
  /** Optional free text, at most {@link MAX_OPERATOR_REASON} characters, recorded in the incident's history. */
  reason?: string
}
/** Arguments of {@link OperatorApi.reassess}. */
export interface ReassessRequest {
  /** The source paused at the record. */
  sourceId: string;
  /** The held incident on that source. */
  failureId: string;
  /** The incident revision you saw. A different current revision is refused as "stale-revision". */
  expectedRevision: number
}
/** Arguments of {@link OperatorApi.reopenCircuit}. */
export interface ReopenCircuitRequest {
  /** The source whose circuit to close. */
  sourceId: string;
  /** The circuit revision you saw, from {@link OperatorSourceStatus}. A different current revision is refused as "stale-revision". */
  expectedCircuitRevision: number;
  /** What was corrected, at most {@link MAX_OPERATOR_REASON} characters. Recorded as the circuit's reason. */
  reason: string
}
/** Arguments of {@link OperatorApi.retireBoundary}. */
export interface RetireBoundaryRequest {
  /** The source the boundary belongs to. */
  sourceId: string;
  /** The boundary to retire (an ID starting with "rb1:"). */
  boundaryId: string;
  /** The boundary revision you saw, from {@link OperatorSourceStatus} or {@link IncidentDetail}. A different current revision is refused as "stale-revision". */
  expectedRevision: number;
  /** What was verified, at most {@link MAX_OPERATOR_REASON} characters. Recorded with the retirement. */
  reason: string
}
/** Arguments of {@link OperatorApi.evaluate}. */
export interface EvaluateRequest {
  /** The incident whose stored original record to evaluate. */
  failureId: string;
  /** The incident revision you saw. A different current revision is reported as ineligible ("stale-revision"). */
  expectedRevision: number
}
/** Arguments of {@link OperatorApi.redrive}. */
export interface RedriveRequest {
  /** The incident to redrive. */
  failureId: string;
  /** The plan ID from {@link EvaluationResult}'s `plan`. */
  planId: string;
  /** The plan fingerprint from the same plan. */
  planFingerprint: string;
  /** The incident revision the plan was issued at. A different current revision is refused as "stale-revision". */
  expectedRevision: number;
  /**
   * An idempotency key of at most 128 characters; generated when omitted. Sending the same ID again returns the
   * recorded result instead of running again; the same ID with a different request is refused as "operation-id-reused".
   */
  operationId?: string
}

/** The operator service. Every method resolves to the shape shown or rejects with a StreamOtterError (INVALID_REQUEST for malformed input). */
export interface OperatorApi {
  /** Reports the gateway, the incident store, the quarantine topic and the failure-handling state of every configured source. */
  status(): Promise<OperatorStatus>;
  /** Lists incidents one page at a time, oldest first. By default only open incidents, 50 per page. */
  listFailures(request: ListFailuresRequest): Promise<Page<IncidentSummary>>;
  /**
   * Returns one incident in full, with its history and a plain-language explanation. The original bytes are
   * read back and added as `raw` only when `includeRaw` is true. Rejects with INVALID_REQUEST for an unknown incident.
   */
  showFailure(request: ShowFailureRequest): Promise<IncidentDetail & { raw?: RawEvidenceView }>;
  /** Builds a {@link ReproductionBundle} for one incident, for a bug report. Rejects with INVALID_REQUEST for an unknown incident. */
  exportFailure(request: ExportFailureRequest): Promise<ReproductionBundle>;
  /**
   * Resumes a paused source at its held record so the record is processed again; it never skips the record.
   * Waits up to 15 seconds for the record to settle and reports `retried` (processed), `advanced`, `held`
   * (failed again) or `retrying` (not settled yet). Refused, for example, when the incident is not the held
   * record at the expected revision, an advance on the source is unresolved, or a quarantine-resync source's circuit is open.
   */
  retryCurrent(request: RetryCurrentRequest): Promise<OperationResult>;
  /**
   * Retries a held quarantine-resync incident so its recovery guard runs again, after a fresh acknowledged
   * quarantine copy and the circuit check. Only for an `invalid-json` or `payload-schema` incident whose recovery
   * is `held` or `denied`; it never overrides an integrity failure. Reports outcomes like {@link OperatorApi.retryCurrent}.
   */
  reassess(request: ReassessRequest): Promise<OperationResult>;
  /** Closes a source's open automatic-continuation circuit and clears its window. It approves no record; records already held stay held. */
  reopenCircuit(request: ReopenCircuitRequest): Promise<OperationResult>;
  /**
   * Retires a recovery boundary by hand, so snapshots stop acknowledging it. Only when the source's
   * `boundaryRetirement` is "operator", and refused while an incident the boundary covers is held or its advance
   * is unresolved. StreamOtter cannot check that snapshots reflect the quarantined record. Not offered by the
   * development management routes.
   */
  retireBoundary(request: RetireBoundaryRequest): Promise<OperationResult>;
  /**
   * Reads an incident's original record back and runs it through the current mapping without delivering it.
   * When a redrive would be allowed, issues a single-use plan valid for {@link PLAN_TTL_MS}. Rejects with
   * OVERLOADED when too many evaluations are running.
   */
  evaluate(request: EvaluateRequest): Promise<EvaluationResult>;
  /**
   * Executes an approved plan: rechecks it, reads the original record back, maps it again and admits the outputs
   * through the normal revision filter. The outcome is `reprocessed` when a subscription queued a frame, else
   * `superseded`. Nothing is published to Kafka and no offset moves.
   */
  redrive(request: RedriveRequest): Promise<OperationResult>;
}

/** The name of an {@link OperatorApi} method, as used in an IPC request's `op`. */
export type OperatorOperation = keyof OperatorApi;
/** The arguments of each operator operation, keyed by operation name. */
export interface OperatorRequests {
  /** {@link OperatorApi.status} takes no arguments: an empty object. */
  status: Record<string, never>;
  /** Arguments of {@link OperatorApi.listFailures}. */
  listFailures: ListFailuresRequest;
  /** Arguments of {@link OperatorApi.showFailure}. */
  showFailure: ShowFailureRequest;
  /** Arguments of {@link OperatorApi.exportFailure}. */
  exportFailure: ExportFailureRequest;
  /** Arguments of {@link OperatorApi.retryCurrent}. */
  retryCurrent: RetryCurrentRequest;
  /** Arguments of {@link OperatorApi.reassess}. */
  reassess: ReassessRequest;
  /** Arguments of {@link OperatorApi.reopenCircuit}. */
  reopenCircuit: ReopenCircuitRequest;
  /** Arguments of {@link OperatorApi.retireBoundary}. */
  retireBoundary: RetireBoundaryRequest;
  /** Arguments of {@link OperatorApi.evaluate}. */
  evaluate: EvaluateRequest;
  /** Arguments of {@link OperatorApi.redrive}. */
  redrive: RedriveRequest;
}

/** Every operator operation name. */
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

/** The local IPC protocol version, sent as `v` in every request and response. */
export const OPERATOR_IPC_VERSION = 1 as const;
/** Largest request line, including the trailing newline. */
export const OPERATOR_IPC_MAX_REQUEST_BYTES = 65_536;
/** Socket and token file names inside `<stateDirectory>/run/`. */
export const OPERATOR_SOCKET_FILE = "operator.sock";
/** The token file name inside `<stateDirectory>/run/`. The gateway writes a fresh token (mode 0600) on every start, and the client reads it from there. */
export const OPERATOR_TOKEN_FILE = "operator.token";

/**
 * One request on the local operator socket: a single UTF-8 JSON line of at most
 * {@link OPERATOR_IPC_MAX_REQUEST_BYTES}, terminated by a newline. One request per connection.
 */
export interface OperatorIpcRequest<O extends OperatorOperation = OperatorOperation> {
  /** The protocol version, {@link OPERATOR_IPC_VERSION}. */
  v: 1;
  /** A caller-chosen request ID of at most 128 characters, echoed in the response. */
  id: string;
  /** The token read from {@link OPERATOR_TOKEN_FILE}. */
  token: string;
  /** The operation to run. */
  op: O;
  /** The operation's arguments, checked with {@link validateOperatorRequest}. */
  args: OperatorRequests[O];
}
/**
 * The single JSON line the gateway answers with before it closes the connection: the operation's result in
 * `data`, or the error. `id` echoes the request's ID, or is "" when the request had no usable one.
 */
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

/** Whether a value is the name of an operator operation. */
export function isOperatorOperation(value: unknown): value is OperatorOperation {
  return typeof value === "string" && (OPERATOR_OPERATIONS as readonly string[]).includes(value);
}
