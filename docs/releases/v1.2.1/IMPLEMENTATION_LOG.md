# StreamOtter V1.2.1: plan, implementation log and handoff

V1.2.1 fixes the minor findings deferred from the V1.2 quality review (issues #21 to #53) and the V1.1 review's deferred J7 (#54). Anyone resuming starts with §1. Newest entries go at the bottom of §3.

## 1. Resume here

**Current state (October 4, 2026):** all 34 issues addressed and every tier green ([FIXES.md](./FIXES.md) has each one). The review of the fixes is done and its 19 minor findings are fixed ([REVIEW.md](./REVIEW.md)). V1.2.1 ships in `0.2.0-rc.1` with V1.1 and V1.2 (owner's decision, October 4, 2026). Next: the owner merges #56 into the V1.2 branch after #20; publishing waits on the owner's go. Work is on `feat/v1.2.1-minor-fixes`, stacked on `feat/v1.2-quality-fixes` (PR #20). One PR targets that branch; each fixed issue is referenced with "Fixes #N". Nothing merges to `main` without the owner. Release-level docs (CHANGELOG, release notes, acceptance packet, roadmap) stay owned by the V1.2 PR and changes to them are sent there, not edited here.

**Environment notes:** same as V1.1 and V1.2 (see `docs/releases/v1.1/IMPLEMENTATION_LOG.md` §1). Node 24.21.0. Commits are authored and committed as Jason Fricano `<44284799+jfricano@users.noreply.github.com>`, unsigned, with no tool trailers. If #19 or #20 move, merge their branch in; never rebase them.

## 2. Plan

Work is split by area. Each fix gets a regression test where testable, confirmed to fail without the fix. An issue judged wrong or not worth fixing gets a comment saying why instead of a fix.

| Group | Issues |
| --- | --- |
| A. Protocol and gateway sessions | #21 P-2, #22 P-3, #23 P-6, #24 P-8, #25 P-9, #31 M-5 |
| B. Client SDK | #26 C-5, #27 C-6, #28 C-7, #29 C-8 |
| C. Gateway runtime and Kafka | #33 K-4, #34 K-6, #35 K-7, #36 K-8, #37 K-9, #45 W-16, #54 J7 |
| D. CLI, codegen and workbench | #30 G-4, #32 M-6, #38 W-8, #39 W-9, #53 R-9 |
| E. Scripts, CI, packaging and docs | #40 W-11, #41 W-12, #42 W-13, #47 W-18, #49 R-5, #50 R-6, #51 R-7, #52 R-8 |
| F. Test gaps | #43 W-14, #44 W-15, #46 W-17, #48 W-19 |

Every tier runs before the PR is marked ready: `verify`, `test:load`, `test:kafka`, `test:kafka:replicated`, `test:browser`, `test:deploy`, `test:install`.

## 3. Log

### October 4, 2026 — start

- Branched from `feat/v1.2-quality-fixes` at `d049294`. Baseline `pnpm verify` on Node 24.21.0: 397 pass.

### October 4, 2026 — fixes

- Six workers, one git worktree each (`fix/v1.2.1-group-a` to `-f`), each merged into `feat/v1.2.1-minor-fixes` with `--no-ff`. One import conflict in `tests/integration/cli.test.ts` (groups D and F) was resolved by keeping both imports.
- Lesson: `git stash` is shared by every worktree of a clone. One worker popped another's stash; nothing was lost, but fails-without-fix checks must copy files aside or use `git diff` and `git apply -R`, never stash.
- Outcomes are in [FIXES.md](./FIXES.md). Not fixed outright, with reasons there: K-4 (behavior kept, warning and docs added), K-6 (partly: a clearer warning), R-9 (documented, `exports` kept).
- The reviewer's itemized lists for W-17 and W-19 were never written into the repo (PHASE_A_FINDINGS.md names six of W-19's twelve behaviors). Both were rebuilt from an audit of the tests against `docs/V1_API.md`.
- Release-level wording (CHANGELOG, the J7 limitation in `docs/releases/v1.1/REVIEW.md`) was sent to the V1.2 PR's owner, not edited here.

### October 4, 2026 — review of the fixes

- At the owner's request, three reviewers who hadn't written the fixes reviewed the whole diff before the PR: 19 minor findings, no majors ([REVIEW.md](./REVIEW.md)). Three workers fixed them in their own worktrees; each fix has a test where testable.
- The V1.2 branch moved (docs only, `6fa29a9`) and was merged in.
- Also fixed a V1.1 operator test that asserted `live` too early after a redrive (flaky under load).
- The scripts' new ownership check stopped and restarted the real local broker correctly.

### October 4, 2026 — PR and GitHub CI

- Opened PR #56 against `feat/v1.2-quality-fixes`. PR CI (Verify on Node 24 and 26) passed.
- The extended workflow, dispatched by hand, failed on Node 24 and 26 in `tests/browser/workbench-cross-origin.test.ts` (a V1.1 test that had never run in GitHub's extended job): a header read for a request still in flight when the browser closed rejected unhandled. Both browser tests that read headers now ignore that rejection. The second run passed every job, including the new Node 26 matrix and the nightly replicated-Kafka job.

## 4. Test runs

On Node 24.21.0 at the merge of all six groups:

- `pnpm verify`: typecheck, contract check and 424 tests pass (397 at the start).
- `test:load` 1, `test:kafka` 48 (single broker), `test:kafka:replicated` 3 (three brokers), `test:browser` 59, `test:deploy` 5 (Caddy), `test:install` 22: all pass, none skipped.
- W-18 check: with the replicated cluster down, `test:kafka:replicated` fails (exit 1); with `STREAMOTTER_ALLOW_SKIP=1` it passes with its check skipped.
- Node 26 was not run locally; the extended workflow now runs it.

After the review fixes, on Node 24.21.0:

- `pnpm verify`: 444 tests pass.
- `test:load` 1, `test:kafka` 48, `test:kafka:replicated` 3, `test:browser` 59, `test:deploy` 5, `test:install` 22: all pass, none skipped.
