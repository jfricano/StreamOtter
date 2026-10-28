import type { ChannelSummary, DevelopmentPrincipalSummary, ProjectConfig, SourceStatus, WorkbenchOperation } from "@streamotter/contracts";
import type { ManagementApi } from "./api.ts";
import type { HostSettings } from "./host.ts";

/** What every view shares while the workbench is open. Views update it in place (sources, readiness, the candidate) and call `refreshShell` after. */
export interface WorkbenchState {
  api: ManagementApi;
  host: HostSettings;
  /** True when this environment offers the operation (WHC-1 §4). Surfaces that need a missing one show as unavailable. */
  can(operation: WorkbenchOperation): boolean;
  /** Empty when the host names no gateway; Preview is then unavailable. */
  gatewayOrigin: string;
  /** The gateway's Socket.IO path; empty with `gatewayOrigin`. */
  gatewayPath: string;
  /** The configuration the gateway runs, as loaded when the workbench opened. */
  active: { config: ProjectConfig; fingerprint: string };
  /** The editable candidate. It never changes the running gateway. */
  candidateText: string;
  channels: ChannelSummary[];
  sources: SourceStatus[];
  /** Empty when the host does not offer `dev.principals`. */
  principals: DevelopmentPrincipalSummary[];
  /** From the last health check: true while the gateway runs and every source is healthy. */
  ready: boolean;
  /** Re-renders the shell (top bar, restart indicator). */
  refreshShell(): void;
}

/** A configuration as the editor shows it: JSON indented two spaces, with a trailing newline. */
export function prettyConfig(config: unknown): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** True when the candidate parses to something other than the active configuration. */
export function candidateDiffers(state: WorkbenchState): boolean {
  try {
    return JSON.stringify(JSON.parse(state.candidateText)) !== JSON.stringify(state.active.config);
  } catch {
    return true;
  }
}

/** The pill tone for a source status. Paused is bad: the source has stopped consuming until it is resumed. */
export function sourceTone(status: SourceStatus["status"]): "ok" | "warn" | "bad" | "neutral" {
  switch (status) {
    case "healthy": return "ok";
    case "starting": return "neutral";
    case "degraded": return "warn";
    case "paused": return "bad";
    default: return "neutral";
  }
}
