# Add live state to an existing app

This guide adds a live **order status** view to an application that already has signed-in users, a database, and Kafka. The steps apply to any state that people watch change: job progress, deliveries, tickets, dashboards. If you haven't used StreamOtter yet, start with [Getting started](./getting-started.md).

The examples import from the all-in-one [`streamotter`](https://www.npmjs.com/package/streamotter) package (`npm install streamotter`). With the individual packages, import from `@streamotter/gateway` and `@streamotter/client` instead; a frontend that lives apart from the gateway needs only `@streamotter/client`.

Who owns what:

| Your application | StreamOtter |
| --- | --- |
| Who the user is (`authenticate`) | Subscriptions and the Socket.IO connection |
| Who may see what (`authorize`) | Snapshot-then-update synchronization, ordered by revision |
| The authoritative state (`snapshot`) and how records map to it (`map`) | Explicit `live` / `stale` states, recovery, and reconnection |
| Publishing every change to Kafka | Bounded queues, slow-client handling, and source progress |

## Runtime and package requirements

For Kafka-backed channels, data flows from a Kafka source into the **gateway**, through your application handlers, over Socket.IO/WebSocket to the **browser SDK**, and into your frontend's rendering code. The gateway is the Kafka consumer; you do not need a separate consumer just to feed it. Source providers, gateway operators, and frontend developers can be different organizations, and these components can run on different hosts.

The gateway runs your `map` handlers to turn records into full application state, then validates and delivers that state with snapshots, revision ordering, and bounded queues. StreamOtter provides the synchronization and delivery layer. Your application still defines business meaning, aggregation, authentication, authorization, and the authoritative current state returned by `snapshot`. If a source supplies only events, provide a current-state store or API consistent with the updates; StreamOtter does not create that store automatically.

The SDK implements the browser side of the protocol: subscriptions, frame receipts, reconnection, resynchronization, and `live` / `stale` states. Your frontend renders the delivered state. The SDK therefore needs a **running compatible StreamOtter gateway** for live subscriptions. This is a network/deployment requirement, not a gateway npm dependency or peer dependency in the frontend. The SDK is not a general-purpose WebSocket or Kafka client.

| Component | Package relationship | Runtime requirement |
| --- | --- | --- |
| Browser SDK (`@streamotter/client`) | Depends on `@streamotter/contracts` and `socket.io-client`; does not depend on the gateway package | Connects to a compatible running gateway for live subscriptions |
| Gateway (`@streamotter/gateway`) | Uses contracts and server-side Kafka/Socket.IO libraries | Runs in Node.js with your configuration and handlers; Kafka-backed sources need broker access |
| Contracts (`@streamotter/contracts`) | Has no package dependencies; does not depend on the SDK or gateway | Types, protocol constants, and validation work without a running gateway or Kafka |
| CLI (`@streamotter/cli`) | Includes contracts, gateway, and Workbench packages | Scaffolds, validates, generates types, and launches the gateway; the gateway it launches delivers the data |
| Workbench (`@streamotter/workbench`) | Assets served by the CLI in development | Configuration, preview, and inspection tooling; not required for production subscriptions |
| All-in-one (`streamotter`) | Includes the CLI, SDK, contracts, and gateway, with Workbench through the CLI | Browser and server imports use separate subpaths; installing the package does not start a gateway |

A separate frontend can install only `@streamotter/client`. Run the gateway as a service with the CLI, or embed it in an existing Node.js process with `createGateway` (see [programmatic deployment](../DEPLOYMENT.md#programmatic-use)). Neither arrangement requires the source and gateway to share a host. V1 supports one gateway instance per project; multiple frontend applications can connect to it when their exact origins appear in `gateway.allowedOrigins` and their users pass your authentication and authorization handlers.

Other processing tools can consume the same Kafka feed independently using their own consumer groups. They do not need StreamOtter unless they choose StreamOtter's browser state-delivery protocol.

## 1. Choose the view

A **channel** is one kind of live view, such as `orderStatus`. Its **parameters** pick one instance (`{ "orderId": "ord_1001" }`), and the principal's **tenant** scopes it, so two customers' `ord_1001` are different instances. Everyone allowed to see an instance receives exactly the same state, so if two audiences need different data (a customer view and an internal view), make them two channels.

Parameters are a small closed object of required strings, booleans, or integers. The state (the *payload*) can be any JSON your schema allows.

## 2. Describe it in `streamotter.json`

```json
{
  "configVersion": 1,
  "projectId": "shop",
  "gateway": { "host": "127.0.0.1", "port": 7400, "path": "/streamotter/socket.io", "allowedOrigins": ["https://shop.example.com"] },
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
      "consumerGroup": "shop-streamotter", "codec": "json", "startFrom": "latest"
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
        "status": { "type": "string", "enum": ["placed", "picking", "shipped", "delivered", "cancelled"] },
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

The schema language is a deliberately small subset of JSON Schema: objects with `additionalProperties: false`, strings with length or enum limits, bounded numbers and integers, booleans, null, and arrays with `maxItems`. Check the file with `npx streamotter validate --config streamotter.json`. [Connect to Kafka](./kafka.md) explains every source and connection field.

## 3. Generate the types

```bash
npx streamotter generate --config streamotter.json --out src/generated
```

Now `AppChannels`, `OrderParams`, `OrderState`, and `channelVersions` are available to both your server and your browser code. Run it again whenever the configuration changes; it only overwrites files it created.

## 4. Give every change a revision, and publish it

Add a version to the row and increment it in the same transaction as each change. That number, as a string, is the revision. Then publish the full new state, keyed by the order ID, through your outbox:

```json
{ "accountId": "acme", "version": 8, "order": { "orderId": "ord_1001", "status": "shipped", "progress": 80 } }
```

Rules that keep views correct:

- Revisions only increase for an instance, and never reset.
- The snapshot and the topic describe the same progression: every change that `snapshot` can return must also reach the topic.
- Send full state, not deltas, and no tombstones: represent deletion as a status.

## 5. Write the handlers

Handlers are trusted server code that the gateway calls. They usually live in your application's repository, so they can use your session store and database:

```ts
// src/streamotter/handlers.ts: compile to JavaScript, then pass the .js file to --handlers
import type { HandlerRegistry } from "streamotter/gateway";
import type { AppChannels, OrderState } from "../generated/streamotter.generated.js";
import { orders, sessions } from "../app.js"; // your session store and data access

interface OrderEvent { accountId: string; version: number; order: OrderState }

export const handlers: HandlerRegistry<AppChannels> = {
  // Who is this? Verify the token your page sends; never trust fields the browser supplies.
  async authenticate({ token, signal }) {
    const session = await sessions.verify(token, signal);
    if (session === null) return null; // → UNAUTHENTICATED
    return { subject: session.userId, tenantId: session.accountId, sessionId: session.id, expiresAt: session.expiresAt, claims: {} };
  },
  channels: {
    orderStatus: {
      // May this user see this order? Runs on subscribe, on every resynchronization, and before each snapshot.
      authorize: ({ principal, params, signal }) => orders.isVisibleTo(principal.tenantId, principal.subject, params.orderId, signal),
      // The authoritative current state, with its revision.
      async snapshot({ principal, params, signal }) {
        const row = await orders.read(principal.tenantId, params.orderId, signal);
        return { revision: String(row.version), data: row.order };
      },
      // Which instance does this Kafka record update? Return [] to ignore it.
      map({ record }) {
        const event = record.value as unknown as OrderEvent;
        return [{ tenantId: event.accountId, params: { orderId: event.order.orderId }, revision: String(event.version), data: event.order }];
      }
    }
  }
};
```

- `expiresAt` must be a future UTC timestamp. Delivery to a connection stops when it passes, until the SDK reconnects with a fresh token (it refreshes 30 seconds early when it can). Use your session's real expiry.
- Every handler gets an `AbortSignal`. Pass it to your queries, because results that arrive after a timeout, an unsubscribe, or a revocation are ignored. `authenticate`'s signal also aborts when the browser disconnects mid-handshake, and a call that ignores it keeps holding a `maxConnections` slot until it settles or `handlerTimeoutMs` passes. A handler that throws fails closed: `authorize` becomes `HANDLER_FAILED` for that subscription; `map` pauses the source.
- The gateway runs your handlers in its own process, so it needs read access to your session store and data, directly or through an internal API of your application. The [reference example's Kafka handlers](https://github.com/jfricano/StreamOtter/blob/main/examples/order-dashboard/src/server/kafka-handlers.ts) call the application over HTTP.

The CLI loads compiled JavaScript (it refuses `.ts` files). Compile with your usual `tsc` setup (for example `"module": "NodeNext"`) and pass the output, for example `--handlers dist/streamotter/handlers.js`. StreamOtter's packages are ES modules. Mark your project as one too, with `"type": "module"` in `package.json` (`npm init -y` writes `"commonjs"`), because the programmatic example below uses top-level `await`. You can also write the module directly as `.mjs` with JSDoc types, as the `init` scaffold does.

## 6. Subscribe from the browser

```ts
import { createClient } from "streamotter/client";
import { channelVersions, type AppChannels } from "./generated/streamotter.generated.js";

const client = createClient<AppChannels>({ getToken: () => session.getAccessToken() }); // your own session token
const order = client.subscribe("orderStatus", { channelVersion: channelVersions.orderStatus, params: { orderId } });
order.on("data", ({ data }) => renderOrder(data));
order.on("state", ({ state }) => renderDeliveryState(state)); // show anything but "live" as possibly out of date
order.on("error", error => renderError(error));
```

- **Origin:** by default the SDK connects to the page's own origin at `/streamotter/socket.io`, which is what you want behind a reverse proxy that serves both your app and the gateway (see [Run in production](../DEPLOYMENT.md)). Otherwise pass `origin`, and list the page's exact origin in `gateway.allowedOrigins`.
- **Rendering states and errors, cleanup, and React:** see the [client guide](https://www.npmjs.com/package/@streamotter/client); it applies unchanged with `streamotter/client`. From 1.0.0, React apps can use the provider and hooks from `streamotter/react` (or `@streamotter/client/react`).

## 7. Handle access changes

`authorize` runs when a view subscribes or resynchronizes, not on every update. Between those checks the gateway enforces two things on every frame: the principal's `expiresAt` and revocations. So when a user signs out or loses access:

1. Update your own session or permission data first, so a reconnect can't restore access.
2. Then either let the session's short expiry end delivery, or call `revoke` on the running gateway for an immediate cut-off:

```ts
await gateway.revoke({ kind: "session", tenantId, sessionId });            // everything on one session
await gateway.revoke({ kind: "subject", tenantId, subject });              // everything for one user
await gateway.revoke({ kind: "channel", tenantId, subject, channel: "orderStatus", channelVersion: 1, params: { orderId } });
```

`revoke` is part of the programmatic API. `streamotter start` has no control endpoint, so to revoke, run the gateway from your own Node.js process and expose it to your application however it calls internal services, protected by your own authentication:

```ts
import { readFile } from "node:fs/promises";
import { createGateway, defineProject } from "streamotter/gateway";
import type { AppChannels } from "../generated/streamotter.generated.js";
import { handlers } from "./handlers.js";

const config = defineProject<AppChannels>(JSON.parse(await readFile("streamotter.json", "utf8")));
export const gateway = createGateway({ config, handlers, mode: "production" });
await gateway.start();
process.once("SIGTERM", () => void gateway.stop());
```

## 8. Develop locally

You can develop against a local Kafka and your real database, which is the closest to production. Or you can work without Kafka:

- Keep a second configuration (for example `streamotter.dev.json`) whose source is `{ "kind": "fixture", "generation": "orders-fixture-1", "fixtureRef": "orders" }`.
- Export `development` from the handler module, with named principals for workbench previews and fixture records shaped like your Kafka values. The `snapshot` handler must agree with those fixtures. The [reference example](https://github.com/jfricano/StreamOtter/tree/main/examples/order-dashboard) keeps a small read model fed by the fixture stream, and runs the same handlers in fixture and Kafka modes.
- Run `npx streamotter dev --config streamotter.dev.json --handlers …`, then preview any principal and advance fixtures in the workbench.

## 9. Before production

- [ ] `authenticate` verifies real sessions and returns their real expiry.
- [ ] `authorize` and `snapshot` read your authoritative data; `snapshot` does no per-user redaction that `map` can't reproduce.
- [ ] Every change is published with an increasing revision, keyed by entity, through an outbox.
- [ ] The source uses TLS; secrets come from environment variables.
- [ ] `allowedOrigins` lists your exact production origin(s).
- [ ] You know how access changes reach the gateway: short expiry, or `revoke` from your own process.
- [ ] Exactly one gateway, under a supervisor, behind a TLS-terminating proxy: [Run in production](../DEPLOYMENT.md).
