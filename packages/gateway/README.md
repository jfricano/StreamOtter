<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-logo.png" alt="StreamOtter" width="300"></p>

# @streamotter/gateway

The StreamOtter Node.js gateway. It consumes Kafka (or deterministic fixtures during development), runs **your** handlers to decide identity, access, public payload, and authoritative state, and delivers state channels to browsers using [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client). Each subscription gets a snapshot, then full-state updates ordered by revision, with bounded queues and explicit `live`/`stale` states.

> **Release candidate `0.2.0-rc.1`.** The API may still change before a stable release. Package versions follow SemVer independently of the V1 protocol and `configVersion: 1`.

```bash
npm install @streamotter/gateway
```

Using the all-in-one [`streamotter`](https://www.npmjs.com/package/streamotter) package instead? Import from `streamotter/gateway`; everything on this page applies unchanged.

Requires Node.js 24 or later. ESM only, with TypeScript declarations included. Kafka access uses KafkaJS 2.2.4 behind an internal adapter. Browser delivery uses Socket.IO 4.8.3 over WebSocket.

Most projects run the gateway through [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) (`streamotter dev` / `streamotter start`), which loads a `streamotter.json` and a handler module. The same pieces work programmatically, as shown below.

## What the gateway owns

The gateway is the Kafka consumer and the server side of StreamOtter's browser protocol. It runs your `map` handlers to produce full application state, then validates and synchronizes delivery through snapshots, revision ordering, and bounded queues. Your application supplies business rules, aggregation, authentication, authorization, and an authoritative `snapshot`; the gateway does not automatically create a current-state store from an arbitrary event feed.

Run it as a service with the CLI, or embed it in an existing Node.js process with `createGateway`. The source and frontend can live on other hosts. Browser subscriptions use the SDK, which requires this running service but does not install the gateway package. See [runtime and package requirements](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md#runtime-and-package-requirements).

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

Every handler receives an `AbortSignal` and a `requestId`. Stop work when the signal aborts: results that arrive after a timeout, unsubscribe, or revocation are ignored. A handler that throws fails closed. `authenticate`'s signal also aborts when the client disconnects mid-handshake; pass it on, because a call that keeps running still holds a `maxConnections` slot until it settles or `handlerTimeoutMs` passes.

## The snapshot and revision contract

StreamOtter can only be as correct as the state your handlers describe:

- **Revisions** are canonical unsigned decimal strings (`"0"`, `"42"`, up to 39 digits), compared numerically. They increase for every change to a channel instance and never reset, even when an entity is recreated.
- **Snapshots and mapped updates describe the same progression.** Every change newer than a snapshot must eventually reach the source, for example through a transactional outbox. The gateway captures updates before calling `snapshot` and releases only those newer than the snapshot's revision.
- **One instance, one partition.** Changes to one channel instance must arrive in revision order from one Kafka partition (key your records by entity).
- **Full state, not deltas.** Each update replaces the previous state. Represent deletion as explicit state. A Kafka tombstone (null value) has no delete meaning; it pauses the source like any other invalid record.
- **Same public state for every authorized reader.** The routing identity is channel, version, the mapper's `tenantId`, and canonical parameters. Don't redact per user in `snapshot`; use separate channels or parameters for different views.
- **Invalid records pause, never skip.** Invalid JSON, an invalid mapped payload or revision, or a handler failure pauses the source at that record, and its subscriptions go `stale`. Fix the cause, then call `gateway.resumeSource(sourceId)` to retry the same record. After a revision conflict, decide which data is correct first: the retry is compared only with current state, and the gateway logs a warning. V1.1 adds opt-in quarantine and guarded continuation, below; they never skip silently either.

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
- `stop({ timeoutMs })` (10 seconds by default) commits only completed records. At the deadline it closes client connections and the listening port before it returns, so a replacement can bind the port at once; shutdown work still running finishes in the background, with a log line when it does.
- `mode: "production"` refuses fixture sources, plaintext Kafka, and the `development` option, and requires an exact browser `Origin` on every connection. `mode: "development"` accepts `development: { principals, fixtures }` for local work.
- `configDir` (optional) is where relative CA paths resolve; it defaults to the working directory (the CLI uses the configuration file's directory). `logger` (optional) receives redacted operator diagnostics: never credentials or payloads.
- `health` (optional) serves read-only `GET /health/live` and `GET /health/ready` on a separate listener: `{ port, host? }`, `host` defaulting to `127.0.0.1`, port `0` for a free one. Liveness is 200 while the listener answers, broker outages included; readiness is 503 with reason categories (`starting`, `source-held`, `source-unavailable`, `journal`, `quarantine`) when the gateway can't serve. No CORS headers, and never topic names or incident IDs. New in 0.2.0-rc.1 (V1.1); see [health checks](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md#health-checks).
- `stateDirectory`, `handlerBuildId` and `operatorSocket` (optional) are for source-failure handling, below.

## Source-failure handling (V1.1, new in 0.2.0-rc.1)

Opt-in. Without a `failureHandling` section in the configuration, the gateway pauses on a bad record exactly as described above, and none of this applies. The [runbook](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md) covers setup, policies and incident procedures.

```json
"failureHandling": {
  "quarantine": { "topic": "orders-app.streamotter.quarantine", "capture": "full-record" },
  "sources": { "orders": { "invalidJson": "quarantine-hold", "invalidPublicPayload": "quarantine-hold" } }
}
```

Each source gets `pause` (default), `quarantine-hold` or `quarantine-resync` for invalid JSON (`invalidJson`) and for mapped data that fails its payload schema (`invalidPublicPayload`). Every other failure class pauses and is never skipped. Each failure is recorded as an incident; under a quarantine policy the original record is also written, byte for byte, to a quarantine topic you provision. Options: `transientMapperRetries` (0–2, with `replaySafeMapping: true`), `automaticAdvanceLimit` and `boundaryRetirement`.

Gateway options:

| Option | |
| --- | --- |
| `stateDirectory` | Directory of the durable failure journal, created beforehand with `streamotter init --failures`. Required in production when a source uses a quarantine policy. Needs Node.js 24.15 or later. Without it, `development` mode keeps incidents in memory. |
| `handlerBuildId` | 1 to 128 characters naming your handler build, recorded in incidents and redrive plans. Default `"unspecified"`. |
| `operatorSocket` | `true` serves the operator API on `<stateDirectory>/run/operator.sock` for the `streamotter status`, `failures` and `sources` commands. Requires `stateDirectory` and `failureHandling`. Not on Windows. |

Handler additions. A `quarantine-resync` source requires `sources[id].recover`, and startup refuses a guard for any other source:

```ts
import { TransientMappingError, type HandlerRegistry } from "@streamotter/gateway";

export const handlers: HandlerRegistry<AppChannels> = {
  authenticate,
  channels: {
    orderStatus: {
      authorize,
      map({ record }) {
        if (!rates.available()) throw new TransientMappingError("rates unavailable"); // retried if transientMapperRetries > 0, then held
        return [/* … */];
      },
      async snapshot({ principal, params, recovery, signal }) {
        const { row, appliedSeq } = await orders.readWithWatermark(principal.tenantId, params.orderId, signal);
        const result = { revision: String(row.version), data: row.order };
        // Echo the boundary only when your read covers it; otherwise the attempt retries and the view stays stale.
        return recovery !== undefined && appliedSeq >= (recovery.context as { outboxSeq: number }).outboxSeq
          ? { ...result, recoveryBoundaryId: recovery.boundaryId } : result;
      }
    }
  },
  sources: {
    orders: {   // required for a quarantine-resync source
      async recover({ incident, prior, signal }) {
        const row = await outbox.findByPosition(incident.position, signal);
        if (row === null) return { decision: "hold", reason: "effect of this record is unknown" };
        const previous = (prior?.context as { outboxSeq?: number } | undefined)?.outboxSeq ?? 0;
        return { decision: "recoverable", context: { outboxSeq: Math.max(previous, row.seq) }, evidenceRef: `outbox ${row.seq}` };
      }
    }
  }
};
```

`recover` decides whether the source may move past a quarantined record; return `hold` whenever you can't prove that your snapshots already reflect it. After it approves, every snapshot on the source receives `recovery` and must return its `recoveryBoundaryId` before a subscription can be `live`. See [write an honest recovery guard](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md#4-write-an-honest-recovery-guard).

`gateway.resumeSource(sourceId)` still retries the held record and never skips it. With failure handling it goes through the operator's retry, so it is refused while an advance is unresolved or the source's circuit is open.

The operator API, in-process:

```ts
import { getGatewayOperator } from "@streamotter/gateway/operator";

const operator = getGatewayOperator(gateway);          // throws UNSUPPORTED_CAPABILITY without failureHandling
const { items } = await operator.listFailures({ state: "open" });
const incident = await operator.showFailure({ failureId: items[0].failureId });
const result = await operator.retryCurrent({ sourceId: incident.sourceId, failureId: incident.failureId, expectedRevision: incident.revision });
// result.result: "completed" | "refused" | "failed" | "unknown"; refusals are results with an outcome, not exceptions
```

It offers `status`, `listFailures`, `showFailure`, `exportFailure`, `retryCurrent`, `reassess`, `reopenCircuit`, `retireBoundary`, `evaluate` and `redrive`, the same as the CLI. `callOperator` and `connectOperator` reach a gateway's operator socket from another process. An error they raise after the request was sent but before an answer arrived (`TIMEOUT`, a dropped connection) carries `details.reason: "no-answer"`: the gateway may have run the request, so check before sending a mutation again. `gateway.stop()` answers operator requests already running for up to 5 seconds before it closes the socket. Shapes and refusal outcomes are in the [V1.1 API draft](https://github.com/jfricano/StreamOtter/blob/main/docs/releases/v1.1/V1_1_API.md#6-operator-service-slices-c-d).

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

Run **exactly one gateway per project** (V1 has no multi-gateway coordination), behind a TLS-terminating proxy that forwards WebSocket upgrades and the browser's `Origin`. There is no management endpoint in production; the optional `health` listener is the only extra one, and it belongs on loopback or a private interface. See [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md) for the verified reverse-proxy recipe and the [Kafka support matrix](https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md#kafka-support-matrix-kafkajs-224--apache-kafka-412): TLS, and TLS with SASL PLAIN and SCRAM-SHA-256/512, are verified against Apache Kafka 4.1.2. Other broker versions and managed services are unverified.

`@streamotter/gateway/management` is the development-only management API used by `streamotter dev`; it refuses production gateways. `@streamotter/gateway/operator` is the V1.1 operator API (above), for local operators only, never for browsers. `@streamotter/gateway/internals` exists for StreamOtter's own CLI and is not a stable API.

### Host the workbench API under your own route

To run the published workbench on your own site (the [workbench host contract](https://github.com/jfricano/StreamOtter/blob/main/docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md)), mount `createManagementHandler` under your API path, after your own session, lease and rate checks:

```ts
import { createManagementHandler } from "@streamotter/gateway/management";

const workbenchApi = createManagementHandler({
  gateway,                                  // a development-mode gateway; production gateways are refused
  operations: ["health", "sources", "channels", "config", "config.validate", "source-checks",
               "preview-sessions", "dev.principals", "dev.fixtures.advance"],  // everything else answers 403
  authorize: request => sessions.isValid(request),   // your same-origin session; called first, false → 401
  maxBodyBytes: 65_536                      // the default; at most 1 MiB, for every route
});

// In your HTTP server, for requests under /workbench/api/v1:
await workbenchApi(request, response, pathname.slice("/workbench/api/v1".length));
```

The handler serves API routes only (never static files), answers `GET /workbench` with the operations it offers, ignores `Authorization` headers (your `authorize` is the only credential check, so no management token reaches the browser), and requires `X-StreamOtter-Workbench: 1` on every POST. It validates requests with the same router as `streamotter dev`. List your site's origin in the gateway's `allowedOrigins` so Preview can connect.

## Documentation

- [Add live state to an existing app](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md): handlers, revisions, the outbox, and revocation, step by step
- [Connect to Kafka](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md): topic shape, TLS and SASL, bad records, crashes, and diagnostics
- [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md): `streamotter start`, supervision, and the reverse-proxy recipe
- [Handle bad records](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md): V1.1 failure policies, quarantine, recovery guards, and the operator runbook (new in 0.2.0-rc.1)
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
