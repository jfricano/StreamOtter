# @streamotter/cli

The `streamotter` command: scaffold a project, validate its configuration, generate TypeScript channel types, run a development gateway with the local workbench, and start the production gateway.

> **Release candidate.** `0.1.0-rc.1` is published under the `next` tag. Package versions follow SemVer independently of the V1 protocol and `configVersion: 1`.

```bash
npm install @streamotter/cli@next
```

Requires Node.js 24 or later. It installs [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) and the workbench assets. Install it as a regular dependency, because `streamotter start` runs in production.

## From zero to a live channel

```bash
mkdir live-jobs && cd live-jobs
npm init -y
npm install @streamotter/cli@next @streamotter/client@next
npx streamotter init .
```

`init` creates a fixture-backed project that needs no Kafka broker. It refuses to overwrite existing files.

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

## Go to production

1. Implement `authenticate` with your real session verification, and read snapshots from your authoritative store.
2. Replace the fixture source with a Kafka source over TLS (optionally with SASL); see the [gateway guide](https://www.npmjs.com/package/@streamotter/gateway).
3. Compile your handlers to JavaScript (the CLI loads compiled modules only and refuses `.ts` files).
4. Run exactly one gateway per project:

```bash
NODE_ENV=production npx streamotter start --config streamotter.json --handlers dist/handlers.js
```

`start` serves delivery only. There is no management API, workbench, preview token, or fixture control, and the handler module's `development` export is ignored. It refuses:

- fixture sources and plaintext Kafka (`"tls": false`), with exit code 2;
- missing secret environment variables or unreadable CA files, without printing their values;
- browser connections whose `Origin` is missing or not listed in `gateway.allowedOrigins` (no wildcards).

Startup waits until every source has joined its consumer group (30-second deadline). If a source fails, `start` prints staged diagnostics and exits.

## Commands and exit codes

| Command | |
| --- | --- |
| `streamotter init <directory>` | Scaffold a fixture-only project |
| `streamotter validate --config <path>` | Validate; print the fingerprint |
| `streamotter generate --config <path> --out <directory>` | Generate TypeScript channel types |
| `streamotter dev --config <path> --handlers <module> [--management-port <port>]` | Development gateway, workbench, and management API |
| `streamotter start --config <path> --handlers <module>` | Production gateway |

Exit codes: `0` success, `2` invalid input or configuration, `1` startup or runtime failure. `SIGINT` and `SIGTERM` shut down gracefully (10-second deadline) and exit 0.

## More

- [Running StreamOtter](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md): local development, the production boundary, and a verified reverse-proxy recipe
- [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md): configuration (§2), management and workbench (§10), CLI (§11)
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues)

MIT License © 2026 Orca Solutions
