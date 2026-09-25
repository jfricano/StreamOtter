<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-logo.png" alt="StreamOtter" width="300"></p>

# @streamotter/gateway

The StreamOtter Node.js gateway. It consumes Kafka (or deterministic fixtures during development), runs **your** handlers to decide identity, access, public payload, and authoritative state, and delivers state channels to browsers using [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client). Each subscription gets a snapshot, then full-state updates ordered by revision, with bounded queues and explicit `live`/`stale` states.

> **Release candidate** of StreamOtter `0.1.0`; the API may still change before `0.1.0`. Package versions follow SemVer independently of the V1 protocol and `configVersion: 1`.

```bash
npm install @streamotter/gateway
```

Using the all-in-one [`streamotter`](https://www.npmjs.com/package/streamotter) package instead? Import from `streamotter/gateway`; everything on this page applies unchanged.

Requires Node.js 24 or later. ESM only, with TypeScript declarations included. Kafka access uses KafkaJS 2.2.4 behind an internal adapter. Browser delivery uses Socket.IO 4.8.3 over WebSocket.

Most projects run the gateway through [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) (`streamotter dev` / `streamotter start`), which loads a `streamotter.json` and a handler module. The same pieces work programmatically, as shown below.

## Configuration

`streamotter.json` declares sources, JSON schemas, and channels. It never contains code or resolved secrets:

```json
{
  "configVersion": 1,
  "projectId": "orders-app",
  "gateway": { "host": "127.0.0.1", "port": 7400, "path": "/streamotter/socket.io", "allowedOrigins": ["https://app.example.com"] },
  "connections": {
    "cluster": {
      "brokers": ["kafka-1.example.com:9093"],
      "tls": { "caFile": "certs/ca.pem" },
      "sasl": { "mechanism": "scram-sha-512", "username": { "env": "KAFKA_USERNAME" }, "password": { "env": "KAFKA_PASSWORD" } }
    }
  },
  "sources": {
    "orders": {
      "kind": "kafka", "generation": "orders-1", "connectionRef": "cluster", "topics": ["orders.status"],
      "consumerGroup": "orders-app-streamotter", "codec": "json", "startFrom": "latest"
    }
  },
  "schemas": {
    "OrderParams": {
      "type": "object", "additionalProperties": false, "required": ["orderId"],
      "properties": { "orderId": { "type": "string", "minLength": 1, "maxLength": 64 } }
    },
    "OrderState": {
      "type": "object", "additionalProperties": false, "required": ["orderId", "status", "progress"],
      "properties": {
        "orderId": { "type": "string", "minLength": 1, "maxLength": 64 },
        "status": { "type": "string", "enum": ["queued", "processing", "done"] },
        "progress": { "type": "integer", "minimum": 0, "maximum": 100 }
      }
    }
  },
  "channels": {
    "orderStatus": {
      "version": 1, "source": "orders", "paramsSchema": "OrderParams", "payloadSchema": "OrderState",
      "handlersRef": "orderStatus", "delivery": { "kind": "state", "overflow": "resync" }
    }
  }
}
```

Credentials are environment references. CA paths resolve relative to the configuration file. Give each source its own consumer group, and change `generation` whenever you recreate topics or change clusters. Run `streamotter generate` to produce the `AppChannels` type used below.

## Handlers

| Handler | Receives | Returns |
| --- | --- | --- |
| `authenticate` | The browser's token and verified `Origin` | A `Principal` (`subject`, `tenantId`, `sessionId`, future `expiresAt`, `claims`), or `null` to reject |
| `authorize` | The principal and validated channel parameters | `true` to allow. Anything else is `FORBIDDEN`. |
| `map` | A decoded source record | The public states it produces, or `[]` to filter it out |
| `snapshot` | The principal and parameters | `{ revision, data }`: the authoritative current state |

```ts
import type { HandlerRegistry } from "@streamotter/gateway";
import type { AppChannels, OrderState } from "./generated/streamotter.generated.js";
import { orders, sessions } from "./app.js"; // your application's session store and database

interface OrderEvent { accountId: string; version: number; order: OrderState }

export const handlers: HandlerRegistry<AppChannels> = {
  async authenticate({ token, signal }) {
    const session = await sessions.verify(token, signal);
    if (session === null) return null;
    return { subject: session.userId, tenantId: session.accountId, sessionId: session.id, expiresAt: session.expiresAt, claims: {} };
  },
  channels: {
    orderStatus: {
      authorize: ({ principal, params, signal }) => orders.isVisibleTo(principal.tenantId, principal.subject, params.orderId, signal),
      map({ record }) {
        const event = record.value as unknown as OrderEvent; // the Kafka value, decoded as JSON
        return [{ tenantId: event.accountId, params: { orderId: event.order.orderId }, revision: String(event.version), data: event.order }];
      },
      async snapshot({ principal, params, signal }) {
        const row = await orders.read(principal.tenantId, params.orderId, signal);
        return { revision: String(row.version), data: row.order };
      }
    }
  }
};
```

Every handler receives an `AbortSignal` and a `requestId`. Stop work when the signal aborts: results that arrive after a timeout, unsubscribe, or revocation are ignored. A handler that throws fails closed.

## The snapshot and revision contract

StreamOtter can only be as correct as the state your handlers describe:

- **Revisions** are canonical unsigned decimal strings (`"0"`, `"42"`, up to 39 digits), compared numerically. They increase for every change to a channel instance and never reset, even when an entity is recreated.
- **Snapshots and mapped updates describe the same progression.** Every change newer than a snapshot must eventually reach the source, for example through a transactional outbox. The gateway captures updates before calling `snapshot` and releases only those newer than the snapshot's revision.
- **One instance, one partition.** Changes to one channel instance must arrive in revision order from one Kafka partition (key your records by entity).
- **Full state, not deltas.** Each update replaces the previous state. Represent deletion as explicit state. A Kafka tombstone (null value) has no delete meaning; it pauses the source like any other invalid record.
- **Same public state for every authorized reader.** The routing identity is channel, version, the mapper's `tenantId`, and canonical parameters. Don't redact per user in `snapshot`; use separate channels or parameters for different views.
- **Invalid records pause, never skip.** Invalid JSON, an invalid mapped payload or revision, or a handler failure pauses the source at that record, and its subscriptions go `stale`. Fix the cause, then call `gateway.resumeSource(sourceId)` to retry the same record.

## Run it

```ts
import { readFile } from "node:fs/promises";
import { createGateway, defineProject } from "@streamotter/gateway";
import type { AppChannels } from "./generated/streamotter.generated.js";
import { handlers } from "./handlers.js";

const config = defineProject<AppChannels>(JSON.parse(await readFile("streamotter.json", "utf8")));
const gateway = createGateway({ config, handlers, mode: "production" });
const { origin, path } = await gateway.start();   // resolves when every source has joined its group
console.log(`StreamOtter listening on ${origin} (${path})`);
process.once("SIGTERM", () => void gateway.stop({ timeoutMs: 10_000 }));
```

- This is an ES module (`"type": "module"` in your `package.json`), because it uses top-level `await`.
- `defineProject` validates the configuration synchronously and throws `CONFIG_INVALID` with every issue.
- `start()` rolls back and rejects if startup fails or takes longer than 30 seconds. A stopped gateway cannot restart; create a new one.
- `mode: "production"` refuses fixture sources, plaintext Kafka, and the `development` option, and requires an exact browser `Origin` on every connection. `mode: "development"` accepts `development: { principals, fixtures }` for local work.
- `configDir` (optional) is where relative CA paths resolve; it defaults to the working directory (the CLI uses the configuration file's directory). `logger` (optional) receives redacted operator diagnostics: never credentials or payloads.

## Revoke access

Update your durable session or authorization policy first, then tell the gateway:

```ts
await sessions.revoke(sessionId);                                        // your store: reconnecting now fails
const { closedSubscriptions, closedConnections } =
  await gateway.revoke({ kind: "session", tenantId, sessionId });        // or { kind: "subject", tenantId, subject }
await gateway.revoke({ kind: "channel", tenantId, subject, channel: "orderStatus", channelVersion: 1, params: { orderId } });
```

Revocation takes effect immediately, including while `authorize` or `snapshot` is still pending. Unsent frames are dropped; bytes already sent cannot be recalled. V1 keeps no revocation database, which is why your own policy must change first.

## Production boundary

Run **exactly one gateway per project** (V1 has no multi-gateway coordination), behind a TLS-terminating proxy that forwards WebSocket upgrades and the browser's `Origin`. There is no management or health endpoint in production. See [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md) for the verified reverse-proxy recipe and the [Kafka support matrix](https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md#kafka-support-matrix-kafkajs-224--apache-kafka-412): TLS, and TLS with SASL PLAIN and SCRAM-SHA-256/512, are verified against Apache Kafka 4.1.2. Other broker versions and managed services are unverified.

`@streamotter/gateway/management` is the development-only management API used by `streamotter dev`; it refuses production gateways. `@streamotter/gateway/internals` exists for StreamOtter's own CLI and is not a stable API.

## Documentation

- [Add live state to an existing app](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md): handlers, revisions, the outbox, and revocation, step by step
- [Connect to Kafka](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md): topic shape, TLS and SASL, bad records, crashes, and diagnostics
- [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md): `streamotter start`, supervision, and the reverse-proxy recipe
- [Troubleshooting](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/troubleshooting.md)
- [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md): handlers and lifecycle (§3), synchronization (§5), source progress and limits (§6), and access (§7)
- [Reference application](https://github.com/jfricano/StreamOtter/tree/main/examples/order-dashboard): fixture and Kafka handlers for a real app
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · [Security policy](https://github.com/jfricano/StreamOtter/blob/main/SECURITY.md)

## StreamOtter packages

| Package | |
| --- | --- |
| [`streamotter`](https://www.npmjs.com/package/streamotter) | Everything below in one install, with the `streamotter` command |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | **This package.** Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | The local workbench's assets, installed by the CLI |

All six are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

MIT License © 2026 Orca Solutions
