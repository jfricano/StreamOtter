import type { DiagnosticStep, ErrorCode, FailureClass, GatewayLogger, Json, SourceRecord, SourceStatus } from "@streamotter/contracts";

/** A record as read by an adapter, before gateway decoding and validation. */
export interface SourceInput {
  key: string | null;
  /** Encoded broker value; null for a tombstone. Absent for fixture records. */
  bytes?: Uint8Array | null;
  /** Pre-decoded fixture value. */
  value?: Json;
  position: SourceRecord["position"];
  /** Original key bytes, kept for evidence because the decoded key is lossy (ADR-15A §6). */
  keyBytes?: Uint8Array | null;
  /** Original headers in arrival order, one entry per value. */
  headers?: readonly { name: string; value: Uint8Array }[];
  /** Broker timestamp (ISO 8601) when the client exposes one. */
  timestamp?: string | null;
  /** Keeps group membership alive while the gateway waits between transient retries (spec §6). */
  heartbeat?: () => Promise<void>;
}

/** Where a held record sits, as the adapter knows it. */
export interface HeldPosition {
  position: SourceRecord["position"];
}

/**
 * advanced: the next offset was committed, read back, and consumption resumed past the record.
 * not-held: the adapter is not paused at exactly that position in its current assignment; nothing changed.
 * uncertain: the commit outcome could not be confirmed; the source stays paused.
 */
export type AdvanceResult = "advanced" | "not-held" | "uncertain";

/**
 * commit: processing completed; the adapter may commit past this record.
 * pause: the record is poison or unprocessable; do not commit it or anything after it.
 *   failureClass is the trusted internal classification (ADR-15B §1); code stays the public error code.
 * hold: the source's progress is not what the incident journal expects (it moved past a
 *   held record without an advance); pause without opening an incident (spec §8, F27, F30).
 * abandon: the gateway is stopping; do not commit.
 */
export type ProcessOutcome =
  | { kind: "commit" }
  | { kind: "pause"; code: ErrorCode; failureClass: FailureClass; stage?: "validate" | "map" | "queue"; channel?: string | null; diagnosis?: string }
  | { kind: "hold"; code: ErrorCode; reason: string }
  | { kind: "abandon" };

export interface SourceSink {
  process(input: SourceInput): Promise<ProcessOutcome>;
  /** Adapter-observed readiness changes (connection loss, rebalance, recovery). */
  setStatus(status: SourceStatus["status"], reason?: ErrorCode): void;
  /**
   * Called after the adapter has paused at a record that process() returned
   * "pause" for, once the fetch loop has let go of it (ADR-15A §1). Slow
   * disposition work (journal, quarantine, recovery guard) starts here.
   */
  held(input: SourceInput, outcome: Extract<ProcessOutcome, { kind: "pause" }>): void;
  readonly logger: GatewayLogger;
  readonly stopSignal: AbortSignal;
}

/**
 * Internal broker boundary. Broker-specific behavior stays behind this interface;
 * it is not a public third-party adapter API.
 */
export interface SourceAdapter {
  readonly kind: "kafka" | "fixture";
  /** Opens resources and resolves once the source can deliver records. */
  start(): Promise<void>;
  /** Stops consumption; commits only completed processing. */
  stop(deadline: number): Promise<void>;
  /** Retries a paused source at its uncommitted position. */
  resume(): Promise<void>;
  /** Staged connectivity diagnostics with redacted messages. */
  check(deadline: number): Promise<DiagnosticStep[]>;
  /** Commits exactly past a held record, confirms it, and resumes (ADR-15A §1). */
  advancePast(held: HeldPosition): Promise<AdvanceResult>;
}
