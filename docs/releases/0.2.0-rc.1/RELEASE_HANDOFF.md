# StreamOtter 0.2.0-rc.1 — release handoff

October 4, 2026. A short handoff for the coordinated deployment checklist. It links the detailed documents instead of repeating them. Nothing here contains credentials.

## What ships

One npm release, `0.2.0-rc.1`, carrying three internal milestones: V1.1 (source-failure handling, workbench host contract), V1.2 (independent quality review fixes) and V1.2.1 (the deferred minor fixes). The user-facing story is the `0.2.0-rc.1` entry in [CHANGELOG.md](../../../CHANGELOG.md) (still under "Unreleased" until it is dated at publish).

All six packages publish together at one version: `streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli` and `@streamotter/workbench`. The manifests still say `0.1.0-rc.3`; `node scripts/release/set-version.mjs 0.2.0-rc.1` sets them during the release ([checklist §1](../../RELEASE_CHECKLIST.md#1-prepare-the-release-commit)).

**dist-tag:** `latest`, then `next` too. This is deliberate and already documented, not a default. No stable version exists, and npm pointed `latest` at `0.1.0-rc.1` on the first publish, so every release candidate since has gone on `latest`; `0.1.0-rc.3` is `latest` today ([checklist §5, "Which tag"](../../RELEASE_CHECKLIST.md#5-publish-owner)). Publishing on `next` alone would leave `npm install streamotter` and the npm pages on `0.1.0-rc.3`. **Decision for jason:** keep the documented `latest` (recommended, so new users get the current code and docs), or use `next` only for a quieter candidate. With `latest`, every unpinned `npm install streamotter` moves to `0.2.0-rc.1`. Two changes can refuse a configuration or request that `0.1.0-rc.3` accepted: the `limits.maxControlFrameBytes` minimum (9216), and production answering invalid subscribe parameters with `FORBIDDEN`.

## PRs and merge order

| Order | PR | Branch → base | Content | Head at handoff |
| --- | --- | --- | --- | --- |
| 1 | [#55](https://github.com/jfricano/StreamOtter/pull/55) | `review/v1.1` → `main` | All of V1.1, with its review fixes | **Merged** October 4 as `560c7c0` |
| 2 | [#20](https://github.com/jfricano/StreamOtter/pull/20) | `feat/v1.2-quality-fixes` → `main` | V1.2 review fixes and the release docs | `976bb8d` |
| 3 | [#56](https://github.com/jfricano/StreamOtter/pull/56) | `feat/v1.2.1-minor-fixes` → `feat/v1.2-quality-fixes` | V1.2.1 fixes for issues #21–#54 | `4e67ef8` |

#55 is merged, and #20 now targets `main`. Next, merge #20, then #56. Each PR was mergeable with green CI at the heads above. Only jason merges.

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

- **Owner actions:** jason merges the three PRs and gives the go to publish. Nothing else blocks the release candidate.
- **Not verified, and not required for an RC** (required before a final `0.2.0`, [packet §10](../v1.1/ACCEPTANCE_PACKET.md#10-recommended-release-status)): a Kafka broker with ACLs enabled, Firefox and WebKit (F45), the proxy deployment with failure handling on, and one integrator walking the [runbook](../../guides/source-failures.md) end to end.
- **No open code findings.** All review findings are fixed, including J7.

## Who publishes

jason, from his own machine, with his npm credentials and on his go. Claude never handles npm tokens or publishes. Follow [RELEASE_CHECKLIST.md](../../RELEASE_CHECKLIST.md) §§1–7: set the version and date the CHANGELOG, run the clean build and every suite, dry run, tag `v0.2.0-rc.1`, publish all six with the chosen tag (`--tag latest` unless jason picks `next`), verify from the registry, then create the GitHub release from the CHANGELOG entry.

## Acceptance checks after publishing

1. `npm dist-tag ls <package>` shows `0.2.0-rc.1` on the chosen tag (`latest`, and `next` if it was added) for all six packages.
2. `STREAMOTTER_INSTALL_FROM=registry pnpm test:install` passes against the registry, with the broker running. Wait about a minute after publishing first, because the registry can briefly report a new version as missing.
3. `npx streamotter@0.2.0-rc.1 --help` runs. `streamotter validate` accepts a `0.1.0-rc.3` configuration that has no `failureHandling`, as long as its `maxControlFrameBytes` is unset or at least 9216.
4. The npm pages show the `0.2.0-rc.1` READMEs.

## Rollback

Never unpublish. If `0.2.0-rc.1` is broken:

1. If it was published on `latest`: `npm dist-tag add <package>@0.1.0-rc.3 latest` for all six packages, one at a time if using a passkey ([checklist](../../RELEASE_CHECKLIST.md#5-publish-owner) has the rate-limit note).
2. `npm deprecate <package>@0.2.0-rc.1 "<what is wrong>; use 0.1.0-rc.3"` for all six.
3. Fix forward as `0.2.0-rc.2` through the same checklist ([corrections](../../RELEASE_CHECKLIST.md#corrections)).

A gateway that ran `0.2.0-rc.1` with `failureHandling` and a state directory must have its incidents resolved and its recovery boundaries retired before it goes back to `0.1.0-rc.3`. `0.1.0-rc.3` refuses a configuration with `failureHandling` and never reads the journal ([runbook §8](../../guides/source-failures.md#8-upgrade-and-downgrade)).

## Downstream

Lontra Creek pins `streamotter` exactly at `0.1.0-rc.3`. Publishing this release changes nothing on the demo or the site until a Lontra Creek PR moves that pin. The cross-project sequence is in the [rollout plan](https://github.com/jfricano/lontra-creek/blob/fix/streamotter-dev-domain/docs/releases/0.2.0-rc.1/ROLLOUT_PLAN.md) in the Lontra Creek repository (it moves to `main` when lontra-creek #41 merges).
