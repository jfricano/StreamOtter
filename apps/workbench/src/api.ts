import type {
  Capabilities, ChannelSummary, ConfigIssue, DevelopmentPrincipalSummary, DiagnosticStep, Json, Page, ProjectConfig,
  Result, SourceStatus, StreamError, Trace
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

/**
 * Management API client. The per-run token lives only in this object's memory;
 * it is never written to storage, URLs, or the DOM.
 */
export class ManagementApi {
  readonly #token: string;

  constructor(token: string) {
    this.#token = token;
  }

  async #call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/management/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit"
    });
    let result: Result<T>;
    try {
      result = await response.json() as Result<T>;
    } catch {
      throw new ApiError(response.status, { code: "INTERNAL", message: `Unexpected response (${response.status}).`, retryable: true, requestId: "" });
    }
    if (!result.ok) throw new ApiError(response.status, result.error);
    return result.data;
  }

  health() { return this.#call<{ ready: boolean; sources: SourceStatus[] }>("GET", "/health"); }
  capabilities() { return this.#call<Capabilities>("GET", "/capabilities"); }
  sources() { return this.#call<{ items: SourceStatus[] }>("GET", "/sources"); }
  channels() { return this.#call<{ items: ChannelSummary[] }>("GET", "/channels"); }
  config() { return this.#call<{ config: ProjectConfig; fingerprint: string }>("GET", "/config"); }
  principals() { return this.#call<{ items: DevelopmentPrincipalSummary[] }>("GET", "/dev/principals"); }
  checkSource(sourceId: string) { return this.#call<{ steps: DiagnosticStep[] }>("POST", "/source-checks", { sourceId }); }
  resumeSource(sourceId: string) { return this.#call<SourceStatus>("POST", "/sources/resume", { sourceId }); }
  validate(config: Json) { return this.#call<{ valid: boolean; issues: ConfigIssue[] }>("POST", "/config/validate", { config }); }
  export(config: Json) { return this.#call<{ filename: "streamotter.json"; content: string; fingerprint: string }>("POST", "/config/export", { config }); }
  previewSession(fixturePrincipalRef: string) {
    return this.#call<{ token: string; expiresAt: string; previewSessionId: string }>("POST", "/preview-sessions", { fixturePrincipalRef });
  }
  advance(sourceId: string, count: number) { return this.#call<{ advanced: number }>("POST", "/dev/fixtures/advance", { sourceId, count }); }
  disconnect(previewSessionId: string) { return this.#call<null>("POST", "/dev/disconnect", { previewSessionId }); }
  traces(query: { limit?: number; cursor?: string; sourceId?: string; channel?: string; outcome?: string }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    return this.#call<Page<Trace>>("GET", `/traces${suffix}`);
  }
}
