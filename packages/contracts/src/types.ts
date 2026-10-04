/**
 * StreamOtter V1 public type contracts. docs/V1_API.md governs behavior; these
 * declarations govern public types. contracts/v1/api.ts re-exports them.
 */
import type { FailureHandlingConfig, SourceRecoveryHandlers } from "./failures.ts";
import type {
  EvaluateRequest, EvaluationResult, IncidentDetail, IncidentSummary, ListFailuresRequest, OperationResult, OperatorStatus, ReassessRequest,
  RedriveRequest, ReopenCircuitRequest, ReproductionBundle, RetryCurrentRequest
} from "./operator.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Params = Readonly<Record<string, string | boolean | number>>;
export type Revision = string; // Canonical unsigned decimal; validated at runtime.
export type Unlisten = () => void;
export type Awaitable<T> = T | Promise<T>;

export interface ChannelContract<P extends Params = Params, D extends Json = Json, V extends number = number> {
  params: P;
  data: D;
  version: V;
}
export type ChannelMap = Record<string, ChannelContract>;

export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_PARAMS" | "CHANNEL_NOT_FOUND"
  | "CHANNEL_VERSION_UNSUPPORTED" | "SOURCE_UNAVAILABLE" | "INVALID_PAYLOAD"
  | "OVERLOADED" | "RESYNC_REQUIRED" | "UNSUPPORTED_CAPABILITY" | "INVALID_REQUEST"
  | "CONFIG_INVALID" | "TIMEOUT" | "CANCELLED" | "CLIENT_CLOSED"
  | "HANDLER_FAILED" | "REVISION_CONFLICT" | "TRACE_CURSOR_EXPIRED" | "INTERNAL";
export interface StreamError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  details?: Readonly<Record<string, Json>>;
}
export interface StreamEvent<D extends Json = Json> {
  id: string;
  channel: string;
  channelVersion: number;
  kind: "snapshot" | "update";
  data: D;
  revision: Revision;
  receivedAt: string;
}
export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "auth-required" | "closed";
export type SubscriptionState = "idle" | "authorizing" | "synchronizing" | "live" | "stale" | "resync-required" | "failed" | "closed";
export interface StateChange<S extends string> {
  state: S;
  reason?: ErrorCode;
}
export interface WaitOptions { timeoutMs?: number; signal?: AbortSignal }
export interface Subscription<D extends Json> {
  readonly id: string;
  readonly state: SubscriptionState;
  on(event: "data", listener: (event: StreamEvent<D>) => void): Unlisten;
  on(event: "state", listener: (state: StateChange<SubscriptionState>) => void): Unlisten;
  on(event: "error", listener: (error: StreamError) => void): Unlisten;
  ready(options?: WaitOptions): Promise<void>;
  resync(options?: WaitOptions): Promise<void>;
  unsubscribe(): Promise<void>;
}
export interface ClientOptions {
  origin?: string; // Absolute HTTP(S) origin; defaults to current browser origin.
  path?: string;   // Engine.IO HTTP path; default /streamotter/socket.io.
  getToken: (context: { signal: AbortSignal }) => Awaitable<string>;
}
export interface Client<C extends ChannelMap> {
  readonly state: ConnectionState;
  subscribe<K extends keyof C & string>(channel: K, options: {
    channelVersion: C[K]["version"];
    params: C[K]["params"];
  }): Subscription<C[K]["data"]>;
  on(event: "state", listener: (state: StateChange<ConnectionState>) => void): Unlisten;
  on(event: "error", listener: (error: StreamError) => void): Unlisten;
  reconnect(options?: WaitOptions): Promise<void>;
  close(): Promise<void>;
}

/** Deliberately limited JSON Schema dialect; see the specification. */
export type Schema =
  | { type: "string"; minLength?: number; maxLength?: number; enum?: readonly string[] }
  | { type: "number" | "integer"; minimum?: number; maximum?: number }
  | { type: "boolean" | "null" }
  | { type: "array"; items: Schema; maxItems: number }
  | { type: "object"; properties: Readonly<Record<string, Schema>>; required: readonly string[]; additionalProperties: false };
export type SecretRef = { env: string };
export interface KafkaConnection {
  brokers: readonly string[];
  tls: false | { caFile?: string };
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: SecretRef;
    password: SecretRef;
  };
}
export type Source = {
  kind: "kafka";
  generation: string;
  connectionRef: string;
  topics: readonly string[];
  consumerGroup: string;
  codec: "json";
  startFrom: "latest" | "earliest";
} | {
  kind: "fixture";
  generation: string;
  fixtureRef: string;
};
export interface Limits {
  maxConnections: number;
  maxSubscriptionsPerConnection: number;
  maxSourceRecordBytes: number;
  maxDataFrameBytes: number;
  maxParamsBytes: number;
  maxPendingFramesPerSubscription: number;
  maxPendingBytesPerSubscription: number;
  maxPendingBytesPerConnection: number;
  maxPendingBytesGateway: number;
  maxMapOutputs: number;
  maxConcurrentSnapshots: number;
  handlerTimeoutMs: number;
  snapshotTimeoutMs: number;
  receiptTimeoutMs: number;
  maxSyncAttempts: number;
  maxTraceEntries: number;
  maxTraceBytes: number;
  maxControlFrameBytes: number;
  controlRequestsPerSecond: number;
}
export type ProjectConfig<C extends ChannelMap = ChannelMap> = {
  configVersion: 1;
  projectId: string;
  gateway: {
    host: string;
    port: number;
    path: string;
    allowedOrigins: readonly string[];
  };
  connections: Readonly<Record<string, KafkaConnection>>;
  sources: Readonly<Record<string, Source>>;
  schemas: Readonly<Record<string, Schema>>;
  channels: {
    readonly [K in keyof C]: {
      version: C[K]["version"];
      source: string;
      paramsSchema: string;
      payloadSchema: string;
      handlersRef: K & string;
      delivery: { kind: "state"; overflow: "resync" };
    }
  };
  limits?: Partial<Limits>;
  /** V1.1 source-failure policies. Absent means V1 pause-on-failure behavior. */
  failureHandling?: FailureHandlingConfig;
};

export interface Principal {
  subject: string;
  tenantId: string;
  sessionId: string;
  expiresAt: string;
  claims: Readonly<Record<string, Json>>;
}
export interface HandlerContext { signal: AbortSignal; requestId: string }
export interface SourceRecord {
  id: string;
  sourceId: string;
  key: string | null;
  value: Json;
  receivedAt: string;
  position: { kind: "kafka"; topic: string; partition: number; offset: string }
    | { kind: "fixture"; index: string };
}
export interface MappedState<P extends Params, D extends Json> {
  tenantId: string;
  params: P;
  revision: Revision;
  data: D;
}
export interface ChannelHandlers<C extends ChannelContract> {
  authorize(input: HandlerContext & { principal: Principal; params: C["params"] }): Awaitable<boolean>;
  map(input: HandlerContext & { record: SourceRecord }): Awaitable<readonly MappedState<C["params"], C["data"]>[]>;
  snapshot(input: HandlerContext & {
    principal: Principal;
    params: C["params"];
    /** Present only while the channel's source has a recovery boundary in force (V1.1). */
    recovery?: { boundaryId: string; context: Json };
  }): Awaitable<{
    revision: Revision;
    data: C["data"];
    /** Must echo recovery.boundaryId when recovery was supplied, and be absent otherwise. */
    recoveryBoundaryId?: string;
  }>;
}
export interface HandlerRegistry<C extends ChannelMap> {
  authenticate(input: HandlerContext & { token: string; origin: string }): Awaitable<Principal | null>;
  channels: { readonly [K in keyof C]: ChannelHandlers<C[K]> };
  /** V1.1 recovery guards, keyed by the IDs of sources whose policy uses quarantine-resync. */
  sources?: Readonly<Record<string, SourceRecoveryHandlers>>;
}
export type Revocation =
  | { kind: "session"; tenantId: string; sessionId: string }
  | { kind: "subject"; tenantId: string; subject: string }
  | { kind: "channel"; tenantId: string; subject: string; channel: string; channelVersion: number; params?: Params };
export interface Gateway {
  start(): Promise<{ origin: string; path: string }>;
  stop(options?: { timeoutMs?: number }): Promise<void>;
  revoke(request: Revocation): Promise<{ closedSubscriptions: number; closedConnections: number }>;
  resumeSource(sourceId: string): Promise<void>;
}
/** Redacted operator diagnostics. Never receives credentials or payloads. */
export interface GatewayLogger {
  info(message: string, fields?: Readonly<Record<string, Json>>): void;
  warn(message: string, fields?: Readonly<Record<string, Json>>): void;
  error(message: string, fields?: Readonly<Record<string, Json>>): void;
}
/**
 * One fixture record: a JSON value, or raw text the gateway decodes exactly as it
 * decodes broker bytes, so malformed input can be rehearsed in development (V1.1).
 */
export type FixtureRecord = { key: string | null; value: Json } | { key: string | null; raw: string };

export interface DevelopmentOptions {
  principals: Readonly<Record<string, Principal>>;
  fixtures: Readonly<Record<string, readonly FixtureRecord[]>>;
}
export interface GatewayOptions<C extends ChannelMap> {
  config: ProjectConfig<C>;
  handlers: HandlerRegistry<C>;
  mode: "development" | "production";
  development?: DevelopmentOptions;
  /** Directory for resolving relative CA file paths; defaults to the process working directory. */
  configDir?: string;
  /** Operator diagnostics sink; defaults to structured console output. */
  logger?: GatewayLogger;
  /**
   * Persistent directory for the failure journal (V1.1). Required in production
   * when any source uses a quarantine policy; development without it uses a
   * non-durable in-memory incident store.
   */
  stateDirectory?: string;
  /** Declared identity of the handler build, recorded in incidents. Default "unspecified"; at most 128 characters. */
  handlerBuildId?: string;
  /**
   * Serve the local operator socket at `<stateDirectory>/run/operator.sock` (ADR-15C §3).
   * Requires stateDirectory. Default false.
   */
  operatorSocket?: boolean;
  /**
   * Serve a read-only health listener (ADR-15C §4): `GET /health/live` and `GET /health/ready`
   * on its own port, bound to 127.0.0.1 unless `host` says otherwise. Available with or
   * without failure handling. Off by default.
   */
  health?: HealthListenerOptions;
}

export interface HealthListenerOptions {
  /** Interface to bind. Default "127.0.0.1". */
  host?: string;
  /** TCP port, 0–65535; 0 picks a free port. */
  port: number;
}

/** Why readiness is unavailable. Categories only: never topic names, incident IDs or messages. */
export type HealthReason = "starting" | "source-held" | "source-unavailable" | "journal" | "quarantine";

/** The body of GET /health/live and GET /health/ready. */
export interface HealthResponse {
  status: "ok" | "unavailable";
  reasons: readonly HealthReason[];
}

export interface Capabilities {
  protocolVersion: 1;
  configVersions: readonly [1];
  transport: "socket.io";
  deliveryModes: readonly ["state"];
  operations: readonly ["subscribe", "unsubscribe", "resync", "receipt"];
}
export interface SubscribeRequest {
  requestId: string;
  subscriptionId: string;
  channel: string;
  channelVersion: number;
  params: Params;
}
export type ControlRequest = { requestId: string; subscriptionId: string };
export type Result<T> = { ok: true; requestId: string; data: T }
  | { ok: false; requestId: string; error: StreamError };
export interface DataFrame {
  subscriptionId: string;
  epoch: string;
  sequence: number;
  event: StreamEvent;
}
export interface SubscriptionFrame {
  subscriptionId: string;
  epoch: string;
  state: SubscriptionState;
  reason?: ErrorCode;
}
export interface Receipt { subscriptionId: string; epoch: string; sequence: number }
export type Hello = Capabilities & { connectionId: string; identityKey: string; authExpiresAt: string };
export interface ErrorFrame { subscriptionId?: string; epoch?: string; error: StreamError }
export interface ClientToServerEvents {
  "so:subscribe": (request: SubscribeRequest, reply: (result: Result<{ subscriptionId: string }>) => void) => void;
  "so:unsubscribe": (request: ControlRequest, reply: (result: Result<null>) => void) => void;
  "so:resync": (request: ControlRequest, reply: (result: Result<null>) => void) => void;
  "so:receipt": (receipt: Receipt) => void;
}
export interface ServerToClientEvents {
  "so:hello": (hello: Hello) => void;
  "so:state": (state: SubscriptionFrame) => void;
  "so:data": (frame: DataFrame) => void;
  "so:error": (error: ErrorFrame) => void;
}
export interface SocketAuth { token: string; protocolVersion: 1 }

export type TraceStage = "source" | "validate" | "map" | "authorize" | "snapshot" | "queue" | "send" | "receipt" | "commit";
export interface Trace {
  id: string;
  requestId: string;
  at: string;
  stage: TraceStage;
  outcome: "ok" | "filtered" | "rejected" | "failed";
  sourceId?: string;
  channel?: string;
  subscriptionId?: string;
  errorCode?: ErrorCode;
}
export interface Page<T> { items: readonly T[]; nextCursor: string | null }
export interface SourceStatus {
  sourceId: string;
  kind: Source["kind"];
  status: "starting" | "healthy" | "degraded" | "paused" | "stopped";
  reason?: ErrorCode;
}
export interface ChannelSummary {
  name: string;
  version: number;
  source: string;
  delivery: "state";
  paramsSchema: string;
  payloadSchema: string;
}
export interface ConfigIssue { path: string; message: string; code: string }
export interface DiagnosticStep {
  stage: "resolve" | "connect" | "tls" | "authenticate" | "metadata";
  outcome: "ok" | "failed" | "skipped";
  message: string;
}
export interface DevelopmentPrincipalSummary { ref: string; tenantId: string; subject: string }
/** Paths include their method. Every response below is wrapped in Result<T>. */
export interface ManagementOperations {
  "GET /management/v1/capabilities": { request: null; response: Capabilities };
  "GET /management/v1/health": { request: null; response: { ready: boolean; sources: readonly SourceStatus[] } };
  "GET /management/v1/sources": { request: null; response: { items: readonly SourceStatus[] } };
  "GET /management/v1/channels": { request: null; response: { items: readonly ChannelSummary[] } };
  "GET /management/v1/config": { request: null; response: { config: ProjectConfig; fingerprint: string } };
  "POST /management/v1/source-checks": { request: { sourceId: string }; response: { steps: readonly DiagnosticStep[] } };
  "POST /management/v1/config/validate": { request: { config: Json }; response: { valid: boolean; issues: readonly ConfigIssue[] } };
  "POST /management/v1/config/export": { request: { config: Json }; response: { filename: "streamotter.json"; content: string; fingerprint: string } };
  "GET /management/v1/traces": { request: { limit?: number; cursor?: string; sourceId?: string; channel?: string; outcome?: Trace["outcome"] }; response: Page<Trace> };
  "POST /management/v1/sources/resume": { request: { sourceId: string }; response: SourceStatus };
  "POST /management/v1/preview-sessions": { request: { fixturePrincipalRef: string }; response: { token: string; expiresAt: string; previewSessionId: string } };
  "GET /management/v1/dev/principals": { request: null; response: { items: readonly DevelopmentPrincipalSummary[] } };
  "POST /management/v1/dev/fixtures/advance": { request: { sourceId: string; count: number }; response: { advanced: number } };
  "POST /management/v1/dev/disconnect": { request: { previewSessionId: string }; response: null };
  /** WHC-1 capability discovery (docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md §4). */
  "GET /management/v1/workbench": { request: null; response: WorkbenchDiscovery };
  /** V1.1 operator routes (docs/releases/v1.1/V1_1_API.md §9): development only, never raw evidence. */
  "GET /management/v1/operator/status": { request: null; response: OperatorStatus };
  "GET /management/v1/failures": { request: ListFailuresRequest; response: Page<IncidentSummary> };
  "GET /management/v1/failures/{failureId}": { request: null; response: IncidentDetail };
  "POST /management/v1/failures/export": { request: { failureId: string }; response: ReproductionBundle };
  "POST /management/v1/failures/evaluate": { request: EvaluateRequest; response: EvaluationResult };
  "POST /management/v1/failures/redrive": { request: RedriveRequest; response: OperationResult };
  "POST /management/v1/sources/retry-current": { request: RetryCurrentRequest; response: OperationResult };
  "POST /management/v1/sources/reassess": { request: ReassessRequest; response: OperationResult };
  "POST /management/v1/sources/reopen-circuit": { request: ReopenCircuitRequest; response: OperationResult };
}

/**
 * Workbench host contract, version 1 (WHC-1): the closed vocabulary of operations a workbench
 * host can offer. `WORKBENCH_OPERATIONS` lists the same names at runtime. The failure and
 * operator names are V1.1 operations; a host lists them only when it implements them.
 * `sources.retire-boundary` is deliberately absent: it is a CLI-only action.
 */
export type WorkbenchOperation =
  | "capabilities" | "health" | "sources" | "channels" | "config" | "config.validate" | "config.export"
  | "traces" | "source-checks" | "sources.resume" | "preview-sessions" | "dev.principals"
  | "dev.fixtures.advance" | "dev.disconnect" | "workbench"
  | "operator.status" | "failures.list" | "failures.show" | "failures.export" | "failures.evaluate"
  | "failures.redrive" | "sources.retry-current" | "sources.reassess" | "sources.reopen-circuit";

/** Response of `GET {apiBase}/workbench` (WHC-1 §4). */
export interface WorkbenchDiscovery {
  hostContract: 1;
  /** The operations this host answers. Anything absent is shown as unavailable and never called. */
  operations: readonly WorkbenchOperation[];
  limits: { maxRequestBytes: number };
}

/**
 * The boot block a host page embeds as `<script type="application/json" id="streamotter-workbench-host">`
 * (WHC-1 §3). Unknown fields are refused; see `validateWorkbenchHostConfig`.
 */
export interface WorkbenchHostConfig {
  hostContract: 1;
  /**
   * Absolute path, no trailing slash, appended to the page's own origin, or to `apiOrigin` when
   * that is set. Default `/management/v1`.
   */
  apiBase?: string;
  /**
   * The exact origin of the API, when it is not the page's own (WHC-1 §3.4, revision 0.3): scheme,
   * host, and a port only when it is not the default, with no path, query, fragment or trailing
   * slash, such as `"https://api.example.com"`. Must be `https:`; `http:` only for `localhost`,
   * `127.0.0.1` or `[::1]`. Allowed only with `auth: { mode: "session" }`: the type cannot express
   * that coupling, so `validateWorkbenchHostConfig` enforces it. Requests then use CORS with
   * `credentials: "include"`, and the host must answer the preflight for the page's exact origin.
   */
  apiOrigin?: string;
  /** Default `{ mode: "token" }`, the native behavior. */
  auth?: { mode: "token" | "session" };
  /** The gateway the Preview tab connects to. When absent, Preview is unavailable. */
  gateway?: { origin: string; path?: string };
  /** Default `{ kind: "development" }`. `label` is required for `sandbox`. */
  environment?: {
    kind: "development" | "sandbox";
    label?: string;
    detail?: string;
    packageVersion?: string;
  };
}

/** One problem found in a boot block, with a JSON Pointer to the offending value. */
export interface WorkbenchHostConfigIssue { path: string; message: string }

/** `dist/workbench-host.json` in `@streamotter/workbench`, also exported as `@streamotter/workbench/host` (WHC-1 §2). */
export interface WorkbenchHostManifest {
  hostContract: 1;
  package: "@streamotter/workbench";
  version: string;
  /**
   * `style` is the native stylesheet, which styles the whole page. `hostStyle` (revision 0.3) is the
   * same rules with every selector scoped under `[data-streamotter-workbench]`, the attribute the
   * workbench sets on its mount element when a boot block is present; hosts link it instead.
   */
  entry: { script: string; style: string; hostStyle: string; icon: string };
  /** Subresource Integrity values (`sha384-…`) keyed by file name. */
  integrity: Readonly<Record<string, string>>;
  bootElementId: string;
  mountElementId: string;
  /**
   * Directive name to source list. `<api origin>`, `<gateway origin>` and `<gateway websocket origin>`
   * are placeholders the host replaces (or removes, when it sets no `apiOrigin` or names no gateway).
   */
  csp: Readonly<Record<string, readonly string[]>>;
}
