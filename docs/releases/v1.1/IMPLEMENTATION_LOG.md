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

## 3. Handoff checklist for each slice

When a slice PR is opened, its author updates, in the same PR:

1. §1 of this file (current state, next step, open decisions).
2. A dated §2 entry: what merged, commands run with results, failed runs and why, deviations from the API draft and the reason.
3. [EVIDENCE.md](./EVIDENCE.md) rows the slice implemented or verified.
4. The API draft section the slice made normative, marked as such, with any change from the draft called out.
5. `CHANGELOG.md` under Unreleased, and `docs/V1_API.md` §13 for refinements to V1 behavior.
