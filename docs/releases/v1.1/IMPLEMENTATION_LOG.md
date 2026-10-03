# StreamOtter V1.1 — Implementation log and handoff

This is the working record for the V1.1 build: what was decided, what ran, what failed, and where to pick up. Newest entries go at the bottom of §2. Anyone resuming the work, person or agent, starts with §1.

## 1. Resume here

**Current state (October 3, 2026):** these PRs are open and stacked:
- planning, PR #12;
- the workbench seam, PR #14 (`feat/v1.1-workbench-host`, on #12);
- slice A, PR #13 (`feat/v1.1-contracts`, on #12);
- slice B, PR #15 (`feat/v1.1-quarantine-hold`, on #13), which includes the journal branch `feat/v1.1-journal`;
- slice C, PR #16 (`feat/v1.1-guarded-continuation`, on #15), which includes `feat/v1.1-recovery-store`;
- slice D, the operator workflow (`feat/v1.1-operator`, on #16), which merges PR #14 and the helper branches `feat/v1.1-operation-store`, `feat/v1.1-operator-ipc` and `feat/v1.1-failures-view`.

**Next step:** finish slice D with the Kafka quarantine reader (`feat/v1.1-quarantine-reader`) and WHC-1 revision 0.3 on PR #14, then slice E (PR 7): the health listener, the reference guard in the order-dashboard example, the runbook, the remaining evidence rows and the acceptance packet. Tell the Lontra Creek thread when PR #14 changes or merges and when a release is published.

**Open owner decisions:**

| ID | Question | Asked | Answer |
| --- | --- | --- | --- |
| D1 | Journal engine given `node:sqlite` warns on Node 24.0–24.14 ([API draft](./V1_1_API.md) §11) | October 3, 2026 | pending |

**Environment notes for a fresh session:**

- CI runs Node 24 and 26. Locally, use Node ≥ 24.15 so `node:sqlite` loads without a warning; the cloud image's default `node` is 22, so put an nvm Node 24 first on `PATH`.
- `pnpm install --frozen-lockfile && pnpm build && pnpm verify` is the baseline check (114 tests on `b0109ba`).
- `pnpm kafka:setup` once, then `pnpm kafka:start` for the real-broker tiers. Java 17+ must be on `PATH`.
- Commits: author and committer Jason Fricano `<44284799+jfricano@users.noreply.github.com>`, unsigned, no tool trailers. Set `user.name`, `user.email` and `commit.gpgsign false` in the clone.

## 2. Log

### October 3, 2026 — planning

- Confirmed the V1.1 plan is on `main` under `docs/releases/v1.1/` (merged before this work began). The `codex/docs-v1-1-plan` branch is behind `main` and was not used.
- Baseline: `pnpm build && pnpm verify` on Node 24.21.0 at `b0109ba`: 114 tests, 114 pass, 0 fail.
- Measured `node:sqlite` on Node 24.0.0, 24.4.0, 24.8.0, 24.12.0, 24.13.0, 24.14.0 (all print `ExperimentalWarning: SQLite is an experimental feature`), and 24.15.0, 24.16.0, 24.21.0, 26.10.0 (no warning). Recorded as decision D1 and put to the owner.
- Read Lontra Creek's V1.1 companion plan (`docs/releases/v1.1/LONTRA_CREEK_V1_1_COMPANION_PLAN.md` at its `main`) for the sandbox's needs: the actual published UI at a site origin, a visitor-scoped adapter, only a sandbox session credential in the browser, honest unavailable states, exact version labels. Wrote [WORKBENCH_HOST_CONTRACT.md](./WORKBENCH_HOST_CONTRACT.md) to meet them.
- Wrote the [API draft](./V1_1_API.md), [implementation plan](./IMPLEMENTATION_PLAN.md) and [evidence matrix](./EVIDENCE.md).

### October 3, 2026 — slice A (contracts)

- Added `packages/contracts/src/failures.ts`: `failureHandling` types, `validateFailureHandling` (wired into `validateProjectConfig`), `resolveSourcePolicy`, `policyFor`, `FailureClass`, `TransientMappingError`, and the recovery-guard types. `types.ts` gained `ProjectConfig.failureHandling`, `HandlerRegistry.sources`, and the snapshot `recovery`/`recoveryBoundaryId` fields.
- Refactored `#process`/`#buildOutput` so every pause carries a trusted `FailureClass`; public error codes, traces and pause behavior are unchanged. The operator log line gains `failureClass`.
- Added construction checks (`packages/gateway/src/failures/validate.ts`). Deviation from the draft, recorded in API §2: until slices B and C land, construction refuses non-pause policies and transient retries rather than accepting them, so no configuration is silently run as pause.
- Dropped one planned test case: a mapped output can't exceed `maxDataFrameBytes` in the test harness because that limit has a 1,024-byte floor and the harness schema bounds every field. The classification of that path is covered by code review only.
- `pnpm build && pnpm verify` on Node 24.21.0: 146 tests, 146 pass, 0 fail (114 before; 32 new across `packages/contracts/test/failures.test.ts`, `tests/integration/failure-classes.test.ts`, `tests/integration/failure-config.test.ts`). `contracts/v1/type-tests.ts` compiles with the new `@ts-expect-error` cases all firing.

### October 3, 2026 — journal

- Added `packages/gateway/src/failures/journal.ts` (branch `feat/v1.1-journal`): `SqliteIncidentStore` on `node:sqlite` with WAL, `synchronous=FULL`, `foreign_keys=ON`, `locking_mode=EXCLUSIVE`, STRICT tables (`meta`, `sources`, `incidents`, `incident_events`, `evidence`), `application_id` "SOJ1", and forward-only migrations keyed by `meta.schema_version` (v1). Every mutation is one `BEGIN IMMEDIATE` transaction. Evidence headers are stored as a length-prefixed binary list, so order, duplicate names and non-UTF-8 values survive. Writes past the 256 MiB journal or 16 MiB spool budget throw `OVERLOADED` (`journal-full`); nothing is evicted, and `max_page_count` backs the admission check. `initJournal` creates the state directory, `run/` (0700) and the journal (0600, `wx`, never overwritten). `openJournal` refuses, with a `details.reason`, Node below 24.15, a missing directory or journal (it never creates one), a symlinked, group/world-writable or foreign-owned directory or file, a non-journal or corrupt file, and a newer schema; it takes `journal.lock` (`wx`, pid/project/start/hostname) and replaces only a dead owner's lock on the same host. `claim()` enforces project identity and pins a source's generation while it has open incidents. `node:sqlite` is loaded lazily, so importing `@streamotter/gateway/internals` on Node 24.0–24.14 prints no warning (checked on 24.14.0: `openJournal` refuses with `node-version`).
- `MemoryIncidentStore` gained an injectable `spoolLimitBytes`, and replacing a failure's evidence no longer counts the old copy against the spool. The `IncidentStore` interface is unchanged.
- One difference from the memory store, by design: the journal refuses `observe` for a source never passed to `claim()` (`source-not-claimed`), because incidents reference `sources`.
- `node --conditions=streamotter-source --test packages/gateway/test/journal.test.ts` on Node 24.21.0 and 26.10.0: 23 tests, 23 pass, 0 fail. On 24.14.0 the SQLite suites skip and the other 7 pass. `pnpm build && pnpm verify` on Node 24.21.0: 169 tests, 169 pass, 0 fail.
- Not testable yet: an older-schema journal migrating forward (v1 is the only version).

### October 3, 2026 — slice B (containment and quarantine-hold)

- Merged `feat/v1.1-journal` into `feat/v1.1-quarantine-hold`. A parallel helper built it against the `IncidentStore` interface; see the journal entry above.
- **Adapters:** both report a held record through `SourceSink.held()` after pausing. Kafka defers the call with `setImmediate`, so disposition never runs inside `eachBatch` (ADR-15A §1). They pass the key bytes, ordered headers and broker timestamp for evidence, and both implement `advancePast()`, which slice C will drive. The Kafka version commits offset + 1, reads it back through the admin client, checks the assignment epoch, and only then seeks and resumes. Any doubt returns `uncertain`.
- **`FailureService`** (`packages/gateway/src/failures/service.ts`) handles every held record, one at a time per source:
  - it observes the incident under `f1:` + `sourceRecordId`;
  - pause-class failures are recorded and held;
  - eligible classes under `quarantine-hold` are captured and written: Kafka through `KafkaQuarantineWriter`, a fixture into local store evidence;
  - the result is recorded as `quarantined`, `quarantine-unknown` or `failed`;
  - nothing is committed.
- **Writer settings:** idempotent, `acks=-1`, one request in flight, no topic creation, a 10-second deadline and two retries. Only a definite broker refusal counts as `failed`; anything else uncertain is `unknown`.
- **Restart and moved positions:**
  - A record redelivered with different bytes is an evidence conflict and stays held.
  - A held record that later processes resolves its incident as `processed`.
  - A Kafka record at a later offset on a held partition holds the source with `SOURCE_UNAVAILABLE` instead of being processed (F27, F30). This uses a new internal `hold` outcome that opens no incident.
- **Gateway wiring:** the journal opens at start; development without `stateDirectory` uses the memory store and logs that it is not durable. Kafka sources with a quarantine policy check the quarantine topic and its `max.message.bytes` at start. `resumeSource` goes through `beforeRetry`. Transient retries re-run the whole mapping after 250 ms, then 1 s, sending a Kafka heartbeat between attempts.
- **Construction checks:** `stateDirectory` is required in production when a quarantine policy is set. `handlerBuildId` is at most 128 characters. Quarantining sources must use one connection profile. The Node 24.15 floor applies when a journal is used. `FAILURE_CAPABILITIES` now includes `quarantine-hold` and transient retries.
- **CLI and fixtures:** new `streamotter init --failures --config --state-dir`; `dev` and `start` accept `--state-dir`, and `start` also accepts `--handler-build-id`. Fixture records may be `{ key, raw }`. `.gitignore` excludes `journal.sqlite*` and `journal.lock` (spec §12).
- **Deviations from the API draft:**
  - The internal `progress` vocabulary is `retrying`/`processed` rather than `retried` (noted in API §5).
  - The single-connection rule for quarantine writes is new (API §4 note).
  - A quarantine write that ended `unknown` is retried only when the record is redelivered (operator retry or restart), never in the background.
- **Not done in this slice:**
  - F09 has no V1.1-specific test; the existing V1 outage tests still pass.
  - F15 has no gateway crash-tier test; graceful restarts and the journal's SIGKILL test cover it.
  - Recreating a topic is not detected (F29, partial).
  - Journal-health readiness reporting is slice E.
- **Verification on Node 24.21.0:**
  - `pnpm build && pnpm verify`: 194 tests, 194 pass, 0 fail. New since slice A:
    - `tests/integration/quarantine-hold.test.ts` (13);
    - `tests/integration/failure-journal.test.ts` (4);
    - `packages/gateway/test/failure-service.test.ts` (6);
    - `packages/gateway/test/journal.test.ts` (23);
    - two cases in `failure-config.test.ts`.
  - `pnpm kafka:start && pnpm test:kafka`: 26 tests, 26 pass. That includes all 6 cases in `tests/kafka/08-quarantine-hold.test.ts`: byte-exact quarantine of a binary key, invalid UTF-8 and repeated headers; a tombstone hold; the same incident after a restart; a moved group offset; refusing a missing or undersized topic; and a 35-second hold with the same group member.
  - The first fixture run had 3 failing tests, all from wrong expectations in the tests: the fixture adapter retries the held record as soon as it resumes, so a following `advance()` is refused while that record still fails. Corrected.

### October 3, 2026 — recovery storage

- Implemented the slice C recovery state of `IncidentStore` (interface in `5e9dcf1`) in both stores (branch `feat/v1.1-recovery-store`): `boundary`, `getBoundary`, `prepareAdvance`, `retireBoundary`, `circuit`, `updateCircuit`, and the incident fields `guard` and `boundaryId` (null on a new incident, patchable through `update`). The checks and record-building are shared helpers in `store.ts`, so the memory store and the journal refuse and write identically.
- **Journal:** schema version 1 was amended in place (it has not shipped): new STRICT tables `boundaries` (context as canonical JSON text, `failure_ids` as an ordered JSON array, retirement as three columns, a partial unique index allowing one `in-force` boundary per source, `supersedes` referencing the boundary it replaced) and `circuits` (one row per source, `advances` as a JSON array). `guard` and `boundaryId` live in the incident's record JSON. `prepareAdvance` is one `BEGIN IMMEDIATE` transaction: supersede the prior, insert the new boundary, rewrite the incident, add its `advance-pending` event (detail: the boundary ID) and append to the circuit (at most 20 entries, oldest dropped). The new boundary row is admitted against the journal limit like a new incident; retirement and circuit updates rewrite rows and are not pre-admitted, like `update`.
- **`claim()`** now retires, with mode `generation`, the in-force boundary of a source whose generation changed with nothing open. A refused claim retires nothing. The memory store still never refuses a claim (the gateway's own startup check reports open incidents of another generation); within one run it retires a changed source's boundary when that source has nothing open, and remembers the claimed generations.
- **Refusals** (nothing written): unknown incident or boundary (404); stale incident, boundary or circuit revision and a wrong `expectedPrior` (`StaleRevisionError`, 409 `stale-revision`; the error now takes an optional message so these name what was stale); `incident-resolved`, `boundary-exists`, `generation-changed`, `incident-held`, `boundary-not-in-force` (409); `context-not-json`, `context-too-large` (16 KiB canonical), `guard-text-too-long` (512 characters), `retirement-mode`, `circuit-state` (400). The journal refuses a circuit for a source never claimed (`source-not-claimed`), as it already does for observations.
- **Interpretations of the interface comments,** now written into them:
  - `prepareAdvance` also refuses an incident whose generation is not the source's claimed generation, since its boundary would be retired on install; and a boundary ID that already exists.
  - An incident already listed in the prior boundary's `failureIds` is not added twice.
  - `retireBoundary` refuses mode `superseded` (only `prepareAdvance` supersedes) and a boundary no longer in force.
  - A superseded boundary gets `retiredAt` = the advance's `at` and retirement `{ mode: "superseded", reason: null, operationId: null }`.
  - `prepareAdvance` does not consult the circuit's state; deciding whether an open circuit blocks an advance is the caller's job.
  - `updateCircuit` caps `advances` at 20 as well.
- Journals created by earlier builds of this branch lack the new tables and fail on the first recovery call; recreate them with `streamotter init --failures`. No migration was added because version 1 is unreleased.
- **Verification:**
  - `npx tsc -p tsconfig.check.json`: clean.
  - `node --conditions=streamotter-source --test packages/gateway/test/journal.test.ts` on Node 24.21.0 and 26.10.0: 37 tests, 37 pass, 0 fail (23 before). New: six conformance cases run against both stores (advance happy path, every refusal leaving state unchanged, a supersede chain across incidents and sources, retirement, circuits, claim on a generation change), two journal-only cases (recovery state across close and reopen; a refused claim keeps the boundary), and a full-journal refusal of `prepareAdvance` added to the existing limit test.
  - `pnpm build && pnpm verify` on Node 24.21.0: 208 tests, 208 pass, 0 fail.
  - `gateway.ts` and `service.ts` were not changed.

### October 3, 2026 — slice C (guarded continuation)

- Defined the recovery storage in the `IncidentStore` interface first (`5e9dcf1`). A helper implemented it in both stores on `feat/v1.1-recovery-store` (entry above) while the service work continued; the branch was merged.
- **`FailureService.#continue`** carries out the slice C continuation order recorded in the API draft §5. For `quarantine-resync`:
  1. write fresh acknowledged evidence;
  2. check the circuit;
  3. run the guard with the prior boundary under the 10 s budget, then recheck the incident;
  4. `prepareAdvance` in one transaction;
  5. apply the boundary to the runtime;
  6. `advancePast`;
  7. record the result as advanced, back to held, or uncertain.
- **Guard answers** are validated (JSON context of at most 16 KiB, `evidenceRef` of at most 512 characters). `hold` sets recovery to `denied`; an error or timeout sets it to `held`.
- **Snapshot acknowledgment** (`subscription.ts`):
  - The boundary in force when a snapshot starts goes in as `recovery` and must be echoed. A missing, wrong or superseded acknowledgment is a retryable `SOURCE_UNAVAILABLE` attempt failure.
  - The boundary is checked again after the pre-delivery authorization.
  - An echo with no boundary in force is `INVALID_PAYLOAD`.
  - Acknowledged snapshots trigger application retirement through `GatewayCore.boundaryAcknowledged`.
- **Startup** restores the in-force boundary before adapters start. It reconciles `advance-pending` and `uncertain` incidents against the group's committed offset, read with a short-lived admin client (`readCommittedOffset`). Fixture incidents go back to `held`.
- **Test-only hooks:** `InternalGatewayOptions.advanceHooks` provides the crash points for F16 and F17 (`tests/kafka/resync-crash-child.ts`).
- **Deviations and decisions:**
  - A fresh quarantine copy is written before every advance attempt, even if an earlier one was acknowledged (spec §6 step 4); `quarantine-hold` still writes once.
  - The circuit counts prepared advances, so duplicate writes never count. A `not-held` result (a stop or rebalance before the commit) re-prepares on redelivery and counts again, which errs toward opening.
  - After `not-held`, the new cumulative boundary stays in force. It only adds obligations.
  - An advanced incident is resolved with its boundary still in force: the incident is over, but its recovery requirement is not.
- **Not done:**
  - `sources retire-boundary`, `reassess` and `reopen-circuit` (slice D);
  - the reference guard in the order-dashboard example (slice E);
  - tests for a denied ACL, an unavailable quarantine broker (F13), a rebalance during the advance (F18), and revoke races (F25).
- **Verification on Node 24.21.0:**
  - `pnpm build && pnpm verify`: 220 tests, all passed. 26 are new since slice B: 14 conformance cases and 12 in `tests/integration/guarded-continuation.test.ts`.
  - `pnpm test:kafka`: 30 tests, all passed, including the 4 in `tests/kafka/09-guarded-continuation.test.ts`. The two crash tests SIGKILL a child gateway at each side of the commit and check reconciliation on restart.
  - Every new test passed on its first run.

### October 3, 2026 — PR 2, workbench host contract (WHC-1), branch `feat/v1.1-workbench-host`

- Implemented [WHC-1](./WORKBENCH_HOST_CONTRACT.md) §§2–6 and the library-side §8 checks. Contracts: `WorkbenchHostConfig`, `WorkbenchOperation`, `WorkbenchDiscovery`, `WorkbenchHostManifest`, `WORKBENCH_OPERATIONS`, `validateWorkbenchHostConfig`, and `GET /management/v1/workbench` in `ManagementOperations`. Gateway: one router (`packages/gateway/src/management/router.ts`) shared by `startManagementServer` and the new `createManagementHandler`. Workbench: boot block, capability discovery, `session` auth, per-surface gating, environment label, sandbox banner, version-mismatch warning, `dist/workbench-host.json`, and `exports` for `./host`, `./dist/*` and `./package.json`. No failure operation is implemented; the vocabulary names them so hosts can list them later.
- Clarifications recorded in WHC-1 §9 (revision 0.2), none changing a field, path or name: `createManagementHandler` requires `X-StreamOtter-Workbench: 1` on POST (403 otherwise); `maxBodyBytes` applies to every handler route (default 64 KiB, at most 1 MiB, so a host that allows `config.*` for full configurations raises it); discovery is always answered and reports only allowlisted operations the gateway implements; only `hostContract` is required in the boot block; `connect-src` in the manifest carries literal placeholders. One native refinement: an unknown management route now answers 404 before its body is read (also in `docs/V1_API.md` §13 and the changelog).
- Commands, on Node 24.21.0 and pnpm 11.19.0:
  - `pnpm build && pnpm verify`: 130 tests, 130 pass, 0 fail (114 before, plus 7 contract tests in `packages/contracts/test/workbench.test.ts` and 9 in `tests/integration/workbench-host.test.ts`). The existing `tests/integration/management.test.ts` passes unchanged (9/9).
  - `pnpm test:browser`: 26 tests, 26 pass (order-dashboard 6, `workbench.test.ts` 7 unchanged, `workbench-host.test.ts` 13).
  - `pnpm test:install`: 21 tests, 20 pass, 1 skipped (TLS Kafka: no local broker).
- Failed or adjusted runs: `pnpm browsers:setup` failed (`Download failure, code=1`; the browser download host is not reachable from this environment). The browser tests ran against the preinstalled headless Chromium 141 (`/opt/pw-browsers/chromium_headless_shell-1194`), linked into the gitignored `.local/ms-playwright/chromium_headless_shell-1243/` where Playwright 1.63 looks, with `PLAYWRIGHT_BROWSERS_PATH` pointing there; Playwright 1.63 pins Chromium 153, so CI's pinned browser has not run these tests yet. The first run of the new browser file failed one case because Chromium logs the deliberate discovery 404 of the pre-WHC-1 fallback case as a console error; the test now expects exactly that message. One integration case asserted a path with `..`, which `fetch` normalizes before it reaches the host; it was replaced by another static path.
- Not done here: Lontra Creek hosting checks (LC11) are theirs; the Failures tab and failure operations are PR 6; `docs/IMPLEMENTATION_STATUS.md` is left for PR 7 per the plan.

### October 3, 2026 — slice D (operator workflow), branch `feat/v1.1-operator`

- **Shape.** The contracts came first (`e80816b`: `packages/contracts/src/operator.ts`, the IPC framing and the `IncidentStore` operation interface). Three helpers then worked in parallel on branches cut from that commit, each limited to its own files, while the operator service was written here; every branch was reviewed and merged. PR #14 (the workbench seam) is merged into this branch, so the slice PR also carries it.
  - `feat/v1.1-operation-store` (`377c4f6`): operations in both incident stores. The journal gains a STRICT `operations` table (schema version 1 amended in place, since no journal has shipped), each mutation one `BEGIN IMMEDIATE` transaction, and a `maxOperations` open option. Completed operations are pruned oldest first; when every stored operation is pending, a new one is refused as `journal-full`.
  - `feat/v1.1-operator-ipc` (`768d75f`, `394485d`): the local socket server and client (`packages/gateway/src/operator/ipc.ts`) and the CLI groups `status`, `failures` and `sources` (`packages/cli/src/operator.ts`).
  - `feat/v1.1-failures-view` (`c04ed75`, `7d01411`): the nine development management routes and the workbench Failures tab.
- **Operator service** (`6a0237c`, `b422320`; `packages/gateway/src/operator/service.ts`) as recorded in the API draft §6 slice D notes: every mutation journals intent then result; retry and reassess redeliver the held record and wait up to 15 s for it to settle; evaluate runs the live preparation path without admitting or tracing; plans are in memory (64, five minutes, single use); redrive re-evaluates under the source's processing lock and admits through the revision filter. To share one path with live processing, `GatewayRuntime.#process` was split into `#prepare` and `#admit`, and the sink now runs under a per-source exclusive lock.
- **Gateway wiring** (`e235d6c`, `0a5aa96`): `operatorSocket` is validated at construction (boolean; `true` needs `stateDirectory` and `failureHandling`). The socket starts once sources are ready and closes first on stop and on a failed start.
- **Deviations and decisions:**
  - The circuit also refuses retries. ADR-15C §6 says an open circuit stops automatic continuation; a manual retry on a `quarantine-resync` source would run the same continuation, so `retryCurrent`, `reassess` and the legacy `resumeSource` are refused with `circuit-open` until `reopenCircuit`.
  - A redrive revision conflict ends `failed` with outcome `revision-conflict` and does not pause the source, because the conflicting record came from the operator, not the stream.
  - An unreachable gateway is `UNSUPPORTED_CAPABILITY` with `details.reason: "operator-not-running"`, the code `getGatewayOperator` already uses; the CLI exits 1.
  - The socket and CLI are stricter than the draft: unknown top-level request fields, a non-object `args` and a request without a newline are refused, and each CLI subcommand accepts only its own flags.
  - Reaching the operation-count limit reports the same reason as a full journal (`journal-full`); only the message tells them apart.
  - Without failure handling the failure routes answer 404 and discovery omits them, so discovery is now computed per request.
- **Not done here:**
  - Kafka read-back of quarantined evidence (`KafkaQuarantineReader`), so evaluate and redrive work at the fixture tier only until it merges, with F28 and the topic-scan part of F41.
  - WHC-1 revision 0.3 (cross-origin `apiOrigin` and scoped host styles for Lontra Creek) goes to PR #14 and is merged here when done.
  - A child-process crash test for F35; the health listener (F37's health part) is slice E.
- **Verification on Node 24.21.0** at `0a5aa96`:
  - `pnpm build && pnpm verify`: 303 tests, all pass. New in this slice: 12 in `tests/integration/operator.test.ts`, 2 in `tests/integration/operator-socket.test.ts`, 13 in `tests/integration/operator-routes.test.ts`, 12 in `tests/integration/operator-cli.test.ts`, 17 in `packages/gateway/test/operator-ipc.test.ts`, 7 operation cases in `packages/gateway/test/journal.test.ts`, plus the PR #14 tests.
  - `pnpm test:browser`: 40 tests, all pass, including 14 in `tests/browser/failures.test.ts`. As before, against the preinstalled headless Chromium 141 linked under the gitignored `.local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/` (link each file of `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/`, and create `INSTALLATION_COMPLETE`), with `PLAYWRIGHT_BROWSERS_PATH` pointing at `.local/ms-playwright`.
- **Failed or adjusted runs:**
  - The first operator test run failed four ways, all in the tests: a client resynchronizes to the authoritative snapshot after a hold, so it never sees the intermediate revision; `advanceFixture(2)` stops at a pause; status was read before the failure service settled; trace counts included subscription traces. Each test now waits for the right condition.
  - The first socket end-to-end run expected the wrong wording for a stopped gateway; the gateway behaved as designed.
  - The browser tier failed to launch until the Chromium link above was rebuilt with the headless-shell directory layout Playwright 1.63 expects.

## 3. Handoff checklist for each slice

When a slice PR is opened, its author updates, in the same PR:

1. §1 of this file (current state, next step, open decisions).
2. A dated §2 entry: what merged, commands run with results, failed runs and why, deviations from the API draft and the reason.
3. [EVIDENCE.md](./EVIDENCE.md) rows the slice implemented or verified.
4. The API draft section the slice made normative, marked as such, with any change from the draft called out.
5. `CHANGELOG.md` under Unreleased, and `docs/V1_API.md` §13 for refinements to V1 behavior.
