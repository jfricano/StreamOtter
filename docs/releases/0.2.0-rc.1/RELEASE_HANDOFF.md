# StreamOtter 0.2.0-rc.1 — release handoff

October 4, 2026. A short handoff for the coordinated deployment checklist. It links the detailed documents instead of repeating them. Nothing here contains credentials.

## What ships

One npm release, `0.2.0-rc.1`, carrying three internal milestones: V1.1 (source-failure handling, workbench host contract), V1.2 (independent quality review fixes) and V1.2.1 (the deferred minor fixes). The user-facing story is the `0.2.0-rc.1` entry in [CHANGELOG.md](../../../CHANGELOG.md) (dated October 4 as a prepared candidate; npm publication remains pending).

All six packages publish together at one version: `streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli` and `@streamotter/workbench`. The release-preparation branch sets all six manifests to `0.2.0-rc.1`; npm `latest` remains `0.1.0-rc.3` until verified publication ([checklist §1](../../RELEASE_CHECKLIST.md#1-prepare-the-release-commit)).

**dist-tag:** Jason approved `latest` for this release. No stable version exists, and every RC so far used `latest`, so unpinned `npm install streamotter` and the npm pages move to `0.2.0-rc.1`. Secondary `next` promotion is a separate owner action, not part of the approved publisher workflow. Two changes can refuse a configuration or request that `0.1.0-rc.3` accepted: the `limits.maxControlFrameBytes` minimum (9216), and production answering invalid subscribe parameters with `FORBIDDEN`.

## PR integration and remaining release order

The owner merged the feature code in the required order:

| Order | PR | Merged on main |
| --- | --- | --- |
| 1 | [#55](https://github.com/jfricano/StreamOtter/pull/55) | `560c7c0` — V1.1 and its review fixes |
| 2 | [#20](https://github.com/jfricano/StreamOtter/pull/20) | `70f9f05` — V1.2 review fixes and release docs |
| 3 | [#56](https://github.com/jfricano/StreamOtter/pull/56) | `2c1af737978005809ef3dc97b3b68affe8fc05ed` — V1.2.1 fixes |

Publisher [#57](https://github.com/jfricano/StreamOtter/pull/57) is reconciled against that final feature main, preserving its pinned CI and release acceptance while replacing owner-local publication with the approved workflow. The owner merged it as `86690f1bdbba55ac0d55809d63e48c51cd831a23`. The separate version/date/documentation candidate is prepared for owner review. Exact-source main CI, release acceptance, source tag, explicit workflow dispatch and publication approval still follow. Integrating code does not publish it.

## Verification

Local runs on Node 24.21.0 (Kafka 4.1.2, headless Chromium 141), all passing with nothing skipped:

| Tier | V1.1 at `483eb82` | V1.2 at #20 | V1.2.1 at #56 (final code) |
| --- | --- | --- | --- |
| `pnpm verify` | 384 | 397 | 444 |
| `test:kafka` | 42 | 44 | 48 |
| `test:kafka:replicated` | 2 | 2 | 3 |
| `test:browser` | 56 | 58 | 59 |
| `test:deploy` | 4 | 4 | 5 |
| `test:install` | 22 | 22 | 22 |
| `test:load` | — | 1 | 1 |

GitHub CI: `Verify (Node 24)` and `Verify (Node 26)` are green on every head above. The extended workflow (Kafka, install, browser, deploy) was run by hand on the V1.2.1 branch and passed on Node 24 and 26, as did the nightly replicated-Kafka job. It has not yet run on `main`.

Details: [V1.1 acceptance packet](../v1.1/ACCEPTANCE_PACKET.md) §4, [V1.2 log](../v1.2/IMPLEMENTATION_LOG.md) §4, [V1.2.1 log](../v1.2.1/IMPLEMENTATION_LOG.md), [implementation status](../../IMPLEMENTATION_STATUS.md).

## Remaining blockers

- **Owner integration/publication gates:** integrate the feature PRs and reconciled publisher #57; prepare the separate version/documentation commit; obtain exact-main CI and full release acceptance; create the approved source tag; then explicitly dispatch and approve npm publication. Saved GitHub/npm account settings are setup evidence, not proof of the first OIDC publication.
- **Not verified, and not required for an RC** (required before a final `0.2.0`, [packet §10](../v1.1/ACCEPTANCE_PACKET.md#10-recommended-release-status)): a Kafka broker with ACLs enabled, Firefox and WebKit (F45), the proxy deployment with failure handling on, and one integrator walking the [runbook](../../guides/source-failures.md) end to end.
- **No open code findings.** All review findings are fixed, including J7.

## Who publishes

Jason selects and approves the release through the [approval-gated Trusted Publishing workflow](../../PUBLISHING.md). Publisher [#57](https://github.com/jfricano/StreamOtter/pull/57) is merged and reconciled against the final feature code. Follow [RELEASE_CHECKLIST.md](../../RELEASE_CHECKLIST.md): prepare the separate six-package version/date/README commit, obtain green main CI on that exact commit and full release acceptance, then create the owner-approved `v0.2.0-rc.1` tag. Prepared manifests are `0.2.0-rc.1`; this does not assert that npm publication has happened.

Dispatch `publish.yml` **from main**, explicitly choosing the existing source tag and npm `latest`. Review its source/artifact evidence and approve `npm-release`. The workflow publishes all six packages with npm OIDC, verifies exact versions/integrities and registry installation with TLS Kafka, then creates the GitHub release. Ordinary merges, pushes, tags, and GitHub releases never publish. No long-lived npm token/login/OTP is supplied to Actions. An owner-local fallback or metadata correction requires separate authorization; agents do not handle owner credentials.

## Acceptance checks after publishing

1. `npm dist-tag ls <package>` shows `0.2.0-rc.1` on the chosen tag (`latest`; `next` only if separately authorized) for all six packages.
2. `STREAMOTTER_INSTALL_FROM=registry pnpm test:install` passes against the registry, with the broker running. Wait about a minute after publishing first, because the registry can briefly report a new version as missing.
3. `npx streamotter@0.2.0-rc.1 --help` runs. `streamotter validate` accepts a `0.1.0-rc.3` configuration that has no `failureHandling`, as long as its `maxControlFrameBytes` is unset or at least 9216.
4. The npm pages show the `0.2.0-rc.1` READMEs.

## Rollback

Never unpublish. If `0.2.0-rc.1` is broken:

1. If it was published on `latest`: `npm dist-tag add <package>@0.1.0-rc.3 latest` for all six packages, one at a time if using a passkey (metadata correction needs separate owner authorization; no workflow automatically changes secondary tags).
2. `npm deprecate <package>@0.2.0-rc.1 "<what is wrong>; use 0.1.0-rc.3"` for all six.
3. Fix forward as `0.2.0-rc.2` through the same checklist ([corrections](../../RELEASE_CHECKLIST.md#corrections-and-partial-releases)).

A gateway that ran `0.2.0-rc.1` with `failureHandling` and a state directory must have its incidents resolved and its recovery boundaries retired before it goes back to `0.1.0-rc.3`. `0.1.0-rc.3` refuses a configuration with `failureHandling` and never reads the journal ([runbook §8](../../guides/source-failures.md#8-upgrade-and-downgrade)).

## Downstream

Lontra Creek pins `streamotter` exactly at `0.1.0-rc.3`. Publishing this release changes nothing on the demo or the site until a Lontra Creek PR moves that pin. The cross-project sequence is in the [rollout plan](https://github.com/jfricano/lontra-creek/blob/fix/streamotter-dev-domain/docs/releases/0.2.0-rc.1/ROLLOUT_PLAN.md) in the Lontra Creek repository (it moves to `main` when lontra-creek #41 merges).
