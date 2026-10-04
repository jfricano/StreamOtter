# StreamOtter V1.2: implementation log and handoff

Working record for the V1.2 quality review. Anyone resuming starts with §1. Newest entries go at the bottom of §2.

## 1. Resume here

**Current state (October 4, 2026):** the review is done and fixed. Phase A found 10 major and 33 minor issues ([findings](./PHASE_A_FINDINGS.md)), phase B 5 major and 24 minor ([findings](./PHASE_B_FINDINGS.md)). All 15 majors are fixed on `feat/v1.2-quality-fixes`, each with a regression test that fails without its fix, along with the cheap minors (§3). The branch is stacked on `review/v1.1` (PR #55, all of V1.1; it replaced the closed stack ending at #19 and is the same commit as `feat/v1.1-review-fixes`). Nothing merges to `main` without the owner.

**Next step:** drive the V1.2 PR's CI to green and answer review. The deferred minors in §3 are candidates for a later release.

**Environment notes:** same as V1.1 (see `docs/releases/v1.1/IMPLEMENTATION_LOG.md` §1). Commits are authored and committed as Jason Fricano `<44284799+jfricano@users.noreply.github.com>`, unsigned, with no tool trailers.

## 2. Log

### October 4, 2026 — planning

- Found no record of an independent review of V1. Listed the V1 files V1.1 never touched (about 7,300 lines) and the V1 files V1.1 changed, against `feat/v1.1-operations-release` at `24abe81`.
- Wrote the [review plan](./REVIEW_PLAN.md): six reviewers by area, a seam pass, the V1.1 findings excluded.

### October 4, 2026 — phase A review

- The owner agreed to review the untouched V1 code now and hold fixes. Four reviewers: P (protocol and sessions), C (client SDK), G (codegen and contracts), W (workbench views, example web client, KafkaJS patch, scripts, V1 tests). Baseline `pnpm test` on Node 24.21.0: 334 pass.
- Re-ran every major reproduction; all failed as described. Results in [PHASE_A_FINDINGS.md](./PHASE_A_FINDINGS.md).
- W-2 (macOS `/proc` in `scripts/kafka/replicated-*.sh`) is V1.1 code; passed to the V1.1 thread.
- Reproduction scripts lived in the review container's git-ignored `.review-scratch/`; each fix must add its own regression test.

### October 4, 2026 — phase B review and fixes

- The V1.1 fix PR (#19) and its second review finished. Rebased onto `feat/v1.1-review-fixes` at `c6f05f1` and ran phase B with three reviewers: K (gateway core and Kafka, real broker), M (CLI and management), R (workbench, docs, release). 5 major, 24 minor, in [PHASE_B_FINDINGS.md](./PHASE_B_FINDINGS.md).
- Fixed the 15 majors, one commit per finding or tightly coupled group, each with a regression test confirmed to fail before its fix. Then fixed the cheap minors in five commits by area, with tests for the timer cap, the enum length check and prototype-named commands.
- Test results are in §4.

## 3. Minor findings: fixed and deferred

**Fixed:** P-5 (timer limits capped at 2^31−1 ms), P-7 (claims deep-frozen), the client's missing 1 s then 2 s retry backoff (with C-2), W-3 and W-6 (with C-4), W-4, W-5, W-7, W-10, G-5, G-6, G-7, G-8, K-5, M-2, M-3, M-4, M-6 (the preflight; a mid-write file-system error can still leave a partial scaffold), M-7, M-8, M-9, R-2, R-3, R-4.

**Deferred**, each judged low risk or larger than a minor fix. Each has a GitHub issue titled with its ID, as does the V1.1 review's deferred J7. All of them are fixed in [V1.2.1](../v1.2.1/README.md) (#56), which ships in the same release:

- Protocol and gateway: P-2, P-3, P-6, P-8, P-9.
- Client SDK: C-5 `resync()` during a pause shows `authorizing`; C-6 the same-tick hello-then-close stall in Node clients; C-7 a `resync-required` for the old epoch ignored mid-resync; C-8 listeners firing after one unsubscribes.
- Codegen: G-4.
- CLI and management: M-5, and the rest of M-6 (a mid-write error can still leave a partial scaffold).
- Gateway and Kafka: K-4, K-6 (mostly addressed by the K-3 heartbeat), K-7, K-8, K-9.
- Example, scripts and tests: W-8, W-9, W-11 to W-18, and W-19 (the 12 documented V1 behaviors with no test).
- Workbench, docs and release: R-5 to R-9.

## 4. Test runs

On Node 24.21.0 at the final commit:

- `pnpm verify`: typecheck, contract check and 397 tests pass.
- `test:load` 1, `test:kafka` 44 (single broker), `test:kafka:replicated` 2 (three brokers), `test:browser` 58, `test:deploy` 4 (Caddy), `test:install` 22: all pass.
- The first `test:kafka` run failed the new paused-source test: partition 1 can be processed before the poison record pauses the source. The test now checks that nothing moves after the pause, instead of expecting nothing at all.
- Node 26 was not run.

### October 4, 2026 — release docs

- V1.1, V1.2 and V1.2.1 ship together as `0.2.0-rc.1`. The CHANGELOG, acceptance packet, release checklist, roadmap, status page and package READMEs describe that one release.
- Moved `docs/v2/V2_3_EVENT_JOURNEY_VERIFICATION.md` to `docs/releases/v2.3/`, so every release plan lives under `docs/releases/`. Its links and the two inbound links were updated. User-facing docs (guides, `DEPLOYMENT.md`, `V1_API.md`) stay where they are, because the READMEs already published on npm link to those paths.
- Added the [0.2.0-rc.1 release handoff](../0.2.0-rc.1/RELEASE_HANDOFF.md) for the coordinated deployment checklist. The planned site domain is now `streamotter.dev`, so the release plan, status, site plan and the host contract's examples use it; logs keep `streamotter.app`.
