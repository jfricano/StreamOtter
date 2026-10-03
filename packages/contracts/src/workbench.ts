import { isPlainObject } from "./primitives.ts";
import { pointer } from "./schema.ts";
import type { WorkbenchHostConfig, WorkbenchHostConfigIssue, WorkbenchOperation } from "./types.ts";

/**
 * Workbench host contract, version 1 (WHC-1). Browser-safe: no Node.js imports.
 * See docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md.
 */
export const WORKBENCH_HOST_CONTRACT = 1 as const;
/** `id` of the `<script type="application/json">` boot block (WHC-1 §3.1). */
export const WORKBENCH_BOOT_ELEMENT_ID = "streamotter-workbench-host";
/** `id` of the element the workbench renders into. */
export const WORKBENCH_MOUNT_ELEMENT_ID = "app";
/** `apiBase` when the boot block is absent or omits it (the native management server). */
export const DEFAULT_WORKBENCH_API_BASE = "/management/v1";
/** Header the workbench adds to every request in `session` mode, so a host can reject cross-site form posts. */
export const WORKBENCH_REQUEST_HEADER = "X-StreamOtter-Workbench";

const OPERATION_NAMES = [
  "capabilities", "health", "sources", "channels", "config", "config.validate", "config.export", "traces",
  "source-checks", "sources.resume", "preview-sessions", "dev.principals", "dev.fixtures.advance", "dev.disconnect",
  "workbench", "operator.status", "failures.list", "failures.show", "failures.export", "failures.evaluate",
  "failures.redrive", "sources.retry-current", "sources.reassess", "sources.reopen-circuit"
] as const satisfies readonly WorkbenchOperation[];
// Fails to compile if WorkbenchOperation gains a name that the list above does not include.
const everyOperationListed: [Exclude<WorkbenchOperation, (typeof OPERATION_NAMES)[number]>] extends [never] ? true : false = true;
void everyOperationListed;

/** Every WHC-1 operation name, in the order of WHC-1 §5. */
export const WORKBENCH_OPERATIONS: readonly WorkbenchOperation[] = Object.freeze(OPERATION_NAMES);

/**
 * What a pre-WHC-1 native management server (one that answers `GET {apiBase}/workbench` with 404)
 * is assumed to offer: every operation `streamotter dev` exposed before WHC-1, and no V1.1
 * failure or operator operation (WHC-1 §4).
 */
export const PRE_WHC1_NATIVE_OPERATIONS: readonly WorkbenchOperation[] = Object.freeze([
  "capabilities", "health", "sources", "channels", "config", "config.validate", "config.export", "traces",
  "source-checks", "sources.resume", "preview-sessions", "dev.principals", "dev.fixtures.advance", "dev.disconnect"
] as const satisfies readonly WorkbenchOperation[]);

const OPERATION_SET: ReadonlySet<string> = new Set(WORKBENCH_OPERATIONS);

export function isWorkbenchOperation(value: unknown): value is WorkbenchOperation {
  return typeof value === "string" && OPERATION_SET.has(value);
}

/** Limits of WHC-1 §3.2. */
export const WORKBENCH_LABEL_MAX_LENGTH = 64;
export const WORKBENCH_DETAIL_MAX_LENGTH = 280;
const MAX_PATH_LENGTH = 256;
const MAX_VERSION_LENGTH = 64;

const SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=:@%-]+$/;
const ORIGIN = /^https?:\/\/(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/;
const VERSION = /^[0-9A-Za-z.+-]+$/;
// C0 and C1 control characters, which have no place in a label shown as text.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * An absolute path on the page's own origin: starts with one `/`, has no empty, `.` or `..`
 * segment, no trailing slash, no query or fragment, and no backslash. `//host` (a
 * protocol-relative URL, which is cross-origin) is refused.
 */
export function isSameOriginApiPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > MAX_PATH_LENGTH || !value.startsWith("/")) return false;
  return value.slice(1).split("/").every(segment => segment !== "." && segment !== ".." && SEGMENT.test(segment));
}

function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * Validates a parsed WHC-1 boot block. Unknown fields are refused at every level, so a host
 * learns at once when it relies on a field this version does not support. A block whose
 * `hostContract` is present but not 1 reports one issue at `/hostContract`; the workbench shows
 * its "unsupported host contract" screen for it.
 */
export function validateWorkbenchHostConfig(input: unknown):
  { ok: true; config: WorkbenchHostConfig } | { ok: false; issues: readonly WorkbenchHostConfigIssue[] } {
  const issues: WorkbenchHostConfigIssue[] = [];
  const fail = (path: string, message: string) => { issues.push({ path, message }); };
  const known = (value: Record<string, unknown>, base: string, keys: readonly string[]) => {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(pointer(base, key), `Unknown field "${key.slice(0, 64)}". WHC-1 does not define it.`);
    }
  };
  const text = (value: unknown, path: string, max: number, required: boolean) => {
    if (value === undefined) {
      if (required) fail(path, "Required.");
      return;
    }
    if (typeof value !== "string" || value.trim().length === 0) return fail(path, "Must be a non-empty string.");
    if (codePoints(value) > max) return fail(path, `Must be at most ${max} characters.`);
    if (CONTROL.test(value)) fail(path, "Must not contain control characters.");
  };

  if (!isPlainObject(input)) return { ok: false, issues: [{ path: "", message: "The boot block must be a JSON object." }] };
  if (!Object.hasOwn(input, "hostContract")) fail("/hostContract", "Required.");
  else if (input["hostContract"] !== WORKBENCH_HOST_CONTRACT) {
    return { ok: false, issues: [{ path: "/hostContract", message: `Unsupported host contract ${JSON.stringify(input["hostContract"])?.slice(0, 32) ?? "value"}; this workbench implements 1.` }] };
  }
  known(input, "", ["hostContract", "apiBase", "auth", "gateway", "environment"]);

  if (input["apiBase"] !== undefined && !isSameOriginApiPath(input["apiBase"])) {
    fail("/apiBase", "Must be an absolute path on this page's origin (starting with one \"/\"), without a trailing slash, query, fragment, or \".\"/\"..\" segments.");
  }

  const auth = input["auth"];
  if (auth !== undefined) {
    if (!isPlainObject(auth)) fail("/auth", "Must be an object.");
    else {
      known(auth, "/auth", ["mode"]);
      if (auth["mode"] !== "token" && auth["mode"] !== "session") fail("/auth/mode", "Must be \"token\" or \"session\".");
    }
  }

  const gateway = input["gateway"];
  if (gateway !== undefined) {
    if (!isPlainObject(gateway)) fail("/gateway", "Must be an object.");
    else {
      known(gateway, "/gateway", ["origin", "path"]);
      const origin = gateway["origin"];
      if (typeof origin !== "string" || origin.length > MAX_PATH_LENGTH || !ORIGIN.test(origin)) {
        fail("/gateway/origin", "Must be an http(s) origin such as \"https://example.com\" (scheme, host and optional port; no path).");
      }
      if (gateway["path"] !== undefined && !isSameOriginApiPath(gateway["path"])) {
        fail("/gateway/path", "Must be an absolute path without a trailing slash, query, or fragment.");
      }
    }
  }

  const environment = input["environment"];
  if (environment !== undefined) {
    if (!isPlainObject(environment)) fail("/environment", "Must be an object.");
    else {
      known(environment, "/environment", ["kind", "label", "detail", "packageVersion"]);
      const kind = environment["kind"];
      if (kind !== "development" && kind !== "sandbox") fail("/environment/kind", "Must be \"development\" or \"sandbox\".");
      text(environment["label"], "/environment/label", WORKBENCH_LABEL_MAX_LENGTH, kind === "sandbox");
      text(environment["detail"], "/environment/detail", WORKBENCH_DETAIL_MAX_LENGTH, false);
      const version = environment["packageVersion"];
      if (version !== undefined && (typeof version !== "string" || version.length === 0 || version.length > MAX_VERSION_LENGTH || !VERSION.test(version))) {
        fail("/environment/packageVersion", "Must be an exact package version such as \"0.1.0\".");
      }
    }
  }

  return issues.length === 0 ? { ok: true, config: input as unknown as WorkbenchHostConfig } : { ok: false, issues };
}
