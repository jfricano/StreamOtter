/**
 * StreamOtter V1 public type contracts. docs/V1_API.md governs behavior; these
 * declarations govern public types. contracts/v1/api.ts re-exports them.
 */
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
  snapshot(input: HandlerContext & { principal: Principal; params: C["params"] }): Awaitable<{
    revision: Revision;
    data: C["data"];
  }>;
}
export interface HandlerRegistry<C extends ChannelMap> {
  authenticate(input: HandlerContext & { token: string; origin: string }): Awaitable<Principal | null>;
  channels: { readonly [K in keyof C]: ChannelHandlers<C[K]> };
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
export interface DevelopmentOptions {
  principals: Readonly<Record<string, Principal>>;
  fixtures: Readonly<Record<string, readonly { key: string | null; value: Json }[]>>;
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
}
