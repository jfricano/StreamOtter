# Approval-gated npm publication

The [publishing workflow](../.github/workflows/publish.yml) automates StreamOtter's six-package release after explicit owner selection and approval. Pushes, merges, tag creation, GitHub releases, and schedules do **not** publish. Start it manually from `main`, select an existing release tag, and explicitly choose `latest` or `next`.

This setup does not prepare a version, merge development branches, create a source tag, or deploy the Lontra Creek website/backend. All six manifests remain unchanged by installing it. `0.2.0-rc.1` was the first release published this way, on October 5, 2026 ([run](https://github.com/jfricano/StreamOtter/actions/runs/37253704865)). The selected release must include this workflow and its helpers, and must contain the replicated-Kafka scripts/tests used by release acceptance. Older code without that tier fails preparation rather than silently skipping it.

## One-time owner settings

On GitHub, configure repository environment **`npm-release`**:

- Required reviewer: exactly user **`jfricano`**.
- **Prevent self-review: off**, so the sole maintainer can initiate and approve a release.
- **Administrator bypass: off**.
- Deployment branches/tags: **selected branches and tags**, with exactly one rule, branch **`main`**. The workflow itself runs from `main`; the selected source tag is separately checked for membership in `main`.

The helper checks the required reviewer, self-review policy, and branch rule before the protected job is scheduled, and checks again before npm publication. A missing or weakened environment fails preparation. If the REST response includes `can_admins_bypass`, it must be false; documentation examples can omit it, so absence is not treated as evidence that the UI setting is disabled. Verify that setting in GitHub's UI as well.

On npm, configure a **GitHub Actions trusted publisher on each existing package**:

| Setting | Value |
| --- | --- |
| Organization/user | `jfricano` |
| Repository | `StreamOtter` |
| Workflow filename | `publish.yml` (filename only) |
| Environment | `npm-release` |
| Allowed action | Direct `npm publish` |

Packages: `streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/workbench`, `@streamotter/cli`.

No long-lived npm write token, `NODE_AUTH_TOKEN`, or `NPM_TOKEN` is required. Do not add one. Secondary dist-tag management is not configured or automated. The repository/workflow/environment settings must match exactly. Saving trust settings does not prove OIDC publication; the first explicitly approved release establishes that evidence, and for this repository that was `0.2.0-rc.1` ([run](https://github.com/jfricano/StreamOtter/actions/runs/37253704865)).

## Run an approved release

1. Follow the [release checklist](RELEASE_CHECKLIST.md). Merge the desired code and version/documentation preparation first. Wait for successful `Verify (Node 24)` and `Verify (Node 26)` checks from the **main push CI run on the exact release commit**.
2. With owner authorization, create and push the annotated tag `v<version>` on that commit. The workflow requires that tag to exist already; it never creates it. All six package versions must equal the tag's version.
3. Open Actions → **Publish approved npm release** → **Run workflow**, branch **`main`**. Enter the exact tag and choose the distribution tag. Stable versions require `latest`; release candidates accept the explicitly selected `latest` or `next`. For `0.2.0-rc.1`, Jason approved `latest`; that approval does not promote secondary `next` or select future releases.
4. Preparation validates controls and source, runs the full release checks on Node `24.21.0` / npm `11.19.0` / pnpm `11.19.0`, then uses `pnpm pack` to rewrite workspace dependencies and apply publish exports. It records all six artifact identities and SHA256/SHA512 integrity values. It does not publish.
5. Review the run summary and immutable artifact manifest, then approve the **`npm-release`** job. The run name shows the selected source tag and npm tag. This approval applies only to that run and selection.
6. The publishing job rechecks source, CI, controls and artifact bytes, inventories all six exact versions, and publishes only missing versions through npm OIDC, with provenance. It does not run repository or dependency installation scripts and has no repository-write permission.
7. A separate read-only job checks registry integrity/tags and runs `STREAMOTTER_INSTALL_FROM=registry pnpm test:install` with real TLS Kafka. Only after that succeeds does a final job, without OIDC, verify again and create the GitHub release with the source SHA, manifest, and changelog link.

All release runs share one concurrency group. A candidate's full release checks include replicated Kafka; no `STREAMOTTER_ALLOW_SKIP` override is set. The release handoff may record additional acceptance limitations (for example native ACL or additional browsers); this workflow does not turn unexecuted checks into passed evidence. Review those limitations before approving.

## Partial publication and recovery

npm publication across six packages is not atomic. Hold Lontra adoption until all six versions, selected tags, and registry installation are verified.

- Retain the original run's `approved-npm-tarballs` and `release-selection` artifacts (30-day retention).
- Rerun the **failed job and dependent jobs from that run**, keeping the original preparation artifacts. Already-existing versions are skipped only when package identity and registry integrity match the exact approved bytes. All six are inventoried before any missing package is published.
- A rebuilt tarball with different bytes fails against an existing version. Do not change versions or repack to conceal a partial release. Download retained evidence before retention expires.
- Registry 404 propagation after publication is retried for up to two minutes. Integrity/identity mismatches, deprecated versions, other registry errors, and conflicting distribution tags stop the run for owner review.
- An ambiguous npm upload failure is not automatically republished. Inspect the registry and rerun with the retained artifacts after propagation. If npm already accepted it, its exact integrity must match.
- A selected tag moved after approval fails. If a GitHub release already exists, it must record the approved source SHA and prerelease status; reruns can complete its manifest upload.

There is no automatic secondary `next`/`latest` promotion, unpublish, deprecation, version bump, or rollback. Any correction to npm metadata requires a separate owner decision. Lontra deployment remains an independent controlled rollout.

## Verification and references

Run publisher tests with `node --test scripts/release/publishing/release.test.mjs`. They run in regular CI on Node 24 and 26 and cover malicious input, environment policy, exact source CI, packing constraints, artifact tampering, partial-publication inventory, ambiguous failure, registry propagation, and workflow triggers/privilege separation.

Local preparation verified an isolated build and all six real `pnpm pack` artifacts against the intended development source, still labeled `0.1.0-rc.3`; those tarballs were fixtures, never release artifacts. Tests do not prove the protected runner/OIDC setup or actual registry installation after publication. Record those separately on the approved release run.

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Environment REST API](https://docs.github.com/en/rest/deployments/environments#get-an-environment)
