/**
 * `@streamotter/gateway/operator`: the V1.1 operator API (ADR-15C §1), reached
 * in-process with getGatewayOperator and over the local socket with
 * connectOperator. Never exposed to browsers.
 */
export type {
  EvaluateRequest, EvaluationResult, ExportFailureRequest, IncidentDetail, IncidentEvent, IncidentSummary, ListFailuresRequest,
  OperationResult, OperatorApi, OperatorStatus, RawEvidenceView, ReassessRequest, RedriveRequest, ReopenCircuitRequest,
  ReproductionBundle, RetireBoundaryRequest, RetryCurrentRequest, ShowFailureRequest
} from "@streamotter/contracts";
export { getGatewayOperator } from "./service.ts";
