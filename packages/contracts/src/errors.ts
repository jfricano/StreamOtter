import type { ErrorCode, Json, StreamError } from "./types.ts";

/** Public, action-oriented messages. Never include topics, secrets, or payloads. */
export const PUBLIC_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Authentication is required or has expired.",
  FORBIDDEN: "This subscription is not permitted.",
  INVALID_PARAMS: "The channel parameters are invalid.",
  CHANNEL_NOT_FOUND: "The channel is not configured.",
  CHANNEL_VERSION_UNSUPPORTED: "The requested channel version is not deployed.",
  SOURCE_UNAVAILABLE: "The source is unavailable; this view may be stale.",
  INVALID_PAYLOAD: "The data did not match its declared contract.",
  OVERLOADED: "The gateway is over its configured limits; try again later.",
  RESYNC_REQUIRED: "Automatic synchronization stopped; call resync() to try again.",
  UNSUPPORTED_CAPABILITY: "The requested capability is not supported by this gateway.",
  INVALID_REQUEST: "The request is malformed.",
  CONFIG_INVALID: "The configuration is invalid.",
  TIMEOUT: "The operation did not complete before its deadline.",
  CANCELLED: "The operation was cancelled.",
  CLIENT_CLOSED: "The client is closed; create a new client.",
  HANDLER_FAILED: "An application handler failed.",
  REVISION_CONFLICT: "Conflicting data was received for the same revision.",
  TRACE_CURSOR_EXPIRED: "The trace cursor has expired; start from the latest traces.",
  INTERNAL: "An unexpected error occurred."
};

const DEFAULT_RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  UNAUTHENTICATED: true,
  FORBIDDEN: false,
  INVALID_PARAMS: false,
  CHANNEL_NOT_FOUND: false,
  CHANNEL_VERSION_UNSUPPORTED: false,
  SOURCE_UNAVAILABLE: true,
  INVALID_PAYLOAD: false,
  OVERLOADED: true,
  RESYNC_REQUIRED: true,
  UNSUPPORTED_CAPABILITY: false,
  INVALID_REQUEST: false,
  CONFIG_INVALID: false,
  TIMEOUT: true,
  CANCELLED: false,
  CLIENT_CLOSED: false,
  HANDLER_FAILED: true,
  REVISION_CONFLICT: false,
  TRACE_CURSOR_EXPIRED: false,
  INTERNAL: true
};

export const ERROR_CODES = Object.keys(DEFAULT_RETRYABLE) as readonly ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(DEFAULT_RETRYABLE, value);
}

export interface StreamErrorOptions {
  message?: string;
  retryable?: boolean;
  requestId?: string;
  details?: Readonly<Record<string, Json>>;
}

/**
 * An Error that also satisfies the StreamError shape. SDK promises reject with
 * it; its enumerable fields serialize to exactly the public StreamError object.
 */
export class StreamOtterError extends Error implements StreamError {
  code: ErrorCode;
  retryable: boolean;
  requestId: string;
  details?: Readonly<Record<string, Json>>;

  constructor(code: ErrorCode, options: StreamErrorOptions = {}) {
    super(options.message ?? PUBLIC_MESSAGES[code]);
    Object.defineProperty(this, "message", { enumerable: true, writable: true, configurable: true, value: this.message });
    Object.defineProperty(this, "name", { enumerable: false, value: "StreamOtterError" });
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code];
    this.requestId = options.requestId ?? "";
    if (options.details !== undefined) this.details = options.details;
  }

  toJSON(): StreamError {
    return toStreamError(this);
  }
}

export function streamError(code: ErrorCode, options: StreamErrorOptions = {}): StreamError {
  const error: StreamError = {
    code,
    message: options.message ?? PUBLIC_MESSAGES[code],
    retryable: options.retryable ?? DEFAULT_RETRYABLE[code],
    requestId: options.requestId ?? ""
  };
  if (options.details !== undefined) error.details = options.details;
  return error;
}

/** Copies only the public StreamError fields. */
export function toStreamError(error: StreamError): StreamError {
  const copy: StreamError = { code: error.code, message: error.message, retryable: error.retryable, requestId: error.requestId };
  if (error.details !== undefined) copy.details = error.details;
  return copy;
}

export function isStreamError(value: unknown): value is StreamError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isErrorCode(candidate["code"])
    && typeof candidate["message"] === "string"
    && typeof candidate["retryable"] === "boolean"
    && typeof candidate["requestId"] === "string";
}

export function asStreamOtterError(error: StreamError): StreamOtterError {
  if (error instanceof StreamOtterError) return error;
  const options: StreamErrorOptions = { message: error.message, retryable: error.retryable, requestId: error.requestId };
  if (error.details !== undefined) options.details = error.details;
  return new StreamOtterError(error.code, options);
}
