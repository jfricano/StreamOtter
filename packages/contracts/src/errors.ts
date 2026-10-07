import type { ErrorCode, Json, StreamError } from "./types.ts";

/** Default public message for each error code. Messages are action-oriented and never include topics, secrets, or payloads. */
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

/** Every public {@link ErrorCode}. */
export const ERROR_CODES = Object.keys(DEFAULT_RETRYABLE) as readonly ErrorCode[];

/** Returns true when `value` is one of the {@link ERROR_CODES}. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(DEFAULT_RETRYABLE, value);
}

/** Optional fields for {@link StreamOtterError} and {@link streamError}; each omitted field takes the code's default. */
export interface StreamErrorOptions {
  /** Public message. Defaults to the code's entry in {@link PUBLIC_MESSAGES}. Never include topics, secrets, or payloads. */
  message?: string;
  /**
   * Whether another attempt under changed conditions can succeed. Defaults to true for
   * `UNAUTHENTICATED`, `SOURCE_UNAVAILABLE`, `OVERLOADED`, `RESYNC_REQUIRED`, `TIMEOUT`,
   * `HANDLER_FAILED` and `INTERNAL`, and false for every other code.
   */
  retryable?: boolean;
  /** ID of the request that failed, for correlation with gateway traces. Defaults to `""`. */
  requestId?: string;
  /** Structured, code-specific details. Omitted from the error when not set. */
  details?: Readonly<Record<string, Json>>;
}

/**
 * An Error that also satisfies the StreamError shape. SDK promises reject with
 * it; its enumerable fields serialize to exactly the public StreamError object.
 */
export class StreamOtterError extends Error implements StreamError {
  /** The error code. */
  code: ErrorCode;
  /**
   * Whether another attempt under changed conditions can succeed. It is not permission to retry
   * in a loop; never retry `FORBIDDEN`, invalid parameters, unsupported capabilities or
   * configuration errors automatically.
   */
  retryable: boolean;
  /** ID of the request that failed, for correlation with gateway traces; `""` when none applies. */
  requestId: string;
  /** Structured, code-specific details, such as the configuration issues of `CONFIG_INVALID`. */
  details?: Readonly<Record<string, Json>>;

  /**
   * Creates an error with the given code. Omitted options take the code's defaults; see
   * {@link StreamErrorOptions}. `message` is an enumerable own property, so the error
   * serializes like a plain {@link StreamError}.
   * @param code - The error code.
   * @param options - Overrides for the message, `retryable`, `requestId` and `details`.
   */
  constructor(code: ErrorCode, options: StreamErrorOptions = {}) {
    super(options.message ?? PUBLIC_MESSAGES[code]);
    Object.defineProperty(this, "message", { enumerable: true, writable: true, configurable: true, value: this.message });
    Object.defineProperty(this, "name", { enumerable: false, value: "StreamOtterError" });
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code];
    this.requestId = options.requestId ?? "";
    if (options.details !== undefined) this.details = options.details;
  }

  /**
   * Returns a plain {@link StreamError} with only the public fields: `code`, `message`,
   * `retryable`, `requestId`, and `details` when set. `JSON.stringify` calls it.
   */
  toJSON(): StreamError {
    return toStreamError(this);
  }
}

/**
 * Creates a plain {@link StreamError} object. Omitted options take the code's defaults; see
 * {@link StreamErrorOptions}. Use {@link StreamOtterError} where an `Error` instance is needed.
 * @param code - The error code.
 * @param options - Overrides for the message, `retryable`, `requestId` and `details`.
 */
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

/**
 * Returns true when `value` has the {@link StreamError} shape: a known `code`, string `message`
 * and `requestId`, and boolean `retryable`. `details` is not checked.
 */
export function isStreamError(value: unknown): value is StreamError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isErrorCode(candidate["code"])
    && typeof candidate["message"] === "string"
    && typeof candidate["retryable"] === "boolean"
    && typeof candidate["requestId"] === "string";
}

/**
 * Returns `error` itself when it is already a {@link StreamOtterError}; otherwise a new
 * StreamOtterError with the same code, message, `retryable`, `requestId` and `details`.
 */
export function asStreamOtterError(error: StreamError): StreamOtterError {
  if (error instanceof StreamOtterError) return error;
  const options: StreamErrorOptions = { message: error.message, retryable: error.retryable, requestId: error.requestId };
  if (error.details !== undefined) options.details = error.details;
  return new StreamOtterError(error.code, options);
}
