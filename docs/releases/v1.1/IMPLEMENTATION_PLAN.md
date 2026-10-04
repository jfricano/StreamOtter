# StreamOtter V1.1 — Implementation plan and work breakdown

**Status:** Working plan, revision 0.1, October 3, 2026. Updated as slices land; [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md) records what actually happened.\
**Baseline:** `main` at `b0109ba` (PR #11). `pnpm verify` passes on Node 24.21.0 with 114 tests.\
**Governed by:** the [spec](./V1_1_SOURCE_FAILURE_SPEC.md), [ADR-15A/B/C](./adr/), the [acceptance plan](./V1_1_ACCEPTANCE_PLAN.md) and the [handoff](./V1_1_IMPLEMENTATION_HANDOFF.md). The [API draft](./V1_1_API.md) and the [workbench host contract](./WORKBENCH_HOST_CONTRACT.md) are the interface documents the slices build against.

## 1. What gets built, in order

| PR | Branch | Slice | Contents | Depends on |
| --- | --- | --- | --- | --- |
| 1 | `docs/v1.1-implementation-plan` | Plan | This plan, the API draft, the workbench host contract, the evidence matrix, the log | none |
| 2 | `feat/v1.1-workbench-host` | D (seam, early) | WHC-1: boot block, capability discovery, `session` auth, `createManagementHandler`, `workbench-host.json`, packaging exports | PR 1 |
| 3 | `feat/v1.1-contracts` | A | `failureHandling` types and validator, `FailureClass` refactor of `#process`/`#buildOutput`, `TransientMappingError`, recovery handler and snapshot types, construction checks, type tests | PR 1 |
| 4 | `feat/v1.1-quarantine-hold` | B | Raw adapter capture, `Journal` (D1 engine) and memory store, incident service, quarantine producer and startup topic checks, `advancePast`, transient retry, `resumeSource` routing, `init --failures`, long-pause heartbeat test | PR 3 |
| 5 | `feat/v1.1-guarded-continuation` | C | Recovery guard, cumulative barrier, snapshot acknowledgment, boundary retirement modes, circuit breaker, restart restore and reconciliation | PR 4 |
| 6 | `feat/v1.1-operator` | D | `OperatorService`, local IPC, CLI groups, dev routes, Failures view, evaluate and redrive, reproduction bundles | PR 5, PR 2 |
| 7 | `feat/v1.1-operations-release` | E | Health listener, runbook, deployment and guide updates, reference guard in the order-dashboard example, Kafka/browser/install/deploy evidence, migration notes, acceptance packet | PR 6 |

The health listener has no dependency on the journal (ADR-15C §4) and may move into PR 3 if PR 7 is late; it would then ship alone as an additive option.

PR 2 is deliberately early. Lontra Creek's `/workbench/` sandbox waits on it, and it touches only the workbench app and the management module, so it can merge and even publish before the failure slices (spec §10).

## 2. Branching and review conventions

- Short-lived feature branches off `main`. Each slice PR targets `main` when its predecessor has merged; until then it is opened against the predecessor's branch (a stacked PR) and retargeted to `main` after the merge. Nothing is pushed to `main` directly.
- One slice per PR, reviewable on its own: code, tests, docs and changelog together. A slice that grows past review size splits along the file ownership in §4, never by leaving tests for later.
- Conventional commit subjects (`feat(gateway): …`, `docs(v1.1): …`, `test(kafka): …`). Commits are authored and committed as Jason Fricano, unsigned for now, with no tool attribution trailers.
- jason merges every PR. CI (`Verify (Node 24)`, `Verify (Node 26)`) must be green before a PR is called ready.
- Publishing to npm, tagging, and deployment wait for jason's explicit go. Nothing in this plan publishes.

## 3. Work breakdown

### PR 3 — Slice A: contracts (no behavior change)

1. `packages/contracts/src/types.ts`: §2–§5 types from the API draft. `failure.ts`: `TransientMappingError`.
2. `packages/contracts/src/config.ts`: `failureHandling` validation and its issue codes; config tests for every F02 row.
3. `packages/gateway/src/runtime/gateway.ts`: `pause()` and `#buildOutput` return a `FailureClass` (ADR-15B §1). Pure refactor; existing tests must pass untouched.
4. Construction checks in `validateHandlers` and a new `validateFailureHandling` (API draft §4).
5. `contracts/v1/type-tests.ts` and `api.ts`: positive and negative compile-time cases.
6. Docs: V1_API.md §13 refinement entry, CHANGELOG "Unreleased".

Exit: `pnpm verify` green; F02 configuration rows covered; no runtime path changes behavior.

### PR 4 — Slice B: containment and quarantine-hold

1. Adapter capture (ADR-15A §6): `SourceInput` gains `keyBytes`, `headers`, `timestamp`. Kafka adapter passes them; fixture adapter synthesizes UTF-8 bytes and marks evidence `local`.
2. `Journal` interface with `SqliteJournal` (engine per D1) and `MemoryIncidentStore`: schema v1, migrations, exclusive lock file, project and generation identity rows, size accounting against the 256 MiB and 16 MiB budgets.
3. `FailureService` per gateway: owns incidents, runs disposition after the adapter has paused (ADR-15A §1), one in-flight quarantine write per source, lifecycle events.
4. `QuarantineWriter`: one KafkaJS producer with the ADR-15A §5 settings; startup reads `clusterId`, `max.message.bytes`, `min.insync.replicas` and replication; refuses when the topic can't hold `maxSourceRecordBytes + 80 KiB`.
5. `advancePast` on the Kafka adapter (commit, read back, seek, resume; `uncertain` on mismatch) and on the fixture adapter.
6. Transient mapper retry inside `#process` with heartbeats; no later record overtakes it.
7. `resumeSource` routes through retry-current when failure handling is enabled (ADR-15C §6).
8. CLI `init --failures`.
9. Tests: F01, F03–F12, F14, F15 (fixture and real Kafka), F27, F29, F30, and the long-pause heartbeat check from ADR-15A §1.

Exit: quarantine-hold works end to end against the local broker; legacy tests untouched.

### PR 5 — Slice C: guarded continuation

1. Guard invocation with the 10-second budget, one per source, results journaled.
2. Barrier persistence before `advance-pending`; `advancePast`; `advance-confirmed`.
3. Snapshot acknowledgment in `ServerSubscription.#beginAttempt`; every channel of the source, current and future subscriptions.
4. Retirement modes: `generation`, `application` (`retire` after acknowledged snapshots), `operator` (journal operation only).
5. Circuit breaker persisted per source.
6. Restart: restore incidents, boundaries and circuit state before any source is ready; reconcile group offsets against `advance-pending`.
7. Tests: F13, F16–F18, F20–F26, F42, plus the deliberately wrong guard from acceptance plan §1.

### PR 6 — Slice D: operator workflow

1. `OperatorService` (API draft §6) shared by every caller.
2. Local IPC server and client (§7), permissions and token checks.
3. CLI `status`, `failures …`, `sources …` with exit codes 0–4.
4. Development management routes (§9), sharing the router built in PR 2.
5. Workbench Failures tab, gated by WHC-1 capabilities.
6. Evaluate and redrive (ADR-15C §5), plan fingerprints and expiry, idempotent operation IDs, `unknown` after a crash.
7. Reproduction bundles and raw export.
8. Tests: F19, F28, F31–F41, F44.

### PR 7 — Slice E: operations and release

1. Health listener (§8) and `start --health`.
2. Order-dashboard reference guard backed by an independent watermark (ADR-15B §5).
3. Docs: DEPLOYMENT.md, guides/kafka.md, troubleshooting, a V1.1 runbook (credentials and ACLs, quarantine outage, full disk, topic retention, poison repair, stale plans, crash restart, lost local state), migration and downgrade notes (spec §14), IMPLEMENTATION_STATUS.md, README and package READMEs.
4. Evidence: F43, F45, F46, F47 (replicated-broker case, labeled if unavailable), F48; fill [EVIDENCE.md](./EVIDENCE.md).
5. Acceptance packet (handoff §7) for jason's release review.

## 4. Team and file ownership

The lead (this thread) owns the shared state machine and contracts: `runtime/gateway.ts`, `runtime/subscription.ts`, `contracts/src/types.ts`, `contracts/src/config.ts`. Helpers work in parallel only on disjoint files, each in its own git worktree, each producing a branch the lead reviews and integrates:

| Work | Files | Parallel with |
| --- | --- | --- |
| WHC-1 seam (PR 2) | `apps/workbench/**`, `packages/gateway/src/management/**`, `tests/browser/workbench*.ts` | Slice A |
| Journal and stores (PR 4) | new `packages/gateway/src/failures/journal*.ts` | Adapter capture |
| Adapter capture and `advancePast` (PR 4) | `packages/gateway/src/sources/**`, `tests/kafka/**` | Journal |
| IPC and CLI (PR 6) | new `packages/gateway/src/operator/ipc*.ts`, `packages/cli/src/**` | Failures tab |
| Failures tab (PR 6) | `apps/workbench/src/views/failures.ts` | IPC and CLI |
| Docs and runbook (PR 7) | `docs/**` except `docs/releases/v1.1/*` | Evidence runs |

Every helper brief carries: the conventions in §2, the attribution rule (commits as Jason Fricano, no tool trailers or links), the exact files it may touch, the tests it must add and run, and an instruction not to push or open PRs. The lead pushes and opens every PR.

## 5. Verification per PR

Each PR description lists the tiers that ran and their results. Minimum before pushing:

```bash
pnpm build && pnpm verify          # typecheck, contracts, unit and integration
pnpm test:kafka                    # PR 4 onward, against the local broker
pnpm test:browser                  # PR 2, PR 6
pnpm test:install                  # PR 2, PR 7
```

Fault tests use an independent expected-results ledger (acceptance plan §1): expected incidents, offsets and boundaries come from the test's own model of the records it produced, never from the mapper or the guard under test. Failed runs are kept in the log, not deleted.

## 6. Coordination with Lontra Creek

- The Lontra Creek V1.1 thread builds against [WORKBENCH_HOST_CONTRACT.md](./WORKBENCH_HOST_CONTRACT.md). This thread tells it when the contract is defined (PR 1), when it lands (PR 2 merged), and when each Failures operation it needs becomes available (PR 6).
- Every StreamOtter API change goes through this thread. Lontra Creek consumes exact published packages only; nothing here waits on its hosted acceptance.

## 7. Risks and how they are handled

| Risk | Handling |
| --- | --- |
| KafkaJS loses group membership during a long all-topics pause | First task of PR 4 is the long-pause test. If membership drops, the adapter reports `degraded` and re-establishes the hold after rejoin, which the journal makes safe |
| `commitOffsets` while paused, or read-back through the admin client, behaves differently than assumed | Same test; `advancePast` returns `uncertain` and holds rather than guessing |
| The reference guard can't be written honestly | ADR-15B consequence: ship quarantine-hold plus retry only, as an explicit owner decision |
| Journal engine (D1) changes after PR 4 | Engine sits behind the `Journal` interface; only one file changes |
| Slice scope grows | Return a narrow decision packet to jason rather than building V2 machinery (handoff §4) |
