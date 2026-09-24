import {
  compareRevisions, isJsonValue, isPlainObject, isRevision, streamError, validateValue,
  type ErrorCode, type Params, type Revision, type StreamEvent, type SubscriptionState
} from "@streamotter/contracts";
import { SubscriptionBudget } from "./budget.ts";
import { routingKey, type ChannelRuntime, type GatewayCore, type SubscriptionHost } from "./core.ts";
import { describeError, invokeHandler, newId, nowIso, sha256Hex } from "./util.ts";

/** A full-state frame waiting in a subscription's buffer or send queue. */
export interface PendingFrame {
  readonly event: StreamEvent;
  readonly bytes: number;
  readonly revision: Revision;
  readonly dataHash: string;
}

/** Envelope overhead added to serialized events when estimating frame bytes. */
export const FRAME_OVERHEAD_BYTES = 128;

export type AdmitResult = "queued" | "filtered" | "overflow" | "inactive";

type Phase =
  | "idle"
  | "authorizing"      // authorize handler pending
  | "waiting-source"   // stale; waiting for the source to become ready (no snapshot calls)
  | "capturing"        // registered for live capture; snapshot pending; updates buffered
  | "snapshot-sent"    // snapshot in flight; updates still buffered
  | "draining"         // releasing buffered updates up to the captured boundary
  | "live"
  | "backoff"          // stale; retry scheduled
  | "resync-required"
  | "terminated";

const CAPTURING: ReadonlySet<Phase> = new Set(["capturing", "snapshot-sent", "draining", "live"]);

/**
 * Server side of one subscription. Implements the V1 synchronization sequence:
 * authorize → require source → capture → snapshot → recheck → send snapshot →
 * receipt → drain buffered newer states → live. Each attempt is a new epoch;
 * invalidation discards the previous generation's frames and handler results.
 */
export class ServerSubscription {
  readonly id: string;
  readonly channel: ChannelRuntime;
  readonly params: Params;
  readonly canonicalParams: string;
  readonly routingKey: string;
  readonly contractKey: string;
  readonly budget: SubscriptionBudget;
  readonly #host: SubscriptionHost;
  readonly #core: GatewayCore;

  #phase: Phase = "idle";
  #publicState: SubscriptionState = "idle";
  #epoch = "";
  #sequence = 0;
  #generation = 0;
  #controller = new AbortController();
  #attempts = 0;
  #retryTimer: NodeJS.Timeout | null = null;
  #queue: PendingFrame[] = [];
  #inFlight: (PendingFrame & { sequence: number }) | null = null;
  #receiptTimer: NodeJS.Timeout | null = null;
  #drainRemaining = 0;
  #snapshotRevision: Revision | null = null;
  #tail: { revision: Revision; dataHash: string } | null = null;
  #lastDelivered: Revision | null = null;

  constructor(options: {
    id: string;
    channel: ChannelRuntime;
    params: Params;
    canonicalParams: string;
    host: SubscriptionHost;
    core: GatewayCore;
  }) {
    this.id = options.id;
    this.channel = options.channel;
    this.params = options.params;
    this.canonicalParams = options.canonicalParams;
    this.#host = options.host;
    this.#core = options.core;
    this.routingKey = routingKey(this.channel.name, this.channel.version, this.#host.principal.tenantId, this.canonicalParams);
    this.contractKey = JSON.stringify([this.channel.name, this.channel.version, this.canonicalParams]);
    const { limits } = this.#core;
    this.budget = new SubscriptionBudget(limits.maxPendingFramesPerSubscription, limits.maxPendingBytesPerSubscription, this.#host.connectionBudget);
  }

  get state(): SubscriptionState {
    return this.#publicState;
  }

  get phase(): string {
    return this.#phase;
  }

  get epoch(): string {
    return this.#epoch;
  }

  get terminated(): boolean {
    return this.#phase === "terminated";
  }

  get capturing(): boolean {
    return CAPTURING.has(this.#phase);
  }

  start(requestId: string): void {
    this.channel.subscriptions.add(this);
    void this.#beginAttempt(false, requestId);
  }

  /**
   * Client-requested resynchronization. Coalesces with a synchronization that has
   * not yet sent its snapshot (the client will still see a new epoch). Once the
   * client has seen this epoch's frames, a request starts a new epoch.
   */
  requestResync(requestId: string): void {
    switch (this.#phase) {
      case "backoff":
      case "snapshot-sent":
      case "draining":
        void this.#beginAttempt(true, requestId);
        return;
      case "live":
      case "resync-required":
        this.#attempts = 0;
        void this.#beginAttempt(true, requestId);
        return;
      default:
        return;
    }
  }

  onSourceUnavailable(reason: ErrorCode): void {
    switch (this.#phase) {
      case "authorizing":
      case "capturing":
      case "snapshot-sent":
      case "draining":
      case "live":
      case "backoff":
        this.#invalidate();
        this.#phase = "waiting-source";
        this.#sendState("stale", reason);
        return;
      default:
        return;
    }
  }

  onSourceReady(): void {
    if (this.#phase === "waiting-source") void this.#beginAttempt(true, newId());
  }

  /** Terminal failure: discards pending data and removes the subscription. */
  fail(code: ErrorCode, requestId: string, message?: string): void {
    if (this.#phase === "terminated") return;
    this.#invalidate();
    this.#phase = "terminated";
    this.channel.subscriptions.delete(this);
    this.#host.sendError({
      subscriptionId: this.id,
      epoch: this.#epoch,
      error: streamError(code, message === undefined ? { requestId } : { requestId, message })
    });
    this.#sendState("failed", code);
    this.#host.removeSubscription(this.id);
  }

  /** Silent teardown for unsubscribe or connection closure. */
  dispose(): void {
    if (this.#phase === "terminated") return;
    this.#invalidate();
    this.#phase = "terminated";
    this.#publicState = "closed";
    this.channel.subscriptions.delete(this);
  }

  /** True when admitting this state would conflict with the current state at the same revision. */
  conflicts(revision: Revision, dataHash: string): boolean {
    if (!this.capturing || this.#tail === null) return false;
    return this.#tail.revision === revision && this.#tail.dataHash !== dataHash;
  }

  /**
   * Admits a mapped full state and records the queue outcome under the record's
   * request ID (before any resulting send). Never waits: overflow invalidates this
   * generation instead.
   */
  admit(frame: PendingFrame, requestId: string): AdmitResult {
    if (!this.capturing) return "inactive";
    if (this.#tail !== null && compareRevisions(frame.revision, this.#tail.revision) <= 0) {
      this.#trace("queue", "filtered", undefined, requestId);
      return "filtered";
    }
    if (!this.budget.tryReserve(frame.bytes)) {
      this.#trace("queue", "rejected", "OVERLOADED", requestId);
      this.#attemptFailed("OVERLOADED", newId());
      return "overflow";
    }
    this.#trace("queue", "ok", undefined, requestId);
    this.#queue.push(frame);
    this.#tail = { revision: frame.revision, dataHash: frame.dataHash };
    this.#pump();
    return "queued";
  }

  onReceipt(epoch: string, sequence: number): void {
    if (epoch !== this.#epoch || !this.capturing) return;
    const inFlight = this.#inFlight;
    if (inFlight === null || sequence < inFlight.sequence) {
      if (sequence <= this.#sequence) return; // Duplicate receipts are harmless.
      this.#protocolViolation("A receipt was received for a frame that was not sent.");
      return;
    }
    if (sequence > inFlight.sequence) {
      this.#protocolViolation("A receipt skipped an unacknowledged frame.");
      return;
    }
    this.#clearReceiptTimer();
    this.budget.release(inFlight.bytes);
    this.#inFlight = null;
    if (this.#lastDelivered === null || compareRevisions(inFlight.revision, this.#lastDelivered) > 0) {
      this.#lastDelivered = inFlight.revision;
    }
    this.#trace("receipt", "ok");
    if (this.#phase === "snapshot-sent") {
      const boundary = this.#snapshotRevision ?? "0";
      const kept: PendingFrame[] = [];
      for (const frame of this.#queue) {
        if (compareRevisions(frame.revision, boundary) <= 0) {
          this.budget.release(frame.bytes);
          this.#trace("queue", "filtered");
        } else {
          kept.push(frame);
        }
      }
      this.#queue = kept;
      this.#drainRemaining = kept.length;
      this.#phase = "draining";
      if (this.#drainRemaining === 0) this.#goLive();
      else this.#pump();
      return;
    }
    if (this.#phase === "draining") {
      this.#drainRemaining--;
      if (this.#drainRemaining <= 0) {
        this.#goLive();
        return;
      }
    }
    this.#pump();
  }

  // --- synchronization attempts -------------------------------------------------

  async #beginAttempt(announce: boolean, requestId: string): Promise<void> {
    const generation = this.#invalidate();
    const signal = this.#controller.signal;
    this.#attempts++;
    this.#phase = "authorizing";
    if (announce) this.#sendState("authorizing");
    else this.#publicState = "authorizing";

    if (!(await this.#authorize(generation, signal, requestId))) return;

    if (!this.channel.source.ready) {
      this.#attempts--; // Waiting for a source does not consume an attempt.
      this.#phase = "waiting-source";
      this.#sendState("stale", this.channel.source.reason ?? "SOURCE_UNAVAILABLE");
      return;
    }

    this.#epoch = newId();
    this.#sequence = 0;
    this.#sendState("synchronizing");
    this.#phase = "capturing";
    this.#core.router.add(this);

    const { limits } = this.#core;
    const deadline = Date.now() + limits.snapshotTimeoutMs;
    const acquired = await this.#core.snapshots.acquire(signal, deadline);
    if (generation !== this.#generation) {
      if (acquired) this.#core.snapshots.release();
      return;
    }
    if (!acquired) {
      this.#trace("snapshot", "failed", "TIMEOUT");
      this.#attemptFailed("TIMEOUT", requestId);
      return;
    }
    const principal = this.#host.principal;
    const handlers = this.channel.handlers;
    let outcome;
    try {
      outcome = await invokeHandler(
        context => handlers.snapshot({ ...context, principal, params: this.params }),
        { timeoutMs: Math.max(1, deadline - Date.now()), requestId, parent: signal }
      );
    } finally {
      this.#core.snapshots.release();
    }
    if (generation !== this.#generation || outcome.kind === "aborted") return;
    if (outcome.kind === "timeout") {
      this.#trace("snapshot", "failed", "TIMEOUT");
      this.#attemptFailed("TIMEOUT", requestId);
      return;
    }
    if (outcome.kind === "error") {
      this.#trace("snapshot", "failed", "HANDLER_FAILED");
      this.#core.logger.warn("Snapshot handler failed", { channel: this.channel.name, requestId, error: describeError(outcome.error) });
      this.fail("HANDLER_FAILED", requestId);
      return;
    }
    const snapshot: unknown = outcome.value;
    const problem = this.#snapshotProblem(snapshot);
    if (problem !== null) {
      this.#trace("snapshot", "rejected", "INVALID_PAYLOAD");
      this.#core.logger.warn("Snapshot rejected", { channel: this.channel.name, requestId, reason: problem });
      this.fail("INVALID_PAYLOAD", requestId);
      return;
    }
    const { revision, data } = snapshot as { revision: Revision; data: StreamEvent["data"] };
    if (this.#lastDelivered !== null && compareRevisions(revision, this.#lastDelivered) < 0) {
      this.#trace("snapshot", "rejected", "INVALID_PAYLOAD");
      this.#core.logger.warn("Snapshot regressed below delivered state", { channel: this.channel.name, requestId });
      this.#attemptFailed("INVALID_PAYLOAD", requestId);
      return;
    }
    this.#trace("snapshot", "ok");

    // Recheck authorization and token validity immediately before delivery.
    if (!(await this.#authorize(generation, signal, requestId))) return;

    const event: StreamEvent = {
      id: newId(),
      channel: this.channel.name,
      channelVersion: this.channel.version,
      kind: "snapshot",
      data,
      revision,
      receivedAt: nowIso()
    };
    const bytes = Buffer.byteLength(JSON.stringify(event)) + FRAME_OVERHEAD_BYTES;
    if (bytes > limits.maxDataFrameBytes) {
      this.#trace("snapshot", "rejected", "INVALID_PAYLOAD");
      this.#core.logger.warn("Snapshot exceeds maxDataFrameBytes", { channel: this.channel.name, requestId, bytes });
      this.fail("INVALID_PAYLOAD", requestId);
      return;
    }
    if (!this.budget.tryReserve(bytes)) {
      this.#trace("queue", "rejected", "OVERLOADED");
      this.#attemptFailed("OVERLOADED", requestId);
      return;
    }
    const dataHash = sha256Hex(data);
    this.#snapshotRevision = revision;
    if (this.#tail === null || compareRevisions(revision, this.#tail.revision) >= 0) {
      this.#tail = { revision, dataHash };
    }
    this.#phase = "snapshot-sent";
    this.#transmit({ event, bytes, revision, dataHash });
  }

  async #authorize(generation: number, signal: AbortSignal, requestId: string): Promise<boolean> {
    const revocationSeq = this.#core.revocations.sequence;
    const principal = this.#host.principal;
    const outcome = await invokeHandler(
      context => this.channel.handlers.authorize({ ...context, principal, params: this.params }),
      { timeoutMs: this.#core.limits.handlerTimeoutMs, requestId, parent: signal }
    );
    if (generation !== this.#generation || outcome.kind === "aborted") return false;
    if (outcome.kind === "timeout") {
      this.#trace("authorize", "failed", "TIMEOUT");
      this.#attemptFailed("TIMEOUT", requestId);
      return false;
    }
    if (outcome.kind === "error") {
      this.#trace("authorize", "failed", "HANDLER_FAILED");
      this.#core.logger.warn("Authorize handler failed", { channel: this.channel.name, requestId, error: describeError(outcome.error) });
      this.fail("HANDLER_FAILED", requestId);
      return false;
    }
    if (outcome.value !== true) {
      this.#trace("authorize", "rejected", "FORBIDDEN");
      this.fail("FORBIDDEN", requestId);
      return false;
    }
    if (!this.#host.canDeliver()) return false;
    const channel = { name: this.channel.name, version: this.channel.version, canonicalParams: this.canonicalParams };
    if (this.#core.revocations.revokedSince(revocationSeq, principal, channel)) {
      this.#trace("authorize", "rejected", "FORBIDDEN");
      this.fail("FORBIDDEN", requestId);
      return false;
    }
    this.#trace("authorize", "ok");
    return true;
  }

  #snapshotProblem(snapshot: unknown): string | null {
    if (!isPlainObject(snapshot)) return "snapshot must return an object";
    for (const key of Object.keys(snapshot)) {
      if (key !== "revision" && key !== "data") return `unexpected snapshot field "${key}"`;
    }
    if (!isRevision(snapshot["revision"])) return "revision must be a canonical unsigned decimal string";
    if (!isJsonValue(snapshot["data"])) return "data must be JSON";
    const issue = validateValue(this.channel.payloadSchema, snapshot["data"]);
    return issue === null ? null : `data ${issue.path}: ${issue.message}`;
  }

  /** A failed attempt: stale, then bounded retry with one- then two-second backoff. */
  #attemptFailed(code: ErrorCode, requestId: string): void {
    const generation = this.#invalidate();
    this.#phase = "backoff";
    this.#sendState("stale", code);
    if (this.#attempts >= this.#core.limits.maxSyncAttempts) {
      this.#phase = "resync-required";
      this.#host.sendError({ subscriptionId: this.id, epoch: this.#epoch, error: streamError("RESYNC_REQUIRED", { requestId }) });
      this.#sendState("resync-required", "RESYNC_REQUIRED");
      return;
    }
    const delay = this.#attempts === 0 ? 0 : 1_000 * 2 ** (this.#attempts - 1);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (generation === this.#generation && this.#phase === "backoff") void this.#beginAttempt(true, newId());
    }, delay);
  }

  /** Interrupts an active generation (overflow, protocol violation) and resynchronizes. */
  #interrupt(code: ErrorCode): void {
    this.#trace("queue", "rejected", code);
    this.#attemptFailed(code, newId());
  }

  #protocolViolation(message: string): void {
    this.#host.sendError({
      subscriptionId: this.id,
      epoch: this.#epoch,
      error: streamError("INVALID_REQUEST", { message, requestId: newId() })
    });
    this.#interrupt("INVALID_REQUEST");
  }

  #goLive(): void {
    this.#phase = "live";
    this.#attempts = 0;
    this.#sendState("live");
    this.#pump();
  }

  // --- delivery ------------------------------------------------------------------

  #pump(): void {
    if (this.#inFlight !== null) return;
    if (this.#phase !== "draining" && this.#phase !== "live") return;
    const next = this.#queue.shift();
    if (next !== undefined) this.#transmit(next);
  }

  #transmit(frame: PendingFrame): void {
    if (!this.#host.canDeliver()) {
      this.budget.release(frame.bytes);
      return;
    }
    if (this.#sequence >= Number.MAX_SAFE_INTEGER - 1) {
      this.budget.release(frame.bytes);
      this.#interrupt("OVERLOADED");
      return;
    }
    this.#sequence++;
    this.#inFlight = { ...frame, sequence: this.#sequence };
    this.#host.sendData({ subscriptionId: this.id, epoch: this.#epoch, sequence: this.#sequence, event: frame.event });
    this.#trace("send", "ok");
    this.#receiptTimer = setTimeout(() => {
      this.#receiptTimer = null;
      this.#trace("receipt", "failed", "OVERLOADED");
      this.#host.receiptTimedOut();
    }, this.#core.limits.receiptTimeoutMs);
  }

  #clearReceiptTimer(): void {
    if (this.#receiptTimer !== null) {
      clearTimeout(this.#receiptTimer);
      this.#receiptTimer = null;
    }
  }

  /** Starts a new generation: aborts handlers, drops frames, and leaves the routing index. */
  #invalidate(): number {
    this.#generation++;
    this.#controller.abort();
    this.#controller = new AbortController();
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#clearReceiptTimer();
    for (const frame of this.#queue) this.budget.release(frame.bytes);
    this.#queue = [];
    if (this.#inFlight !== null) {
      this.budget.release(this.#inFlight.bytes);
      this.#inFlight = null;
    }
    this.#drainRemaining = 0;
    this.#snapshotRevision = null;
    this.#tail = null;
    this.#core.router.remove(this);
    return this.#generation;
  }

  #sendState(state: SubscriptionState, reason?: ErrorCode): void {
    this.#publicState = state;
    this.#host.sendState(reason === undefined
      ? { subscriptionId: this.id, epoch: this.#epoch, state }
      : { subscriptionId: this.id, epoch: this.#epoch, state, reason });
  }

  #trace(stage: "authorize" | "snapshot" | "queue" | "send" | "receipt", outcome: "ok" | "filtered" | "rejected" | "failed", errorCode?: ErrorCode, requestId?: string): void {
    this.#core.traces.record({
      requestId: requestId ?? (this.#epoch || this.id),
      stage,
      outcome,
      sourceId: this.channel.source.id,
      channel: this.channel.name,
      subscriptionId: this.id,
      ...(errorCode === undefined ? {} : { errorCode })
    });
  }
}
