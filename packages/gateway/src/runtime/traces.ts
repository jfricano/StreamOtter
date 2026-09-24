import { randomBytes } from "node:crypto";
import { StreamOtterError, utf8ByteLength, type Page, type Trace } from "@streamotter/contracts";
import { nowIso } from "./util.ts";

interface Entry { seq: number; trace: Trace; bytes: number }

export type TraceInput = Omit<Trace, "id" | "at">;
export interface TraceQuery { limit: number; cursor?: string; sourceId?: string; channel?: string; outcome?: Trace["outcome"] }

/**
 * Bounded in-memory trace metadata. Never stores payloads or credentials. Cursors
 * are ephemeral positions scoped to this gateway run, not data-recovery cursors.
 */
export class TraceBuffer {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #runId = randomBytes(6).toString("base64url");
  #entries: Entry[] = [];
  #head = 0;
  #bytes = 0;
  #nextSeq = 1;

  constructor(maxEntries: number, maxBytes: number) {
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
  }

  record(input: TraceInput): void {
    const seq = this.#nextSeq++;
    const trace: Trace = { id: `${this.#runId}-${seq}`, at: nowIso(), ...input };
    const bytes = utf8ByteLength(JSON.stringify(trace));
    this.#entries.push({ seq, trace, bytes });
    this.#bytes += bytes;
    while (this.size > this.#maxEntries || (this.#bytes > this.#maxBytes && this.size > 0)) {
      const dropped = this.#entries[this.#head];
      if (dropped === undefined) break;
      this.#bytes -= dropped.bytes;
      this.#head++;
    }
    if (this.#head > 1024 && this.#head * 2 > this.#entries.length) {
      this.#entries = this.#entries.slice(this.#head);
      this.#head = 0;
    }
  }

  get size(): number {
    return this.#entries.length - this.#head;
  }

  #cursorFor(seq: number): string {
    return Buffer.from(`${this.#runId}:${seq}`).toString("base64url");
  }

  #parseCursor(cursor: string): number {
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, "base64url").toString("utf8");
    } catch {
      throw new StreamOtterError("INVALID_REQUEST", { message: "The trace cursor is malformed." });
    }
    const match = /^([A-Za-z0-9_-]+):(\d{1,15})$/.exec(decoded);
    if (match === null) throw new StreamOtterError("INVALID_REQUEST", { message: "The trace cursor is malformed." });
    if (match[1] !== this.#runId) throw new StreamOtterError("TRACE_CURSOR_EXPIRED");
    return Number(match[2]);
  }

  /**
   * Without a cursor, returns the newest `limit` matching traces (oldest first).
   * With a cursor, returns up to `limit` matching traces recorded after it.
   * nextCursor continues after the last examined trace, so callers can poll.
   */
  page(query: TraceQuery): Page<Trace> {
    const matches = (entry: Entry) =>
      (query.sourceId === undefined || entry.trace.sourceId === query.sourceId)
      && (query.channel === undefined || entry.trace.channel === query.channel)
      && (query.outcome === undefined || entry.trace.outcome === query.outcome);
    const oldestSeq = this.#entries[this.#head]?.seq ?? this.#nextSeq;
    if (query.cursor === undefined) {
      const items: Trace[] = [];
      for (let i = this.#entries.length - 1; i >= this.#head && items.length < query.limit; i--) {
        const entry = this.#entries[i];
        if (entry !== undefined && matches(entry)) items.push(entry.trace);
      }
      items.reverse();
      return { items, nextCursor: this.#cursorFor(this.#nextSeq - 1) };
    }
    const after = this.#parseCursor(query.cursor);
    if (after + 1 < oldestSeq) throw new StreamOtterError("TRACE_CURSOR_EXPIRED");
    const items: Trace[] = [];
    let last = after;
    for (let i = this.#head + Math.max(0, after + 1 - oldestSeq); i < this.#entries.length; i++) {
      const entry = this.#entries[i];
      if (entry === undefined) break;
      last = entry.seq;
      if (matches(entry)) {
        items.push(entry.trace);
        if (items.length >= query.limit) break;
      }
    }
    return { items, nextCursor: this.#cursorFor(last) };
  }
}
