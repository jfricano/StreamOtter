# StreamOtter V1.1 — Implementation log and handoff

This is the working record for the V1.1 build: what was decided, what ran, what failed, and where to pick up. Newest entries go at the bottom of §2. Anyone resuming the work, person or agent, starts with §1.

## 1. Resume here

**Current state (October 3, 2026):** planning PR #12 open; slice A (PR 3, `feat/v1.1-contracts`) open; the workbench seam (PR 2) in progress.

**Next step:** slice B (quarantine-hold) on `feat/v1.1-quarantine-hold`, stacked on slice A; finish PR 2.

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

## 3. Handoff checklist for each slice

When a slice PR is opened, its author updates, in the same PR:

1. §1 of this file (current state, next step, open decisions).
2. A dated §2 entry: what merged, commands run with results, failed runs and why, deviations from the API draft and the reason.
3. [EVIDENCE.md](./EVIDENCE.md) rows the slice implemented or verified.
4. The API draft section the slice made normative, marked as such, with any change from the draft called out.
5. `CHANGELOG.md` under Unreleased, and `docs/V1_API.md` §13 for refinements to V1 behavior.
