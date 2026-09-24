import {
  CAPABILITIES, canonicalizeParams, canonicalJson, isIdentifier, isPlainObject, isUuid, parseUtcTimestamp,
  REQUEST_CACHE_ENTRIES, REQUEST_CACHE_TTL_MS, streamError, utf8ByteLength,
  type DataFrame, type ErrorCode, type ErrorFrame, type Json, type Principal, type Result, type StreamError,
  type SubscriptionFrame
} from "@streamotter/contracts";
import { ByteBudget } from "./budget.ts";
import type { ChannelRuntime, GatewayCore, SubscriptionHost } from "./core.ts";
import { ServerSubscription } from "./subscription.ts";
import { newId, setLongTimeout, TokenBucket } from "./util.ts";
import type { ConnectionTransport } from "../transport/types.ts";

type Reply = (result: Result<unknown>) => void;

interface CachedResult { fingerprint: string; result: Result<unknown>; expiresAt: number }

export interface SessionOwner {
  readonly core: GatewayCore;
  channel(name: string): ChannelRuntime | undefined;
  sessionClosed(session: ClientSession): void;
}

const SUBSCRIBE_KEYS = new Set(["requestId", "subscriptionId", "channel", "channelVersion", "params"]);
const CONTROL_KEYS = new Set(["requestId", "subscriptionId"]);
const RECEIPT_KEYS = new Set(["subscriptionId", "epoch", "sequence"]);

/**
 * One authenticated transport connection. Validates every client message, applies
 * per-connection rate and size limits, and owns its subscriptions.
 */
export class ClientSession implements SubscriptionHost {
  readonly connectionId = newId();
  readonly principal: Principal;
  readonly identityKey: string;
  readonly previewSessionId: string | null;
  readonly connectionBudget: ByteBudget;
  readonly #owner: SessionOwner;
  readonly #transport: ConnectionTransport;
  readonly #subscriptions = new Map<string, ServerSubscription>();
  readonly #requests = new Map<string, CachedResult>();
  readonly #bucket: TokenBucket;
  readonly #expiresAtMs: number;
  #expiryTimer: { clear(): void } | null = null;
  #closed = false;

  constructor(options: {
    owner: SessionOwner;
    transport: ConnectionTransport;
    principal: Principal;
    identityKey: string;
    previewSessionId: string | null;
  }) {
    this.#owner = options.owner;
    this.#transport = options.transport;
    this.principal = options.principal;
    this.identityKey = options.identityKey;
    this.previewSessionId = options.previewSessionId;
    const { limits, gatewayBudget } = this.#owner.core;
    this.connectionBudget = new ByteBudget(limits.maxPendingBytesPerConnection, gatewayBudget);
    this.#bucket = new TokenBucket(limits.controlRequestsPerSecond, limits.controlRequestsPerSecond * 2);
    this.#expiresAtMs = parseUtcTimestamp(this.principal.expiresAt);
  }

  get closed(): boolean {
    return this.#closed;
  }

  get subscriptionCount(): number {
    return this.#subscriptions.size;
  }

  subscriptions(): IterableIterator<ServerSubscription> {
    return this.#subscriptions.values();
  }

  open(): void {
    this.#transport.sendHello({
      ...CAPABILITIES,
      connectionId: this.connectionId,
      identityKey: this.identityKey,
      authExpiresAt: this.principal.expiresAt
    });
    this.#expiryTimer = setLongTimeout(() => this.#expire(), this.#expiresAtMs - Date.now());
  }

  // --- SubscriptionHost ------------------------------------------------------------

  sendState(frame: SubscriptionFrame): void {
    if (!this.#closed) this.#transport.sendState(frame);
  }

  sendData(frame: DataFrame): void {
    if (!this.#closed) this.#transport.sendData(frame);
  }

  sendError(frame: ErrorFrame): void {
    if (!this.#closed) this.#transport.sendError(frame);
  }

  canDeliver(): boolean {
    if (this.#closed) return false;
    if (Date.now() >= this.#expiresAtMs) {
      queueMicrotask(() => this.#expire());
      return false;
    }
    return true;
  }

  receiptTimedOut(): void {
    this.close(streamError("OVERLOADED", {
      message: "The client did not confirm receipt in time; reconnect to resynchronize.",
      requestId: newId()
    }));
  }

  removeSubscription(subscriptionId: string): void {
    this.#subscriptions.delete(subscriptionId);
  }

  // --- protocol handlers -----------------------------------------------------------

  handleSubscribe(payload: unknown, reply: unknown): void {
    if (this.#closed) return;
    this.#control("so:subscribe", payload, reply, SUBSCRIBE_KEYS, (request, requestId) => {
      const subscriptionId = request["subscriptionId"];
      const channelName = request["channel"];
      const version = request["channelVersion"];
      const params = request["params"];
      if (!isUuid(subscriptionId)) return this.#err("INVALID_REQUEST", requestId, "subscriptionId must be a UUID.");
      if (typeof channelName !== "string" || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
        return this.#err("INVALID_REQUEST", requestId, "channel and channelVersion are required.");
      }
      if (!isPlainObject(params)) return this.#err("INVALID_PARAMS", requestId);
      const channel = isIdentifier(channelName) ? this.#owner.channel(channelName) : undefined;
      if (channel === undefined || channel.version !== version) {
        // Unrecognized channels and versions are publicly indistinguishable from denial.
        this.#owner.core.traces.record({
          requestId, stage: "authorize", outcome: "rejected",
          errorCode: channel === undefined ? "CHANNEL_NOT_FOUND" : "CHANNEL_VERSION_UNSUPPORTED",
          ...(channel === undefined ? {} : { channel: channel.name, sourceId: channel.source.id }),
          subscriptionId
        });
        return this.#err("FORBIDDEN", requestId);
      }
      let encoded: string;
      try {
        encoded = canonicalJson(params);
      } catch {
        return this.#err("INVALID_PARAMS", requestId);
      }
      if (utf8ByteLength(encoded) > this.#owner.core.limits.maxParamsBytes) return this.#err("INVALID_PARAMS", requestId, "The channel parameters are too large.");
      const canonical = canonicalizeParams(channel.paramsSchema, params);
      if (!canonical.ok) return this.#err("INVALID_PARAMS", requestId, `The channel parameters are invalid at ${canonical.issue.path}.`);

      const existing = this.#subscriptions.get(subscriptionId);
      if (existing !== undefined) {
        const contract = JSON.stringify([channel.name, channel.version, canonical.canonical]);
        if (existing.contractKey !== contract) {
          return this.#err("INVALID_REQUEST", requestId, "This subscription ID is already used for a different contract.");
        }
        return { ok: true, requestId, data: { subscriptionId } };
      }
      if (this.#subscriptions.size >= this.#owner.core.limits.maxSubscriptionsPerConnection) {
        return this.#err("OVERLOADED", requestId, "This connection has reached its subscription limit.");
      }
      const subscription = new ServerSubscription({
        id: subscriptionId,
        channel,
        params: canonical.params,
        canonicalParams: canonical.canonical,
        host: this,
        core: this.#owner.core
      });
      this.#subscriptions.set(subscriptionId, subscription);
      return { ok: true, requestId, data: { subscriptionId }, after: () => subscription.start(requestId) };
    });
  }

  handleUnsubscribe(payload: unknown, reply: unknown): void {
    if (this.#closed) return;
    this.#control("so:unsubscribe", payload, reply, CONTROL_KEYS, (request, requestId) => {
      const subscriptionId = request["subscriptionId"];
      if (!isUuid(subscriptionId)) return this.#err("INVALID_REQUEST", requestId, "subscriptionId must be a UUID.");
      const subscription = this.#subscriptions.get(subscriptionId);
      if (subscription !== undefined) {
        subscription.dispose();
        this.#subscriptions.delete(subscriptionId);
      }
      return { ok: true, requestId, data: null };
    });
  }

  handleResync(payload: unknown, reply: unknown): void {
    if (this.#closed) return;
    this.#control("so:resync", payload, reply, CONTROL_KEYS, (request, requestId) => {
      const subscriptionId = request["subscriptionId"];
      if (!isUuid(subscriptionId)) return this.#err("INVALID_REQUEST", requestId, "subscriptionId must be a UUID.");
      const subscription = this.#subscriptions.get(subscriptionId);
      if (subscription === undefined) return this.#err("INVALID_REQUEST", requestId, "The subscription does not exist on this connection.");
      return { ok: true, requestId, data: null, after: () => subscription.requestResync(requestId) };
    });
  }

  handleReceipt(payload: unknown): void {
    if (this.#closed) return;
    if (!isPlainObject(payload) || Object.keys(payload).some(key => !RECEIPT_KEYS.has(key))
      || !isUuid(payload["subscriptionId"]) || typeof payload["epoch"] !== "string" || payload["epoch"].length > 64
      || typeof payload["sequence"] !== "number" || !Number.isSafeInteger(payload["sequence"]) || payload["sequence"] < 1) {
      this.sendError({ error: streamError("INVALID_REQUEST", { message: "The receipt is malformed.", requestId: newId() }) });
      return;
    }
    // Unsolicited subscription IDs do not allocate server state.
    this.#subscriptions.get(payload["subscriptionId"])?.onReceipt(payload["epoch"], payload["sequence"]);
  }

  handleUnknown(event: string, args: readonly unknown[]): void {
    if (this.#closed) return;
    const error = streamError("UNSUPPORTED_CAPABILITY", {
      message: `The operation "${event.slice(0, 64)}" is not supported by protocol version 1.`,
      requestId: newId()
    });
    const reply = args[args.length - 1];
    if (typeof reply === "function") (reply as Reply)({ ok: false, requestId: error.requestId, error });
    else this.sendError({ error });
  }

  /** The transport closed underneath us. */
  handleTransportClosed(): void {
    this.#teardown();
  }

  /** Closes the connection, optionally telling the client why first. */
  close(error?: StreamError): void {
    if (this.#closed) return;
    if (error !== undefined) this.#transport.sendError({ error });
    this.#teardown();
    this.#transport.close();
  }

  // --- internals -------------------------------------------------------------------

  #expire(): void {
    this.close(streamError("UNAUTHENTICATED", {
      message: "Authentication has expired; reconnect with a new token.",
      retryable: true,
      requestId: newId()
    }));
  }

  #teardown(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#expiryTimer?.clear();
    for (const subscription of this.#subscriptions.values()) subscription.dispose();
    this.#subscriptions.clear();
    this.#requests.clear();
    this.#owner.sessionClosed(this);
  }

  #err(code: ErrorCode, requestId: string, message?: string): Result<never> {
    return { ok: false, requestId, error: streamError(code, message === undefined ? { requestId } : { requestId, message }) };
  }

  /**
   * Shared control-request handling: callback presence, rate limit, shape, the
   * bounded idempotency cache, then the operation. The acceptance callback is sent
   * before any state/data frames the operation produces (`after`).
   */
  #control(
    event: string,
    payload: unknown,
    reply: unknown,
    allowedKeys: ReadonlySet<string>,
    operation: (request: Record<string, unknown>, requestId: string) => Result<unknown> & { after?: () => void }
  ): void {
    if (typeof reply !== "function") {
      this.sendError({ error: streamError("INVALID_REQUEST", { message: `${event} requires an acknowledgement callback.`, requestId: newId() }) });
      return;
    }
    const respond = reply as Reply;
    const requestId = isPlainObject(payload) && isUuid(payload["requestId"]) ? payload["requestId"] : newId();
    if (!this.#bucket.take()) {
      respond(this.#err("OVERLOADED", requestId, "Too many control requests; slow down."));
      return;
    }
    if (!isPlainObject(payload) || !isUuid(payload["requestId"])) {
      respond(this.#err("INVALID_REQUEST", requestId, "requestId must be a UUID."));
      return;
    }
    const unknownKey = Object.keys(payload).find(key => !allowedKeys.has(key));
    if (unknownKey !== undefined) {
      respond(this.#err("UNSUPPORTED_CAPABILITY", requestId, `"${unknownKey.slice(0, 64)}" is not supported by protocol version 1.`));
      return;
    }
    let fingerprint: string;
    try {
      fingerprint = canonicalJson([event, payload as Json]);
    } catch {
      respond(this.#err("INVALID_REQUEST", requestId, "The request is not JSON data."));
      return;
    }
    const now = Date.now();
    const cached = this.#requests.get(requestId);
    if (cached !== undefined && cached.expiresAt > now) {
      respond(cached.fingerprint === fingerprint
        ? cached.result
        : this.#err("INVALID_REQUEST", requestId, "This requestId was already used for a different request."));
      return;
    }
    const { after, ...result } = operation(payload, requestId);
    this.#remember(requestId, fingerprint, result as Result<unknown>, now);
    respond(result as Result<unknown>);
    after?.();
  }

  #remember(requestId: string, fingerprint: string, result: Result<unknown>, now: number): void {
    for (const [key, entry] of this.#requests) {
      if (entry.expiresAt <= now) this.#requests.delete(key);
      else break;
    }
    this.#requests.delete(requestId);
    this.#requests.set(requestId, { fingerprint, result, expiresAt: now + REQUEST_CACHE_TTL_MS });
    while (this.#requests.size > REQUEST_CACHE_ENTRIES) {
      const oldest = this.#requests.keys().next();
      if (oldest.done === true) break;
      this.#requests.delete(oldest.value);
    }
  }
}
