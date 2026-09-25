# StreamOtter release checklist

Applies to every release, starting with `0.1.0-rc.1`. The five public packages (`@streamotter/contracts`, `client`, `gateway`, `cli`, `workbench`) are always released together with one version. Steps marked **owner** need the owner's credentials or go-ahead; Claude never handles npm tokens or logins and never pushes or publishes without explicit approval.

`pnpm` below means pnpm 11.19.0, the version in `packageManager` (`npx pnpm@11.19.0` works without a global install).

## 0. Prerequisites

- [ ] **owner** The `streamotter` npm organization exists, and the publishing account has two-factor authentication (`npm whoami` works).
- [ ] **owner** `https://github.com/jfricano/StreamOtter` exists and has the release commit. The npm pages link to it, so it must be reachable (public) before a version gets the `latest` tag.
- [ ] CI is green on the release commit.
- [ ] Local test tools are installed: `pnpm kafka:setup`, `pnpm browsers:setup`, `pnpm deploy:setup`.

## 1. Prepare the release commit

- [ ] `node scripts/release/set-version.mjs <version>` sets the version in all five manifests. The install test fails if they differ.
- [ ] `CHANGELOG.md`: complete the entry and replace "not yet published" with the date.
- [ ] Package READMEs (`packages/*/README.md`, `apps/workbench/README.md`): the status line must match the release. Remove the release-candidate notice for a stable release. npm shows the README of the version tagged `latest`, so README changes reach npm only with a new version.
- [ ] `README.md` and `docs/IMPLEMENTATION_STATUS.md` state accurately what is published.
- [ ] Commit.

## 2. Clean build and every suite

```bash
pnpm install --frozen-lockfile
pnpm clean && pnpm build
pnpm check:contracts
pnpm typecheck
pnpm test
pnpm test:load
pnpm kafka:start
pnpm test:kafka
pnpm test:install    # with the broker running, this includes the installed `streamotter start` over TLS Kafka
pnpm test:browser
pnpm test:deploy
pnpm kafka:stop
```

- [ ] Every suite passes. Record new results in `docs/IMPLEMENTATION_STATUS.md` if they changed.
- [ ] `pnpm test:install` reports the TLS Kafka case as passed, not skipped.

## 3. Dry run

```bash
pnpm -r --filter @streamotter/contracts --filter @streamotter/client --filter @streamotter/gateway \
  --filter @streamotter/workbench --filter @streamotter/cli publish --dry-run --no-git-checks --tag next --access public
```

- [ ] Five packages are listed with the expected version and file lists (`dist`, `src`, `bin` for the CLI, `README.md`, `LICENSE`, `package.json`).

## 4. Tag

```bash
git tag -a v<version> -m "StreamOtter <version>"
git push origin main v<version>          # owner go-ahead
```

## 5. Publish (owner)

npm requires two-factor authentication to publish. With an authenticator app, pass a fresh code with `--otp` (codes last about 30 seconds). With a passkey (for example Touch ID), leave out `--otp`: pnpm prints a link, and you approve in the browser.

```bash
npm login
pnpm -r --filter @streamotter/contracts --filter @streamotter/client --filter @streamotter/gateway \
  --filter @streamotter/workbench --filter @streamotter/cli publish --tag <tag> --access public --otp <code>
```

**Which tag.** npm pointed `latest` at `0.1.0-rc.1` when the packages were first published. So until the first stable version, publish each release candidate with `--tag latest`, then point `next` at it too:

```bash
for p in contracts client gateway workbench cli; do npm dist-tag add @streamotter/$p@<version> next --otp <code>; done
```

With passkey-only two-factor authentication, `npm dist-tag add` waited without completing on September 25, so `next` still points to `0.1.0-rc.1`. The step is optional: `latest` is what `npm install` uses and what the npm pages show. To run it, the account needs a method that produces codes for `--otp`, such as an authenticator app added alongside the passkey.

From the first stable version on, publish stable versions with `--tag latest`, and prereleases with `--tag next` only.

- The real publish keeps pnpm's git checks: a clean tree on the publish branch, in sync with the remote. That's why the push in step 4 comes first.
- Always pass `--tag` explicitly.
- pnpm publishes in dependency order and skips versions already on the registry. If a one-time password expires or the network fails partway, rerun the same command.
- A **brand-new** package gets `latest` on its first publish, whatever `--tag` says (this happened for `0.1.0-rc.1`). Check with `npm dist-tag ls` in step 6. `latest` can be moved but not removed.

## 6. Verify from the registry

```bash
npm dist-tag ls @streamotter/cli              # repeat for each package
STREAMOTTER_INSTALL_FROM=registry pnpm test:install
```

- [ ] Every package has the expected dist-tags.
- [ ] The registry install test passes. It downloads the published tarballs, runs the same checks, and installs from the registry (not from local files) into a fresh project.
- [ ] Each npm page renders its README, and the links resolve.

## 7. After publishing

- [ ] **owner** Create a GitHub release from the tag, using the CHANGELOG entry.
- [ ] Update `README.md`, `docs/IMPLEMENTATION_STATUS.md`, and `docs/RELEASE_PLAN.md` to say what is now published.

## Promotion at launch

The recommended path is to publish a stable version (for example `0.1.0`) through this checklist with `--tag latest`, after removing the release-candidate notices from the READMEs. The alternative, `npm dist-tag add @streamotter/<package>@<rc-version> latest` for all five, keeps the release-candidate README on the npm pages, because a README can only change with a new version.

## Corrections

- **Don't unpublish.** npm restricts unpublishing after 72 hours, and a version number can never be reused, even after unpublishing.
- **A broken version:** `npm deprecate @streamotter/<package>@<version> "<what is wrong>; use <fixed version>"` for each affected package, then release a fixed version through this checklist (for example the next `-rc.N`, or a patch). Deprecate and republish all five together to keep them in step.
- **A wrong dist-tag:** `npm dist-tag add @streamotter/<package>@<good version> <tag>`.
