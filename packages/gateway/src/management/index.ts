import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve as resolvePath, sep } from "node:path";
import {
  DEFAULT_MANAGEMENT_PORT, isWorkbenchOperation, StreamOtterError, type Gateway, type WorkbenchOperation
} from "@streamotter/contracts";
import { getGatewayInternals, type GatewayInternals } from "../runtime/gateway.ts";
import { newId, TokenBucket } from "../runtime/util.ts";
import { createRouter, HttpError, IMPLEMENTED_OPERATIONS, MAX_MANAGEMENT_BODY_BYTES, sendError, sendResult } from "./router.ts";

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

const API_BASE = "/management/v1";

function tokensEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
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
  const router = createRouter({ internals, operations: IMPLEMENTED_OPERATIONS, maxBodyBytes: MAX_MANAGEMENT_BODY_BYTES, requireWorkbenchHeader: false });
  let origin = "";

  const server = createServer((request, response) => {
    const requestId = newId();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    handle(request, response, requestId).catch(error => sendError(response, internals, requestId, error));
  });

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
    const path = url.pathname.startsWith(`${API_BASE}/`) ? url.pathname.slice(API_BASE.length) : null;
    const data = await router(request, path, url.searchParams);
    sendResult(response, 200, { ok: true, requestId, data });
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

export interface ManagementHandlerOptions {
  /** Must be a development-mode gateway. */
  gateway: Gateway;
  /** The operations this host offers (WHC-1 §5). Everything else is refused with 403. Discovery (`workbench`) is always answered. */
  operations: readonly WorkbenchOperation[];
  /**
   * The host's own credential check (for example its session cookie), called first for every
   * request. Anything but `true` is refused with 401. It is the only credential check:
   * `Authorization` headers are ignored.
   */
  authorize(request: IncomingMessage): boolean | Promise<boolean>;
  /** Largest accepted JSON body for every route. Default 64 KiB; at most 1 MiB. Reported as `limits.maxRequestBytes`. */
  maxBodyBytes?: number;
}

/**
 * Handles one request for the management API mounted under a host's own `apiBase`.
 * `pathWithinApi` is the request path after `apiBase`, such as `/traces`. The query string is
 * read from `pathWithinApi` when it has one, and otherwise from `request.url`.
 */
export type ManagementHandler = (request: IncomingMessage, response: ServerResponse, pathWithinApi: string) => Promise<void>;

/** Default `maxBodyBytes` for createManagementHandler. */
export const DEFAULT_HANDLER_MAX_BODY_BYTES = 65_536;

/**
 * A mountable management request handler for a host that runs the published workbench under its
 * own route (WHC-1 §6). It serves API routes only, never static files; it refuses production
 * gateways; it answers only the listed operations (403 otherwise); and it requires
 * `X-StreamOtter-Workbench: 1` on every POST so a cross-site form cannot reach a mutation. The
 * host's `authorize` callback is the only credential check, so no native management token is
 * involved. Rate limits, sessions, and leases are the host's.
 */
export function createManagementHandler(options: ManagementHandlerOptions): ManagementHandler {
  const internals = getGatewayInternals(options.gateway);
  if (internals.mode !== "development") {
    throw new StreamOtterError("FORBIDDEN", { message: "The management handler is only available for development-mode gateways." });
  }
  if (!Array.isArray(options.operations)) throw new StreamOtterError("INVALID_REQUEST", { message: "operations must be an array of WHC-1 operation names." });
  for (const operation of options.operations as readonly unknown[]) {
    if (!isWorkbenchOperation(operation)) {
      throw new StreamOtterError("INVALID_REQUEST", { message: `Unknown workbench operation ${JSON.stringify(operation)?.slice(0, 64) ?? "value"}.` });
    }
  }
  if (typeof options.authorize !== "function") throw new StreamOtterError("INVALID_REQUEST", { message: "authorize must be a function." });
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_HANDLER_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_MANAGEMENT_BODY_BYTES) {
    throw new StreamOtterError("INVALID_REQUEST", { message: `maxBodyBytes must be an integer from 1 to ${MAX_MANAGEMENT_BODY_BYTES}.` });
  }
  const authorize = options.authorize;
  const router = createRouter({ internals, operations: [...options.operations], maxBodyBytes, requireWorkbenchHeader: true });

  return async (request, response, pathWithinApi) => {
    const requestId = newId();
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (await authorize(request) !== true) throw new HttpError(401, "UNAUTHENTICATED", "The host session did not authorize this request.");
      let path: string | null = null;
      let query = new URL(request.url ?? "/", "http://management.invalid").searchParams;
      if (typeof pathWithinApi === "string" && pathWithinApi.startsWith("/") && !pathWithinApi.startsWith("//")) {
        const inner = new URL(pathWithinApi, "http://management.invalid");
        path = inner.pathname;
        if (pathWithinApi.includes("?")) query = inner.searchParams;
      }
      const data = await router(request, path, query);
      sendResult(response, 200, { ok: true, requestId, data });
    } catch (error) {
      sendError(response, internals, requestId, error);
    }
  };
}

export type { GatewayInternals };
