# StreamOtter public API audit (pre-1.0)

Read-only audit of the six `streamotter` entry points (package `0.2.0-rc.1`), taken on October 7, 2026. It informed [PUBLIC_API_TRIM.md](PUBLIC_API_TRIM.md).

## How this was done

- **Exports.** The TypeScript compiler enumerated each entry point (`packages/streamotter/src/*.ts`, resolved with the `streamotter-source` condition) and recorded each export's declaration file and line.
- **Signatures.** For every export, a checker walk followed parameter, return and member types (not function bodies) from the APP roots: `createClient`, `createGateway`, `defineProject`, `HandlerRegistry`, `ProjectConfig`, `validateProjectConfig`, `getGatewayOperator`, `callOperator`, `connectOperator`, `startManagementServer`, `createManagementHandler`, `runCli`, `generateFiles` and `scaffoldFiles`. Any type reached this way must stay nameable. In the tables, `sig: A > B > C` gives the path.
- **Usage.** Every `import`, `export … from`, `import("…")` and `import("…").X` type reference from `@streamotter/*` or `streamotter/*` was parsed, along with code blocks in Markdown. The scan covered `packages/*/src` and `test`, `apps/workbench`, `examples/order-dashboard`, `tests/`, `contracts/v1`, `docs/**`, `README.md`, and lontra-creek's `apps/`, `scripts/`, `deploy/` and `e2e/`. "LC" means lontra-creek. lontra-creek pins `streamotter` to exactly `0.2.0-rc.1` (`apps/site/package.json:21`, `apps/field-station/package.json:18`), so any break shows up only when it upgrades.
- **Docs.** Prose mentions were found by a whole-word search of `docs/**`, `README.md` and the package READMEs (`packages/*/README.md` and `apps/workbench/README.md`, which npm shows). Planning and log documents (implementation logs, research) don't count as promises.
- **Classes.** APP, HOST and PLUMBING are as defined in the brief. A `?` after the class marks an uncertain call; the evidence column says why.

## Summary

### Counts

| Entry point | Exports | APP | HOST | PLUMBING | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `streamotter/contracts` | 198 | 87 (3 uncertain) | 50 (13 uncertain) | 61 (16 uncertain) | |
| `streamotter/client` | 20 | 20 | 0 | 0 | All re-exports of contracts plus `createClient` |
| `streamotter/gateway` | 202 | 91 (3 uncertain) | 50 (13 uncertain) | 61 (16 uncertain) | 4 of its own exports. The other 198 come from `export type * from "@streamotter/contracts"` (`packages/gateway/src/index.ts:4`), so every contracts name, plumbing included, is also a type-only name here. Values such as `DEFAULT_LIMITS` become type-only names, usable only in type positions (for example `typeof`). |
| `streamotter/gateway/management` | 8 | 3 | 3 | 2 (1 uncertain) | |
| `streamotter/gateway/operator` | 26 | 23 | 0 | 3 | |
| `streamotter/cli` | 14 | 8 (2 uncertain) | 0 | 6 (2 uncertain) | |

### Key findings

1. **The normative spec is safe.** Every one of the 79 names in `contracts/v1/api.ts` (which V1_API.md lines 5–7 make the governing declaration of public types) classifies as APP or HOST. So does every type that V1_1_API.md or WHC-1 says is exported from `@streamotter/contracts`. None of the proposed moves touches them.
2. **Plumbing is about 30% of contracts (61 of 198), in seven groups:**
   - SDK and gateway timers, ports and protocol internals (`protocol.ts`): 17
   - Operator IPC framing and request validation (`operator.ts`): 12
   - Primitives (`primitives.ts`): 10
   - Validator internals (`schema.ts`, `limits.ts`, `config.ts`, `failures.ts`): 9
   - Workbench internals (`workbench.ts`): 6
   - Failure-policy resolution (`failures.ts`): 5
   - Error conversion helpers (`errors.ts`): 2
3. **The wire frames are spec-bound, not plumbing.** `SubscribeRequest`, `DataFrame`, `Hello`, `ErrorFrame`, `ClientToServerEvents` and the rest are used only by the client and gateway. But V1_API §8 points to them as "the wire declarations", §13 says `Hello` and `ErrorFrame` "are named exports", and they appear in `contracts/v1/api.ts`. They are classed HOST. Trimming them would mean amending V1_API.
4. **Two exports are dead.** `isJsonData` (`schema.ts:279`) and `DEFAULT_GATEWAY_PORT` (`protocol.ts:14`) are referenced nowhere, not even inside contracts. The templates hard-code 7400.
5. **There are leaks outside contracts:**
   - `streamotter/gateway/management` re-exports `GatewayInternals` (`management/index.ts:297`), which is tagged `@internal` (`runtime/gateway.ts:181`).
   - `streamotter/gateway/operator` exports `startOperatorSocket`, `OperatorSocketOptions` and `OperatorSocket`. Only the gateway itself (`runtime/gateway.ts:1212`, by a relative import) and integration tests use them. The documented way to get the socket is `operatorSocket: true`.
   - `streamotter/cli` exports generator internals: `renderType`, `streamotterModules`, `detectPackageStyle` and `typeNames`.
6. **Entry points don't export every type their signatures use.** `callOperator`'s signature uses `OperatorOperation` and `OperatorRequests`, and the results reach `IncidentProgress`, `IncidentRecovery`, `IncidentQuarantine`, `IncidentNextAction`, `IncidentEventName`, `OperatorSourceStatus`, `EvaluationOutput`, `FailureClass`, `Page`, `SourceStatus`, `Trace` and `TraceStage`. `streamotter/gateway/operator` exports none of these. They are nameable only from `streamotter/contracts` (or as type-only names from `streamotter/gateway`), so they must stay in the contracts root. The same applies to `StreamErrorOptions` for `StreamOtterError`'s constructor in `streamotter/client`, and to `ProjectConfig` and its parts for `generateFiles` in `streamotter/cli`.
7. **Outside use of plumbing is small.** lontra-creek imports only two firm-PLUMBING names: `isPlainObject` (5 files) and `utf8ByteLength` (2 files). Seven uncertain-PLUMBING names are imported in one or two places each, listed under the risks of change 1. `examples/order-dashboard` imports no plumbing through `streamotter/*` or the contracts root. It does import `getGatewayInternals` from `@streamotter/gateway/internals`, which `streamotter` doesn't expose and which is already internal.
8. **The contracts README promises more than the specs do.** Its "What else is exported" table (`packages/contracts/README.md:43–51`) lists `resolveSourcePolicy`, `validateOperatorRequest`, `CAPABILITIES`, `validateSchemaDefinition`, and "default ports and paths, and timeouts". Moving those means editing the README; no normative spec names them as exports.

## Tables

Evidence abbreviations:
- **LC Nx:** imported N times in lontra-creek; the first locations are shown.
- **internal:** StreamOtter packages whose `src` imports the name, with one location.
- **workbench / tests / example:** used there.
- **contracts/v1/api.ts:** in the normative declaration list.
- **docs:** prose or code mentions. `contracts/README` and `gateway/README` are the npm READMEs; `WHC-1` is `docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md`.
- **sig:** the signature path from an APP root.

### `streamotter/contracts` (198), grouped by source file in `packages/contracts/src/`

#### `types.ts` (64)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `Json` | type | APP | LC 20x: apps/field-station/src/fixture-handlers.ts:14, apps/field-station/src/lab/bench.ts:2; example: src/server/domain.ts:8; internal: cli+client+gateway (packages/cli/src/cli.ts:9); workbench; tests; contracts/v1/api.ts; docs: V1_1_API:86, releases/v1.1/adr/ADR-15B-recovery-barrier.md:47; sig: StreamOtterError > Json |
| `Params` | type | APP | internal: client+gateway (packages/client/src/client.ts:5); workbench; contracts/v1/api.ts; sig: createClient > ChannelMap > ChannelContract > Params |
| `Revision` | type | APP | internal: client+gateway (packages/client/src/index.ts:4); contracts/v1/api.ts; sig: HandlerRegistry > ChannelHandlers > Revision |
| `Unlisten` | type | APP | LC 6x: apps/site/src/scripts/field-client.ts:11, apps/site/src/scripts/field-log.ts:6; internal: client (packages/client/src/client.ts:5); contracts/v1/api.ts; sig: createClient > Client > Unlisten |
| `Awaitable` | type | APP | internal: client+gateway (packages/client/src/index.ts:4); contracts/v1/api.ts; docs: V1_1_API:101, releases/v1.1/adr/ADR-15B-recovery-barrier.md:42; sig: HandlerRegistry > Awaitable |
| `ChannelContract` | interface | APP | LC 3x: apps/field-station/src/generated/streamotter.generated.ts:3, apps/field-station/src/sandbox/slot-project.ts:16; example: src/generated/streamotter.generated.ts:3; internal: client+gateway (packages/client/src/index.ts:4); tests; contracts/v1/api.ts; sig: createClient > ChannelMap > ChannelContract |
| `ChannelMap` | type | APP | LC 1x: apps/site/test/field-client.test.ts:3; internal: client+gateway (packages/client/src/client.ts:4); workbench; tests; contracts/v1/api.ts; docs: V1_1_API:109; sig: createClient > ChannelMap |
| `ErrorCode` | type | APP | LC 6x: apps/field-station/src/lab/contract.ts:2, apps/field-station/src/sandbox/operations.ts:7; internal: client+gateway (packages/client/src/client.ts:4); contracts/v1/api.ts; docs: V1_1_API:10, WHC-1:242, releases/v1.1/adr/ADR-15B-recovery-barrier.md:18; sig: StreamOtterError > ErrorCode |
| `StreamError` | interface | APP | LC 11x: apps/field-station/src/generated/streamotter.client.example.ts:3, apps/field-station/src/sandbox/leases.ts:10; example: src/generated/streamotter.client.example.ts:3; internal: client+gateway (packages/client/src/client.ts:5); workbench; tests; contracts/v1/api.ts; docs: V1_API:91, V1_1_API:366, WHC-1:203, guides/source-failures.md:245; sig: StreamOtterError > StreamError |
| `StreamEvent` | interface | APP | LC 6x: apps/field-station/test/field-station.test.ts:7, apps/site/src/scripts/field-views.ts:14; example: scripts/scenarios.ts:12; internal: client+gateway (packages/client/src/frames.ts:3); tests; contracts/v1/api.ts; docs: contracts/README:45; sig: createClient > Client > Subscription > StreamEvent |
| `ConnectionState` | type | APP | LC 4x: apps/site/src/release-facts.ts:19, apps/site/src/scripts/field-log.ts:6; example: src/web/main.ts:6; internal: client (packages/client/src/client.ts:4); workbench; contracts/v1/api.ts; docs: contracts/README:45; sig: createClient > Client > ConnectionState |
| `SubscriptionState` | type | APP | LC 13x: apps/field-station/src/generated/streamotter.client.example.ts:3, apps/field-station/test/field-station.test.ts:7; example: scripts/scenarios.ts:11; internal: client+gateway (packages/client/src/frames.ts:3); workbench; tests; contracts/v1/api.ts; docs: contracts/README:45, client/README:99; sig: createClient > Client > Subscription > SubscriptionState |
| `StateChange` | interface | APP | LC 4x: apps/site/src/scripts/field-views.ts:14, apps/site/src/scripts/sign-in-retry.ts:14; internal: client (packages/client/src/client.ts:5); tests; contracts/v1/api.ts; sig: createClient > Client > StateChange |
| `WaitOptions` | interface | APP | LC 2x: apps/site/src/scripts/field-client.ts:11, apps/site/src/scripts/sign-in-retry.ts:14; internal: client (packages/client/src/client.ts:5); contracts/v1/api.ts; sig: createClient > Client > WaitOptions |
| `Subscription` | interface | APP | LC 6x: apps/site/src/scripts/field-views.ts:14, apps/site/src/snippets/recovery.ts:1; example: src/web/main.ts:6; internal: client (packages/client/src/client.ts:5); workbench; tests; contracts/v1/api.ts; sig: createClient > Client > Subscription |
| `ClientOptions` | interface | APP | LC 1x: apps/site/test/field-client.test.ts:3; internal: client (packages/client/src/client.ts:4); contracts/v1/api.ts; sig: createClient > ClientOptions |
| `Client` | interface | APP | LC 10x: apps/field-station/test/field-station.test.ts:7, apps/site/src/scripts/field-client.ts:11; example: scripts/scenarios.ts:11; internal: client (packages/client/src/client.ts:4); workbench; tests; contracts/v1/api.ts; sig: createClient > Client |
| `Schema` | type | APP | LC 2x: apps/field-station/src/project.ts:13, apps/field-station/src/sandbox/slot-project.ts:16; internal: cli+gateway (packages/cli/src/generate.ts:4); workbench; tests; contracts/v1/api.ts; sig: ProjectConfig > Schema |
| `SecretRef` | type | APP | contracts/v1/api.ts; sig: ProjectConfig > KafkaConnection > SecretRef |
| `KafkaConnection` | interface | APP | LC 2x: apps/field-station/src/lab/bench.ts:2, apps/field-station/src/project.ts:13; internal: gateway (packages/gateway/src/sources/kafka.ts:7); tests; contracts/v1/api.ts; sig: ProjectConfig > KafkaConnection |
| `Source` | type | APP | LC 1x: apps/field-station/src/project.ts:13; internal: gateway (packages/gateway/src/runtime/core.ts:3); contracts/v1/api.ts; sig: ProjectConfig > Source |
| `Limits` | interface | APP | LC 4x: apps/field-station/src/lab/bench.ts:2, apps/field-station/src/project.ts:13; internal: gateway (packages/gateway/src/runtime/core.ts:2); tests; contracts/v1/api.ts; sig: ProjectConfig > Limits |
| `ProjectConfig` | type | APP | LC 12x: apps/field-station/src/lab/bench.ts:2, apps/field-station/src/lab/journal.ts:19; example: scripts/scenarios.ts:12; internal: cli+gateway (packages/cli/src/cli.ts:9); workbench; tests; contracts/v1/api.ts; docs: V1_API:304, V1_1_API:16, contracts/README:45; sig: generateFiles > ProjectConfig |
| `Principal` | interface | APP | LC 8x: apps/field-station/src/access.ts:6, apps/field-station/src/fixture-handlers.ts:14; example: src/server/domain.ts:8; internal: gateway (packages/gateway/src/runtime/core.ts:2); tests; contracts/v1/api.ts; docs: V1_API:49, V1_1_API:122, contracts/README:45, gateway/README:76; sig: HandlerRegistry > Principal |
| `HandlerContext` | interface | APP | LC 1x: apps/field-station/test/slot-project.test.ts:16; contracts/v1/api.ts; docs: V1_1_API:96, releases/v1.1/adr/ADR-15B-recovery-barrier.md:38; sig: HandlerRegistry > HandlerContext |
| `SourceRecord` | interface | APP | LC 5x: apps/field-station/test/kafka-handlers.test.ts:6, apps/field-station/test/lab.test.ts:6; example: src/server/domain.ts:8; internal: gateway (packages/gateway/src/failures/service.ts:7); tests; contracts/v1/api.ts; docs: V1_API:51, V1_1_API:91, releases/v1.1/adr/ADR-15B-recovery-barrier.md:39, releases/v1.1/adr/ADR-15A-failure-journal-and-handoff.md:62; sig: HandlerRegistry > ChannelHandlers > SourceRecord |
| `MappedState` | interface | APP | contracts/v1/api.ts; docs: V1_API:51; sig: HandlerRegistry > ChannelHandlers > MappedState |
| `ChannelHandlers` | interface | APP | LC 3x: apps/field-station/src/fixture-handlers.ts:14, apps/field-station/src/kafka-handlers.ts:17; internal: gateway (packages/gateway/src/runtime/core.ts:2); contracts/v1/api.ts; docs: releases/v1.1/adr/ADR-15B-recovery-barrier.md:4; sig: HandlerRegistry > ChannelHandlers |
| `HandlerRegistry` | interface | APP | LC 7x: apps/field-station/src/fixture-handlers.ts:14, apps/field-station/src/kafka-handlers.ts:17; example: src/server/fixture-handlers.ts:17; internal: cli+gateway (packages/cli/src/cli.ts:9); tests; contracts/v1/api.ts; docs: V1_API:23, V1_1_API:109, releases/v1.1/adr/ADR-15B-recovery-barrier.md:4, guides/existing-app.md:116 |
| `Revocation` | type | APP | internal: gateway (packages/gateway/src/runtime/gateway.ts:14); contracts/v1/api.ts; docs: README:73, gateway/README:233; sig: createGateway > Gateway > Revocation |
| `Gateway` | interface | APP | LC 5x: apps/field-station/src/lab/runtime.ts:8, apps/field-station/src/sandbox/seam.ts:17; internal: cli+gateway (packages/cli/src/cli.ts:11); tests; contracts/v1/api.ts; sig: createGateway > Gateway |
| `GatewayLogger` | interface | APP | internal: cli+gateway (packages/cli/src/cli.ts:11); tests; contracts/v1/api.ts; docs: V1_API:286; sig: consoleLogger > GatewayLogger |
| `FixtureRecord` | type | APP | LC 2x: apps/field-station/src/sandbox/slot-project.ts:16, apps/field-station/test/lab-failures.test.ts:41; example: src/server/fixture-handlers.ts:17; internal: gateway (packages/gateway/src/sources/fixture.ts:1); tests; contracts/v1/api.ts; sig: createGateway > GatewayOptions > DevelopmentOptions > FixtureRecord |
| `DevelopmentOptions` | interface | APP | LC 2x: apps/field-station/src/fixture-handlers.ts:14, apps/field-station/src/sandbox/slot-project.ts:16; example: src/server/fixture-handlers.ts:17; internal: cli+gateway (packages/cli/src/cli.ts:9); tests; contracts/v1/api.ts; docs: V1_API:286, V1_1_API:173; sig: createGateway > GatewayOptions > DevelopmentOptions |
| `GatewayOptions` | interface | APP | internal: gateway (packages/gateway/src/index.ts:1); contracts/v1/api.ts; docs: V1_API:286, V1_1_API:144, releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md:35, releases/v1.1/adr/ADR-15C-operator-authority-and-redrive.md:27; sig: createGateway > GatewayOptions |
| `HealthListenerOptions` | interface | APP | contracts/v1/api.ts; sig: createGateway > GatewayOptions > HealthListenerOptions |
| `HealthReason` | type | HOST? | internal: gateway (packages/gateway/src/runtime/gateway.ts:13); tests; contracts/v1/api.ts. body of the documented /health/* listener (V1_1_API §8); used only by gateway |
| `HealthResponse` | interface | HOST? | internal: gateway (packages/gateway/src/runtime/health.ts:3); tests; contracts/v1/api.ts. body of the documented /health/* listener (V1_1_API §8); used only by gateway |
| `Capabilities` | interface | HOST | workbench; contracts/v1/api.ts; docs: V1_API:198, workbench/README:21; sig: ManagementOperations > Capabilities. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `SubscribeRequest` | interface | HOST | contracts/v1/api.ts; sig: ClientToServerEvents > SubscribeRequest. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `ControlRequest` | type | HOST | contracts/v1/api.ts; sig: ClientToServerEvents > ControlRequest. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `Result` | type | HOST | LC 2x: apps/field-station/src/sandbox/contract.ts:6, docs/contracts/sandbox-api.md:115; internal: client+gateway (packages/client/src/connection.ts:4); workbench; tests; contracts/v1/api.ts; sig: ClientToServerEvents > Result. management API shapes (V1_API §10, WHC-1 §5) |
| `DataFrame` | interface | HOST | LC 1x: apps/field-station/test/lab-failures.test.ts:41; internal: client+gateway (packages/client/src/connection.ts:4); tests; contracts/v1/api.ts; sig: ServerToClientEvents > DataFrame. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `SubscriptionFrame` | interface | HOST | LC 1x: apps/field-station/test/lab-failures.test.ts:41; internal: client+gateway (packages/client/src/connection.ts:4); tests; contracts/v1/api.ts; sig: ServerToClientEvents > SubscriptionFrame. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `Receipt` | interface | HOST | internal: client (packages/client/src/connection.ts:4); contracts/v1/api.ts; sig: ClientToServerEvents > Receipt. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `Hello` | type | HOST | internal: client+gateway (packages/client/src/client.ts:4); tests; contracts/v1/api.ts; docs: V1_API:286; sig: ServerToClientEvents > Hello. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `ErrorFrame` | interface | HOST | internal: client+gateway (packages/client/src/client.ts:4); tests; contracts/v1/api.ts; docs: V1_API:286; sig: ServerToClientEvents > ErrorFrame. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `ClientToServerEvents` | interface | HOST | internal: gateway (packages/gateway/src/transport/socketio.ts:5); contracts/v1/api.ts. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `ServerToClientEvents` | interface | HOST | internal: gateway (packages/gateway/src/transport/socketio.ts:5); contracts/v1/api.ts. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `SocketAuth` | interface | HOST | contracts/v1/api.ts. Socket.IO protocol v1 wire declarations (V1_API §8 and §13); only client and gateway use them |
| `TraceStage` | type | APP | LC 3x: apps/field-station/src/lab/contract.ts:2, apps/site/src/release-facts.ts:20; contracts/v1/api.ts; sig: getGatewayOperator > OperatorApi > ReproductionBundle > Trace > TraceStage. reachable from OperatorApi (ReproductionBundle.traces, listFailures, OperatorSourceStatus) |
| `Trace` | interface | APP | LC 6x: apps/field-station/src/lab/feed.ts:1, apps/field-station/src/lab/runtime.ts:8; internal: gateway (packages/gateway/src/management/router.ts:5); workbench; contracts/v1/api.ts; docs: V1_API:248; sig: getGatewayOperator > OperatorApi > ReproductionBundle > Trace. reachable from OperatorApi (ReproductionBundle.traces, listFailures, OperatorSourceStatus) |
| `Page` | interface | APP | LC 1x: apps/field-station/src/lab/runtime.ts:8; internal: cli+gateway (packages/cli/src/operator.ts:6); workbench; tests; contracts/v1/api.ts; docs: V1_1_API:295; sig: getGatewayOperator > OperatorApi > Page. reachable from OperatorApi (ReproductionBundle.traces, listFailures, OperatorSourceStatus) |
| `SourceStatus` | interface | APP | LC 4x: apps/field-station/src/lab/contract.ts:2, apps/field-station/src/lab/runtime.ts:8; internal: gateway (packages/gateway/src/operator/service.ts:8); workbench; contracts/v1/api.ts; docs: V1_API:292, V1_1_API:333; sig: getGatewayOperator > OperatorApi > OperatorStatus > OperatorSourceStatus > SourceStatus. reachable from OperatorApi (ReproductionBundle.traces, listFailures, OperatorSourceStatus) |
| `ChannelSummary` | interface | HOST | internal: gateway (packages/gateway/src/runtime/gateway.ts:12); workbench; contracts/v1/api.ts; sig: ManagementOperations > ChannelSummary. management API shapes (V1_API §10, WHC-1 §5) |
| `ConfigIssue` | interface | APP | LC 1x: apps/field-station/src/sandbox/editor.ts:8; internal: cli (packages/cli/src/cli.ts:9); workbench; tests; contracts/v1/api.ts; docs: V1_1_API:49; sig: validateProjectConfig > ConfigValidation > ConfigIssue |
| `DiagnosticStep` | interface | HOST | internal: gateway (packages/gateway/src/runtime/gateway.ts:13); workbench; contracts/v1/api.ts; sig: ManagementOperations > DiagnosticStep. management API shapes (V1_API §10, WHC-1 §5) |
| `DevelopmentPrincipalSummary` | interface | HOST | internal: gateway (packages/gateway/src/runtime/gateway.ts:12); workbench; contracts/v1/api.ts; docs: V1_API:286; sig: ManagementOperations > DevelopmentPrincipalSummary. management API shapes (V1_API §10, WHC-1 §5) |
| `ManagementOperations` | interface | HOST | LC 2x: apps/field-station/src/sandbox/contract.ts:6, docs/contracts/sandbox-api.md:115; contracts/v1/api.ts; docs: V1_API:229, V1_1_API:401, WHC-1:206, contracts/README:45. management API shapes (V1_API §10, WHC-1 §5) |
| `WorkbenchOperation` | type | HOST | LC 2x: apps/field-station/src/sandbox/contract.ts:6, docs/contracts/sandbox-api.md:115; internal: gateway (packages/gateway/src/management/index.ts:7); workbench; tests; contracts/v1/api.ts; docs: WHC-1:251; sig: createManagementHandler > ManagementHandlerOptions > WorkbenchOperation. WHC-1 §3–§6, §9 |
| `WorkbenchDiscovery` | interface | HOST | LC 7x: apps/field-station/src/sandbox/contract.ts:6, apps/field-station/src/sandbox/seam.ts:17; internal: gateway (packages/gateway/src/management/router.ts:5); workbench; tests; contracts/v1/api.ts. WHC-1 §3–§6, §9 |
| `WorkbenchHostConfig` | interface | HOST | LC 1x: apps/site/src/scripts/workbench-model.ts:7; workbench; contracts/v1/api.ts; docs: WHC-1:107, contracts/README:51. WHC-1 §3–§6, §9 |
| `WorkbenchHostConfigIssue` | interface | HOST | workbench; sig: validateWorkbenchHostConfig > WorkbenchHostConfigIssue. WHC-1 §3–§6, §9 |
| `WorkbenchHostManifest` | interface | HOST | LC 4x: apps/field-station/src/sandbox/seam.ts:17, apps/site/src/env.d.ts:17; tests; contracts/v1/api.ts; docs: WHC-1:291, contracts/README:51. WHC-1 §3–§6, §9 |

#### `config.ts` (3)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `ConfigValidation` | interface | APP | sig: validateProjectConfig > ConfigValidation |
| `validateProjectConfig` | function | APP | LC 13x: apps/field-station/src/sandbox/editor.ts:8, apps/field-station/test/field-station.test.ts:8; internal: cli+gateway (packages/cli/src/cli.ts:8); tests; docs: V1_API:304, V1_1_API:63, contracts/README:27 |
| `assertValidProjectConfig` | function | APP | internal: cli+gateway (packages/cli/src/generate.ts:4); docs: contracts/README:39. throwing form of validateProjectConfig; contracts/README:39 documents it |

#### `errors.ts` (9)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `PUBLIC_MESSAGES` | const | HOST? | LC 1x: apps/site/src/release-facts.ts:18; docs: contracts/README:48. contracts/README:48; LC site renders them; no app need |
| `ERROR_CODES` | const | APP? | LC 1x: apps/site/test/release-facts.test.ts:4; docs: contracts/README:48. runtime list of the public ErrorCode union (exhaustive UI handling); contracts/README:48 lists it |
| `isErrorCode` | function | HOST? | LC 2x: apps/field-station/src/sandbox/leases.ts:10, apps/field-station/src/sandbox/service.ts:14; internal: client (packages/client/src/frames.ts:2). a WHC-1 host adapter builds StreamError answers (LC sandbox does); not documented |
| `StreamErrorOptions` | interface | APP | sig: StreamOtterError > StreamErrorOptions |
| `StreamOtterError` | class | APP | LC 2x: apps/field-station/test/sandbox-sessions.test.ts:18, apps/field-station/test/support/sandbox-fixture.ts:7; internal: cli+client+gateway (packages/cli/src/cli.ts:8); tests; docs: V1_1_API:285, contracts/README:39 |
| `streamError` | function | HOST? | LC 4x: apps/field-station/src/sandbox/leases.ts:10, apps/field-station/src/sandbox/operations.ts:7; internal: client+gateway (packages/client/src/client.ts:3); tests. a WHC-1 host adapter builds StreamError answers (LC sandbox does); not documented |
| `toStreamError` | function | PLUMBING | internal: cli+gateway (packages/cli/src/operator.ts:4). error plumbing between client/gateway/cli |
| `isStreamError` | function | APP | internal: client+gateway (packages/client/src/connection.ts:3); docs: contracts/README:48, client/README:70 |
| `asStreamOtterError` | function | PLUMBING | internal: client+gateway (packages/client/src/client.ts:2). error plumbing between client/gateway/cli |

#### `primitives.ts` (17)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `MAX_NESTING_DEPTH` | const | PLUMBING | tests. internal primitives (depth 16 is documented in V1_API §2 prose) |
| `MAX_CONFIG_DEPTH` | const | PLUMBING | internal: cli+gateway (packages/cli/src/cli.ts:8). internal primitives (depth 16 is documented in V1_API §2 prose) |
| `IDENTIFIER_PATTERN` | const | HOST? | docs: contracts/README:47. contracts/README:47 lists them; nothing outside contracts uses them |
| `REVISION_PATTERN` | const | HOST? | docs: contracts/README:47. contracts/README:47 lists them; nothing outside contracts uses them |
| `UUID_PATTERN` | const | PLUMBING | no use outside its own package. internal primitives (depth 16 is documented in V1_API §2 prose) |
| `isIdentifier` | function | HOST | LC 1x: apps/field-station/src/sandbox/operations.ts:7; internal: gateway (packages/gateway/src/runtime/session.ts:2); docs: contracts/README:47. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |
| `isUuid` | function | PLUMBING | internal: gateway (packages/gateway/src/runtime/session.ts:2); tests. internal primitives (depth 16 is documented in V1_API §2 prose) |
| `isRevision` | function | APP? | internal: client+gateway (packages/client/src/frames.ts:2); tests; docs: contracts/README:47. revision helpers an app's snapshot/map code can use; contracts/README:47; tests/install SERVER_CHECK imports compareRevisions as a consumer would |
| `compareRevisions` | function | APP? | internal: client+gateway (packages/client/src/subscription.ts:2); tests; docs: contracts/README:47. revision helpers an app's snapshot/map code can use; contracts/README:47; tests/install SERVER_CHECK imports compareRevisions as a consumer would |
| `parseUtcTimestamp` | function | PLUMBING | internal: client+gateway (packages/client/src/client.ts:2). internal primitives (depth 16 is documented in V1_API §2 prose) |
| `isPlainObject` | function | PLUMBING | LC 5x: apps/field-station/src/sandbox/editor.ts:8, apps/field-station/src/sandbox/leases.ts:10; internal: client+gateway (packages/client/src/frames.ts:2); workbench. generic helpers; LC field-station imports them |
| `utf8ByteLength` | function | PLUMBING | LC 2x: apps/field-station/src/sandbox/editor.ts:8, apps/field-station/src/sandbox/service.ts:14; internal: gateway (packages/gateway/src/runtime/gateway.ts:10); workbench; tests. generic helpers; LC field-station imports them |
| `codePointLength` | function | PLUMBING | no use outside its own package. internal primitives (depth 16 is documented in V1_API §2 prose) |
| `isJsonValue` | function | PLUMBING | internal: gateway (packages/gateway/src/failures/service.ts:5); tests. internal primitives (depth 16 is documented in V1_API §2 prose) |
| `withoutUndefinedProperties` | function | PLUMBING | internal: gateway (packages/gateway/src/runtime/gateway.ts:10); tests. internal primitives (depth 16 is documented in V1_API §2 prose) |
| `canonicalJson` | function | HOST | LC 1x: apps/field-station/src/sandbox/editor.ts:8; internal: cli+gateway (packages/cli/src/generate.ts:4); tests; docs: contracts/README:27. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |
| `canonicalJsonPretty` | function | HOST | LC 2x: apps/field-station/scripts/configs.ts:8, apps/field-station/test/support/sandbox-fixture.ts:7; internal: cli+gateway (packages/cli/src/cli.ts:8); tests; docs: contracts/README:46. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |

#### `schema.ts` (8)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `pointer` | function | PLUMBING | no use outside its own package. validator internals |
| `validateSchemaDefinition` | function | HOST? | tests; docs: contracts/README:46. contracts/README:46 lists it, but its signature (path, issues[], depth) is an internal accumulator shape |
| `validateParamsSchema` | function | PLUMBING | no use outside its own package. validator internals |
| `ValueIssue` | interface | HOST | internal: gateway (packages/gateway/src/runtime/gateway.ts:15); sig: validateValue > ValueIssue. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |
| `validateValue` | function | HOST | LC 2x: apps/field-station/test/field-station.test.ts:8, apps/field-station/test/notebooks.test.ts:3; internal: gateway (packages/gateway/src/runtime/gateway.ts:10); tests; docs: releases/v1.1/adr/ADR-15B-recovery-barrier.md:23, contracts/README:46. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |
| `CanonicalParamsResult` | type | HOST | sig: canonicalizeParams > CanonicalParamsResult. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |
| `canonicalizeParams` | function | HOST | LC 1x: apps/field-station/test/field-station.test.ts:8; internal: gateway (packages/gateway/src/runtime/gateway.ts:8); tests; docs: contracts/README:46. tooling helpers that contracts/README documents (fingerprint recipe, schema values) |
| `isJsonData` | function | PLUMBING | no use outside its own package. dead: no reference anywhere |

#### `limits.ts` (4)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `DEFAULT_LIMITS` | const | HOST? | LC 3x: apps/field-station/src/sandbox/editor.ts:8, apps/site/src/release-facts.ts:18; tests; docs: contracts/README:49. contracts/README:49; config tooling/editors (LC editor uses it) |
| `LIMIT_KEYS` | const | PLUMBING | no use outside its own package |
| `resolveLimits` | function | PLUMBING | internal: gateway (packages/gateway/src/runtime/gateway.ts:10) |
| `validateLimits` | function | PLUMBING | no use outside its own package |

#### `protocol.ts` (20)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `PROTOCOL_VERSION` | const | HOST | internal: client (packages/client/src/connection.ts:3); tests; docs: contracts/README:9. protocol v1 constants (V1_API §8); contracts/README:49 |
| `DEFAULT_SOCKET_PATH` | const | HOST? | internal: client (packages/client/src/client.ts:2); workbench; tests. documented default path value (V1_API §4); only client/workbench use the constant |
| `DEFAULT_GATEWAY_PORT` | const | PLUMBING | no use outside its own package. dead: no reference anywhere (templates hard-code 7400) |
| `DEFAULT_MANAGEMENT_PORT` | const | PLUMBING | internal: gateway (packages/gateway/src/management/index.ts:7). gateway management default (value 7401 documented in V1_API §10) |
| `CAPABILITIES` | const | PLUMBING? | LC 1x: apps/field-station/test/support/sandbox-fixture.ts:7; internal: gateway (packages/gateway/src/management/router.ts:3); docs: contracts/README:49. this implementation's capability value; contracts/README:49 lists it; LC test fixture imports it |
| `EVENTS` | const | HOST | internal: client+gateway (packages/client/src/connection.ts:3); tests; docs: contracts/README:49. protocol v1 constants (V1_API §8); contracts/README:49 |
| `HELLO_TIMEOUT_MS` | const | PLUMBING | internal: client+gateway (packages/client/src/connection.ts:3). SDK timers; values documented in V1_API §4/§8 prose |
| `CONTROL_CALLBACK_TIMEOUT_MS` | const | PLUMBING | internal: client (packages/client/src/connection.ts:3). SDK timers; values documented in V1_API §4/§8 prose |
| `UNSUBSCRIBE_TIMEOUT_MS` | const | PLUMBING | internal: client (packages/client/src/subscription.ts:2). SDK timers; values documented in V1_API §4/§8 prose |
| `GET_TOKEN_TIMEOUT_MS` | const | PLUMBING | internal: client (packages/client/src/client.ts:2). SDK timers; values documented in V1_API §4/§8 prose |
| `DEFAULT_READY_TIMEOUT_MS` | const | PLUMBING | internal: client (packages/client/src/client.ts:2). SDK timers; values documented in V1_API §4/§8 prose |
| `TOKEN_REFRESH_LEAD_MS` | const | PLUMBING | internal: client (packages/client/src/client.ts:3). SDK timers; values documented in V1_API §4/§8 prose |
| `RECONNECT_BASE_MS` | const | PLUMBING | internal: client (packages/client/src/client.ts:3). SDK timers; values documented in V1_API §4/§8 prose |
| `RECONNECT_CAP_MS` | const | PLUMBING | internal: client (packages/client/src/client.ts:3). SDK timers; values documented in V1_API §4/§8 prose |
| `MAX_TOKEN_BYTES` | const | PLUMBING | internal: gateway (packages/gateway/src/runtime/gateway.ts:9); docs: releases/v1.2.1/FIXES.md:13. gateway internals; values documented in V1_API prose |
| `REQUEST_CACHE_ENTRIES` | const | PLUMBING | internal: gateway (packages/gateway/src/runtime/session.ts:3). gateway internals; values documented in V1_API prose |
| `REQUEST_CACHE_TTL_MS` | const | PLUMBING | internal: gateway (packages/gateway/src/runtime/session.ts:3). gateway internals; values documented in V1_API prose |
| `STARTUP_DEADLINE_MS` | const | PLUMBING | internal: gateway (packages/gateway/src/runtime/gateway.ts:10). gateway internals; values documented in V1_API prose |
| `DEFAULT_STOP_TIMEOUT_MS` | const | PLUMBING | internal: gateway (packages/gateway/src/runtime/gateway.ts:8). gateway internals; values documented in V1_API prose |
| `PREVIEW_TOKEN_TTL_MS` | const | PLUMBING? | LC 1x: apps/field-station/src/sandbox/service.ts:14; internal: gateway (packages/gateway/src/runtime/gateway.ts:9). gateway preview TTL; LC sandbox (a WHC-1 host) mirrors it |

#### `failures.ts` (19)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `FailurePolicy` | type | APP | LC 2x: apps/field-station/src/lab/contract.ts:2, apps/site/src/failure-handling.ts:22; internal: gateway (packages/gateway/src/failures/service.ts:6); contracts/v1/api.ts; docs: V1_1_API:19, contracts/README:50; sig: ProjectConfig > FailureHandlingConfig > SourceFailurePolicy > FailurePolicy |
| `BoundaryRetirement` | type | APP | contracts/v1/api.ts; docs: V1_1_API:20; sig: ProjectConfig > FailureHandlingConfig > SourceFailurePolicy > BoundaryRetirement |
| `SourceFailurePolicy` | interface | APP | contracts/v1/api.ts; docs: V1_1_API:30; sig: ProjectConfig > FailureHandlingConfig > SourceFailurePolicy |
| `FailureHandlingConfig` | interface | APP | LC 1x: apps/field-station/src/lab/bench.ts:2; tests; contracts/v1/api.ts; docs: V1_1_API:22, contracts/README:50; sig: ProjectConfig > FailureHandlingConfig |
| `FailureClass` | type | APP | LC 3x: apps/field-station/src/lab/contract.ts:2, apps/site/src/failure-handling.ts:22; internal: gateway (packages/gateway/src/failures/service.ts:6); workbench; contracts/v1/api.ts; docs: V1_1_API:190, releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md:32, releases/v1.1/adr/ADR-15B-recovery-barrier.md:18, contracts/README:50; sig: getGatewayOperator > OperatorApi > IncidentSummary > FailureClass |
| `FAILURE_CLASSES` | const | HOST? | LC 2x: apps/site/test/failure-handling.test.ts:14, apps/site/test/release-facts.test.ts:4. runtime list of FailureClass; LC site uses; undocumented |
| `QUARANTINE_ELIGIBLE_CLASSES` | const | PLUMBING? | LC 1x: apps/site/test/failure-handling.test.ts:14; internal: gateway (packages/gateway/src/operator/service.ts:3); tests. gateway rule/default; values documented in V1_1_API §2/§5.1 prose |
| `DEFAULT_AUTOMATIC_ADVANCE_LIMIT` | const | PLUMBING? | LC 1x: apps/site/src/failure-handling.ts:21. gateway rule/default; values documented in V1_1_API §2/§5.1 prose |
| `ResolvedSourcePolicy` | interface | PLUMBING? | internal: gateway (packages/gateway/src/failures/service.ts:7); sig: resolveSourcePolicy > ResolvedSourcePolicy. gateway's policy resolution; contracts/README:50 lists resolveSourcePolicy |
| `resolveSourcePolicy` | function | PLUMBING? | LC 1x: apps/site/test/failure-handling.test.ts:14; internal: gateway (packages/gateway/src/failures/service.ts:5); tests; docs: contracts/README:50. gateway's policy resolution; contracts/README:50 lists resolveSourcePolicy |
| `policyFor` | function | PLUMBING? | LC 1x: apps/site/test/failure-handling.test.ts:14; internal: gateway (packages/gateway/src/failures/service.ts:5); tests. gateway's policy resolution; contracts/README:50 lists resolveSourcePolicy |
| `TransientMappingError` | class | APP | LC 2x: apps/field-station/src/lab/bench.ts:3, apps/field-station/test/lab-bench-failures.test.ts:15; internal: gateway (packages/gateway/src/index.ts:5); tests; contracts/v1/api.ts; docs: V1_API:304, V1_1_API:75, releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md:114, releases/v1.1/adr/ADR-15B-recovery-barrier.md:24 |
| `RecoveryBoundary` | interface | APP | LC 1x: apps/field-station/test/lab-bench-failures.test.ts:16; example: src/server/app.ts:16; contracts/v1/api.ts; docs: V1_1_API:86, releases/v1.1/adr/ADR-15B-recovery-barrier.md:41, contracts/README:50; sig: HandlerRegistry > SourceRecoveryHandlers > RecoveryBoundary |
| `RecoveryIncident` | interface | APP | LC 1x: apps/field-station/test/lab-bench-failures.test.ts:16; example: src/server/app.ts:16; contracts/v1/api.ts; docs: V1_1_API:88; sig: HandlerRegistry > SourceRecoveryHandlers > RecoveryIncident |
| `RecoveryDecision` | type | APP | example: src/server/domain.ts:8; contracts/v1/api.ts; sig: HandlerRegistry > SourceRecoveryHandlers > RecoveryDecision |
| `SourceRecoveryHandlers` | interface | APP | LC 1x: apps/field-station/src/lab/bench.ts:2; example: src/server/kafka-handlers.ts:14; internal: gateway (packages/gateway/src/failures/service.ts:7); tests; contracts/v1/api.ts; docs: V1_1_API:95, releases/v1.1/adr/ADR-15B-recovery-barrier.md:37, contracts/README:50; sig: HandlerRegistry > SourceRecoveryHandlers |
| `MAX_RECOVERY_CONTEXT_BYTES` | const | PLUMBING | internal: gateway (packages/gateway/src/failures/service.ts:5). value (16 KiB) is documented in V1_1_API §3.2, name is not |
| `FailureHandlingContext` | interface | PLUMBING | no use outside its own package. called only by validateProjectConfig |
| `validateFailureHandling` | function | PLUMBING | no use outside its own package. called only by validateProjectConfig |

#### `operator.ts` (41)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `IncidentProgress` | type | APP | LC 2x: apps/field-station/src/lab/contract.ts:2, apps/site/src/failure-handling.ts:22; workbench; sig: getGatewayOperator > OperatorApi > IncidentSummary > IncidentProgress |
| `IncidentRecovery` | type | APP | LC 2x: apps/field-station/src/lab/contract.ts:2, apps/site/src/failure-handling.ts:23; workbench; sig: getGatewayOperator > OperatorApi > IncidentSummary > IncidentRecovery |
| `IncidentQuarantine` | type | APP | LC 2x: apps/field-station/src/lab/contract.ts:2, apps/site/src/failure-handling.ts:22; workbench; sig: getGatewayOperator > OperatorApi > IncidentSummary > IncidentQuarantine |
| `IncidentNextAction` | type | APP | LC 1x: apps/field-station/src/lab/contract.ts:2; internal: gateway (packages/gateway/src/operator/service.ts:5); sig: getGatewayOperator > OperatorApi > IncidentSummary > IncidentNextAction |
| `IncidentEventName` | type | APP | LC 2x: apps/field-station/src/lab/contract.ts:2, apps/site/src/failure-handling.ts:22; sig: getGatewayOperator > OperatorApi > IncidentDetail > IncidentEvent > IncidentEventName |
| `IncidentSummary` | interface | APP | LC 1x: apps/field-station/src/lab/contract.ts:2; internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:206, contracts/README:50; sig: getGatewayOperator > OperatorApi > IncidentSummary |
| `IncidentEvent` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); docs: V1_1_API:242; sig: getGatewayOperator > OperatorApi > IncidentDetail > IncidentEvent |
| `IncidentDetail` | interface | APP | LC 1x: apps/field-station/src/lab/operator.ts:18; internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:236, contracts/README:50; sig: getGatewayOperator > OperatorApi > IncidentDetail |
| `RawEvidenceView` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:6); tests; sig: getGatewayOperator > OperatorApi > RawEvidenceView |
| `OperationResult` | interface | APP | LC 2x: apps/field-station/src/lab/operator.ts:18, apps/field-station/test/lab-bench-failures.test.ts:16; internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:298, contracts/README:50; sig: getGatewayOperator > OperatorApi > OperationResult |
| `EvaluationOutput` | interface | APP | sig: getGatewayOperator > OperatorApi > EvaluationResult > EvaluationOutput |
| `EvaluationResult` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:302; sig: getGatewayOperator > OperatorApi > EvaluationResult |
| `OperatorSourceStatus` | interface | APP | internal: gateway (packages/gateway/src/operator/service.ts:6); workbench; tests; docs: V1_1_API:328; sig: getGatewayOperator > OperatorApi > OperatorStatus > OperatorSourceStatus |
| `OperatorStatus` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:294, contracts/README:50; sig: getGatewayOperator > OperatorApi > OperatorStatus |
| `ReproductionBundle` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:6); workbench; tests; docs: V1_1_API:297; sig: getGatewayOperator > OperatorApi > ReproductionBundle |
| `ListFailuresRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); workbench; tests; sig: getGatewayOperator > OperatorApi > ListFailuresRequest |
| `ShowFailureRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:9); tests; sig: getGatewayOperator > OperatorApi > ShowFailureRequest |
| `ExportFailureRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); tests; sig: getGatewayOperator > OperatorApi > ExportFailureRequest |
| `RetryCurrentRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:9); workbench; tests; sig: getGatewayOperator > OperatorApi > RetryCurrentRequest |
| `ReassessRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:8); workbench; tests; sig: getGatewayOperator > OperatorApi > ReassessRequest |
| `ReopenCircuitRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:8); workbench; tests; sig: getGatewayOperator > OperatorApi > ReopenCircuitRequest |
| `RetireBoundaryRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:9); tests; sig: getGatewayOperator > OperatorApi > RetireBoundaryRequest |
| `EvaluateRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); workbench; tests; sig: getGatewayOperator > OperatorApi > EvaluateRequest |
| `RedriveRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:8); workbench; tests; sig: getGatewayOperator > OperatorApi > RedriveRequest |
| `OperatorApi` | interface | APP | LC 3x: apps/field-station/src/lab/operator.ts:18, apps/field-station/src/lab/runtime.ts:8; internal: gateway (packages/gateway/src/management/router.ts:4); tests; sig: getGatewayOperator > OperatorApi |
| `OperatorOperation` | type | APP | LC 1x: apps/site/src/failure-handling.ts:23; internal: cli+gateway (packages/cli/src/operator.ts:5); tests; sig: callOperator > OperatorOperation. in callOperator's signature; not re-exported by streamotter/gateway/operator, so contracts is the only place to name them |
| `OperatorRequests` | interface | APP | internal: gateway (packages/gateway/src/operator/ipc.ts:8); tests; sig: callOperator > OperatorRequests. in callOperator's signature; not re-exported by streamotter/gateway/operator, so contracts is the only place to name them |
| `OPERATOR_OPERATIONS` | const | HOST? | LC 2x: apps/site/src/failure-handling.ts:21, apps/site/test/failure-handling.test.ts:14; tests. runtime list of OperatorOperation; LC site uses; undocumented |
| `OPERATOR_MUTATIONS` | const | HOST? | LC 2x: apps/site/src/failure-handling.ts:21, apps/site/test/failure-handling.test.ts:14. runtime list of OperatorOperation; LC site uses; undocumented |
| `PLAN_TTL_MS` | const | PLUMBING? | LC 1x: apps/site/src/failure-handling.ts:21; internal: gateway (packages/gateway/src/operator/service.ts:3). 5-minute plan TTL is documented in prose (V1_1_API §6); LC site imports the constant |
| `MAX_FAILURE_PAGE` | const | PLUMBING | no use outside its own package. validator bounds |
| `MAX_OPERATOR_REASON` | const | PLUMBING | internal: gateway (packages/gateway/src/failures/rebaseline.ts:2). validator bounds |
| `OPERATOR_IPC_VERSION` | const | PLUMBING? | internal: gateway (packages/gateway/src/operator/ipc.ts:6). operator IPC wire format; V1_1_API §7 documents the protocol in prose, but the documented client is callOperator/connectOperator. HOST if a third-party IPC client is to be supported |
| `OPERATOR_IPC_MAX_REQUEST_BYTES` | const | PLUMBING? | internal: gateway (packages/gateway/src/operator/ipc.ts:6); tests. operator IPC wire format; V1_1_API §7 documents the protocol in prose, but the documented client is callOperator/connectOperator. HOST if a third-party IPC client is to be supported |
| `OPERATOR_SOCKET_FILE` | const | PLUMBING? | internal: gateway (packages/gateway/src/operator/ipc.ts:6). operator IPC wire format; V1_1_API §7 documents the protocol in prose, but the documented client is callOperator/connectOperator. HOST if a third-party IPC client is to be supported |
| `OPERATOR_TOKEN_FILE` | const | PLUMBING? | internal: gateway (packages/gateway/src/operator/ipc.ts:7). operator IPC wire format; V1_1_API §7 documents the protocol in prose, but the documented client is callOperator/connectOperator. HOST if a third-party IPC client is to be supported |
| `OperatorIpcRequest` | interface | PLUMBING? | no use outside its own package. operator IPC wire format; V1_1_API §7 documents the protocol in prose, but the documented client is callOperator/connectOperator. HOST if a third-party IPC client is to be supported |
| `OperatorIpcResponse` | type | PLUMBING? | internal: gateway (packages/gateway/src/operator/ipc.ts:8); tests. operator IPC wire format; V1_1_API §7 documents the protocol in prose, but the documented client is callOperator/connectOperator. HOST if a third-party IPC client is to be supported |
| `operationExitCode` | function | PLUMBING | internal: cli (packages/cli/src/operator.ts:4). CLI exit-code mapping |
| `validateOperatorRequest` | function | PLUMBING? | internal: cli+gateway (packages/cli/src/operator.ts:4); docs: V1_1_API:374, contracts/README:50. shared request validator; named in V1_1_API §7/§9 as implementation detail and listed in contracts/README:50 |
| `isOperatorOperation` | function | PLUMBING | internal: gateway (packages/gateway/src/operator/ipc.ts:6) |

#### `workbench.ts` (13)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `WORKBENCH_HOST_CONTRACT` | const | HOST | LC 1x: apps/field-station/src/sandbox/seam.ts:17; internal: gateway (packages/gateway/src/management/router.ts:4); workbench. WHC-1 values (§2 manifest, §3.1 boot block, §3.2 header) |
| `WORKBENCH_BOOT_ELEMENT_ID` | const | HOST | LC 1x: apps/site/src/scripts/workbench-model.ts:7; workbench. WHC-1 values (§2 manifest, §3.1 boot block, §3.2 header) |
| `WORKBENCH_MOUNT_ELEMENT_ID` | const | HOST | LC 1x: apps/site/src/scripts/workbench-model.ts:7; workbench. WHC-1 values (§2 manifest, §3.1 boot block, §3.2 header) |
| `DEFAULT_WORKBENCH_API_BASE` | const | PLUMBING | workbench. workbench/validator internals; values are in WHC-1 prose |
| `WORKBENCH_REQUEST_HEADER` | const | HOST | LC 2x: apps/field-station/src/sandbox/seam.ts:17, apps/site/src/scripts/workbench.ts:10; internal: gateway (packages/gateway/src/management/router.ts:4); workbench. WHC-1 values (§2 manifest, §3.1 boot block, §3.2 header) |
| `WORKBENCH_OPERATIONS` | const | HOST | LC 1x: apps/field-station/test/sandbox-seam.test.ts:13; internal: gateway (packages/gateway/src/management/router.ts:4); tests; docs: contracts/README:51. WHC-1 §4 vocabulary; contracts/README:51 |
| `PRE_WHC1_NATIVE_OPERATIONS` | const | PLUMBING | workbench; tests. workbench/validator internals; values are in WHC-1 prose |
| `isWorkbenchOperation` | function | PLUMBING? | internal: gateway (packages/gateway/src/management/index.ts:7); workbench; tests. gateway+workbench; a host checking its allowlist could use it |
| `WORKBENCH_LABEL_MAX_LENGTH` | const | PLUMBING | no use outside its own package. workbench/validator internals; values are in WHC-1 prose |
| `WORKBENCH_DETAIL_MAX_LENGTH` | const | PLUMBING | no use outside its own package. workbench/validator internals; values are in WHC-1 prose |
| `isSameOriginApiPath` | function | PLUMBING | tests. workbench/validator internals; values are in WHC-1 prose |
| `isWorkbenchApiOrigin` | function | HOST | LC 1x: apps/site/src/scripts/workbench-model.ts:7; tests; docs: WHC-1:311. WHC-1 §10 says it is exported from @streamotter/contracts |
| `validateWorkbenchHostConfig` | function | HOST | LC 4x: apps/site/src/scripts/workbench-model.ts:7, apps/site/test/workbench-model.test.ts:5; workbench; tests; docs: WHC-1:292, contracts/README:51, workbench/README:18. WHC-1 §3–§6, §9 |

### `streamotter/client` (20)

Every export is a re-export (`packages/client/src/index.ts`). They are what browser code and the generated `streamotter.generated.ts` import.

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `createClient` | function | APP | LC 14x: apps/field-station/src/generated/streamotter.client.example.ts:3, apps/field-station/test/field-station.test.ts:7; example: scripts/scenarios.ts:11; workbench; tests; contracts/v1/api.ts; docs: V1_API:5, IMPLEMENTATION_STATUS.md:35, guides/existing-app.md:157, guides/getting-started.md:118 |
| `StreamOtterError` | class | APP | LC 2x: apps/field-station/test/sandbox-sessions.test.ts:18, apps/field-station/test/support/sandbox-fixture.ts:7; internal: cli+client+gateway (packages/cli/src/cli.ts:8); tests; docs: V1_1_API:285, contracts/README:39 |
| `isStreamError` | function | APP | internal: client+gateway (packages/client/src/connection.ts:3); docs: contracts/README:48, client/README:70 |
| `Json` | type | APP | LC 20x: apps/field-station/src/fixture-handlers.ts:14, apps/field-station/src/lab/bench.ts:2; example: src/server/domain.ts:8; internal: cli+client+gateway (packages/cli/src/cli.ts:9); workbench; tests; contracts/v1/api.ts; docs: V1_1_API:86, releases/v1.1/adr/ADR-15B-recovery-barrier.md:47; sig: StreamOtterError > Json |
| `Params` | type | APP | internal: client+gateway (packages/client/src/client.ts:5); workbench; contracts/v1/api.ts; sig: createClient > ChannelMap > ChannelContract > Params |
| `Revision` | type | APP | internal: client+gateway (packages/client/src/index.ts:4); contracts/v1/api.ts; sig: HandlerRegistry > ChannelHandlers > Revision |
| `Unlisten` | type | APP | LC 6x: apps/site/src/scripts/field-client.ts:11, apps/site/src/scripts/field-log.ts:6; internal: client (packages/client/src/client.ts:5); contracts/v1/api.ts; sig: createClient > Client > Unlisten |
| `Awaitable` | type | APP | internal: client+gateway (packages/client/src/index.ts:4); contracts/v1/api.ts; docs: V1_1_API:101, releases/v1.1/adr/ADR-15B-recovery-barrier.md:42; sig: HandlerRegistry > Awaitable |
| `ChannelContract` | interface | APP | LC 3x: apps/field-station/src/generated/streamotter.generated.ts:3, apps/field-station/src/sandbox/slot-project.ts:16; example: src/generated/streamotter.generated.ts:3; internal: client+gateway (packages/client/src/index.ts:4); tests; contracts/v1/api.ts; sig: createClient > ChannelMap > ChannelContract |
| `ChannelMap` | type | APP | LC 1x: apps/site/test/field-client.test.ts:3; internal: client+gateway (packages/client/src/client.ts:4); workbench; tests; contracts/v1/api.ts; docs: V1_1_API:109; sig: createClient > ChannelMap |
| `ErrorCode` | type | APP | LC 6x: apps/field-station/src/lab/contract.ts:2, apps/field-station/src/sandbox/operations.ts:7; internal: client+gateway (packages/client/src/client.ts:4); contracts/v1/api.ts; docs: V1_1_API:10, WHC-1:242, releases/v1.1/adr/ADR-15B-recovery-barrier.md:18; sig: StreamOtterError > ErrorCode |
| `StreamError` | interface | APP | LC 11x: apps/field-station/src/generated/streamotter.client.example.ts:3, apps/field-station/src/sandbox/leases.ts:10; example: src/generated/streamotter.client.example.ts:3; internal: client+gateway (packages/client/src/client.ts:5); workbench; tests; contracts/v1/api.ts; docs: V1_API:91, V1_1_API:366, WHC-1:203, guides/source-failures.md:245; sig: StreamOtterError > StreamError |
| `StreamEvent` | interface | APP | LC 6x: apps/field-station/test/field-station.test.ts:7, apps/site/src/scripts/field-views.ts:14; example: scripts/scenarios.ts:12; internal: client+gateway (packages/client/src/frames.ts:3); tests; contracts/v1/api.ts; docs: contracts/README:45; sig: createClient > Client > Subscription > StreamEvent |
| `ConnectionState` | type | APP | LC 4x: apps/site/src/release-facts.ts:19, apps/site/src/scripts/field-log.ts:6; example: src/web/main.ts:6; internal: client (packages/client/src/client.ts:4); workbench; contracts/v1/api.ts; docs: contracts/README:45; sig: createClient > Client > ConnectionState |
| `SubscriptionState` | type | APP | LC 13x: apps/field-station/src/generated/streamotter.client.example.ts:3, apps/field-station/test/field-station.test.ts:7; example: scripts/scenarios.ts:11; internal: client+gateway (packages/client/src/frames.ts:3); workbench; tests; contracts/v1/api.ts; docs: contracts/README:45, client/README:99; sig: createClient > Client > Subscription > SubscriptionState |
| `StateChange` | interface | APP | LC 4x: apps/site/src/scripts/field-views.ts:14, apps/site/src/scripts/sign-in-retry.ts:14; internal: client (packages/client/src/client.ts:5); tests; contracts/v1/api.ts; sig: createClient > Client > StateChange |
| `WaitOptions` | interface | APP | LC 2x: apps/site/src/scripts/field-client.ts:11, apps/site/src/scripts/sign-in-retry.ts:14; internal: client (packages/client/src/client.ts:5); contracts/v1/api.ts; sig: createClient > Client > WaitOptions |
| `Subscription` | interface | APP | LC 6x: apps/site/src/scripts/field-views.ts:14, apps/site/src/snippets/recovery.ts:1; example: src/web/main.ts:6; internal: client (packages/client/src/client.ts:5); workbench; tests; contracts/v1/api.ts; sig: createClient > Client > Subscription |
| `ClientOptions` | interface | APP | LC 1x: apps/site/test/field-client.test.ts:3; internal: client (packages/client/src/client.ts:4); contracts/v1/api.ts; sig: createClient > ClientOptions |
| `Client` | interface | APP | LC 10x: apps/field-station/test/field-station.test.ts:7, apps/site/src/scripts/field-client.ts:11; example: scripts/scenarios.ts:11; internal: client (packages/client/src/client.ts:4); workbench; tests; contracts/v1/api.ts; sig: createClient > Client |

### `streamotter/gateway` (202)

The gateway's own exports and its value re-exports are below. The remaining 195 names are type-only re-exports of contracts (`export type *`, `packages/gateway/src/index.ts:4`); each takes its class from the contracts table. lontra-creek imports these type-only names from `streamotter/gateway`, all APP: `ChannelHandlers`, `HandlerRegistry`, `DevelopmentOptions`, `Json`, `Principal` and `Gateway`.

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `validateProjectConfig` | function | APP | LC 13x: apps/field-station/src/sandbox/editor.ts:8, apps/field-station/test/field-station.test.ts:8; internal: cli+gateway (packages/cli/src/cli.ts:8); tests; docs: V1_API:304, V1_1_API:63, contracts/README:27 |
| `StreamOtterError` | class | APP | LC 2x: apps/field-station/test/sandbox-sessions.test.ts:18, apps/field-station/test/support/sandbox-fixture.ts:7; internal: cli+client+gateway (packages/cli/src/cli.ts:8); tests; docs: V1_1_API:285, contracts/README:39 |
| `TransientMappingError` | class | APP | LC 2x: apps/field-station/src/lab/bench.ts:3, apps/field-station/test/lab-bench-failures.test.ts:15; internal: gateway (packages/gateway/src/index.ts:5); tests; contracts/v1/api.ts; docs: V1_API:304, V1_1_API:75, releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md:114, releases/v1.1/adr/ADR-15B-recovery-barrier.md:24 |
| `defineProject` | function | APP | tests; contracts/v1/api.ts; docs: V1_API:5, DEPLOYMENT.md:224, IMPLEMENTATION_STATUS.md:31, guides/existing-app.md:187 |
| `createGateway` | function | APP | LC 12x: apps/field-station/scripts/dev.ts:40, apps/field-station/scripts/kafka-gateway.mjs:3; example: scripts/scenarios.ts:13; internal: cli (packages/cli/src/cli.ts:11); tests; contracts/v1/api.ts; docs: V1_API:5, DEPLOYMENT.md:49, IMPLEMENTATION_STATUS.md:31, RELEASE_PLAN.md:70 |
| `consoleLogger` | function | APP | default logger of createGateway (gateway/src/index.ts:43 doc) |
| `silentLogger` | const | APP | LC 3x: apps/field-station/src/sandbox/seam.ts:18, apps/field-station/test/field-station.test.ts:9; example: scripts/scenarios.ts:13; tests |

### `streamotter/gateway/management` (8)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `ManagementServerOptions` | interface | APP | sig: startManagementServer > ManagementServerOptions. what `streamotter dev` runs; programmatic dev setups (LC field-station, capture-demo) |
| `ManagementServer` | interface | APP | LC 1x: apps/field-station/test/field-station.test.ts:10; tests; sig: startManagementServer > ManagementServer. what `streamotter dev` runs; programmatic dev setups (LC field-station, capture-demo) |
| `startManagementServer` | function | APP | LC 5x: apps/field-station/scripts/dev.ts:41, apps/field-station/src/lab/runtime.ts:6; internal: cli (packages/cli/src/cli.ts:12); tests; docs: WHC-1:22. what `streamotter dev` runs; programmatic dev setups (LC field-station, capture-demo) |
| `ManagementHandlerOptions` | interface | HOST | docs: WHC-1:249; sig: createManagementHandler > ManagementHandlerOptions. WHC-1 §6 optional server helper |
| `ManagementHandler` | type | HOST | sig: createManagementHandler > ManagementHandler. WHC-1 §6 optional server helper |
| `DEFAULT_HANDLER_MAX_BODY_BYTES` | const | PLUMBING? | no use outside its own package. documents the handler default; nothing reads it outside management/index.ts |
| `createManagementHandler` | function | HOST | LC 1x: apps/field-station/src/sandbox/seam.ts:19; tests; docs: V1_API:300, V1_1_API:420, WHC-1:18, gateway/README:243. WHC-1 §6 optional server helper |
| `GatewayInternals` | interface | PLUMBING | tests; docs: releases/v1.1/adr/ADR-15C-operator-authority-and-redrive.md:4. tagged @internal (runtime/gateway.ts:181) yet re-exported by management/index.ts:297; no public signature uses it |

### `streamotter/gateway/operator` (26)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `IncidentSummary` | interface | APP | LC 1x: apps/field-station/src/lab/contract.ts:2; internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:206, contracts/README:50; sig: getGatewayOperator > OperatorApi > IncidentSummary |
| `IncidentEvent` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); docs: V1_1_API:242; sig: getGatewayOperator > OperatorApi > IncidentDetail > IncidentEvent |
| `IncidentDetail` | interface | APP | LC 1x: apps/field-station/src/lab/operator.ts:18; internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:236, contracts/README:50; sig: getGatewayOperator > OperatorApi > IncidentDetail |
| `RawEvidenceView` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:6); tests; sig: getGatewayOperator > OperatorApi > RawEvidenceView |
| `OperationResult` | interface | APP | LC 2x: apps/field-station/src/lab/operator.ts:18, apps/field-station/test/lab-bench-failures.test.ts:16; internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:298, contracts/README:50; sig: getGatewayOperator > OperatorApi > OperationResult |
| `EvaluationResult` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:302; sig: getGatewayOperator > OperatorApi > EvaluationResult |
| `OperatorStatus` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:5); workbench; tests; docs: V1_1_API:294, contracts/README:50; sig: getGatewayOperator > OperatorApi > OperatorStatus |
| `ReproductionBundle` | interface | APP | internal: cli+gateway (packages/cli/src/operator.ts:6); workbench; tests; docs: V1_1_API:297; sig: getGatewayOperator > OperatorApi > ReproductionBundle |
| `ListFailuresRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); workbench; tests; sig: getGatewayOperator > OperatorApi > ListFailuresRequest |
| `ShowFailureRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:9); tests; sig: getGatewayOperator > OperatorApi > ShowFailureRequest |
| `ExportFailureRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); tests; sig: getGatewayOperator > OperatorApi > ExportFailureRequest |
| `RetryCurrentRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:9); workbench; tests; sig: getGatewayOperator > OperatorApi > RetryCurrentRequest |
| `ReassessRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:8); workbench; tests; sig: getGatewayOperator > OperatorApi > ReassessRequest |
| `ReopenCircuitRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:8); workbench; tests; sig: getGatewayOperator > OperatorApi > ReopenCircuitRequest |
| `RetireBoundaryRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:9); tests; sig: getGatewayOperator > OperatorApi > RetireBoundaryRequest |
| `EvaluateRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:7); workbench; tests; sig: getGatewayOperator > OperatorApi > EvaluateRequest |
| `RedriveRequest` | interface | APP | internal: gateway (packages/gateway/src/operator/index.ts:8); workbench; tests; sig: getGatewayOperator > OperatorApi > RedriveRequest |
| `OperatorApi` | interface | APP | LC 3x: apps/field-station/src/lab/operator.ts:18, apps/field-station/src/lab/runtime.ts:8; internal: gateway (packages/gateway/src/management/router.ts:4); tests; sig: getGatewayOperator > OperatorApi |
| `OperatorSocketOptions` | interface | PLUMBING | sig: startOperatorSocket > OperatorSocketOptions. the gateway starts the socket itself for `operatorSocket: true` (runtime/gateway.ts:1212, relative import); only tests call it |
| `OperatorSocket` | interface | PLUMBING | tests; docs: V1_1_API:377; sig: startOperatorSocket > OperatorSocket. the gateway starts the socket itself for `operatorSocket: true` (runtime/gateway.ts:1212, relative import); only tests call it |
| `OperatorClientOptions` | interface | APP | sig: callOperator > OperatorClientOptions |
| `OperatorResult` | type | APP | sig: callOperator > OperatorResult |
| `startOperatorSocket` | function | PLUMBING | tests. the gateway starts the socket itself for `operatorSocket: true` (runtime/gateway.ts:1212, relative import); only tests call it |
| `callOperator` | function | APP | internal: cli (packages/cli/src/operator.ts:8); tests; docs: V1_1_API:378, gateway/README:220, streamotter/README:43 |
| `connectOperator` | function | APP | docs: V1_1_API:378, gateway/README:220 |
| `getGatewayOperator` | function | APP | LC 2x: apps/field-station/src/lab/runtime.ts:7, apps/field-station/test/lab-failures.test.ts:40; tests; docs: DEPLOYMENT.md:235, V1_1_API:288, releases/v1.1/adr/ADR-15C-operator-authority-and-redrive.md:16, guides/source-failures.md:82 |

### `streamotter/cli` (14)

| name | kind | class | evidence |
| --- | --- | --- | --- |
| `EXIT` | const | APP? | tests/install/install.test.ts:758 (template). names runCli's exit codes; tests/install SERVER_CHECK imports it |
| `CliIO` | interface | APP | sig: runCli > CliIO |
| `runProcess` | function | APP? | internal: packages/streamotter/bin/streamotter.js:2 (via @streamotter/cli). run the CLI as the process; used by packages/streamotter/bin via @streamotter/cli |
| `runCli` | function | APP | LC 1x: apps/field-station/src/lab/journal.ts:20; tests; docs: streamotter/README:45 |
| `GENERATED_MARKER` | const | PLUMBING? | no use outside its own package. generator internals; could serve tooling, undocumented |
| `PackageStyle` | type | APP | sig: generateFiles > PackageStyle |
| `streamotterModules` | function | PLUMBING | no use outside its own package. generator internals (typeNames used by tests only) |
| `detectPackageStyle` | function | PLUMBING | no use outside its own package. generator internals (typeNames used by tests only) |
| `fingerprint` | function | PLUMBING? | no use outside its own package. generator internals; could serve tooling, undocumented |
| `typeNames` | function | PLUMBING | tests. generator internals (typeNames used by tests only) |
| `renderType` | function | PLUMBING | no use outside its own package. generator internals (typeNames used by tests only) |
| `GeneratedFile` | interface | APP | sig: generateFiles > GeneratedFile |
| `generateFiles` | function | APP | tests; docs: streamotter/README:45 |
| `scaffoldFiles` | function | APP | LC 3x: apps/field-station/src/sandbox/slot-project.ts:15, apps/field-station/test/slot-project.test.ts:15 |

## Proposed changes

These changes are ordered by value relative to risk. "Firm" means PLUMBING without `?`. Uncertain names are listed separately so the owner can decide them one by one.

### 1. Move contracts plumbing to a non-public `@streamotter/contracts/internal` subpath

- **What.**
  - Add `"./internal"` to `packages/contracts/package.json` `exports`, with the same three conditions as `"."`.
  - Add `src/internal.ts`, which re-exports the plumbing groups below.
  - Remove those names from `src/index.ts`.
  - Do not add a `streamotter/contracts/internal` entry to the `streamotter` package.
  - Precedent: `@streamotter/gateway/internals` already works this way. It isn't re-exported by `streamotter`, and `packages/gateway/README.md` calls it "not a stable API".
- **Firm plumbing (45 names):**
  - **Timers and ports:** `HELLO_TIMEOUT_MS`, `CONTROL_CALLBACK_TIMEOUT_MS`, `UNSUBSCRIBE_TIMEOUT_MS`, `GET_TOKEN_TIMEOUT_MS`, `DEFAULT_READY_TIMEOUT_MS`, `TOKEN_REFRESH_LEAD_MS`, `RECONNECT_BASE_MS`, `RECONNECT_CAP_MS`, `MAX_TOKEN_BYTES`, `REQUEST_CACHE_ENTRIES`, `REQUEST_CACHE_TTL_MS`, `STARTUP_DEADLINE_MS`, `DEFAULT_STOP_TIMEOUT_MS`, `DEFAULT_MANAGEMENT_PORT`
  - **Validator internals:** `validateParamsSchema`, `pointer`, `LIMIT_KEYS`, `resolveLimits`, `validateLimits`, `FailureHandlingContext`, `validateFailureHandling`, `MAX_RECOVERY_CONTEXT_BYTES`
  - **Primitives:** `MAX_CONFIG_DEPTH`, `MAX_NESTING_DEPTH`, `withoutUndefinedProperties`, `UUID_PATTERN`, `isUuid`, `parseUtcTimestamp`, `codePointLength`, `isJsonValue`, `isPlainObject`, `utf8ByteLength`
  - **Errors:** `toStreamError`, `asStreamOtterError`
  - **Operator:** `isOperatorOperation`, `operationExitCode`, `MAX_FAILURE_PAGE`, `MAX_OPERATOR_REASON`
  - **Workbench:** `DEFAULT_WORKBENCH_API_BASE`, `PRE_WHC1_NATIVE_OPERATIONS`, `WORKBENCH_LABEL_MAX_LENGTH`, `WORKBENCH_DETAIL_MAX_LENGTH`, `isSameOriginApiPath`
  - **Dead (delete instead; see change 2):** `isJsonData`, `DEFAULT_GATEWAY_PORT`
- **Uncertain plumbing (16 names), each the owner's call:**
  - **Policy:** `resolveSourcePolicy`, `policyFor`, `ResolvedSourcePolicy`, `QUARANTINE_ELIGIBLE_CLASSES`, `DEFAULT_AUTOMATIC_ADVANCE_LIMIT`
  - **Operator IPC:** `OPERATOR_IPC_VERSION`, `OPERATOR_IPC_MAX_REQUEST_BYTES`, `OPERATOR_SOCKET_FILE`, `OPERATOR_TOKEN_FILE`, `OperatorIpcRequest`, `OperatorIpcResponse`, `validateOperatorRequest`
  - **Other:** `PLAN_TTL_MS`, `PREVIEW_TOKEN_TTL_MS`, `CAPABILITIES`, `isWorkbenchOperation`
- **Internal follow-up.** These imports change from `@streamotter/contracts` to `@streamotter/contracts/internal`:
  - `packages/gateway/src`: 34 names
  - `packages/client/src`: 11 names
  - `packages/cli/src`: 4 names
  - `apps/workbench/src`: 5 names (`DEFAULT_WORKBENCH_API_BASE`, `PRE_WHC1_NATIVE_OPERATIONS`, `isPlainObject`, `isWorkbenchOperation`, `utf8ByteLength`). Contracts is a devDependency there and gets bundled, so this is safe.
  - `packages/contracts/test`: 10 names
  - `packages/gateway/test`: 2 names
  - `tests/`: 1 name (`MAX_NESTING_DEPTH`)

  `streamotter/gateway` drops the same names automatically, because it uses `export type *`.
- **Why not just `@internal` plus `stripInternal`?**
  - `tsc -b` builds client, gateway and cli against contracts' emitted `.d.ts`, so stripping declarations would break StreamOtter's own build.
  - `@internal` without stripping only hides names from the API reference: the docs generator uses `excludeInternal`, and `packages/streamotter/test/api-docs.test.ts` skips `@internal`. It is a reasonable minimum if the owner doesn't want a new subpath, but the names stay importable and become de facto API.
- **Risks: lontra-creek.** These imports break when lontra-creek upgrades from the pinned `0.2.0-rc.1`:
  - Firm `isPlainObject`: `apps/field-station/src/sandbox/{editor.ts:8, leases.ts:10, operations.ts:7, seam.ts:17, service.ts:14}`
  - Firm `utf8ByteLength`: `apps/field-station/src/sandbox/{editor.ts:8, service.ts:14}`
  - The fix is a small local helper. Both are generic utilities, not contract.
  - If the uncertain names move too:
    - `PREVIEW_TOKEN_TTL_MS`: `apps/field-station/src/sandbox/service.ts:14`. The sandbox mirrors the gateway's preview TTL as a WHC-1 host.
    - `DEFAULT_AUTOMATIC_ADVANCE_LIMIT` and `PLAN_TTL_MS`: `apps/site/src/failure-handling.ts:21`. The site states library facts from the installed package.
    - `resolveSourcePolicy`, `policyFor` and `QUARANTINE_ELIGIBLE_CLASSES`: `apps/site/test/failure-handling.test.ts:14`
    - `CAPABILITIES`: `apps/field-station/test/support/sandbox-fixture.ts:7`
- **Risks: StreamOtter's own docs.**
  - The contracts README (`packages/contracts/README.md:43–51`) lists `resolveSourcePolicy`, `validateOperatorRequest` and `CAPABILITIES`, and says "default ports and paths, and timeouts". Edit those rows if the names move.
  - V1_1_API §7 and §9 name `validateOperatorRequest` only as the shared validator (implementation detail), not as an export. No conflict.
- **Risks: normative specs.** No conflict. Every timer, port and limit above appears in V1_API only as a value in prose ("ten seconds", 7401, 8 KiB, depth 16), never as an exported name.

### 2. Delete the dead exports

- **What.** Remove `isJsonData` (`schema.ts:279`, unused anywhere). Either remove `DEFAULT_GATEWAY_PORT` (`protocol.ts:14`) or make `packages/cli/src/templates.ts:21,123` use it.
- **Risk.** None found in either repository or in the docs.

### 3. Stop `streamotter/gateway/management` re-exporting `GatewayInternals`

- **What.** Delete `export type { GatewayInternals }` (`packages/gateway/src/management/index.ts:297`). The type is already `@internal` and exported from `@streamotter/gateway/internals`, where `tests/browser/order-dashboard.test.ts:14` imports it.
- **Risk.** None found.

### 4. Move the operator socket server to `@streamotter/gateway/internals`

- **What.** Move `startOperatorSocket`, `OperatorSocketOptions` and `OperatorSocket` from `@streamotter/gateway/operator`. The gateway starts the socket itself for `operatorSocket: true`, through a relative import.
- **Risk.**
  - `tests/integration/operator-cli.test.ts:13` imports it from the public path and needs updating.
  - V1_1_API §7 says "`OperatorSocket.close()`, the first step of `gateway.stop()`". That describes behavior, not an export promise, but the wording should change.
  - Marked PLUMBING without `?`, but if the owner wants to support serving a custom `OperatorApi` over the socket, this becomes HOST.
  - `callOperator` and `connectOperator` stay. Both are documented: `packages/gateway/README.md:220` and V1_1_API §7.

### 5. Trim the CLI's generator internals

- **What.** Stop exporting `renderType`, `streamotterModules`, `detectPackageStyle` and `typeNames` from `@streamotter/cli` (`packages/cli/src/index.ts:3`); `GENERATED_MARKER` and `fingerprint` are optional. Keep `runCli`, `CliIO`, `EXIT`, `runProcess`, `generateFiles`, `GeneratedFile`, `PackageStyle` and `scaffoldFiles`. `runProcess` is used by `packages/streamotter/bin/streamotter.js:2` through `@streamotter/cli`.
- **Risk.**
  - `tests/integration/generated-contracts.test.ts:6` imports `typeNames` and needs a relative or internal import.
  - lontra-creek uses only `runCli` and `scaffoldFiles`, which stay.
  - The streamotter README (`packages/streamotter/README.md:45`) names only `runCli` and `generateFiles`.

### 6. Make the operator entry self-sufficient (additive)

- **What.** Re-export from `streamotter/gateway/operator` the types its own signatures use but it doesn't export: `OperatorOperation`, `OperatorRequests`, `IncidentProgress`, `IncidentRecovery`, `IncidentQuarantine`, `IncidentNextAction`, `IncidentEventName`, `OperatorSourceStatus`, `EvaluationOutput`, `FailureClass`, `Page`, `SourceStatus`, `Trace` and `TraceStage`. Then operator users never need `streamotter/contracts`.
- **Risk.** None; this only adds exports. It also confirms these names must not leave the contracts root.

### 7. Optional: replace `export type * from "@streamotter/contracts"` in the gateway

- **What.** Swap the wildcard in `packages/gateway/src/index.ts:4` for an explicit list of the handler, configuration and gateway types. Today it publishes all 198 contracts names, including protocol frames and the value constants as type-only names. After change 1 the wildcard shrinks with contracts automatically, so this matters less.
- **Risk.**
  - Some lontra-creek code imports contracts types from `streamotter/gateway` (`ChannelHandlers`, `HandlerRegistry`, `DevelopmentOptions`, `Json`, `Principal` in field-station; `Gateway` in a test). All are APP and would be on the list.
  - The README (`packages/streamotter/README.md:42`) promises "the types for your handlers" from `streamotter/gateway`.
  - lontra-creek's API-reference copy says "every contract type re-exported" (`apps/site/src/api-reference/modules.ts`). That is a copy change only.

### Keep, but record the decision: the uncertain HOST names (13)

These have outside users or a doc mention, and no app or spec strictly needs them. The recommendation is to keep them in the root and document them, because each is cheap and lontra-creek already uses most of them:

| Name | Who uses it | Doc mention | Note |
| --- | --- | --- | --- |
| `streamError`, `isErrorCode` | lontra-creek, 4 and 2 files | none | A host adapter builds `StreamError` answers. Document them for WHC-1 hosts. |
| `PUBLIC_MESSAGES` | lontra-creek | contracts README | |
| `DEFAULT_LIMITS` | lontra-creek, 3 places | contracts README | |
| `FAILURE_CLASSES` | lontra-creek | none | |
| `OPERATOR_OPERATIONS`, `OPERATOR_MUTATIONS` | lontra-creek | none | |
| `IDENTIFIER_PATTERN`, `REVISION_PATTERN` | none | contracts README | |
| `DEFAULT_SOCKET_PATH` | none | V1_API §4 (the value) | |
| `HealthReason`, `HealthResponse` | none | `contracts/v1/api.ts` and V1_1_API §8 | Removing them would contradict V1_API. |
| `validateSchemaDefinition` | none | contracts README | Its `(path, issues[], depth)` signature is awkward. Wrap it or keep it as is; don't move it. |

### What must not move (spec-bound)

- **V1_API.** All 79 names in `contracts/v1/api.ts`. V1_API lines 5–7 make these declarations normative, and `pnpm check:contracts` imports them from the `@streamotter/contracts` root. That includes the Socket.IO frames (§8; §13 names `Hello` and `ErrorFrame`), `ManagementOperations`, `Result`, `Capabilities`, `ChannelSummary`, `DiagnosticStep`, `DevelopmentPrincipalSummary`, `HealthReason` and `HealthResponse`.
- **V1_1_API.** The types its §§2–6 say `@streamotter/contracts` governs: the failure-handling config, `TransientMappingError` ("exported from `@streamotter/contracts` and re-exported by `@streamotter/gateway`", §3.1), the recovery types, and the incident, operator, evaluation and bundle types.
- **WHC-1.** `WorkbenchHostConfig` (§3.1), `ManagementOperations` (§5), `WorkbenchHostManifest` and `validateWorkbenchHostConfig` (§9), `isWorkbenchApiOrigin` (§10, "exported from `@streamotter/contracts`"), `WorkbenchOperation` (§6), and `createManagementHandler` with its options (§6). lontra-creek's WHC-1 host also uses `WORKBENCH_HOST_CONTRACT`, `WORKBENCH_BOOT_ELEMENT_ID`, `WORKBENCH_MOUNT_ELEMENT_ID`, `WORKBENCH_REQUEST_HEADER` and `WORKBENCH_OPERATIONS`.

### Uncertain calls to confirm

- **Operator IPC framing** (`OPERATOR_IPC_*`, `OPERATOR_*_FILE`, `OperatorIpcRequest`/`Response`). V1_1_API §7 documents the wire format in prose, so a third-party IPC client is conceivable. If the owner wants to support one, reclassify these as HOST and keep them.
- **`compareRevisions`, `isRevision` and `ERROR_CODES`.** Marked APP?: `compareRevisions` because `tests/install/install.test.ts:759` imports it as a consumer would, the other two because they are runtime companions of public types.
- **`EXIT` and `runProcess`.** Marked APP? because they are useful programmatically but undocumented.
