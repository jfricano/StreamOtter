/**
 * V1.1 source-failure handling: configuration, failure classes, and the
 * application recovery contract. docs/releases/v1.1/V1_1_API.md §§2–5 describe
 * them; the specification and ADR-15A/B/C govern behavior.
 */
import { pointer } from "./schema.ts";
import { isPlainObject } from "./primitives.ts";
import type { Awaitable, ConfigIssue, HandlerContext, Json, SourceRecord } from "./types.ts";

/**
 * What happens to a record that fails with a quarantine-eligible class. `pause` keeps V1 behavior.
 * `quarantine-hold` captures the record and keeps its position uncommitted. `quarantine-resync`
 * may advance past it once it is captured and the recovery guard agrees. There is deliberately no
 * ignore, discard, or skip policy.
 */
export type FailurePolicy = "pause" | "quarantine-hold" | "quarantine-resync";
/**
 * How a recovery boundary is retired. `generation`: only by changing the source's `generation`.
 * `application`: when the source's {@link SourceRecoveryHandlers.retire} returns true after an
 * acknowledged snapshot. `operator`: by an operator command, an unchecked human assertion.
 * A generation change retires every boundary in any mode, and no mode retires a boundary while an
 * incident it covers is still held.
 */
export type BoundaryRetirement = "generation" | "application" | "operator";

/** Failure policy for one source, set in {@link FailureHandlingConfig.sources}. Omitted fields take their defaults. */
export interface SourceFailurePolicy {
  /** Policy for `invalid-json` failures (undecodable or unparsable records). Default "pause". */
  invalidJson?: FailurePolicy;
  /** Policy for `payload-schema` failures (mapped data that fails the channel's payload schema). Default "pause". */
  invalidPublicPayload?: FailurePolicy;
  /**
   * Additional attempts after a {@link TransientMappingError}: 0 (default), 1, or 2. Retries wait
   * 250 ms, then 1,000 ms. A value above 0 requires `replaySafeMapping: true`.
   */
  transientMapperRetries?: 0 | 1 | 2;
  /** The integrator's declaration that every map handler of this source is side-effect-free and safe to repeat. Default false. */
  replaySafeMapping?: boolean;
  /**
   * Circuit breaker for automatic quarantine-resync. Once `incidents` records have been advanced
   * past within `windowMs`, the next incident opens the circuit and is held, as are later ones
   * until an operator reopens it. Default five incidents per 60 seconds; `incidents` 1 to 20,
   * `windowMs` 1,000 to 3,600,000. Only with quarantine-resync.
   */
  automaticAdvanceLimit?: { incidents: number; windowMs: number };
  /** How a recovery boundary is retired; default "generation". Only with quarantine-resync. */
  boundaryRetirement?: BoundaryRetirement;
}

/** The optional `failureHandling` section of a project configuration (V1.1). */
export interface FailureHandlingConfig {
  /** Where quarantined records are captured. Required when a Kafka source uses a quarantine policy. */
  quarantine?: {
    /** A pre-provisioned topic on the project's Kafka cluster; never one of the ingestion topics. */
    topic: string;
    /** Captures the original key, value, and headers. The only capture mode in V1.1. */
    capture: "full-record";
  };
  /** Keyed by source ID. A source without an entry keeps V1 pause behavior. */
  sources: Readonly<Record<string, SourceFailurePolicy>>;
}

/** Trusted, closed classification of a source-record failure (ADR-15B §1). */
export type FailureClass =
  | "invalid-json" | "payload-schema" | "mapper-transient" | "mapper-error" | "mapper-timeout"
  | "routing-invalid" | "revision-conflict" | "tombstone" | "oversize";

/** Every {@link FailureClass}. */
export const FAILURE_CLASSES: readonly FailureClass[] = Object.freeze([
  "invalid-json", "payload-schema", "mapper-transient", "mapper-error", "mapper-timeout",
  "routing-invalid", "revision-conflict", "tombstone", "oversize"
]);

/** The only classes a quarantine policy may apply to. Everything else holds. */
export const QUARANTINE_ELIGIBLE_CLASSES: readonly FailureClass[] = Object.freeze(["invalid-json", "payload-schema"]);

/** Default {@link SourceFailurePolicy.automaticAdvanceLimit}: five incidents per 60,000 ms window. */
export const DEFAULT_AUTOMATIC_ADVANCE_LIMIT = Object.freeze({ incidents: 5, windowMs: 60_000 });

/** The policy in force for one source, with defaults applied. */
export interface ResolvedSourcePolicy {
  /** Policy for `invalid-json` failures; default "pause". */
  invalidJson: FailurePolicy;
  /** Policy for `payload-schema` failures; default "pause". */
  invalidPublicPayload: FailurePolicy;
  /** Additional attempts after a {@link TransientMappingError}; default 0. */
  transientMapperRetries: 0 | 1 | 2;
  /** Whether the integrator declared every map handler of the source safe to repeat; default false. */
  replaySafeMapping: boolean;
  /** Circuit breaker for automatic quarantine-resync; default {@link DEFAULT_AUTOMATIC_ADVANCE_LIMIT}. */
  automaticAdvanceLimit: { incidents: number; windowMs: number };
  /** How a recovery boundary is retired; default "generation". */
  boundaryRetirement: BoundaryRetirement;
}

/**
 * Returns the policy in force for a source, with defaults applied. A source without an entry, or
 * a configuration without `failureHandling`, gets the V1 `pause` behavior. Does not validate.
 * @param config - The project's `failureHandling` section, if any.
 * @param sourceId - The source ID.
 */
export function resolveSourcePolicy(config: FailureHandlingConfig | undefined, sourceId: string): ResolvedSourcePolicy {
  const policy = config !== undefined && Object.hasOwn(config.sources, sourceId) ? config.sources[sourceId] : undefined;
  return {
    invalidJson: policy?.invalidJson ?? "pause",
    invalidPublicPayload: policy?.invalidPublicPayload ?? "pause",
    transientMapperRetries: policy?.transientMapperRetries ?? 0,
    replaySafeMapping: policy?.replaySafeMapping ?? false,
    automaticAdvanceLimit: { ...(policy?.automaticAdvanceLimit ?? DEFAULT_AUTOMATIC_ADVANCE_LIMIT) },
    boundaryRetirement: policy?.boundaryRetirement ?? "generation"
  };
}

/** The policy that applies to a failure of the given class. Ineligible classes always pause. */
export function policyFor(policy: ResolvedSourcePolicy, failureClass: FailureClass): FailurePolicy {
  if (failureClass === "invalid-json") return policy.invalidJson;
  if (failureClass === "payload-schema") return policy.invalidPublicPayload;
  return "pause";
}

const BRAND = Symbol.for("streamotter.TransientMappingError");

/**
 * Thrown by a map handler to report a transient dependency failure and request a
 * bounded retry of the same record. Recognized by brand, so a duplicated package
 * copy still matches; record data can never construct it.
 */
export class TransientMappingError extends Error {
  /**
   * Brand that {@link TransientMappingError.is} checks. Its key is
   * `Symbol.for("streamotter.TransientMappingError")`, shared by every copy of the package.
   */
  declare readonly [BRAND]: true;

  /**
   * Creates the error for a map handler to throw.
   * @param message - Description of the failure; defaults to "A transient mapping dependency failed.".
   * @param options - Standard `Error` options, such as the underlying `cause`.
   */
  constructor(message = "A transient mapping dependency failed.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientMappingError";
    Object.defineProperty(this, BRAND, { value: true });
  }

  /**
   * Returns true when `value` is a TransientMappingError from any copy of this package. It checks
   * the brand, not `instanceof` or the message text.
   */
  static is(value: unknown): value is TransientMappingError {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
  }
}

/** A cumulative recovery boundary. The gateway assigns the ID; the application owns the context. */
export interface RecoveryBoundary {
  /** Boundary ID assigned by the gateway: `rb1:` followed by random hexadecimal digits. */
  id: string;
  /** The context the recovery guard returned, at most {@link MAX_RECOVERY_CONTEXT_BYTES} of canonical JSON. */
  context: Json
}

/** The held incident that {@link SourceRecoveryHandlers.recover} decides on. */
export interface RecoveryIncident {
  /** Stable incident ID: `f1:` followed by the source-record ID. */
  failureId: string;
  /** The failure class; only the quarantine-eligible classes reach the recovery guard. */
  failureClass: "invalid-json" | "payload-schema";
  /** Source position of the failing record. */
  position: SourceRecord["position"];
  /** "sha256:<hex>" over the captured key, value, and headers. */
  evidenceHash: string;
}

/**
 * Answer of {@link SourceRecoveryHandlers.recover}. `hold` keeps the record held; its `reason` is
 * stored as operator metadata, truncated to 512 characters. `recoverable` attests that the
 * source's snapshots can supersede the excluded record, so the gateway may advance past it under a
 * new recovery boundary carrying `context` (JSON of at most {@link MAX_RECOVERY_CONTEXT_BYTES}),
 * which replaces any prior boundary. Its `evidenceRef` (1 to 512 characters) is stored as operator
 * metadata. Any other answer is an error, and the record stays held.
 */
export type RecoveryDecision =
  | {
    /** Keep the record held. */
    decision: "hold";
    /** Why, for operators; truncated to 512 characters. */
    reason: string;
  }
  | {
    /** Snapshots can supersede the record, so the gateway may advance past it. */
    decision: "recoverable";
    /** Carried by the new recovery boundary; at most {@link MAX_RECOVERY_CONTEXT_BYTES} of JSON. */
    context: Json;
    /** Where the evidence for this decision is, for operators; 1 to 512 characters. */
    evidenceRef: string;
  };

/** Application recovery contract for a source using quarantine-resync (ADR-15B §2). */
export interface SourceRecoveryHandlers {
  /**
   * Decides whether the gateway may advance past a quarantined record on a quarantine-resync
   * source. It runs with a 10-second timeout regardless of `handlerTimeoutMs`; an exception,
   * timeout or invalid answer keeps the record held.
   */
  recover(input: HandlerContext & {
    sourceId: string;
    generation: string;
    incident: RecoveryIncident;
    /** The cumulative boundary still in force; the returned context must carry its obligations forward. */
    prior: RecoveryBoundary | null;
  }): Awaitable<RecoveryDecision>;
  /**
   * Required when boundaryRetirement is "application". Called after a snapshot acknowledges the
   * boundary, with the same 10-second timeout as recover; true retires the boundary.
   */
  retire?(input: HandlerContext & { sourceId: string; boundary: RecoveryBoundary }): Awaitable<boolean>;
}

/** Maximum size of a recovery context, in UTF-8 bytes of canonical JSON (16 KiB; spec §13). */
export const MAX_RECOVERY_CONTEXT_BYTES = 16_384;

const POLICIES: readonly string[] = ["pause", "quarantine-hold", "quarantine-resync"];
const SKIP_WORDS: readonly string[] = ["ignore", "discard", "skip", "force-skip", "drop"];
const RETIREMENTS: readonly string[] = ["generation", "application", "operator"];
const SOURCE_KEYS = ["invalidJson", "invalidPublicPayload", "transientMapperRetries", "replaySafeMapping", "automaticAdvanceLimit", "boundaryRetirement"];
const KAFKA_TOPIC_PATTERN = /^[A-Za-z0-9._-]{1,249}$/;

/** What validateFailureHandling needs to know about the rest of the configuration. */
export interface FailureHandlingContext {
  /** Kind and ingestion topics of each configured source, keyed by source ID. Fixture sources have no topics. */
  sources: ReadonlyMap<string, { kind: "kafka" | "fixture"; topics: readonly string[] }>;
}

function unknownKeys(value: Record<string, unknown>, path: string, allowed: readonly string[], issues: ConfigIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: pointer(path, key), code: "UNKNOWN_KEY", message: `Unknown key "${key}".` });
  }
}

/** Validates the failureHandling section (acceptance family F02). Pure; no handlers or host access. */
export function validateFailureHandling(input: unknown, path: string, context: FailureHandlingContext, issues: ConfigIssue[]): void {
  if (input === undefined) return;
  if (!isPlainObject(input)) {
    issues.push({ path, code: "INVALID_TYPE", message: "failureHandling must be an object." });
    return;
  }
  unknownKeys(input, path, ["quarantine", "sources"], issues);

  const quarantine = input["quarantine"];
  let quarantineTopic: string | null = null;
  if (quarantine !== undefined) {
    const qPath = pointer(path, "quarantine");
    if (!isPlainObject(quarantine)) {
      issues.push({ path: qPath, code: "INVALID_TYPE", message: "quarantine must be an object." });
    } else {
      unknownKeys(quarantine, qPath, ["topic", "capture"], issues);
      const topic = quarantine["topic"];
      if (topic === undefined) {
        issues.push({ path: pointer(qPath, "topic"), code: "REQUIRED", message: "\"topic\" is required." });
      } else if (typeof topic !== "string" || !KAFKA_TOPIC_PATTERN.test(topic)) {
        issues.push({ path: pointer(qPath, "topic"), code: "INVALID_VALUE", message: "The quarantine topic name may contain letters, digits, '.', '_', and '-'." });
      } else {
        quarantineTopic = topic;
        for (const [sourceId, source] of context.sources) {
          if (source.topics.includes(topic)) {
            issues.push({
              path: pointer(qPath, "topic"),
              code: "INVALID_VALUE",
              message: `The quarantine topic must not be an ingestion topic; source "${sourceId}" consumes "${topic}".`
            });
          }
        }
      }
      const capture = quarantine["capture"];
      if (capture === undefined) {
        issues.push({ path: pointer(qPath, "capture"), code: "REQUIRED", message: "\"capture\" is required; set it to \"full-record\" to capture original record bytes." });
      } else if (capture !== "full-record") {
        issues.push({ path: pointer(qPath, "capture"), code: "INVALID_VALUE", message: "capture must be \"full-record\" in V1.1." });
      }
    }
  }

  const sources = input["sources"];
  const sourcesPath = pointer(path, "sources");
  if (sources === undefined) {
    issues.push({ path: sourcesPath, code: "REQUIRED", message: "\"sources\" is required." });
    return;
  }
  if (!isPlainObject(sources)) {
    issues.push({ path: sourcesPath, code: "INVALID_TYPE", message: "sources must be an object keyed by source ID." });
    return;
  }
  for (const [sourceId, policy] of Object.entries(sources)) {
    const sPath = pointer(sourcesPath, sourceId);
    const source = context.sources.get(sourceId);
    if (source === undefined) {
      issues.push({ path: sPath, code: "UNKNOWN_REFERENCE", message: `"${sourceId}" is not a configured source.` });
    }
    if (!isPlainObject(policy)) {
      issues.push({ path: sPath, code: "INVALID_TYPE", message: "A source failure policy must be an object." });
      continue;
    }
    unknownKeys(policy, sPath, SOURCE_KEYS, issues);
    let quarantines = false;
    let resyncs = false;
    for (const key of ["invalidJson", "invalidPublicPayload"] as const) {
      const value = policy[key];
      if (value === undefined) continue;
      if (typeof value === "string" && POLICIES.includes(value)) {
        if (value !== "pause") quarantines = true;
        if (value === "quarantine-resync") resyncs = true;
        continue;
      }
      issues.push({
        path: pointer(sPath, key),
        code: "INVALID_VALUE",
        message: typeof value === "string" && SKIP_WORDS.includes(value)
          ? `"${value}" is not a policy: StreamOtter never skips a record silently. Use pause, quarantine-hold, or quarantine-resync.`
          : `${key} must be pause, quarantine-hold, or quarantine-resync.`
      });
    }
    if (quarantines && source?.kind === "kafka" && quarantineTopic === null && quarantine === undefined) {
      issues.push({ path: pointer(path, "quarantine"), code: "REQUIRED", message: `Source "${sourceId}" uses a quarantine policy, which requires failureHandling.quarantine.` });
    }
    const retries = policy["transientMapperRetries"];
    if (retries !== undefined && retries !== 0 && retries !== 1 && retries !== 2) {
      issues.push({ path: pointer(sPath, "transientMapperRetries"), code: "INVALID_VALUE", message: "transientMapperRetries must be 0, 1, or 2." });
    }
    const replaySafe = policy["replaySafeMapping"];
    if (replaySafe !== undefined && typeof replaySafe !== "boolean") {
      issues.push({ path: pointer(sPath, "replaySafeMapping"), code: "INVALID_TYPE", message: "replaySafeMapping must be a boolean." });
    }
    if ((retries === 1 || retries === 2) && replaySafe !== true) {
      issues.push({
        path: pointer(sPath, "transientMapperRetries"),
        code: "INVALID_VALUE",
        message: "Transient retries repeat the map handlers; declare replaySafeMapping: true once they are side-effect-free."
      });
    }
    const limit = policy["automaticAdvanceLimit"];
    if (limit !== undefined) {
      const lPath = pointer(sPath, "automaticAdvanceLimit");
      if (!isPlainObject(limit)) {
        issues.push({ path: lPath, code: "INVALID_TYPE", message: "automaticAdvanceLimit must be an object." });
      } else {
        unknownKeys(limit, lPath, ["incidents", "windowMs"], issues);
        const incidents = limit["incidents"];
        const windowMs = limit["windowMs"];
        if (!(typeof incidents === "number" && Number.isSafeInteger(incidents) && incidents >= 1 && incidents <= 20)) {
          issues.push({ path: pointer(lPath, "incidents"), code: "INVALID_VALUE", message: "incidents must be an integer from 1 to 20." });
        }
        if (!(typeof windowMs === "number" && Number.isSafeInteger(windowMs) && windowMs >= 1_000 && windowMs <= 3_600_000)) {
          issues.push({ path: pointer(lPath, "windowMs"), code: "INVALID_VALUE", message: "windowMs must be an integer from 1000 to 3600000." });
        }
        if (!resyncs) issues.push({ path: lPath, code: "INVALID_VALUE", message: "automaticAdvanceLimit applies only to a quarantine-resync policy." });
      }
    }
    const retirement = policy["boundaryRetirement"];
    if (retirement !== undefined) {
      if (typeof retirement !== "string" || !RETIREMENTS.includes(retirement)) {
        issues.push({ path: pointer(sPath, "boundaryRetirement"), code: "INVALID_VALUE", message: "boundaryRetirement must be generation, application, or operator." });
      } else if (!resyncs) {
        issues.push({ path: pointer(sPath, "boundaryRetirement"), code: "INVALID_VALUE", message: "boundaryRetirement applies only to a quarantine-resync policy." });
      }
    }
  }
}
