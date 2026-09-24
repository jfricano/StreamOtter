import {
  asStreamOtterError, compareRevisions, EVENTS, streamError, StreamOtterError, UNSUBSCRIBE_TIMEOUT_MS,
  type DataFrame, type ErrorCode, type Json, type Params, type Revision, type StateChange, type StreamError,
  type StreamEvent, type Subscription, type SubscriptionFrame, type SubscriptionState, type Unlisten, type WaitOptions
} from "@streamotter/contracts";
import type { Connection } from "./connection.ts";
import { WaiterSet } from "./waiters.ts";

/** The client's non-generic view of a subscription. */
export interface ManagedSubscription {
  readonly id: string;
  attach(connection: Connection): void;
  detach(reason?: ErrorCode): void;
  authRequired(error: StreamError): void;
  terminateLocally(state: "closed" | "failed", error: StreamError, emit: boolean): void;
  handleState(connection: Connection, frame: SubscriptionFrame): void;
  handleData(connection: Connection, frame: DataFrame): void;
  handleError(connection: Connection, error: StreamError): void;
}

/** What a subscription needs from its client. */
export interface SubscriptionOwner {
  readonly closed: boolean;
  readonly authRequired: boolean;
  /** The current authenticated connection, if any. */
  readonly connection: Connection | null;
  register(subscription: ManagedSubscription): void;
  unregister(subscription: ManagedSubscription): void;
  /** A control request was not acknowledged; the connection must be replaced. */
  controlTimedOut(connection: Connection): void;
  randomId(): string;
  logListenerFailure(error: unknown): void;
}

type Listener = (value: never) => unknown;

/** SDK-detected synchronization failures tolerated per incident before resync-required. */
const LOCAL_SYNC_ATTEMPTS = 3;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null
    && typeof (value as { then?: unknown }).then === "function";
}

/**
 * Client side of one subscription. Accepts an epoch only after its ordered
 * `synchronizing` frame, validates sequence and revision order, confirms SDK
 * receipt after synchronous listener dispatch, and never reports `live` for a
 * disconnected or superseded view.
 */
export class ClientSubscription<D extends Json = Json> implements Subscription<D>, ManagedSubscription {
  readonly id: string;
  readonly channel: string;
  readonly channelVersion: number;
  readonly params: Params;
  readonly #owner: SubscriptionOwner;
  readonly #listeners = {
    data: new Set<(event: StreamEvent<D>) => void>(),
    state: new Set<(state: StateChange<SubscriptionState>) => void>(),
    error: new Set<(error: StreamError) => void>()
  };
  readonly #waiters = new WaiterSet();
  #state: SubscriptionState = "idle";
  #reason: ErrorCode | undefined;
  #terminal = false;
  #attached: Connection | null = null;
  #serverKnows = false;
  #epoch: string | null = null;
  /** Set after we ask the gateway to replace `#epoch`; old-epoch progress is ignored. */
  #replacing: string | null = null;
  #awaitingEpoch = true;
  #expectedSequence = 1;
  #epochRevision: Revision | null = null;
  #lastRevision: Revision | null = null;
  #localFailures = 0;
  #lastError: StreamError | null = null;
  #unsubscribing: Promise<void> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(owner: SubscriptionOwner, channel: string, channelVersion: number, params: Params) {
    this.#owner = owner;
    this.id = owner.randomId();
    this.channel = channel;
    this.channelVersion = channelVersion;
    this.params = params;
    // Start in the next microtask so synchronously attached listeners miss nothing.
    queueMicrotask(() => {
      if (!this.#terminal) this.#owner.register(this);
    });
  }

  get state(): SubscriptionState {
    return this.#state;
  }

  get active(): boolean {
    return !this.#terminal;
  }

  on(event: "data", listener: (event: StreamEvent<D>) => void): Unlisten;
  on(event: "state", listener: (state: StateChange<SubscriptionState>) => void): Unlisten;
  on(event: "error", listener: (error: StreamError) => void): Unlisten;
  on(event: "data" | "state" | "error", listener: Listener): Unlisten {
    const set = this.#listeners[event] as Set<Listener> | undefined;
    if (set === undefined || typeof listener !== "function") {
      throw new StreamOtterError("INVALID_REQUEST", { message: "on() accepts \"data\", \"state\", or \"error\" with a function." });
    }
    set.add(listener);
    return () => { set.delete(listener); };
  }

  ready(options?: WaitOptions): Promise<void> {
    if (this.#state === "live") return Promise.resolve();
    const blocked = this.#blockedError();
    if (blocked !== null) return Promise.reject(asStreamOtterError(blocked));
    return this.#waiters.wait(options);
  }

  resync(options?: WaitOptions): Promise<void> {
    const blocked = this.#blockedError(true);
    if (blocked !== null) return Promise.reject(asStreamOtterError(blocked));
    const wait = this.#waiters.wait(options);
    this.#localFailures = 0;
    this.#requestFreshSynchronization();
    return wait;
  }

  unsubscribe(): Promise<void> {
    if (this.#unsubscribing !== null) return this.#unsubscribing;
    const connection = this.#attached;
    const serverKnows = this.#serverKnows;
    this.#terminate("closed", undefined, new StreamOtterError("CANCELLED", { message: "The subscription was unsubscribed." }));
    this.#unsubscribing = serverKnows && connection !== null && connection.connected
      ? this.#sendUnsubscribe(connection)
      : Promise.resolve();
    return this.#unsubscribing;
  }

  // --- called by the client ----------------------------------------------------------

  /** Subscribes on a freshly authenticated connection. */
  attach(connection: Connection): void {
    if (this.#terminal) return;
    this.#clearRetry();
    this.#attached = connection;
    this.#serverKnows = false;
    this.#epoch = null;
    this.#replacing = null;
    this.#awaitingEpoch = true;
    this.#setState("authorizing");
    void this.#subscribe(connection);
  }

  /** The transport was lost; the view is stale until a new synchronization completes. */
  detach(reason?: ErrorCode): void {
    this.#clearRetry();
    this.#attached = null;
    this.#serverKnows = false;
    this.#awaitingEpoch = true;
    this.#replacing = null;
    if (this.#terminal || this.#state === "resync-required") return;
    this.#setState("stale", reason);
  }

  /** Authentication was rejected; waiting for an explicit reconnect(). */
  authRequired(error: StreamError): void {
    this.detach("UNAUTHENTICATED");
    if (!this.#terminal) this.#waiters.rejectAll(error);
  }

  /** Terminates without contacting the server (client close or identity change). */
  terminateLocally(state: "closed" | "failed", error: StreamError, emit: boolean): void {
    if (this.#terminal) return;
    if (emit) this.#emitError(error);
    this.#terminate(state, error.code, error);
  }

  handleState(connection: Connection, frame: SubscriptionFrame): void {
    if (this.#terminal || connection !== this.#attached) return;
    // A frame proves the gateway holds this subscription, even if its acknowledgement
    // continuation has not run yet (both can arrive in one socket read).
    this.#serverKnows = true;
    if (frame.state === "synchronizing") {
      if (frame.epoch === this.#epoch && !this.#awaitingEpoch) return;
      this.#epoch = frame.epoch;
      this.#replacing = null;
      this.#awaitingEpoch = false;
      this.#expectedSequence = 1;
      this.#epochRevision = null;
      this.#setState("synchronizing");
      return;
    }
    if (frame.epoch !== (this.#epoch ?? "")) return;
    if (this.#replacing !== null && frame.epoch === this.#replacing
      && (frame.state === "live" || frame.state === "resync-required")) {
      return; // Progress of the epoch we asked the gateway to replace.
    }
    if (frame.state === "live" && this.#awaitingEpoch) return;
    switch (frame.state) {
      case "failed":
        this.#serverKnows = false;
        this.#terminate("failed", frame.reason, this.#lastError ?? streamError(frame.reason ?? "INTERNAL"));
        return;
      case "closed":
        this.#serverKnows = false;
        this.#terminate("closed", frame.reason, this.#lastError ?? streamError(frame.reason ?? "CANCELLED"));
        return;
      case "resync-required":
        this.#setState("resync-required", frame.reason ?? "RESYNC_REQUIRED");
        return;
      case "live":
        this.#localFailures = 0;
        this.#setState("live");
        return;
      case "stale":
      case "authorizing":
        this.#setState(frame.state, frame.reason);
        return;
      default:
        return;
    }
  }

  handleData(connection: Connection, frame: DataFrame): void {
    if (this.#terminal || connection !== this.#attached) return;
    this.#serverKnows = true;
    if (this.#awaitingEpoch || frame.epoch !== this.#epoch) return;
    if (frame.sequence !== this.#expectedSequence) {
      this.#localSyncFailure("INVALID_REQUEST", `Expected sequence ${this.#expectedSequence} but received ${frame.sequence}.`);
      return;
    }
    const event = frame.event;
    if (event.channel !== this.channel || event.channelVersion !== this.channelVersion) {
      this.#localSyncFailure("INVALID_PAYLOAD", "A frame named a different channel contract.");
      return;
    }
    if (frame.sequence === 1) {
      if (event.kind !== "snapshot") {
        this.#localSyncFailure("INVALID_REQUEST", "The first frame of an epoch must be a snapshot.");
        return;
      }
      if (this.#lastRevision !== null && compareRevisions(event.revision, this.#lastRevision) < 0) {
        this.#localSyncFailure("INVALID_PAYLOAD", "The snapshot is older than state this subscription already delivered.");
        return;
      }
    } else if (event.kind !== "update" || (this.#epochRevision !== null && compareRevisions(event.revision, this.#epochRevision) <= 0)) {
      this.#localSyncFailure("INVALID_REQUEST", "Updates must follow the snapshot in increasing revision order.");
      return;
    }
    this.#expectedSequence++;
    this.#epochRevision = event.revision;
    if (this.#lastRevision === null || compareRevisions(event.revision, this.#lastRevision) > 0) this.#lastRevision = event.revision;
    for (const listener of [...this.#listeners.data]) {
      if (!this.#invoke(listener, event as StreamEvent<D>)) return;
    }
    connection.receipt({ subscriptionId: this.id, epoch: frame.epoch, sequence: frame.sequence });
  }

  handleError(connection: Connection, error: StreamError): void {
    if (this.#terminal || connection !== this.#attached) return;
    this.#lastError = error;
    this.#emitError(error);
  }

  // --- internals -----------------------------------------------------------------------

  #blockedError(forResync = false): StreamError | null {
    if (this.#owner.closed && this.#state === "closed") return streamError("CLIENT_CLOSED");
    if (this.#terminal) {
      if (this.#state === "failed") return this.#lastError ?? streamError("INTERNAL");
      return this.#owner.closed ? streamError("CLIENT_CLOSED") : streamError("CANCELLED", { message: "The subscription was unsubscribed." });
    }
    if (this.#owner.authRequired) return streamError("UNAUTHENTICATED", { message: "Authentication is required; call reconnect()." });
    if (!forResync && this.#state === "resync-required") return streamError("RESYNC_REQUIRED");
    return null;
  }

  async #subscribe(connection: Connection): Promise<void> {
    let result;
    try {
      result = await connection.request<{ subscriptionId: string }>(EVENTS.subscribe, {
        requestId: this.#owner.randomId(),
        subscriptionId: this.id,
        channel: this.channel,
        channelVersion: this.channelVersion,
        params: this.params
      });
    } catch (error) {
      if (connection !== this.#attached || this.#terminal) return;
      if ((error as StreamError).code === "TIMEOUT") this.#owner.controlTimedOut(connection);
      return;
    }
    if (connection !== this.#attached || this.#terminal) return;
    if (result.ok) {
      this.#serverKnows = true;
      return;
    }
    this.#lastError = result.error;
    this.#emitError(result.error);
    if (result.error.code === "OVERLOADED") {
      // Rate or subscription limit: bounded retry (one- then two-second backoff), then resync-required.
      this.#localFailures++;
      if (this.#localFailures >= LOCAL_SYNC_ATTEMPTS) {
        this.#setState("resync-required", "OVERLOADED");
        return;
      }
      this.#setState("stale", "OVERLOADED");
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = null;
        if (this.#attached === connection && connection.connected && !this.#terminal) this.attach(connection);
      }, 1_000 * 2 ** (this.#localFailures - 1));
      return;
    }
    this.#terminate("failed", result.error.code, result.error);
  }

  #clearRetry(): void {
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #requestFreshSynchronization(): void {
    const connection = this.#attached;
    if (connection === null || !connection.connected) return; // Reconnection resynchronizes.
    if (!this.#serverKnows) {
      if (this.#state === "authorizing") return; // A subscribe is already in flight.
      this.attach(connection);
      return;
    }
    if (this.#state === "authorizing" || this.#state === "synchronizing") return; // Joins the running synchronization.
    this.#replacing = this.#epoch;
    this.#awaitingEpoch = true;
    this.#setState("authorizing");
    connection.request(EVENTS.resync, { requestId: this.#owner.randomId(), subscriptionId: this.id }).then(result => {
      if (connection !== this.#attached || this.#terminal || result.ok) return;
      this.#lastError = result.error;
      this.#emitError(result.error);
      if (result.error.code === "INVALID_REQUEST") this.attach(connection); // The gateway no longer knows it.
    }, (error: StreamError) => {
      if (connection === this.#attached && !this.#terminal && error.code === "TIMEOUT") this.#owner.controlTimedOut(connection);
    });
  }

  /** The SDK rejected a frame. Resynchronize, bounded per incident. */
  #localSyncFailure(code: ErrorCode, message: string): void {
    const error = streamError(code, { message, requestId: this.#owner.randomId() });
    this.#lastError = error;
    this.#emitError(error);
    if (this.#terminal) return;
    this.#localFailures++;
    if (this.#localFailures >= LOCAL_SYNC_ATTEMPTS) {
      const connection = this.#attached;
      if (this.#serverKnows && connection !== null && connection.connected) void this.#sendUnsubscribe(connection);
      this.#serverKnows = false;
      this.#awaitingEpoch = true;
      this.#setState("resync-required", "RESYNC_REQUIRED");
      return;
    }
    this.#setState("stale", code);
    this.#requestFreshSynchronization();
  }

  #sendUnsubscribe(connection: Connection): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = setTimeout(resolve, UNSUBSCRIBE_TIMEOUT_MS);
      connection.request(EVENTS.unsubscribe, { requestId: this.#owner.randomId(), subscriptionId: this.id })
        .then(() => undefined, () => undefined)
        .finally(() => { clearTimeout(timer); resolve(); });
    });
  }

  #terminate(state: "closed" | "failed", reason: ErrorCode | undefined, error: StreamError): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#clearRetry();
    this.#attached = null;
    this.#owner.unregister(this);
    this.#lastError = error;
    this.#setState(state, reason, true);
    this.#waiters.rejectAll(error);
    this.#listeners.data.clear();
    this.#listeners.state.clear();
    this.#listeners.error.clear();
  }

  #setState(state: SubscriptionState, reason?: ErrorCode, force = false): void {
    if (this.#terminal && !force) return;
    if (this.#state === state && this.#reason === reason) return;
    this.#state = state;
    this.#reason = reason;
    const change: StateChange<SubscriptionState> = reason === undefined ? { state } : { state, reason };
    for (const listener of [...this.#listeners.state]) {
      if (!this.#invoke(listener, change)) return;
    }
    if (state === "live") this.#waiters.resolveAll();
    else if (state === "resync-required") this.#waiters.rejectAll(streamError("RESYNC_REQUIRED"));
  }

  /** Runs a data/state listener. Failures become HANDLER_FAILED and fail the subscription. */
  #invoke<T>(listener: (value: T) => unknown, value: T): boolean {
    let returned: unknown;
    try {
      returned = listener(value);
    } catch (error) {
      this.#listenerFailed(error);
      return false;
    }
    if (isThenable(returned)) {
      Promise.resolve(returned).catch((error: unknown) => this.#listenerFailed(error));
    }
    return true;
  }

  #listenerFailed(cause: unknown): void {
    if (this.#terminal) return;
    this.#owner.logListenerFailure(cause);
    const error = streamError("HANDLER_FAILED", {
      message: "A subscription listener threw; the subscription failed.",
      requestId: this.#owner.randomId()
    });
    const connection = this.#attached;
    const serverKnows = this.#serverKnows;
    this.#emitError(error);
    this.#terminate("failed", "HANDLER_FAILED", error);
    if (serverKnows && connection !== null && connection.connected) void this.#sendUnsubscribe(connection);
  }

  /** Error-listener failures are logged, never re-emitted. */
  #emitError(error: StreamError): void {
    for (const listener of [...this.#listeners.error]) {
      try {
        const returned = listener(error);
        if (isThenable(returned)) Promise.resolve(returned).catch((cause: unknown) => this.#owner.logListenerFailure(cause));
      } catch (cause) {
        this.#owner.logListenerFailure(cause);
      }
    }
  }
}
