import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { HealthReason, HealthResponse } from "@streamotter/contracts";

/** Most simultaneous connections the listener keeps; a probe needs one. */
const MAX_CONNECTIONS = 32;
/** A probe that has not sent its request by then is dropped. */
const REQUEST_TIMEOUT_MS = 5_000;

export interface HealthListener {
  readonly origin: string;
  close(): Promise<void>;
}

/** Report order is fixed so a probe's body is stable while nothing changes. */
const REASON_ORDER: readonly HealthReason[] = ["starting", "source-held", "source-unavailable", "journal", "quarantine"];

export function healthBody(reasons: Iterable<HealthReason>): HealthResponse {
  const present = new Set(reasons);
  const ordered = REASON_ORDER.filter(reason => present.has(reason));
  return { status: ordered.length === 0 ? "ok" : "unavailable", reasons: ordered };
}

/**
 * The read-only health listener (ADR-15C §4, V1.1 API §8). It serves only
 * GET /health/live, which answers ok while the process serves requests (a broker
 * outage does not change it), and GET /health/ready, which answers 503 with
 * reason categories while the gateway cannot serve. Bodies never carry topic
 * names, incident IDs or messages, and no CORS headers are sent. Anything else
 * is 404 with no body.
 */
export async function startHealthListener(options: { host: string; port: number; readiness: () => Iterable<HealthReason> }): Promise<HealthListener> {
  const respond = (response: ServerResponse, status: number, body: HealthResponse | null) => {
    response.statusCode = status;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (body === null) {
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // Bodies are never read; the request is answered from the method and path alone.
    request.resume();
    const path = request.url ?? "";
    if (request.method !== "GET" && request.method !== "HEAD") return respond(response, 404, null);
    if (path === "/health/live") return respond(response, 200, healthBody([]));
    if (path === "/health/ready") {
      let body: HealthResponse;
      try {
        body = healthBody(options.readiness());
      } catch {
        body = healthBody(["starting"]);
      }
      return respond(response, body.status === "ok" ? 200 : 503, body);
    }
    return respond(response, 404, null);
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 1_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  let closing: Promise<void> | null = null;
  return {
    origin: `http://${host}:${address.port}`,
    close() {
      closing ??= new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    }
  };
}

/** Checks GatewayOptions.health; returns human-readable issues. */
export function healthOptionIssues(health: unknown): string[] {
  if (health === undefined) return [];
  if (typeof health !== "object" || health === null || Array.isArray(health)) return ["health must be an object with a port"];
  const issues: string[] = [];
  const { host, port, ...rest } = health as Record<string, unknown>;
  for (const key of Object.keys(rest)) issues.push(`health.${key} is not a known option`);
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65_535) issues.push("health.port must be an integer from 0 to 65535");
  if (host !== undefined && (typeof host !== "string" || host.length === 0 || host.length > 255)) issues.push("health.host must be a non-empty host name or address");
  return issues;
}
