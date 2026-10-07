# V1.3 implementation log

Branch `feat/v1.3-react-hooks`, on top of the approved [plan](./README.md). Started October 6, 2026 (Pacific) at the owner's go. Nothing published.

## What was built

| Plan deliverable | Where | State |
| --- | --- | --- |
| Provider and hooks | `packages/client/src/react.ts`, exported as `@streamotter/client/react`; `packages/streamotter/src/react.ts` re-exports it as `streamotter/react` | Done, from the prototype unchanged |
| Manifests | `./react` in `exports` and `publishConfig.exports` of both packages; `react >= 18` as an optional peer of both; React, React DOM, their types and happy-dom 20.9.0 as dev dependencies of `packages/client` and `tests` | Done |
| Unit tests | `packages/client/test/react.test.ts` (12 tests on a fake client) | Done |
| Integration test | `tests/integration/react.test.ts` (StrictMode tree against the fixture gateway) | Done |
| Reference example | `examples/order-dashboard/src/web/react.tsx` on the hooks | Done |
| Install test | `tests/install/install.test.ts`: React, React DOM and `@types/react` installed beside the packed packages; bundles a React page from `@streamotter/client/react` and from `streamotter/react` out of `dist`; type-checks a hooks component against the published declarations and the generated `AppChannels`, with `@ts-expect-error` checks that a wrong channel or params shape is rejected; asserts the existing non-React bundles contain no React and no `react.js`; the all-in-one package's compiled sources now include `react` | Done |
| Documentation | Client README "React hooks"; all-in-one README; existing-app guide; reference example README; V1_API §13; IMPLEMENTATION_STATUS; CHANGELOG (Unreleased) | Done |

The plan's open decisions were taken as recommended: the factory and the direct hooks are both exported; a new `getToken` keeps the client and a `key` switches users; no Suspense variant.

## Verification (Node 24.21.0, Linux, October 6, 2026 Pacific)

| Tier | Result |
| --- | --- |
| `pnpm verify` (typecheck, contracts, unit and integration) | 460 passed, 0 failed, 0 skipped (444 before V1.3 at 0.2.0-rc.1, plus the 13 hooks tests and three later additions on `main`) |
| `pnpm test:install` | 23 passed, 1 skipped (the TLS Kafka check: no local broker in this environment), 0 failed; includes the three new React checks |
| `pnpm test:browser` | 59 passed, 0 failed, including the order-dashboard React page (two live orders, one denial) on the hooks |

`test:browser` ran on the Chromium headless shell preinstalled in the build environment (revision 1194), linked into `.local/ms-playwright` because the environment's network policy blocked Playwright's download of the pinned revision. CI's extended workflow runs the pinned revision. `test:kafka`, `test:deploy` and `test:load` do not touch the client package and were not run for this change.

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
