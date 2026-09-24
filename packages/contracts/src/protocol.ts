import type { Capabilities } from "./types.ts";

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_SOCKET_PATH = "/streamotter/socket.io";
export const DEFAULT_GATEWAY_PORT = 7400;
export const DEFAULT_MANAGEMENT_PORT = 7401;

export const CAPABILITIES: Capabilities = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  configVersions: Object.freeze([1] as const),
  transport: "socket.io",
  deliveryModes: Object.freeze(["state"] as const),
  operations: Object.freeze(["subscribe", "unsubscribe", "resync", "receipt"] as const)
});

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

/** Protocol timings fixed by the V1 specification. */
export const HELLO_TIMEOUT_MS = 10_000;
export const CONTROL_CALLBACK_TIMEOUT_MS = 5_000;
export const UNSUBSCRIBE_TIMEOUT_MS = 5_000;
export const GET_TOKEN_TIMEOUT_MS = 10_000;
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
export const TOKEN_REFRESH_LEAD_MS = 30_000;
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_CAP_MS = 30_000;
export const MAX_TOKEN_BYTES = 8_192;
export const REQUEST_CACHE_ENTRIES = 256;
export const REQUEST_CACHE_TTL_MS = 60_000;
export const STARTUP_DEADLINE_MS = 30_000;
export const DEFAULT_STOP_TIMEOUT_MS = 10_000;
export const PREVIEW_TOKEN_TTL_MS = 5 * 60_000;
