/**
 * `@streamotter/contracts/internal`: constants, validators and helpers that StreamOtter's own
 * packages share. Not a stable API: `streamotter` doesn't re-export it, and any release may change it.
 */
export {
  asStreamOtterError, toStreamError
} from "./errors.ts";
export {
  codePointLength, isJsonValue, isPlainObject, isUuid, MAX_CONFIG_DEPTH, MAX_NESTING_DEPTH,
  parseUtcTimestamp, utf8ByteLength, UUID_PATTERN, withoutUndefinedProperties
} from "./primitives.ts";
export {
  pointer, validateParamsSchema
} from "./schema.ts";
export {
  LIMIT_KEYS, resolveLimits, validateLimits
} from "./limits.ts";
export {
  CONTROL_CALLBACK_TIMEOUT_MS, DEFAULT_MANAGEMENT_PORT, DEFAULT_READY_TIMEOUT_MS, DEFAULT_STOP_TIMEOUT_MS,
  GET_TOKEN_TIMEOUT_MS, HELLO_TIMEOUT_MS, MAX_TOKEN_BYTES, RECONNECT_BASE_MS, RECONNECT_CAP_MS,
  REQUEST_CACHE_ENTRIES, REQUEST_CACHE_TTL_MS, STARTUP_DEADLINE_MS, TOKEN_REFRESH_LEAD_MS,
  UNSUBSCRIBE_TIMEOUT_MS
} from "./protocol.ts";
export {
  type FailureHandlingContext, MAX_RECOVERY_CONTEXT_BYTES, validateFailureHandling
} from "./failures.ts";
export {
  isOperatorOperation, MAX_FAILURE_PAGE, MAX_OPERATOR_REASON, operationExitCode,
  OPERATOR_IPC_MAX_REQUEST_BYTES, OPERATOR_IPC_VERSION, OPERATOR_SOCKET_FILE, OPERATOR_TOKEN_FILE,
  type OperatorIpcRequest, type OperatorIpcResponse, validateOperatorRequest
} from "./operator.ts";
export {
  DEFAULT_WORKBENCH_API_BASE, isSameOriginApiPath, PRE_WHC1_NATIVE_OPERATIONS, WORKBENCH_DETAIL_MAX_LENGTH,
  WORKBENCH_LABEL_MAX_LENGTH
} from "./workbench.ts";
