import type { ChannelSummary, DevelopmentPrincipalSummary, ProjectConfig, SourceStatus } from "@streamotter/contracts";
import type { ManagementApi } from "./api.ts";

export interface WorkbenchState {
  api: ManagementApi;
  gatewayOrigin: string;
  gatewayPath: string;
  active: { config: ProjectConfig; fingerprint: string };
  /** The editable candidate. It never changes the running gateway. */
  candidateText: string;
  channels: ChannelSummary[];
  sources: SourceStatus[];
  principals: DevelopmentPrincipalSummary[];
  ready: boolean;
  /** Re-renders the shell (top bar, restart indicator). */
  refreshShell(): void;
}

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

export function sourceTone(status: SourceStatus["status"]): "ok" | "warn" | "bad" | "neutral" {
  switch (status) {
    case "healthy": return "ok";
    case "starting": return "neutral";
    case "degraded": return "warn";
    case "paused": return "bad";
    default: return "neutral";
  }
}
