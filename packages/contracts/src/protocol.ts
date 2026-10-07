import type { Capabilities } from "./types.ts";

/**
 * Version of the Socket.IO wire protocol this package implements. The SDK sends it in the
 * handshake, and the gateway refuses any other version with `UNSUPPORTED_CAPABILITY`.
 */
export const PROTOCOL_VERSION = 1 as const;
/** Default Socket.IO HTTP path, `/streamotter/socket.io`. The SDK uses it when `ClientOptions.path` is not set. */
export const DEFAULT_SOCKET_PATH = "/streamotter/socket.io";
/** Default port (7401) of the development management server, which serves the management API and the workbench. */
export const DEFAULT_MANAGEMENT_PORT = 7401;

/** What this implementation supports. The gateway sends it in `so:hello` and from `GET /management/v1/capabilities`. */
export const CAPABILITIES: Capabilities = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  configVersions: Object.freeze([1] as const),
  transport: "socket.io",
  deliveryModes: Object.freeze(["state"] as const),
  operations: Object.freeze(["subscribe", "unsubscribe", "resync", "receipt"] as const)
});

/** Socket.IO event names of protocol v1, keyed by short name. */
export const EVENTS = Object.freeze({
  hello: "so:hello",
  state: "so:state",
  data: "so:data",
  error: "so:error",
  subscribe: "so:subscribe",
  unsubscribe: "so:unsubscribe",
  resync: "so:resync",
  receipt: "so:receipt"
} as const);

/**
 * Deadline in ms (10 seconds) for a connection handshake to complete with `so:hello`. The SDK
 * fails the attempt with `TIMEOUT` after it, and the gateway uses it as its Socket.IO connect timeout.
 */
export const HELLO_TIMEOUT_MS = 10_000;
/**
 * How long in ms (5 seconds) the SDK waits for the gateway's callback to a control request such
 * as `so:subscribe` or `so:resync`. Without an answer, the request fails with `TIMEOUT`.
 */
export const CONTROL_CALLBACK_TIMEOUT_MS = 5_000;
/**
 * How long in ms (5 seconds) the SDK waits for the gateway to confirm an unsubscribe, including
 * retries after `OVERLOADED`. After it, the SDK stops waiting.
 */
export const UNSUBSCRIBE_TIMEOUT_MS = 5_000;
/**
 * Deadline in ms (10 seconds) for the application's `getToken`. A call still pending is aborted
 * through its signal. While connecting, the client then enters `auth-required`; during a refresh it
 * reports an error and tries again.
 */
export const GET_TOKEN_TIMEOUT_MS = 10_000;
/** Default `timeoutMs` in ms (30 seconds) for SDK waits such as `ready()`, `resync()` and `reconnect()`. */
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
/**
 * How long in ms (30 seconds) before the `authExpiresAt` of `so:hello` the SDK obtains a new
 * token and replaces the connection.
 */
export const TOKEN_REFRESH_LEAD_MS = 30_000;
/**
 * Base of the SDK's reconnect backoff, in ms. Before retry n (counting from 0), the SDK waits a
 * random delay between 0 and the smaller of {@link RECONNECT_CAP_MS} and `RECONNECT_BASE_MS * 2 ** n`.
 */
export const RECONNECT_BASE_MS = 500;
/** Upper bound of the SDK's reconnect backoff ceiling, in ms (30 seconds). See {@link RECONNECT_BASE_MS}. */
export const RECONNECT_CAP_MS = 30_000;
/** Maximum size of an authentication token, in UTF-8 bytes (8 KiB). The gateway refuses a longer or empty token with `UNAUTHENTICATED`. */
export const MAX_TOKEN_BYTES = 8_192;
/**
 * Number of control-request results the gateway remembers per connection, so that an identical
 * retry with the same request ID gets the same answer. The oldest entry is evicted first.
 */
export const REQUEST_CACHE_ENTRIES = 256;
/** How long in ms (60 seconds) the gateway remembers a control-request result. See {@link REQUEST_CACHE_ENTRIES}. */
export const REQUEST_CACHE_TTL_MS = 60_000;
/** How long in ms (30 seconds) gateway `start()` waits for every source to become ready before it fails with `SOURCE_UNAVAILABLE`. */
export const STARTUP_DEADLINE_MS = 30_000;
/** Default `timeoutMs` of gateway `stop()`, in ms (10 seconds). */
export const DEFAULT_STOP_TIMEOUT_MS = 10_000;
/** Lifetime of a workbench preview token, in ms (5 minutes). A token never outlives its development principal's `expiresAt`. */
export const PREVIEW_TOKEN_TTL_MS = 5 * 60_000;
