# StreamOtter V1.2.1: plan, implementation log and handoff

V1.2.1 fixes the minor findings deferred from the V1.2 quality review (issues #21 to #53) and the V1.1 review's deferred J7 (#54). Anyone resuming starts with §1. Newest entries go at the bottom of §3.

## 1. Resume here

**Current state (October 4, 2026):** in progress on `feat/v1.2.1-minor-fixes`, stacked on `feat/v1.2-quality-fixes` (PR #20). One PR targets that branch; each fixed issue is referenced with "Fixes #N". Nothing merges to `main` without the owner. Whether V1.2.1 joins the 0.2.0-rc.1 release is the owner's call; release-level docs (CHANGELOG, release notes, acceptance packet, roadmap) stay owned by the V1.2 PR and changes to them are sent there, not edited here.

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
