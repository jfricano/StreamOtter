<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-logo.png" alt="StreamOtter" width="300"></p>

# @streamotter/client

The StreamOtter browser SDK. Subscribe to a **state channel** served by a [StreamOtter gateway](https://www.npmjs.com/package/@streamotter/gateway): each subscription gets an authoritative snapshot, then full-state updates in revision order. It also reports whether the view is verifiably current (`live`) or not (`stale`), so a screen is never silently wrong.

> **Release candidate** of StreamOtter `0.1.0`; the API may still change before `0.1.0`. Package versions follow SemVer independently of the V1 protocol (`protocolVersion: 1`).

```bash
npm install @streamotter/client
```

Using the all-in-one [`streamotter`](https://www.npmjs.com/package/streamotter) package instead? Import from `streamotter/client`; everything on this page applies unchanged.

Transport: Socket.IO 4.8.3 over WebSocket only. Targets current evergreen browsers. ESM only, with TypeScript declarations included.

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

`subscribe()` returns immediately and starts in the next microtask, so listeners attached synchronously never miss the snapshot. Data events are not replayed to listeners added later. Each `data` event carries `kind` (`"snapshot"` or `"update"`), `revision` (a decimal string), `data`, and `receivedAt`.

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

The client has its own connection state (`client.state`, `client.on("state", …)`): `idle`, `connecting`, `connected`, `reconnecting`, `auth-required`, `closed`. Network failures reconnect automatically with full-jitter backoff (500 ms up to 30 s) while subscriptions are active, and every active subscription gets a fresh snapshot. `auth-required` means the token was rejected or expired, or `getToken` failed or timed out (10 s). Refresh the user's session, then call `client.reconnect()`. If the signed-in account changes, the old subscriptions close with `UNAUTHENTICATED` instead of showing the previous user's data.

## Handle errors

Every failure is a `StreamError`: `{ code, message, retryable, requestId, details? }`. Promises (`ready`, `resync`, `reconnect`) reject with it, and `error` listeners receive it. `isStreamError(value)` narrows unknown values.

- `FORBIDDEN`: this user may not see this channel instance. Unknown channels also return `FORBIDDEN`, so nothing leaks. Don't retry.
- `UNAUTHENTICATED`: the session is invalid or expired. Re-authenticate, then `client.reconnect()`.
- `RESYNC_REQUIRED`, `TIMEOUT`, `SOURCE_UNAVAILABLE`, `OVERLOADED`: may work later. Offer a retry, but don't loop.
- `INVALID_PARAMS`: the parameters don't match the channel's schema.
- `CLIENT_CLOSED`: the client was closed.

A listener that throws, or returns a rejected promise, fails its subscription with `HANDLER_FAILED`. Keep listeners cheap: state replacement, not heavy processing.

## Clean up

```ts
await job.unsubscribe();   // idempotent; resolves after the gateway confirms (at most 5 s)
await client.close();      // closes every subscription and the connection, permanently
```

Unsubscribe when a view unmounts. Close a shared client only when its owning application scope ends.

## React hook pattern

Create one client per signed-in session and one subscription per mounted component:

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient, type Client, type StreamError, type SubscriptionState } from "@streamotter/client";
import { channelVersions, type AppChannels, type JobProgress } from "./generated/streamotter.generated.js";

const ClientContext = createContext<Client<AppChannels> | null>(null);

export function StreamOtterProvider({ getToken, children }: { getToken: () => Promise<string>; children: ReactNode }) {
  const client = useMemo(() => createClient<AppChannels>({ getToken }), [getToken]);
  useEffect(() => () => { void client.close(); }, [client]);
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useJobProgress(jobId: string) {
  const client = useContext(ClientContext);
  const [data, setData] = useState<JobProgress | null>(null);
  const [state, setState] = useState<SubscriptionState>("idle");
  const [error, setError] = useState<StreamError | null>(null);
  useEffect(() => {
    if (client === null) return;
    setData(null);
    setError(null);
    const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
    const offData = job.on("data", event => setData(event.data));
    const offState = job.on("state", change => setState(change.state));
    const offError = job.on("error", setError);
    return () => { offData(); offState(); offError(); void job.unsubscribe(); };
  }, [client, jobId]);
  return { data, state, error, live: state === "live" };
}
```

Pass a stable `getToken` (for example from `useCallback`) so the client is not recreated on every render. The [reference application](https://github.com/jfricano/StreamOtter/tree/main/examples/order-dashboard) has vanilla TypeScript and React versions of this pattern, including denied access and reconnection.

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
