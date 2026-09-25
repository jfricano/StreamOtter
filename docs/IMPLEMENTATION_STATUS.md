# StreamOtter V1 implementation status

September 25, 2026 · V1 release candidate, packaged as `0.1.0-rc.1` (not yet published to npm)

V1 is implemented in this repository through the handoff's slices 1–4: the gateway, browser SDK, shared contracts, CLI with the TypeScript generator, local workbench, and the order-dashboard reference application. It is tested with fixture-backed integration tests, real-Kafka tests, a declared-workload resource test, automated browser tests, and a production-shaped deployment check behind a TLS-terminating proxy, on Node 24 and Node 26. Gate A of the home site and demo plan is met. The public home site and hosted demo (Gate B milestone) are **not started**.

This document records what exists, the commands that verify it, the results observed, and the limitations that remain. The [V1 specification](./V1_API.md) governs behavior; its [section 13](./V1_API.md#13-implementation-refinements-contract-revision-02) lists refinements made during implementation.

## Environment used for the results below

| Component | Version |
| --- | --- |
| OS / CPU | macOS (Darwin 25.6), Apple silicon (arm64), 10 cores |
| Node.js | **24.21.0** (the specification's target; project-local in `.local/node24`) and **26.9.0** |
| pnpm / TypeScript | 11.19.0 / 5.9.3 |
| npm (install test) | 11.19.1 with Node 26, 11.19.0 with Node 24 |
| Socket.IO server and client | 4.8.3 (pinned, identical) |
| KafkaJS | 2.2.4 (pinned) |
| Apache Kafka | 4.1.2, single-node KRaft, native (`scripts/kafka`), Eclipse Temurin JDK 21.0.12.1 |
| esbuild / React | 0.28.2 / 19.3.0 (workbench and example only) |
| Browser automation | Playwright 1.63.0 with Chrome Headless Shell 153 (`.local/ms-playwright`) |
| Reverse proxy | Caddy 2.11.4 (`.local/caddy`, checksum-verified by `scripts/deploy/setup-caddy.sh`) |

## What is implemented

| Area | Location | Notes |
| --- | --- | --- |
| Contracts | `packages/contracts` | Single source of the public types (`contracts/v1/api.ts` re-exports them), error vocabulary, protocol constants, bounded schema dialect, config validator, canonical JSON, revision comparison, limits. Browser-safe. |
| Gateway | `packages/gateway` | `defineProject`, `createGateway` (start/stop/revoke/resumeSource), handshake authentication, per-connection sessions, the synchronization state machine, routing by verified tenant and canonical parameters, budgets, receipts, revocation log, traces. |
| Sources | `packages/gateway/src/sources` | Deterministic fixture source; KafkaJS 2.2.4 adapter with explicit per-record commits, pause-and-seek on poison records, rebalance/crash/inactivity detection, staged diagnostics, tracked sockets. |
| Transport | `packages/gateway/src/transport/socketio.ts`, `packages/client/src/connection.ts` | Socket.IO 4.8.3, namespace `/`, WebSocket only, recovery and client reconnection disabled; the only files that import Socket.IO. |
| Management API | `packages/gateway/src/management` | All specified `/management/v1` routes plus `GET /dev/principals`; bearer token, exact-origin/Referer checks, `Result` envelopes and status codes, 1 MiB bodies, rate limit, workbench hosting with CSP. Refuses production gateways. |
| Browser SDK | `packages/client` | `createClient`, subscriptions with epochs, sequence/revision validation, receipts after synchronous dispatch, listener-failure handling, `ready`/`resync`/`unsubscribe`/`close`/`reconnect`, full-jitter reconnection, token refresh, account-switch closure. |
| CLI | `packages/cli` | `init`, `validate` (prints the canonical fingerprint), `generate` (manifest-guarded overwrite), `dev`, `start`; exit codes 0/1/2; SIGINT/SIGTERM graceful shutdown; startup diagnostics. |
| Workbench | `apps/workbench` | Connect (status, staged checks, resume, fixture advance), Define (channel contracts, candidate editor, validation, restart-required indicator), Preview (real SDK subscription as a development principal; advance, disconnect, resync), Inspect (filterable, polling trace table), Export (canonical file, fingerprint, CLI commands). |
| Reference example | `examples/order-dashboard` | Application-owned identity, ownership rules, snapshot storage; fixture and Kafka modes; vanilla TypeScript and React views; reproducible scenarios. |
| Local Kafka | `scripts/kafka` | Checksum-verified download of Kafka 4.1.2 and a JDK; broker with PLAINTEXT/SSL/SASL_SSL listeners and generated certificates; an unexercised Docker Compose alternative. |
| Docs | `docs/DEPLOYMENT.md`, this file, `README.md`, V1 spec §13 | Local setup, the single-gateway production boundary, and a verified reverse-proxy recipe. |
| Packaging | package manifests, `LICENSE`, package READMEs, `tests/install`, `docs/RELEASE_CHECKLIST.md` | MIT license; version `0.1.0-rc.1` for all five public packages; published manifests pin internal dependencies to that version and drop the in-repository `streamotter-source` condition; each package's README is its npm-page guide; the workbench ships the license notices of the Socket.IO client code it bundles. |
| Browser and deployment tests | `tests/browser`, `tests/deploy`, `scripts/browser`, `scripts/deploy` | Playwright checks of the workbench and example; a Caddy-fronted production deployment check. |

## Verification commands and results

Runs on September 24, 2026 in the environment above, repeated on September 25 after the packaging changes (every suite passed again; see the note on `pnpm test` below). Build, checks, and every test suite passed on both Node 24.21.0 and Node 26.9.0 (timings from Node 26); install and the clean-checkout simulation ran on Node 26.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passes. |
| `pnpm build` | Passes: `tsc -b` for all packages (JS + declarations), workbench bundle (87 KB), example server and web bundles. |
| `pnpm check:contracts` | Passes. The original example and every `@ts-expect-error` negative check compile against the implementation. |
| `pnpm typecheck` | Passes (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) for packages, tests, workbench, and example. |
| `pnpm test` | **113 / 113 passed**, 21 suites, about 10 s. |
| `pnpm test:kafka` | **20 / 20 passed** against Apache Kafka 4.1.2, 1 min 54 s (includes ~30 s waiting out a killed consumer's session). |
| `pnpm test:load` | Passed (results below). |
| `pnpm test:browser` | **13 / 13 passed**: 7 workbench and 6 example checks in headless Chromium (builds first). |
| `pnpm test:deploy` | **4 / 4 passed**: the Caddy-fronted production deployment below (builds first; needs the broker and Caddy). |
| `pnpm test:install` | **14 / 14 passed** on Node 24.21.0 and 26.9.0 with the broker running (13 plus one skipped without it): the installed-package checks below. |
| `pnpm publish --dry-run` (all five) | Passes for `0.1.0-rc.1` in dependency order (contracts, client, gateway, workbench, cli). |
| Clean checkout | The tree copied without `node_modules`, build output, `.local/`, or data: install, build, `check:contracts`, `typecheck`, `test` (103 tests at that point), `test:load`, and `pnpm example` all succeeded. |

### Installed packages (`pnpm test:install`)

`tests/install/install.test.ts` packs the five public packages with pnpm (as `pnpm publish` does), installs the tarballs with npm into a new project in the system temporary directory (no workspace links; `streamotter-source` unavailable), and checks:

- **Tarballs:** one version across all five; `workspace:` rewritten to that exact version; MIT `license`, `repository`, `homepage`, `bugs`, and public access; published `exports` equal the workspace `exports` minus the source condition; only `package.json`, `README.md`, `LICENSE`, `dist`, `src`, and `bin` at the top level; `LICENSE` identical to the repository's; README links absolute; `dist` contains exactly the compiled sources (no stale output) with declarations; the workbench assets and third-party license notices.
- **Installation:** real, deduplicated copies inside the consumer project; the `streamotter` bin linked.
- **CLI:** `init`, `validate` (fingerprint), `generate`; `dev` serves the workbench page and its assets from the installed `@streamotter/workbench`, and a script using the installed `@streamotter/client` creates a preview session, subscribes, advances the fixture, and receives revisions 0 → 100 %, then `SIGINT` exits 0; `start` refuses the fixture scaffold with exit code 2.
- **Bundling:** esbuild bundles the scaffold's browser code for `platform: browser`; every input comes from the consumer project, the SDK and contracts from `dist/`, none from `src/`.
- **Types:** strict `tsc` (with `skipLibCheck: false` and `exactOptionalPropertyTypes`) over browser code (bundler resolution, DOM, no Node.js types) and server code (NodeNext) importing every public entry point, with `@ts-expect-error` checks that generated channel types reach the published generics.
- **Programmatic gateway:** `createGateway` + `@streamotter/gateway/management` + the installed SDK: snapshot revision 1, fixture update revision 2, then session revocation (`closedSubscriptions: 1, closedConnections: 1`), the client in `auth-required`, the subscription `stale`, and `live` not restored.
- **With the broker running:** the installed `streamotter start` in production mode consumes Kafka over TLS, has no management routes, delivers a produced update, and exits 0 on `SIGTERM`.

After publishing, `STREAMOTTER_INSTALL_FROM=registry pnpm test:install` runs the same checks against the version on the npm registry. The package READMEs' code samples were also type-checked against the installed packages, the gateway README's configuration validated, and the CLI README's first-run flow (`npm init`, install, `init .`, `validate`, `dev`, `generate`) run as written; those were one-time checks, not part of the automated test.

### Acceptance scenarios (V1 specification §12)

| # | Scenario | Evidence |
| --- | --- | --- |
| 1 | Snapshot before any update; `live` only after the drain boundary | `tests/integration/sync.test.ts` (exact timeline `snapshot:1, update:2, update:3, live`); Kafka `01-progress` |
| 2 | Update during snapshot loading, including a snapshot already ahead | `sync.test.ts` 2a/2b/2c, big-number revision comparison; example scenario 1 |
| 3 | Overflow or source restart invalidates the epoch; stale snapshots cannot restore `live` | `sync.test.ts` 3a/3b; `flow-control.test.ts` (overflow while live, late receipts for old epochs ignored) |
| 4 | Cross-tenant routing, expired tokens, revocation (including while authorize/snapshot/authenticate is pending) fail closed | `access.test.ts` (12 tests); example scenario 3 |
| 5 | Stalled client bounded, disconnected, not blocking healthy clients or the source | `flow-control.test.ts` (one frame in flight, stalled disconnect with 30 records committed in < 400 ms, gateway-wide budget); `tests/load` |
| 6 | Poison record pauses without advancing; retry after correction processes the same record; crash after admission, before commit, does not regress displayed state | Fixture: `source-failures.test.ts`. Kafka: `02-poison` (invalid JSON, handler failure, tombstone; committed offsets checked on every partition), `03-crash` (SIGKILLed gateway process, redelivery filtered, displayed revisions monotonic) |
| 7 | Cleanup, reconnect, concurrent resync, account switch, handler failure | `lifecycle.test.ts` (15 tests), `access.test.ts` account switch, load-test churn |
| 8 | Workbench/CLI exports agree; production exposes no management/development; traces omit credentials and payloads | `management.test.ts`, `cli.test.ts` (fingerprint agreement), `source-failures.test.ts` (trace redaction), Kafka `05-security` and `07-production-cli` (compiled `streamotter start` against TLS Kafka) |
| 9 | Unsupported V2/V3 options fail clearly; source and channel names stay separate; generated types agree with schema validation | `contracts.test.ts`, `protocol.test.ts`, `lifecycle.test.ts`, `generated-contracts.test.ts` (TypeScript compiler run over generated types) |

Real-Kafka behaviors also verified: `startFrom` latest vs earliest for new groups; rebalance → `stale` → fresh snapshot → delivery continues (`04-rebalance`); broker stopped and restarted mid-subscription (`06-startup-outage`: detected as stale after **13.0 s**, live again within **4.2 s** after the broker restart script returned (0–4.2 s across runs), new records delivered); unreachable brokers rejected within the 30-second startup deadline with the listener released.

### Kafka support matrix (KafkaJS 2.2.4 → Apache Kafka 4.1.2)

| Mode | Status |
| --- | --- |
| Plaintext (development only; rejected in production) | Verified |
| TLS with a supplied CA file | Verified (production gateway) |
| TLS + SASL PLAIN | Verified (production gateway) |
| TLS + SASL SCRAM-SHA-256 | Verified (production gateway) |
| TLS + SASL SCRAM-SHA-512 | Verified (production gateway) |
| TLS with system trust (`tls: {}`) | Implemented; **not verified** (needs a publicly trusted broker certificate) |
| Wrong password / untrusted CA / missing topic | Verified to fail at the `authenticate` / `tls` / `metadata` diagnostic stage without leaking credentials |
| Other Kafka versions, managed Kafka services, Docker Compose file | **Unverified** |

### Declared workload (`tests/load/load.test.ts`)

200 SDK clients (one connection and subscription each) over 20 orders in one tenant; 10 raw clients that never acknowledge; 600 fixture records (30 revisions per order, ~400-byte frames) as fast as the source commits; default limits except `receiptTimeoutMs` 1000 and `controlRequestsPerSecond` 1000; then 300 subscribe → live → unsubscribe cycles.

| Measurement | Result |
| --- | --- |
| 200 subscriptions live | 99–148 ms |
| 600 records committed by the source | 22–26 ms (never waited for the stalled clients) |
| 6,000 fan-out frames converged, all clients in revision order | 201–267 ms |
| Peak gateway pending bytes | 2.39 MB (limit 64 MiB) |
| Stalled clients | All disconnected by receipt timeout |
| 300 churn cycles | 86–88 ms; subscription, connection, and budget counters return to zero |
| Heap delta after release | 4–10 MB (mostly the bounded trace buffer) |

This is a single-process, loopback measurement of bounded behavior, not a capacity claim.

### Automated browser tests (`pnpm test:browser`)

Playwright drives the built assets in headless Chromium against real gateways and fails on any console error, page error, failed request, or CSP violation.

- **Workbench** (`tests/browser/workbench.test.ts`): a wrong token is refused and the per-run token opens it; Connect shows status and staged checks; Preview subscribes as a development principal, applies fixture updates, and after a forced disconnect shows stale → fresh snapshot → live; Inspect lists every stage and filters by outcome; Define shows the restart-required indicator and validation messages; Export's fingerprint equals SHA-256 of the canonical content; after a reload the token is gone (no local/session storage or cookies).
- **Order dashboard** (`tests/browser/order-dashboard.test.ts`): an update committed while the snapshot loads appears after the snapshot and before `live`; a same-ID order in another tenant never appears; a non-owned order is denied with no data and no recovery buttons; Reconnect produces stale → fresh snapshot → live; the React page shows two live orders and one denial; at 375 px wide there is no horizontal overflow.

### Deployment behind a TLS-terminating proxy (`pnpm test:deploy`)

One HTTPS origin served by Caddy with a certificate from a throwaway CA: `/streamotter/*` goes to the gateway, run by the **compiled** `streamotter start` in production mode and consuming Kafka over TLS + SASL SCRAM-SHA-512; everything else goes to the example application in Kafka mode. Verified: the browser's socket is `wss://…/streamotter/socket.io/` through the proxy; an application-published Kafka change reaches the page; a disallowed or missing `Origin` is `FORBIDDEN` through the proxy while the exact origin reaches authentication; no management route exists on the public origin or on port 7401; after `SIGTERM` (exit 0) the page shows *Reconnecting*, and a restarted gateway brings it back to live (about 2.5 s) with later updates delivered.

### Earlier manual browser checks (in-app Chromium)

- **Workbench** (a scaffolded project under `streamotter dev`): no console errors under its CSP. Checked: Connect status and staged checks; Define with an invalid candidate (clear V2 messages) and the restart-required indicator; Preview as a development principal — live, fixture updates, forced disconnect → stale → reconnect → fresh snapshot; Inspect stage ordering; Export fingerprint equal to `streamotter validate`. The workbench was exercised through a local test proxy that attached the management token server-side, so pasting the printed token into the token screen was not itself exercised.
- **Order dashboard**, fixture mode: sign-in, live snapshot and updates, a same-ID order in another tenant not delivered, denial for a non-owned order, Reconnect → fresh snapshot, and the React page (two live orders, one denied).
- **Order dashboard**, Kafka mode: Advance order → store write → Kafka publish → gateway commit → browser update (revisions 2 and 3).

## Decisions and deviations worth knowing

- **Per-frame authorization** is the synchronous check (connection open, token unexpired, subscription not revoked). The application's `authorize` handler runs at subscribe, every synchronization attempt, and just before snapshot delivery (spec §7, clarified in §13).
- **KafkaJS 2.2.4 defects found and contained in the adapter.** (1) Its request queue schedules a negative timeout that Node clamps to 1 ms; each open connection spins a 1 ms timer (and Node 24+ prints `TimeoutNegativeWarning`). A version-guarded replacement of that one method, applied inside the source adapter, cut an idle gateway's CPU from 2.6% to 0.3% of a core. (2) After reconnecting through a broker restart, KafkaJS can leave a connection open after `disconnect()`. The adapter supplies its own socket factory, tracks sockets, and closes survivors on stop so KafkaJS's error path tears the connection down. Both are pinned-version workarounds; revisit them when the Kafka client changes.
- **Commit granularity:** one offset commit per processed record, favoring simplicity and precise progress over throughput. Not measured against high-rate topics.
- **Outage detection:** broker loss is detected by the absence of fetch/heartbeat activity for 12 s (measured 13.0 s to `stale`), plus KafkaJS crash and rebalance events.
- **Crash recovery time** is governed by the 30 s consumer session timeout: a replacement gateway waits for the dead member to expire.
- **The example's stores are illustrative.** Fixture mode uses a read model fed by the fixture stream; Kafka mode persists a JSON file. Neither is a production database, and demo sign-in refuses `NODE_ENV=production`.

## Limitations and open items

- **Browsers:** automated and manual checks use Chromium only. Firefox and Safari (WebKit) are untested.
- **Deployment** was verified on one machine: Caddy on loopback with a private CA. Real hosting, public certificates, and other proxies (nginx, cloud load balancers) are unverified; their only requirements are WebSocket upgrade forwarding on the socket path and passing the browser's `Origin` header.
- Tests execute TypeScript sources through Node's type stripping and the `streamotter-source` export condition; published artifacts are the compiled `dist/`, which `pnpm test:install` exercises from packed tarballs.
- **No production health endpoint** (management is development-only by design); see `docs/DEPLOYMENT.md`.
- **Single gateway.** No multi-gateway operation, shared revocation, or durable revocation store, by design for V1.
- **Workbench:** one preview subscription at a time; the management token must be re-entered after a reload; the workbench does not run when the gateway fails to start (the CLI prints the same staged diagnostics instead).
- **Packages are not yet published** to npm. They are packaged as `0.1.0-rc.1` and tested as installed packages (`pnpm test:install`); publishing follows the [release checklist](./RELEASE_CHECKLIST.md) and the [release plan](./RELEASE_PLAN.md).
- **An unexplained `pnpm test` failure.** On September 25, one of twelve consecutive runs reported 112 / 113 (one failing test); the output of that run was not kept, so the test is not identified. The next eleven runs passed 113 / 113. Treat it as a possible timing-sensitive test until it is reproduced and fixed.
- **CI workflows** (`.github/workflows/ci.yml`, `extended.yml`) are written but have not run yet: there is no GitHub remote. The Linux paths of the Kafka and browser setup (Java from `actions/setup-java`, Playwright's system libraries) are exercised only there.

## Gate A status (home site and demo plan)

| Gate A condition | Status |
| --- | --- |
| Full V1 acceptance scenarios pass, including real Kafka progress, rebalance, and failure | Met (tables above) |
| Gateway, SDK, workbench, CLI, generation complete their workflow; clean checkout and exported example verified | Met (automated browser tests for the workbench and example) |
| Production build works within the single-gateway boundary and exposes no management or development actions | Met (compiled CLI behind a TLS-terminating proxy; no management routes) |
| Auth, revocation, synchronization, cleanup, overload/resource limits, broker authentication paths have results and explicit limitations | Met |
| No unresolved failure contradicts a promised V1 behavior | No known contradiction; limitations are listed above |

Gate A is met. The next milestone is the public home site and integrated `/demo` (Gate B), which needs product decisions first: domain, site framework, hosting provider, operating budget, and the demo's operator.
