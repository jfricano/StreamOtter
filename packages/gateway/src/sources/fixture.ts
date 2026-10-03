import { StreamOtterError, type DiagnosticStep, type FixtureRecord, type SourceRecord } from "@streamotter/contracts";
import type { AdvanceResult, HeldPosition, SourceAdapter, SourceInput, SourceSink } from "./types.ts";

export type { FixtureRecord };

/**
 * Deterministic development source. Records advance in array order only when
 * requested. A paused fixture keeps its position; resume retries that record.
 */
export class FixtureSourceAdapter implements SourceAdapter {
  readonly kind = "fixture" as const;
  readonly #records: readonly FixtureRecord[];
  readonly #sink: SourceSink;
  readonly #onCommit: (position: SourceRecord["position"]) => void;
  #index = 0;
  #paused = false;
  #stopped = false;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(records: readonly FixtureRecord[], sink: SourceSink, onCommit: (position: SourceRecord["position"]) => void) {
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

  /** Moves past the held record without processing it, then resumes; later records advance on request as usual. */
  advancePast(held: HeldPosition): Promise<AdvanceResult> {
    const run = this.#chain.then((): AdvanceResult => {
      const position = held.position;
      if (this.#stopped || !this.#paused || position.kind !== "fixture" || position.index !== String(this.#index)) return "not-held";
      this.#index++;
      this.#paused = false;
      this.#onCommit(position);
      this.#sink.setStatus("healthy");
      return "advanced";
    });
    this.#chain = run.catch(() => undefined);
    return run;
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
    const position = { kind: "fixture" as const, index: String(this.#index) };
    const keyBytes = record.key === null ? null : new TextEncoder().encode(record.key);
    const input: SourceInput = "raw" in record
      ? { key: record.key, bytes: new TextEncoder().encode(record.raw), keyBytes, headers: [], timestamp: null, position }
      : { key: record.key, value: record.value, keyBytes, headers: [], timestamp: null, position };
    const outcome = await this.#sink.process(input);
    if (outcome.kind === "commit") {
      this.#index++;
      this.#onCommit(position);
      return true;
    }
    if (outcome.kind === "pause") {
      this.#paused = true;
      this.#sink.held(input, outcome);
    }
    if (outcome.kind === "hold") this.#paused = true;
    return false;
  }
}
