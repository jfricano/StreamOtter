import { asStreamOtterError, DEFAULT_READY_TIMEOUT_MS, StreamOtterError, type StreamError, type WaitOptions } from "@streamotter/contracts";

/**
 * A set of independent waiters. Each waiter has its own timeout and signal;
 * cancelling one never affects the others or the operation they wait for.
 */
export class WaiterSet {
  readonly #waiters = new Set<{ resolve: () => void; reject: (error: StreamError) => void }>();

  get size(): number {
    return this.#waiters.size;
  }

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

  resolveAll(): void {
    for (const waiter of [...this.#waiters]) waiter.resolve();
  }

  rejectAll(error: StreamError): void {
    for (const waiter of [...this.#waiters]) waiter.reject(error);
  }
}
