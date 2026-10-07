# Changelog

All six packages (`streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli`, and `@streamotter/workbench`) are released together with the same version. `streamotter` first appeared in `0.1.0-rc.3`. Package versions follow [Semantic Versioning](https://semver.org/) and are independent of the V1 protocol (`protocolVersion: 1`) and configuration format (`configVersion: 1`). Before 1.0.0, a minor release may contain breaking API changes; they will be listed here.

## Unreleased

### Added

- React hooks (V1.3): `@streamotter/client/react`, re-exported as `streamotter/react`, with `StreamOtterProvider`, `useSubscription`, `useConnectionState`, `useStreamOtterClient` and `createStreamOtterHooks` for channels typed from the generated `AppChannels`, and the `SubscriptionOptions`, `SubscriptionResult`, `StreamOtterHooks` and `StreamOtterProviderProps` types. `react` 18 or later is an optional peer dependency of `@streamotter/client` and `streamotter`; apps that don't import the subpath are unchanged. See [docs/releases/v1.3](docs/releases/v1.3/README.md) and its [API contract](docs/releases/v1.3/API.md).

### Changed

- The reference example's React page uses the new hooks in place of its hand-written provider and hook.

- The package READMEs, and so the npm pages, show the flat brandmark lockup that the repository README uses, in place of the detailed logo.

## [0.2.0-rc.1] — 2026-10-04

Published to npm on `latest` with provenance, from the `v0.2.0-rc.1` tag ([GitHub release](https://github.com/jfricano/StreamOtter/releases/tag/v0.2.0-rc.1)). One release carrying three internal milestones:

- V1.1: source-failure handling and the workbench host contract ([docs/releases/v1.1](docs/releases/v1.1/README.md)).
- V1.2: an independent quality review of V1 and V1.1 together ([docs/releases/v1.2](docs/releases/v1.2/README.md)).
- V1.2.1: fixes for the minor findings V1.2 deferred ([docs/releases/v1.2.1](docs/releases/v1.2.1/README.md)).

Milestone labels are not package versions. Configurations without `failureHandling` behave as in `0.1.0-rc.3`, apart from the changes and fixes below. Two of those changes can refuse a configuration or a request that `0.1.0-rc.3` accepted: the `maxControlFrameBytes` minimum, and production answers to invalid subscribe parameters.

### Added

- V1.1 groundwork (no behavior change for existing configurations): `@streamotter/contracts` types and validation for the optional `failureHandling` configuration section, recovery-guard and snapshot-acknowledgment handler types, the internal `FailureClass` vocabulary, and `TransientMappingError` (also exported by `@streamotter/gateway`). Every V1.1 policy is now accepted. See [docs/releases/v1.1](docs/releases/v1.1/README.md).
- V1.1 containment and quarantine-hold (opt-in through `failureHandling`; configurations without it behave exactly as before):
  - Every unprocessable record opens a source-failure incident with a stable ID (`f1:` plus the source record ID), its trusted failure class, position, evidence summary and provenance. A record with several problems takes the most severe class, so a schema failure can never hide an integrity failure. Diagnoses name an error's type and code, never its message, so payload text never reaches an incident. Incidents are kept in a durable SQLite journal under the new `stateDirectory` gateway option (Node 24.15 or later), or in memory under `streamotter dev` without one.
  - `quarantine-hold` writes the original key, value and headers byte for byte to a pre-provisioned quarantine topic (idempotent producer, `acks=all`, no topic creation), with metadata in a `streamotter-envelope` header. The source stays held at the record; nothing is ever committed past it. Fixture sources keep their evidence locally, labeled as fixture evidence.
  - `transientMapperRetries` re-runs the whole mapping after a `TransientMappingError`, waiting 250 ms and then 1 s, before holding.
  - `resumeSource` with failure handling retries the held record and is refused while an advance is unresolved. A record that processes on retry resolves its incident as processed.
  - A group position that moved past a held record without a recorded advance (retention, an offset reset, another consumer) holds the source instead of being treated as progress. So does a record whose incident was captured on a different Kafka cluster (a changed cluster ID).
  - New CLI forms: `streamotter init --failures --config <path> --state-dir <dir>` creates the journal (ordinary startup never creates one), and `dev` and `start` accept `--state-dir`; `start` also accepts `--handler-build-id`. `init --failures` refuses while a leftover `journal.sqlite-wal` or `-shm` file is present, so a crashed journal's last commits are never lost.
  - Fixture records may be `{ key, raw }` to rehearse malformed input in development.
  - `quarantine-resync` continues past an eligible quarantined record only when the source's recovery guard (`handlers.sources[id].recover`) returns `recoverable`:
    - The cumulative recovery boundary and the intent to advance are journaled before the offset moves. The commit is confirmed by reading it back.
    - From then on every snapshot on the source receives `recovery` and must echo `recoveryBoundaryId` before a subscription can be `live`, including after restarts and for new subscriptions.
    - A circuit breaker (default five distinct incidents per 60 s) stops automatic continuation and persists across restarts.
    - `boundaryRetirement: "application"` calls `retire()` after acknowledged snapshots.
    - At startup, prepared advances are reconciled against the consumer group's committed offset. While an advance is unresolved, every record of the source holds, on every partition.
- V1.1 operator workflow (opt-in; nothing changes without `failureHandling`):
  - `@streamotter/gateway/operator` (also `streamotter/gateway/operator`): `getGatewayOperator(gateway)` returns the operator service, with `status`, `listFailures`, `showFailure`, `exportFailure`, `retryCurrent`, `reassess`, `reopenCircuit`, `retireBoundary`, `evaluate` and `redrive`. Every mutation records its intent and its result in the incident store; an operation interrupted by a crash is reported as `unknown` after restart and never rerun, and a reused operation ID returns the recorded result. Refusals are results (`result: "refused"` with an `outcome`), not exceptions.
  - Retry and reassess process the held record again; neither skips it. While the circuit of a `quarantine-resync` source is open, retries (including `resumeSource`) are refused with `circuit-open` until `reopenCircuit`.
  - `evaluate` runs the current mapping on the stored original without committing, tracing or delivering, and issues a five-minute, single-use plan when a redrive is allowed. `redrive` checks the plan again and admits the outputs through the normal revision filter, so older state is `superseded` and never overwrites newer state.
  - The new `operatorSocket` gateway option (`--operator-socket` on `start` and `dev`) serves the operator API on `<stateDirectory>/run/operator.sock`, with a fresh 0600 token per start. `callOperator` and `connectOperator` are the client.
  - CLI: `streamotter status`, `streamotter failures list|show|export|evaluate|redrive` and `streamotter sources retry-current|reassess|reopen-circuit|retire-boundary`, all with `--state-dir` and `--json`. Exit code 3 means refused and 4 means the outcome is unknown, including a mutation whose answer was lost or timed out. With `--json`, every error is `{"error": StreamError}` on stderr. Raw bytes are shown only with `--raw` or `--include-raw`, and only as base64 and hex.
  - Development management API: `GET /management/v1/operator/status`, `GET /management/v1/failures`, `GET /management/v1/failures/{failureId}`, and `POST` routes for export, evaluate, redrive, retry-current, reassess and reopen-circuit. None returns raw evidence, and boundary retirement has no route.
  - `@streamotter/workbench`: a Failures tab listing incidents with their evidence, quarantine, source position, recovery and state kept separate, with the supported actions. It appears only when the host offers `failures.list`.
- V1.1 operations (opt-in; nothing changes without the new options):
  - The `health` gateway option (`streamotter start --health <host:port>`, 127.0.0.1 by default) serves `GET /health/live` and `GET /health/ready` on a separate listener. Liveness stays 200 during a broker outage; readiness answers 503 with reason categories only (`starting`, `source-held`, `source-unavailable`, `journal`, `quarantine`). No CORS, `Cache-Control: no-store`, and 404 with no body for anything else. The listener opens first at start and closes first at stop.
  - `streamotter sources rebaseline --config <path> --state-dir <dir> --source <id> --reason <text> --confirm <sourceId>`, run with the gateway stopped after a deliberate `generation` change, closes that source's incidents from earlier generations as rebaselined (with the reason and an operation ID in their history) and retires the earlier generation's recovery boundary. It never touches incidents of the current generation and never moves a consumer group.
  - Startup refuses (`CONFIG_INVALID`, `details.reason: "failure-handling-removed"`) when `failureHandling` was removed while the journal under `stateDirectory` still has open incidents or recovery boundaries in force, so a downgrade can't silently drop them.
  - The refusal for a `generation` changed while incidents are open now names `streamotter sources rebaseline`.
  - The order-dashboard example's orders source has an outbox-based recovery guard and snapshot acknowledgment (`decideRecovery`, `acknowledgeRecovery`), with a `quarantine-resync` configuration (`streamotter.kafka-resync.json`, `pnpm dev:kafka-resync`).
  - New guide: [Handle bad records](docs/guides/source-failures.md), the source-failure policies and operator runbook. The Kafka, deployment and troubleshooting guides and the package READMEs cover failure handling.
- V1.1 hardening from its [independent review](docs/releases/v1.1/REVIEW.md):
  - Startup replaces a stale `journal.lock` left by a dead process on the same host, including one naming the new process's own pid (a container restarted in place), once SQLite confirms nothing holds the journal. Lock files are written atomically.
  - An incident left `guard-pending` by a crash returns to `recovery: held` at startup.
  - The operator socket's `close()` (the first step of `gateway.stop()`) answers requests already running for up to 5 seconds. `callOperator` errors raised after a request was sent carry `details.reason: "no-answer"`.
  - `retryCurrent` and `reassess` wait for a quarantine write or guard already running on the source. A retry the gateway would refuse leaves the incident unchanged.
  - A redrive claims its plan and every other plan of the incident before it starts. A redrive of an unknown incident is refused `not-found`.
  - Redrive is refused while the source has any unresolved source-integrity fault: an integrity-class incident, an `uncertain` advance, an evidence conflict, a moved position, or an incident from another Kafka cluster.
  - `sources rebaseline` runs as one journal transaction and changes no other source.
  - Removing `failureHandling` together with a `generation` change is allowed.
  - Quarantine requests have a 10-second deadline.
  - `@streamotter/workbench`: a session end closes a running preview's connection, a 401 whose body is not a `Result` ends the session, and `apiBase` refuses percent-encoded dot segments.
  - The order-dashboard guard decides "never changed" from the order's seed revision, and holds when two outbox rows record the same position.
- Gateway operator logs for a paused source now include `failureClass`, the trusted classification of why the record could not be processed.
- `@streamotter/workbench`: a favicon (the StreamOtter brandmark reduced for a browser tab) in place of the blank one.
- Workbench host contract, version 1 ([WHC-1](./docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md)), for running the published workbench under a route of your own site:
  - `@streamotter/workbench` reads an optional `<script type="application/json" id="streamotter-workbench-host">` boot block (API base path, `token` or `session` authentication, gateway, environment label), discovers the offered operations, and shows anything else as "Not available in this environment". Without the block it behaves as before. The package ships `dist/workbench-host.json` (entry files, `sha384` integrity values, required CSP) and exports `@streamotter/workbench/host`, `@streamotter/workbench/dist/*` and `@streamotter/workbench/package.json`. This `exports` map replaces open subpath access: files under `dist/` still resolve through `@streamotter/workbench/dist/*`, but other paths in the package (such as `README.md` and `LICENSE`) no longer resolve.
  - `@streamotter/gateway/management`: `createManagementHandler`, a mountable handler for a development-mode gateway with an operation allowlist and a host `authorize` callback. The development management API gains `GET /management/v1/workbench`.
  - `@streamotter/contracts`: `WorkbenchHostConfig`, `WorkbenchOperation`, `WorkbenchDiscovery`, `WorkbenchHostManifest`, `WORKBENCH_OPERATIONS` and `validateWorkbenchHostConfig`.
  - WHC-1 revision 0.3, for a site whose API is on another origin and whose page keeps its own header, footer and styles: an optional `apiOrigin` boot field (an exact `https:` origin, `session` auth only; requests use CORS with `credentials: "include"` and `redirect: "error"`, and never send `Authorization`), and `isWorkbenchApiOrigin` in `@streamotter/contracts`. `@streamotter/workbench` ships `dist/workbench-host.css`, generated from `styles.css` with every selector scoped under `[data-streamotter-workbench]`, which the workbench sets on its mount when a boot block is present; the manifest names it as `entry.hostStyle` with an integrity value, and `connect-src` gains an `"<api origin>"` placeholder. The native page keeps `styles.css` unchanged.
  - `@streamotter/workbench`: in `session` mode, a `401` or `UNAUTHENTICATED` answer shows a "Session ended" screen with a Reload button and stops all requests, instead of a generic error.
- `@streamotter/workbench`: the top bar shows the environment (`Development` under `streamotter dev`).

### Changed

- Development management API: an unknown route answers 404 before its request body is read (it could previously answer 400 or 413 for a malformed body first).
- Configuration validation refuses a `limits` timeout above 2,147,483,647 ms (Node would fire it after 1 ms), and an `enum` whose values break the schema's own `minLength` or `maxLength`. `generateFiles` validates its input like the CLI does.
- `limits.maxControlFrameBytes` must be at least 9216, so that a CONNECT frame carrying an 8 KiB token fits. This assumes a token that JSON doesn't escape, such as a JWT, base64url or hex. A configuration with a smaller value now fails validation with `INCONSISTENT_LIMITS`.
- In production, subscribe parameters that fail the channel's `paramsSchema` are answered `FORBIDDEN`, like an unknown channel, and traced as `INVALID_PARAMS`. The subscription limit, a reused subscription ID, parameters that aren't an object, and parameters over `maxParamsBytes` are checked before the channel lookup, as `docs/V1_API.md` §7 describes. Development still returns `INVALID_PARAMS` with the failing path.
- `streamotter init` removes a partial scaffold and exits 2 when a write fails partway (permissions, a full disk). Before, it exited 1 and left files behind.
- `test:kafka`, `test:kafka:replicated` and `test:deploy` fail when their service isn't running. Set `STREAMOTTER_ALLOW_SKIP=1` to skip them instead.

### Fixed

From the V1.2 review ([findings and log](docs/releases/v1.2/README.md)):

- Gateway:
  - A client that stops reading is disconnected once its unsent output passes `maxPendingBytesPerConnection`, instead of growing gateway memory without limit.
  - Malformed and unknown frames count against the control rate limit.
  - A session revoked while its connection was being set up is refused.
  - `stop()` and SIGINT/SIGTERM interrupt a startup in progress and honor the stop deadline. Before, they waited for startup to finish, or forever if a handler module never loaded.
  - A mapped property or snapshot property set to `undefined` is treated as absent, as JSON does. Before, it paused the source as an integrity failure.
  - A configuration with schemas nested 8 or more levels deep no longer crashes `validate`, `generate` or startup.
- Kafka source:
  - A paused source stays paused through a consumer crash and restart. Before, it fetched in a busy loop.
  - A record that takes longer than the group session timeout keeps heartbeating, so it is committed once instead of being reprocessed forever.
- `@streamotter/client`:
  - Unsubscribing before a subscribe is acknowledged now unsubscribes on the gateway.
  - A rate-limited resync retries after 1 s and then 2 s instead of freezing in `authorizing`.
  - A rate-limited unsubscribe is retried instead of being reported as done.
  - The React provider in the README works under StrictMode.
- `@streamotter/cli`:
  - Generated example code escapes U+2028 and U+2029, which could otherwise inject code.
  - `generate` refuses symbolic links and a non-directory `--out` (exit code 2).
  - `init` checks its paths before writing anything.
  - Command names such as `constructor` are rejected as unknown.
  - `--json=…` and malformed `--management-port` values are handled.
  - `sources rebaseline` is in the usage text.
- `@streamotter/workbench`:
  - Preview keeps drawing after a tab switch, and a second Start no longer leaks a preview.
  - Export URLs are released.
  - Connect shows the latest status.
- The order-dashboard example no longer shows one order's data under another's header after quick clicks, and it reports failed requests.

From V1.2.1 ([fixes](docs/releases/v1.2.1/FIXES.md)):

- Gateway:
  - Refused handshakes are traced at a bounded rate (10/s after a burst of 100). The count of skipped traces is logged within a second and at stop. Connection floods no longer evict operator traces.
  - `authenticate`'s signal aborts when the client disconnects mid-handshake. A call that ignores it still counts against `maxConnections` until it settles or times out.
  - Overlapping CONNECTs on one connection close it, instead of opening sessions nothing can reach.
  - Management GET routes refuse a request body with 400.
  - When `stop()` passes its deadline, the listening port is released before it returns, and the remaining shutdown work's completion is logged.
  - Resuming a revision-conflict pause logs a warning. V1_API explains that the retry is checked against current state.
- `@streamotter/client`:
  - A gateway that closes the connection right after its hello now leads to a reconnect. Before, the client was stuck in `connected` (Node).
  - `resync()` on a `stale` subscription keeps it `stale` until the gateway starts the attempt, and concurrent calls send one request.
  - A resync that gives up before a new epoch ends in `resync-required`, and `resync()` rejects with `RESYNC_REQUIRED` instead of timing out.
  - A listener removed while an event is being dispatched is no longer called, even for that event.
- Kafka source:
  - A failed offset commit is retried in the background, and a commit counts only when KafkaJS actually made it.
  - With `startFrom: "latest"`, the start position is committed when the gateway joins and starts fetching. A restart before the first record no longer skips records produced in between.
  - A committed offset outside the retained range is logged.
  - The start-position read gives up cleanly after 5 s and is closed by `stop()`.
  - When the watchdog marks a source degraded during a slow record, the warning names the record and how long it has been processing.
- Development: local fixture evidence expires seven days after it was stored, and is then reported as `evidence-expired`.
- Codegen: generated type names no longer change when schemas are reordered.
- `@streamotter/workbench`:
  - Inspect no longer mixes in rows from a previous filter.
  - Define clears its validation result when the candidate is edited.
- `validate` words the journal's Node-version refusal exactly as the gateway does.
- Scripts:
  - Caddy and the Temurin 21.0.12.1 JDK (x64 and arm64 Linux) are pinned by checksum.
  - A missing Java gives a clear message.
  - `kafka:start` and `kafka:stop` check that the pid is this checkout's broker, including through a symlinked path.
  - `kafka:start` refuses when the broker ports are taken.
- Packaging: public packages build on `prepack`.
- CI:
  - Actions are pinned by SHA.
  - The extended tiers run on Node 24 and 26.
  - A nightly job runs the replicated Kafka tier.
- Tests: the load, token-expiry and several V1 tests were strengthened so they can fail, and 12 documented V1 behaviors gained coverage.

From the release-candidate run on macOS:

- Gateway: the operator socket answers an oversize request line to a caller that is still writing, instead of closing with its input unread, which reset the connection on macOS so the caller never saw the answer. It reads and discards the rest until the caller ends its side, for at most one second after the answer. A connection refused past the connection limit gets the same treatment.
- Tests: the management rate-limit burst and the refused-handshake floods connect at bounded concurrency, so they no longer overflow macOS's 128-connection listen backlog and fail on reset connections.
- CLI: an operator command pointed at a state directory whose socket path is over 103 bytes (macOS's limit) says so, instead of failing with `EINVAL`. The gateway already refused to start there. The packed-install test now keeps its state directory short enough for macOS.

## [0.1.0-rc.3] — 2026-09-25

### Added

- **`streamotter`**, everything in one install: the `streamotter` command, and the individual packages as subpaths (`streamotter/client` for the browser, `streamotter/gateway` and `streamotter/gateway/management` for Node.js, `streamotter/contracts`, and `streamotter/cli`). There is no bare `streamotter` import, so browser bundles never pull in server code. It contains no code of its own and depends on the individual packages at exactly its own version.
- `@streamotter/cli`: `init` and `generate` write imports from `streamotter/…` when the nearest `package.json` lists `streamotter` and not `@streamotter/client`, and from `@streamotter/…` otherwise. The new `runProcess()` export runs the CLI as a process, and both `streamotter` commands use it.
- The StreamOtter logo on the npm pages and the repository README.

### Changed

- The guides and the root README install `streamotter` and import from its subpaths. The individual packages remain the right choice for a frontend that lives apart from the gateway, and for a gateway-only service.

## [0.1.0-rc.2] — 2026-09-25

Documentation and packaging. The gateway, SDK, CLI, and workbench code is unchanged from `0.1.0-rc.1`.

### Added

- Guides: [getting started](./docs/guides/getting-started.md), [adding live state to an existing app](./docs/guides/existing-app.md), [connecting to Kafka](./docs/guides/kafka.md), and [troubleshooting](./docs/guides/troubleshooting.md). The [production guide](./docs/DEPLOYMENT.md) is rewritten for npm installs, with supervision and restart-after-crash advice.
- `main` and `types` fields in the package manifests, for tools that don't read `exports`.

### Changed

- Package READMEs (the npm pages): install commands without a tag, links to the guides, and a table of the StreamOtter packages.

### Fixed

- Tests only: the Kafka restart-after-crash test could miss its 30-second startup deadline and then hang its suite; it now waits for the crashed member to leave the consumer group, and always cleans up. Topic creation right after the broker starts no longer fails, and every test script exits once its tests finish (`--test-force-exit`).

## [0.1.0-rc.1] — 2026-09-25

First public release candidate of StreamOtter V1, published under the npm `next` tag. Because the packages were new, npm also pointed `latest` at it.

### Added

- **`@streamotter/gateway`**: one Node.js gateway per project. Kafka sources (KafkaJS 2.2.4: explicit per-record commits, poison records pause without skipping, rebalance and outage trigger resynchronization) and deterministic fixture sources. Application-owned `authenticate`, `authorize`, `map`, and `snapshot` handlers. Snapshot synchronization with revision ordering. Bounded per-subscription, per-connection, and gateway-wide delivery budgets. Revocation, including while handlers are pending. Socket.IO 4.8.3 delivery over WebSocket. A development-only management API.
- **`@streamotter/client`**: the browser SDK. Typed subscriptions, explicit connection and subscription states (`live`, `stale`, `resync-required`, …), receipts, reconnection with full jitter, token refresh, and account-switch closure.
- **`@streamotter/cli`**: `init`, `validate`, `generate` (TypeScript channel types), `dev` (gateway, workbench, management API), and `start` (production gateway).
- **`@streamotter/workbench`**: the local workbench served by `streamotter dev` (Connect, Define, Preview, Inspect, Export).
- **`@streamotter/contracts`**: the public types, protocol constants, error vocabulary, and configuration and schema validation shared by the gateway and SDK.

### Verified

Acceptance scenarios, real-Kafka behavior (Apache Kafka 4.1.2), a declared-workload resource test, browser tests (Chromium), a production deployment behind a TLS-terminating proxy, and an install test of the packed packages outside the workspace. See [IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md) for the commands, results, and limitations.

### Known limitations

A single gateway per project, no durable replay or revocation store, no production health endpoint, Chromium-only browser checks, and Kafka verification against one broker version. Details are in the implementation status document.

[0.1.0-rc.3]: https://github.com/jfricano/StreamOtter/releases/tag/v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/jfricano/StreamOtter/releases/tag/v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/jfricano/StreamOtter/releases/tag/v0.1.0-rc.1
