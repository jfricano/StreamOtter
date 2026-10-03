import type { IncomingMessage, ServerResponse } from "node:http";
import {
  canonicalJsonPretty, CAPABILITIES, isPlainObject, streamError, StreamOtterError, validateProjectConfig,
  WORKBENCH_HOST_CONTRACT, WORKBENCH_OPERATIONS, WORKBENCH_REQUEST_HEADER, type ErrorCode, type Json, type Result,
  type StreamError, type Trace, type WorkbenchDiscovery, type WorkbenchOperation
} from "@streamotter/contracts";
import type { GatewayInternals } from "../runtime/gateway.ts";
import { sha256Hex } from "../runtime/util.ts";

/**
 * The management router shared by the native management server and createManagementHandler, so
 * both validate requests identically. Callers authenticate first; the router resolves the
 * operation, enforces the operation allowlist, validates the query and body, and runs it.
 */

/** Largest request body any management route accepts. */
export const MAX_MANAGEMENT_BODY_BYTES = 1_048_576;

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  INVALID_REQUEST: 400, INVALID_PARAMS: 400, CONFIG_INVALID: 400, UNSUPPORTED_CAPABILITY: 400,
  UNAUTHENTICATED: 401, FORBIDDEN: 403, CHANNEL_NOT_FOUND: 404, TRACE_CURSOR_EXPIRED: 410,
  OVERLOADED: 429, SOURCE_UNAVAILABLE: 503, TIMEOUT: 504
};

export class HttpError extends Error {
  readonly status: number;
  readonly error: StreamError;

  constructor(status: number, code: ErrorCode, message?: string, details?: Readonly<Record<string, Json>>) {
    super(message ?? code);
    this.status = status;
    const options: { message?: string; details?: Readonly<Record<string, Json>> } = {};
    if (message !== undefined) options.message = message;
    if (details !== undefined) options.details = details;
    this.error = streamError(code, options);
  }
}

export function mapError(error: unknown): { status: number; error: StreamError } {
  if (error instanceof HttpError) return { status: error.status, error: error.error };
  if (error instanceof StreamOtterError) {
    const status = typeof error.details?.["status"] === "number" ? error.details["status"] : STATUS_BY_CODE[error.code] ?? 500;
    const { status: _omit, ...details } = (error.details ?? {}) as Record<string, Json>;
    const options: { message: string; retryable: boolean; details?: Readonly<Record<string, Json>> } = { message: error.message, retryable: error.retryable };
    if (Object.keys(details).length > 0) options.details = details;
    return { status, error: streamError(error.code, options) };
  }
  return { status: 500, error: streamError("INTERNAL") };
}

export function sendResult(response: ServerResponse, status: number, body: Result<unknown>): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

/** Sends a mapped error envelope, logging unexpected faults without request details. */
export function sendError(response: ServerResponse, internals: GatewayInternals, requestId: string, error: unknown): void {
  const mapped = mapError(error);
  if (mapped.status === 500) internals.logger.error("Management request failed", { requestId, error: String((error as Error)?.name ?? "Error") });
  sendResult(response, mapped.status, { ok: false, requestId, error: { ...mapped.error, requestId } });
}

function describeBytes(bytes: number): string {
  if (bytes % 1_048_576 === 0) return `${bytes / 1_048_576} MiB`;
  if (bytes % 1_024 === 0) return `${bytes / 1_024} KiB`;
  return `${bytes} bytes`;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const tooLarge = () => new HttpError(413, "INVALID_REQUEST", `The request body exceeds ${describeBytes(maxBytes)}.`);
  const declared = Number(request.headers["content-length"] ?? "0");
  if (declared > maxBytes) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw tooLarge();
    chunks.push(chunk as Buffer);
  }
  if (size === 0) throw new HttpError(400, "INVALID_REQUEST", "A JSON body is required.");
  const type = request.headers["content-type"] ?? "";
  if (!/^application\/json\b/i.test(type)) throw new HttpError(400, "INVALID_REQUEST", "Content-Type must be application/json.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "The body is not valid JSON.");
  }
}

/** Requires an object with exactly the listed keys (optional keys may be absent). */
function shape(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isPlainObject(value)) throw new HttpError(400, "INVALID_REQUEST", "The body must be a JSON object.");
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw new HttpError(400, "INVALID_REQUEST", `Unknown field "${key.slice(0, 64)}".`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new HttpError(400, "INVALID_REQUEST", `"${key}" is required.`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new HttpError(400, "INVALID_REQUEST", `${name} must be a non-empty string.`);
  return value;
}

function parseQuery(params: URLSearchParams, allowed: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key)) throw new HttpError(400, "INVALID_REQUEST", `Unknown query parameter "${key.slice(0, 64)}".`);
    if (Object.hasOwn(values, key)) throw new HttpError(400, "INVALID_REQUEST", `Duplicate query parameter "${key.slice(0, 64)}".`);
    values[key] = value;
  }
  return values;
}

interface RouteContext {
  internals: GatewayInternals;
  query: Record<string, string>;
  body: unknown;
  discovery: () => WorkbenchDiscovery;
}

interface Route {
  operation: WorkbenchOperation;
  method: "GET" | "POST";
  /** Path relative to the API base (for the native server, `/management/v1`). */
  path: string;
  /** Allowed query parameters (GET only). */
  query?: readonly string[];
  run(context: RouteContext): unknown;
}

const ROUTES: readonly Route[] = [
  { operation: "capabilities", method: "GET", path: "/capabilities", run: () => CAPABILITIES },
  { operation: "health", method: "GET", path: "/health", run: ({ internals }) => internals.health() },
  { operation: "sources", method: "GET", path: "/sources", run: ({ internals }) => ({ items: internals.sources() }) },
  { operation: "channels", method: "GET", path: "/channels", run: ({ internals }) => ({ items: internals.channels() }) },
  { operation: "config", method: "GET", path: "/config", run: ({ internals }) => ({ config: internals.config, fingerprint: internals.fingerprint }) },
  {
    operation: "traces", method: "GET", path: "/traces", query: ["limit", "cursor", "sourceId", "channel", "outcome"],
    run: ({ internals, query: q }) => {
      let limit = 100;
      if (q["limit"] !== undefined) {
        if (!/^\d{1,3}$/.test(q["limit"])) throw new HttpError(400, "INVALID_REQUEST", "limit must be an integer from 1 to 500.");
        limit = Number(q["limit"]);
        if (limit < 1 || limit > 500) throw new HttpError(400, "INVALID_REQUEST", "limit must be an integer from 1 to 500.");
      }
      const outcome = q["outcome"];
      if (outcome !== undefined && !["ok", "filtered", "rejected", "failed"].includes(outcome)) {
        throw new HttpError(400, "INVALID_REQUEST", "outcome must be ok, filtered, rejected, or failed.");
      }
      return internals.traces({
        limit,
        ...(q["cursor"] === undefined ? {} : { cursor: q["cursor"] }),
        ...(q["sourceId"] === undefined ? {} : { sourceId: q["sourceId"] }),
        ...(q["channel"] === undefined ? {} : { channel: q["channel"] }),
        ...(outcome === undefined ? {} : { outcome: outcome as Trace["outcome"] })
      });
    }
  },
  { operation: "dev.principals", method: "GET", path: "/dev/principals", run: ({ internals }) => ({ items: internals.developmentPrincipals() }) },
  { operation: "workbench", method: "GET", path: "/workbench", run: ({ discovery }) => discovery() },
  {
    operation: "source-checks", method: "POST", path: "/source-checks",
    run: async ({ internals, body }) => ({ steps: await internals.checkSource(requireString(shape(body, ["sourceId"])["sourceId"], "sourceId")) })
  },
  {
    operation: "config.validate", method: "POST", path: "/config/validate",
    run: ({ body }) => validateProjectConfig(shape(body, ["config"])["config"])
  },
  {
    operation: "config.export", method: "POST", path: "/config/export",
    run: ({ body }) => {
      const { config } = shape(body, ["config"]);
      const validation = validateProjectConfig(config);
      if (!validation.valid) {
        throw new HttpError(400, "CONFIG_INVALID", "The configuration is invalid and was not exported.", {
          issues: validation.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message }))
        });
      }
      return { filename: "streamotter.json", content: canonicalJsonPretty(config), fingerprint: sha256Hex(config) };
    }
  },
  {
    operation: "sources.resume", method: "POST", path: "/sources/resume",
    run: ({ internals, body }) => internals.resumeSource(requireString(shape(body, ["sourceId"])["sourceId"], "sourceId"))
  },
  {
    operation: "preview-sessions", method: "POST", path: "/preview-sessions",
    run: ({ internals, body }) => internals.createPreviewSession(requireString(shape(body, ["fixturePrincipalRef"])["fixturePrincipalRef"], "fixturePrincipalRef"))
  },
  {
    operation: "dev.fixtures.advance", method: "POST", path: "/dev/fixtures/advance",
    run: async ({ internals, body }) => {
      const fields = shape(body, ["sourceId", "count"]);
      const sourceId = requireString(fields["sourceId"], "sourceId");
      const count = fields["count"];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 100) {
        throw new HttpError(400, "INVALID_REQUEST", "count must be an integer from 1 to 100.");
      }
      return { advanced: await internals.advanceFixture(sourceId, count) };
    }
  },
  {
    operation: "dev.disconnect", method: "POST", path: "/dev/disconnect",
    run: ({ internals, body }) => {
      internals.disconnectPreviewSession(requireString(shape(body, ["previewSessionId"])["previewSessionId"], "previewSessionId"));
      return null;
    }
  }
];

/** Every operation this version of the management router implements, in WHC-1 order. */
export const IMPLEMENTED_OPERATIONS: readonly WorkbenchOperation[] = Object.freeze(
  WORKBENCH_OPERATIONS.filter(operation => ROUTES.some(route => route.operation === operation))
);

export interface RouterOptions {
  internals: GatewayInternals;
  /** Operations this router answers; others are refused with 403. `workbench` (discovery) is always answered. */
  operations: readonly WorkbenchOperation[];
  maxBodyBytes: number;
  /** When true, POST requests must carry `X-StreamOtter-Workbench: 1` (createManagementHandler's CSRF guard). */
  requireWorkbenchHeader: boolean;
}

export type ManagementRouter = (request: IncomingMessage, path: string | null, query: URLSearchParams) => Promise<unknown>;

/** Builds the router. It returns the operation's data or throws an error for mapError. */
export function createRouter(options: RouterOptions): ManagementRouter {
  const allowed = new Set<WorkbenchOperation>([...options.operations, "workbench"]);
  const discovery: WorkbenchDiscovery = Object.freeze({
    hostContract: WORKBENCH_HOST_CONTRACT,
    operations: Object.freeze(IMPLEMENTED_OPERATIONS.filter(operation => allowed.has(operation))),
    limits: Object.freeze({ maxRequestBytes: options.maxBodyBytes })
  });
  return async (request, path, query) => {
    const route = path === null ? undefined : ROUTES.find(candidate => candidate.path === path && candidate.method === request.method);
    if (route === undefined) throw new HttpError(404, "INVALID_REQUEST", "Unknown management route.");
    if (!allowed.has(route.operation)) throw new HttpError(403, "FORBIDDEN", `The "${route.operation}" operation is not available in this environment.`);
    const values = parseQuery(query, route.query ?? []);
    let body: unknown = null;
    if (route.method === "POST") {
      if (options.requireWorkbenchHeader && request.headers[WORKBENCH_REQUEST_HEADER.toLowerCase()] !== "1") {
        throw new HttpError(403, "FORBIDDEN", "Requests that change state must carry the X-StreamOtter-Workbench: 1 header.");
      }
      body = await readJsonBody(request, options.maxBodyBytes);
    }
    return route.run({ internals: options.internals, query: values, body, discovery: () => discovery });
  };
}
