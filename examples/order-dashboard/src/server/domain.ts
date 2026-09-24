/**
 * Application-owned domain for the order dashboard: demo identities, ownership
 * rules, signed session tokens, and the order state machine. StreamOtter never
 * sees these rules; it calls the handlers built on top of them.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Principal } from "@streamotter/contracts";

export type OrderStatus = "placed" | "picking" | "packed" | "shipped" | "delivered";
export interface OrderState {
  orderId: string;
  status: OrderStatus;
  progress: number;
  updatedAt: string;
  note: string;
}
export interface StoredOrder { tenantId: string; owner: string; revision: string; state: OrderState }
/** The record shape the application publishes (to Kafka, or as a development fixture). */
export interface OrderEvent { tenantId: string; revision: string; order: OrderState }

export const STATUS_STEPS: readonly { status: OrderStatus; progress: number; note: string }[] = [
  { status: "placed", progress: 5, note: "Order received." },
  { status: "picking", progress: 30, note: "Items are being picked." },
  { status: "packed", progress: 55, note: "Packed and labeled." },
  { status: "shipped", progress: 80, note: "Handed to the carrier." },
  { status: "delivered", progress: 100, note: "Delivered to the front door." }
];

/** Demo users. Development only: production must verify real application sessions. */
export const USERS: Readonly<Record<string, { subject: string; tenantId: string; name: string }>> = {
  alice: { subject: "alice", tenantId: "acme", name: "Alice (Acme)" },
  carol: { subject: "carol", tenantId: "acme", name: "Carol (Acme)" },
  bob: { subject: "bob", tenantId: "globex", name: "Bob (Globex)" }
};

/** Seed orders: id → owner. Order IDs are only meaningful inside a tenant. */
export const SEED_ORDERS: readonly { tenantId: string; owner: string; orderId: string }[] = [
  { tenantId: "acme", owner: "alice", orderId: "ord_1001" },
  { tenantId: "acme", owner: "alice", orderId: "ord_1002" },
  { tenantId: "acme", owner: "carol", orderId: "ord_1003" },
  { tenantId: "globex", owner: "bob", orderId: "ord_1001" }
];

export function initialOrders(now = "2026-09-24T09:00:00.000Z"): Map<string, StoredOrder> {
  const orders = new Map<string, StoredOrder>();
  for (const seed of SEED_ORDERS) {
    const step = STATUS_STEPS[0]!;
    orders.set(orderKey(seed.tenantId, seed.orderId), {
      tenantId: seed.tenantId,
      owner: seed.owner,
      revision: "1",
      state: { orderId: seed.orderId, status: step.status, progress: step.progress, updatedAt: now, note: step.note }
    });
  }
  return orders;
}

export function orderKey(tenantId: string, orderId: string): string {
  return `${tenantId}/${orderId}`;
}

/** Returns the next state of an order, or null when it is already delivered. */
export function nextState(order: StoredOrder, now = new Date().toISOString()): StoredOrder | null {
  const index = STATUS_STEPS.findIndex(step => step.status === order.state.status);
  const step = STATUS_STEPS[index + 1];
  if (step === undefined) return null;
  return {
    ...order,
    revision: (BigInt(order.revision) + 1n).toString(),
    state: { ...order.state, status: step.status, progress: step.progress, note: step.note, updatedAt: now }
  };
}

/** Access rule: a user may read an order in their own tenant that they own. */
export function canRead(orders: ReadonlyMap<string, StoredOrder>, principal: Principal, orderId: string): boolean {
  const order = orders.get(orderKey(principal.tenantId, orderId));
  return order !== undefined && order.owner === principal.subject;
}

/** Decodes a published order event; returns null for records this channel ignores. */
export function decodeOrderEvent(value: unknown): OrderEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<OrderEvent>;
  if (typeof candidate.tenantId !== "string" || typeof candidate.revision !== "string" || typeof candidate.order !== "object" || candidate.order === null) return null;
  return candidate as OrderEvent;
}

// --- signed session tokens -------------------------------------------------------

const DEVELOPMENT_SECRET = "order-dashboard-development-secret-do-not-use-in-production";

function secret(): string {
  const configured = process.env["ORDER_DASHBOARD_SECRET"];
  if (configured !== undefined && configured.length >= 32) return configured;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("ORDER_DASHBOARD_SECRET (at least 32 characters) is required in production.");
  }
  return DEVELOPMENT_SECRET;
}

export function issueToken(user: keyof typeof USERS | string, ttlSeconds = 3_600): { token: string; expiresAt: string } | null {
  const account = USERS[user];
  if (account === undefined) return null;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1_000).toISOString();
  const payload = Buffer.from(JSON.stringify({ sub: account.subject, tenant: account.tenantId, sid: randomUUID(), exp: expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}

/** Verifies an application session token and returns its principal, or null. */
export function verifyToken(token: string): Principal | null {
  const [payload, signature, extra] = token.split(".");
  if (payload === undefined || signature === undefined || extra !== undefined) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let claims: { sub?: unknown; tenant?: unknown; sid?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof claims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || typeof claims.tenant !== "string" || typeof claims.sid !== "string" || typeof claims.exp !== "string") return null;
  if (!(Date.parse(claims.exp) > Date.now())) return null;
  return { subject: claims.sub, tenantId: claims.tenant, sessionId: claims.sid, expiresAt: claims.exp, claims: { role: "customer" } };
}
