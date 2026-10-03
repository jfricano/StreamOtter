# Changelog

All six packages (`streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli`, and `@streamotter/workbench`) are released together with the same version. `streamotter` first appeared in `0.1.0-rc.3`. Package versions follow [Semantic Versioning](https://semver.org/) and are independent of the V1 protocol (`protocolVersion: 1`) and configuration format (`configVersion: 1`). Before 1.0.0, a minor release may contain breaking API changes; they will be listed here.

## Unreleased

### Added

- `@streamotter/workbench`: a favicon (the StreamOtter brandmark reduced for a browser tab) in place of the blank one.
- Workbench host contract, version 1 ([WHC-1](./docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md)), for running the published workbench under a route of your own site:
  - `@streamotter/workbench` reads an optional `<script type="application/json" id="streamotter-workbench-host">` boot block (API base path, `token` or `session` authentication, gateway, environment label), discovers the offered operations, and shows anything else as "Not available in this environment". Without the block it behaves as before. The package ships `dist/workbench-host.json` (entry files, `sha384` integrity values, required CSP) and exports `@streamotter/workbench/host`, `@streamotter/workbench/dist/*` and `@streamotter/workbench/package.json`.
  - `@streamotter/gateway/management`: `createManagementHandler`, a mountable handler for a development-mode gateway with an operation allowlist and a host `authorize` callback. The development management API gains `GET /management/v1/workbench`.
  - `@streamotter/contracts`: `WorkbenchHostConfig`, `WorkbenchOperation`, `WorkbenchDiscovery`, `WorkbenchHostManifest`, `WORKBENCH_OPERATIONS` and `validateWorkbenchHostConfig`.
  - WHC-1 revision 0.3, for a site whose API is on another origin and whose page keeps its own header, footer and styles: an optional `apiOrigin` boot field (an exact `https:` origin, `session` auth only; requests use CORS with `credentials: "include"` and `redirect: "error"`, and never send `Authorization`), and `isWorkbenchApiOrigin` in `@streamotter/contracts`. `@streamotter/workbench` ships `dist/workbench-host.css`, generated from `styles.css` with every selector scoped under `[data-streamotter-workbench]`, which the workbench sets on its mount when a boot block is present; the manifest names it as `entry.hostStyle` with an integrity value, and `connect-src` gains an `"<api origin>"` placeholder. The native page keeps `styles.css` unchanged.
  - `@streamotter/workbench`: in `session` mode, a `401` or `UNAUTHENTICATED` answer shows a "Session ended" screen with a Reload button and stops all requests, instead of a generic error.
- `@streamotter/workbench`: the top bar shows the environment (`Development` under `streamotter dev`).

### Changed

- Development management API: an unknown route answers 404 before its request body is read (it could previously answer 400 or 413 for a malformed body first).

## [0.1.0-rc.3] — 2026-09-25

### Added

- **`streamotter`**, everything in one install: the `streamotter` command, and the individual packages as subpaths (`streamotter/client` for the browser, `streamotter/gateway` and `streamotter/gateway/management` for Node.js, `streamotter/contracts`, and `streamotter/cli`). There is no bare `streamotter` import, so browser bundles never pull in server code. It contains no code of its own and depends on the individual packages at exactly its own version.
- `@streamotter/cli`: `init` and `generate` write imports from `streamotter/…` when the nearest `package.json` lists `streamotter` and not `@streamotter/client`, and from `@streamotter/…` otherwise. The new `runProcess()` export runs the CLI as a process, and both `streamotter` commands use it.
- The StreamOtter logo on the npm pages and the repository README.

### Changed

- The guides and the root README install `streamotter` and import from its subpaths. The individual packages remain the right choice for a frontend that lives apart from the gateway, and for a gateway-only service.

## [0.1.0-rc.2] — 2026-09-25

Documentation and packaging. The gateway, SDK, CLI, and workbench code is unchanged from `0.1.0-rc.1`.

### Added

- Guides: [getting started](./docs/guides/getting-started.md), [adding live state to an existing app](./docs/guides/existing-app.md), [connecting to Kafka](./docs/guides/kafka.md), and [troubleshooting](./docs/guides/troubleshooting.md). The [production guide](./docs/DEPLOYMENT.md) is rewritten for npm installs, with supervision and restart-after-crash advice.
- `main` and `types` fields in the package manifests, for tools that don't read `exports`.

### Changed

- Package READMEs (the npm pages): install commands without a tag, links to the guides, and a table of the StreamOtter packages.

### Fixed

- Tests only: the Kafka restart-after-crash test could miss its 30-second startup deadline and then hang its suite; it now waits for the crashed member to leave the consumer group, and always cleans up. Topic creation right after the broker starts no longer fails, and every test script exits once its tests finish (`--test-force-exit`).

## [0.1.0-rc.1] — 2026-09-25

First public release candidate of StreamOtter V1, published under the npm `next` tag. Because the packages were new, npm also pointed `latest` at it.

### Added

- **`@streamotter/gateway`**: one Node.js gateway per project. Kafka sources (KafkaJS 2.2.4: explicit per-record commits, poison records pause without skipping, rebalance and outage trigger resynchronization) and deterministic fixture sources. Application-owned `authenticate`, `authorize`, `map`, and `snapshot` handlers. Snapshot synchronization with revision ordering. Bounded per-subscription, per-connection, and gateway-wide delivery budgets. Revocation, including while handlers are pending. Socket.IO 4.8.3 delivery over WebSocket. A development-only management API.
- **`@streamotter/client`**: the browser SDK. Typed subscriptions, explicit connection and subscription states (`live`, `stale`, `resync-required`, …), receipts, reconnection with full jitter, token refresh, and account-switch closure.
- **`@streamotter/cli`**: `init`, `validate`, `generate` (TypeScript channel types), `dev` (gateway, workbench, management API), and `start` (production gateway).
- **`@streamotter/workbench`**: the local workbench served by `streamotter dev` (Connect, Define, Preview, Inspect, Export).
- **`@streamotter/contracts`**: the public types, protocol constants, error vocabulary, and configuration and schema validation shared by the gateway and SDK.

### Verified

Acceptance scenarios, real-Kafka behavior (Apache Kafka 4.1.2), a declared-workload resource test, browser tests (Chromium), a production deployment behind a TLS-terminating proxy, and an install test of the packed packages outside the workspace. See [IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md) for the commands, results, and limitations.

### Known limitations

A single gateway per project, no durable replay or revocation store, no production health endpoint, Chromium-only browser checks, and Kafka verification against one broker version. Details are in the implementation status document.

[0.1.0-rc.3]: https://github.com/jfricano/StreamOtter/releases/tag/v0.1.0-rc.3
[0.1.0-rc.2]: https://github.com/jfricano/StreamOtter/releases/tag/v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/jfricano/StreamOtter/releases/tag/v0.1.0-rc.1
