# StreamOtter V1.2: quality review plan

**Status:** planned October 4, 2026. The review itself waits until the V1.1 fix PR (stacked on #18) and its second review are done. Then it runs on the top of the V1.1 stack, or on `main` if the stack has merged by then.

## Why

V1 shipped without a separate code review. The only review so far, the six-reviewer pass of October 4 ([V1.1 findings](#what-is-already-covered)), looked at the V1.1 diff. About 7,300 lines of V1 code were never touched by V1.1 and have never been read by anyone but their author. Reviewing V1 alone would risk fixes that conflict with V1.1, so V1.2 reviews the whole package as integrated through V1.1.

## Scope

The whole repository at the review commit: `packages/*`, `apps/workbench`, `examples/order-dashboard`, `contracts/v1`, `tests/*`, `scripts/*`, `.github/workflows`, and the user-facing docs (`README.md`, `docs/guides/*`, `docs/V1_API.md`, `docs/releases/v1.1/V1_1_API.md`, package READMEs).

Priority goes to code no reviewer has read:

| Area | Never reviewed (V1, untouched by V1.1) | V1 code V1.1 changed |
| --- | --- | --- |
| Client SDK | `client.ts` (456), `subscription.ts` (441), `connection.ts`, `waiters.ts`, `frames.ts` | none |
| Gateway sessions and transport | `runtime/session.ts` (329), `util.ts`, `identity.ts`, `budget.ts`, `traces.ts`, `transport/socketio.ts` | `runtime/core.ts` |
| Gateway core and Kafka | `sources/kafkajs-patch.ts` | `runtime/gateway.ts` (892 V1 lines), `runtime/subscription.ts` (531), `sources/kafka.ts` (440), `sources/fixture.ts` |
| Contracts | `schema.ts` (255), `errors.ts`, `primitives.ts`, `limits.ts`, `protocol.ts` | `types.ts`, `config.ts` |
| CLI and codegen | `generate.ts` (220), `templates.ts` (166) | `cli.ts` (322), `management/index.ts` |
| Workbench | `views/define.ts`, `views/inspect.ts` | `main.ts`, `api.ts`, `views/preview.ts`, `views/connect.ts`, `views/export.ts` |
| Example | `src/web/*`, `scripts/scenarios.ts` | `src/server/*` |

V1.1-only code (`failures/`, `operator/`, `health.ts`, the Failures tab, the WHC-1 seam) is in scope only where it meets V1 code.

## What is already covered

The V1.1 pass (`streamotter-v1.1-review/v1.1-review-findings.md` in the project folder) found 13 major and 24 minor issues, and the V1.1 thread is fixing them with its own second review. V1.2 does not re-report those. Reviewers get the list and check only that a fix didn't break a V1 path next to it.

These were already checked and found sound, so they get a light touch: socket permissions and framing, CLI terminal escaping, workbench HTML injection, WHC-1 `apiOrigin` and redirect rules, a config without `failureHandling` behaving as V1, journal transactions and locking.

## Reviewers

Six reviewers, each with one area, none of whom wrote the code. Each reads the whole area, not just a diff.

1. **Wire protocol and sessions.** `contracts` (schema, protocol, primitives, limits, errors) and gateway `transport/`, `runtime/session.ts`, `identity.ts`, `budget.ts`, `util.ts`. Questions: can a client get data it isn't entitled to, exceed a limit, or make the gateway allocate without bound? Are schema checks complete and do errors leak internals?
2. **Client SDK.** `packages/client`. Reconnect and resume, ordering and gap detection, snapshot handling, waiter and listener leaks, behavior against a V1.1 gateway that pauses, quarantines or resumes a source.
3. **Gateway core and Kafka source, as integrated.** `runtime/gateway.ts`, `runtime/subscription.ts`, `runtime/core.ts`, `sources/*`, `traces.ts`. V1 commit and offset semantics where V1.1 code was spliced in: rebalance, crash, poison records, backpressure, shutdown ordering, and the V1-compatible path with no `failureHandling`.
4. **CLI, codegen and management API.** `packages/cli`, `management/`, the `streamotter` meta-package. Generated code correctness and injection through names in templates, file writes outside the project, management auth, exit codes, `--json` output.
5. **Workbench, example and docs.** The V1 workbench views and the order-dashboard example, plus whether `README.md`, the guides and the API docs match what the code does. Each guide is followed from a clean checkout.
6. **Packaging, release and tests.** `package.json` exports, `files`, `engines` (the Node 24.15 floor), the install test, release scripts, CI workflows, dependency hygiene, and the test suite itself: tests that pass without asserting anything, untested error paths, gaps against `docs/V1_API.md`.

A seventh, short pass checks the seams between reviewers' areas (client ↔ gateway protocol, CLI ↔ gateway config) once the six report.

## Rules for reviewers

- Distrust passing tests. Every major finding needs a reproduction: a scratch test, script or command, with its output.
- Severity: **major** means wrong data, lost or skipped records, a security hole, a crash or hang, or a documented behavior that doesn't hold. **Minor** is everything else worth fixing. Style alone is not a finding.
- Reviewers don't change the repo. Findings come back as file:line, what happens, how to reproduce, and a suggested fix.
- A second agent re-runs each major reproduction before it is accepted.

## Fixes and branching

- Findings go to `streamotter-v1.2-review/v1.2-review-findings.md` in the project folder, in the same shape as the V1.1 findings.
- Fixes go on `feat/v1.2-quality-fixes`, stacked on the newest V1.1 branch (the V1.1 fix branch), or on `main` if V1.1 has merged. Nothing is pushed to the V1.1 branches.
- One commit per finding, each with a regression test that fails before the fix.
- Before the PR is marked ready: `pnpm verify`, `pnpm test:load`, and the Kafka, replicated Kafka, browser, deploy and install tiers, all on Node 24.15+ and 26.
- If a fix changes public behavior or a documented API, it goes to the owner first.
- Progress and resume notes go in [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md).

## Open questions for the owner

None blocking. Two defaults taken:
- The release label stays V1.2 for the review and its fixes; npm versions are decided at release, as in V1.1.
- Minor findings are fixed when cheap and clearly right; the rest are listed in the findings file for later.
