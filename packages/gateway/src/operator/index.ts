/**
 * `@streamotter/gateway/operator`: the V1.1 operator API (ADR-15C §1), reached
 * in-process with getGatewayOperator and over the local socket with
 * connectOperator. Never exposed to browsers.
 */
export type {
  EvaluateRequest, EvaluationOutput, EvaluationResult, ExportFailureRequest, FailureClass, IncidentDetail,
  IncidentEvent, IncidentEventName, IncidentNextAction, IncidentProgress, IncidentQuarantine, IncidentRecovery,
  IncidentSummary, ListFailuresRequest, OperationResult, OperatorApi, OperatorOperation, OperatorRequests,
  OperatorSourceStatus, OperatorStatus, Page, RawEvidenceView, ReassessRequest, RedriveRequest, ReopenCircuitRequest,
  ReproductionBundle, RetireBoundaryRequest, RetryCurrentRequest, ShowFailureRequest, SourceStatus, Trace, TraceStage
} from "@streamotter/contracts";
export { getGatewayOperator } from "./service.ts";
export { callOperator, connectOperator, type OperatorClientOptions, type OperatorResult } from "./ipc.ts";
