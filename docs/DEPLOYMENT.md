# Running StreamOtter V1

September 24, 2026 · Applies to the V1 release candidate in this repository

## Local development

```bash
pnpm install --frozen-lockfile
pnpm build
streamotter dev --config streamotter.json --handlers path/to/handlers.js [--management-port 7401]
```

`dev` starts the gateway in development mode, registers the handler module's `development`
export (principals and fixtures), and serves the workbench and management API on
`127.0.0.1:7401`. It prints a per-run management token. Management is loopback-only,
token-protected, origin-checked, and never started by `start`.

Handler modules are compiled JavaScript that export `handlers` (and optionally
`development`). TypeScript handlers must be compiled first; the CLI refuses `.ts` files.
Relative CA paths in the configuration resolve against the configuration file's directory.

For real Kafka locally, `pnpm kafka:setup` downloads a checksum-verified JDK 21 and Apache
Kafka 4.1.2 into `.local/`, and `pnpm kafka:start` runs a single KRaft broker with
plaintext (`:19092`), TLS (`:19093`), and SASL_SSL (`:19094`) listeners and a throwaway CA
in `.local/kafka-certs/`. `pnpm kafka:stop` stops it; delete `.local/` to remove everything.

## Production: one gateway

```bash
NODE_ENV=production streamotter start --config streamotter.json --handlers dist/handlers.js
```

`start` runs the gateway in production mode:

- **No management or development surface.** No management listener, no workbench, no
  preview tokens, no fixture advancement. The handler module's `development` export is ignored.
- **Configuration refusals.** Fixture sources and plaintext Kafka (`tls: false`) fail at
  startup with exit code 2. Missing secret environment variables or unreadable CA files fail
  startup without printing values.
- **Browsers only.** Every Socket.IO handshake must carry an `Origin` that exactly matches
  `gateway.allowedOrigins` (no wildcards).
- **Startup and shutdown.** Startup waits until every source has joined its consumer group,
  with a 30-second deadline and rollback; on failure it prints staged source diagnostics and
  exits 1. `SIGINT`/`SIGTERM` stop gracefully (10-second deadline): subscriptions are
  invalidated, handlers aborted, consumers disconnected without committing incomplete records,
  and sockets closed.

### Deployment boundary

- **Exactly one gateway per project.** V1 has no cross-gateway routing, shared revocation, or
  consumer coordination. Two gateways sharing a consumer group split partitions and each
  delivers only part of the data. Do not scale horizontally; run one instance with a restart
  policy. After a restart, clients reconnect and resynchronize from your snapshots.
- **One dedicated consumer group per source.** Never share it with another application.
- **TLS termination.** Browsers use HTTPS/WSS at your reverse proxy or load balancer; the
  gateway can serve plain HTTP behind it. The proxy must forward WebSocket upgrades on the
  configured path (default `/streamotter/socket.io`). The transport is WebSocket-only, so sticky
  sessions are not required for Socket.IO's sake — but there is still only one gateway.
- **Kafka connections.** Verified: TLS with a supplied CA; TLS + SASL PLAIN, SCRAM-SHA-256,
  SCRAM-SHA-512 (Apache Kafka 4.1.2). Implemented but not verified here: TLS with the system
  trust store (`tls: {}`). Other broker versions are unverified.
- **Health.** V1 exposes no health endpoint in production (management is development-only).
  Use process supervision, and optionally a TCP check on the gateway port. Source outages
  appear to users as `stale` views and to operators as log lines.
- **Logs.** Operator diagnostics are single-line JSON-ish records on stdout/stderr with source
  IDs and redacted coordinates; no payloads or credentials. Supply `logger` to `createGateway`
  to route them elsewhere.

### Resource limits

All budgets in `limits` (V1 specification §6) are enforced per subscription, connection, and
gateway. Defaults are starting bounds, not capacity claims. The one measured workload is
recorded in the implementation status document. Node.js memory also includes runtime
objects, sockets, KafkaJS fetch buffers (configure broker fetch sizes separately), and a
trace buffer bounded by `maxTraceEntries`/`maxTraceBytes` (default 8 MiB).

### Programmatic use

```ts
import { createGateway, defineProject } from "@streamotter/gateway";
const gateway = createGateway({ config: defineProject(config), handlers, mode: "production" });
await gateway.start();
// When your authorization policy changes, update it durably first, then:
await gateway.revoke({ kind: "session", tenantId, sessionId });
```
