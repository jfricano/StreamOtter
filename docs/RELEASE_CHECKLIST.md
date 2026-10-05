# StreamOtter release checklist

All six public packages (`streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli`, `@streamotter/workbench`) release together with one version. Owner authorization is required for merging release code, creating/pushing tags, starting publication, and approving it. Ordinary merges never publish.

Use the approval-gated [publishing workflow and setup/recovery guide](PUBLISHING.md). It replaces repetitive owner-local publishing with npm Trusted Publishing; it does not remove the owner's release decision. An owner-local fallback, credential use, metadata correction, or secondary tag promotion requires separate explicit authorization.

## 0. Prerequisites

- [ ] The selected code, publishing workflow/helpers, and release tests are merged into public `jfricano/StreamOtter`.
- [ ] **owner** `npm-release` exists with only `jfricano` as required reviewer, self-review allowed, administrator bypass disabled, and a branch-only `main` deployment rule.
- [ ] **owner** All six existing npm packages trust `jfricano/StreamOtter`, workflow `publish.yml`, environment `npm-release`, with direct `npm publish` allowed. No stored npm write token.
- [ ] Record known release acceptance limitations and obtain the owner's disposition. Installing automation does not publish `0.2.0-rc.1` or complete the stacked development PRs.

## 1. Prepare the release commit

- [ ] `node scripts/release/set-version.mjs <version>` sets the same version in all six manifests.
- [ ] Complete the release's `CHANGELOG.md` entry and replace "not yet published" with the date. One entry per version; link its milestone documents instead of creating separate entries for internal milestones.
- [ ] Package READMEs match the version/status and describe implemented capabilities accurately. npm receives the package README at publication; GitHub README edits alone do not refresh it.
- [ ] `README.md` and `docs/IMPLEMENTATION_STATUS.md` distinguish the prepared candidate from what is currently published.
- [ ] **owner** Review and merge the release preparation commit after the intended development PRs.
- [ ] The exact final `main` commit passes main-push CI `Verify (Node 24)` and `Verify (Node 26)`. Earlier branch results are insufficient.
- [ ] **owner** Run **Extended checks** against that exact final release `main`: native Kafka, packed installation, browser and proxy tiers on Node 24/26, plus its separate replicated Kafka tier on Node 24. Earlier development-branch runs are insufficient; this check does not publish.

## 2. Release acceptance and packing

The Actions preparation job runs the following using pinned Node `24.21.0`, npm `11.19.0`, and pnpm `11.19.0`. If rehearsing locally, set up Kafka/browser/Caddy tools first:

```bash
pnpm install --frozen-lockfile
pnpm clean && pnpm build
pnpm check:contracts
pnpm typecheck
pnpm test
pnpm test:load
pnpm kafka:setup && pnpm kafka:start
pnpm browsers:setup
pnpm deploy:setup
pnpm test:kafka
pnpm test:install
pnpm test:browser
pnpm test:deploy
pnpm kafka:stop
./scripts/kafka/replicated-start.sh
pnpm test:kafka:replicated
./scripts/kafka/replicated-stop.sh
```

- [ ] All required suites pass on the selected release source. The candidate must include the replicated broker tier; older source without it is rejected by preparation.
- [ ] Packed installation's real TLS Kafka case passes rather than skips. `pnpm test:kafka:replicated` reports three tests passed (the environment check and both failure tests), none skipped; leave `STREAMOTTER_ALLOW_SKIP` unset.
- [ ] On the first macOS rehearsal, replicated start reports "Replicated Kafka 4.1.2 is ready"; stop reports each node stopped and leaves no broker Kafka `java` process running.
- [ ] Review all six packed file lists and the exact artifact manifest in the workflow summary. `pnpm pack` rewrites internal workspace dependencies to the selected version and applies `publishConfig.exports`; directory-based `npm publish` is not substituted.
- [ ] Record additional handoff limitations honestly, including acceptance checks that this workflow does not execute.

## 3. Existing source tag (owner)

After the release commit and exact-source CI are accepted:

```bash
git tag -a v<version> -m "StreamOtter <version>"
git push origin v<version>
```

- [ ] Tag resolves to the approved commit already on `main`; all six versions match it.
- [ ] Tag contains the merged publishing workflow/helpers. The workflow never creates a tag.

## 4. Select and approve publication (owner)

- [ ] Actions → **Publish approved npm release** → **Run workflow**, branch `main`, explicit existing release tag and distribution tag.
- [ ] Stable versions use `latest`; prereleases accept the explicitly selected `latest` or `next`. For `0.2.0-rc.1`, Jason approved `latest`; no secondary `next` promotion is included. Future releases still require an explicit selection.
- [ ] Review preparation results, source SHA, package versions, selected distribution tag, and artifact hashes.
- [ ] Approve the `npm-release` job for this release only. No token/login/OTP needs to be supplied to the workflow.

Only that protected publication job receives OIDC. It inventories every exact version before publishing missing packages and rejects mismatched existing integrity. Publication has no repository-write permission or source/dependency installation step.

## 5. Registry and release acceptance

- [ ] All six package versions and SHA512 integrities match the approved tarballs.
- [ ] The selected npm distribution tag points to the approved version for all six; no secondary tag is moved automatically.
- [ ] The separate registry-install job passes `STREAMOTTER_INSTALL_FROM=registry pnpm test:install` including real TLS Kafka. It uses read-only permissions and no OIDC.
- [ ] Only after those checks does the final non-OIDC job create the GitHub release and attach the manifest, recording source and changelog.
- [ ] Owner reviews npm README rendering and resolves documentation links.
- [ ] Update publication-status documents and provide the verified version/integrity facts to the Lontra package-pin PR. Publishing alone does not redeploy Lontra.

## Corrections and partial releases

Hold downstream adoption when publication or verification fails. Retain the original artifacts and use the [partial-publication recovery procedure](PUBLISHING.md#partial-publication-and-recovery). Never silently choose a new version, blindly retry an ambiguous upload, or accept different bytes for a published version.

Do not unpublish: a version number cannot be reused. Broken releases require an owner-approved deprecation and a new coordinated six-package version. Conflicting distribution tags or optional secondary promotions require a separate owner-approved correction; this workflow does not manage them.
