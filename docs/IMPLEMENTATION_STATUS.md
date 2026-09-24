# StreamOtter V1 implementation status

September 24, 2026 · V1 release candidate (unreleased; packages not published)

V1 is implemented in this repository through the handoff's slices 1–4: the gateway, browser SDK, shared contracts, CLI with the TypeScript generator, local workbench, and the order-dashboard reference application. It is tested with fixture-backed integration tests, real-Kafka tests, a declared-workload resource test, and manual browser checks. The public home site and hosted demo (Gate B milestone) are **not started**.

This document records what exists, the commands that verify it, the results observed, and the limitations that remain. The [V1 specification](./V1_API.md) governs behavior; its [section 13](./V1_API.md#13-implementation-refinements-contract-revision-02) lists refinements made during implementation.

## Environment used for the results below

| Component | Version |
| --- | --- |
| OS / CPU | macOS (Darwin 25.6), Apple silicon (arm64), 10 cores |
| Node.js | **26.9.0** (the specification targets Node 24; Node 24 itself was not exercised) |
| pnpm / TypeScript | 11.19.0 / 5.9.3 |
| Socket.IO server and client | 4.8.3 (pinned, identical) |
| KafkaJS | 2.2.4 (pinned) |
| Apache Kafka | 4.1.2, single-node KRaft, native (`scripts/kafka`), Eclipse Temurin JDK 21.0.12.1 |
| esbuild / React | 0.28.2 / 19.3.0 (workbench and example only) |
| Browser for manual checks | Chromium-based in-app browser |

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
| Docs | `docs/DEPLOYMENT.md`, this file, `README.md`, V1 spec §13 | Local setup and the single-gateway production boundary. |

## Verification commands and results

All runs on September 24, 2026 in the environment above.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passes. |
| `pnpm build` | Passes: `tsc -b` for all packages (JS + declarations), workbench bundle (87 KB), example server and web bundles. |
| `pnpm check:contracts` | Passes. The original example and every `@ts-expect-error` negative check compile against the implementation. |
| `pnpm typecheck` | Passes (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) for packages, tests, workbench, and example. |
| `pnpm test` | **113 / 113 passed**, 21 suites, about 10 s. |
| `pnpm test:kafka` | **20 / 20 passed** against Apache Kafka 4.1.2, 1 min 54 s (includes ~30 s waiting out a killed consumer's session). |
| `pnpm test:load` | Passed (results below). |
| Clean checkout | The tree copied without `node_modules`, build output, `.local/`, or data: install, build, `check:contracts`, `typecheck`, `test` (103 tests at that point), `test:load`, and `pnpm example` all succeeded. |

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

### Manual browser checks (in-app Chromium)

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

- **Node 24** (the stated target) was not exercised; everything ran on Node 26.9. Tests execute TypeScript sources through Node's type stripping and the `streamotter-source` export condition; published artifacts are the compiled `dist/`.
- **Browser coverage** is one Chromium-based browser, checked manually. No automated browser tests (for example Playwright) exist yet for the workbench or example; SDK lifecycle is covered by automated tests running the SDK in Node against the real gateway.
- **Production deployment** was verified on loopback only: compiled `streamotter start` against TLS/SASL Kafka. A deployment behind an HTTPS/WSS reverse proxy has not been exercised.
- **No production health endpoint** (management is development-only by design); see `docs/DEPLOYMENT.md`.
- **Single gateway.** No multi-gateway operation, shared revocation, or durable revocation store, by design for V1.
- **Workbench:** one preview subscription at a time; the management token must be re-entered after a reload; the workbench does not run when the gateway fails to start (the CLI prints the same staged diagnostics instead).
- **Packages are not published** to npm; the CLI runs from this repository.

## Gate A status (home site and demo plan)

| Gate A condition | Status |
| --- | --- |
| Full V1 acceptance scenarios pass, including real Kafka progress, rebalance, and failure | Met (tables above) |
| Gateway, SDK, workbench, CLI, generation complete their workflow; clean checkout and exported example verified | Met, with the workbench verified manually rather than by automated browser tests |
| Production build works within the single-gateway boundary and exposes no management or development actions | Met locally; reverse-proxy deployment not exercised |
| Auth, revocation, synchronization, cleanup, overload/resource limits, broker authentication paths have results and explicit limitations | Met |
| No unresolved failure contradicts a promised V1 behavior | No known contradiction; limitations are listed above |

Recommended before starting the public-experience milestone: run the suites once on Node 24, add automated browser checks for the workbench preview flow and the example, and exercise one deployment behind a TLS-terminating proxy.
