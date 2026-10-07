# Public API trim before 1.0.0

**Status:** proposed, waiting on jason's review of the lists below. No code has changed yet.
**Decision (jason, October 7, 2026):** make the plumbing private before 1.0 ("Audit and trim").
**Evidence:** [PUBLIC_API_AUDIT.md](PUBLIC_API_AUDIT.md) classifies every export and lists where each one is imported, in both repositories.

Once `1.0.0` ships, removing anything that `streamotter/*` exports is a breaking change, so this trim is the last cheap chance. Apps keep everything they use, and every name the specs make normative stays put.

## The rule

An export stays public when it meets at least one of these:

- an app uses it;
- a WHC-1 host uses it;
- a normative spec names it: `contracts/v1/api.ts`, V1_1_API, or WHC-1.

Everything else is plumbing: the constants, validators and helpers that StreamOtter's own packages share. Plumbing moves to a non-public subpath, `@streamotter/contracts/internal`. This follows the pattern of `@streamotter/gateway/internals`: the `streamotter` package doesn't re-export it, and its README calls it "not a stable API".

Tagging names `@internal` alone isn't enough. They would vanish from the docs but stay importable, and anything importable becomes API in practice.

## Changes

### 1. Move 50 contracts names to `@streamotter/contracts/internal`

**Timers and ports (14):** `HELLO_TIMEOUT_MS`, `CONTROL_CALLBACK_TIMEOUT_MS`, `UNSUBSCRIBE_TIMEOUT_MS`, `GET_TOKEN_TIMEOUT_MS`, `DEFAULT_READY_TIMEOUT_MS`, `TOKEN_REFRESH_LEAD_MS`, `RECONNECT_BASE_MS`, `RECONNECT_CAP_MS`, `MAX_TOKEN_BYTES`, `REQUEST_CACHE_ENTRIES`, `REQUEST_CACHE_TTL_MS`, `STARTUP_DEADLINE_MS`, `DEFAULT_STOP_TIMEOUT_MS`, `DEFAULT_MANAGEMENT_PORT`

**Validator internals (8):** `validateParamsSchema`, `pointer`, `LIMIT_KEYS`, `resolveLimits`, `validateLimits`, `FailureHandlingContext`, `validateFailureHandling`, `MAX_RECOVERY_CONTEXT_BYTES`

**Primitives (10):** `MAX_CONFIG_DEPTH`, `MAX_NESTING_DEPTH`, `withoutUndefinedProperties`, `UUID_PATTERN`, `isUuid`, `parseUtcTimestamp`, `codePointLength`, `isJsonValue`, `isPlainObject`, `utf8ByteLength`

**Error conversion (2):** `toStreamError`, `asStreamOtterError`

**Operator helpers (4):** `isOperatorOperation`, `operationExitCode`, `MAX_FAILURE_PAGE`, `MAX_OPERATOR_REASON`

**Operator socket framing (7):** `OPERATOR_IPC_VERSION`, `OPERATOR_IPC_MAX_REQUEST_BYTES`, `OPERATOR_SOCKET_FILE`, `OPERATOR_TOKEN_FILE`, `OperatorIpcRequest`, `OperatorIpcResponse`, `validateOperatorRequest`
- The supported clients are `callOperator`, `connectOperator` and the CLI. A third-party socket client isn't supported in 1.0.

**Workbench internals (5):** `DEFAULT_WORKBENCH_API_BASE`, `PRE_WHC1_NATIVE_OPERATIONS`, `WORKBENCH_LABEL_MAX_LENGTH`, `WORKBENCH_DETAIL_MAX_LENGTH`, `isSameOriginApiPath`

`streamotter/gateway` re-exports every contracts type through `export type *`, so the same names leave that entry point too.

### 2. Delete two unused exports

`isJsonData` and `DEFAULT_GATEWAY_PORT` are referenced nowhere. The CLI templates write 7400 directly; `scaffoldFiles` will use an internal constant instead.

### 3. Trim three other entry points

- **`streamotter/gateway/management`:** stop re-exporting `GatewayInternals`. It's already `@internal` and available from `@streamotter/gateway/internals`.
- **`streamotter/gateway/operator`:** move `startOperatorSocket`, `OperatorSocket` and `OperatorSocketOptions` to `@streamotter/gateway/internals`. The gateway starts the socket itself when `operatorSocket: true` is set.
- **`streamotter/cli`:** stop exporting `renderType`, `streamotterModules`, `detectPackageStyle`, `typeNames`, `fingerprint` and `GENERATED_MARKER`. Keep `runCli`, `CliIO`, `EXIT`, `runProcess` (the `streamotter` binary uses it), `generateFiles`, `GeneratedFile`, `PackageStyle` and `scaffoldFiles`.

### 4. Let the operator entry name its own types (additive)

`callOperator`'s requests and results use types that `streamotter/gateway/operator` doesn't export. Re-export them there: `OperatorOperation`, `OperatorRequests`, `IncidentProgress`, `IncidentRecovery`, `IncidentQuarantine`, `IncidentNextAction`, `IncidentEventName`, `OperatorSourceStatus`, `EvaluationOutput`, `FailureClass`, `Page`, `SourceStatus`, `Trace`, `TraceStage`.

## Kept public on purpose

- **Everything in `contracts/v1/api.ts` (79 names),** including the Socket.IO frames. V1_API §8 calls them "the wire declarations", and §13 names `Hello` and `ErrorFrame` as exports.
- **The types V1_1_API and WHC-1 say `@streamotter/contracts` exports,** along with the WHC-1 host constants Lontra Creek uses (`WORKBENCH_*`, `WORKBENCH_OPERATIONS`, `isWorkbenchOperation`).
- **Failure-policy resolution:** `resolveSourcePolicy`, `policyFor`, `ResolvedSourcePolicy`, `QUARANTINE_ELIGIBLE_CLASSES`, `DEFAULT_AUTOMATIC_ADVANCE_LIMIT`. They let an app check the effective policy it configured, and Lontra Creek's site states them as library facts.
- **Documented limits:** `PLAN_TTL_MS`, `PREVIEW_TOKEN_TTL_MS` (a WHC-1 host mirrors it), `CAPABILITIES`, `DEFAULT_LIMITS`, `DEFAULT_SOCKET_PATH`.
- **Helpers apps and hosts use:** `streamError`, `isErrorCode`, `ERROR_CODES`, `PUBLIC_MESSAGES`, `FAILURE_CLASSES`, `OPERATOR_OPERATIONS`, `OPERATOR_MUTATIONS`, `IDENTIFIER_PATTERN`, `REVISION_PATTERN`, `isRevision`, `compareRevisions`, `validateSchemaDefinition`, `HealthReason`, `HealthResponse`.
- **The `streamotter/gateway` type re-export** stays as a wildcard. The README promises "the types for your handlers" from there, and it shrinks with contracts automatically.

## Result

| Entry point | Today | After |
| --- | ---: | ---: |
| `streamotter/contracts` | 198 | 146 |
| `streamotter/gateway/operator` | 26 | 37 |
| `streamotter/gateway/management` | 8 | 7 |
| `streamotter/cli` | 14 | 8 |

The API reference loses 61 pages.

## What else changes

- **StreamOtter's own imports:** about 65 imports across `packages/*/src`, `apps/workbench`, the tests and `tests/` switch to `@streamotter/contracts/internal`. The `streamotter` package gets no new entry point.
- **Docs:**
  - the contracts README's "What else is exported" table;
  - one sentence in V1_1_API §7 about the operator socket;
  - the CHANGELOG, with a "Removed from the public API" list.
- **Guard:** `packages/streamotter/test/api-docs.test.ts` gains a check that none of the moved names can be imported from a `streamotter/*` entry point, so they can't come back by accident.
- **Lontra Creek:** nothing breaks while it pins `0.2.0-rc.1`. When it upgrades, five sandbox files need small local helpers for `isPlainObject` and `utf8ByteLength`. That happens after the freeze.
- **Release:** this ships in the next prerelease before `1.0.0`. The CHANGELOG lists it as a breaking change for anyone who imported plumbing.

## Order of work

1. jason reviews these lists. This document is the spec.
2. Write the tests: the guard above, plus updated expectations in the existing tests.
3. Write the code and docs, then run `pnpm verify` and the docs site build.
4. Pause, and ask jason which model and effort the independent review should use.
5. Review, fix, then push to PR #72.
