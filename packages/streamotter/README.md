<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-logo.png" alt="StreamOtter" width="420"></p>

# StreamOtter

Live state from Kafka in the browser, in a form you can trust. Browsers subscribe to **state channels**, not raw topics. Each view starts from an authoritative snapshot, then receives full-state updates in revision order, and is always either verifiably `live` or visibly `stale`, never silently wrong after a disconnect, a restart, or a slow client. Your own handlers decide who may see what.

This package is StreamOtter in one install: the `streamotter` command (scaffold, validate, generate TypeScript types, develop with the local workbench, and run the production gateway), the Node.js gateway, and the browser SDK.

> **Release candidate** of StreamOtter `0.1.0`; the API may still change before `0.1.0`. Package versions follow SemVer independently of the V1 protocol and `configVersion: 1`.

```bash
npm install streamotter
```

Node.js 24 or later for the gateway and CLI; current evergreen browsers for the SDK. ESM only, with TypeScript declarations included.

## Try it

In a new folder; no Kafka needed, because the scaffold uses a built-in fixture source:

```bash
npm init -y
npm install streamotter
npx streamotter init .
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs
```

Open the workbench URL that `dev` prints and paste its one-time token. Then preview the `jobProgress` channel as the `developer` principal, and advance the `jobs` fixture to watch revisions arrive. [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md) continues from there to a real web page.

## What to import

| Import | Where | What |
| --- | --- | --- |
| `streamotter/client` | Browser | The SDK: `createClient`, subscriptions, `live`/`stale` states, and errors. Bundles only the SDK and the Socket.IO client. |
| `streamotter/gateway` | Node.js | `createGateway`, `defineProject`, and the types for your handlers (`HandlerRegistry`, `Principal`, …) |
| `streamotter/gateway/management` | Node.js | The development management API that `streamotter dev` uses |
| `streamotter/contracts` | Anywhere | Shared types, protocol constants, and configuration validation |
| `streamotter/cli` | Node.js | The CLI's programmatic API (`runCli`, `generateFiles`) |

There is no bare `import "streamotter"`. Browser code and server code are separate subpaths, so a browser bundle never pulls in the gateway.

```ts
// Browser
import { createClient } from "streamotter/client";
import { channelVersions, type AppChannels } from "./generated/streamotter.generated.js";

const client = createClient<AppChannels>({ getToken: () => session.getAccessToken() });
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId: "job_1" } });
job.on("data", ({ data }) => render(data));            // full state: replace, don't merge
job.on("state", ({ state }) => showDeliveryState(state)); // anything but "live" may be out of date
```

```ts
// Server: your trusted handlers, loaded by `streamotter dev` or `streamotter start`
import type { HandlerRegistry } from "streamotter/gateway";
import type { AppChannels } from "./generated/streamotter.generated.js";

export const handlers: HandlerRegistry<AppChannels> = {
  authenticate: ({ token }) => verifySession(token),              // your session check → Principal | null
  channels: {
    jobProgress: {
      authorize: ({ principal, params }) => canSeeJob(principal, params.jobId),
      snapshot: ({ params }) => readJob(params.jobId),            // → { revision, data } from your store
      map: ({ record }) => jobStatesFrom(record)                   // Kafka record → the states it updates
    }
  }
};
```

`streamotter init` and `streamotter generate` write code that imports from `streamotter/…` when your `package.json` lists `streamotter` (and not `@streamotter/client`).

## `streamotter` or the individual packages?

| Your project | Install |
| --- | --- |
| Trying StreamOtter, or one project with both the web app and the gateway | `streamotter` |
| A frontend that lives apart from the gateway | [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) alone: small, with no Node.js requirement and no server libraries |
| A gateway service | [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli), plus [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) for handler types or programmatic use |

Pick one style per project: import from `streamotter/…` if you installed `streamotter`, and from `@streamotter/…` if you installed those packages. With pnpm, packages you didn't install directly aren't importable.

## Documentation

- [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md): from `npm install` to a live page in about ten minutes
- [Add live state to an existing app](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md): your sessions, your database, Kafka events, access changes, and React
- [Connect to Kafka](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md): topic shape, TLS and SASL, bad records, crashes, and diagnostics
- [Run in production](https://github.com/jfricano/StreamOtter/blob/main/docs/DEPLOYMENT.md): `streamotter start`, supervision, and the reverse-proxy recipe
- [Troubleshooting](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/troubleshooting.md)
- Package guides: [client](https://www.npmjs.com/package/@streamotter/client) (states, errors, cleanup, a React hook), [gateway](https://www.npmjs.com/package/@streamotter/gateway) (handlers, revisions, revocation), and [CLI](https://www.npmjs.com/package/@streamotter/cli) (commands, workbench, exit codes)
- [Implementation status](https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md): what is verified, and the V1 limits (one gateway per project, no durable replay)
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · [Security policy](https://github.com/jfricano/StreamOtter/blob/main/SECURITY.md)

## StreamOtter packages

| Package | |
| --- | --- |
| [`streamotter`](https://www.npmjs.com/package/streamotter) | **This package.** Everything below in one install, with the `streamotter` command |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | The local workbench's assets, installed by the CLI |

All six are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

MIT License © 2026 Orca Solutions
