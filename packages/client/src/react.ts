/**
 * React bindings for the browser SDK (V1.3), published as `@streamotter/client/react` and
 * `streamotter/react`. A provider shares one client with a component tree, and hooks render a
 * subscription's data together with the delivery state that says whether it is current.
 *
 * Hooks subscribe in effects, so nothing connects during server rendering, and a React StrictMode
 * double mount subscribes and unsubscribes before the first request leaves the page.
 *
 * The behavior below is specified clause by clause in `docs/releases/v1.3/API.md`; the clause IDs
 * in these comments (P1, S2, ...) refer to it, and the tests cite the same IDs.
 *
 * @example
 * ```tsx
 * import { createStreamOtterHooks, StreamOtterProvider } from "@streamotter/client/react";
 * import type { AppChannels } from "./generated/streamotter.ts";
 *
 * export const { useSubscription, useConnectionState } = createStreamOtterHooks<AppChannels>();
 *
 * function OrderStatus({ orderId }: { orderId: string }) {
 *   const order = useSubscription("orderStatus", { channelVersion: 1, params: { orderId } });
 *   if (order.data === undefined) return <p>Loading…</p>;
 *   return <p className={order.live ? "" : "stale"}>{order.data.status}</p>;
 * }
 *
 * export function App({ user }: { user: string }) {
 *   return (
 *     <StreamOtterProvider key={user} options={{ getToken: fetchStreamToken }}>
 *       <OrderStatus orderId="ord_1" />
 *     </StreamOtterProvider>
 *   );
 * }
 * ```
 *
 * @module
 */
import {
  createContext, createElement, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore,
  type ReactElement, type ReactNode
} from "react";
import {
  StreamOtterError,
  type ChannelMap, type Client, type ClientOptions, type ConnectionState, type Json, type Params, type Revision,
  type StreamError, type Subscription, type SubscriptionState, type WaitOptions
} from "@streamotter/contracts";
import { createClient } from "./client.ts";

/** `undefined` means no provider above the hook; `null` means the provider has no client yet. */
const ClientContext = createContext<Client<ChannelMap> | null | undefined>(undefined);

/**
 * Props for {@link StreamOtterProvider}: either a `client` you manage or `options` for a client the
 * provider manages, never both.
 */
export type StreamOtterProviderProps = {
  /** The components that use the hooks. */
  children?: ReactNode;
} & (
  | {
    /**
     * A client you create with `createClient` and close yourself. The provider supplies it unchanged
     * and never closes it (P4). Pass `null` while there is none, for example before sign-in; hooks
     * then report their "no client" values.
     */
    client: Client<any> | null;
    options?: never;
  }
  | {
    /**
     * Options for a client the provider creates after mounting and closes when it unmounts (P1).
     * A new `origin` or `path` closes the client and creates another (P2). `getToken` is always read
     * from the latest render, so an inline function keeps the client (P3). To switch users, give the
     * provider a `key` for the signed-in identity (P5).
     */
    options: ClientOptions;
    client?: never;
  }
);

/**
 * Shares one StreamOtter client with the hooks below it. Every hook must have a provider above it.
 *
 * With `options`, the provider supplies `null` until its client exists: on the first client render
 * and throughout server rendering.
 *
 * @example
 * ```tsx
 * // The provider owns the client; a new key closes it and creates one for the next user.
 * <StreamOtterProvider key={session.user} options={{ getToken: () => fetchStreamToken(session) }}>
 *   <Dashboard />
 * </StreamOtterProvider>
 *
 * // Or share a client you manage yourself.
 * <StreamOtterProvider client={client}>
 *   <Dashboard />
 * </StreamOtterProvider>
 * ```
 */
export function StreamOtterProvider(props: StreamOtterProviderProps): ReactElement {
  const owned = useOwnedClient(props.options);
  const value = props.options === undefined ? props.client ?? null : owned;
  return createElement(ClientContext.Provider, { value }, props.children);
}

function useOwnedClient(options: ClientOptions | undefined): Client<ChannelMap> | null {
  const getToken = useRef(options?.getToken);
  useEffect(() => { getToken.current = options?.getToken; });
  const enabled = options !== undefined;
  const origin = options?.origin;
  const path = options?.path;
  const [client, setClient] = useState<Client<ChannelMap> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // Created in the effect that closes it: close() is permanent, and StrictMode runs effects twice
    // in development, so a client created during render would be closed and then reused.
    const created = createClient<ChannelMap>({
      ...(origin !== undefined && { origin }),
      ...(path !== undefined && { path }),
      getToken: context => {
        const current = getToken.current;
        if (current === undefined) throw new StreamOtterError("CLIENT_CLOSED");
        return current(context);
      }
    });
    setClient(created);
    return () => {
      setClient(null);
      void created.close();
    };
  }, [enabled, origin, path]);
  return client;
}

/**
 * The provider's client, or `null` while the provider has none (K1). Use it for imperative calls such
 * as `reconnect()` after the application's session is restored. Prefer the `useClient` returned by
 * {@link createStreamOtterHooks}, which is the same function typed for your channels.
 *
 * @typeParam C - The channel map the client is typed for.
 * @throws {@link StreamOtterError} with code `INVALID_REQUEST` outside a {@link StreamOtterProvider} (A1).
 */
export function useStreamOtterClient<C extends ChannelMap = ChannelMap>(): Client<C> | null {
  const client = useContext(ClientContext);
  if (client === undefined) {
    throw new StreamOtterError("INVALID_REQUEST", { message: "StreamOtter hooks must be used inside a <StreamOtterProvider>." });
  }
  return client as Client<C> | null;
}

const noop = (): void => {};

/**
 * The client's `ConnectionState`, re-rendering on each change (C1). It is `"idle"` while there is no
 * client and during server rendering, so a server-rendered page and its first client render agree.
 *
 * @example
 * ```tsx
 * function ConnectionBadge() {
 *   const state = useConnectionState();
 *   return state === "connected" ? null : <span>Reconnecting…</span>;
 * }
 * ```
 *
 * @throws {@link StreamOtterError} with code `INVALID_REQUEST` outside a {@link StreamOtterProvider} (A1).
 */
export function useConnectionState(): ConnectionState {
  const client = useStreamOtterClient();
  const subscribe = useCallback((onChange: () => void) => client === null ? noop : client.on("state", onChange), [client]);
  const read = (): ConnectionState => client === null ? "idle" : client.state;
  return useSyncExternalStore(subscribe, read, () => "idle");
}

/**
 * The `options` argument of {@link useSubscription}: the channel version the component was written
 * against and the params that select one stream on the channel. Exported so applications can type
 * wrappers around `useSubscription`.
 *
 * @typeParam C - The channel map, usually the generated `AppChannels`.
 * @typeParam K - The channel name.
 */
export type SubscriptionOptions<C extends ChannelMap, K extends keyof C & string> = {
  /** The channel contract version this component renders. */
  channelVersion: C[K]["version"];
  /** The channel's params. Compared by value, so a new object with equal values keeps the subscription (S2). */
  params: C[K]["params"];
};

/**
 * What {@link useSubscription} renders: the latest data and the delivery state that says whether it
 * is current. Absent values are `undefined`, because `null` is valid channel data.
 *
 * @typeParam D - The channel's data type.
 */
export interface SubscriptionResult<D extends Json> {
  /**
   * The latest snapshot or update (S4). Kept while the subscription is `stale` or otherwise not
   * `live`, so render it as last known. `undefined` until the first event, and again after the
   * channel, version, param values or client change.
   */
  data: D | undefined;
  /** The revision of `data`, or `undefined` when there is no `data`. */
  revision: Revision | undefined;
  /** The subscription's state, or `"idle"` while there is no client or `options` is `null`. */
  state: SubscriptionState;
  /** `true` when `state` is `"live"`: `data` is current. */
  live: boolean;
  /**
   * The latest error the subscription reported (S5), such as `FORBIDDEN` or `SOURCE_UNAVAILABLE`.
   * Cleared when the subscription becomes `live` and when the channel, version, param values or
   * client change.
   */
  error: StreamError | undefined;
  /**
   * Requests a fresh snapshot from the gateway; see `Subscription.resync` (S6). The function is the
   * same on every render, so it can go in a dependency list.
   *
   * @returns The subscription's `resync` promise, or a promise rejected with `StreamOtterError` code
   * `INVALID_REQUEST` while there is no subscription.
   */
  resync(options?: WaitOptions): Promise<void>;
}

interface View {
  client: Client<ChannelMap> | null;
  key: string | null;
  data: Json | undefined;
  revision: Revision | undefined;
  state: SubscriptionState;
  error: StreamError | undefined;
}

/** Params in a canonical order, so a new object with the same values keeps the subscription. */
function paramsKey(params: Params): string {
  if (typeof params !== "object" || params === null) {
    throw new StreamOtterError("INVALID_REQUEST", { message: "useSubscription requires a channelVersion and params." });
  }
  return JSON.stringify(Object.keys(params).sort().map(name => {
    const value = params[name];
    return [name, typeof value, String(value)];
  }));
}

/**
 * Subscribes to one channel stream while the component is mounted, and renders its data and state.
 *
 * The hook subscribes in an effect and unsubscribes on unmount (S1), or when the client, channel,
 * version or param values change (S2). Params are compared by value, so an inline object literal is
 * fine. Pass `null` as `options` to hold off, for example until an id is known (S3). Each call holds
 * its own subscription; the hook adds no caching, retries or sharing (S8).
 *
 * Prefer the `useSubscription` returned by {@link createStreamOtterHooks}, which is this function
 * typed for your channels.
 *
 * @example
 * ```tsx
 * function OrderStatus({ orderId }: { orderId: string | null }) {
 *   const order = useSubscription("orderStatus", orderId === null ? null : { channelVersion: 1, params: { orderId } });
 *   if (order.error?.code === "FORBIDDEN") return <p>You can't see this order.</p>;
 *   if (order.data === undefined) return <p>Loading…</p>;
 *   return <p>{order.data.status}{order.live ? "" : " (reconnecting)"}</p>;
 * }
 * ```
 *
 * @typeParam C - The channel map, usually the generated `AppChannels`.
 * @typeParam K - The channel name.
 * @param channel - The channel to subscribe to.
 * @param options - The channel version and params, or `null` for no subscription.
 * @throws {@link StreamOtterError} with code `INVALID_REQUEST` outside a {@link StreamOtterProvider}
 * (A1), or when `options` has no params object.
 */
export function useSubscription<C extends ChannelMap = ChannelMap, K extends keyof C & string = keyof C & string>(
  channel: K,
  options: SubscriptionOptions<C, K> | null
): SubscriptionResult<C[K]["data"]> {
  const client = useStreamOtterClient<C>();
  const key = options === null
    ? null
    : `${channel}\u0000${String(options.channelVersion)}\u0000${paramsKey(options.params)}`;
  const [view, setView] = useState<View>(() => ({ client: null, key: null, data: undefined, revision: undefined, state: "idle", error: undefined }));
  const current = useRef<Subscription<C[K]["data"]> | null>(null);

  useEffect(() => {
    if (client === null || key === null || options === null) return;
    // `options` is this render's; the key holds its values, so a later render with equal values keeps this subscription.
    const subscription = client.subscribe(channel, { channelVersion: options.channelVersion, params: options.params });
    current.current = subscription;
    const owner = client as Client<ChannelMap>;
    const update = (change: Partial<View>): void => setView(previous => ({ ...previous, ...change }));
    setView({ client: owner, key, data: undefined, revision: undefined, state: subscription.state, error: undefined });
    const offData = subscription.on("data", event => update({ data: event.data, revision: event.revision }));
    const offState = subscription.on("state", change => update(change.state === "live" ? { state: "live", error: undefined } : { state: change.state }));
    const offError = subscription.on("error", error => update({ error }));
    return () => {
      offData();
      offState();
      offError();
      if (current.current === subscription) current.current = null;
      subscription.unsubscribe().catch(noop);
    };
    // The key stands for channel and options.
  }, [client, key]);

  const resync = useCallback((waitOptions?: WaitOptions): Promise<void> => {
    const subscription = current.current;
    if (subscription === null) return Promise.reject(new StreamOtterError("INVALID_REQUEST", { message: "There is no active subscription to resynchronize." }));
    return subscription.resync(waitOptions);
  }, []);

  const shown = client !== null && view.client === client && view.key === key && key !== null;
  const state = shown ? view.state : "idle";
  return {
    data: shown ? view.data as C[K]["data"] | undefined : undefined,
    revision: shown ? view.revision : undefined,
    state,
    live: state === "live",
    error: shown ? view.error : undefined,
    resync
  };
}

/**
 * The hooks typed for one channel map, returned by {@link createStreamOtterHooks}.
 *
 * @typeParam C - The channel map, usually the generated `AppChannels`.
 */
export interface StreamOtterHooks<C extends ChannelMap> {
  /**
   * {@link useSubscription} typed for `C`: the channel name, `channelVersion` and params are checked
   * against your channels, and `data` has the channel's data type.
   */
  useSubscription<K extends keyof C & string>(channel: K, options: SubscriptionOptions<C, K> | null): SubscriptionResult<C[K]["data"]>;
  /** {@link useStreamOtterClient} typed for `C`. */
  useClient(): Client<C> | null;
  /** {@link useConnectionState}. */
  useConnectionState(): ConnectionState;
}

/**
 * Returns the hooks typed for your generated channels (A4). Call it once in a module of your own
 * and import the hooks from there. It returns the same functions as the direct exports, so it costs
 * nothing at run time; a channel not in `C`, a wrong `channelVersion` or a wrong params shape fails
 * to compile.
 *
 * @example
 * ```ts
 * // src/streamotter.ts
 * import { createStreamOtterHooks } from "@streamotter/client/react";
 * import type { AppChannels } from "./generated/streamotter.ts";
 *
 * export const { useSubscription, useClient, useConnectionState } = createStreamOtterHooks<AppChannels>();
 * ```
 *
 * @typeParam C - The channel map, usually the generated `AppChannels`.
 */
export function createStreamOtterHooks<C extends ChannelMap>(): StreamOtterHooks<C> {
  return {
    useSubscription: useSubscription as StreamOtterHooks<C>["useSubscription"],
    useClient: useStreamOtterClient as StreamOtterHooks<C>["useClient"],
    useConnectionState
  };
}
