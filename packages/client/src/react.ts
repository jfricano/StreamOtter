/**
 * React bindings for the browser SDK (V1.3). A provider shares one client with a component tree,
 * and hooks render a subscription's data together with the delivery state that says whether it is
 * current. Hooks subscribe in effects, so nothing connects during server rendering, and a React
 * StrictMode double mount subscribes and unsubscribes before the first request leaves the page.
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

export type StreamOtterProviderProps = { children?: ReactNode } & (
  /** A client you create and close yourself. Pass `null` while there is none (for example, before sign-in). */
  | { client: Client<any> | null; options?: never }
  /**
   * Options for a client the provider creates after mounting and closes on unmount. A new `origin`
   * or `path` replaces the client; `getToken` is always read from the latest render, so an inline
   * function does not. To switch users, give the provider a `key` for the signed-in identity.
   */
  | { options: ClientOptions; client?: never }
);

/** Shares one StreamOtter client with the hooks below it. */
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

/** The provider's client, or `null` before it exists. Throws outside a `StreamOtterProvider`. */
export function useStreamOtterClient<C extends ChannelMap = ChannelMap>(): Client<C> | null {
  const client = useContext(ClientContext);
  if (client === undefined) {
    throw new StreamOtterError("INVALID_REQUEST", { message: "StreamOtter hooks must be used inside a <StreamOtterProvider>." });
  }
  return client as Client<C> | null;
}

const noop = (): void => {};

/** The client's connection state; `"idle"` while there is no client and during server rendering. */
export function useConnectionState(): ConnectionState {
  const client = useStreamOtterClient();
  const subscribe = useCallback((onChange: () => void) => client === null ? noop : client.on("state", onChange), [client]);
  const read = (): ConnectionState => client === null ? "idle" : client.state;
  return useSyncExternalStore(subscribe, read, () => "idle");
}

export interface SubscriptionResult<D extends Json> {
  /** The latest snapshot or update. Kept while `stale`, so render it as last known; cleared when the channel, version, params, or client change. */
  data: D | undefined;
  /** The revision of `data`. */
  revision: Revision | undefined;
  /** `"idle"` while there is no client or `options` is `null`. */
  state: SubscriptionState;
  /** `state === "live"`: `data` is current. */
  live: boolean;
  /** The latest error since the subscription was last `live`. */
  error: StreamError | undefined;
  /** Requests a fresh snapshot; see `Subscription.resync`. Rejects while there is no subscription. */
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
 * Subscribes while mounted and unsubscribes on unmount, or when the channel, version, param values,
 * or client change. Pass `null` as `options` to hold off (for example, until an id is known).
 */
export function useSubscription<C extends ChannelMap = ChannelMap, K extends keyof C & string = keyof C & string>(
  channel: K,
  options: { channelVersion: C[K]["version"]; params: C[K]["params"] } | null
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

export interface StreamOtterHooks<C extends ChannelMap> {
  useSubscription<K extends keyof C & string>(
    channel: K,
    options: { channelVersion: C[K]["version"]; params: C[K]["params"] } | null
  ): SubscriptionResult<C[K]["data"]>;
  useClient(): Client<C> | null;
  useConnectionState(): ConnectionState;
}

/**
 * The hooks typed for your generated channels:
 * `export const { useSubscription, useConnectionState } = createStreamOtterHooks<AppChannels>();`
 */
export function createStreamOtterHooks<C extends ChannelMap>(): StreamOtterHooks<C> {
  return {
    useSubscription: useSubscription as StreamOtterHooks<C>["useSubscription"],
    useClient: useStreamOtterClient as StreamOtterHooks<C>["useClient"],
    useConnectionState
  };
}
