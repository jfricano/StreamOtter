# StreamOtter 0.2.0-rc.1 — release handoff

October 4, 2026; updated after publication ([verified publication](#verified-publication)). A short handoff for the coordinated deployment checklist. It links the detailed documents instead of repeating them. Nothing here contains credentials.

## What ships

One published npm release, `0.2.0-rc.1`, carrying three internal milestones: V1.1 (source-failure handling, workbench host contract), V1.2 (independent quality review fixes) and V1.2.1 (the deferred minor fixes). The user-facing story is the `0.2.0-rc.1` entry in [CHANGELOG.md](../../../CHANGELOG.md), dated October 4.

All six packages are published at `0.2.0-rc.1` on npm `latest`: `streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli` and `@streamotter/workbench`. Their exact registry tarballs and provenance match the owner-approved source and original publication artifacts below.

**dist-tag:** Jason approved `latest` for this release. No stable version exists, and every RC so far used `latest`, so unpinned `npm install streamotter` and the npm pages move to `0.2.0-rc.1`. Secondary `next` promotion is a separate owner action, not part of the approved publisher workflow. Two changes can refuse a configuration or request that `0.1.0-rc.3` accepted: the `limits.maxControlFrameBytes` minimum (9216), and production answering invalid subscribe parameters with `FORBIDDEN`.

## PR integration

The owner merged the feature code in the required order:

| Order | PR | Merged on main |
| --- | --- | --- |
| 1 | [#55](https://github.com/jfricano/StreamOtter/pull/55) | `560c7c0` — V1.1 and its review fixes |
| 2 | [#20](https://github.com/jfricano/StreamOtter/pull/20) | `70f9f05` — V1.2 review fixes and release docs |
| 3 | [#56](https://github.com/jfricano/StreamOtter/pull/56) | `2c1af737978005809ef3dc97b3b68affe8fc05ed` — V1.2.1 fixes |

Publisher [#57](https://github.com/jfricano/StreamOtter/pull/57) is reconciled against that final feature main, preserving its pinned CI and release acceptance while replacing owner-local publication with the approved workflow. The owner merged it as `86690f1bdbba55ac0d55809d63e48c51cd831a23`. The owner then merged the macOS acceptance fixes in [#59](https://github.com/jfricano/StreamOtter/pull/59) as `d47b98783430538b479989389e6ca5fb476ed7b3`, and release-preparation [#58](https://github.com/jfricano/StreamOtter/pull/58) as `fc7f47c7cd642164302f5076581ac02a84325fde`. That exact main passed CI and release acceptance before the owner-approved source tag, explicit workflow dispatch and protected publication approval. Integrating code alone does not publish it.

## Verified publication

Completed October 4, 2026 Pacific (October 5 UTC). [Run 37253704865](https://github.com/jfricano/StreamOtter/actions/runs/37253704865) succeeded on attempt 3; the [public GitHub prerelease](https://github.com/jfricano/StreamOtter/releases/tag/v0.2.0-rc.1) was created at `2026-10-05T03:28:44Z`.

| Evidence | Verified result |
| --- | --- |
| Source and tag | `v0.2.0-rc.1` resolves to `fc7f47c7cd642164302f5076581ac02a84325fde`; all six manifests are `0.2.0-rc.1`. |
| Registry and distribution tag | All six exact versions exist and `latest` points to `0.2.0-rc.1`; downloaded registry tarball sizes, SHA256 and SHA512 integrity match the original approved artifacts. |
| Original manifest | SHA256 `af4ccbfa247c653f9f431dd781540517929cdf80d59559c0eb7020dbda01d952`; [GitHub release asset](https://github.com/jfricano/StreamOtter/releases/download/v0.2.0-rc.1/manifest.json) bytes match the original run artifact. Artifact IDs: `11322415201` (`approved-npm-tarballs`) and `11321288689` (`release-selection`). |
| Provenance | All six attestations cryptographically verified with npm `11.19.0` audit signatures, with no invalid or missing signatures. They identify this repository, `.github/workflows/publish.yml`, `refs/heads/main`, the exact source above and this workflow run. The five scoped packages were published in attempt 1; `streamotter` was published in attempt 2. |
| Clean registry installation | [Verification job](https://github.com/jfricano/StreamOtter/actions/runs/37253704865/job/111603563338): `STREAMOTTER_INSTALL_FROM=registry pnpm test:install`, **22 passed, 0 failed, 0 skipped**, including real copies without workspace links, the umbrella-only install, and production CLI delivery from TLS Kafka. The broker was stopped afterward. |
| Recovery | Attempts 1 and 2 stopped on registry propagation timeouts after successful uploads became visible later. Failed-job retries retained the original preparation and artifacts. Attempt 3 inventoried and skipped all six matching versions, then completed registry acceptance and the GitHub release; nothing was rebuilt or republished in that attempt. |

Publication completes the npm dependency gate for Lontra's package-pin review; it does not merge or deploy Lontra. Future releases still require the owner's explicit source tag, workflow selection and protected approval under the [release checklist](../../RELEASE_CHECKLIST.md).

## Verification

Reported development runs on Node 24.21.0 (Kafka 4.1.2, headless Chromium 141), before the separate release-preparation rehearsal:

| Tier | V1.1 at `483eb82` | V1.2 at #20 | V1.2.1 at #56 (final code) |
| --- | --- | --- | --- |
| `pnpm verify` | 384 | 397 | 444 |
| `test:kafka` | 42 | 44 | 48 |
| `test:kafka:replicated` | 2 | 2 | 3 |
| `test:browser` | 56 | 58 | 59 |
| `test:deploy` | 4 | 4 | 5 |
| `test:install` | 22 | 22 | 22 |
| `test:load` | — | 1 | 1 |

GitHub CI: `Verify (Node 24)` and `Verify (Node 26)` are green on every head above. The extended workflow (Kafka, install, browser, deploy) was run by hand on the V1.2.1 branch and passed on Node 24 and 26, as did the nightly replicated-Kafka job. Final release main `fc7f47c7cd642164302f5076581ac02a84325fde` also passed [main CI](https://github.com/jfricano/StreamOtter/actions/runs/37252897074) and [Extended checks](https://github.com/jfricano/StreamOtter/actions/runs/37252966584), including Node 24/26 tiers and replicated Kafka on Node 24.

Details: [V1.1 acceptance packet](../v1.1/ACCEPTANCE_PACKET.md) §4, [V1.2 log](../v1.2/IMPLEMENTATION_LOG.md) §4, [V1.2.1 log](../v1.2.1/IMPLEMENTATION_LOG.md), [implementation status](../../IMPLEMENTATION_STATUS.md).

### macOS acceptance fixes — verified

The four failures found in the initial release rehearsal were resolved by #59. Its exact source `63864aa4be0bb884a9e9ce4f740cd4775faee917` was independently tested on macOS with Node 24.21.0, npm/pnpm 11.19.0, Kafka 4.1.2, Temurin 21.0.12.1+1 and Caddy 2.11.4. The three-file reproduction passed 55 tests and `pnpm verify` passed 446; each had only the existing ownership test skipped because the run was not root. Clean build, contracts, type checking, publisher controls (13), load (1), browser (59), Kafka (48), packed installation (22) and proxy deployment (5) passed. Broker-dependent tiers had no skips, and owned brokers were stopped afterward.

Oversized IPC requests now receive a response while excess input is discarded, with a one-second limit and at most `maxConnections` lingering sockets. Shutdown closes answered sockets immediately. If the linger cap is exhausted, the fallback closes immediately and can reset that excess caller. The refusal-accounting assertions remain intact, with each handshake also required to return `UNAUTHENTICATED`; the management burst uses 400 requests over eight kept-alive connections and still requires both success and `OVERLOADED`.

There is no default state folder: `--operator-socket` requires an explicit `--state-dir`. An ordinary `./state` under the primary Mac project yields a 62-byte socket path. Real 103-byte paths succeed; oversized 104-byte paths receive clear startup and client refusal. The packed-install fixture now chooses a short state folder, and its operator crash/restart and production TLS Kafka tests passed with the default macOS `TMPDIR` unchanged. The earlier global temporary-directory workaround is no longer required.

Release PR #58 records the final reconciled six-package candidate's local exact-source acceptance/packing receipts. Local tarballs remain rehearsal evidence; the protected workflow generated the actual publication artifacts against the owner's final main/tag, as recorded in [Verified publication](#verified-publication).

## Remaining limitations

- **npm release gate complete:** source integration, exact-main CI, full release acceptance, owner-approved tag/publication, all-six registry checks and GitHub release are verified above. Lontra's package pin and deployment remain a separate controlled rollout.
- **Not verified, and not required for an RC** (required before a stable release, [packet §10](../v1.1/ACCEPTANCE_PACKET.md#10-recommended-release-status)): a Kafka broker with ACLs enabled, Firefox and WebKit (F45), the proxy deployment with failure handling on, and one integrator walking the [runbook](../../guides/source-failures.md) end to end.
- **Review findings:** all recorded findings, including J7 and the four macOS acceptance failures, are fixed and independently verified as described above.

## Who publishes

Jason selects and approves each release through the [approval-gated Trusted Publishing workflow](../../PUBLISHING.md). For this release, the owner merged #58, approved source tag `v0.2.0-rc.1` at `fc7f47c7cd642164302f5076581ac02a84325fde`, and approved the protected publication; the resulting npm and GitHub release evidence is recorded above. Future releases follow [RELEASE_CHECKLIST.md](../../RELEASE_CHECKLIST.md) independently.

For future releases, dispatch `publish.yml` **from main**, explicitly choosing the existing source tag and an allowed npm distribution tag. Review its source/artifact evidence and approve `npm-release`. The workflow publishes all six packages with npm OIDC, verifies exact versions/integrities and registry installation with TLS Kafka, then creates the GitHub release. Ordinary merges, pushes, tags, and GitHub releases never publish. No long-lived npm token/login/OTP is supplied to Actions. An owner-local fallback or metadata correction requires separate authorization; agents do not handle owner credentials.

## Acceptance checks after publishing

The publishing workflow's `verify_registry` job covered checks 1 and 2 for this release (exact integrity, the `latest` tag, and a registry install with TLS Kafka) before it created the GitHub release. Checks 3 and 4 are not recorded here.

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

Lontra Creek pins `streamotter` exactly at `0.1.0-rc.3`. Publishing this release changes nothing on the demo or the site until a Lontra Creek PR moves that pin. The cross-project sequence is in the [owner-merged rollout plan](https://github.com/jfricano/lontra-creek/blob/91c05a51bb2ead93f95e65b10751547e75c724f2/docs/releases/0.2.0-rc.1/ROLLOUT_PLAN.md), saved at an immutable commit after lontra-creek #41 merged.
