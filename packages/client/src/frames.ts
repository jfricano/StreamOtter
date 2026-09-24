import {
  isErrorCode, isPlainObject, isRevision, isStreamError,
  type DataFrame, type ErrorFrame, type Hello, type Result, type StreamEvent, type SubscriptionFrame, type SubscriptionState
} from "@streamotter/contracts";

const SUBSCRIPTION_STATES: ReadonlySet<string> = new Set<SubscriptionState>([
  "idle", "authorizing", "synchronizing", "live", "stale", "resync-required", "failed", "closed"
]);

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

export function isSubscriptionFrame(value: unknown): value is SubscriptionFrame {
  return isPlainObject(value)
    && typeof value["subscriptionId"] === "string"
    && typeof value["epoch"] === "string"
    && typeof value["state"] === "string" && SUBSCRIPTION_STATES.has(value["state"])
    && (value["reason"] === undefined || isErrorCode(value["reason"]));
}

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

export function isDataFrame(value: unknown): value is DataFrame {
  return isPlainObject(value)
    && typeof value["subscriptionId"] === "string"
    && typeof value["epoch"] === "string"
    && typeof value["sequence"] === "number" && Number.isSafeInteger(value["sequence"]) && value["sequence"] >= 1
    && isStreamEvent(value["event"]);
}

export function isErrorFrame(value: unknown): value is ErrorFrame {
  return isPlainObject(value)
    && isStreamError(value["error"])
    && (value["subscriptionId"] === undefined || typeof value["subscriptionId"] === "string")
    && (value["epoch"] === undefined || typeof value["epoch"] === "string");
}

export function isResult(value: unknown): value is Result<unknown> {
  if (!isPlainObject(value) || typeof value["requestId"] !== "string") return false;
  if (value["ok"] === true) return Object.hasOwn(value, "data");
  return value["ok"] === false && isStreamError(value["error"]);
}
