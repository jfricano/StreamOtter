import {
  isPlainObject, resolveSourcePolicy, StreamOtterError,
  type ChannelMap, type FailurePolicy, type HandlerRegistry, type ProjectConfig
} from "@streamotter/contracts";

/** The source-failure features this build of the gateway implements. */
export interface FailureCapabilities {
  readonly policies: readonly FailurePolicy[];
  readonly transientRetries: boolean;
}

/**
 * V1.1 is delivered in slices. A policy the running build cannot carry out is
 * refused at construction, never accepted and quietly treated as pause (spec §14).
 */
export const FAILURE_CAPABILITIES: FailureCapabilities = Object.freeze({
  policies: Object.freeze(["pause", "quarantine-hold"] as const),
  transientRetries: true
});

/** Node versions whose node:sqlite loads without an experimental warning (D1). */
export const MIN_JOURNAL_NODE = [24, 15] as const;

export function nodeSupportsJournal(version: string = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > MIN_JOURNAL_NODE[0] || (major === MIN_JOURNAL_NODE[0] && minor >= MIN_JOURNAL_NODE[1]);
}

/** True when the source can quarantine any failure class. */
export function usesQuarantine(config: ProjectConfig, sourceId: string): boolean {
  const policy = resolveSourcePolicy(config.failureHandling, sourceId);
  return policy.invalidJson !== "pause" || policy.invalidPublicPayload !== "pause";
}

/**
 * Checks on the gateway options that the failure features need (V1_1_API.md §4):
 * a durable journal in production, one Kafka connection for quarantine writes,
 * a bounded handler build ID, and a Node version the journal engine supports.
 */
export function failureOptionIssues(
  config: ProjectConfig,
  options: { mode: "development" | "production"; stateDirectory?: unknown; handlerBuildId?: unknown },
  nodeVersion: string = process.versions.node
): string[] {
  const issues: string[] = [];
  if (options.stateDirectory !== undefined && (typeof options.stateDirectory !== "string" || options.stateDirectory.length === 0)) {
    issues.push("stateDirectory must be a non-empty path");
  }
  if (options.handlerBuildId !== undefined
    && (typeof options.handlerBuildId !== "string" || options.handlerBuildId.length === 0 || options.handlerBuildId.length > 128)) {
    issues.push("handlerBuildId must be a string of 1 to 128 characters");
  }
  const quarantined = Object.keys(config.sources).filter(sourceId => usesQuarantine(config, sourceId));
  if (quarantined.length > 0 && options.mode === "production" && options.stateDirectory === undefined) {
    issues.push(`source ${quarantined[0]} uses a quarantine policy, which requires stateDirectory in production so incidents survive a restart`);
  }
  if (options.stateDirectory !== undefined && config.failureHandling !== undefined && !nodeSupportsJournal(nodeVersion)) {
    issues.push(`the failure journal needs Node ${MIN_JOURNAL_NODE.join(".")} or newer; this is Node ${nodeVersion}`);
  }
  const connections = new Set<string>();
  for (const sourceId of quarantined) {
    const source = config.sources[sourceId];
    if (source?.kind === "kafka") connections.add(source.connectionRef);
  }
  if (connections.size > 1) {
    issues.push(`quarantine writes go to one Kafka cluster, but quarantining sources use ${connections.size} connection profiles (${[...connections].join(", ")})`);
  }
  return issues;
}

/**
 * Checks that need both the configuration and the handler registry (V1_1_API.md §4):
 * recovery guards match quarantine-resync sources exactly, and every configured
 * policy is one this build supports. Returns human-readable issues.
 */
export function failureHandlingIssues(
  config: ProjectConfig,
  handlers: HandlerRegistry<ChannelMap>,
  capabilities: FailureCapabilities = FAILURE_CAPABILITIES
): string[] {
  const issues: string[] = [];
  const failureHandling = config.failureHandling;
  const guards = (handlers as { sources?: unknown }).sources;
  const guardEntries: Record<string, unknown> = {};
  if (guards !== undefined) {
    if (!isPlainObject(guards)) issues.push("handlers.sources must be an object keyed by source ID");
    else Object.assign(guardEntries, guards);
  }

  for (const [sourceId, entry] of Object.entries(guardEntries)) {
    if (!Object.hasOwn(config.sources, sourceId)) {
      issues.push(`handlers.sources.${sourceId} does not match a configured source`);
      continue;
    }
    const policy = resolveSourcePolicy(failureHandling, sourceId);
    if (policy.invalidJson !== "quarantine-resync" && policy.invalidPublicPayload !== "quarantine-resync") {
      issues.push(`handlers.sources.${sourceId} is only used by a source whose failure policy is quarantine-resync`);
      continue;
    }
    if (!isPlainObject(entry) || typeof entry["recover"] !== "function") {
      issues.push(`handlers.sources.${sourceId}.recover must be a function`);
      continue;
    }
    if (policy.boundaryRetirement === "application" && typeof entry["retire"] !== "function") {
      issues.push(`handlers.sources.${sourceId}.retire must be a function because boundaryRetirement is "application"`);
    }
    if (policy.boundaryRetirement !== "application" && entry["retire"] !== undefined) {
      issues.push(`handlers.sources.${sourceId}.retire is only used when boundaryRetirement is "application"`);
    }
  }

  for (const sourceId of Object.keys(failureHandling?.sources ?? {})) {
    if (!Object.hasOwn(config.sources, sourceId)) continue; // Reported by the configuration validator.
    const policy = resolveSourcePolicy(failureHandling, sourceId);
    const resyncs = policy.invalidJson === "quarantine-resync" || policy.invalidPublicPayload === "quarantine-resync";
    if (resyncs && !Object.hasOwn(guardEntries, sourceId)) {
      issues.push(`source ${sourceId} uses quarantine-resync, which requires a recovery guard at handlers.sources.${sourceId}.recover`);
    }
    for (const [key, value] of [["invalidJson", policy.invalidJson], ["invalidPublicPayload", policy.invalidPublicPayload]] as const) {
      if (!capabilities.policies.includes(value)) {
        issues.push(`failureHandling.sources.${sourceId}.${key} is "${value}", which this gateway build does not support yet`);
      }
    }
    if (policy.transientMapperRetries > 0 && !capabilities.transientRetries) {
      issues.push(`failureHandling.sources.${sourceId}.transientMapperRetries is not supported by this gateway build yet`);
    }
  }
  return issues;
}

export function assertFailureHandling(
  config: ProjectConfig,
  handlers: HandlerRegistry<ChannelMap>,
  options: Parameters<typeof failureOptionIssues>[1],
  capabilities?: FailureCapabilities
): void {
  const issues = [...failureHandlingIssues(config, handlers, capabilities), ...failureOptionIssues(config, options)];
  if (issues.length > 0) {
    throw new StreamOtterError("CONFIG_INVALID", { message: `Invalid failure handling: ${issues.join("; ")}.`, details: { issues } });
  }
}
