/**
 * The order dashboard's own application server (not part of StreamOtter): serves the
 * browser UI, issues development sessions, and — in Kafka mode — owns the
 * authoritative order store and its outbox, and publishes each outbox row to Kafka
 * after writing it, recording where the broker stored it.
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
import type { RecoveryBoundary, RecoveryIncident } from "@streamotter/contracts";
import { decideRecovery, issueToken, nextState, orderEvent, OrderStore, SEED_ORDERS, USERS, verifyToken, type OutboxEntry } from "./domain.ts";
import { internalServiceToken } from "./service-token.ts";

const KAFKA_MODE = process.argv.includes("--kafka");
const PORT = Number(process.env["PORT"] ?? "3000");
const HOST = process.env["HOST"] ?? "127.0.0.1";
const GATEWAY_ORIGIN = process.env["STREAMOTTER_GATEWAY_ORIGIN"] ?? "http://127.0.0.1:7400";
const TOPIC = process.env["ORDER_TOPIC"] ?? "orders.status";
// Set by `pnpm dev:kafka-resync`: the quarantine topic streamotter.kafka-resync.json names. Production provisions it separately.
const QUARANTINE_TOPIC = process.env["ORDER_QUARANTINE_TOPIC"];
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
const store = restored ? OrderStore.restore(JSON.parse(readFileSync(DATA_FILE, "utf8"))) : new OrderStore();
function persist(): void {
  if (!KAFKA_MODE) return;
  mkdirSync(resolve(DATA_FILE, ".."), { recursive: true });
  writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(store, null, 2));
  renameSync(`${DATA_FILE}.tmp`, DATA_FILE);
}
/**
 * Publishes an outbox row and records its partition and offset. A row whose send fails
 * keeps a null position: the recovery guard never counts it as published.
 * `rehearse: "invalid-json"` is a development rehearsal of a broken serializer: the
 * change is committed, but the bytes on the topic are truncated.
 */
let publish: (row: OutboxEntry, rehearse?: "invalid-json") => Promise<void> = async () => { throw new Error("Publishing is only available in Kafka mode."); };

if (KAFKA_MODE) {
  const { Kafka, logLevel, Partitioners } = kafkajs;
  const kafka = new Kafka({ clientId: "order-dashboard-app", brokers: (process.env["ORDER_KAFKA_BROKERS"] ?? "127.0.0.1:19092").split(","), logLevel: logLevel.WARN });
  const admin = kafka.admin();
  await admin.connect();
  const topics = await admin.listTopics();
  if (!topics.includes(TOPIC)) {
    await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 3 }], waitForLeaders: true });
    console.log(`Created topic ${TOPIC}`);
  }
  if (QUARANTINE_TOPIC !== undefined && !topics.includes(QUARANTINE_TOPIC)) {
    // Room for a full source record plus the gateway's evidence envelope.
    await admin.createTopics({ topics: [{ topic: QUARANTINE_TOPIC, numPartitions: 1, configEntries: [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }] }], waitForLeaders: true });
    console.log(`Created quarantine topic ${QUARANTINE_TOPIC}`);
  }
  await admin.disconnect();
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  // Key by order ID so one order's changes stay on one partition, in revision order.
  publish = async (row, rehearse) => {
    const order = store.get(row.tenantId, row.orderId);
    if (order === undefined || order.revision !== row.revision) throw new Error(`Outbox row ${row.seq} no longer matches the store.`);
    const value = JSON.stringify(orderEvent(order));
    const [stored] = await producer.send({ topic: TOPIC, acks: -1, messages: [{ key: row.orderId, value: rehearse === "invalid-json" ? value.slice(0, 24) : value }] });
    if (stored?.baseOffset !== undefined) {
      store.markPublished(row.seq, { kind: "kafka", topic: stored.topicName, partition: stored.partition, offset: stored.baseOffset });
      persist();
    }
  };
  if (!restored) {
    // First run: publish the seeded state as outbox rows so the topic and the store start consistent.
    const rows = [...store.orders.values()].map(order => store.republish(order.tenantId, order.state.orderId) as OutboxEntry);
    persist();
    for (const row of rows) await publish(row);
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

function serviceAuthorized(request: IncomingMessage): boolean {
  const provided = Buffer.from(String(request.headers["x-service-token"] ?? ""));
  const expected = Buffer.from(internalServiceToken());
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** The recovery guard's input as the gateway handlers forward it; positions are checked, the rest is passed through. */
function recoveryRequest(body: unknown): { incident: RecoveryIncident; prior: RecoveryBoundary | null } | null {
  const { incident, prior } = (body ?? {}) as { incident?: RecoveryIncident; prior?: RecoveryBoundary | null };
  const position = incident?.position as Record<string, unknown> | undefined;
  const positionOk = position?.["kind"] === "kafka"
    ? typeof position["topic"] === "string" && typeof position["partition"] === "number" && typeof position["offset"] === "string" && /^\d+$/.test(position["offset"])
    : position?.["kind"] === "fixture" && typeof position["index"] === "string";
  if (!positionOk || (prior !== null && (typeof prior !== "object" || typeof prior.id !== "string"))) return null;
  return { incident: incident as RecoveryIncident, prior: prior ?? null };
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
      const mine = [...store.orders.values()].filter(order => order.tenantId === principal.tenantId && order.owner === principal.subject);
      const restricted = SEED_ORDERS.find(seed => seed.tenantId === principal.tenantId && seed.owner !== principal.subject)?.orderId ?? "ord_1003";
      return json(response, 200, {
        orders: mine.map(order => ({ orderId: order.state.orderId, status: order.state.status })),
        restrictedOrderId: restricted,
        mode: KAFKA_MODE ? "kafka" : "fixture"
      });
    }
    const change = /^\/api\/orders\/([A-Za-z0-9_-]{1,64})\/(advance|republish)$/.exec(url.pathname);
    if (request.method === "POST" && change !== null) {
      const principal = sessionPrincipal(request);
      if (principal === null) return json(response, 401, { error: "Sign in first." });
      if (!KAFKA_MODE) return json(response, 409, { error: "Fixture mode: advance the orders fixture from the StreamOtter workbench." });
      const body = await readBody(request) as { rehearse?: unknown };
      if (body.rehearse !== undefined && (body.rehearse !== "invalid-json" || change[2] !== "advance")) return json(response, 400, { error: "rehearse may only be \"invalid-json\", on advance." });
      const order = store.get(principal.tenantId, change[1]!);
      if (order === undefined || order.owner !== principal.subject) return json(response, 404, { error: "Order not found." });
      let row: OutboxEntry;
      if (change[2] === "advance") {
        const next = nextState(order);
        if (next === null) return json(response, 409, { error: "The order is already delivered." });
        // Write the authoritative store and its outbox row first, then publish the full new state.
        row = store.commit(next);
      } else {
        // Publish the current state again, for example after a published record was lost or unreadable.
        row = store.republish(order.tenantId, order.state.orderId) as OutboxEntry;
      }
      persist();
      await publish(row, body.rehearse === "invalid-json" ? "invalid-json" : undefined);
      const published = store.get(row.tenantId, row.orderId)!;
      return json(response, 200, { revision: published.revision, status: published.state.status, outboxSeq: row.seq });
    }
    const internal = /^\/internal\/orders\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (request.method === "GET" && internal !== null) {
      if (!serviceAuthorized(request)) return json(response, 401, { error: "Service token required." });
      // The snapshot query: the order and the outbox watermark in one read.
      const read = store.read(internal[1]!, internal[2]!);
      if (read === undefined) return json(response, 404, { error: "Order not found." });
      return json(response, 200, { owner: read.order.owner, revision: read.order.revision, state: read.order.state, watermark: read.watermark });
    }
    if (request.method === "POST" && url.pathname === "/internal/recovery") {
      if (!serviceAuthorized(request)) return json(response, 401, { error: "Service token required." });
      if (!KAFKA_MODE) return json(response, 409, { error: "The recovery guard reads the Kafka-mode outbox." });
      const input = recoveryRequest(await readBody(request));
      if (input === null) return json(response, 400, { error: "Expected { incident, prior }." });
      // Kafka mode does not read records back from the topic, so the guard gets no key.
      return json(response, 200, decideRecovery({ outbox: store.outbox(), orders: store.orders.values(), ...input }));
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
