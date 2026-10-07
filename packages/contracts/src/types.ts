/**
 * StreamOtter V1 public type contracts. docs/V1_API.md governs behavior; these
 * declarations govern public types. contracts/v1/api.ts re-exports them.
 */
import type { FailureHandlingConfig, SourceRecoveryHandlers } from "./failures.ts";
import type {
  EvaluateRequest, EvaluationResult, IncidentDetail, IncidentSummary, ListFailuresRequest, OperationResult, OperatorStatus, ReassessRequest,
  RedriveRequest, ReopenCircuitRequest, ReproductionBundle, RetryCurrentRequest
} from "./operator.ts";

/**
 * Any JSON value. Numbers must be finite, and values the gateway validates may
 * nest at most 16 levels.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/**
 * Channel parameters: a flat object of strings, booleans and numbers that
 * selects one channel instance. Parameter schemas allow only required strings,
 * booleans and safe integers.
 */
export type Params = Readonly<Record<string, string | boolean | number>>;
/**
 * A state revision: a canonical unsigned decimal string matching
 * `0|[1-9][0-9]{0,38}`, validated at runtime. Revisions are compared numerically
 * and must increase within one channel instance.
 */
export type Revision = string;
/** Removes the listener it was returned for. Removal takes effect immediately, even during a dispatch. */
export type Unlisten = () => void;
/** A value, or a promise of one. Handlers may return either. */
export type Awaitable<T> = T | Promise<T>;

/**
 * The type-level contract of one channel: its parameter type, payload type and
 * deployed version. `streamotter generate` emits these as the `AppChannels` map.
 */
export interface ChannelContract<P extends Params = Params, D extends Json = Json, V extends number = number> {
  /** Parameters a subscriber supplies to select a channel instance. */
  params: P;
  /** The full state delivered in every snapshot and update. */
  data: D;
  /** The deployed channel version, a positive integer. Requests must name it exactly. */
  version: V;
}
/** Channel contracts keyed by channel name. The type parameter of the client, gateway and project configuration. */
export type ChannelMap = Record<string, ChannelContract>;

/**
 * Public error codes carried by {@link StreamError}.
 *
 * - `UNAUTHENTICATED`: no valid authentication, or it was rejected, expired or revoked.
 * - `FORBIDDEN`: the subscription or connection is not permitted. Unknown channels and versions, and in production
 *   parameters that fail the schema, also answer `FORBIDDEN`.
 * - `INVALID_PARAMS`: the parameters are not a JSON object, exceed `maxParamsBytes`, or (in development) fail the parameter schema.
 * - `CHANNEL_NOT_FOUND`: the channel is not configured. Shown only in operator traces and diagnostics.
 * - `CHANNEL_VERSION_UNSUPPORTED`: the requested channel version is not deployed. Shown only in operator traces and diagnostics.
 * - `SOURCE_UNAVAILABLE`: the source, the gateway or the connection to it is not available, so the view may be stale.
 *   Also used when a source operation conflicts with the source's current state.
 * - `INVALID_PAYLOAD`: source, mapped or snapshot data did not match its declared contract.
 * - `OVERLOADED`: a configured limit was reached; try again later.
 * - `RESYNC_REQUIRED`: automatic synchronization stopped; call {@link Subscription.resync}.
 * - `UNSUPPORTED_CAPABILITY`: the requested operation, option or protocol version is not supported.
 * - `INVALID_REQUEST`: the request is malformed, names an unknown resource (management answers 404), or conflicts
 *   with an earlier one or with the protocol.
 * - `CONFIG_INVALID`: the configuration or gateway options are invalid.
 * - `TIMEOUT`: an operation or wait did not finish before its deadline.
 * - `CANCELLED`: the operation was cancelled explicitly, for example through an `AbortSignal`.
 * - `CLIENT_CLOSED`: the SDK client is closed.
 * - `HANDLER_FAILED`: application code failed, such as a handler or a listener.
 * - `REVISION_CONFLICT`: the same revision was mapped to different data.
 * - `TRACE_CURSOR_EXPIRED`: the trace cursor no longer points into retained traces.
 * - `INTERNAL`: an unexpected runtime fault.
 */
export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_PARAMS" | "CHANNEL_NOT_FOUND"
  | "CHANNEL_VERSION_UNSUPPORTED" | "SOURCE_UNAVAILABLE" | "INVALID_PAYLOAD"
  | "OVERLOADED" | "RESYNC_REQUIRED" | "UNSUPPORTED_CAPABILITY" | "INVALID_REQUEST"
  | "CONFIG_INVALID" | "TIMEOUT" | "CANCELLED" | "CLIENT_CLOSED"
  | "HANDLER_FAILED" | "REVISION_CONFLICT" | "TRACE_CURSOR_EXPIRED" | "INTERNAL";
/**
 * The structured error every StreamOtter API uses. SDK promises reject with it and
 * error listeners receive it.
 */
export interface StreamError {
  /** What went wrong. */
  code: ErrorCode;
  /** A public, action-oriented message. Never contains topic names, secrets or payloads. */
  message: string;
  /** Whether another attempt under changed conditions can succeed. It is not permission to retry in a loop. */
  retryable: boolean;
  /**
   * Correlation ID of the request that failed. For gateway errors it matches the gateway's traces; SDK-detected
   * errors carry a locally generated ID. Empty when no request applies.
   */
  requestId: string;
  /** Optional structured detail, such as the `issues` list of a `CONFIG_INVALID` error. */
  details?: Readonly<Record<string, Json>>;
}
/**
 * One delivery of channel state. Both kinds carry the complete state, which
 * replaces whatever the subscriber held.
 */
export interface StreamEvent<D extends Json = Json> {
  /**
   * Delivery identity. Updates derive it from the source record and routing, so a
   * redelivered record keeps its ID; each snapshot attempt gets a fresh UUID.
   */
  id: string;
  /** Channel name. */
  channel: string;
  /** Channel version. */
  channelVersion: number;
  /** `snapshot` for the authoritative state returned by the snapshot handler, `update` for state mapped from a source record. */
  kind: "snapshot" | "update";
  /** The channel's full state. */
  data: D;
  /** Revision of this state. */
  revision: Revision;
  /** UTC RFC3339 time the gateway decoded the source record (update) or built the snapshot event (snapshot). */
  receivedAt: string;
}
/**
 * State of a {@link Client}'s connection.
 *
 * - `idle`: no connection; the client connects when a subscription needs one.
 * - `connecting`: obtaining a token and opening a connection.
 * - `connected`: authenticated; the gateway's hello has arrived.
 * - `reconnecting`: the connection was lost or could not be opened, and is retried with backoff while subscriptions are active.
 * - `auth-required`: the gateway refused the handshake (`UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_REQUEST` or
 *   `UNSUPPORTED_CAPABILITY`), or `getToken` failed, timed out or returned an empty string. Automatic retries stop
 *   until {@link Client.reconnect}.
 * - `closed`: {@link Client.close} was called. Permanent.
 */
export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "auth-required" | "closed";
/**
 * State of one {@link Subscription}.
 *
 * - `idle`: created, not yet started.
 * - `authorizing`: the subscribe or a retry is being validated and authorized.
 * - `synchronizing`: a new epoch started; the snapshot and buffered updates are being delivered.
 * - `live`: synchronized and receiving updates while the source is healthy. Not proof of wall-clock freshness.
 * - `stale`: the view may be out of date (source outage, transport loss, overflow or timeout). Synchronization resumes
 *   automatically once the cause clears, except while the client is `auth-required` (call {@link Client.reconnect}) or
 *   the source is paused (an operator must resume it).
 * - `resync-required`: automatic retries are exhausted; call {@link Subscription.resync}.
 * - `failed`: terminal, for example after denied access or a handler failure. Create a new subscription.
 * - `closed`: terminal after unsubscribe or client close.
 */
export type SubscriptionState = "idle" | "authorizing" | "synchronizing" | "live" | "stale" | "resync-required" | "failed" | "closed";
/** A state transition reported to state listeners. */
export interface StateChange<S extends string> {
  /** The new state. */
  state: S;
  /** Why the transition happened, when there is a specific cause. */
  reason?: ErrorCode;
}
/** Options for a wait such as {@link Subscription.ready}. Cancelling a wait never cancels the operation it waits for. */
export interface WaitOptions {
  /** How long to wait before rejecting with `TIMEOUT`. Default 30000 ms. */
  timeoutMs?: number;
  /** Rejects the wait with `CANCELLED` when aborted. */
  signal?: AbortSignal
}
/**
 * A browser subscription to one channel instance, returned by
 * {@link Client.subscribe}. Delivers full-state events and reports its
 * synchronization state.
 */
export interface Subscription<D extends Json> {
  /** Client-generated subscription ID. */
  readonly id: string;
  /** Current subscription state. */
  readonly state: SubscriptionState;
  /**
   * Listens for snapshots and updates. Events are not replayed to listeners added later.
   * A listener that throws or returns a rejected promise fails the subscription with `HANDLER_FAILED`.
   * @returns A function that removes the listener.
   */
  on(event: "data", listener: (event: StreamEvent<D>) => void): Unlisten;
  /**
   * Listens for state changes after this call; read {@link Subscription.state} for the current state.
   * A listener that throws or returns a rejected promise fails the subscription with `HANDLER_FAILED`.
   * @returns A function that removes the listener.
   */
  on(event: "state", listener: (state: StateChange<SubscriptionState>) => void): Unlisten;
  /**
   * Listens for errors reported for this subscription. Errors thrown by an error listener are logged, not emitted.
   * @returns A function that removes the listener.
   */
  on(event: "error", listener: (error: StreamError) => void): Unlisten;
  /**
   * Waits for the next `live` state; resolves at once if already live. Rejects with
   * `TIMEOUT` (default 30000 ms), `CANCELLED`, `RESYNC_REQUIRED`, `UNAUTHENTICATED`
   * while the client needs authentication, or the error that failed or closed the subscription.
   */
  ready(options?: WaitOptions): Promise<void>;
  /**
   * Starts a new synchronization and waits for `live` under the same rules as
   * {@link Subscription.ready}. Concurrent calls join one request. Recovers a
   * `resync-required` subscription; a failed or closed one must be replaced.
   */
  resync(options?: WaitOptions): Promise<void>;
  /**
   * Stops delivery immediately and resolves after the gateway confirms or the
   * transport closes, within 5000 ms. Idempotent.
   */
  unsubscribe(): Promise<void>;
}
/** Options for `createClient`. */
export interface ClientOptions {
  /** Absolute HTTP(S) origin of the gateway, without a path. Defaults to the current page's origin; required outside a browser. */
  origin?: string;
  /** Socket.IO HTTP path. Must start with `/`. Default `/streamotter/socket.io`. */
  path?: string;
  /**
   * Returns the token sent to the gateway's `authenticate` handler, for each new
   * connection and before the current token expires. Must resolve to a non-empty
   * string within 10000 ms; the signal aborts at that deadline or when the client
   * closes. A failure or timeout while connecting moves the client to `auth-required`.
   */
  getToken: (context: { signal: AbortSignal }) => Awaitable<string>;
}
/**
 * The browser SDK client. Owns one connection at a time, reconnects with backoff
 * while subscriptions are active, and recreates subscriptions with fresh
 * snapshots after reconnecting.
 */
export interface Client<C extends ChannelMap> {
  /** Current connection state. */
  readonly state: ConnectionState;
  /**
   * Creates an independent subscription to one channel instance. The subscription
   * starts in the next microtask, so listeners attached synchronously miss nothing.
   * @param channel - Channel name.
   * @param options - The channel version and parameters.
   * @throws `CLIENT_CLOSED` after {@link Client.close}; `INVALID_REQUEST` for malformed arguments; `UNSUPPORTED_CAPABILITY` for an unknown option.
   */
  subscribe<K extends keyof C & string>(channel: K, options: {
    channelVersion: C[K]["version"];
    params: C[K]["params"];
  }): Subscription<C[K]["data"]>;
  /**
   * Listens for connection state changes after this call.
   * @returns A function that removes the listener.
   */
  on(event: "state", listener: (state: StateChange<ConnectionState>) => void): Unlisten;
  /**
   * Listens for connection-level errors, such as handshake rejections, `getToken`
   * failures and an identity change on reconnect.
   * @returns A function that removes the listener.
   */
  on(event: "error", listener: (error: StreamError) => void): Unlisten;
  /**
   * Obtains a new token, replaces the connection and recreates active subscriptions
   * with fresh snapshots. The recovery action after `auth-required`; it does not revive
   * failed or closed subscriptions. Resolves when connected; rejects with `TIMEOUT`
   * (default 30000 ms), `CANCELLED`, `CLIENT_CLOSED` or the error that refused the connection.
   */
  reconnect(options?: WaitOptions): Promise<void>;
  /**
   * Closes every subscription and the connection and makes the client permanently
   * closed. Later `subscribe` and `reconnect` calls, and waits on its subscriptions, fail with
   * `CLIENT_CLOSED`. Idempotent.
   */
  close(): Promise<void>;
}

/** Deliberately limited JSON Schema dialect; see the specification. */
export type Schema =
  | {
    /** A string. */
    type: "string";
    /** Fewest characters, counted in Unicode code points. */
    minLength?: number;
    /** Most characters, counted in Unicode code points. */
    maxLength?: number;
    /** The only strings allowed; each must satisfy the length bounds. */
    enum?: readonly string[];
  }
  | {
    /** A finite number, or with `integer` a safe integer. */
    type: "number" | "integer";
    /** Smallest allowed value, inclusive. */
    minimum?: number;
    /** Largest allowed value, inclusive. */
    maximum?: number;
  }
  | {
    /** A boolean, or exactly `null`. */
    type: "boolean" | "null";
  }
  | {
    /** An array. */
    type: "array";
    /** The schema every item must match. */
    items: Schema;
    /** Most items allowed; required, since arrays must be bounded. */
    maxItems: number;
  }
  | {
    /** A plain object. */
    type: "object";
    /** The schema of each allowed property; any other property is rejected. */
    properties: Readonly<Record<string, Schema>>;
    /** Properties that must be present. */
    required: readonly string[];
    /** Must be `false`: objects never accept undeclared properties. */
    additionalProperties: false;
  };
/**
 * A reference to a secret held in an environment variable. Resolved at gateway
 * startup, which fails when the variable is missing; exports keep the reference.
 */
export type SecretRef = {
  /** Name of the environment variable. */
  env: string
};
/** A Kafka connection profile. In V1, all Kafka sources of a project must use the same profile. */
export interface KafkaConnection {
  /** Bootstrap brokers of one cluster, as `host:port`. */
  brokers: readonly string[];
  /**
   * `false` for plaintext, which is development-only. An object enables TLS with
   * system trust, or with `caFile`, a local path resolved against
   * {@link GatewayOptions.configDir}.
   */
  tls: false | { caFile?: string };
  /** Optional SASL authentication with credentials from environment variables. */
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: SecretRef;
    password: SecretRef;
  };
}
/**
 * A record source: a Kafka consumer, or a development fixture whose records
 * advance only on request. `generation` identifies the source's contents; change
 * it when topics are recreated, the cluster changes or fixture contents are replaced.
 */
export type Source = {
  /** A Kafka consumer. */
  kind: "kafka";
  /** Identifies the source's contents; change it when topics are recreated or the cluster changes. */
  generation: string;
  /** ID of the connection profile in {@link ProjectConfig.connections}. */
  connectionRef: string;
  /** The topics to consume. */
  topics: readonly string[];
  /** A consumer group dedicated to this source. */
  consumerGroup: string;
  /** How record values are decoded; V1 decodes JSON only. */
  codec: "json";
  /** Where to start on partitions without a committed offset. */
  startFrom: "latest" | "earliest";
} | {
  /** A development fixture whose records advance only on request. */
  kind: "fixture";
  /** Identifies the source's contents; change it when the fixture contents are replaced. */
  generation: string;
  /** Key of the records in {@link DevelopmentOptions.fixtures}. */
  fixtureRef: string;
};
/**
 * Runtime limits. Every value is a positive integer; timeouts are at most
 * 2147483647 ms. Defaults are starting bounds, not capacity claims; see
 * {@link DEFAULT_LIMITS}.
 */
export interface Limits {
  /** Concurrent client connections, including handshakes in progress. Default 1000. */
  maxConnections: number;
  /** Subscriptions per connection; more are refused with `OVERLOADED`. Default 50. */
  maxSubscriptionsPerConnection: number;
  /** Largest source record value in bytes; a larger record pauses its source. Default 1048576. */
  maxSourceRecordBytes: number;
  /** Largest serialized data frame in bytes. At least 1024 and at most `maxPendingBytesPerSubscription`. Default 65536. */
  maxDataFrameBytes: number;
  /** Largest encoded subscription parameters in bytes; larger is `INVALID_PARAMS`. At most `maxControlFrameBytes`. Default 4096. */
  maxParamsBytes: number;
  /** Frames queued for one subscription; overflow makes it `stale` and resynchronizes it. Default 100. */
  maxPendingFramesPerSubscription: number;
  /** Bytes queued for one subscription. At most `maxPendingBytesPerConnection`. Default 1048576. */
  maxPendingBytesPerSubscription: number;
  /**
   * Bytes queued across one connection's subscriptions (over it, a subscription overflows and resynchronizes), and
   * the most unsent transport output a connection may hold before it is closed. At most `maxPendingBytesGateway`.
   * Default 4194304.
   */
  maxPendingBytesPerConnection: number;
  /** Bytes queued across the gateway. Not a bound on process memory. Default 67108864. */
  maxPendingBytesGateway: number;
  /** Outputs one `map` call may return for one record. Default 100. */
  maxMapOutputs: number;
  /** Snapshot handlers running at once; others wait within `snapshotTimeoutMs`. Default 32. */
  maxConcurrentSnapshots: number;
  /** Deadline for `authenticate`, `authorize` and `map` calls. Default 2000 ms. */
  handlerTimeoutMs: number;
  /** Deadline for a snapshot, including the wait for a snapshot slot. Default 10000 ms. */
  snapshotTimeoutMs: number;
  /** How long the gateway waits for the SDK's receipt of a data frame before closing the connection. Default 5000 ms. */
  receiptTimeoutMs: number;
  /** Synchronization attempts per incident before a subscription enters `resync-required`. Default 3. */
  maxSyncAttempts: number;
  /** Trace entries retained in memory; the oldest are dropped. Default 10000. */
  maxTraceEntries: number;
  /** Bytes of trace metadata retained in memory. Default 8388608. */
  maxTraceBytes: number;
  /** Largest incoming Socket.IO frame in bytes, including the handshake. At least 9216. Default 16384. */
  maxControlFrameBytes: number;
  /** Control requests per second per connection, with a burst of twice this value. Default 20. */
  controlRequestsPerSecond: number;
}
/**
 * The portable project configuration, `streamotter.json`. Holds no application
 * functions; handlers are supplied separately through {@link HandlerRegistry}.
 */
export type ProjectConfig<C extends ChannelMap = ChannelMap> = {
  /** Configuration format version. Always 1. */
  configVersion: 1;
  /** Project identifier, matching `[A-Za-z][A-Za-z0-9_-]{0,63}`. */
  projectId: string;
  /** Where the gateway listens and which browser origins it accepts. */
  gateway: {
    /** Interface to bind. */
    host: string;
    /** TCP port, 0–65535. */
    port: number;
    /** Socket.IO HTTP path. */
    path: string;
    /** Exact origins allowed to connect, such as `https://app.example.com`. No wildcards. */
    allowedOrigins: readonly string[];
  };
  /** Kafka connection profiles keyed by ID. */
  connections: Readonly<Record<string, KafkaConnection>>;
  /** Sources keyed by ID. */
  sources: Readonly<Record<string, Source>>;
  /** Schemas keyed by ID, referenced by channels. */
  schemas: Readonly<Record<string, Schema>>;
  /** Channels keyed by name, one per entry of the channel map. */
  channels: {
    readonly [K in keyof C]: {
      /** The deployed version, a positive integer. */
      version: C[K]["version"];
      /** ID of the source the channel maps from. */
      source: string;
      /** ID of the parameter schema: a closed object of required strings, booleans or safe integers. */
      paramsSchema: string;
      /** ID of the payload schema. */
      payloadSchema: string;
      /** Name of the entry in {@link HandlerRegistry.channels}. Must equal the channel name in V1. */
      handlersRef: K & string;
      /** Delivery mode. Only current-state delivery with resynchronization on overflow exists in V1. */
      delivery: { kind: "state"; overflow: "resync" };
    }
  };
  /** Overrides of the default {@link Limits}. */
  limits?: Partial<Limits>;
  /** V1.1 source-failure policies. Absent means V1 pause-on-failure behavior. */
  failureHandling?: FailureHandlingConfig;
};

/** A verified identity returned by the `authenticate` handler. */
export interface Principal {
  /** Non-empty user or service identifier within the tenant, at most 512 characters. */
  subject: string;
  /** Non-empty tenant identifier, at most 512 characters. Routing never accepts a tenant from the browser. */
  tenantId: string;
  /** Non-empty session identifier, at most 512 characters, matched by session revocations. */
  sessionId: string;
  /** UTC RFC3339 expiry, which must be in the future. Delivery stops when it passes. */
  expiresAt: string;
  /** Application claims as a JSON object, available to `authorize` and `snapshot`. */
  claims: Readonly<Record<string, Json>>;
}
/** Context every handler receives. */
export interface HandlerContext {
  /** Aborted when the call times out or its result is no longer wanted; stop work when it fires. */
  signal: AbortSignal;
  /** Correlation ID shared with traces and errors for this request. */
  requestId: string
}
/** One decoded record from a source, passed to `map`. */
export interface SourceRecord {
  /** Stable SHA-256 identity derived from the project, source, generation and position. */
  id: string;
  /** ID of the source the record came from. */
  sourceId: string;
  /** The record key decoded as UTF-8, or null when the record has none. */
  key: string | null;
  /** The decoded JSON value. */
  value: Json;
  /** UTC RFC3339 time the gateway decoded the record. */
  receivedAt: string;
  /** Kafka topic, partition and offset (a decimal string), or the zero-based fixture index as a decimal string. */
  position: { kind: "kafka"; topic: string; partition: number; offset: string }
    | { kind: "fixture"; index: string };
}
/** One output of a `map` handler: the full state of one channel instance. */
export interface MappedState<P extends Params, D extends Json> {
  /** Tenant that owns this state, supplied by trusted mapping code. Non-empty, at most 512 characters. */
  tenantId: string;
  /** Parameters of the channel instance, validated against the channel's parameter schema. */
  params: P;
  /**
   * Revision of this state. A revision older than a subscriber's current state is discarded;
   * the same revision with different data is a `REVISION_CONFLICT`.
   */
  revision: Revision;
  /** The full state, validated against the channel's payload schema. */
  data: D;
}
/** The trusted server handlers of one channel. */
export interface ChannelHandlers<C extends ChannelContract> {
  /**
   * Decides whether a principal may receive a channel instance. Runs at subscribe, at
   * every synchronization attempt and just before a snapshot is delivered. Any
   * result but `true` fails the subscription with `FORBIDDEN`; a throw fails it with
   * `HANDLER_FAILED`.
   */
  authorize(input: HandlerContext & { principal: Principal; params: C["params"] }): Awaitable<boolean>;
  /**
   * Maps one source record to the channel states it changes. An empty array filters
   * the record. A throw, a timeout or invalid routing pauses the source at that record.
   * Only mapped data that fails the payload schema can be quarantined instead, under a
   * V1.1 `invalidPublicPayload` policy. Throw {@link TransientMappingError} to request up
   * to `transientMapperRetries` retries where the source's policy allows them.
   */
  map(input: HandlerContext & { record: SourceRecord }): Awaitable<readonly MappedState<C["params"], C["data"]>[]>;
  /**
   * Returns the authoritative full state of one channel instance. Must not apply
   * per-user redaction that `map` cannot reproduce. Bounded by `snapshotTimeoutMs`.
   */
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
/** The trusted server code a gateway runs: authentication and the handlers of every channel. */
export interface HandlerRegistry<C extends ChannelMap> {
  /**
   * Verifies a connection's token. Returns the principal, or null to refuse with
   * `UNAUTHENTICATED`. `origin` is the request's verified origin (empty when a
   * development client sent none). A throw or timeout refuses with `HANDLER_FAILED`.
   */
  authenticate(input: HandlerContext & { token: string; origin: string }): Awaitable<Principal | null>;
  /** Handlers keyed by channel name. */
  channels: { readonly [K in keyof C]: ChannelHandlers<C[K]> };
  /** V1.1 recovery guards, keyed by the IDs of sources whose policy uses quarantine-resync. */
  sources?: Readonly<Record<string, SourceRecoveryHandlers>>;
}
/**
 * Selects what {@link Gateway.revoke} invalidates, always within one tenant.
 *
 * - `session`: every connection of one session.
 * - `subject`: every connection of one subject.
 * - `channel`: one subject's subscriptions to a channel version, narrowed to one instance when `params` is given.
 */
export type Revocation =
  | {
    /** Every connection of one session. */
    kind: "session";
    /** The tenant the session belongs to. */
    tenantId: string;
    /** The {@link Principal.sessionId} to revoke. */
    sessionId: string;
  }
  | {
    /** Every connection of one subject. */
    kind: "subject";
    /** The tenant the subject belongs to. */
    tenantId: string;
    /** The {@link Principal.subject} to revoke. */
    subject: string;
  }
  | {
    /** One subject's subscriptions to a channel version. */
    kind: "channel";
    /** The tenant the subject belongs to. */
    tenantId: string;
    /** The {@link Principal.subject} whose subscriptions are revoked. */
    subject: string;
    /** The channel name. */
    channel: string;
    /** The channel version. */
    channelVersion: number;
    /** Narrows the revocation to the one instance with these parameters. */
    params?: Params;
  };
/** A gateway instance, created by `createGateway` without opening any connections. */
export interface Gateway {
  /**
   * Opens the listener and source consumers. Resolves with the listening origin and
   * Socket.IO path once every source is ready; on failure, or after 30000 ms, rolls back
   * and rejects. Concurrent calls share one start. A stopped gateway cannot restart.
   */
  start(): Promise<{ origin: string; path: string }>;
  /**
   * Stops accepting subscriptions, aborts handlers, stops consumers, commits only
   * completed processing and closes connections. Past `timeoutMs` (default 10000 ms)
   * it closes connections and the port at once. Idempotent.
   */
  stop(options?: { timeoutMs?: number }): Promise<void>;
  /**
   * Invalidates matching subscriptions at once and, for `session` and `subject`
   * selectors, closes matching connections. Update the application's own session
   * policy first, so a reconnect cannot restore access.
   * @returns How many subscriptions and connections were closed.
   * Rejects with `INVALID_REQUEST` for a malformed selector.
   */
  revoke(request: Revocation): Promise<{ closedSubscriptions: number; closedConnections: number }>;
  /**
   * Retries a paused source at its held record, after the cause was fixed. Never
   * skips the record; already healthy is a no-op. Rejects with `INVALID_REQUEST` for an
   * unknown source, and with `SOURCE_UNAVAILABLE` when the gateway is not running, when
   * the source is starting, degraded or stopped, or (V1.1) when an advance is unresolved
   * or the source's circuit is open.
   */
  resumeSource(sourceId: string): Promise<void>;
}
/** Redacted operator diagnostics. Never receives credentials or payloads. */
export interface GatewayLogger {
  /** Records routine lifecycle information. */
  info(message: string, fields?: Readonly<Record<string, Json>>): void;
  /** Records a recoverable problem, such as a paused source or a failed handler. */
  warn(message: string, fields?: Readonly<Record<string, Json>>): void;
  /** Records a failure that needs operator attention. */
  error(message: string, fields?: Readonly<Record<string, Json>>): void;
}
/**
 * One fixture record: a JSON value, or raw text the gateway decodes exactly as it
 * decodes broker bytes, so malformed input can be rehearsed in development (V1.1).
 */
export type FixtureRecord = {
  /** The record key, or null for none. */
  key: string | null;
  /** The record value as JSON. */
  value: Json;
} | {
  /** The record key, or null for none. */
  key: string | null;
  /** The record value as text, decoded like broker bytes. */
  raw: string;
};

/** Development-only principals and fixture records. Rejected in production. */
export interface DevelopmentOptions {
  /** Principals keyed by reference, for preview sessions created through the management API. */
  principals: Readonly<Record<string, Principal>>;
  /** Fixture records keyed by a fixture source's `fixtureRef`, advanced in array order on request. */
  fixtures: Readonly<Record<string, readonly FixtureRecord[]>>;
}
/** Options for `createGateway`. */
export interface GatewayOptions<C extends ChannelMap> {
  /** The project configuration; `createGateway` validates it. */
  config: ProjectConfig<C>;
  /** The trusted server handlers. */
  handlers: HandlerRegistry<C>;
  /** `production` rejects development options, fixture sources and plaintext Kafka, and requires a browser origin. */
  mode: "development" | "production";
  /** Development principals and fixtures. Only valid in development mode. */
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
   * Requires stateDirectory and failureHandling. Default false.
   */
  operatorSocket?: boolean;
  /**
   * Serve a read-only health listener (ADR-15C §4): `GET /health/live` and `GET /health/ready`
   * on its own port, bound to 127.0.0.1 unless `host` says otherwise. Available with or
   * without failure handling. Off by default.
   */
  health?: HealthListenerOptions;
}

/** Where the read-only health listener binds; see {@link GatewayOptions.health}. */
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
  /** `ok` with HTTP 200, or `unavailable` with HTTP 503. */
  status: "ok" | "unavailable";
  /** Why readiness is unavailable, in a fixed order; empty when `ok`. */
  reasons: readonly HealthReason[];
}

/** What a gateway supports, sent in the hello and by `GET /management/v1/capabilities`. */
export interface Capabilities {
  /** Socket.IO protocol version. */
  protocolVersion: 1;
  /** Supported `configVersion` values. */
  configVersions: readonly [1];
  /** Browser transport. */
  transport: "socket.io";
  /** Supported delivery modes. */
  deliveryModes: readonly ["state"];
  /** Supported client operations. */
  operations: readonly ["subscribe", "unsubscribe", "resync", "receipt"];
}
/** Wire body of `so:subscribe`. */
export interface SubscribeRequest {
  /** Client-generated UUID for this request. */
  requestId: string;
  /** Client-generated UUID for the subscription, scoped to the connection. */
  subscriptionId: string;
  /** Channel name. */
  channel: string;
  /** Channel version. */
  channelVersion: number;
  /** Channel parameters. */
  params: Params;
}
/** Wire body of `so:unsubscribe` and `so:resync`. */
export type ControlRequest = {
  /** Client-generated UUID for this request. */
  requestId: string;
  /** The subscription the request applies to. */
  subscriptionId: string
};
/** Reply envelope for control requests and management responses. */
export type Result<T> = {
  /** The request succeeded. */
  ok: true;
  /** Correlation ID of the request. */
  requestId: string;
  /** The response. */
  data: T;
} | {
  /** The request failed. */
  ok: false;
  /** Correlation ID of the request. */
  requestId: string;
  /** Why it failed. */
  error: StreamError;
};
/** Wire body of `so:data`: one event for a subscription. */
export interface DataFrame {
  /** The subscription the event is for. */
  subscriptionId: string;
  /** Opaque synchronization epoch; frames from an older epoch are ignored. */
  epoch: string;
  /** Position within the epoch, starting at 1 and increasing by one. */
  sequence: number;
  /** The delivered event. */
  event: StreamEvent;
}
/** Wire body of `so:state`: a subscription state change. */
export interface SubscriptionFrame {
  /** The subscription that changed state. */
  subscriptionId: string;
  /** The epoch the state belongs to; `synchronizing` starts a new one. Empty before the first epoch. */
  epoch: string;
  /** The new state. */
  state: SubscriptionState;
  /** Why the state changed, when there is a specific cause. */
  reason?: ErrorCode;
}
/** Wire body of `so:receipt`: the SDK confirms it validated and dispatched a data frame. */
export interface Receipt {
  /** The subscription the frame was for. */
  subscriptionId: string;
  /** The frame's epoch. */
  epoch: string;
  /** The frame's sequence number. */
  sequence: number
}
/**
 * Wire body of `so:hello`, sent after authentication: the gateway's
 * {@link Capabilities}, a connection ID, an opaque `identityKey` that changes only
 * when the tenant or subject changes, and `authExpiresAt`, the principal's expiry.
 */
export type Hello = Capabilities & {
  /** The gateway's ID for this connection. */
  connectionId: string;
  /** Opaque identity that changes only when the tenant or subject changes. */
  identityKey: string;
  /** UTC RFC3339 time the principal's authentication expires. */
  authExpiresAt: string;
};
/** Wire body of `so:error`. */
export interface ErrorFrame {
  /** The affected subscription, when the error concerns one. */
  subscriptionId?: string;
  /** The affected epoch, when known. */
  epoch?: string;
  /** The error. */
  error: StreamError
}
/** Socket.IO events the SDK sends to the gateway. */
export interface ClientToServerEvents {
  /** Subscribes; the callback acknowledges before any state or data frame for the subscription. */
  "so:subscribe": (request: SubscribeRequest, reply: (result: Result<{ subscriptionId: string }>) => void) => void;
  /** Removes a subscription; an absent subscription is success. */
  "so:unsubscribe": (request: ControlRequest, reply: (result: Result<null>) => void) => void;
  /** Requests a fresh synchronization; the callback confirms it was accepted. */
  "so:resync": (request: ControlRequest, reply: (result: Result<null>) => void) => void;
  /** Confirms receipt of a data frame. */
  "so:receipt": (receipt: Receipt) => void;
}
/** Socket.IO events the gateway sends to the SDK. */
export interface ServerToClientEvents {
  /** Sent once after authentication, within ten seconds of connecting. */
  "so:hello": (hello: Hello) => void;
  /** A subscription state change. */
  "so:state": (state: SubscriptionFrame) => void;
  /** A snapshot or update for a subscription. */
  "so:data": (frame: DataFrame) => void;
  /** An error for a subscription or the connection. */
  "so:error": (error: ErrorFrame) => void;
}
/** The Socket.IO authentication payload. Tokens never go in the URL. */
export interface SocketAuth {
  /** A non-empty token of at most 8 KiB, passed to `authenticate`. */
  token: string;
  /** Must be 1. */
  protocolVersion: 1
}

/**
 * Pipeline stage a {@link Trace} records.
 *
 * - `source`: a record arrived from a source.
 * - `validate`: the record was decoded and checked.
 * - `map`: a channel's `map` handler ran.
 * - `authorize`: a handshake or `authorize` check ran.
 * - `snapshot`: a snapshot was taken, rejected or failed.
 * - `queue`: a state was admitted to, filtered from or rejected by a subscription's queue.
 * - `send`: a data frame was sent.
 * - `receipt`: the SDK's receipt arrived or timed out.
 * - `commit`: the source committed its progress.
 */
export type TraceStage = "source" | "validate" | "map" | "authorize" | "snapshot" | "queue" | "send" | "receipt" | "commit";
/** Metadata about one pipeline step, retained in memory for diagnostics. Never contains payloads or credentials. */
export interface Trace {
  /** Trace ID, unique within the gateway run. */
  id: string;
  /** Correlation ID shared by the traces of one request or record. */
  requestId: string;
  /** UTC RFC3339 time the trace was recorded. */
  at: string;
  /** Pipeline stage. */
  stage: TraceStage;
  /** `ok`; `filtered` when nothing was delivered by design; `rejected` by a check or policy; `failed` by an error or timeout. */
  outcome: "ok" | "filtered" | "rejected" | "failed";
  /** Source involved, when any. */
  sourceId?: string;
  /** Channel involved, when any. */
  channel?: string;
  /** Subscription involved, when any. */
  subscriptionId?: string;
  /** Error code for a non-`ok` outcome, when one applies. */
  errorCode?: ErrorCode;
}
/** One page of a paginated result. */
export interface Page<T> {
  /** Items of this page. */
  items: readonly T[];
  /** Opaque cursor for the next page, or null when there are no more. Trace pages always return one, so callers can poll. */
  nextCursor: string | null
}
/** Status of one source, reported by management routes. */
export interface SourceStatus {
  /** Source ID. */
  sourceId: string;
  /** Source kind. */
  kind: Source["kind"];
  /**
   * - `starting`: not ready yet.
   * - `healthy`: consuming normally.
   * - `degraded`: temporarily unavailable, for example during a broker outage or rebalance.
   * - `paused`: held at a record it could not process or (V1.1) behind another held record; see {@link Gateway.resumeSource}.
   * - `stopped`: the gateway stopped it.
   */
  status: "starting" | "healthy" | "degraded" | "paused" | "stopped";
  /** The cause when not healthy, such as `REVISION_CONFLICT` or `SOURCE_UNAVAILABLE`. */
  reason?: ErrorCode;
}
/** A deployed channel, as listed by `GET /management/v1/channels`. */
export interface ChannelSummary {
  /** Channel name. */
  name: string;
  /** Deployed version. */
  version: number;
  /** Source ID. */
  source: string;
  /** Delivery mode. */
  delivery: "state";
  /** ID of the parameter schema. */
  paramsSchema: string;
  /** ID of the payload schema. */
  payloadSchema: string;
}
/** One configuration validation problem. */
export interface ConfigIssue {
  /** JSON Pointer to the offending value; empty for the whole configuration. */
  path: string;
  /** Human-readable explanation. */
  message: string;
  /** Machine-readable category, such as `REQUIRED`, `UNKNOWN_KEY` or `INVALID_VALUE`. */
  code: string
}
/** One stage of a source connectivity check (`POST /management/v1/source-checks`). */
export interface DiagnosticStep {
  /** Resolving the profile and broker hosts, TCP connect, TLS handshake, SASL authentication, or topic metadata. */
  stage: "resolve" | "connect" | "tls" | "authenticate" | "metadata";
  /** Result of the stage; `skipped` when it does not apply or an earlier stage failed. */
  outcome: "ok" | "failed" | "skipped";
  /** Redacted explanation. */
  message: string;
}
/** A registered development principal, without its claims. */
export interface DevelopmentPrincipalSummary {
  /** Key in {@link DevelopmentOptions.principals}, used to create a preview session. */
  ref: string;
  /** The principal's tenant. */
  tenantId: string;
  /** The principal's subject. */
  subject: string
}
/** Paths include their method. Every response below is wrapped in Result<T>. */
export interface ManagementOperations {
  /** Supported protocol and configuration versions and operations. */
  "GET /management/v1/capabilities": { request: null; response: Capabilities };
  /** Whether the gateway is running with every source healthy, and each source's status. Answers 200 even when not ready. */
  "GET /management/v1/health": { request: null; response: { ready: boolean; sources: readonly SourceStatus[] } };
  /** Status of every source. Never includes resolved secrets. */
  "GET /management/v1/sources": { request: null; response: { items: readonly SourceStatus[] } };
  /** Deployed channel summaries. */
  "GET /management/v1/channels": { request: null; response: { items: readonly ChannelSummary[] } };
  /** The active configuration and its SHA-256 fingerprint. */
  "GET /management/v1/config": { request: null; response: { config: ProjectConfig; fingerprint: string } };
  /** Staged connectivity check of a configured source. Ten-second deadline. */
  "POST /management/v1/source-checks": { request: { sourceId: string }; response: { steps: readonly DiagnosticStep[] } };
  /** Validates a candidate configuration without running handlers or connecting. An invalid configuration is still a 200 response. */
  "POST /management/v1/config/validate": { request: { config: Json }; response: { valid: boolean; issues: readonly ConfigIssue[] } };
  /** Validates a candidate configuration and returns its canonical JSON and fingerprint. Writes nothing. */
  "POST /management/v1/config/export": { request: { config: Json }; response: { filename: "streamotter.json"; content: string; fingerprint: string } };
  /** Recent traces, filtered and paginated. Default 100, at most 500 items; an expired cursor answers 410 `TRACE_CURSOR_EXPIRED`. */
  "GET /management/v1/traces": { request: { limit?: number; cursor?: string; sourceId?: string; channel?: string; outcome?: Trace["outcome"] }; response: Page<Trace> };
  /** Retries a paused source at its held record; see {@link Gateway.resumeSource}. */
  "POST /management/v1/sources/resume": { request: { sourceId: string }; response: SourceStatus };
  /** Mints a preview token, valid for at most five minutes, for a registered development principal. */
  "POST /management/v1/preview-sessions": { request: { fixturePrincipalRef: string }; response: { token: string; expiresAt: string; previewSessionId: string } };
  /** Registered development principals, without claims. */
  "GET /management/v1/dev/principals": { request: null; response: { items: readonly DevelopmentPrincipalSummary[] } };
  /** Processes the next 1 to 100 records of a fixture source; returns how many advanced. */
  "POST /management/v1/dev/fixtures/advance": { request: { sourceId: string; count: number }; response: { advanced: number } };
  /** Disconnects the connections of one preview session. */
  "POST /management/v1/dev/disconnect": { request: { previewSessionId: string }; response: null };
  /** WHC-1 capability discovery (docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md §4). */
  "GET /management/v1/workbench": { request: null; response: WorkbenchDiscovery };
  /** V1.1 operator routes (docs/releases/v1.1/V1_1_API.md §9): development only, never raw evidence. */
  "GET /management/v1/operator/status": { request: null; response: OperatorStatus };
  /** Lists source-failure incidents (V1.1). */
  "GET /management/v1/failures": { request: ListFailuresRequest; response: Page<IncidentSummary> };
  /** One incident in detail, without raw evidence (V1.1). */
  "GET /management/v1/failures/{failureId}": { request: null; response: IncidentDetail };
  /** A reproduction bundle for one incident, without raw evidence (V1.1). */
  "POST /management/v1/failures/export": { request: { failureId: string }; response: ReproductionBundle };
  /** Runs an incident's stored record through the current handlers without admitting anything (V1.1). */
  "POST /management/v1/failures/evaluate": { request: EvaluateRequest; response: EvaluationResult };
  /** Admits an evaluated record's outputs under the plan `evaluate` issued; a refusal is a 200 response (V1.1). */
  "POST /management/v1/failures/redrive": { request: RedriveRequest; response: OperationResult };
  /** Resumes a source so its held record is processed again (V1.1). */
  "POST /management/v1/sources/retry-current": { request: RetryCurrentRequest; response: OperationResult };
  /** Redelivers a held record under a quarantine-resync policy for another assessment (V1.1). */
  "POST /management/v1/sources/reassess": { request: ReassessRequest; response: OperationResult };
  /** Closes a source's open automatic-continuation circuit (V1.1). */
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
  /** Host contract version. Always 1. */
  hostContract: 1;
  /** The operations this host answers. Anything absent is shown as unavailable and never called. */
  operations: readonly WorkbenchOperation[];
  /** `maxRequestBytes` is the largest request body the host accepts, in bytes. */
  limits: { maxRequestBytes: number };
}

/**
 * The boot block a host page embeds as `<script type="application/json" id="streamotter-workbench-host">`
 * (WHC-1 §3). Unknown fields are refused; see `validateWorkbenchHostConfig`.
 */
export interface WorkbenchHostConfig {
  /** Host contract version. Must be 1. */
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
export interface WorkbenchHostConfigIssue {
  /** JSON Pointer to the offending value. */
  path: string;
  /** Human-readable explanation. */
  message: string
}

/** `dist/workbench-host.json` in `@streamotter/workbench`, also exported as `@streamotter/workbench/host` (WHC-1 §2). */
export interface WorkbenchHostManifest {
  /** Host contract version the build implements. A host must reject any value other than the one it implements. */
  hostContract: 1;
  /** Package name. */
  package: "@streamotter/workbench";
  /** Exact package version. */
  version: string;
  /**
   * `style` is the native stylesheet, which styles the whole page. `hostStyle` (revision 0.3) is the
   * same rules with every selector scoped under `[data-streamotter-workbench]`, the attribute the
   * workbench sets on its mount element when a boot block is present; hosts link it instead.
   */
  entry: { script: string; style: string; hostStyle: string; icon: string };
  /** Subresource Integrity values (`sha384-…`) keyed by file name. */
  integrity: Readonly<Record<string, string>>;
  /** `id` of the boot block's `<script type="application/json">` element. */
  bootElementId: string;
  /** `id` of the element the workbench renders into. */
  mountElementId: string;
  /**
   * Directive name to source list. `<api origin>`, `<gateway origin>` and `<gateway websocket origin>`
   * are placeholders the host replaces (or removes, when it sets no `apiOrigin` or names no gateway).
   */
  csp: Readonly<Record<string, readonly string[]>>;
}
