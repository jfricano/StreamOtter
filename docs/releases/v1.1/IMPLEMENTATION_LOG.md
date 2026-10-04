# StreamOtter V1.1 — Implementation log and handoff

This is the working record for the V1.1 build: what was decided, what ran, what failed, and where to pick up. Newest entries go at the bottom of §2. Anyone resuming the work, person or agent, starts with §1.

## 1. Resume here

**Current state (October 4, 2026):** V1.1 is implemented. These PRs are open and stacked:
- planning, PR #12;
- the workbench seam, PR #14 (`feat/v1.1-workbench-host`, on #12);
- slice A, PR #13 (`feat/v1.1-contracts`, on #12);
- slice B, PR #15 (`feat/v1.1-quarantine-hold`, on #13), which includes the journal branch `feat/v1.1-journal`;
- slice C, PR #16 (`feat/v1.1-guarded-continuation`, on #15), which includes `feat/v1.1-recovery-store`;
- slice D, PR #17 (`feat/v1.1-operator`, on #16), which merges PR #14 and four helper branches;
- slice E, PR #18 (`feat/v1.1-operations-release`, on #17), which merges `feat/v1.1-docs-runbook`, `feat/v1.1-reference-guard` and `feat/v1.1-replicated-kafka`;
- the review fixes, PR #19 (`feat/v1.1-review-fixes`, on #18), which fix the [independent review](./REVIEW.md)'s findings in #13 to #18.

**Next step:** the owner reviews and merges the stack in order, ending with the review fixes, retargeting each PR to `main` as its base merges. Then CI runs the extended tiers on `main`, and the owner decides on publishing; the [acceptance packet](./ACCEPTANCE_PACKET.md) recommends `0.2.0-rc.1`. Nothing is published, tagged or deployed without the owner's go. Tell the Lontra Creek thread when PR #14 merges and when a release is published.

**Owner decisions:**

| ID | Question | Asked | Answer |
| --- | --- | --- | --- |
| D1 | Journal engine given `node:sqlite` warns on Node 24.0–24.14 ([API draft](./V1_1_API.md) §11) | October 3, 2026 | October 4: `node:sqlite`, Node 24.15 or later |
| — | Add a command to close an incident whose record can never be processed | October 3, 2026 | October 4: yes, `streamotter sources rebaseline` |

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
- **Kafka read-back** (helper branch `feat/v1.1-quarantine-reader`, `9c1da75`, `482ac62`; wired in here): `KafkaQuarantineReader.read` checks the coordinates against the partition's watermarks (below the low watermark is `expired`, at or past the high one is `mismatch`), fetches the one record with a consumer in a throwaway group `streamotter-<projectId>-quarantine-read-<uuid>` that never commits, checks the `streamotter-failure-id` header and the evidence hash, and deletes the group afterwards. Reads run one at a time under a timeout; `stop()` abandons a read in progress. The gateway constructs the reader next to the writer and stops it on shutdown; it connects only when an operator reads evidence.
  - Operators therefore need Read on the quarantine topic and Read and Delete on groups with that prefix. Without them the read is `unavailable` (or the group deletion is logged at warn).
  - Known limits from the helper: KafkaJS keeps retrying a lost initial connection for about 24 s after the read has returned `unavailable` (the next read waits at most about 2 s); a read takes at least the broker's `group.initial.rebalance.delay.ms` (3 s by default); a record deleted between the watermark check and the fetch ends as a timeout `unavailable`, not `expired`.
- **Not done here:**
  - A child-process crash test for F35; the health listener (F37's health part) is slice E.
- **Verification on Node 24.21.0** after merging WHC-1 revision 0.3 (`a01d9f6`, `cdc4808`):
  - `pnpm build && pnpm verify`: 316 tests, all pass.
  - `pnpm test:browser`: 52 tests, all pass (the 40 above plus the 12 revision 0.3 cases), on the local Chromium link described below.
  - `pnpm test:install`: 21 tests, all pass. The first run failed one case: the `streamotter` tarball now contains `dist/operator.js` for the new `streamotter/gateway/operator` subpath, which the expected file list did not include. The list was updated, and the installed-package check now imports `getGatewayOperator` through both `@streamotter/gateway/operator` and `streamotter/gateway/operator`.
- **Verification on Node 24.21.0** with the quarantine reader merged and wired:
  - `pnpm build && pnpm verify`: 314 tests, all pass (11 more in `packages/gateway/test/quarantine-reader.test.ts`).
  - `pnpm test:kafka` against the local broker: 39 tests, all pass, including 7 in `tests/kafka/10-quarantine-reader.test.ts` (byte-for-byte read-back, multiple partitions, concurrent reads, expired, mismatches, a missing topic that is never created, timeouts and stop, no leftover groups or sockets) and 2 in `tests/kafka/11-operator.test.ts` (show, evaluate and redrive against read-back evidence; F28). The helper's run from its worktree failed 9 tests only because a worktree has no `.local` certificates or broker install; from the main checkout all pass.
- **Verification on Node 24.21.0** at `0a5aa96`, before the reader:
  - `pnpm build && pnpm verify`: 303 tests, all pass. New in this slice: 12 in `tests/integration/operator.test.ts`, 2 in `tests/integration/operator-socket.test.ts`, 13 in `tests/integration/operator-routes.test.ts`, 12 in `tests/integration/operator-cli.test.ts`, 17 in `packages/gateway/test/operator-ipc.test.ts`, 7 operation cases in `packages/gateway/test/journal.test.ts`, plus the PR #14 tests.
  - `pnpm test:browser`: 40 tests, all pass, including 14 in `tests/browser/failures.test.ts`. As before, against the preinstalled headless Chromium 141 linked under the gitignored `.local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/` (link each file of `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/`, and create `INSTALLATION_COMPLETE`), with `PLAYWRIGHT_BROWSERS_PATH` pointing at `.local/ms-playwright`.
- **Failed or adjusted runs:**
  - The first operator test run failed four ways, all in the tests: a client resynchronizes to the authoritative snapshot after a hold, so it never sees the intermediate revision; `advanceFixture(2)` stops at a pause; status was read before the failure service settled; trace counts included subscription traces. Each test now waits for the right condition.
  - The first socket end-to-end run expected the wrong wording for a stopped gateway; the gateway behaved as designed.
  - The browser tier failed to launch until the Chromium link above was rebuilt with the headless-shell directory layout Playwright 1.63 expects.
### October 3, 2026 — PR 2, WHC-1 revision 0.3 (cross-origin API, scoped styles), branch `feat/v1.1-workbench-host`

- Lontra Creek's real topology needs two things WHC-1 0.2 refused or lacked: a static site on `https://streamotter.app` whose API and `HttpOnly`, `SameSite=Strict` session cookie live on `https://demo.streamotter.app`, and a `/workbench/` page that keeps the site's header and footer around the mount. [WHC-1](./WORKBENCH_HOST_CONTRACT.md) is now revision 0.3 (§2.1, §3.4, §10); `hostContract` stays `1`.
- Contracts: optional `apiOrigin` in `WorkbenchHostConfig` (an exact canonical origin; `https:`, or `http:` for `localhost`, `127.0.0.1` and `[::1]` only), allowed only with `auth.mode` `session` and refused at `/apiOrigin` otherwise; `isWorkbenchApiOrigin`; `WorkbenchHostManifest.entry.hostStyle`. The mode coupling is enforced at runtime, not in the type (§10).
- Workbench: with `apiOrigin`, requests go to `apiOrigin + apiBase` with `mode: "cors"`, `credentials: "include"`, `redirect: "error"`, `X-StreamOtter-Workbench: 1` and never `Authorization`; the client refuses any URL whose origin is not the one fixed from the boot block. Same-origin session mode is unchanged. In session mode a `401` or `UNAUTHENTICATED` answer shows "Session ended" with Reload and stops all requests (including Inspect's polling). With a boot block present the mount carries `data-streamotter-workbench`; the build generates `dist/workbench-host.css` from `styles.css` with `apps/workbench/scope-css.ts` (dependency-free; anything it cannot scope, such as `@keyframes`, fails the build), and the manifest gains `entry.hostStyle`, its integrity value and the `"<api origin>"` `connect-src` placeholder. The native page still links `styles.css`. Reading the boot block at module start was confirmed for a host script that writes the block and then imports `app.js`.
- No gateway change: hosts add CORS themselves, and `createManagementHandler` still adds no CORS headers.
- Commands, on Node 24.21.0 and pnpm 11.19.0:
  - `pnpm build && pnpm verify`: 132 tests, 132 pass, 0 fail (130 before, plus 2 contract tests for `apiOrigin` and the mode coupling).
  - `pnpm test:browser`: 38 tests, 38 pass (order-dashboard 6, `workbench.test.ts` 7, `workbench-host.test.ts` 13, new `workbench-cross-origin.test.ts` 6 and `workbench-host-styles.test.ts` 6). The existing host test now links `workbench-host.css`; the native test now also checks that the mount is unmarked and only `styles.css` is loaded.
  - `pnpm test:install`: 21 tests, 21 pass; the packed tarball contains `workbench-host.css` with a matching integrity value, and `entry.hostStyle` resolves through the package exports.
- Failed or adjusted runs: the first `pnpm test:install` failed its TLS Kafka case only because a local broker was running but this worktree had no `.local/kafka-certs/ca.pem`; with the broker's CA copied into the gitignored `.local/`, it passed. The first run of the transformer's own test failed because the nested-rule check saw a `{` inside a quoted `content` value; the check now ignores strings. Browser tests ran on the preinstalled headless Chromium 141 as in the entry above. Both new browser files were checked against deliberate breakage (linking the unscoped `styles.css`; sending `credentials: "same-origin"` and following redirects) and failed as expected.
- Not done here: `EVIDENCE.md` still cites the revision 0.2 counts.

### October 3–4, 2026 — slice E (operations and release), branch `feat/v1.1-operations-release`

- **Shape.** Slice E is stacked on `feat/v1.1-operator` (#17). The health listener, the downgrade refusal, the crash tests and the rebaseline command were written here. Three helpers worked in parallel in their own worktrees, each limited to its own files, and each branch was merged as a merge commit:
  - `feat/v1.1-docs-runbook`: the operator runbook [docs/guides/source-failures.md](../../guides/source-failures.md); failure handling in the deployment, Kafka and troubleshooting guides and the package READMEs; and the V1.1 section of implementation status. It left five `<!-- lead: -->` questions, all resolved before this entry.
  - `feat/v1.1-reference-guard`: the order-dashboard example's outbox and watermark (`domain.ts` `OrderStore`, `decideRecovery`, `acknowledgeRecovery`), the `quarantine-resync` configuration `streamotter.kafka-resync.json` with `pnpm dev:kafka-resync`, `tests/integration/reference-guard.test.ts` (5) and `tests/kafka/12-reference-guard.test.ts` (1).
  - `feat/v1.1-replicated-kafka`: a local three-broker KRaft cluster (`scripts/kafka/replicated-{start,stop}.sh`) and `pnpm test:kafka:replicated` (F47). The helper's settings, observations and runs are in EVIDENCE F47 and below.
- **Health listener** (`6134aab`; API draft §8, now normative): `GatewayOptions.health` and `start --health`. Readiness reasons are evaluated in the fixed order `starting`, `source-held`, `source-unavailable`, `journal`, `quarantine`. The listener opens first in `start()`, so a probe sees `starting` during the startup deadline, and it closes first in `stop()`. A port in use fails startup with its own message (`Health port <host>:<port> is already in use`) and rolls everything back.
- **Downgrade refusal** (`4e5504a`; API draft §4 slice E note): without `failureHandling`, a `stateDirectory` journal with an open incident or a boundary in force refuses startup with `failure-handling-removed`.
- **Rebaseline** (`efcc62c`; API draft §10 slice E note; runbook §6.10). The owner chose a command over a manual-only procedure (October 4). `sources rebaseline` runs offline after a deliberate `generation` change. It closes the earlier generation's incidents with the reason and an operation ID, then calls `claim()`, which retires the old boundary. It never touches current-generation incidents and never moves a group. The generation-change refusals in `journal.ts` and `service.ts` now name the command.
- **Crash tests:** `tests/kafka/11-operator.test.ts` adds F35. It SIGKILLs a child gateway (`tests/kafka/operator-crash-child.ts`) between a redrive's recorded intent and its result. `tests/install/install.test.ts` SIGKILLs the installed `streamotter start --operator-socket` and restarts it on the same state directory.
- **Deviations and decisions:**
  - D1 is decided (owner, October 4): `node:sqlite` with a Node 24.15 floor. The code already assumed it, so nothing changed.
  - Rebaseline operations are not recorded in the operations table. No gateway runs, so no `unknown` outcome can be reported; the incident history carries the operation ID.
  - F47 uses dedicated controllers. With combined broker and controller nodes, killing two of three loses the KRaft quorum, and the ISR never shrinks.
  - F47 recovery needs an operator retry. The gateway holds after an `unknown` quarantine write rather than re-attempting it, one of the two outcomes spec §6 allows.
- **Failed or adjusted runs:**
  - The first deploy run after merging the reference guard failed 3/4. The graceful-restart test saw Chromium log `WebSocket … Unexpected response code: 502` while the gateway was down. Bisecting showed it was not the guard. On the slice D head it passed 2/2. On the health commit it failed 1/2, and that commit changes nothing when `--health` is off. The race is in the test: the SDK's full-jitter backoff (0–500 ms first) can land a reconnect attempt while no gateway listens. It became frequent while the three-broker cluster loaded the machine. The test now allows exactly that console error, on the gateway socket and only during the restart (`5ddadcd`); every other problem still fails it. Three runs after the change: 4/4 each.
  - The first rebaseline test expected `CONFIG_INVALID` at startup; the journal's generation refusal is `SOURCE_UNAVAILABLE`. The test was wrong.
  - Backticks inside template literals in the new refusal messages broke the build; the messages use double quotes instead.
  - The health port's `EADDRINUSE` first surfaced as the gateway port's message (reported by the runbook helper); it now has its own catch.
  - F47 helper runs: 6. Runs 1 and 2 each failed the ISR test on fixture problems. One was a start script misreading an empty `/proc/<pid>/cmdline` during `exec` (`3b65f57`); the other was the reader cross-check meeting `GROUP_LOAD_IN_PROGRESS` right after the brokers rejoined (`88013f2`, which retries and reports). Runs 3–6 passed 2/2.
- **Commands** at `92cf086`, on Node 24.21.0 and pnpm 11.19.0, from the main checkout, October 4:
  - `pnpm build && pnpm verify`: 334 tests, 334 pass, 0 fail.
  - `pnpm test:kafka` (local single broker, Kafka 4.1.2): 41 tests, 41 pass.
  - `pnpm test:browser`: 52 tests, 52 pass, on the preinstalled headless Chromium 141 linked as in the slice D entry.
  - `pnpm test:install`: 22 tests, 22 pass, with the TLS Kafka case run.
  - `pnpm test:deploy`: 4 tests, 4 pass.
  - `./scripts/kafka/replicated-start.sh && pnpm test:kafka:replicated`: 2 tests, 2 pass, in 139 s.
    - Leader case: the in-window write was `unknown` after 989 ms, and the new leader was visible after 8.2 s. All 7 pre-kill acknowledgments were read back byte for byte from broker 2 while broker 1 was down. 17 copies for 16 bad records, the only duplicate being the retried record.
    - ISR case: `NOT_ENOUGH_REPLICAS` at 11.2 s. The source held for 5.8 s with the committed offset and the quarantine high watermark unchanged. The full ISR was back 8.0 s after the restarts began, and the retry advanced in 2.2 s.
- **Not done here, for the owner or a later slice:**
  - `KafkaQuarantineReader` returns `unavailable` on `GROUP_LOAD_IN_PROGRESS` instead of retrying within its deadline.
  - An advance whose group coordinator is lost becomes `uncertain`; this was seen once in a helper's development run and is not tested.
  - The status fields `store.durable`, `openIncidents`, `circuit.reason` and `quarantine.topic` are not described in the API draft. (Fixed by the review fixes, S3.)
  - F45 (Firefox and WebKit) needs browsers this environment can't install.

### October 4, 2026 — independent review and fixes, branch `feat/v1.1-review-fixes`

- **Review.** Six reviewers, none of whom wrote the code, each took one area of #12–#18 and proved each finding with a scratch test: 13 major and 22 minor findings. R1, A, B, O3, O4 and J2 were reproduced a second time before fixing. The findings, the fix commit for each and its regression test are in [REVIEW.md](./REVIEW.md).
- **Fixes.** Six fixers worked in parallel in their own worktrees, each limited to its own files, on branches `fix/review-runtime`, `fix/review-journal`, `fix/review-surfaces`, `fix/review-operator`, `fix/review-workbench` and `fix/review-advance`. Each branch was merged into `feat/v1.1-review-fixes` as a merge commit. One commit per finding, each with a regression test that failed before the fix. J7 (fixture evidence never deleted) is not fixed; it is listed as a limitation.
- **Merging them:**
  - API draft §6 conflicted twice: operator against journal (the `retireBoundary` bullet) and advance against both (a new bullet on retries waiting for queued work). Both sides' additions were kept.
  - `quarantine-reader.test.ts` imports conflicted between the journal and advance fixes; both import sets were kept.
  - After the advance fixes made the failure chain's `run()` re-entrant (`AsyncLocalStorage`), the operator's O2 race test failed: its retry was started from inside `store.update`, inherited the disposition's context and ran nested instead of queuing. Real operator requests arrive on their own connection, so the test now binds the call outside the chain (`619748b`). REVIEW.md §4 records the hazard.
- **Observations, not fixed here:**
  - `tests/integration/operator.test.ts` "F33 and F35 …" failed once in a full run during the fixes (`synchronizing` where `live` was expected). It passed alone 3 times out of 3 and in every later full run. It is not understood yet.
  - The spec reporter's summary sometimes showed fewer tests (306, 303, 315 instead of the full count) with exit 0 while several fixers ran suites at the same time. The TAP reporter showed the full count in the same conditions. Four sequential runs of the merged branch all reported 366, and the final run 381.
- **Commands** at `619748b`, on Node 24.21.0 and pnpm 11.19.0, from the main checkout, October 4:
  - `pnpm build && pnpm verify`: 381 tests, 381 pass.
  - `pnpm test:kafka` (local single broker, Kafka 4.1.2): 42 tests, 42 pass. The new one is `13-advance-stop`.
  - `pnpm test:browser`: 56 tests, 56 pass, on headless Chromium 141.
  - `pnpm test:install`: 22 tests, 22 pass.
  - `pnpm test:deploy`: 4 tests, 4 pass.
  - `./scripts/kafka/replicated-start.sh && pnpm test:kafka:replicated`: 2 tests, 2 pass.
- **Second review and later fixes.** A fresh reviewer checked the fix diff and found three minor gaps (H, B with O6, D after a crash), fixed in `ab6bcb6`, `05ef737` and `483eb82`. The V1.2 review found that the replicated-Kafka scripts relied on `/proc`, which macOS lacks (`bdf1445`). Details are in [REVIEW.md](./REVIEW.md) §5 and §6.
- **Final commands** at `483eb82`, run the same way: `pnpm verify` 384/384, `test:kafka` 42/42, `test:browser` 56/56, `test:install` 22/22, `test:deploy` 4/4, `test:kafka:replicated` 2/2 (with the `ps`-based scripts).

## 3. Handoff checklist for each slice

When a slice PR is opened, its author updates, in the same PR:

1. §1 of this file (current state, next step, open decisions).
2. A dated §2 entry: what merged, commands run with results, failed runs and why, deviations from the API draft and the reason.
3. [EVIDENCE.md](./EVIDENCE.md) rows the slice implemented or verified.
4. The API draft section the slice made normative, marked as such, with any change from the draft called out.
5. `CHANGELOG.md` under Unreleased, and `docs/V1_API.md` §13 for refinements to V1 behavior.
