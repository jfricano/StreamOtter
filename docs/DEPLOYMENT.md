# Run StreamOtter in production

September 25, 2026, updated October 2026 · Applies to the `0.1.0` release candidates; the [health checks](#health-checks) and [source-failure handling](#source-failure-handling-v11) sections describe unreleased V1.1 features

In production, StreamOtter is one gateway process (`streamotter start`), behind the reverse proxy that serves your application, consuming Kafka over TLS. This guide covers installing, starting, supervising, and proxying it, and what it doesn't do. For development, see [Getting started](./guides/getting-started.md).

## Install and build

Add StreamOtter as a regular dependency, because `start` runs in production:

```bash
npm install streamotter
```

A service that runs only the gateway can install [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) instead; it provides the same `streamotter` command.

Compile your handlers in your build step (the CLI loads compiled JavaScript only). Where the gateway runs, install only the locked production dependencies:

```bash
npm ci --omit=dev
```

A script in your `package.json` keeps the command in one place:

```json
{ "scripts": { "gateway": "streamotter start --config streamotter.json --handlers dist/streamotter/handlers.js" } }
```

## Start

```bash
NODE_ENV=production npm run gateway
```

`start` runs the gateway in production mode:

- **No management or development surface.** There is no management listener, workbench, preview token, or fixture control, and the handler module's `development` export is ignored.
- **Configuration refusals.** Fixture sources and plaintext Kafka (`"tls": false`) fail at startup with exit code 2. Missing secret environment variables or unreadable CA files fail startup without printing values.
- **Browsers only.** Every Socket.IO handshake must carry an `Origin` that exactly matches `gateway.allowedOrigins` (no wildcards).
- **Startup and shutdown.** Startup waits until every source has joined its consumer group, with a 30-second deadline and rollback; on failure it prints staged source diagnostics and exits 1. With failure handling, startup also opens the journal and checks the quarantine topic first, and refuses (exit 2 for configuration problems, 1 otherwise) when either is missing or unsafe; see [Source-failure handling](#source-failure-handling-v11). `SIGINT` or `SIGTERM` stops it gracefully within 10 seconds: subscriptions are invalidated, handlers aborted, consumers disconnected without committing incomplete records, and sockets closed.

## Deployment boundary

- **Exactly one gateway per project.** V1 has no cross-gateway routing, shared revocation, or consumer coordination. Two gateways sharing a consumer group split the partitions, and each delivers only part of the data. Don't scale horizontally: run one instance with a restart policy. After a restart, clients reconnect and resynchronize from your snapshots.
- **One dedicated consumer group per source.** Never share it with another application.
- **TLS termination.** Browsers use HTTPS/WSS at your reverse proxy or load balancer; the gateway can serve plain HTTP behind it. The proxy must forward WebSocket upgrades on the configured path (default `/streamotter/socket.io`) and pass the browser's `Origin` header unchanged. The transport is WebSocket-only, so Socket.IO needs no sticky sessions, but there is still only one gateway.
- **Kafka connections.** Verified: TLS with a supplied CA, and TLS with SASL PLAIN, SCRAM-SHA-256, or SCRAM-SHA-512 (Apache Kafka 4.1.2). Implemented but not verified: TLS with the system trust store (`"tls": {}`). Other broker versions are unverified. See [Connect to Kafka](./guides/kafka.md).
- **Health.** Without `--health`, there is no health endpoint in production (management is development-only); use process supervision, and optionally a TCP check on the gateway port. V1.1 adds an opt-in, read-only health listener on its own loopback port; see [Health checks](#health-checks). Users see a source outage as `stale` views, and operators see it as log lines and readiness reasons.
- **Logs.** Operator diagnostics are single-line records on stdout and stderr, with source IDs and redacted coordinates, and no payloads or credentials. To route them elsewhere, run the gateway programmatically and pass a `logger` to `createGateway`.

## Health checks

V1.1 adds an optional, read-only health listener, separate from the gateway's port and from the development management server. Turn it on with `--health`:

```bash
streamotter start --config streamotter.json --handlers dist/streamotter/handlers.js --health 127.0.0.1:7402
```

`--health` accepts `host:port`, `[ipv6]:port`, or a bare port, which binds 127.0.0.1. From code, pass `health: { port: 7402 }` to `createGateway` (`host` defaults to `127.0.0.1`; port 0 picks a free one). It works in development and production, with or without failure handling. `streamotter dev` has no `--health`; it already serves `GET /management/v1/health`.

| Request | Answer |
| --- | --- |
| `GET /health/live` | 200 `{"status":"ok","reasons":[]}` whenever the listener answers, including during a broker outage |
| `GET /health/ready` | 200 `{"status":"ok","reasons":[]}` when ready; otherwise 503 `{"status":"unavailable","reasons":[…]}` |
| Anything else (other paths, a query string, a trailing slash, other methods) | 404 with no body. `HEAD` of the two paths is also answered. |

Readiness reasons are categories only, in this order, each at most once:

| Reason | Means |
| --- | --- |
| `starting` | `start()` has not finished. The listener opens first, so it reports this throughout startup. |
| `source-held` | A source is paused at a record: a V1 pause or a held incident |
| `source-unavailable` | A source is starting, degraded or stopped while the gateway runs, for example during a broker outage |
| `journal` | The last failure-journal write failed, or the journal is at its size limit |
| `quarantine` | An open incident's quarantine write failed, or its outcome is unknown |

What to do about each is in the [source-failure runbook](./guides/source-failures.md#6-incident-procedures).

- **Use liveness for restarts and readiness for alerts and routing.** Liveness doesn't turn false for a broker outage, so a supervisor won't restart-loop the gateway because Kafka is down. Readiness is not a freshness certificate: each view's `live` state is.
- **Keep it private.** Bind it to loopback or a private interface, and never route it through the public reverse proxy. Responses carry `Cache-Control: no-store` and no CORS headers, and never contain topic names, incident IDs or messages.
- A health port already in use fails startup ("Health port 127.0.0.1:7402 is already in use."). On `SIGTERM`, the listener closes first, so readiness stops answering before sessions close.

## Source-failure handling (V1.1)

With a `failureHandling` section in `streamotter.json`, the gateway records every unprocessable record in a durable journal and can copy it to a quarantine topic. A configuration without that section needs none of this section. Setup, policies and incident procedures are in the [source-failure runbook](./guides/source-failures.md); this section covers what changes on the host.

### The state directory

`--state-dir <dir>` (`stateDirectory`) holds the journal. It is required in production when any source uses a quarantine policy.

```bash
sudo install -d -o streamotter -g streamotter -m 0700 /var/lib/streamotter
sudo -u streamotter npx streamotter init --failures --config streamotter.json --state-dir /var/lib/streamotter/shop
```

| Path | Created by | Rule the gateway enforces |
| --- | --- | --- |
| `<dir>` | `init --failures` (0700) | Exists; not a symlink; owned by the gateway's user; not group- or world-writable |
| `<dir>/journal.sqlite` (plus `journal.sqlite-wal` while open) | `init --failures` (0600) | Exists (never created by `start`); not a symlink; owned by the gateway's user; not group- or world-writable |
| `<dir>/journal.lock` | `start` | Names the owning process; a second gateway is refused. A lock left by a dead process on the same host is replaced, including one naming the new gateway's own pid (a container restarted in place often reuses pid 1), once SQLite confirms nothing else holds the journal open |
| `<dir>/run/` | `init --failures` (0700) | With `--operator-socket`: no group or world access at all, not a symlink, owned by the gateway's user |
| `<dir>/run/operator.sock`, `<dir>/run/operator.token` | `start --operator-socket` (0600 each) | Fresh token on every start; both removed on stop |

- **Persistent storage.** Put the directory on a persistent local volume. In a container, mount a volume there; a container's writable layer loses the journal on replacement, and the gateway then refuses to start until you [recover](./guides/source-failures.md#68-lost-or-damaged-local-state).
- **Node.js 24.15 or later.** The journal uses the built-in `node:sqlite`, which warns as experimental on earlier Node 24 releases, so the gateway refuses to open it there.
- **Leftover WAL files.** `init --failures` refuses (`journal-exists`) while a `journal.sqlite-wal` or `journal.sqlite-shm` is in the directory, because it can hold an earlier journal's last commits. Never delete them; move all the journal files aside together.
- **Backups.** Copy `journal.sqlite` and any `journal.sqlite-wal` with the gateway stopped. Skip `run/` and `journal.lock`. Protect backups like the source data: the journal holds incident metadata, and fixture evidence in development.
- **Keep it out of version control**, and out of anything you bundle or ship.
- **Disk.** The journal stops at 256 MiB and then refuses writes, keeping the source held; it never evicts decision state. Leave room on the volume.
- **Removing failure handling later.** With `--state-dir` still pointing at the journal, startup refuses a configuration without `failureHandling` while any source has an open incident or a recovery boundary in force (`failure-handling-removed`). Settle them first; see [upgrade and downgrade](./guides/source-failures.md#8-upgrade-and-downgrade).

### The operator socket

`--operator-socket` (`operatorSocket: true`) serves the operator API on `<dir>/run/operator.sock` for the `streamotter status`, `failures` and `sources` commands. It requires `--state-dir` and `failureHandling`. It starts after every source is ready. On stop it closes before the sources do: it stops accepting requests, answers those already running for up to 5 seconds (within the 10-second stop deadline), then removes the socket and token. A mutation whose answer is lost this way exits 4 in the CLI, unknown outcome.

The boundary is filesystem permissions plus the token file: Node can't check the caller's user ID, so **anyone who can read the state directory is an operator**. Run the operator commands as the gateway's user on the same host (for example `sudo -u streamotter npx streamotter status --state-dir /var/lib/streamotter/shop`). Never expose the socket through a proxy or a shared volume. Startup refuses an insecure `run/` directory, a socket path over 103 bytes, a path occupied by something other than a socket, and a socket another gateway is answering on. Windows is not supported.

### Kafka

Provision the quarantine topic yourself, with `max.message.bytes` of at least `limits.maxSourceRecordBytes` plus 80 KiB, and grant the gateway's principal the extra ACLs. See [Connect to Kafka: the quarantine topic](./guides/kafka.md#the-quarantine-topic-v11).

### Example systemd unit with failure handling

The unit below adds the V1.1 flags to the earlier example. It is an example only; the test suite doesn't run the gateway under systemd.

```ini
[Service]
User=streamotter
Group=streamotter
WorkingDirectory=/srv/shop
Environment=NODE_ENV=production
EnvironmentFile=/etc/shop/streamotter.env
# Created once with: sudo -u streamotter npx streamotter init --failures --config streamotter.json --state-dir /var/lib/streamotter/shop
ExecStart=/usr/bin/node node_modules/.bin/streamotter start --config streamotter.json --handlers dist/streamotter/handlers.js \
  --state-dir /var/lib/streamotter/shop --handler-build-id ${BUILD_ID} --operator-socket --health 127.0.0.1:7402
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
UMask=0077
```

`BUILD_ID` comes from the environment file, for example a commit SHA. Use a fixed path for `--state-dir`; never point it at a directory other users can write.

## Keep it running

Run exactly one instance under a supervisor (systemd, a container orchestrator with one replica, or a process manager) that:

- sends `SIGTERM` to stop it, and allows more than 10 seconds before killing it;
- restarts it when it exits, **after a short delay**. After a crash (not a graceful stop), Kafka keeps the dead instance in the consumer group until its 30-second session expires. A replacement started immediately can hit its own 30-second startup deadline and exit 1 once; the next start succeeds. See [restarts and crashes](./guides/kafka.md#restarts-and-crashes).

An example systemd unit. It is an example only: the test suite runs `streamotter start` directly, not under systemd.

```ini
[Unit]
Description=StreamOtter gateway
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/srv/shop
Environment=NODE_ENV=production
# KAFKA_USERNAME and KAFKA_PASSWORD, referenced from streamotter.json
EnvironmentFile=/etc/shop/streamotter.env
ExecStart=/usr/bin/node node_modules/.bin/streamotter start --config streamotter.json --handlers dist/streamotter/handlers.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

## Behind a reverse proxy

### Verified recipe: one origin behind Caddy

`pnpm test:deploy` exercises this setup: Caddy 2.11.4, the compiled `streamotter start`, and Kafka over TLS with SCRAM-SHA-512. The application and the gateway share one HTTPS origin, so the SDK's default `origin` (the page's origin) works, and `allowedOrigins` is that single origin.

```caddyfile
https://app.example.com {
	handle /streamotter/* {
		reverse_proxy 127.0.0.1:7400   # streamotter start (gateway.host 127.0.0.1)
	}
	handle {
		reverse_proxy 127.0.0.1:3000   # your application
	}
}
```

```json
"gateway": { "host": "127.0.0.1", "port": 7400, "path": "/streamotter/socket.io", "allowedOrigins": ["https://app.example.com"] }
```

Bind the gateway to loopback (or a private interface) so browsers reach it only through the proxy. Caddy forwards WebSocket upgrades and the `Origin` header without extra configuration. The test also covers a graceful restart (`SIGTERM`, then start again): open views show *stale* and resynchronize from snapshots once the new gateway has joined its consumer group.

### nginx (not exercised)

For nginx, forward the upgrade headers on the socket path, and keep the read timeout above Socket.IO's 25-second ping interval. This block follows nginx's standard WebSocket proxying; the test suite doesn't exercise it:

```nginx
location /streamotter/ {
    proxy_pass http://127.0.0.1:7400;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
}
```

nginx passes the browser's `Origin` header through by default; don't overwrite it.

## Resource limits

All budgets in `limits` ([V1 specification §6](./V1_API.md#proposed-default-limits)) are enforced per subscription, per connection, and for the whole gateway. The defaults are starting bounds, not capacity claims; the one measured workload is recorded in the [implementation status](./IMPLEMENTATION_STATUS.md#declared-workload-testsloadloadtestts). Node.js memory also holds runtime objects, sockets, KafkaJS fetch buffers, and a trace buffer bounded by `maxTraceEntries` and `maxTraceBytes` (8 MiB by default).

## Programmatic use

To revoke access from your own code, or to route logs, run the gateway inside your own Node.js process instead of `streamotter start`:

```ts
import { createGateway, defineProject } from "streamotter/gateway"; // or "@streamotter/gateway"
const gateway = createGateway({
  config: defineProject(config), handlers, mode: "production",
  // Optional, V1.1: the failure journal, a build ID for incidents, the operator socket, and health probes.
  stateDirectory: "/var/lib/streamotter/shop", handlerBuildId: process.env.BUILD_ID, operatorSocket: true, health: { port: 7402 }
});
await gateway.start();
// When your authorization policy changes, update it durably first, then:
await gateway.revoke({ kind: "session", tenantId, sessionId });
```

See [Add live state to an existing app: handle access changes](./guides/existing-app.md#7-handle-access-changes). With failure handling, `getGatewayOperator(gateway)` from `streamotter/gateway/operator` gives the same operations as the CLI, in-process; see the [runbook](./guides/source-failures.md#5-operate).

## Local development

`npx streamotter dev --config streamotter.json --handlers <module> [--management-port 7401]` starts the gateway in development mode. It registers the handler module's `development` export (principals and fixtures), and serves the workbench and management API on `127.0.0.1:7401` behind a per-run token. Management is loopback-only, token-protected, origin-checked, and never started by `start`. Relative CA paths resolve against the configuration file's directory. See [Getting started](./guides/getting-started.md). To work on StreamOtter itself, including its local Kafka broker, see [CONTRIBUTING.md](../CONTRIBUTING.md).
