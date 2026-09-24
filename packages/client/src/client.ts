import {
  asStreamOtterError, DEFAULT_READY_TIMEOUT_MS, DEFAULT_SOCKET_PATH, GET_TOKEN_TIMEOUT_MS, parseUtcTimestamp,
  RECONNECT_BASE_MS, RECONNECT_CAP_MS, streamError, StreamOtterError, TOKEN_REFRESH_LEAD_MS,
  type ChannelMap, type Client, type ClientOptions, type ConnectionState, type ErrorCode, type ErrorFrame, type Hello,
  type Params, type StateChange, type StreamError, type Subscription, type Unlisten, type WaitOptions
} from "@streamotter/contracts";
import { Connection } from "./connection.ts";
import { ClientSubscription, type ManagedSubscription, type SubscriptionOwner } from "./subscription.ts";

function resolveOrigin(origin: string | undefined): string {
  const candidate = origin ?? (globalThis as { location?: { origin?: string } }).location?.origin;
  if (typeof candidate !== "string") {
    throw new StreamOtterError("INVALID_REQUEST", { message: "origin is required outside a browser page." });
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new StreamOtterError("INVALID_REQUEST", { message: "origin must be an absolute http(s) origin." });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== candidate.replace(/\/$/, "")) {
    throw new StreamOtterError("INVALID_REQUEST", { message: "origin must be an absolute http(s) origin without a path." });
  }
  return url.origin;
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Browser SDK client. Owns one Socket.IO connection at a time, reconnects with
 * full-jitter backoff while subscriptions are active, suspends on authentication
 * rejection until reconnect(), refreshes before token expiry, and closes prior
 * subscriptions when the authenticated identity changes.
 */
export class StreamClient<C extends ChannelMap> implements Client<C>, SubscriptionOwner {
  readonly #origin: string;
  readonly #path: string;
  readonly #getToken: ClientOptions["getToken"];
  readonly #stateListeners = new Set<(state: StateChange<ConnectionState>) => void>();
  readonly #errorListeners = new Set<(error: StreamError) => void>();
  readonly #subscriptions = new Set<ManagedSubscription>();
  #state: ConnectionState = "idle";
  #connection: Connection | null = null;
  #identityKey: string | null = null;
  #generation = 0;
  #connecting = false;
  #suspended = false;
  #closed = false;
  #everConnected = false;
  #attempt = 0;
  #lastConnectionError: StreamError | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #tokenAbort: AbortController | null = null;
  #closing: Promise<void> | null = null;

  constructor(options: ClientOptions) {
    if (typeof options !== "object" || options === null || typeof options.getToken !== "function") {
      throw new StreamOtterError("INVALID_REQUEST", { message: "createClient requires a getToken function." });
    }
    this.#origin = resolveOrigin(options.origin);
    this.#path = options.path ?? DEFAULT_SOCKET_PATH;
    if (!this.#path.startsWith("/")) throw new StreamOtterError("INVALID_REQUEST", { message: "path must start with /." });
    this.#getToken = options.getToken;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  // --- SubscriptionOwner ---------------------------------------------------------------

  get closed(): boolean {
    return this.#closed;
  }

  get authRequired(): boolean {
    return this.#suspended;
  }

  get connection(): Connection | null {
    return this.#connection !== null && this.#connection.connected ? this.#connection : null;
  }

  register(subscription: ManagedSubscription): void {
    if (this.#closed) return;
    this.#subscriptions.add(subscription);
    if (this.#suspended) {
      subscription.authRequired(this.#lastConnectionError ?? streamError("UNAUTHENTICATED"));
      return;
    }
    const connection = this.connection;
    if (connection !== null) subscription.attach(connection);
    else this.#ensureConnection();
  }

  unregister(subscription: ManagedSubscription): void {
    this.#subscriptions.delete(subscription);
  }

  controlTimedOut(connection: Connection): void {
    if (connection !== this.#connection) return;
    // After an ambiguous control request, rebuild on a new connection instead of retrying on this one.
    connection.close();
  }

  randomId(): string {
    return randomId();
  }

  logListenerFailure(error: unknown): void {
    console.error("[streamotter] listener failed", error);
  }

  // --- public API ------------------------------------------------------------------------

  subscribe<K extends keyof C & string>(channel: K, options: { channelVersion: C[K]["version"]; params: C[K]["params"] }): Subscription<C[K]["data"]> {
    if (this.#closed) throw new StreamOtterError("CLIENT_CLOSED");
    if (typeof channel !== "string" || typeof options !== "object" || options === null
      || typeof options.channelVersion !== "number" || typeof options.params !== "object" || options.params === null) {
      throw new StreamOtterError("INVALID_REQUEST", { message: "subscribe requires a channel name, channelVersion, and params." });
    }
    const unsupported = Object.keys(options).find(key => key !== "channelVersion" && key !== "params");
    if (unsupported !== undefined) {
      throw new StreamOtterError("UNSUPPORTED_CAPABILITY", { message: `"${unsupported}" is not supported by this SDK version.` });
    }
    return new ClientSubscription<C[K]["data"]>(this, channel, options.channelVersion, { ...options.params } as Params);
  }

  on(event: "state", listener: (state: StateChange<ConnectionState>) => void): Unlisten;
  on(event: "error", listener: (error: StreamError) => void): Unlisten;
  on(event: "state" | "error", listener: ((state: StateChange<ConnectionState>) => void) | ((error: StreamError) => void)): Unlisten {
    const set = (event === "state" ? this.#stateListeners : event === "error" ? this.#errorListeners : undefined) as Set<typeof listener> | undefined;
    if (set === undefined || typeof listener !== "function") {
      throw new StreamOtterError("INVALID_REQUEST", { message: "on() accepts \"state\" or \"error\" with a function." });
    }
    set.add(listener);
    return () => { set.delete(listener); };
  }

  /** Obtains a new token, replaces the connection, and recreates active subscriptions with fresh snapshots. */
  reconnect(options?: WaitOptions): Promise<void> {
    if (this.#closed) return Promise.reject(new StreamOtterError("CLIENT_CLOSED"));
    this.#suspended = false;
    this.#lastConnectionError = null;
    this.#attempt = 0;
    this.#clearReconnectTimer();
    const previous = this.#connection;
    this.#connection = null;
    this.#connecting = false;
    this.#generation++;
    if (previous !== null) {
      previous.close();
      for (const subscription of this.#subscriptions) subscription.detach();
    }
    const wait = this.#waitForConnection(options);
    void this.#connect(true);
    return wait;
  }

  close(): Promise<void> {
    if (this.#closing !== null) return this.#closing;
    this.#closed = true;
    this.#generation++;
    this.#clearReconnectTimer();
    this.#clearRefreshTimer();
    this.#tokenAbort?.abort();
    const error = streamError("CLIENT_CLOSED");
    for (const subscription of [...this.#subscriptions]) subscription.terminateLocally("closed", error, false);
    this.#subscriptions.clear();
    this.#connection?.close();
    this.#connection = null;
    this.#setState("closed");
    this.#stateListeners.clear();
    this.#errorListeners.clear();
    this.#closing = Promise.resolve();
    return this.#closing;
  }

  // --- connection management -------------------------------------------------------------

  #ensureConnection(): void {
    if (this.#closed || this.#suspended || this.#connecting || this.#reconnectTimer !== null) return;
    if (this.#connection !== null) return;
    void this.#connect(false);
  }

  async #connect(explicit: boolean): Promise<void> {
    if (this.#closed) return;
    const generation = ++this.#generation;
    this.#connecting = true;
    this.#setState(this.#everConnected && !explicit ? "reconnecting" : "connecting");
    let opened: { connection: Connection; hello: Hello };
    try {
      opened = await this.#open();
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#connecting = false;
      this.#handleConnectFailure(error as StreamError);
      return;
    }
    if (generation !== this.#generation) {
      opened.connection.close();
      return;
    }
    this.#connecting = false;
    this.#adopt(opened.connection, opened.hello);
  }

  /** getToken (ten-second deadline) then a new authenticated connection. */
  async #open(): Promise<{ connection: Connection; hello: Hello }> {
    const controller = new AbortController();
    this.#tokenAbort = controller;
    let token: string;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      token = await Promise.race([
        Promise.resolve().then(() => this.#getToken({ signal: controller.signal })),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(streamError("UNAUTHENTICATED", { message: "getToken did not resolve within ten seconds.", retryable: true }));
          }, GET_TOKEN_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as StreamError).code === "UNAUTHENTICATED") throw error;
      throw streamError("UNAUTHENTICATED", { message: "getToken failed; call reconnect() once the application session is available.", retryable: true });
    } finally {
      clearTimeout(timer);
      if (this.#tokenAbort === controller) this.#tokenAbort = null;
    }
    if (typeof token !== "string" || token.length === 0) {
      throw streamError("UNAUTHENTICATED", { message: "getToken must resolve to a non-empty string.", retryable: false });
    }
    let connection: Connection | null = null;
    const events = {
      state: (frame: Parameters<ManagedSubscription["handleState"]>[1]) => this.#route(connection, frame.subscriptionId, sub => sub.handleState(connection as Connection, frame)),
      data: (frame: Parameters<ManagedSubscription["handleData"]>[1]) => this.#route(connection, frame.subscriptionId, sub => sub.handleData(connection as Connection, frame)),
      error: (frame: ErrorFrame) => this.#handleErrorFrame(connection, frame),
      disconnect: () => this.#handleDisconnect(connection)
    };
    connection = new Connection({ origin: this.#origin, path: this.#path, token, events });
    const hello = await connection.ready;
    return { connection, hello };
  }

  #adopt(connection: Connection, hello: Hello): void {
    if (this.#closed) {
      connection.close();
      return;
    }
    const previous = this.#connection;
    this.#connection = connection;
    if (previous !== null && previous !== connection) previous.close();
    if (this.#identityKey !== null && hello.identityKey !== this.#identityKey) {
      // Never carry a previous user's view across an account switch.
      const error = streamError("UNAUTHENTICATED", { message: "The authenticated identity changed; create new subscriptions for the new identity." });
      for (const subscription of [...this.#subscriptions]) subscription.terminateLocally("closed", error, true);
      this.#subscriptions.clear();
      this.#emitError(error);
    }
    this.#identityKey = hello.identityKey;
    this.#everConnected = true;
    this.#attempt = 0;
    this.#lastConnectionError = null;
    this.#setState("connected");
    this.#scheduleRefresh(hello.authExpiresAt);
    for (const subscription of [...this.#subscriptions]) subscription.attach(connection);
  }

  #handleConnectFailure(error: StreamError): void {
    this.#lastConnectionError = error;
    this.#emitError(error);
    const suspend = error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN"
      || error.code === "INVALID_REQUEST" || error.code === "UNSUPPORTED_CAPABILITY";
    if (suspend) this.#suspend(error);
    else this.#scheduleReconnect();
  }

  #handleDisconnect(connection: Connection | null): void {
    if (connection === null || connection !== this.#connection) return;
    this.#connection = null;
    this.#clearRefreshTimer();
    const error = this.#lastConnectionError;
    const reason: ErrorCode | undefined = error?.code;
    for (const subscription of this.#subscriptions) subscription.detach(reason);
    if (this.#closed) return;
    if (error !== null && error.code === "UNAUTHENTICATED" && !error.retryable) {
      this.#suspend(error);
      return;
    }
    if (error !== null && error.code === "UNAUTHENTICATED") this.#attempt = 0; // Expiry: reconnect promptly.
    this.#scheduleReconnect();
  }

  #suspend(error: StreamError): void {
    this.#suspended = true;
    this.#clearReconnectTimer();
    this.#setState("auth-required", error.code);
    for (const subscription of [...this.#subscriptions]) subscription.authRequired(error);
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#suspended) return;
    this.#clearReconnectTimer();
    if (this.#subscriptions.size === 0) {
      this.#setState("idle");
      return;
    }
    this.#setState("reconnecting", this.#lastConnectionError?.code);
    const ceiling = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** this.#attempt);
    this.#attempt++;
    const delay = Math.random() * ceiling;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#subscriptions.size === 0) {
        this.#setState("idle");
        return;
      }
      void this.#connect(false);
    }, delay);
  }

  #scheduleRefresh(authExpiresAt: string): void {
    this.#clearRefreshTimer();
    const expiresAt = parseUtcTimestamp(authExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const delay = expiresAt - TOKEN_REFRESH_LEAD_MS - Date.now();
    if (delay <= 0 || delay > 2_147_000_000) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#refresh(expiresAt);
    }, delay);
  }

  /** Replaces the connection with a freshly authenticated one before the token expires. */
  async #refresh(expiresAt: number): Promise<void> {
    if (this.#closed || this.#suspended || this.#connection === null) return;
    const generation = this.#generation;
    try {
      const opened = await this.#open();
      if (generation !== this.#generation || this.#closed || this.#suspended) {
        opened.connection.close();
        return;
      }
      this.#generation++;
      this.#adopt(opened.connection, opened.hello);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#emitError(error as StreamError);
      if (Date.now() + 5_000 < expiresAt) {
        this.#refreshTimer = setTimeout(() => {
          this.#refreshTimer = null;
          void this.#refresh(expiresAt);
        }, 5_000);
      }
    }
  }

  #waitForConnection(options: WaitOptions | undefined): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const signal = options?.signal;
    if (signal?.aborted) return Promise.reject(new StreamOtterError("CANCELLED"));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        unlisten();
      };
      const onAbort = () => { cleanup(); reject(new StreamOtterError("CANCELLED")); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new StreamOtterError("TIMEOUT", { message: `The client did not connect within ${timeoutMs} ms.` }));
      }, timeoutMs);
      const unlisten = this.#onInternalState(state => {
        if (state === "connected") { cleanup(); resolve(); }
        else if (state === "auth-required") { cleanup(); reject(asStreamOtterError(this.#lastConnectionError ?? streamError("UNAUTHENTICATED"))); }
        else if (state === "closed") { cleanup(); reject(new StreamOtterError("CLIENT_CLOSED")); }
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  readonly #internalStateListeners = new Set<(state: ConnectionState) => void>();

  #onInternalState(listener: (state: ConnectionState) => void): () => void {
    this.#internalStateListeners.add(listener);
    return () => { this.#internalStateListeners.delete(listener); };
  }

  #route(connection: Connection | null, subscriptionId: string, handle: (subscription: ManagedSubscription) => void): void {
    if (connection === null || connection !== this.#connection) return;
    for (const subscription of this.#subscriptions) {
      if (subscription.id === subscriptionId) {
        handle(subscription);
        return;
      }
    }
  }

  #handleErrorFrame(connection: Connection | null, frame: ErrorFrame): void {
    if (connection === null || connection !== this.#connection) return;
    if (frame.subscriptionId !== undefined) {
      this.#route(connection, frame.subscriptionId, subscription => subscription.handleError(connection, frame.error));
      return;
    }
    this.#lastConnectionError = frame.error;
    this.#emitError(frame.error);
  }

  #setState(state: ConnectionState, reason?: ErrorCode): void {
    if (this.#state === state) return;
    this.#state = state;
    const change: StateChange<ConnectionState> = reason === undefined ? { state } : { state, reason };
    for (const listener of [...this.#internalStateListeners]) listener(state);
    for (const listener of [...this.#stateListeners]) {
      try {
        listener(change);
      } catch (error) {
        this.logListenerFailure(error);
      }
    }
  }

  #emitError(error: StreamError): void {
    for (const listener of [...this.#errorListeners]) {
      try {
        listener(error);
      } catch (cause) {
        this.logListenerFailure(cause);
      }
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #clearRefreshTimer(): void {
    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
  }
}

/** Creates an idle client; it connects when the first subscription starts. */
export function createClient<C extends ChannelMap>(options: ClientOptions): Client<C> {
  return new StreamClient<C>(options);
}
