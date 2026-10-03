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

/**
 * Management API client. In token mode the per-run token lives only in this object's memory;
 * it is never written to storage, URLs, or the DOM. In session mode no Authorization header is
 * ever sent: the host's same-origin credential authenticates, and every request carries
 * `X-StreamOtter-Workbench: 1`. Requests only ever go to `apiBase`, a path on this page's origin.
 */
export class ManagementApi {
  readonly #apiBase: string;
  readonly #auth: ApiAuth;
  #operations: ReadonlySet<WorkbenchOperation> | null = null;
  #maxRequestBytes: number | null = null;

  constructor(apiBase: string, auth: ApiAuth) {
    this.#apiBase = apiBase;
    this.#auth = auth;
  }

  /** Restricts the client to the discovered operations; anything else fails locally without a request. */
  restrict(operations: ReadonlySet<WorkbenchOperation>, maxRequestBytes: number | null): void {
    this.#operations = operations;
    this.#maxRequestBytes = maxRequestBytes;
  }

  async #call<T>(operation: WorkbenchOperation, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
    const json = payload === undefined ? {} : { "content-type": "application/json" };
    const init: RequestInit = this.#auth.mode === "token"
      ? { method, headers: { authorization: `Bearer ${this.#auth.token}`, ...json }, cache: "no-store", credentials: "omit" }
      : { method, headers: { [WORKBENCH_REQUEST_HEADER]: "1", ...json }, cache: "no-store", credentials: "same-origin", redirect: "error" };
    if (payload !== undefined) init.body = payload;
    const response = await fetch(`${this.#apiBase}${path}`, init);
    let result: Result<T>;
    try {
      result = await response.json() as Result<T>;
    } catch {
      throw new ApiError(response.status, { code: "INTERNAL", message: `Unexpected response (${response.status}).`, retryable: true, requestId: "" });
    }
    if (!result.ok) throw new ApiError(response.status, result.error);
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
