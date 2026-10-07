# V1.3 implementation log

Branch `feat/v1.3-react-hooks`, on top of the approved [plan](./README.md). Started October 6, 2026 (Pacific) at the owner's go. Ships in `1.0.0` (see [Folded into 1.0.0](#folded-into-100)). Nothing published. The public API is locked in the [API contract](./API.md).

## What was built

| Plan deliverable | Where | State |
| --- | --- | --- |
| API contract | [API.md](./API.md): declarations, behavior clauses P1–P5, S1–S8, C1, K1, A1–A4, traceability to tests, decisions | Done; see [API first](#api-first) |
| Provider and hooks | `packages/client/src/react.ts`, exported as `@streamotter/client/react`; `packages/streamotter/src/react.ts` re-exports it as `streamotter/react`. Every export has TypeDoc comments with examples, `@throws` and the clause IDs it implements | Done |
| Manifests | `./react` in `exports` and `publishConfig.exports` of both packages; `react >= 18` as an optional peer of both; React, React DOM, their types and happy-dom 20.9.0 as dev dependencies of `packages/client` and `tests` | Done |
| Unit tests | `packages/client/test/react.test.ts` (22 tests on a fake client, each named by the clauses it covers) | Done |
| Integration tests | `tests/integration/react.test.ts` (2 tests against the fixture gateway: a StrictMode tree with a `resync()`, and the latest `getToken`) | Done |
| Reference example | `examples/order-dashboard/src/web/react.tsx` on the hooks | Done |
| Install test | `tests/install/install.test.ts`: React, React DOM and `@types/react` installed beside the packed packages (the versions the client develops against in the scoped-packages consumer, React 18 in the all-in-one consumer, so both supported majors are exercised); bundles a React page from `@streamotter/client/react` and from `streamotter/react` out of `dist`; type-checks a hooks component against the published declarations and the generated `AppChannels`, with `@ts-expect-error` checks that a wrong channel or params shape is rejected; asserts the existing non-React bundles contain no React and no `react.js`; the all-in-one package's compiled sources now include `react` | Done |
| Documentation | Client README "React hooks"; all-in-one README; existing-app guide; reference example README; V1_API §13; IMPLEMENTATION_STATUS; CHANGELOG (Unreleased) | Done |

The plan's open decisions were taken as recommended: the factory and the direct hooks are both exported; a new `getToken` keeps the client and a `key` switches users; no Suspense variant.

## API first

The code started as the planning-phase prototype. On October 6, 2026 (Pacific) the owner asked that implementation threads lock the API before building on it, so the API was written down in [API.md](./API.md) and the code and tests were brought into line with it:

- **One API change.** The `options` argument of `useSubscription` became the exported type `SubscriptionOptions<C, K>`, so applications can type wrappers. Its shape is unchanged.
- **Doc comments.** Every export now carries the TypeDoc comments the 1.0 API reference will be generated from.
- **Tests named by clause.** Every test name starts with the clause IDs it covers, and the contract's traceability table maps each clause to its tests.
- **Two gaps closed.** A2 (server rendering) and P3 (the latest `getToken`) had no test. Both are tested now. The P3 test was checked by removing the code that keeps `getToken` current, and it failed as it should.
- **Stricter existing tests.** A1 covers all three hooks. P4 checks that a supplied client is never closed. S5 checks that a client change clears the error. S6 checks that `resync` keeps its identity. P1 checks that the provider supplies `null` before its effect runs.

## Independent review (October 6, 2026 Pacific)

Three reviewers with no prior context, each with one lens, reviewed the branch after the [API first](#api-first) pass, per the project's convention. All three reports are in the thread; what they found and what changed:

**Behavior (fixed in `react.ts`, each with a test that fails without the fix):**

- **Crash when the provider replaced its client.** React runs every effect cleanup before every mount effect in a commit. When `options.origin` changed in the same commit as a child's first mount or identity change, the child's effect ran against the context's old client, which the provider's cleanup had just closed, and `client.subscribe` threw `CLIENT_CLOSED` from the effect, unmounting the React root. The same happened with a supplied client the app had closed. Now a closed client is skipped and the hook renders idle; the provider's next render brings the new client (clause S9, new). Found by the code reviewer.
- **One stale frame after `null`.** Switching `options` to `null` and back to the same identity rendered one frame of the unsubscribed subscription's `data`, `state` and `live: true` before the new effect reset the view. The hook removed its listeners before `unsubscribe()`, so the SDK's `closed` state never reached the view, and the identity check matched again as soon as the key returned. Now the cleanup forgets that subscription's view (S3 wording tightened). Found independently by the code reviewer and the test reviewer.
- **Validation at render.** `options` without a `getToken` function used to produce a client whose first connection failed as `UNAUTHENTICATED`, misreporting a programming error; a non-numeric `channelVersion` used to throw from the SDK inside the effect. Both now throw `INVALID_REQUEST` during render, as the SDK's own `createClient` and `subscribe` do (P1, S2).

**Tests (the test reviewer ran 27 mutations of `react.ts`; 11 survived):** the surviving mutations clustered around identity parts other than params (`channel`, `channelVersion`, value type), the idle/live gating with no subscription, intermediate renders on an identity change, the parts of S7 and S6 the fake client could not express, `path` replacement, and the server snapshot. The suite now has 22 unit tests (from 13): every identity part, every render after an identity change, `live` before `null`, a fake subscription that emits `closed` and drops its listeners as the SDK does, a rejected `unsubscribe()`, `resync` options forwarded, `path`, a connected client on the server, the StrictMode double mount asserted rather than assumed, P5, S8, S9 and the provider mode switch. The integration test also exercises `resync()` through the hook. All 11 surviving mutations, and the two bugs above, were re-run against the new suite and are caught.

**Packaging and docs:** packaging was found ready (both subpaths resolve for ESM and TypeScript from consumers outside the workspace under `node16` and `bundler`, `@streamotter/client` alone pulls in no React, the all-in-one re-export lands on one copy of the client, React 18 and 19 type packages both compile, the lockfile change is additive). Fixed from the findings: the TypeDoc examples imported `./generated/streamotter.ts` instead of the generated file's real name; the all-in-one README's import table lacked `streamotter/react`; the plan's acceptance list claimed a bundle-size measurement and a README-example run that nothing performed (now stated as what was done); the install test's `@ts-expect-error` cases lacked the wrong-version case and never exercised React 18 (now the all-in-one consumer installs React 18); a link to the old README anchor would have died on republish; a stray blank line in the CHANGELOG; the client README's sample used an undeclared `Session` type.

Not changed, recorded in the [decisions log](./API.md#decisions): `StateChange.reason` is not surfaced; `Client<any>` stays in the provider props.

## Verification (Node 24.21.0, Linux, October 6, 2026 Pacific)

After the review fixes:

| Tier | Result |
| --- | --- |
| `pnpm verify` (typecheck, contracts, unit and integration) | 471 passed, 0 failed, 0 skipped, including the 24 hooks tests |
| `pnpm test:install` | 23 passed, 1 skipped (the TLS Kafka check: no local broker in this environment), 0 failed; includes the React checks on React 19 (scoped packages) and React 18 (all-in-one) |
| `pnpm test:browser` | 59 passed, 0 failed, including the order-dashboard React page (two live orders, one denial) on the hooks |

`test:browser` ran on the Chromium headless shell preinstalled in the build environment (revision 1194), linked into `.local/ms-playwright` because the environment's network policy blocked Playwright's download of the pinned revision. CI's extended workflow runs the pinned revision. `test:kafka`, `test:deploy` and `test:load` do not touch the client package and were not run for this change.

## Folded into 1.0.0

On October 6, 2026 (Pacific), after the review, the owner decided the hooks ship in `1.0.0` rather than a later `1.1.0`. What that took, against the checklist this log had prepared:

1. **Merge order.** Unchanged: the branch adds files and makes additive edits to two manifests, `tests/package.json`, the lockfile, the install test and documentation, so it merges onto `main` ahead of the release candidate. The lockfile is the likeliest conflict, regenerated with `pnpm install`.
2. **Versions.** No version bump in this branch; the release candidate sets `1.0.0-rc.1` for all six packages as planned. The roadmap's [npm table](../../API_AND_FEATURE_ROADMAP.md#npm-versions) is back to its pre-V1.3 numbering (V2.0 = `1.1.0`, and so on), and the plan's [versioning section](./README.md#versioning-and-sequencing) records the decision.
3. **Launch gate.** One added check on the release candidate: the extended workflow's install and browser tiers on Node 24 and 26 with the hooks included.
4. **Review.** Done before folding; see [Independent review](#independent-review-october-6-2026-pacific).
5. **Documentation.** The CHANGELOG's Unreleased entry says the hooks ship in `1.0.0` and becomes part of that entry at release; the release index, plan, status document, V1 API §13 and the all-in-one README say `1.0.0` instead of "unreleased"; the root README and getting-started guide name the hooks.
6. **Stability.** From `1.0.0` the hooks API in [API.md](./API.md) is covered by the 1.x compatibility promise, recorded in its decisions log. A breaking change found later waits for `2.0.0`; additions are minors.

## Open items

- The owner's review and merge of the consolidated V1.3 pull request, ahead of the `1.0.0` release candidate.
- The demo, [Pup Patrol](./PUP_PATROL.md), remains planning only.
