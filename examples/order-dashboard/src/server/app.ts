/**
 * The order dashboard's own application server (not part of StreamOtter): serves the
 * browser UI, issues development sessions, and — in Kafka mode — owns the
 * authoritative order store and publishes each change to Kafka after writing it.
 *
 *   node dist/server/app.js            fixture mode (advance orders from the workbench)
 *   node dist/server/app.js --kafka    Kafka mode (this server publishes order changes)
 */
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import kafkajs from "kafkajs";
import { initialOrders, issueToken, nextState, orderKey, SEED_ORDERS, USERS, verifyToken, type OrderEvent, type StoredOrder } from "./domain.ts";
import { internalServiceToken } from "./service-token.ts";

const KAFKA_MODE = process.argv.includes("--kafka");
const PORT = Number(process.env["PORT"] ?? "3000");
const HOST = process.env["HOST"] ?? "127.0.0.1";
const GATEWAY_ORIGIN = process.env["STREAMOTTER_GATEWAY_ORIGIN"] ?? "http://127.0.0.1:7400";
const TOPIC = process.env["ORDER_TOPIC"] ?? "orders.status";
const WEB_DIR = resolve(import.meta.dirname, "../web");
const TYPES: Readonly<Record<string, string>> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json" };

if (process.env["NODE_ENV"] === "production") {
  console.error("The order dashboard example uses development-only demo sign-in and must not run with NODE_ENV=production.");
  process.exit(2);
}

// Kafka mode persists the authoritative store so it stays consistent with the topic across
// restarts (delete .data/ together with the topic to start over). Fixture mode needs no store here.
const DATA_FILE = process.env["ORDER_DATA_FILE"] ?? resolve(import.meta.dirname, "../../.data/orders.json");
const restored = KAFKA_MODE && existsSync(DATA_FILE);
const store: Map<string, StoredOrder> = restored
  ? new Map(Object.entries(JSON.parse(readFileSync(DATA_FILE, "utf8")) as Record<string, StoredOrder>))
  : initialOrders();
function persist(): void {
  if (!KAFKA_MODE) return;
  mkdirSync(resolve(DATA_FILE, ".."), { recursive: true });
  writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(Object.fromEntries(store), null, 2));
  renameSync(`${DATA_FILE}.tmp`, DATA_FILE);
}
let publish: (event: OrderEvent) => Promise<void> = async () => { throw new Error("Publishing is only available in Kafka mode."); };

if (KAFKA_MODE) {
  const { Kafka, logLevel, Partitioners } = kafkajs;
  const kafka = new Kafka({ clientId: "order-dashboard-app", brokers: (process.env["ORDER_KAFKA_BROKERS"] ?? "127.0.0.1:19092").split(","), logLevel: logLevel.WARN });
  const admin = kafka.admin();
  await admin.connect();
  if (!(await admin.listTopics()).includes(TOPIC)) {
    await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 3 }], waitForLeaders: true });
    console.log(`Created topic ${TOPIC}`);
  }
  await admin.disconnect();
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  // Key by order ID so one order's changes stay on one partition, in revision order.
  publish = async event => {
    await producer.send({ topic: TOPIC, acks: -1, messages: [{ key: event.order.orderId, value: JSON.stringify(event) }] });
  };
  if (!restored) {
    // First run: publish the seeded state so the topic and the store start consistent.
    persist();
    for (const order of store.values()) await publish({ tenantId: order.tenantId, revision: order.revision, order: order.state });
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 16_384) throw new Error("Body too large");
  }
  return text.length === 0 ? {} : JSON.parse(text);
}

function sessionPrincipal(request: IncomingMessage) {
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? "");
  return match?.[1] === undefined ? null : verifyToken(match[1]);
}

async function serveStatic(response: ServerResponse, file: string): Promise<void> {
  try {
    let body: Buffer | string = await readFile(join(WEB_DIR, file));
    if (file.endsWith(".html")) {
      body = body.toString("utf8").replace("</head>",
        `<meta name="streamotter-gateway-origin" content="${GATEWAY_ORIGIN}"><meta name="order-dashboard-mode" content="${KAFKA_MODE ? "kafka" : "fixture"}"></head>`);
    }
    response.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "content-security-policy": `default-src 'self'; connect-src 'self' ${GATEWAY_ORIGIN} ${GATEWAY_ORIGIN.replace(/^http/, "ws")}; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'`
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://app.invalid");
  try {
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return await serveStatic(response, "index.html");
    if (request.method === "GET" && url.pathname === "/react") return await serveStatic(response, "react.html");
    if (request.method === "GET" && /^\/(app|react)\.js(\.map)?$|^\/styles\.css$/.test(url.pathname)) return await serveStatic(response, url.pathname.slice(1));

    // Development-only demo sign-in. A real application uses its existing session system.
    if (request.method === "POST" && url.pathname === "/api/session") {
      const body = await readBody(request) as { user?: unknown };
      const issued = typeof body.user === "string" ? issueToken(body.user) : null;
      if (issued === null) return json(response, 400, { error: "Unknown demo user." });
      return json(response, 200, { ...issued, user: USERS[body.user as string] });
    }
    if (request.method === "GET" && url.pathname === "/api/orders") {
      const principal = sessionPrincipal(request);
      if (principal === null) return json(response, 401, { error: "Sign in first." });
      const mine = [...store.values()].filter(order => order.tenantId === principal.tenantId && order.owner === principal.subject);
      const restricted = SEED_ORDERS.find(seed => seed.tenantId === principal.tenantId && seed.owner !== principal.subject)?.orderId ?? "ord_1003";
      return json(response, 200, {
        orders: mine.map(order => ({ orderId: order.state.orderId, status: order.state.status })),
        restrictedOrderId: restricted,
        mode: KAFKA_MODE ? "kafka" : "fixture"
      });
    }
    const advance = /^\/api\/orders\/([A-Za-z0-9_-]{1,64})\/advance$/.exec(url.pathname);
    if (request.method === "POST" && advance !== null) {
      const principal = sessionPrincipal(request);
      if (principal === null) return json(response, 401, { error: "Sign in first." });
      if (!KAFKA_MODE) return json(response, 409, { error: "Fixture mode: advance the orders fixture from the StreamOtter workbench." });
      const key = orderKey(principal.tenantId, advance[1]!);
      const order = store.get(key);
      if (order === undefined || order.owner !== principal.subject) return json(response, 404, { error: "Order not found." });
      const next = nextState(order);
      if (next === null) return json(response, 409, { error: "The order is already delivered." });
      // Write the authoritative store first, then publish the full new state.
      store.set(key, next);
      persist();
      await publish({ tenantId: next.tenantId, revision: next.revision, order: next.state });
      return json(response, 200, { revision: next.revision, status: next.state.status });
    }
    const internal = /^\/internal\/orders\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (request.method === "GET" && internal !== null) {
      const provided = Buffer.from(String(request.headers["x-service-token"] ?? ""));
      const expected = Buffer.from(internalServiceToken());
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json(response, 401, { error: "Service token required." });
      const order = store.get(orderKey(internal[1]!, internal[2]!));
      if (order === undefined) return json(response, 404, { error: "Order not found." });
      return json(response, 200, { owner: order.owner, revision: order.revision, state: order.state });
    }
    response.writeHead(404).end();
  } catch (error) {
    console.error("Request failed", error);
    if (!response.headersSent) json(response, 500, { error: "Internal error." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Order dashboard (${KAFKA_MODE ? "Kafka" : "fixture"} mode) at http://localhost:${PORT} — React example at http://localhost:${PORT}/react`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => process.exit(0)));
