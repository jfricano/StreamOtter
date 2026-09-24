# StreamOtter first public release plan

September 24, 2026 · Planning; nothing published yet

## Goal

Make StreamOtter V1 publicly usable and discoverable: installable npm packages, public source on GitHub, practical guides, the home site with the integrated `/demo`, and an announcement article. V1 itself is complete and has passed Gate A ([implementation status](./IMPLEMENTATION_STATUS.md)). This plan covers releasing it; it adds no runtime features.

Every public claim must match verified behavior: no invented adoption, performance, or capacity numbers, and nothing presented as shipped before it is ([founding document](./FOUNDING.md), [home site and demo plan](./WEBSITE_AND_DEMO_PLAN.md)).

## Where things stand

| Item | State |
| --- | --- |
| Packages | `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli`, `@streamotter/workbench` build to `dist/` with types and conditional exports. **Never tested as installed packages**: all tests used workspace links. |
| npm names | On September 24, 2026 none of the five names nor plain `streamotter` was published, and the registry reported no `streamotter` organization. Only creating the organization confirms availability. |
| License | **None.** No LICENSE file or `license` fields; this blocks publishing. |
| Source control | Local git repository, branch `main`, no remote. |
| Version fields | Every package is `0.1.0`; nothing is tagged. |
| Site and demo | Planned in the home site and demo plan; not started. |
| Guides and article | Not started. The README, [deployment guide](./DEPLOYMENT.md), and the [example README](../examples/order-dashboard/README.md) are the starting material. |

## Decisions for the owner

| Decision | Options and notes |
| --- | --- |
| License | MIT (simplest, most common for JavaScript libraries) or Apache-2.0 (explicit patent grant). Applies to every package and the repository. |
| npm organization | Create the `streamotter` organization on npmjs.com; the owner holds credentials and 2FA. Claude never handles npm tokens or logins. |
| First version | `0.1.0-rc.1` (signals pre-1.0 API) or `1.0.0-rc.1` (aligns the package with "V1"). Package SemVer is independent of product milestones and `protocolVersion` per the roadmap. |
| Which packages are public | All five, or fold the workbench's static assets into `@streamotter/cli` so there are four. |
| GitHub location | Personal account or an organization (for example `streamotter/streamotter`); public now or at launch. |
| Publishing method | Manual `pnpm publish` by the owner, or GitHub Actions with an npm automation token the owner creates and npm provenance. |
| Launch owner and date | Who approves "go", and when. |

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

Publish the release candidate under the `next` dist-tag first; promote to `latest` at launch.

### 2. Practical guides for the npm pages

Each package page is its README, so each gets a short, runnable guide with links to the full docs:

| Package | Guide |
| --- | --- |
| `@streamotter/client` | Subscribe, render states (`live` versus `stale`), clean up, handle errors; React hook pattern. |
| `@streamotter/gateway` | Handlers (`authenticate`, `authorize`, `map`, `snapshot`), the snapshot/revision contract, `createGateway`, revocation. |
| `@streamotter/cli` | `init` → `dev` → workbench → `generate` → `start`; exit codes; production refusals. |
| `@streamotter/contracts` | Types and config validation for tooling authors; most users do not install it directly. |
| `@streamotter/workbench` | One paragraph: it is served by `streamotter dev`. |

Longer guides — adding live state to an existing app, Kafka and TLS/SASL setup, and deployment behind a proxy — come from the existing docs. They should live where the site can also publish them; coordinate with workstream 4.

### 3. GitHub repository

Preparation (no remote needed):

- `LICENSE` (once chosen), `SECURITY.md` (how to report vulnerabilities), `CONTRIBUTING.md` (setup, `.local/` tools, test tiers), and a `CODE_OF_CONDUCT.md` if desired.
- CI workflow (GitHub Actions):
  - Every push: install with the frozen lockfile, build, `check:contracts`, `typecheck`, `test`, `test:load`, and the install test.
  - Nightly or on demand: `test:browser`, and Kafka and deploy jobs (Linux runners need the setup scripts extended beyond macOS, or a Kafka service container).
- Final review before the first push: no secrets, certificates, or `.local/` content in the tree or history.

The owner creates the repository and adds the remote; pushing publishes code and is done only with the owner's explicit go-ahead. Decide whether the repository goes public before or at launch. npm package pages link to it, so it must be reachable by the time `latest` is published.

### 4. Home site and `/demo` (separate chat)

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
4. **Release candidate:** the owner publishes (or CI publishes) under `next`; verify installation from the registry in a clean project.
5. **Site and demo chat:** build on the published release candidate; complete Gate B.
6. **Article:** draft, then review against the implementation status and working links.
7. **Launch:** promote packages to `latest` (or publish the stable version), make the repository public if not already, bring the site and demo live, publish the article, and smoke-test every public link.
