import { StreamOtterError, type DiagnosticStep, type Json } from "@streamotter/contracts";
import type { SourceAdapter, SourceSink } from "./types.ts";

export interface FixtureRecord { key: string | null; value: Json }

/**
 * Deterministic development source. Records advance in array order only when
 * requested. A paused fixture keeps its position; resume retries that record.
 */
export class FixtureSourceAdapter implements SourceAdapter {
  readonly kind = "fixture" as const;
  readonly #records: readonly FixtureRecord[];
  readonly #sink: SourceSink;
  readonly #onCommit: () => void;
  #index = 0;
  #paused = false;
  #stopped = false;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(records: readonly FixtureRecord[], sink: SourceSink, onCommit: () => void) {
    this.#records = records;
    this.#sink = sink;
    this.#onCommit = onCommit;
  }

  get position(): { index: number; total: number; paused: boolean } {
    return { index: this.#index, total: this.#records.length, paused: this.#paused };
  }

  async start(): Promise<void> {
    this.#sink.setStatus("healthy");
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#chain.catch(() => undefined);
  }

  /** Processes up to `count` records in order; resolves with the number committed. */
  advance(count: number): Promise<number> {
    const run = this.#chain.then(async () => {
      if (this.#stopped) throw new StreamOtterError("SOURCE_UNAVAILABLE", { message: "The gateway is stopping." });
      if (this.#paused) {
        throw new StreamOtterError("SOURCE_UNAVAILABLE", { message: "The fixture source is paused; resume it after correcting the cause." });
      }
      let advanced = 0;
      while (advanced < count && this.#index < this.#records.length && !this.#stopped) {
        if (!(await this.#step())) break;
        advanced++;
      }
      return advanced;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  async resume(): Promise<void> {
    const run = this.#chain.then(async () => {
      if (!this.#paused || this.#stopped) return;
      this.#paused = false;
      this.#sink.setStatus("healthy");
      await this.#step();
    });
    this.#chain = run.catch(() => undefined);
    await run;
  }

  async check(): Promise<DiagnosticStep[]> {
    return [
      { stage: "resolve", outcome: "ok", message: `Fixture with ${this.#records.length} records is registered.` },
      { stage: "connect", outcome: "skipped", message: "Fixture sources have no network connection." },
      { stage: "tls", outcome: "skipped", message: "Fixture sources have no network connection." },
      { stage: "authenticate", outcome: "skipped", message: "Fixture sources have no credentials." },
      { stage: "metadata", outcome: "ok", message: `Position ${this.#index} of ${this.#records.length}${this.#paused ? " (paused)" : ""}.` }
    ];
  }

  /** Processes the record at the current index. Returns false when it paused or was abandoned. */
  async #step(): Promise<boolean> {
    const record = this.#records[this.#index];
    if (record === undefined) return false;
    const outcome = await this.#sink.process({
      key: record.key,
      value: record.value,
      position: { kind: "fixture", index: String(this.#index) }
    });
    if (outcome.kind === "commit") {
      this.#index++;
      this.#onCommit();
      return true;
    }
    if (outcome.kind === "pause") this.#paused = true;
    return false;
  }
}
