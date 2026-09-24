import { pointer } from "./schema.ts";
import type { ConfigIssue, Limits } from "./types.ts";

/** Starting bounds from the specification; not published capacity claims. */
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxConnections: 1_000,
  maxSubscriptionsPerConnection: 50,
  maxSourceRecordBytes: 1_048_576,
  maxDataFrameBytes: 65_536,
  maxParamsBytes: 4_096,
  maxPendingFramesPerSubscription: 100,
  maxPendingBytesPerSubscription: 1_048_576,
  maxPendingBytesPerConnection: 4_194_304,
  maxPendingBytesGateway: 67_108_864,
  maxMapOutputs: 100,
  maxConcurrentSnapshots: 32,
  handlerTimeoutMs: 2_000,
  snapshotTimeoutMs: 10_000,
  receiptTimeoutMs: 5_000,
  maxSyncAttempts: 3,
  maxTraceEntries: 10_000,
  maxTraceBytes: 8_388_608,
  maxControlFrameBytes: 16_384,
  controlRequestsPerSecond: 20
});

export const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS) as readonly (keyof Limits)[];

export function resolveLimits(overrides: Partial<Limits> | undefined): Limits {
  return { ...DEFAULT_LIMITS, ...(overrides ?? {}) };
}

/** Validates override values and cross-field consistency of the resolved limits. */
export function validateLimits(input: unknown, path: string, issues: ConfigIssue[]): void {
  if (input === undefined) return;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push({ path, code: "INVALID_TYPE", message: "limits must be an object." });
    return;
  }
  const overrides: Partial<Limits> = {};
  let valid = true;
  for (const [key, value] of Object.entries(input)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      issues.push({ path: pointer(path, key), code: "UNKNOWN_KEY", message: `Unknown limit "${key}".` });
      valid = false;
      continue;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      issues.push({ path: pointer(path, key), code: "INVALID_VALUE", message: `${key} must be a positive integer.` });
      valid = false;
      continue;
    }
    overrides[key as keyof Limits] = value;
  }
  if (!valid) return;
  const limits = resolveLimits(overrides);
  const ordered: [keyof Limits, keyof Limits][] = [
    ["maxDataFrameBytes", "maxPendingBytesPerSubscription"],
    ["maxPendingBytesPerSubscription", "maxPendingBytesPerConnection"],
    ["maxPendingBytesPerConnection", "maxPendingBytesGateway"],
    ["maxParamsBytes", "maxControlFrameBytes"]
  ];
  for (const [smaller, larger] of ordered) {
    if (limits[smaller] > limits[larger]) {
      issues.push({
        path: pointer(path, smaller),
        code: "INCONSISTENT_LIMITS",
        message: `${smaller} (${limits[smaller]}) must not exceed ${larger} (${limits[larger]}).`
      });
    }
  }
  if (limits.maxControlFrameBytes < 1_024) {
    issues.push({ path: pointer(path, "maxControlFrameBytes"), code: "INCONSISTENT_LIMITS", message: "maxControlFrameBytes must be at least 1024." });
  }
  if (limits.maxDataFrameBytes < 1_024) {
    issues.push({ path: pointer(path, "maxDataFrameBytes"), code: "INCONSISTENT_LIMITS", message: "maxDataFrameBytes must be at least 1024." });
  }
}
