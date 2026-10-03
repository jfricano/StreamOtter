/**
 * V1 public contract, wired to the implementation packages. See docs/V1_API.md.
 * The types are defined once in @streamotter/contracts; the functions are the real
 * gateway and SDK implementations. example.ts and type-tests.ts compile against it.
 */
export type {
  Awaitable, BoundaryRetirement, Capabilities, ChannelContract, ChannelHandlers, ChannelMap, ChannelSummary, Client, ClientOptions,
  ClientToServerEvents, ConfigIssue, ConnectionState, ControlRequest, DataFrame, DevelopmentOptions,
  DevelopmentPrincipalSummary, DiagnosticStep, ErrorCode, ErrorFrame, FailureClass, FailureHandlingConfig, FailurePolicy, FixtureRecord,
  Gateway, GatewayLogger, GatewayOptions,
  HandlerContext, HandlerRegistry, Hello, Json, KafkaConnection, Limits, ManagementOperations, MappedState, Page,
  Params, Principal, ProjectConfig, Receipt, RecoveryBoundary, RecoveryDecision, RecoveryIncident, Result, Revision,
  Revocation, Schema, SecretRef, ServerToClientEvents, SourceFailurePolicy, SourceRecoveryHandlers,
  SocketAuth, Source, SourceRecord, SourceStatus, StateChange, StreamError, StreamEvent, SubscribeRequest,
  Subscription, SubscriptionFrame, SubscriptionState, Trace, TraceStage, Unlisten, WaitOptions,
  WorkbenchDiscovery, WorkbenchHostConfig, WorkbenchHostManifest, WorkbenchOperation
} from "@streamotter/contracts";
export { createClient } from "@streamotter/client";
export { createGateway, defineProject, TransientMappingError } from "@streamotter/gateway";
