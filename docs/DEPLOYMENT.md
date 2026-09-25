# Run StreamOtter in production

September 25, 2026 · Applies to the `0.1.0` release candidates

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
- **Startup and shutdown.** Startup waits until every source has joined its consumer group, with a 30-second deadline and rollback; on failure it prints staged source diagnostics and exits 1. `SIGINT` or `SIGTERM` stops it gracefully within 10 seconds: subscriptions are invalidated, handlers aborted, consumers disconnected without committing incomplete records, and sockets closed.

## Deployment boundary

- **Exactly one gateway per project.** V1 has no cross-gateway routing, shared revocation, or consumer coordination. Two gateways sharing a consumer group split the partitions, and each delivers only part of the data. Don't scale horizontally: run one instance with a restart policy. After a restart, clients reconnect and resynchronize from your snapshots.
- **One dedicated consumer group per source.** Never share it with another application.
- **TLS termination.** Browsers use HTTPS/WSS at your reverse proxy or load balancer; the gateway can serve plain HTTP behind it. The proxy must forward WebSocket upgrades on the configured path (default `/streamotter/socket.io`) and pass the browser's `Origin` header unchanged. The transport is WebSocket-only, so Socket.IO needs no sticky sessions, but there is still only one gateway.
- **Kafka connections.** Verified: TLS with a supplied CA, and TLS with SASL PLAIN, SCRAM-SHA-256, or SCRAM-SHA-512 (Apache Kafka 4.1.2). Implemented but not verified: TLS with the system trust store (`"tls": {}`). Other broker versions are unverified. See [Connect to Kafka](./guides/kafka.md).
- **Health.** V1 exposes no health endpoint in production (management is development-only). Use process supervision, and optionally a TCP check on the gateway port. Users see a source outage as `stale` views, and operators see it as log lines.
- **Logs.** Operator diagnostics are single-line records on stdout and stderr, with source IDs and redacted coordinates, and no payloads or credentials. To route them elsewhere, run the gateway programmatically and pass a `logger` to `createGateway`.

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
const gateway = createGateway({ config: defineProject(config), handlers, mode: "production" });
await gateway.start();
// When your authorization policy changes, update it durably first, then:
await gateway.revoke({ kind: "session", tenantId, sessionId });
```

See [Add live state to an existing app: handle access changes](./guides/existing-app.md#7-handle-access-changes).

## Local development

`npx streamotter dev --config streamotter.json --handlers <module> [--management-port 7401]` starts the gateway in development mode. It registers the handler module's `development` export (principals and fixtures), and serves the workbench and management API on `127.0.0.1:7401` behind a per-run token. Management is loopback-only, token-protected, origin-checked, and never started by `start`. Relative CA paths resolve against the configuration file's directory. See [Getting started](./guides/getting-started.md). To work on StreamOtter itself, including its local Kafka broker, see [CONTRIBUTING.md](../CONTRIBUTING.md).
