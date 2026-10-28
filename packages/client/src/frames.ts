import {
  isErrorCode, isRevision, isStreamError, type DataFrame, type ErrorFrame, type Hello, type Result, type StreamEvent,
  type SubscriptionFrame, type SubscriptionState
} from "@streamotter/contracts";
import { isPlainObject } from "@streamotter/contracts/internal";

const SUBSCRIPTION_STATES: ReadonlySet<string> = new Set<SubscriptionState>([
  "idle", "authorizing", "synchronizing", "live", "stale", "resync-required", "failed", "closed"
]);

/** Whether a value has the shape of a protocol version 1 Socket.IO so:hello frame with a non-empty identity key. */
export function isHello(value: unknown): value is Hello {
  return isPlainObject(value)
    && value["protocolVersion"] === 1
    && value["transport"] === "socket.io"
    && Array.isArray(value["deliveryModes"])
    && Array.isArray(value["operations"])
    && typeof value["connectionId"] === "string"
    && typeof value["identityKey"] === "string" && value["identityKey"].length > 0
    && typeof value["authExpiresAt"] === "string";
}

/** Whether a value is a subscription state frame with a known state and, if present, a known error code as its reason. */
export function isSubscriptionFrame(value: unknown): value is SubscriptionFrame {
  return isPlainObject(value)
    && typeof value["subscriptionId"] === "string"
    && typeof value["epoch"] === "string"
    && typeof value["state"] === "string" && SUBSCRIPTION_STATES.has(value["state"])
    && (value["reason"] === undefined || isErrorCode(value["reason"]));
}

/** Whether a value is a snapshot or update event with a channel, version, revision, timestamp and own `data` property. */
export function isStreamEvent(value: unknown): value is StreamEvent {
  return isPlainObject(value)
    && typeof value["id"] === "string"
    && typeof value["channel"] === "string"
    && typeof value["channelVersion"] === "number"
    && (value["kind"] === "snapshot" || value["kind"] === "update")
    && Object.hasOwn(value, "data")
    && isRevision(value["revision"])
    && typeof value["receivedAt"] === "string";
}

/** Whether a value is a data frame: subscription id, epoch, a safe integer sequence of at least 1, and a valid event. */
export function isDataFrame(value: unknown): value is DataFrame {
  return isPlainObject(value)
    && typeof value["subscriptionId"] === "string"
    && typeof value["epoch"] === "string"
    && typeof value["sequence"] === "number" && Number.isSafeInteger(value["sequence"]) && value["sequence"] >= 1
    && isStreamEvent(value["event"]);
}

/** Whether a value is an error frame, optionally scoped to a subscription and epoch. */
export function isErrorFrame(value: unknown): value is ErrorFrame {
  return isPlainObject(value)
    && isStreamError(value["error"])
    && (value["subscriptionId"] === undefined || typeof value["subscriptionId"] === "string")
    && (value["epoch"] === undefined || typeof value["epoch"] === "string");
}

/** Whether a value is a control acknowledgement: `ok: true` with own `data`, or `ok: false` with a valid error. */
export function isResult(value: unknown): value is Result<unknown> {
  if (!isPlainObject(value) || typeof value["requestId"] !== "string") return false;
  if (value["ok"] === true) return Object.hasOwn(value, "data");
  return value["ok"] === false && isStreamError(value["error"]);
}
