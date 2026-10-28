import {
  WORKBENCH_REQUEST_HEADER, type Capabilities, type ChannelSummary, type ConfigIssue, type DevelopmentPrincipalSummary,
  type DiagnosticStep, type EvaluateRequest, type EvaluationResult, type IncidentDetail, type IncidentSummary,
  type Json, type ListFailuresRequest, type OperationResult, type OperatorStatus, type Page, type ProjectConfig,
  type ReassessRequest, type RedriveRequest, type ReopenCircuitRequest, type ReproductionBundle, type Result,
  type RetryCurrentRequest, type SourceStatus, type StreamError, type Trace, type WorkbenchDiscovery,
  type WorkbenchOperation
} from "@streamotter/contracts";
import { isPlainObject, utf8ByteLength } from "@streamotter/contracts/internal";

/** A failed management call: the error the API answered with, or one the client raised itself (session ended, operation not offered, request too large, response not a Result). */
export class ApiError extends Error {
  /** The HTTP status, or for a failure raised without a request the status it stands for (401, 403 or 413). */
  readonly status: number;
  /** The response's StreamError, or one built here, with an empty `requestId`, when there was no request or no Result to read. */
  readonly error: StreamError;

  /** Takes the StreamError's message as this error's message. */
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

/** True for a body shaped like a management Result; anything else is treated like a body that is not JSON. */
function isResult(body: unknown): body is Result<unknown> {
  if (!isPlainObject(body)) return false;
  return body["ok"] === true ? "data" in body : body["ok"] === false && isPlainObject(body["error"]);
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

  /** Throws when `target.apiOrigin` is set outside session mode. `onSessionEnded` runs at most once, when a session-mode request is first answered 401 or UNAUTHENTICATED. */
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
    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      answer = undefined;
    }
    // A body that is not JSON, or JSON that is not a Result (`null`, an array, a string), says nothing
    // more than the status does. In session mode any 401 ends the session, whatever its body.
    const result = isResult(answer) ? answer as Result<T> : null;
    const error = result !== null && !result.ok ? result.error : null;
    if (this.#auth.mode === "session" && unauthenticated(response.status, error)) throw this.#sessionEnded();
    if (result === null) {
      throw new ApiError(response.status, { code: "INTERNAL", message: `Unexpected response (${response.status}).`, retryable: true, requestId: "" });
    }
    if (!result.ok) throw new ApiError(response.status, result.error);
    return result.data;
  }

  /** WHC-1 capability discovery. Never restricted: it is how the operations are learned. */
  workbench() { return this.#call<WorkbenchDiscovery>("workbench", "GET", "/workbench"); }
  /** Each source's status, and `ready`: true while the gateway runs and every source is healthy. */
  health() { return this.#call<{ ready: boolean; sources: SourceStatus[] }>("health", "GET", "/health"); }
  /** The protocol capabilities the gateway advertises to clients. */
  capabilities() { return this.#call<Capabilities>("capabilities", "GET", "/capabilities"); }
  /** Every configured source with its current status. */
  sources() { return this.#call<{ items: SourceStatus[] }>("sources", "GET", "/sources"); }
  /** The deployed channels: name, version, source, and parameter and payload schema names. */
  channels() { return this.#call<{ items: ChannelSummary[] }>("channels", "GET", "/channels"); }
  /** The configuration the gateway is running, with its sha256 fingerprint. */
  config() { return this.#call<{ config: ProjectConfig; fingerprint: string }>("config", "GET", "/config"); }
  /** The registered development principals that Preview can subscribe as. */
  principals() { return this.#call<{ items: DevelopmentPrincipalSummary[] }>("dev.principals", "GET", "/dev/principals"); }
  /** Runs one source's staged connection diagnostics and returns every step, including those skipped after a failure. */
  checkSource(sourceId: string) { return this.#call<{ steps: DiagnosticStep[] }>("source-checks", "POST", "/source-checks", { sourceId }); }
  /** Resumes a paused source at its uncommitted position, so the record that paused it is retried, and returns its new status. */
  resumeSource(sourceId: string) { return this.#call<SourceStatus>("sources.resume", "POST", "/sources/resume", { sourceId }); }
  /** Checks a candidate configuration without applying it. Problems come back as `issues`, not as an error. */
  validate(config: Json) { return this.#call<{ valid: boolean; issues: ConfigIssue[] }>("config.validate", "POST", "/config/validate", { config }); }
  /** The candidate as canonical streamotter.json, with its fingerprint. An invalid candidate fails with CONFIG_INVALID and its issues in `details.issues`. */
  export(config: Json) { return this.#call<{ filename: "streamotter.json"; content: string; fingerprint: string }>("config.export", "POST", "/config/export", { config }); }
  /** Mints a short-lived gateway token that authenticates as a development principal, for Preview's client. */
  previewSession(fixturePrincipalRef: string) {
    return this.#call<{ token: string; expiresAt: string; previewSessionId: string }>("preview-sessions", "POST", "/preview-sessions", { fixturePrincipalRef });
  }
  /** Moves a fixture source forward by `count` records (1 to 100) and returns how many it advanced. */
  advance(sourceId: string, count: number) { return this.#call<{ advanced: number }>("dev.fixtures.advance", "POST", "/dev/fixtures/advance", { sourceId, count }); }
  /** Closes the gateway connections of one preview session, so Preview can show the client reconnect and resynchronize. */
  disconnect(previewSessionId: string) { return this.#call<null>("dev.disconnect", "POST", "/dev/disconnect", { previewSessionId }); }
  /** A page of trace metadata from the gateway's bounded buffer. Undefined and empty filters are left out of the query. */
  traces(query: { limit?: number; cursor?: string; sourceId?: string; channel?: string; outcome?: string }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    return this.#call<Page<Trace>>("traces", "GET", `/traces${suffix}`);
  }
  // V1.1 failure operations (V1_1_API.md §9). Never raw evidence: no route offers it.
  /** The gateway, the incident store, the quarantine topic, and every source's failure-handling state. */
  operatorStatus() { return this.#call<OperatorStatus>("operator.status", "GET", "/operator/status"); }
  /** A page of incident summaries. Undefined and empty filters are left out of the query. */
  failures(query: ListFailuresRequest) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    return this.#call<Page<IncidentSummary>>("failures.list", "GET", `/failures${suffix}`);
  }
  /** One incident in full, with its explanation and history. */
  failure(failureId: string) { return this.#call<IncidentDetail>("failures.show", "GET", `/failures/${encodeURIComponent(failureId)}`); }
  /** An incident's reproduction bundle, for a bug report. */
  exportFailure(failureId: string) { return this.#call<ReproductionBundle>("failures.export", "POST", "/failures/export", { failureId }); }
  /** Runs an incident's record through the current mapping without delivering it, and issues a single-use redrive plan when a redrive would be allowed. */
  evaluate(request: EvaluateRequest) { return this.#call<EvaluationResult>("failures.evaluate", "POST", "/failures/evaluate", request); }
  /** Executes a plan that `evaluate` issued. A stale plan or revision is refused in the result, not thrown. */
  redrive(request: RedriveRequest) { return this.#call<OperationResult>("failures.redrive", "POST", "/failures/redrive", request); }
  /** Retries the record a source is held at. The retry never skips the record. */
  retryCurrent(request: RetryCurrentRequest) { return this.#call<OperationResult>("sources.retry-current", "POST", "/sources/retry-current", request); }
  /** Runs a held quarantine-resync incident's recovery guard again. It never overrides an integrity failure. */
  reassess(request: ReassessRequest) { return this.#call<OperationResult>("sources.reassess", "POST", "/sources/reassess", request); }
  /** Closes a source's open automatic-continuation circuit and clears the advances it counted. It approves no record: held records stay held. */
  reopenCircuit(request: ReopenCircuitRequest) { return this.#call<OperationResult>("sources.reopen-circuit", "POST", "/sources/reopen-circuit", request); }
}
