import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Mirrors KafkaJS's CHECK_PENDING_REQUESTS_INTERVAL. */
const CHECK_PENDING_REQUESTS_INTERVAL_MS = 10;

interface RequestQueueInternals {
  pending: unknown[];
  throttledUntil: number;
  throttleCheckTimeoutId: NodeJS.Timeout | null;
  checkPendingRequests(): void;
}

let applied = false;

/**
 * KafkaJS 2.2.4's RequestQueue.scheduleCheckPendingRequests schedules
 * setTimeout(throttledUntil - Date.now()) even when nothing is pending. When not
 * throttled that delay is hugely negative, Node clamps it to 1 ms (and on Node 24+
 * prints TimeoutNegativeWarning), and the check reschedules itself: every open
 * connection spins a 1 ms timer until it is destroyed. This replacement schedules a
 * check only while requests are queued, never with a negative delay. It applies
 * only to the exact pinned version and stays behind the source adapter boundary.
 */
export function patchKafkaJsRequestQueue(): boolean {
  if (applied) return true;
  const version = (require("kafkajs/package.json") as { version: string }).version;
  if (version !== "2.2.4") return false;
  const RequestQueue = require("kafkajs/src/network/requestQueue/index.js") as { prototype: RequestQueueInternals & { scheduleCheckPendingRequests(): void } };
  RequestQueue.prototype.scheduleCheckPendingRequests = function (this: RequestQueueInternals): void {
    if (this.throttleCheckTimeoutId !== null || this.pending.length === 0) return;
    const throttledFor = this.throttledUntil - Date.now();
    this.throttleCheckTimeoutId = setTimeout(() => {
      this.throttleCheckTimeoutId = null;
      this.checkPendingRequests();
    }, throttledFor > 0 ? throttledFor : CHECK_PENDING_REQUESTS_INTERVAL_MS);
  };
  applied = true;
  return true;
}
