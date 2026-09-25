# StreamOtter first public release plan

September 25, 2026 · `0.1.0-rc.1` on npm and `0.1.0-rc.2` (guides and npm pages) prepared; source public on GitHub; the home site goes to the owner (Codex); the article has its own chat

## Goal

Make StreamOtter V1 publicly usable and discoverable: installable npm packages, public source on GitHub, practical guides, the home site with the integrated `/demo`, and an announcement article. V1 itself is complete and has passed Gate A ([implementation status](./IMPLEMENTATION_STATUS.md)). This plan covers releasing it; it adds no runtime features.

Every public claim must match verified behavior: no invented adoption, performance, or capacity numbers, and nothing presented as shipped before it is ([founding document](./FOUNDING.md), [home site and demo plan](./WEBSITE_AND_DEMO_PLAN.md)).

## Where things stand

| Item | State |
| --- | --- |
| Packages | All five are ready to publish as `0.1.0-rc.1`: metadata, `LICENSE`, and a README guide in each, and `publishConfig` that drops the in-repository source condition. `pnpm test:install` packs them, installs the tarballs with npm outside the workspace, and uses them as an application would (14 / 14 on Node 24 and 26 with the broker). `pnpm publish --dry-run` passes for all five. The owner published `0.1.0-rc.1` on September 25 from tag `v0.1.0-rc.1`. As expected for new packages, both `next` and `latest` point to it. The registry install test passed 14 / 14. |
| npm names | The five packages are published under the owner's `streamotter` organization, with `jfricano` as maintainer. The unscoped name `streamotter` remains unpublished. |
| License | MIT, © 2026 Orca Solutions: a root `LICENSE`, a copy in each package, and `license` fields. The workbench also ships the notices of the Socket.IO client code it bundles. |
| Source control | Public at [github.com/jfricano/StreamOtter](https://github.com/jfricano/StreamOtter) since September 25, 2026 (`main` only; commits authored with a GitHub no-reply address). The pre-push scan found no secrets, keys, certificates, `.local/`, or build output in the tree or history. Both CI workflows pass: `ci.yml` on Node 24 and 26, and `extended.yml` (Kafka, install, browser, and deployment on Linux). |
| Version fields | Every public package is `0.1.0-rc.1` (`scripts/release/set-version.mjs` keeps them together); nothing is tagged. |
| Site and demo | Planned in the home site and demo plan; not started. |
| Guides and article | Not started. The README, [deployment guide](./DEPLOYMENT.md), and the [example README](../examples/order-dashboard/README.md) are the starting material. |

## Decisions for the owner

| Decision | Status |
| --- | --- |
| License | **Decided: MIT**, copyright "Orca Solutions" (also the packages' `author`). |
| First version | **Decided: `0.1.0-rc.1`** (pre-1.0 API). Package SemVer is independent of product milestones and `protocolVersion`, per the roadmap. |
| GitHub location | **Decided and done: `jfricano/StreamOtter`, public** since September 25, 2026. |
| Which packages are public | All five, as prepared. Folding the workbench's static assets into `@streamotter/cli` (four packages) remains possible before the first publish. |
| npm organization | **Done:** the owner created the `streamotter` organization on September 25. The owner holds the credentials and 2FA; Claude never handles npm tokens or logins. |
| Publishing method | **Decided for `0.1.0-rc.1`:** manual `pnpm publish` by the owner, following the [release checklist](./RELEASE_CHECKLIST.md). GitHub Actions publishing with provenance (a trusted publisher, configured per package once it exists) remains an option for later releases. |
| Author email in history | **Decided and done:** before the first push, the history was rewritten to "Jason Fricano" with the account's GitHub no-reply address, and the repository's git configuration uses the same identity. |
| Security reporting | **Done:** GitHub private vulnerability reporting, which `SECURITY.md` points to, was enabled on September 25. Still open: whether to add a `CODE_OF_CONDUCT.md`. |
| Launch owner and date | **Open.** Who approves "go", and when. |

## Workstreams

Five workstreams. The release chat handles 1–3 and can draft 5; the home site and demo (4) have their own chat. All share the sequencing below.

### 1. npm packages (release chat)

Work that needs no owner decisions:

- Package metadata: `license`, `repository`, `homepage`, `bugs`, `keywords`, `author`, `publishConfig.access: public`, `engines`, and `files` (ship `dist`; decide whether to ship `src`).
- Check that `pnpm pack` rewrites `workspace:*` to real versions and that each tarball contains only what it should.
- **Install test outside the workspace:** pack all tarballs, install them into a fresh temporary project with npm (not workspace links), then:
  - bundle an app with `@streamotter/client`;
  - run `streamotter init`, `validate`, `generate`, `dev` (the workbench loads) and `start`;
  - import `@streamotter/gateway` programmatically.
  Automate this as a test so every release runs it.
- `pnpm publish --dry-run` for every package.
- `CHANGELOG.md`, and a release checklist covering build, every suite, the install test, tag, publish, and verification from the registry.
- Plan corrections: prefer `npm deprecate` and a patch release over `unpublish` (npm restricts unpublishing after 72 hours).

Publish the release candidate under the `next` dist-tag first; promote to `latest` at launch. (npm assigned `latest` to `0.1.0-rc.1` anyway, because the packages were new. Until the first stable version, each release candidate therefore goes to both `latest` and `next`, and the npm pages show the newest one.)

**Status (September 25):** done, except `CHANGELOG.md`'s publication date, which is set at publish time. The install test is `pnpm test:install`, and its registry mode (`STREAMOTTER_INSTALL_FROM=registry`) is the verification step after publishing. The build, every suite, the install test, tagging, publishing, registry verification, promotion, and corrections are in the [release checklist](./RELEASE_CHECKLIST.md). For a brand-new package, the registry may also point `latest` at the first version published; the checklist says how to check.

### 2. Practical guides for the npm pages

Each package page is its README, so each gets a short, runnable guide with links to the full docs:

| Package | Guide |
| --- | --- |
| `@streamotter/client` | Subscribe, render states (`live` versus `stale`), clean up, handle errors; React hook pattern. |
| `@streamotter/gateway` | Handlers (`authenticate`, `authorize`, `map`, `snapshot`), the snapshot/revision contract, `createGateway`, revocation. |
| `@streamotter/cli` | `init` → `dev` → workbench → `generate` → `start`; exit codes; production refusals. |
| `@streamotter/contracts` | Types and config validation for tooling authors; most users do not install it directly. |
| `@streamotter/workbench` | One paragraph: it is served by `streamotter dev`. |

**Status (September 25):** the guides are written in `docs/guides/` ([getting started](./guides/getting-started.md), [existing app](./guides/existing-app.md), [Kafka](./guides/kafka.md), [troubleshooting](./guides/troubleshooting.md)), and [DEPLOYMENT.md](./DEPLOYMENT.md) is now the npm-based production guide. The root README leads with the npm install, the guides, and the packages, and links to npm. Each package README links to the guides and to the other packages. Because npm shows a version's own README, `0.1.0-rc.2` carries these READMEs to npm. The five READMEs are written with absolute links. The install test checks that each tarball contains its README and has no relative links. Every code sample was type-checked against the installed packages, and the CLI README's first-run flow was run as written.

Longer guides — adding live state to an existing app, Kafka and TLS/SASL setup, and deployment behind a proxy — come from the existing docs. They should live where the site can also publish them; coordinate with workstream 4.

### 3. GitHub repository

Preparation (no remote needed):

- `LICENSE` (once chosen), `SECURITY.md` (how to report vulnerabilities), `CONTRIBUTING.md` (setup, `.local/` tools, test tiers), and a `CODE_OF_CONDUCT.md` if desired.
- CI workflow (GitHub Actions):
  - Every push: install with the frozen lockfile, build, `check:contracts`, `typecheck`, `test`, `test:load`, and the install test.
  - Nightly or on demand: `test:browser`, and Kafka and deploy jobs (Linux runners need the setup scripts extended beyond macOS, or a Kafka service container).
- Final review before the first push: no secrets, certificates, or `.local/` content in the tree or history.

**Status (September 25):** `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, and `.github/workflows/ci.yml` (every push and pull request: Node 24 and 26, the frozen-lockfile install, build, `check:contracts`, `typecheck`, `test`, `test:load`, and `test:install`) and `extended.yml` (nightly and on demand, Linux: Java from `actions/setup-java`, then `test:kafka`, `test:install` with the broker, `test:browser`, and `test:deploy`) are in place. On September 25 the repository was created (public) and `main` was pushed. `ci.yml` passed on its first run: both Node versions, every step including `test:install`, about 70 seconds per job. `extended.yml` passed on its first (manual) run: Kafka 20 / 20, install 14 / 14, browser 13 / 13, and deployment 4 / 4 on Linux, none skipped. The pre-push review found nothing to remove.

Pushing publishes code and is done only with the owner's explicit go-ahead. The repository is public, so the npm pages' links resolve.

### 4. Home site and `/demo` (separate chat)

The owner will build the home site with ChatGPT Codex. The guides in `docs/guides/` are plain Markdown, so the site can publish them.

Part of this release and its Gate B, planned in detail in its own chat per [the home site and demo plan](./WEBSITE_AND_DEMO_PLAN.md). Dependencies on this plan: the demo runs the **published** release candidate, and the site's install instructions and links point at the real npm packages and GitHub repository.

### 5. Announcement article (Medium)

A draft written once the release candidate is installable; published only after the packages, repository, site, and demo are live, since every link in it must work.

The story to tell, drawn from the [research](./RESEARCH.md) and [founding document](./FOUNDING.md):

- **The problem:** getting Kafka events to a browser is easy to demo and hard to trust. After a disconnect, a restart, or a slow client, is the screen still right? Existing bridges leave recovery, access control, and backpressure to each team.
- **The idea:** state channels with authoritative snapshots and revisions, so a view is either verifiably current (`live`) or visibly `stale`, never silently wrong. Access is enforced by the application's own handlers, including revocation while a request is pending.
- **What is verified:** acceptance scenarios, real-Kafka failure behavior, and browser and deployment checks, described accurately, with limits stated (single gateway, no durable replay in V1).
- **Try it:** the live demo, `npm` install, and the repository.
- **What's next:** V2 direction (retained history, multiple gateways), labeled as plans.

No competitor disparagement, invented metrics, or claims beyond the implementation status.

## Sequencing

1. **Owner decisions:** license, npm organization, first version, GitHub location, publishing method.
2. **Release chat:** packaging work and the install test, then `LICENSE`, repository hygiene, CI, and the npm-page guides.
3. **GitHub:** the owner creates the repository; push with the owner's go-ahead (public or private per decision 1).
4. **Release candidate:** the owner publishes (or CI publishes) under `next`; verify installation from the registry in a clean project. *Done September 25.*
5. **Site and demo chat:** build on the published release candidate; complete Gate B.
6. **Article:** draft, then review against the implementation status and working links.
7. **Launch:** promote packages to `latest` (or publish the stable version), make the repository public if not already, bring the site and demo live, publish the article, and smoke-test every public link.
