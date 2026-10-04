<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-logo.png" alt="StreamOtter" width="300"></p>

# @streamotter/cli

The `streamotter` command: scaffold a project, validate its configuration, generate TypeScript channel types, run a development gateway with the local workbench, and start the production gateway.

> **Release candidate** of StreamOtter `0.1.0`; the API may still change before `0.1.0`. Package versions follow SemVer independently of the V1 protocol and `configVersion: 1`.

```bash
npm install @streamotter/cli
```

The all-in-one [`streamotter`](https://www.npmjs.com/package/streamotter) package includes this CLI and the same `streamotter` command. `init` and `generate` write imports from `streamotter/…` when your `package.json` lists `streamotter`, and from `@streamotter/…` otherwise.

Requires Node.js 24 or later; the V1.1 failure journal (`--state-dir`) needs Node.js 24.15 or later. It installs [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) and the workbench assets. Install it as a regular dependency, because `streamotter start` runs in production.

The CLI provides tooling and launches the gateway; data delivery happens in the gateway it launches. Frontend applications use the browser SDK for subscriptions and recovery. The local Workbench provides configuration, preview, and inspection during development and is not required for production subscriptions. See [runtime and package requirements](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md#runtime-and-package-requirements).

## From zero to a live channel

```bash
mkdir live-jobs && cd live-jobs
npm init -y
npm install @streamotter/cli @streamotter/client
npx streamotter init .
```

`init` creates a fixture-backed project that needs no Kafka broker. It refuses to overwrite existing files, and if a write fails partway through (permissions, a full disk) it removes the files and directories it created and exits 2.

| File | Purpose |
| --- | --- |
| `streamotter.json` | The portable configuration: a `jobs` fixture source, schemas, and a `jobProgress` channel |
| `server/handlers.mjs` | Your trusted handlers (`authenticate`, `authorize`, `map`, `snapshot`), plus a `development` export with a `developer` principal and fixture records |
| `web/example.ts` | A browser subscription with cleanup and error handling |
| `README.md` | These steps, for your team |

```bash
npx streamotter validate --config streamotter.json
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs
```

`validate` checks structure, schemas, and references (no network, no handlers) and prints the configuration's SHA-256 fingerprint. `dev` starts the gateway in development mode and prints its addresses and a one-time management token:

```text
StreamOtter development gateway
  Gateway      http://127.0.0.1:7400  (Socket.IO path /streamotter/socket.io)
  Workbench    http://127.0.0.1:7401/
  Management   http://127.0.0.1:7401/management/v1  (local only)
  Token        <per-run token>
  …
```

## The workbench

Open the workbench URL and paste the token. The page keeps it in memory only, so you paste it again after a reload.

- **Connect**: source status and staged connection checks (resolve → connect → TLS → authenticate → metadata). Advance fixture records here.
- **Define**: the channel contracts, and a candidate configuration editor with validation. Edits are candidates only: they change nothing until you export them and restart `dev`.
- **Preview**: subscribe as a development principal (`developer`) with the real SDK. Try `jobProgress` with `{"jobId": "job_1"}`, advance the `jobs` fixture, and watch revisions arrive. You can force a disconnect to see `stale` → fresh snapshot → `live`.
- **Inspect**: the payload-free trace of each record through validate, map, queue, send, receipt, and commit.
- **Export**: the canonical `streamotter.json` and its fingerprint. `streamotter validate` prints the same fingerprint.

The management API and workbench listen on loopback only (`--management-port`, default 7401), require the token, and check the browser origin. `streamotter start` never starts them.

## Integrate

```bash
npx streamotter generate --config streamotter.json --out generated
```

This writes `generated/streamotter.generated.ts` (`AppChannels`, the parameter and payload types, and `channelVersions`) and `generated/streamotter.client.example.ts`. The generator overwrites only files that carry its own marker. Use the types with [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) in the browser and with `HandlerRegistry<AppChannels>` on the server. Numeric ranges and string lengths are still checked at runtime.

To see a real page update live, [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md) continues from here: it adds a development-only token to `authenticate` and serves `web/example.ts` with Vite.

## Go to production

1. Implement `authenticate` with your real session verification, and read snapshots from your authoritative store.
2. Replace the fixture source with a Kafka source over TLS (optionally with SASL); see [Connect to Kafka](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md).
3. Compile your handlers to JavaScript (the CLI loads compiled modules only and refuses `.ts` files).
4. Run exactly one gateway per project:

```bash
NODE_ENV=production npx streamotter start --config streamotter.json --handlers dist/handlers.js
```

`start` serves delivery only. There is no management API, workbench, preview token, or fixture control, and the handler module's `development` export is ignored. It refuses:

- fixture sources and plaintext Kafka (`"tls": false`), with exit code 2;
- missing secret environment variables or unreadable CA files, without printing their values;
- browser connections whose `Origin` is missing or not listed in `gateway.allowedOrigins` (no wildcards).

Startup waits until every source has joined its consumer group (30-second deadline). If a source fails, `start` prints staged diagnostics and exits. `--health 127.0.0.1:7402` adds read-only liveness and readiness probes on their own port (new in 0.2.0-rc.1; see [health checks](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md#health-checks)). Supervision, restarts after a crash, and the reverse-proxy recipe are in [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md).

## Operate a running gateway

With failure handling configured, a gateway started with `--state-dir <dir> --operator-socket` serves the operator API on a local Unix-domain socket, `<dir>/run/operator.sock`. Each start writes a fresh token to `<dir>/run/operator.token` (mode 0600); a token from an earlier start stops working. The operator commands read the token from there, never from the command line, and refuse to read it if the file or `run/` is a symlink, is accessible to other users, or is owned by someone else. Anyone who can read the state directory is an operator, so keep it owned by the gateway's user with mode 0700.

```bash
npx streamotter status --state-dir /var/lib/streamotter
npx streamotter failures list --state-dir /var/lib/streamotter --state open
npx streamotter failures show --state-dir /var/lib/streamotter --failure <failureId>
npx streamotter sources retry-current --state-dir /var/lib/streamotter --source orders --failure <failureId> --expected-revision 3
```

Every mutation names the incident (or circuit, or boundary) and the revision it expects, so a command based on stale information is refused rather than applied. There is no `--force`, no wildcard, and no bulk form.

- `failures show` never prints the original record bytes unless you pass `--raw`, and then only as base64 and a hex preview, never as text a terminal could interpret.
- `failures export` writes a versioned reproduction bundle. With `--out <file>` it creates the file with mode 0600 and refuses to overwrite an existing one; without `--out` it prints the bundle. Raw bytes are included only with `--include-raw`.
- `failures evaluate` runs the stored record through the current handlers without delivering anything and, when a redrive is possible, prints a plan that expires after five minutes. `failures redrive` takes that plan's ID and fingerprint.
- `sources retire-boundary` is the unsafe option. Retiring a boundary tells the gateway that every future snapshot already reflects the quarantined record, and StreamOtter can't check that. If the claim is wrong, subscribers can reach `live` while showing state that's missing the change the quarantined record carried, and nothing downstream will flag it. The command prints this warning and does nothing unless `--confirm` repeats the boundary ID.

`--json` prints the gateway's answer verbatim (the data, or the operation result) for scripts. Every error, usage errors included, goes to stderr as one line `{"error": StreamError}`, stdout stays empty, and the exit code is the same as without `--json`.

Setting up failure handling (`init --failures`, the quarantine topic, policies, recovery guards) and what to do in each kind of incident are in the [source-failure runbook](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md). Failure handling is new in 0.2.0-rc.1 (the V1.1 milestone).

## Commands and exit codes

| Command | |
| --- | --- |
| `streamotter init <directory>` | Scaffold a fixture-only project |
| `streamotter validate --config <path>` | Validate; print the fingerprint |
| `streamotter generate --config <path> --out <directory>` | Generate TypeScript channel types |
| `streamotter init --failures --config <path> --state-dir <directory>` | Create the failure journal for an existing project; refuses an existing journal, or a leftover `journal.sqlite-wal` or `-shm` |
| `streamotter dev --config <path> --handlers <module> [--management-port <port>] [--state-dir <directory>] [--operator-socket]` | Development gateway, workbench, and management API |
| `streamotter start --config <path> --handlers <module> [--state-dir <directory>] [--operator-socket] [--handler-build-id <id>] [--health <host:port>]` | Production gateway; `--operator-socket` requires `--state-dir`. `--health` takes `host:port`, `[ipv6]:port` or a bare port (127.0.0.1) |
| `streamotter status --state-dir <dir> [--json]` | Gateway, journal, quarantine and per-source failure status |
| `streamotter failures list --state-dir <dir> [--source <id>] [--state open\|resolved\|all] [--limit <n>] [--cursor <c>]` | List incidents, oldest first; open ones unless `--state` says otherwise |
| `streamotter failures show --state-dir <dir> --failure <id> [--raw]` | One incident with its explanation and history |
| `streamotter failures export --state-dir <dir> --failure <id> [--include-raw] [--out <file>]` | Reproduction bundle |
| `streamotter failures evaluate --state-dir <dir> --failure <id> --expected-revision <n>` | Dry-run the stored record; issue a redrive plan |
| `streamotter failures redrive --state-dir <dir> --failure <id> --plan <planId> --plan-fingerprint <fp> --expected-revision <n> [--operation-id <id>]` | Run an evaluated plan |
| `streamotter sources retry-current --state-dir <dir> --source <id> --failure <id> --expected-revision <n> [--reason <text>]` | Retry the held record |
| `streamotter sources reassess --state-dir <dir> --source <id> --failure <id> --expected-revision <n>` | Re-run the recovery guard for a held, eligible incident; never overrides an integrity failure |
| `streamotter sources reopen-circuit --state-dir <dir> --source <id> --expected-circuit-revision <n> --reason <text>` | Reset a stopped automatic-continuation circuit after repair; approves no record |
| `streamotter sources retire-boundary --state-dir <dir> --source <id> --boundary <id> --expected-revision <n> --reason <text> --confirm <boundaryId>` | Retire a recovery boundary (unsafe; see above) |
| `streamotter sources rebaseline --config <path> --state-dir <dir> --source <id> --reason <text> --confirm <sourceId>` | With the gateway stopped, after a deliberate `generation` change: close the source's incidents from earlier generations, in one journal transaction |

Every operator command accepts `--json`.

Exit codes: `0` success, `2` invalid input, configuration or request, `1` startup or runtime failure (including a gateway that isn't running and an operation that `failed`), `3` the operation was refused, `4` its outcome is unknown (including a `retry-current`, `reassess`, `reopen-circuit`, `retire-boundary` or `redrive` whose answer was lost or timed out; a read command that loses its answer exits 1). `SIGINT` and `SIGTERM` shut down gracefully (10-second deadline) and exit 0.

## Documentation

- [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md): this walkthrough, continued to a live web page
- [Add live state to an existing app](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md)
- [Connect to Kafka](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md) and [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md)
- [Troubleshooting](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/troubleshooting.md): every CLI refusal and what to do about it
- [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md): configuration (§2), management and the workbench (§10), and the CLI (§11)
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · [Security policy](https://github.com/jfricano/StreamOtter/blob/main/SECURITY.md)

## StreamOtter packages

| Package | |
| --- | --- |
| [`streamotter`](https://www.npmjs.com/package/streamotter) | Everything below in one install, with the `streamotter` command |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | **This package.** Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | The local workbench's assets, installed by the CLI |

All six are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

MIT License © 2026 Orca Solutions
