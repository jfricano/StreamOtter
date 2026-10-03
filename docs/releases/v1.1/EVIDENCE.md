# StreamOtter V1.1 — Requirement-to-evidence matrix

**Status:** Tracking table, created October 3, 2026. Every row starts at *planned*. A row moves to *implemented* when code and tests merge, and to *verified* only with a recorded run: the command, environment, commit, and result, linked from [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md). Scenario wording is in the [acceptance plan](./V1_1_ACCEPTANCE_PLAN.md); it is not repeated here.

Tiers: **fixture** (in-process, `pnpm test`), **kafka** (local single broker, `pnpm test:kafka`), **crash** (child process killed at a boundary), **browser** (`pnpm test:browser`), **install** (packed artifacts, `pnpm test:install`), **replicated** (multi-broker; required before any broker-failure claim).

| ID | Scenario (short) | Slice | Tiers needed | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| F01 | Existing V1 configuration with no new feature enabled | B (PR 4) | fixture, kafka | planned | |
| F02 | Unknown action, catch-all skip, integrity-class continuation, … | A (PR 3) | fixture | planned | |
| F03 | Invalid JSON under default pause | B (PR 4) | fixture | planned | |
| F04 | Invalid mapped public payload with valid routing/revision | B (PR 4) | fixture | planned | |
| F05 | Multi-channel record where one output fails validation | B (PR 4) | fixture | planned | |
| F06 | Invalid tenant, parameters, revision, output count, or conflicting … | B (PR 4) | fixture | planned | |
| F07 | Typed transient mapper failure succeeds after retry | B (PR 4) | fixture | planned | |
| F08 | Arbitrary mapper exception/timeout or transient retry exhausted | B (PR 4) | fixture | planned | |
| F09 | Broker outage, token denial, or stalled browser | B (PR 4) | fixture, kafka | planned | |
| F10 | Byte-preserving capture with binary key, invalid UTF-8 value, null … | B (PR 4) | kafka | planned | |
| F11 | Source record, header, envelope, or local spool exceeds budget | B (PR 4) | fixture, kafka | planned | |
| F12 | Journal persistence fails before quarantine | B (PR 4) | fixture | planned | |
| F13 | Missing topic, denied ACL, oversized broker message, or … | C (PR 5) | kafka | planned | |
| F14 | Quarantine accepted but acknowledgment lost | B (PR 4) | kafka | planned | |
| F15 | Crash after evidence acknowledgment, before original commit | B (PR 4) | crash, kafka | planned | |
| F16 | Crash after prepared recovery barrier, before source commit | C (PR 5) | crash, kafka | planned | |
| F17 | Commit succeeded but response/local final write lost | C (PR 5) | crash, kafka | planned | |
| F18 | Stop, rebalance, or stale batch during write/guard/commit preparation | C (PR 5) | kafka | planned | |
| F19 | Quarantine-hold followed by guarded retry-current | D (PRs 2, 6) | fixture | planned | |
| F20 | Missing, denied, throwing, timed-out, or invalid recovery guard | C (PR 5) | fixture | planned | |
| F21 | Guarded continuation with authoritative snapshot coverage | C (PR 5) | fixture | planned | |
| F22 | Lagging snapshot returns no/wrong coverage boundary | C (PR 5) | fixture | planned | |
| F23 | New subscription/account reconnect after prior skip and gateway … | C (PR 5) | fixture, crash | planned | |
| F24 | Two incidents affect different unknown entities/audiences | C (PR 5) | fixture | planned | |
| F25 | Snapshot/mapper/guard completes after epoch change, revoke, stop, … | C (PR 5) | fixture | planned | |
| F26 | Five distinct automatic advances, sixth within window; duplicate … | C (PR 5) | fixture, crash | planned | |
| F27 | Held source record expired or group offset is out of range | B (PR 4) | kafka | planned | |
| F28 | Raw quarantine expired before a later advance or evaluation | D (PRs 2, 6) | fixture | planned | |
| F29 | Journal missing/corrupt/incompatible, wrong source generation, … | B (PR 4) | fixture | planned | |
| F30 | Second gateway opens same journal; external group position moved | B (PR 4) | fixture, kafka | planned | |
| F31 | Evaluate a retained original | D (PRs 2, 6) | fixture | planned | |
| F32 | Expired plan, changed config/build/evidence/revision, or changed … | D (PRs 2, 6) | fixture | planned | |
| F33 | Approved gateway-local reprocessing of one already-skipped valid … | D (PRs 2, 6) | fixture | planned | |
| F34 | Reprocessed full state is older/equal to current snapshot | D (PRs 2, 6) | fixture | planned | |
| F35 | Redrive loses response or crashes during application admission | D (PRs 2, 6) | crash | planned | |
| F36 | Attempt bulk, edited-payload, arbitrary-topic, cross-generation, … | D (PRs 2, 6) | fixture | planned | |
| F37 | Browser/application token reaches operator/health/raw surfaces | D (PRs 2, 6) | fixture | planned | |
| F38 | Local socket/token permissions, path ownership/symlink, stale … | D (PRs 2, 6) | fixture | planned | |
| F39 | Raw payload contains secrets, markup, or instructions | D (PRs 2, 6) | fixture | planned | |
| F40 | Raw export and metadata bundle | D (PRs 2, 6) | fixture | planned | |
| F41 | Journal capacity, topic-scan budget, audit limit, or repeated … | D (PRs 2, 6) | fixture | planned | |
| F42 | Unaffected independent source while another is held/quarantining | C (PR 5) | fixture | planned | |
| F43 | Healthy source, paused source, broker outage, startup, shutdown, … | E (PR 7) | fixture, kafka | planned | |
| F44 | Workbench failure lifecycle and old-state display | D (PRs 2, 6) | browser | implemented (seam part) | PR 2 (`feat/v1.1-workbench-host`), October 3, 2026: `pnpm test:browser` 26/26 pass, including `tests/browser/workbench-host.test.ts` 13/13 (host under `/workbench/`, `session` boot block, `createManagementHandler` behind a fake cookie session, strict CSP and SRI, unlisted operations unavailable and never requested, no `Authorization` header, no cross-origin API request) and the unchanged `tests/browser/workbench.test.ts` 7/7. Server side: `tests/integration/workbench-host.test.ts` 9/9 within `pnpm verify` 130/130. Headless Chromium 141 (local fallback, see the log). The failure lifecycle itself lands with PR 6. |
| F45 | Chromium, Firefox and WebKit failure/reconnect/cleanup path | E (PR 7) | browser (3 engines) | planned | |
| F46 | Published/packed install, clean config, production proxy, local … | E (PR 7) | install | implemented (seam part) | PR 2 (`feat/v1.1-workbench-host`), October 3, 2026: `pnpm test:install` 21 tests, 20 pass, 1 skipped (TLS Kafka; no local broker). The packed `@streamotter/workbench` contains `dist/workbench-host.json`, its `sha384` values match the packed `app.js` and `styles.css`, and `@streamotter/workbench/host`, `/dist/*` and `/package.json` resolve after `npm install` outside the workspace. The rest of F46 (clean config, production proxy) is PR 7. |
| F47 | Replicated Kafka evidence write under leader/ISR failure | E (PR 7) | replicated | planned | |
| F48 | Upgrade then downgrade with unresolved/advanced incidents | E (PR 7) | crash | planned | |

## Not establishable by tests

Recorded here so no row is read as more than it shows (acceptance plan §3):

- Whether a real application's recovery guard and snapshot acknowledgment are true. The runtime checks identity and lifecycle only (spec §7.2).
- Broker-failure durability from single-broker runs (F47 must name its replication settings).
- Security beyond the listed checks. Passing F37–F40 is not a security audit (spec §15).
