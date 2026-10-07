# V1.3 API contract — `@streamotter/client/react`

This is the locked public API for the React hooks. The [plan](./README.md) chose the surface and the owner approved it on October 6, 2026 (Pacific). This document fixes the exact declarations and behavior that the implementation, the tests and the doc comments must match. A change to anything below is an API change: it is recorded under [Decisions](#decisions) with a date before the code changes.

The same exports are available from `streamotter/react`. React 18 or later is an optional peer dependency of `@streamotter/client` and `streamotter`.

## Declarations

```ts
import type { ReactElement, ReactNode } from "react";
import type {
  ChannelMap, Client, ClientOptions, ConnectionState, Json, Revision, StreamError, SubscriptionState, WaitOptions
} from "@streamotter/client";

export type StreamOtterProviderProps = { children?: ReactNode } & (
  | { client: Client<any> | null; options?: never }
  | { options: ClientOptions; client?: never }
);
export function StreamOtterProvider(props: StreamOtterProviderProps): ReactElement;

export type SubscriptionOptions<C extends ChannelMap, K extends keyof C & string> = {
  channelVersion: C[K]["version"];
  params: C[K]["params"];
};

export interface SubscriptionResult<D extends Json> {
  data: D | undefined;
  revision: Revision | undefined;
  state: SubscriptionState;
  live: boolean;
  error: StreamError | undefined;
  resync(options?: WaitOptions): Promise<void>;
}

export function useSubscription<C extends ChannelMap = ChannelMap, K extends keyof C & string = keyof C & string>(
  channel: K,
  options: SubscriptionOptions<C, K> | null
): SubscriptionResult<C[K]["data"]>;

export function useConnectionState(): ConnectionState;

export function useStreamOtterClient<C extends ChannelMap = ChannelMap>(): Client<C> | null;

export interface StreamOtterHooks<C extends ChannelMap> {
  useSubscription<K extends keyof C & string>(channel: K, options: SubscriptionOptions<C, K> | null): SubscriptionResult<C[K]["data"]>;
  useClient(): Client<C> | null;
  useConnectionState(): ConnectionState;
}
export function createStreamOtterHooks<C extends ChannelMap>(): StreamOtterHooks<C>;
```

Nothing else is exported. No type is added to `@streamotter/contracts`; the hooks use the SDK's published types unchanged.

## Behavior

Each clause has an ID that the tests cite in their names.

### Provider

- **P1. Owned client.** With `options`, the provider creates a client with `createClient(options)` in an effect after mounting, and closes it when it unmounts. Before the effect runs (first render, server rendering) the provider supplies `null`.
- **P2. Replacement.** A change of `options.origin` or `options.path` closes the client and creates a new one. Any other change to `options`, including a new `getToken` function, keeps the client.
- **P3. Latest `getToken`.** The owned client always calls the `getToken` from the most recent committed render.
- **P4. Supplied client.** With `client`, the provider supplies that client unchanged and never closes it. `client={null}` supplies "no client".
- **P5. Identity changes** are expressed by the application with React's `key` on the provider: a new key unmounts the old provider (closing an owned client) and mounts a new one.

### `useSubscription`

- **S1. Lifetime.** Subscribes with `client.subscribe(channel, options)` in an effect when there is a client and `options` is not `null`; unsubscribes when the component unmounts.
- **S2. Identity.** The subscription is identified by the client, `channel`, `channelVersion` and the param *values*. A render with a new `params` object holding equal values, in any key order, keeps the subscription. A change to any part of the identity unsubscribes and subscribes again.
- **S3. Holding off.** `options === null` means no subscription; switching to `null` unsubscribes.
- **S4. Result.** `data` and `revision` are those of the latest `data` event. They are kept while the subscription is `stale` or in any other non-`live` state, so the application can render them as last known, and they are `undefined` for a new identity until its first event. `state` is the subscription's `SubscriptionState`, or `"idle"` when there is no subscription. `live` is `state === "live"`.
- **S5. Errors.** `error` is the latest `StreamError` emitted by the subscription. It is cleared when the subscription becomes `live` and when the identity changes.
- **S6. `resync`.** Calls `Subscription.resync(options)` on the current subscription and returns its promise. With no current subscription it returns a promise rejected with `StreamOtterError` code `INVALID_REQUEST`. Its identity is stable across renders.
- **S7. Cleanup.** Unsubscribing removes every listener the hook added before calling `unsubscribe()`, so no state update follows an unmount. A rejected `unsubscribe()` is ignored.
- **S8. No extra semantics.** The hook adds no caching, retries, or sharing between components: two components subscribing to the same identity hold two subscriptions.

### `useConnectionState`

- **C1.** Returns the client's `ConnectionState` and re-renders on each change, through `useSyncExternalStore`. Returns `"idle"` when there is no client and during server rendering. Unmounting removes its listener.

### `useStreamOtterClient` and `useClient`

- **K1.** Returns the provider's client, or `null` when the provider has none.

### All hooks

- **A1. Provider required.** Every hook throws `StreamOtterError` with code `INVALID_REQUEST` when no `StreamOtterProvider` is above it.
- **A2. Server rendering.** Nothing subscribes, connects or creates a client during server rendering: every effect is a client-side effect, and results are their "no client" values.
- **A3. StrictMode.** Under React StrictMode's development double mount, each component ends with exactly one subscription, and the gateway receives at most one (the SDK registers a subscription a microtask after `subscribe()`, so one unsubscribed in the same task never reaches the network).
- **A4. Typed factory.** `createStreamOtterHooks<C>()` returns the same function objects as the direct exports, typed for `C`: a channel not in `C`, a wrong `channelVersion` type or a params shape not in `C` fails to compile.

## Usage

The client README's [React hooks](https://www.npmjs.com/package/@streamotter/client#react-hooks) section is the user-facing guide; the reference example's `examples/order-dashboard/src/web/react.tsx` is a complete page.

## Traceability

Unit tests are in `packages/client/test/react.test.ts` (on a fake client), integration tests in `tests/integration/react.test.ts` (on the fixture gateway). Every test name starts with the clauses it covers.

| Clause | Tests |
| --- | --- |
| P1 | unit "P1/P2/K1" (null before the mount effect, closed on unmount); integration "P1/S1/S4/S5/A3" |
| P2 | unit "P1/P2/K1" |
| P3 | integration "P3" (a new `getToken` keeps the client; `reconnect()` calls the new one) |
| P4 | unit "P4/S1" (supplied client never closed); every other fake-client unit test supplies a client |
| P5 | follows from P1; the reference example keys its provider by user |
| S1 | unit "P4/S1", "S1/S4/S5/S7"; integration "P1/S1/S4/S5/A3" |
| S2 | unit "S2/S4" (equal values, changed value), "S2" (key order), "S2/S5" (client) |
| S3 | unit "S3" |
| S4 | unit "S1/S4/S5/S7", "S2/S4"; integration "P1/S1/S4/S5/A3" |
| S5 | unit "S1/S4/S5/S7", "S2/S5"; integration "P1/S1/S4/S5/A3" (`FORBIDDEN`) |
| S6 | unit "S6" |
| S7 | unit "S1/S4/S5/S7" |
| S8 | by construction (the module holds no shared state); not separately tested |
| C1 | unit "C1" |
| K1 | unit "P1/P2/K1" |
| A1 | unit "A1" (all three hooks) |
| A2 | unit "A2" (`renderToString` with an owned and a supplied client) |
| A3 | unit "A3"; integration "P1/S1/S4/S5/A3" (gateway subscription count) |
| A4 | unit "A4"; install test type check of the packed declarations (`@ts-expect-error` cases) |

## Decisions

| Date (Pacific) | Decision |
| --- | --- |
| 2026-10-06 | Subpath of `@streamotter/client`, not a new package (plan). |
| 2026-10-06 | Both the factory and the directly typed hooks are exported; `getToken` changes keep the client and `key` switches users; no Suspense variant (plan's open decisions, taken as recommended). |
| 2026-10-06 | Absent values are `undefined`, not `null`, because `null` is valid channel data (`Json` includes `null`). |
| 2026-10-06 | `SubscriptionOptions<C, K>` is exported as a named type so applications can type wrappers around `useSubscription`; it was inline in the plan. |
| 2026-10-06 | Hooks outside a provider throw (A1) rather than returning "idle", so a missing provider fails loudly in development. |
| 2026-10-06 | This contract was written after the prototype, at the owner's direction to lock the API on paper before building on it. Writing it changed the code in one place: the exported `SubscriptionOptions` type. It also added the A2 and P3 tests and clause IDs in test names. |
