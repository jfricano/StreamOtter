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

- **P1. Owned client.** With `options`, the provider creates a client with `createClient(options)` in an effect after mounting, and closes it when it unmounts. Before the effect runs (first render, server rendering) the provider supplies `null`. `options` must carry a `getToken` function, as `createClient` requires; otherwise the provider throws `StreamOtterError` with code `INVALID_REQUEST` during render.
- **P2. Replacement.** A change of `options.origin` or `options.path` closes the client and creates a new one. Any other change to `options`, including a new `getToken` function, keeps the client.
- **P3. Latest `getToken`.** The owned client always calls the `getToken` from the most recent committed render.
- **P4. Supplied client.** With `client`, the provider supplies that client unchanged and never closes it. `client={null}` supplies "no client".
- **P5. Identity changes** are expressed by the application with React's `key` on the provider: a new key unmounts the old provider (closing an owned client) and mounts a new one.

### `useSubscription`

- **S1. Lifetime.** Subscribes with `client.subscribe(channel, options)` in an effect when there is a client and `options` is not `null`; unsubscribes when the component unmounts.
- **S2. Identity.** The subscription is identified by the client, `channel`, `channelVersion` and the param *values*. A render with a new `params` object holding equal values, in any key order, keeps the subscription; a value of another type (`1` against `"1"`) does not. A change to any part of the identity unsubscribes and subscribes again. `options` must have a numeric `channelVersion` and a params object; otherwise the hook throws `StreamOtterError` with code `INVALID_REQUEST` during render.
- **S3. Holding off.** `options === null` means no subscription; switching to `null` unsubscribes. When the same identity returns later, the hook subscribes again and renders that subscription's own state from the start: no render shows the data, state or `live` of the subscription that was unsubscribed.
- **S4. Result.** `data` and `revision` are those of the latest `data` event. They are kept while the subscription is `stale` or in any other non-`live` state, so the application can render them as last known, and they are `undefined` for a new identity until its first event. `state` is the subscription's `SubscriptionState`, or `"idle"` when there is no subscription. `live` is `state === "live"`.
- **S5. Errors.** `error` is the latest `StreamError` emitted by the subscription. It is cleared when the subscription becomes `live` and when the identity changes.
- **S6. `resync`.** Calls `Subscription.resync(options)` on the current subscription and returns its promise. With no current subscription it returns a promise rejected with `StreamOtterError` code `INVALID_REQUEST`. Its identity is stable across renders.
- **S7. Cleanup.** Unsubscribing removes every listener the hook added before calling `unsubscribe()`, so no state update follows an unmount. A rejected `unsubscribe()` is ignored.
- **S8. No extra semantics.** The hook adds no caching, retries, or sharing between components: two components subscribing to the same identity hold two subscriptions.
- **S9. Closed client.** While the client's `state` is `"closed"`, the hook subscribes to nothing and renders its no-subscription values. This covers an owned client between its replacement (P2) and the render that delivers the new one, and a supplied client the application has closed. Any other error `client.subscribe` throws is a programming error and propagates from the effect.

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
| P1 | unit "P1/P2/K1" (null before the mount effect, closed on unmount), "P1" (no `getToken`), "P1/P4" (switching from a supplied client to options); integration "P1/S1/S4/S5/S6/A3" |
| P2 | unit "P1/P2/K1" (origin and path), "S9/P2" |
| P3 | integration "P3" (a new `getToken` keeps the client; `reconnect()` calls the new one) |
| P4 | unit "P4/S1" (supplied client never closed), "P1/P4"; every other fake-client unit test supplies a client |
| P5 | unit "P5" (keyed provider) |
| S1 | unit "P4/S1", "S1/S4/S5/S7"; integration "P1/S1/S4/S5/S6/A3" |
| S2 | unit "S2/S4" (equal values, changed value, every render after the change), "S2" (version and channel), "S2" (key order, value type), "S2" (render-time validation), "S2/S5" (client) |
| S3 | unit "S3/S4" (hold off, `live` before `null`, the same identity returning) |
| S4 | unit "S1/S4/S5/S7", "S2/S4", "S3/S4"; integration "P1/S1/S4/S5/S6/A3" |
| S5 | unit "S1/S4/S5/S7", "S2/S5" (every render after the change); integration "P1/S1/S4/S5/S6/A3" (`FORBIDDEN`) |
| S6 | unit "S6" (options forwarded, rejection, identity); integration "P1/S1/S4/S5/S6/A3" (`resync()` through the hook against the gateway) |
| S7 | unit "S1/S4/S5/S7" (no listener left when `unsubscribe()` is called, no render after unmount, with a fake that emits `closed` as the SDK does), "S7" (rejected `unsubscribe()`) |
| S8 | unit "S8" |
| S9 | unit "S9" (supplied closed client), "S9/P2" (owned client replaced in the same commit as a child's identity change) |
| C1 | unit "C1" |
| K1 | unit "P1/P2/K1" |
| A1 | unit "A1" (all three hooks) |
| A2 | unit "A2" (`renderToString` with an owned client and with a connected supplied client) |
| A3 | unit "A3" (two mounts, one open subscription); integration "P1/S1/S4/S5/S6/A3" (gateway subscription count) |
| A4 | unit "A4"; install test type check of the packed declarations, on React 19 and React 18 types (`@ts-expect-error` for a wrong channel, version and params shape) |

## Decisions

| Date (Pacific) | Decision |
| --- | --- |
| 2026-10-06 | Subpath of `@streamotter/client`, not a new package (plan). |
| 2026-10-06 | Both the factory and the directly typed hooks are exported; `getToken` changes keep the client and `key` switches users; no Suspense variant (plan's open decisions, taken as recommended). |
| 2026-10-06 | Absent values are `undefined`, not `null`, because `null` is valid channel data (`Json` includes `null`). |
| 2026-10-06 | `SubscriptionOptions<C, K>` is exported as a named type so applications can type wrappers around `useSubscription`; it was inline in the plan. |
| 2026-10-06 | Hooks outside a provider throw (A1) rather than returning "idle", so a missing provider fails loudly in development. |
| 2026-10-06 | This contract was written after the prototype, at the owner's direction to lock the API on paper before building on it. Writing it changed the code in one place: the exported `SubscriptionOptions` type. It also added the A2 and P3 tests and clause IDs in test names. |
| 2026-10-06 | From the independent review: a closed client renders idle (S9) rather than letting `CLIENT_CLOSED` escape from the effect and unmount the React root; the same identity returning after `null` never shows the old subscription (S3, the hook forgets the view when it unsubscribes); `getToken` and the `options` shape are validated during render (P1, S2), as the SDK validates them, so a programming error fails in the component. |
| 2026-10-06 | `StateChange.reason` is not surfaced by `useSubscription`: a disconnect makes a subscription `stale` with the connection error's code as its reason and no subscription-level `error` event, so a hooks user who needs the cause listens on `useClient().on("error")`. Left for a later minor if asked for; adding a field to `SubscriptionResult` is not a breaking change. |
| 2026-10-06 | `client: Client<any>` stays in the provider props. `Client<ChannelMap>` would also accept generated clients (method parameters are bivariant), but `any` says plainly that the provider does not care about the map, and the hooks are typed by the factory. |
