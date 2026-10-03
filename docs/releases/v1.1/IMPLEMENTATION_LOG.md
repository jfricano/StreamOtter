# StreamOtter V1.1 — Implementation log and handoff

This is the working record for the V1.1 build: what was decided, what ran, what failed, and where to pick up. Newest entries go at the bottom of §2. Anyone resuming the work, person or agent, starts with §1.

## 1. Resume here

**Current state (October 3, 2026):** planning PR open; no code slice started.

**Next step:** PR 2 (workbench host contract) and PR 3 (slice A contracts) in parallel, per [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) §1.

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

### October 3, 2026 — PR 2, workbench host contract (WHC-1), branch `feat/v1.1-workbench-host`

- Implemented [WHC-1](./WORKBENCH_HOST_CONTRACT.md) §§2–6 and the library-side §8 checks. Contracts: `WorkbenchHostConfig`, `WorkbenchOperation`, `WorkbenchDiscovery`, `WorkbenchHostManifest`, `WORKBENCH_OPERATIONS`, `validateWorkbenchHostConfig`, and `GET /management/v1/workbench` in `ManagementOperations`. Gateway: one router (`packages/gateway/src/management/router.ts`) shared by `startManagementServer` and the new `createManagementHandler`. Workbench: boot block, capability discovery, `session` auth, per-surface gating, environment label, sandbox banner, version-mismatch warning, `dist/workbench-host.json`, and `exports` for `./host`, `./dist/*` and `./package.json`. No failure operation is implemented; the vocabulary names them so hosts can list them later.
- Clarifications recorded in WHC-1 §9 (revision 0.2), none changing a field, path or name: `createManagementHandler` requires `X-StreamOtter-Workbench: 1` on POST (403 otherwise); `maxBodyBytes` applies to every handler route (default 64 KiB, at most 1 MiB, so a host that allows `config.*` for full configurations raises it); discovery is always answered and reports only allowlisted operations the gateway implements; only `hostContract` is required in the boot block; `connect-src` in the manifest carries literal placeholders. One native refinement: an unknown management route now answers 404 before its body is read (also in `docs/V1_API.md` §13 and the changelog).
- Commands, on Node 24.21.0 and pnpm 11.19.0:
  - `pnpm build && pnpm verify`: 130 tests, 130 pass, 0 fail (114 before, plus 7 contract tests in `packages/contracts/test/workbench.test.ts` and 9 in `tests/integration/workbench-host.test.ts`). The existing `tests/integration/management.test.ts` passes unchanged (9/9).
  - `pnpm test:browser`: 26 tests, 26 pass (order-dashboard 6, `workbench.test.ts` 7 unchanged, `workbench-host.test.ts` 13).
  - `pnpm test:install`: 21 tests, 20 pass, 1 skipped (TLS Kafka: no local broker).
- Failed or adjusted runs: `pnpm browsers:setup` failed (`Download failure, code=1`; the browser download host is not reachable from this environment). The browser tests ran against the preinstalled headless Chromium 141 (`/opt/pw-browsers/chromium_headless_shell-1194`), linked into the gitignored `.local/ms-playwright/chromium_headless_shell-1243/` where Playwright 1.63 looks, with `PLAYWRIGHT_BROWSERS_PATH` pointing there; Playwright 1.63 pins Chromium 153, so CI's pinned browser has not run these tests yet. The first run of the new browser file failed one case because Chromium logs the deliberate discovery 404 of the pre-WHC-1 fallback case as a console error; the test now expects exactly that message. One integration case asserted a path with `..`, which `fetch` normalizes before it reaches the host; it was replaced by another static path.
- Not done here: Lontra Creek hosting checks (LC11) are theirs; the Failures tab and failure operations are PR 6; `docs/IMPLEMENTATION_STATUS.md` is left for PR 7 per the plan.

## 3. Handoff checklist for each slice

When a slice PR is opened, its author updates, in the same PR:

1. §1 of this file (current state, next step, open decisions).
2. A dated §2 entry: what merged, commands run with results, failed runs and why, deviations from the API draft and the reason.
3. [EVIDENCE.md](./EVIDENCE.md) rows the slice implemented or verified.
4. The API draft section the slice made normative, marked as such, with any change from the draft called out.
5. `CHANGELOG.md` under Unreleased, and `docs/V1_API.md` §13 for refinements to V1 behavior.
