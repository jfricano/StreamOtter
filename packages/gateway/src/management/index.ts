import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve as resolvePath, sep } from "node:path";
import {
  canonicalJsonPretty, CAPABILITIES, DEFAULT_MANAGEMENT_PORT, isPlainObject, streamError, StreamOtterError,
  validateProjectConfig, type ErrorCode, type Gateway, type Json, type Result, type StreamError, type Trace
} from "@streamotter/contracts";
import { getGatewayInternals, type GatewayInternals } from "../runtime/gateway.ts";
import { newId, sha256Hex, TokenBucket } from "../runtime/util.ts";

export interface ManagementServerOptions {
  gateway: Gateway;
  /** Loopback by default. */
  host?: string;
  port?: number;
  /** Per-run bearer token; generated when omitted. */
  token?: string;
  /** Built workbench assets to serve from the same origin; null disables the UI. */
  workbenchDir?: string | null;
}

export interface ManagementServer {
  readonly origin: string;
  readonly token: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_048_576;

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  INVALID_REQUEST: 400, INVALID_PARAMS: 400, CONFIG_INVALID: 400, UNSUPPORTED_CAPABILITY: 400,
  UNAUTHENTICATED: 401, FORBIDDEN: 403, CHANNEL_NOT_FOUND: 404, TRACE_CURSOR_EXPIRED: 410,
  OVERLOADED: 429, SOURCE_UNAVAILABLE: 503, TIMEOUT: 504
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

class HttpError extends Error {
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

function tokensEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "INVALID_REQUEST", "The request body exceeds 1 MiB.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "INVALID_REQUEST", "The request body exceeds 1 MiB.");
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

function mapError(error: unknown): { status: number; error: StreamError } {
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

/**
 * Local development management API and workbench host. Every /management/v1
 * operation requires the per-run bearer token. Browser requests must carry the
 * exact workbench Origin (or, for same-origin GETs, a same-origin Referer). No
 * CORS is ever granted. Refuses to start for production gateways.
 */
export async function startManagementServer(options: ManagementServerOptions): Promise<ManagementServer> {
  const internals = getGatewayInternals(options.gateway);
  if (internals.mode !== "development") {
    throw new StreamOtterError("FORBIDDEN", { message: "The management API is only available in development mode." });
  }
  const token = options.token ?? randomBytes(24).toString("base64url");
  const host = options.host ?? "127.0.0.1";
  const workbenchDir = options.workbenchDir === undefined || options.workbenchDir === null ? null : await realpath(options.workbenchDir).catch(() => null);
  const bucket = new TokenBucket(100, 200);
  let origin = "";

  const server = createServer((request, response) => {
    const requestId = newId();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    handle(request, response, requestId).catch(error => {
      const mapped = mapError(error);
      if (mapped.status === 500) internals.logger.error("Management request failed", { requestId, error: String((error as Error)?.name ?? "Error") });
      send(response, mapped.status, { ok: false, requestId, error: { ...mapped.error, requestId } });
    });
  });

  function send(response: ServerResponse, status: number, body: Result<unknown>): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }

  function checkBrowserOrigin(request: IncomingMessage): void {
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== undefined) {
      if (requestOrigin !== origin) throw new HttpError(403, "FORBIDDEN", "Cross-origin management requests are not allowed.");
      return;
    }
    const referer = request.headers.referer;
    if (referer !== undefined) {
      if (request.method !== "GET" || !(referer === origin || referer.startsWith(`${origin}/`))) {
        throw new HttpError(403, "FORBIDDEN", "Cross-origin management requests are not allowed.");
      }
    }
  }

  function query(url: URL, allowed: readonly string[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (!allowed.includes(key)) throw new HttpError(400, "INVALID_REQUEST", `Unknown query parameter "${key.slice(0, 64)}".`);
      if (Object.hasOwn(values, key)) throw new HttpError(400, "INVALID_REQUEST", `Duplicate query parameter "${key.slice(0, 64)}".`);
      values[key] = value;
    }
    return values;
  }

  async function handle(request: IncomingMessage, response: ServerResponse, requestId: string): Promise<void> {
    const url = new URL(request.url ?? "/", "http://management.invalid");
    if (!url.pathname.startsWith("/management/")) {
      await serveStatic(request, response, url.pathname);
      return;
    }
    checkBrowserOrigin(request);
    const authorization = request.headers.authorization ?? "";
    const provided = /^Bearer (.+)$/.exec(authorization)?.[1] ?? "";
    if (!tokensEqual(token, provided)) throw new HttpError(401, "UNAUTHENTICATED", "A valid management bearer token is required.");
    if (!bucket.take()) throw new HttpError(429, "OVERLOADED", "Too many management requests.");
    const route = `${request.method ?? "GET"} ${url.pathname}`;
    const ok = (data: unknown) => send(response, 200, { ok: true, requestId, data });
    const noQuery = () => query(url, []);

    switch (route) {
      case "GET /management/v1/capabilities":
        noQuery();
        return ok(CAPABILITIES);
      case "GET /management/v1/health":
        noQuery();
        return ok(internals.health());
      case "GET /management/v1/sources":
        noQuery();
        return ok({ items: internals.sources() });
      case "GET /management/v1/channels":
        noQuery();
        return ok({ items: internals.channels() });
      case "GET /management/v1/config":
        noQuery();
        return ok({ config: internals.config, fingerprint: internals.fingerprint });
      case "GET /management/v1/traces": {
        const q = query(url, ["limit", "cursor", "sourceId", "channel", "outcome"]);
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
        const page = internals.traces({
          limit,
          ...(q["cursor"] === undefined ? {} : { cursor: q["cursor"] }),
          ...(q["sourceId"] === undefined ? {} : { sourceId: q["sourceId"] }),
          ...(q["channel"] === undefined ? {} : { channel: q["channel"] }),
          ...(outcome === undefined ? {} : { outcome: outcome as Trace["outcome"] })
        });
        return ok(page);
      }
      case "GET /management/v1/dev/principals":
        noQuery();
        return ok({ items: internals.developmentPrincipals() });
      default:
        break;
    }

    if (request.method !== "POST") throw new HttpError(404, "INVALID_REQUEST", "Unknown management route.");
    noQuery();
    const body = await readJsonBody(request);
    switch (route) {
      case "POST /management/v1/source-checks": {
        const sourceId = requireString(shape(body, ["sourceId"])["sourceId"], "sourceId");
        return ok({ steps: await internals.checkSource(sourceId) });
      }
      case "POST /management/v1/config/validate": {
        const { config } = shape(body, ["config"]);
        return ok(validateProjectConfig(config));
      }
      case "POST /management/v1/config/export": {
        const { config } = shape(body, ["config"]);
        const validation = validateProjectConfig(config);
        if (!validation.valid) {
          throw new HttpError(400, "CONFIG_INVALID", "The configuration is invalid and was not exported.", {
            issues: validation.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message }))
          });
        }
        return ok({ filename: "streamotter.json", content: canonicalJsonPretty(config), fingerprint: sha256Hex(config) });
      }
      case "POST /management/v1/sources/resume": {
        const sourceId = requireString(shape(body, ["sourceId"])["sourceId"], "sourceId");
        return ok(await internals.resumeSource(sourceId));
      }
      case "POST /management/v1/preview-sessions": {
        const ref = requireString(shape(body, ["fixturePrincipalRef"])["fixturePrincipalRef"], "fixturePrincipalRef");
        return ok(internals.createPreviewSession(ref));
      }
      case "POST /management/v1/dev/fixtures/advance": {
        const fields = shape(body, ["sourceId", "count"]);
        const sourceId = requireString(fields["sourceId"], "sourceId");
        const count = fields["count"];
        if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 100) {
          throw new HttpError(400, "INVALID_REQUEST", "count must be an integer from 1 to 100.");
        }
        return ok({ advanced: await internals.advanceFixture(sourceId, count) });
      }
      case "POST /management/v1/dev/disconnect": {
        const previewSessionId = requireString(shape(body, ["previewSessionId"])["previewSessionId"], "previewSessionId");
        internals.disconnectPreviewSession(previewSessionId);
        return ok(null);
      }
      default:
        throw new HttpError(404, "INVALID_REQUEST", "Unknown management route.");
    }
  }

  async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (workbenchDir === null || (request.method !== "GET" && request.method !== "HEAD")) {
      response.statusCode = 404;
      response.end();
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const file = resolvePath(workbenchDir, relative);
    if (!file.startsWith(workbenchDir + sep) || relative.includes("\0")) {
      response.statusCode = 404;
      response.end();
      return;
    }
    let target = file;
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = join(target, "index.html");
      const real = await realpath(target);
      if (!real.startsWith(workbenchDir + sep)) throw new Error("outside");
      let content: Buffer | string = await readFile(real);
      if (extname(real) === ".html") {
        // Tell the workbench where the gateway listens (not secret; the token is never embedded).
        const address = internals.address();
        const escape = (value: string) => value.replace(/[&"<>]/g, character => `&#${character.charCodeAt(0)};`);
        const meta = address === null ? "" :
          `<meta name="streamotter-gateway-origin" content="${escape(address.origin)}"><meta name="streamotter-gateway-path" content="${escape(address.path)}">`;
        content = content.toString("utf8").replace("</head>", `${meta}</head>`);
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", CONTENT_TYPES[extname(real)] ?? "application/octet-stream");
      const gatewayOrigin = internals.address()?.origin ?? "";
      const socketOrigin = gatewayOrigin.replace(/^http/, "ws");
      response.setHeader("Content-Security-Policy", [
        "default-src 'self'",
        `connect-src 'self' ${gatewayOrigin} ${socketOrigin}`.trim(),
        "img-src 'self' data:",
        "style-src 'self'",
        "script-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ].join("; "));
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_MANAGEMENT_PORT, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  origin = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
  internals.allowDevelopmentOrigin(origin);

  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closing;
  };
  internals.onStop(close);
  return { origin, token, close };
}

export type { GatewayInternals };
