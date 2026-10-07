# V1.3 implementation log

Branch `feat/v1.3-react-hooks`, on top of the approved [plan](./README.md). Started October 6, 2026 (Pacific) at the owner's go. Nothing published. The public API is locked in the [API contract](./API.md).

## What was built

| Plan deliverable | Where | State |
| --- | --- | --- |
| API contract | [API.md](./API.md): declarations, behavior clauses P1–P5, S1–S8, C1, K1, A1–A4, traceability to tests, decisions | Done; see [API first](#api-first) |
| Provider and hooks | `packages/client/src/react.ts`, exported as `@streamotter/client/react`; `packages/streamotter/src/react.ts` re-exports it as `streamotter/react`. Every export has TypeDoc comments with examples, `@throws` and the clause IDs it implements | Done |
| Manifests | `./react` in `exports` and `publishConfig.exports` of both packages; `react >= 18` as an optional peer of both; React, React DOM, their types and happy-dom 20.9.0 as dev dependencies of `packages/client` and `tests` | Done |
| Unit tests | `packages/client/test/react.test.ts` (13 tests on a fake client, each named by the clauses it covers) | Done |
| Integration tests | `tests/integration/react.test.ts` (2 tests against the fixture gateway: a StrictMode tree, and the latest `getToken`) | Done |
| Reference example | `examples/order-dashboard/src/web/react.tsx` on the hooks | Done |
| Install test | `tests/install/install.test.ts`: React, React DOM and `@types/react` installed beside the packed packages; bundles a React page from `@streamotter/client/react` and from `streamotter/react` out of `dist`; type-checks a hooks component against the published declarations and the generated `AppChannels`, with `@ts-expect-error` checks that a wrong channel or params shape is rejected; asserts the existing non-React bundles contain no React and no `react.js`; the all-in-one package's compiled sources now include `react` | Done |
| Documentation | Client README "React hooks"; all-in-one README; existing-app guide; reference example README; V1_API §13; IMPLEMENTATION_STATUS; CHANGELOG (Unreleased) | Done |

The plan's open decisions were taken as recommended: the factory and the direct hooks are both exported; a new `getToken` keeps the client and a `key` switches users; no Suspense variant.

## API first

The code started as the planning-phase prototype. On October 6, 2026 (Pacific) the owner asked that implementation threads lock the API before building on it, so the API was written down in [API.md](./API.md) and the code and tests were brought into line with it:

- **One API change.** The `options` argument of `useSubscription` became the exported type `SubscriptionOptions<C, K>`, so applications can type wrappers. Its shape is unchanged.
- **Doc comments.** Every export now carries the TypeDoc comments the 1.0 API reference will be generated from.
- **Tests named by clause.** Every test name starts with the clause IDs it covers, and the contract's traceability table maps each clause to its tests.
- **Two gaps closed.** A2 (server rendering) and P3 (the latest `getToken`) had no test. Both are tested now. The P3 test was checked by removing the code that keeps `getToken` current, and it failed as it should.
- **Stricter existing tests.** A1 covers all three hooks. P4 checks that a supplied client is never closed. S5 checks that a client change clears the error. S6 checks that `resync` keeps its identity. P1 checks that the provider supplies `null` before its effect runs.

## Verification (Node 24.21.0, Linux, October 6, 2026 Pacific)

| Tier | Result |
| --- | --- |
| `pnpm verify` (typecheck, contracts, unit and integration) | 462 passed, 0 failed, 0 skipped, including the 15 hooks tests |
| `pnpm test:install` | 23 passed, 1 skipped (the TLS Kafka check: no local broker in this environment), 0 failed; includes the three new React checks |
| `pnpm test:browser` | 59 passed, 0 failed, including the order-dashboard React page (two live orders, one denial) on the hooks |

`pnpm verify` and `test:install` were re-run after the [API first](#api-first) pass. `test:browser` was not, because that pass changed comments, one type alias and tests, and no code that runs in the browser. `test:browser` ran on the Chromium headless shell preinstalled in the build environment (revision 1194), linked into `.local/ms-playwright` because the environment's network policy blocked Playwright's download of the pinned revision. CI's extended workflow runs the pinned revision. `test:kafka`, `test:deploy` and `test:load` do not touch the client package and were not run for this change.

## Folding V1.3 into the 1.0.0 launch

The owner may compress V1.3 into the launch if it is safe at that time. What that would take:

1. **Merge order.** This branch adds files and touches no gateway, CLI, workbench or protocol code. Its only edits to shared files are additive: two package manifests, `tests/package.json`, the lockfile, the install test, and documentation. A rebase onto whatever `main` holds at launch should be mechanical; the lockfile is the likeliest conflict, regenerated with `pnpm install`.
2. **Versions.** No version bump is in this branch. Folding in means `1.0.0` (via `1.0.0-rc.N`) carries the hooks, and the roadmap's npm table in [npm versions](../../API_AND_FEATURE_ROADMAP.md#npm-versions) goes back to its pre-V1.3 numbering (V2.0 = `1.1.0`, and so on); that is one table and a sentence in this folder's README.
3. **Launch gate.** The hooks add nothing to the V1.1 acceptance-packet checks the launch waits on. They do add one thing to verify on the launch candidate: the extended workflow's install and browser tiers on Node 24 and 26 with this branch included.
4. **Review.** The independent review of this branch should be done before folding, so the launch candidate isn't carrying unreviewed API.
5. **Documentation.** The CHANGELOG entry moves from Unreleased into the launch entry; the client README's status line and the release index change with the version.
6. **Risk.** The new public surface is `@streamotter/client/react` and `streamotter/react`. Once in `1.0.0` it is covered by the 1.x compatibility promise, so any API change found later would wait for 2.0. Shipping as `1.1.0` instead keeps the launch surface smaller and gives the hooks a release of their own to settle in.

## Open items

- Independent review before the PR leaves draft, at the owner's chosen model and effort.
- The demo, [Pup Patrol](./PUP_PATROL.md), remains planning only.
