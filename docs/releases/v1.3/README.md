# V1.3 — React hooks

**Status: planned, not built.** A single-feature release that brings the React hooks forward from V2.2. Decided by the owner on October 6, 2026. This document is the plan; nothing here is installable yet.

## Why now

Every React integrator today copies the [hook pattern](https://www.npmjs.com/package/@streamotter/client#react-hook-pattern) from the client README and the reference example's `react.tsx`. That pattern is right but easy to get subtly wrong (a client created in `useMemo` is closed by StrictMode's second effect run; a params object built during render resubscribes on every render). Shipping the hooks makes the supported path the easy path, and it needs nothing from V2.0 (retained history) or V2.1 (multiple gateways), so it doesn't have to wait for them.

## Scope

One feature: React bindings for the browser SDK. No gateway, CLI, workbench, protocol or configuration change. The V1 state contract and the SDK's public API are untouched; the hooks are a layer over `createClient` and `subscribe`.

### Where it lives

A new subpath export of the existing client package, not a new package:

| Import | Contents |
| --- | --- |
| `@streamotter/client/react` | The provider and hooks below |
| `streamotter/react` | The same, re-exported from the all-in-one package |

`react` (18 or later) becomes an **optional** peer dependency of `@streamotter/client` and `streamotter`. Applications without React install nothing new and import nothing new: `@streamotter/client` itself does not import React, so bundlers never pull it in unless `…/react` is imported. The alternative, a seventh package `@streamotter/react`, was rejected: one more thing to version, publish, pack-test and document, for a module small enough to live beside the SDK it binds.

### API

```tsx
import { createStreamOtterHooks, StreamOtterProvider } from "@streamotter/client/react";
import type { AppChannels } from "./generated/streamotter.generated.js";

// Once, in the application: the hooks typed for the generated channels.
export const { useSubscription, useConnectionState, useClient } = createStreamOtterHooks<AppChannels>();

// At the root: one client per signed-in identity. Change the key to switch users.
<StreamOtterProvider key={session.user} options={{ getToken: () => currentToken(session) }}>…</StreamOtterProvider>
// Or hand it a client the application owns and closes itself:
<StreamOtterProvider client={client}>…</StreamOtterProvider>

// In a component: subscribe while mounted.
const { data, revision, state, live, error, resync } = useSubscription("orderStatus", { channelVersion: 1, params: { orderId } });
```

| Export | Behavior |
| --- | --- |
| `StreamOtterProvider` | Shares one client with the tree. With `options`, it creates the client in an effect after mounting and closes it on unmount; a new `origin` or `path` replaces the client, and `getToken` is read from the latest render so an inline function never recreates it. With `client`, the application owns the lifecycle; `client={null}` means "none yet" (before sign-in). |
| `useSubscription(channel, options \| null)` | Subscribes in an effect; unsubscribes on unmount or when the channel, version, param *values* or client change. Returns `data` and `revision` (kept while `stale`, cleared on a change of subscription), `state` (the SDK's `SubscriptionState`, `"idle"` while there is no client or `options` is `null`), `live` (`state === "live"`), `error` (the latest `StreamError`, cleared when the subscription is `live` again) and `resync()`. `null` options hold off until an id is known. |
| `useConnectionState()` | The client's `ConnectionState` through `useSyncExternalStore`; `"idle"` without a client and during server rendering. |
| `useClient()` | The provider's client, or `null`. Throws `INVALID_REQUEST` outside a provider, as the SDK does for a bad call. |
| `createStreamOtterHooks<AppChannels>()` | Returns the same hooks typed for the generated `AppChannels`, so `channel`, `params` and `data` are checked the way `createClient<AppChannels>()` checks `subscribe`. The untyped hooks are also exported for applications that prefer to pass the type parameter per call. |

### Rules the implementation must keep

1. **StrictMode.** Development double-mounts every component. Each mount subscribes and each unmount unsubscribes, and the gateway ends up with exactly one subscription per mounted component. The provider creates its client inside the effect that closes it, never during render.
2. **Params by value.** A new `params` object with equal values keeps the subscription; key order doesn't matter. Only a changed value, channel, version or client resubscribes, and then the previous data is not shown under the new params.
3. **No work during server rendering.** Hooks subscribe in effects only. A server render sees `state: "idle"`, no data, and no `createClient` call (which would throw without a browser origin).
4. **Listeners are removed, not leaked.** Unmount removes every `on()` listener and calls `unsubscribe()`; the provider calls `close()`.
5. **The SDK's semantics show through.** The hooks add no retry, caching, deduplication across components or state of their own. Two components subscribing to the same channel instance are two subscriptions, as in the SDK; `live`, `stale` and `resync-required` mean what [V1 API §5](../../V1_API.md) says. Last-known `data` stays available while `stale` so the application can render it as stale, per the live-or-stale promise.
6. **Nothing new in `@streamotter/contracts`.** The hooks use the published `Client`, `Subscription`, `StreamEvent` and state types as they are.

### Non-goals

Suspense and `use()` integration, React Server Components, React Native, event channels and history (V2.0), named commands (V3.0), and bindings for other frameworks (Beyond V3). Each is possible later on the same subpath without a breaking change.

## Deliverables

| Item | Where |
| --- | --- |
| `react.ts` with the exports above | `packages/client/src/react.ts`, exported as `./react`; `packages/streamotter/src/react.ts` re-exports it |
| Manifests | `exports` and `publishConfig.exports` for `./react` in both packages (they must stay in step; `pnpm test:install` checks this); `peerDependencies.react` with `peerDependenciesMeta.react.optional = true`; React and a DOM shim as dev dependencies of `packages/client` and `tests` |
| Unit tests | `packages/client/test/react.test.ts` on a fake client: provider with `client` and with `options`, idle without a client, data/revision/state/error rendering, error cleared on `live`, equal-value params don't resubscribe (including key order), changed params and changed client resubscribe and clear data, `null` options hold off, exactly one open subscription under StrictMode, `resync` delegation, `useConnectionState`, listener cleanup on unmount, the throw outside a provider |
| Integration test | `tests/integration/react.test.ts`: components under StrictMode against the fixture gateway render the snapshot, a live update and a `FORBIDDEN` denial; `subscriptionCount()` stays 1; unmount brings it to 0 |
| Reference example | `examples/order-dashboard/src/web/react.tsx` rewritten on the hooks; the Playwright order-dashboard check (`/react`: two live orders, one denial) keeps passing |
| Install test | `tests/install/install.test.ts` adds a React consumer: bundles `@streamotter/client/react` and `streamotter/react` from the packed tarballs, type-checks against the published declarations, and confirms a non-React consumer's bundle contains no React |
| Documentation | Client README "React hook pattern" becomes "React hooks"; the existing-app guide §6 and getting-started point at them; V1_API.md §13 records the addition; IMPLEMENTATION_STATUS.md lists the hooks and the tests that verify them; README.md and CHANGELOG.md; the roadmap's feature-allocation and increment tables (done in this plan's PR) |

A prototype of exactly this surface was written and run against the fixture gateway while planning; all the unit and integration tests above pass on it. It is kept outside the repository until the owner opens the build. See the [prototype handoff](./PROTOTYPE_HANDOFF.md) for where it is, what was verified, and what was learned.

## Versioning and sequencing

Per the roadmap's [npm versions](../../API_AND_FEATURE_ROADMAP.md#npm-versions), milestones are npm minors and a milestone added later shifts the numbers after it up by one. The owner chose (October 6, 2026) to ship V1.3 **after** the V1 public launch:

| Milestone | npm |
| --- | --- |
| V1 public launch | `1.0.0` (unchanged) |
| **V1.3 React hooks** | **`1.1.0`**, after a `1.1.0-rc.1` |
| V2.0, V2.1, V2.2, V2.3 (proposed) | `1.2.0`, `1.3.0`, `1.4.0`, `1.5.0` |

So V1.3 adds nothing to the 1.0.0 launch gate (the V1.1 acceptance-packet checks), and the launch's documentation keeps pointing at the copyable hook pattern until 1.1.0 exists. Because `react` is an optional peer and the SDK's existing surface is unchanged, 1.1.0 is a plain minor for every current user. All six packages move to 1.1.0 together, as usual.

Lontra Creek's demo of the hooks (a React game on the creek's public channels) is planned in the Lontra Creek repository under `docs/releases/v1.3/`; it installs `streamotter@1.1.0` from npm once published and never links this repository, per its ground rules.

## Acceptance

- `pnpm verify`, `pnpm test:install` and `pnpm test:browser` green on Node 24 and 26, with the new tests listed above included.
- The React consumer in the install test type-checks `useSubscription` against generated `AppChannels` and rejects a wrong channel name, version or params shape at compile time.
- A non-React consumer's bundle size is unchanged from 1.0.0 (measured in the install test).
- The client README's example is run as written in the reference example.
- An independent review of the implementation before the PR opens, per the project's convention; the owner performs it.

## Open decisions

1. Keep the hook names (`useSubscription`, `useConnectionState`, `useClient`) and the `createStreamOtterHooks` factory, or export only typed-per-call hooks? Recommendation: both, as above; the factory keeps call sites free of type parameters.
2. Should `StreamOtterProvider` with `options` also accept `getToken` changes as "same client" (recommended, as above) or treat any new function as a new identity? Recommendation: same client; identity changes are expressed with `key`.
3. Whether to also publish a `useSubscription` variant that suspends (Suspense). Recommendation: no, not in V1.3.
