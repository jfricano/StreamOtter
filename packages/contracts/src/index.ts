/**
 * `@streamotter/contracts`: the public types, constants and validators that apps, the gateway and the
 * browser SDK share. Each name is listed so that adding to the public API is a deliberate change;
 * plumbing the packages share lives in `./internal.ts` (docs/releases/1.0.0/PUBLIC_API_TRIM.md).
 */
export type * from "./types.ts";
export {
  ERROR_CODES, isErrorCode, isStreamError, PUBLIC_MESSAGES, streamError, type StreamErrorOptions,
  StreamOtterError
} from "./errors.ts";
export {
  canonicalJson, canonicalJsonPretty, compareRevisions, IDENTIFIER_PATTERN, isIdentifier, isRevision,
  REVISION_PATTERN
} from "./primitives.ts";
export {
  canonicalizeParams, type CanonicalParamsResult, validateSchemaDefinition, validateValue, type ValueIssue
} from "./schema.ts";
export {
  DEFAULT_LIMITS
} from "./limits.ts";
export {
  CAPABILITIES, DEFAULT_SOCKET_PATH, EVENTS, PREVIEW_TOKEN_TTL_MS, PROTOCOL_VERSION
} from "./protocol.ts";
export {
  assertValidProjectConfig, type ConfigValidation, validateProjectConfig
} from "./config.ts";
export {
  type BoundaryRetirement, DEFAULT_AUTOMATIC_ADVANCE_LIMIT, FAILURE_CLASSES, type FailureClass,
  type FailureHandlingConfig, type FailurePolicy, policyFor, QUARANTINE_ELIGIBLE_CLASSES,
  type RecoveryBoundary, type RecoveryDecision, type RecoveryIncident, type ResolvedSourcePolicy,
  resolveSourcePolicy, type SourceFailurePolicy, type SourceRecoveryHandlers, TransientMappingError
} from "./failures.ts";
export {
  type EvaluateRequest, type EvaluationOutput, type EvaluationResult, type ExportFailureRequest,
  type IncidentDetail, type IncidentEvent, type IncidentEventName, type IncidentNextAction,
  type IncidentProgress, type IncidentQuarantine, type IncidentRecovery, type IncidentSummary,
  type ListFailuresRequest, type OperationResult, OPERATOR_MUTATIONS, OPERATOR_OPERATIONS, type OperatorApi,
  type OperatorOperation, type OperatorRequests, type OperatorSourceStatus, type OperatorStatus, PLAN_TTL_MS,
  type RawEvidenceView, type ReassessRequest, type RedriveRequest, type ReopenCircuitRequest,
  type ReproductionBundle, type RetireBoundaryRequest, type RetryCurrentRequest, type ShowFailureRequest
} from "./operator.ts";
export {
  isWorkbenchApiOrigin, isWorkbenchOperation, validateWorkbenchHostConfig, WORKBENCH_BOOT_ELEMENT_ID,
  WORKBENCH_HOST_CONTRACT, WORKBENCH_MOUNT_ELEMENT_ID, WORKBENCH_OPERATIONS, WORKBENCH_REQUEST_HEADER
} from "./workbench.ts";
