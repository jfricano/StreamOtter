import type { DiagnosticStep, ErrorCode, GatewayLogger, Json, SourceRecord, SourceStatus } from "@streamotter/contracts";

/** A record as read by an adapter, before gateway decoding and validation. */
export interface SourceInput {
  key: string | null;
  /** Encoded broker value; null for a tombstone. Absent for fixture records. */
  bytes?: Uint8Array | null;
  /** Pre-decoded fixture value. */
  value?: Json;
  position: SourceRecord["position"];
}

/**
 * commit: processing completed; the adapter may commit past this record.
 * pause: the record is poison or unprocessable; do not commit it or anything after it.
 * abandon: the gateway is stopping; do not commit.
 */
export type ProcessOutcome = { kind: "commit" } | { kind: "pause"; code: ErrorCode } | { kind: "abandon" };

export interface SourceSink {
  process(input: SourceInput): Promise<ProcessOutcome>;
  /** Adapter-observed readiness changes (connection loss, rebalance, recovery). */
  setStatus(status: SourceStatus["status"], reason?: ErrorCode): void;
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
}
