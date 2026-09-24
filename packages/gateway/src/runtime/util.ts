import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, StreamOtterError, type Awaitable, type GatewayLogger, type Json } from "@streamotter/contracts";

export type HandlerOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

/**
 * Invokes an application handler with a deadline and an AbortSignal linked to
 * `parent`. Late results after timeout or abort are ignored.
 */
export async function invokeHandler<T>(
  handler: (context: { signal: AbortSignal; requestId: string }) => Awaitable<T>,
  options: { timeoutMs: number; requestId: string; parent?: AbortSignal | undefined }
): Promise<HandlerOutcome<T>> {
  const controller = new AbortController();
  const { parent } = options;
  if (parent?.aborted) return { kind: "aborted" };
  let settle: ((outcome: HandlerOutcome<T>) => void) | undefined;
  const race = new Promise<HandlerOutcome<T>>(resolve => { settle = resolve; });
  const timer = setTimeout(() => {
    controller.abort(new StreamOtterError("TIMEOUT", { requestId: options.requestId }));
    settle?.({ kind: "timeout" });
  }, options.timeoutMs);
  const onParentAbort = () => {
    controller.abort(new StreamOtterError("CANCELLED", { requestId: options.requestId }));
    settle?.({ kind: "aborted" });
  };
  parent?.addEventListener("abort", onParentAbort, { once: true });
  try {
    Promise.resolve()
      .then(() => handler({ signal: controller.signal, requestId: options.requestId }))
      .then(value => settle?.({ kind: "ok", value }), (error: unknown) => settle?.({ kind: "error", error }));
    return await race;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
    settle = undefined;
  }
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Describes an application error for operator logs without its stack. */
export function describeError(error: unknown): Json {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 200) };
  return { name: typeof error };
}

/** Structured console logger; the default operator diagnostics sink. */
export function consoleLogger(minimum: "info" | "warn" | "error" = "info"): GatewayLogger {
  const order = { info: 0, warn: 1, error: 2 } as const;
  const write = (level: keyof typeof order, message: string, fields?: Readonly<Record<string, Json>>) => {
    if (order[level] < order[minimum]) return;
    const line = JSON.stringify({ at: nowIso(), level, message, ...(fields ?? {}) });
    if (level === "info") console.log(line); else console.error(line);
  };
  return {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
  };
}

export const silentLogger: GatewayLogger = { info() {}, warn() {}, error() {} };

/** setTimeout that tolerates delays beyond the 32-bit timer limit. */
export function setLongTimeout(callback: () => void, delayMs: number): { clear(): void } {
  const MAX = 2_147_000_000;
  let handle: NodeJS.Timeout;
  const schedule = (remaining: number) => {
    handle = setTimeout(() => {
      if (remaining > MAX) schedule(remaining - MAX);
      else callback();
    }, Math.max(0, Math.min(remaining, MAX)));
    handle.unref?.();
  };
  schedule(delayMs);
  return { clear: () => clearTimeout(handle) };
}

/** Counting semaphore whose waits honor a deadline and an abort signal. */
export class Semaphore {
  #available: number;
  readonly #waiters: { resolve: (acquired: boolean) => void }[] = [];

  constructor(permits: number) {
    this.#available = permits;
  }

  acquire(signal: AbortSignal, deadline: number): Promise<boolean> {
    if (signal.aborted || Date.now() >= deadline) return Promise.resolve(false);
    if (this.#available > 0) {
      this.#available--;
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const waiter = {
        resolve: (acquired: boolean) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(acquired);
        }
      };
      const drop = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        waiter.resolve(false);
      };
      const onAbort = () => drop();
      const timer = setTimeout(drop, Math.max(0, deadline - Date.now()));
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  release(): void {
    const next = this.#waiters.shift();
    if (next !== undefined) next.resolve(true);
    else this.#available++;
  }
}

/** Token bucket used for per-connection control-request rate limits. */
export class TokenBucket {
  readonly #ratePerSecond: number;
  readonly #capacity: number;
  #tokens: number;
  #updated = Date.now();

  constructor(ratePerSecond: number, capacity: number) {
    this.#ratePerSecond = ratePerSecond;
    this.#capacity = capacity;
    this.#tokens = capacity;
  }

  take(): boolean {
    const now = Date.now();
    this.#tokens = Math.min(this.#capacity, this.#tokens + ((now - this.#updated) / 1000) * this.#ratePerSecond);
    this.#updated = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}
