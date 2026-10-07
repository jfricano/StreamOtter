import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { entryPoints } from "./entries.ts";

// The public API is what the streamotter entry points export; 1.0.0 freezes it. The names below
// were made private before 1.0.0 (docs/releases/1.0.0/PUBLIC_API_TRIM.md). This test keeps them
// out of every entry point, so a wildcard re-export can't bring one back by accident.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const CONTRACTS_INTERNAL = `${ROOT}packages/contracts/src/internal.ts`;
const ENTRIES = entryPoints();

/** Shared by StreamOtter's own packages through `@streamotter/contracts/internal`. */
const CONTRACTS_INTERNALS = [
  // Timers and ports
  "HELLO_TIMEOUT_MS", "CONTROL_CALLBACK_TIMEOUT_MS", "UNSUBSCRIBE_TIMEOUT_MS", "GET_TOKEN_TIMEOUT_MS", "DEFAULT_READY_TIMEOUT_MS",
  "TOKEN_REFRESH_LEAD_MS", "RECONNECT_BASE_MS", "RECONNECT_CAP_MS", "MAX_TOKEN_BYTES", "REQUEST_CACHE_ENTRIES", "REQUEST_CACHE_TTL_MS",
  "STARTUP_DEADLINE_MS", "DEFAULT_STOP_TIMEOUT_MS", "DEFAULT_MANAGEMENT_PORT",
  // Validator internals
  "validateParamsSchema", "pointer", "LIMIT_KEYS", "resolveLimits", "validateLimits", "FailureHandlingContext", "validateFailureHandling",
  "MAX_RECOVERY_CONTEXT_BYTES",
  // Primitives
  "MAX_CONFIG_DEPTH", "MAX_NESTING_DEPTH", "withoutUndefinedProperties", "UUID_PATTERN", "isUuid", "parseUtcTimestamp", "codePointLength",
  "isJsonValue", "isPlainObject", "utf8ByteLength",
  // Error conversion
  "toStreamError", "asStreamOtterError",
  // Operator helpers and socket framing
  "isOperatorOperation", "operationExitCode", "MAX_FAILURE_PAGE", "MAX_OPERATOR_REASON", "OPERATOR_IPC_VERSION", "OPERATOR_IPC_MAX_REQUEST_BYTES",
  "OPERATOR_SOCKET_FILE", "OPERATOR_TOKEN_FILE", "OperatorIpcRequest", "OperatorIpcResponse", "validateOperatorRequest",
  // Workbench internals
  "DEFAULT_WORKBENCH_API_BASE", "PRE_WHC1_NATIVE_OPERATIONS", "WORKBENCH_LABEL_MAX_LENGTH", "WORKBENCH_DETAIL_MAX_LENGTH", "isSameOriginApiPath"
];

/** Every name no streamotter entry point may export. */
const PRIVATE = [
  ...CONTRACTS_INTERNALS,
  // Deleted: nothing used them.
  "isJsonData", "DEFAULT_GATEWAY_PORT",
  // The gateway's internals and its operator socket server, in @streamotter/gateway/internals.
  "GatewayInternals", "startOperatorSocket", "OperatorSocket", "OperatorSocketOptions",
  // The CLI's code generator internals.
  "renderType", "streamotterModules", "detectPackageStyle", "typeNames", "fingerprint", "GENERATED_MARKER"
];

/** The types callOperator's requests and results use, so operator code never needs streamotter/contracts. */
const OPERATOR_TYPES = [
  "OperatorOperation", "OperatorRequests", "IncidentProgress", "IncidentRecovery", "IncidentQuarantine", "IncidentNextAction",
  "IncidentEventName", "OperatorSourceStatus", "EvaluationOutput", "FailureClass", "Page", "SourceStatus", "Trace", "TraceStage"
];

function exportsOf(): (file: string) => Set<string> {
  const config = ts.getParsedCommandLineOfConfigFile(`${ROOT}tsconfig.check.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => assert.fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")) });
  assert.ok(config, "tsconfig.check.json");
  const files = [...ENTRIES.map(entry => `${SRC}${entry}.ts`), CONTRACTS_INTERNAL];
  const built = ts.createProgram(files, config.options);
  const checker = built.getTypeChecker();
  return file => {
    const source = built.getSourceFile(file);
    assert.ok(source, file);
    return new Set(checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).map(symbol => symbol.name));
  };
}

describe("public API", () => {
  const exported = exportsOf();

  it("no streamotter entry point exports a name made private before 1.0.0", () => {
    const leaks = ENTRIES.flatMap(entry => PRIVATE.filter(name => exported(`${SRC}${entry}.ts`).has(name)).map(name => `streamotter/${entry}: ${name}`));
    assert.deepEqual(leaks, []);
  });

  it("@streamotter/contracts/internal still provides the shared internals", () => {
    const internal = exported(CONTRACTS_INTERNAL);
    assert.deepEqual(CONTRACTS_INTERNALS.filter(name => !internal.has(name)), []);
  });

  it("streamotter/gateway/operator exports every type its own signatures use", () => {
    const operator = exported(`${SRC}operator.ts`);
    assert.deepEqual(OPERATOR_TYPES.filter(name => !operator.has(name)), []);
  });
});
