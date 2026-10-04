import {
  DEFAULT_SOCKET_PATH, DEFAULT_WORKBENCH_API_BASE, isPlainObject, validateWorkbenchHostConfig, WORKBENCH_BOOT_ELEMENT_ID,
  type WorkbenchHostConfig, type WorkbenchHostConfigIssue
} from "@streamotter/contracts";

/** The exact @streamotter/workbench version this bundle was built from (set by build.mjs). */
export const WORKBENCH_VERSION: string = __STREAMOTTER_WORKBENCH_VERSION__;

/** How this page runs, resolved from the WHC-1 boot block or, when it is absent, the native defaults (WHC-1 §3.3). */
export interface HostSettings {
  /** False when the boot block is absent: the native `streamotter dev` page. */
  hosted: boolean;
  apiBase: string;
  /**
   * The API's origin when it is not the page's (WHC-1 §3.4). Only ever taken from a validated boot
   * block, which allows it only in session mode; null for the page's own origin.
   */
  apiOrigin: string | null;
  auth: "token" | "session";
  /** Where Preview connects. Null when a boot block names no gateway, which makes Preview unavailable. */
  gateway: { origin: string; path: string } | null;
  environment: { kind: "development" | "sandbox"; label: string | null; detail: string | null; packageVersion: string | null };
}

export type Boot =
  | { kind: "ok"; settings: HostSettings }
  | { kind: "invalid"; issues: readonly WorkbenchHostConfigIssue[] }
  | { kind: "unsupported"; hostContract: string };

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

/**
 * Reads and validates the boot block before anything renders or any request is made. main.ts calls
 * it once, while app.js is evaluated, so the block (and the mount element) must be in the document
 * by then: in the page's HTML, or inserted by the host's own script before it imports app.js
 * (WHC-1 §3.1). A block added or changed later is never read.
 */
export function readBoot(): Boot {
  const element = document.getElementById(WORKBENCH_BOOT_ELEMENT_ID);
  if (element === null) {
    return {
      kind: "ok",
      settings: {
        hosted: false,
        apiBase: DEFAULT_WORKBENCH_API_BASE,
        apiOrigin: null,
        auth: "token",
        gateway: { origin: meta("streamotter-gateway-origin"), path: meta("streamotter-gateway-path") || DEFAULT_SOCKET_PATH },
        environment: { kind: "development", label: null, detail: null, packageVersion: null }
      }
    };
  }
  if (!(element instanceof HTMLScriptElement) || element.type !== "application/json") {
    return { kind: "invalid", issues: [{ path: "", message: `#${WORKBENCH_BOOT_ELEMENT_ID} must be a <script type="application/json"> element.` }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(element.textContent ?? "");
  } catch (error) {
    return { kind: "invalid", issues: [{ path: "", message: `The boot block is not valid JSON: ${(error as Error).message}` }] };
  }
  if (isPlainObject(parsed) && Object.hasOwn(parsed, "hostContract") && parsed["hostContract"] !== 1) {
    return { kind: "unsupported", hostContract: (JSON.stringify(parsed["hostContract"]) ?? "?").slice(0, 32) };
  }
  const result = validateWorkbenchHostConfig(parsed);
  if (!result.ok) return { kind: "invalid", issues: result.issues };
  return { kind: "ok", settings: fromConfig(result.config) };
}

function fromConfig(config: WorkbenchHostConfig): HostSettings {
  const environment = config.environment;
  return {
    hosted: true,
    apiBase: config.apiBase ?? DEFAULT_WORKBENCH_API_BASE,
    apiOrigin: config.apiOrigin ?? null,
    auth: config.auth?.mode ?? "token",
    gateway: config.gateway === undefined ? null : { origin: config.gateway.origin, path: config.gateway.path ?? DEFAULT_SOCKET_PATH },
    environment: {
      kind: environment?.kind ?? "development",
      label: environment?.label ?? null,
      detail: environment?.detail ?? null,
      packageVersion: environment?.packageVersion ?? null
    }
  };
}
