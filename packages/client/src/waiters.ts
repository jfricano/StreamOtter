import { StreamOtterError, type StreamError, type WaitOptions } from "@streamotter/contracts";
import { asStreamOtterError, DEFAULT_READY_TIMEOUT_MS } from "@streamotter/contracts/internal";

/**
 * A set of independent waiters. Each waiter has its own timeout and signal;
 * cancelling one never affects the others or the operation they wait for.
 */
export class WaiterSet {
  readonly #waiters = new Set<{ resolve: () => void; reject: (error: StreamError) => void }>();

  /** Number of callers still waiting. */
  get size(): number {
    return this.#waiters.size;
  }

  /**
   * Adds a waiter that settles on the next resolveAll or rejectAll. Rejects with CANCELLED when the
   * signal aborts and with TIMEOUT after `timeoutMs` (default DEFAULT_READY_TIMEOUT_MS).
   */
  wait(options: WaitOptions | undefined): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const signal = options?.signal;
    if (signal?.aborted) return Promise.reject(new StreamOtterError("CANCELLED"));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#waiters.delete(waiter);
      };
      const waiter = {
        resolve: () => { cleanup(); resolve(); },
        reject: (error: StreamError) => { cleanup(); reject(asStreamOtterError(error)); }
      };
      const onAbort = () => waiter.reject(new StreamOtterError("CANCELLED"));
      const timer = setTimeout(() => waiter.reject(new StreamOtterError("TIMEOUT", {
        message: `The subscription did not become live within ${timeoutMs} ms.`
      })), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
    });
  }

  /** Resolves every current waiter. */
  resolveAll(): void {
    for (const waiter of [...this.#waiters]) waiter.resolve();
  }

  /** Rejects every current waiter with the error as a StreamOtterError. */
  rejectAll(error: StreamError): void {
    for (const waiter of [...this.#waiters]) waiter.reject(error);
  }
}
