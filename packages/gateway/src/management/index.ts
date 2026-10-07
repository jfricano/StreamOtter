import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve as resolvePath, sep } from "node:path";
import { isWorkbenchOperation, StreamOtterError, type Gateway, type WorkbenchOperation } from "@streamotter/contracts";
import { DEFAULT_MANAGEMENT_PORT } from "@streamotter/contracts/internal";
import { getGatewayInternals, type GatewayInternals } from "../runtime/gateway.ts";
import { newId, TokenBucket } from "../runtime/util.ts";
import { createRouter, HttpError, IMPLEMENTED_OPERATIONS, MAX_MANAGEMENT_BODY_BYTES, sendError, sendResult } from "./router.ts";

/** Options for {@link startManagementServer}. */
export interface ManagementServerOptions {
  /** The gateway to manage, as returned by `createGateway`. It must be in development mode. */
  gateway: Gateway;
  /** Interface to bind. Default `"127.0.0.1"` (loopback). */
  host?: string;
  /** TCP port to listen on. Default 7401; 0 picks a free port. */
  port?: number;
  /** Bearer token every management request must carry. Default: a random token (24 bytes, base64url) generated for this run. */
  token?: string;
  /**
   * Directory of built workbench assets to serve from the same origin. Omitted, `null`, or a path that
   * cannot be resolved disables the UI; the API is served either way.
   */
  workbenchDir?: string | null;
}

/** A running management server, returned by {@link startManagementServer}. */
export interface ManagementServer {
  /** The origin the server listens on, with the bound port, such as `http://127.0.0.1:7401`. The API is under `/management/v1`. */
  readonly origin: string;
  /** The bearer token: send it as `Authorization: Bearer <token>` on every `/management/v1` request. */
  readonly token: string;
  /** Stops listening and closes open connections. Idempotent; the gateway also calls it when it stops. */
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
 * Starts the local development management API and, when `workbenchDir` is set, serves the
 * workbench from the same origin. This is what `streamotter dev` runs.
 *
 * Every `/management/v1` request requires the bearer token. A request with an `Origin` header
 * must carry exactly this server's origin; a request with only a `Referer` must be a GET from
 * this origin. No CORS access is ever granted. Requests are limited to 100 per second with a
 * burst of 200 (429 `OVERLOADED` beyond that), and bodies to 1 MiB (64 KiB on the V1.1 operator
 * routes). Responses use the `Result` envelope with `Cache-Control: no-store` and
 * `X-Request-Id`.
 *
 * The server's origin is added to the gateway's allowed browser origins so the workbench can
 * connect to the gateway, and the server closes when the gateway stops.
 *
 * @param options - The gateway and listener settings.
 * @returns The running server, once it is listening.
 * @throws Rejects with a StreamOtterError with code FORBIDDEN when the gateway is in production
 * mode, or INVALID_REQUEST when `gateway` was not created by `createGateway`, and with the
 * Node.js listen error when the address cannot be bound.
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

/** Options for {@link createManagementHandler}. */
export interface ManagementHandlerOptions {
  /** The gateway to manage, as returned by `createGateway`. It must be in development mode. */
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

/** Default `maxBodyBytes` for {@link createManagementHandler}: 65,536 bytes (64 KiB). */
export const DEFAULT_HANDLER_MAX_BODY_BYTES = 65_536;

/**
 * Creates a mountable management request handler for a host that runs the published workbench
 * under its own route (WHC-1 §6).
 *
 * The handler serves API routes only, never static files. It calls `authorize` first for every
 * request and answers 401 unless it returns `true`; `Authorization` headers are ignored, so no
 * native management token is involved. It answers only the listed operations (403 otherwise),
 * always answers capability discovery (`GET /workbench`), and requires
 * `X-StreamOtter-Workbench: 1` on every POST (403 without it) so a cross-site form cannot reach
 * a mutation. It adds no CORS headers. Responses use the `Result` envelope with
 * `Cache-Control: no-store` and `X-Request-Id`. Rate limits, sessions and leases are the host's.
 *
 * @param options - The gateway, the operation allowlist, the host's credential check and the body limit.
 * @returns A {@link ManagementHandler} to call from the host's route for its `apiBase`.
 * @throws A StreamOtterError with code FORBIDDEN when the gateway is in production mode, or
 * INVALID_REQUEST when `gateway` was not created by `createGateway`, `operations` is not an
 * array of WHC-1 operation names, `authorize` is not a function, or `maxBodyBytes` is not an
 * integer from 1 to 1,048,576.
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

