<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-readme-lockup.png" alt="StreamOtter" width="240"></p>

# @streamotter/client

The StreamOtter browser SDK. Subscribe to a **state channel** served by a [StreamOtter gateway](https://www.npmjs.com/package/@streamotter/gateway): each subscription gets an authoritative snapshot, then full-state updates in revision order. It also reports whether the view is verifiably current (`live`) or not (`stale`), so a screen is never silently wrong.

> **Release candidate `0.2.0-rc.1`.** The API may still change before a stable release. Package versions follow SemVer independently of the V1 protocol (`protocolVersion: 1`).

```bash
npm install @streamotter/client
```

Using the all-in-one [`streamotter`](https://www.npmjs.com/package/streamotter) package instead? Import from `streamotter/client`; everything on this page applies unchanged.

Transport: Socket.IO 4.8.3 over WebSocket only. Targets current evergreen browsers. ESM only, with TypeScript declarations included.

## Runtime requirement

Live subscriptions require a **running compatible StreamOtter gateway** on the server. This is a network/deployment requirement: the frontend does not need to install `@streamotter/gateway` as a dependency or peer dependency. This package depends on `@streamotter/contracts` and `socket.io-client`.

The SDK implements subscriptions, frame receipts, reconnection, resynchronization, and `live` / `stale` states; your application renders the delivered state. It connects using StreamOtter's protocol, rather than directly consuming Kafka or acting as a general-purpose WebSocket client. See [runtime and package requirements](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md#runtime-and-package-requirements) for the component boundaries and deployment choices.

## Subscribe

Generate your channel types from the project configuration (`streamotter generate`, from [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli)), then:

```ts
import { createClient } from "@streamotter/client";
import { channelVersions, type AppChannels } from "./generated/streamotter.generated.js";

const client = createClient<AppChannels>({
  origin: "https://app.example.com",   // default: the page's origin
  // path: "/streamotter/socket.io",     // default
  getToken: ({ signal }) => session.getAccessToken(signal)  // your application's session token
});

const job = client.subscribe("jobProgress", {
  channelVersion: channelVersions.jobProgress,
  params: { jobId: "job_1" }
});
job.on("data", event => render(event.data));          // full state; replace, don't merge
job.on("state", ({ state }) => showDeliveryState(state));
job.on("error", error => console.warn(`[${error.code}] ${error.message}`));
await job.ready({ timeoutMs: 30_000 });               // resolves at the next `live`
```

`subscribe()` returns immediately and starts in the next microtask, so listeners attached synchronously never miss the snapshot. Data events are not replayed to listeners added later. `on()` returns a function that removes the listener; once removed, it is not called again, even for an event that is already being dispatched. Each `data` event carries `kind` (`"snapshot"` or `"update"`), `revision` (a decimal string), `data`, and `receivedAt`.

The gateway decides who may see what. `getToken` supplies your application's own session token, which the gateway's `authenticate` handler verifies. The browser never chooses its tenant.

## Render the delivery state

| State | Meaning | What to show |
| --- | --- | --- |
| `authorizing`, `synchronizing` | Checking access, loading the snapshot | A loading state. Keep any previous data visibly provisional. |
| `live` | Synchronized with the gateway while its source is healthy | The data as current. |
| `stale` | Connection loss, source outage, overflow, or a snapshot timeout. The SDK is recovering automatically. | The last data, marked as possibly out of date. |
| `resync-required` | Automatic recovery used its attempts (three per incident) | A retry action that calls `job.resync()`. |
| `failed` | Terminal: access denied (`FORBIDDEN`), a handler failed, or the data was invalid | The error. To try again, create a new subscription. |
| `closed` | Unsubscribed, or the client was closed | Nothing. |

`live` means synchronized up to the gateway's drain boundary. It is not a wall-clock freshness guarantee. Treat every other state as "may be stale".

`resync()` on a `stale` subscription leaves it `stale` until the gateway actually starts the new attempt (for example, once a paused source resumes), and then it goes `authorizing`. Calls made while one is pending share it. If the attempt gives up, the subscription enters `resync-required` and `resync()` rejects with `RESYNC_REQUIRED`.

The client has its own connection state (`client.state`, `client.on("state", …)`): `idle`, `connecting`, `connected`, `reconnecting`, `auth-required`, `closed`. Network failures reconnect automatically with full-jitter backoff (500 ms up to 30 s) while subscriptions are active, and every active subscription gets a fresh snapshot. `auth-required` means the token was rejected or expired, or `getToken` failed or timed out (10 s). Refresh the user's session, then call `client.reconnect()`. If the signed-in account changes, the old subscriptions close with `UNAUTHENTICATED` instead of showing the previous user's data.

## Handle errors

Every failure is a `StreamError`: `{ code, message, retryable, requestId, details? }`. Promises (`ready`, `resync`, `reconnect`) reject with it, and `error` listeners receive it. `isStreamError(value)` narrows unknown values.

- `FORBIDDEN`: this user may not see this channel instance. Unknown channels also return `FORBIDDEN`, so nothing leaks. Don't retry.
- `UNAUTHENTICATED`: the session is invalid or expired. Re-authenticate, then `client.reconnect()`.
- `RESYNC_REQUIRED`, `TIMEOUT`, `SOURCE_UNAVAILABLE`, `OVERLOADED`: may work later. Offer a retry, but don't loop.
- `INVALID_PARAMS`: the parameters don't match the channel's schema. A production gateway reports a schema mismatch as `FORBIDDEN`, so it doesn't reveal the channel's parameters.
- `CLIENT_CLOSED`: the client was closed.

A listener that throws, or returns a rejected promise, fails its subscription with `HANDLER_FAILED`. Keep listeners cheap: state replacement, not heavy processing.

## Source failures on the server (V1.1)

The source-failure handling new in 0.2.0-rc.1 (V1.1) changes nothing in the browser: no new state, error code, or protocol message. A source held at a bad record looks like any unavailable source: views go `stale` and recover by themselves once it is repaired. The [source-failure runbook](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md) is for whoever runs the gateway.

## Clean up

```ts
await job.unsubscribe();   // idempotent; resolves after the gateway confirms (at most 5 s)
await client.close();      // closes every subscription and the connection, permanently
```

Unsubscribe when a view unmounts. Close a shared client only when its owning application scope ends.

## React hooks

`@streamotter/client/react` (or `streamotter/react`) has a provider and hooks for React 18 or later. React is an optional peer dependency: apps that don't import this subpath don't load it.

```tsx
import { createStreamOtterHooks, StreamOtterProvider } from "@streamotter/client/react";
import { channelVersions, type AppChannels } from "./generated/streamotter.generated.js";

// Once: the hooks typed for your generated channels.
export const { useSubscription, useConnectionState } = createStreamOtterHooks<AppChannels>();

// At the root. The provider creates the client after mounting and closes it on unmount.
// A new key for a new signed-in user gives that user a new client.
type Session = { userId: string; token(): Promise<string> };
export function App({ session }: { session: Session }) {
  return (
    <StreamOtterProvider key={session.userId} options={{ getToken: () => session.token() }}>
      <JobCard jobId="job_1" />
    </StreamOtterProvider>
  );
}

function JobCard({ jobId }: { jobId: string }) {
  const { data, revision, state, live, error, resync } = useSubscription("jobProgress", {
    channelVersion: channelVersions.jobProgress,
    params: { jobId }
  });
  if (error?.code === "FORBIDDEN") return <p>You don't have access to this job.</p>;
  if (data === undefined) return <p>Loading…</p>;
  return (
    <section className={live ? "" : "stale"}>
      {data.state} · {data.percent}% · revision {revision} {live ? "" : `(${state})`}
      {state === "resync-required" && <button onClick={() => void resync()}>Refresh</button>}
    </section>
  );
}
```

- **`StreamOtterProvider`** takes `options` (it creates and closes the client; `getToken` is read from the latest render, so an inline function is fine; a new `origin` or `path` replaces the client) or `client` (one you create and close yourself; `null` while there is none, for example before sign-in).
- **`useSubscription(channel, options)`** subscribes while the component is mounted and unsubscribes on unmount, or when the channel, version, param values, or client change. A new `params` object with the same values keeps the subscription. Pass `null` to wait (for example, until an id is known). It returns `data` and `revision` (kept while `stale`, so render them as last known; cleared when the subscription changes), `state`, `live`, `error` (the latest error, cleared when the subscription is `live` again), and `resync()`.
- **`useConnectionState()`** returns the client's connection state, and **`useClient()`** the client itself (for `reconnect()`), or `null` before the provider has one.
- Hooks subscribe in effects, so nothing connects during server rendering, and React StrictMode's development double mount leaves exactly one subscription per component. The hooks add no caching or retries: two components that subscribe to the same channel and params are two subscriptions, as with `subscribe`.
- Without the factory, `useSubscription`, `useConnectionState` and `useStreamOtterClient` are exported directly, typed against a generic channel map. `SubscriptionOptions<AppChannels, "jobProgress">` names the type of the options argument, for wrappers around `useSubscription`.
- Hooks used outside a `StreamOtterProvider` throw a `StreamOtterError` with code `INVALID_REQUEST`, as do `options` without a `getToken` function or without a numeric `channelVersion` and a params object. While the client is closed (for example, one your app closed before replacing it), a subscription hook renders `"idle"` rather than subscribing.

The [reference application](https://github.com/jfricano/StreamOtter/tree/main/examples/order-dashboard) has a React page built on these hooks, including denied access.

## Documentation

- [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md): from `npm install` to a live page in about ten minutes
- [Add live state to an existing app](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md): your sessions, handlers, and this SDK together
- [Troubleshooting](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/troubleshooting.md): `FORBIDDEN`, `UNAUTHENTICATED`, `stale`, `resync-required`, and more
- [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md): the SDK (§4), states and synchronization (§5), and errors (§9)
- [Implementation status](https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md): what is verified, and the known limitations (for example, automated browser checks cover Chromium only)
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · [Security policy](https://github.com/jfricano/StreamOtter/blob/main/SECURITY.md)

## StreamOtter packages

| Package | |
| --- | --- |
| [`streamotter`](https://www.npmjs.com/package/streamotter) | Everything below in one install, with the `streamotter` command |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | **This package.** The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | The local workbench's assets, installed by the CLI |

All six are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

MIT License © 2026 Orca Solutions
