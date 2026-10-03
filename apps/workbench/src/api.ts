import {
  utf8ByteLength, WORKBENCH_REQUEST_HEADER,
  type Capabilities, type ChannelSummary, type ConfigIssue, type DevelopmentPrincipalSummary, type DiagnosticStep, type Json,
  type Page, type ProjectConfig, type Result, type SourceStatus, type StreamError, type Trace, type WorkbenchDiscovery,
  type WorkbenchOperation
} from "@streamotter/contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly error: StreamError;

  constructor(status: number, error: StreamError) {
    super(error.message);
    this.status = status;
    this.error = error;
  }
}

/** How requests authenticate (WHC-1 §3.2). */
export type ApiAuth = { mode: "token"; token: string } | { mode: "session" };

/** Where requests go: `apiBase` on this page's origin, or on `apiOrigin` when the boot block sets one (WHC-1 §3.4). */
export interface ApiTarget { apiBase: string; apiOrigin: string | null }

/** True for the response a host gives when its session credential is missing or has expired. */
function unauthenticated(status: number, error: StreamError | null): boolean {
  return status === 401 || error?.code === "UNAUTHENTICATED";
}

/**
 * Management API client. In token mode the per-run token lives only in this object's memory;
 * it is never written to storage, URLs, or the DOM. In session mode no Authorization header is
 * ever sent: the host's own credential authenticates, and every request carries
 * `X-StreamOtter-Workbench: 1`. Requests only ever go to `apiBase` on one origin, fixed when the
 * client is created from the boot block: the page's own, or `apiOrigin` (session mode only), which
 * is called with CORS, `credentials: "include"` and `redirect: "error"`. Once a session-mode
 * request is answered 401 or UNAUTHENTICATED, the session has ended: `onSessionEnded` runs once and
 * every later call fails locally, without a request.
 */
export class ManagementApi {
  readonly #prefix: string;
  readonly #origin: string;
  readonly #crossOrigin: boolean;
  readonly #auth: ApiAuth;
  readonly #onSessionEnded: () => void;
  #ended = false;
  #operations: ReadonlySet<WorkbenchOperation> | null = null;
  #maxRequestBytes: number | null = null;

  constructor(target: ApiTarget, auth: ApiAuth, onSessionEnded: () => void = () => {}) {
    if (target.apiOrigin !== null && auth.mode !== "session") throw new Error("apiOrigin is allowed only in session mode.");
    this.#prefix = `${target.apiOrigin ?? ""}${target.apiBase}`;
    this.#origin = target.apiOrigin ?? location.origin;
    this.#crossOrigin = target.apiOrigin !== null;
    this.#auth = auth;
    this.#onSessionEnded = onSessionEnded;
  }

  #sessionEnded(): ApiError {
    if (!this.#ended) {
      this.#ended = true;
      this.#onSessionEnded();
    }
    return new ApiError(401, { code: "UNAUTHENTICATED", message: "The session has ended.", retryable: false, requestId: "" });
  }

  /** Restricts the client to the discovered operations; anything else fails locally without a request. */
  restrict(operations: ReadonlySet<WorkbenchOperation>, maxRequestBytes: number | null): void {
    this.#operations = operations;
    this.#maxRequestBytes = maxRequestBytes;
  }

  async #call<T>(operation: WorkbenchOperation, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (this.#ended) throw this.#sessionEnded();
    if (this.#operations !== null && !this.#operations.has(operation)) {
      throw new ApiError(403, { code: "FORBIDDEN", message: "Not available in this environment.", retryable: false, requestId: "" });
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && this.#maxRequestBytes !== null && utf8ByteLength(payload) > this.#maxRequestBytes) {
      throw new ApiError(413, {
        code: "INVALID_REQUEST", retryable: false, requestId: "",
        message: `The request is larger than this environment accepts (${this.#maxRequestBytes} bytes).`
      });
    }
    // Operation paths are fixed strings plus encoded query parameters; this refuses anything that
    // would still resolve elsewhere than the one API origin.
    const url = new URL(`${this.#prefix}${path}`, location.href);
    if (url.origin !== this.#origin) throw new Error(`Refused a request outside the API origin: ${url.origin}`);
    const json = payload === undefined ? {} : { "content-type": "application/json" };
    const session = { method, headers: { [WORKBENCH_REQUEST_HEADER]: "1", ...json }, cache: "no-store", redirect: "error" } as const;
    const init: RequestInit = this.#auth.mode === "token"
      ? { method, headers: { authorization: `Bearer ${this.#auth.token}`, ...json }, cache: "no-store", credentials: "omit" }
      : this.#crossOrigin
        ? { ...session, mode: "cors", credentials: "include" }
        : { ...session, credentials: "same-origin" };
    if (payload !== undefined) init.body = payload;
    const response = await fetch(url, init);
    let result: Result<T>;
    try {
      result = await response.json() as Result<T>;
    } catch {
      if (this.#auth.mode === "session" && unauthenticated(response.status, null)) throw this.#sessionEnded();
      throw new ApiError(response.status, { code: "INTERNAL", message: `Unexpected response (${response.status}).`, retryable: true, requestId: "" });
    }
    if (!result.ok) {
      if (this.#auth.mode === "session" && unauthenticated(response.status, result.error)) throw this.#sessionEnded();
      throw new ApiError(response.status, result.error);
    }
    return result.data;
  }

  /** WHC-1 capability discovery. Never restricted: it is how the operations are learned. */
  workbench() { return this.#call<WorkbenchDiscovery>("workbench", "GET", "/workbench"); }
  health() { return this.#call<{ ready: boolean; sources: SourceStatus[] }>("health", "GET", "/health"); }
  capabilities() { return this.#call<Capabilities>("capabilities", "GET", "/capabilities"); }
  sources() { return this.#call<{ items: SourceStatus[] }>("sources", "GET", "/sources"); }
  channels() { return this.#call<{ items: ChannelSummary[] }>("channels", "GET", "/channels"); }
  config() { return this.#call<{ config: ProjectConfig; fingerprint: string }>("config", "GET", "/config"); }
  principals() { return this.#call<{ items: DevelopmentPrincipalSummary[] }>("dev.principals", "GET", "/dev/principals"); }
  checkSource(sourceId: string) { return this.#call<{ steps: DiagnosticStep[] }>("source-checks", "POST", "/source-checks", { sourceId }); }
  resumeSource(sourceId: string) { return this.#call<SourceStatus>("sources.resume", "POST", "/sources/resume", { sourceId }); }
  validate(config: Json) { return this.#call<{ valid: boolean; issues: ConfigIssue[] }>("config.validate", "POST", "/config/validate", { config }); }
  export(config: Json) { return this.#call<{ filename: "streamotter.json"; content: string; fingerprint: string }>("config.export", "POST", "/config/export", { config }); }
  previewSession(fixturePrincipalRef: string) {
    return this.#call<{ token: string; expiresAt: string; previewSessionId: string }>("preview-sessions", "POST", "/preview-sessions", { fixturePrincipalRef });
  }
  advance(sourceId: string, count: number) { return this.#call<{ advanced: number }>("dev.fixtures.advance", "POST", "/dev/fixtures/advance", { sourceId, count }); }
  disconnect(previewSessionId: string) { return this.#call<null>("dev.disconnect", "POST", "/dev/disconnect", { previewSessionId }); }
  traces(query: { limit?: number; cursor?: string; sourceId?: string; channel?: string; outcome?: string }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    return this.#call<Page<Trace>>("traces", "GET", `/traces${suffix}`);
  }
}
