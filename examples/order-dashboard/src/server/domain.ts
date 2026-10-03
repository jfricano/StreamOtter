/**
 * Application-owned domain for the order dashboard: demo identities, ownership
 * rules, signed session tokens, the order state machine, and the order store with
 * its outbox. StreamOtter never sees these rules; it calls the handlers built on
 * top of them.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Json, Principal, RecoveryBoundary, RecoveryDecision, RecoveryIncident, SourceRecord } from "@streamotter/contracts";

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

/** The application's own check of an order state; it mirrors the OrderState schema in streamotter.json. */
export function isOrderState(value: unknown): value is OrderState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const keys = Object.keys(state);
  return keys.length === 5 && ["orderId", "status", "progress", "updatedAt", "note"].every(key => keys.includes(key))
    && typeof state["orderId"] === "string" && state["orderId"].length >= 1 && state["orderId"].length <= 64
    && STATUS_STEPS.some(step => step.status === state["status"])
    && typeof state["progress"] === "number" && Number.isInteger(state["progress"]) && state["progress"] >= 0 && state["progress"] <= 100
    && typeof state["updatedAt"] === "string" && state["updatedAt"].length <= 40
    && typeof state["note"] === "string" && state["note"].length <= 200;
}

// --- order store and outbox ------------------------------------------------------

export type SourcePosition = SourceRecord["position"];

/**
 * One row of the application's outbox: an order state the application committed and
 * publishes, either a change or a re-publish of the current state. Sequences increase
 * by one per row and are never reused.
 */
export interface OutboxEntry {
  seq: number;
  tenantId: string;
  orderId: string;
  revision: string;
  /** Where the broker (or the fixture timeline) stored the published record; null until that is known. */
  position: SourcePosition | null;
}

export interface OrderStoreData { orders: Record<string, StoredOrder>; outbox: OutboxEntry[]; watermark: number }

/**
 * The application's order store. Writing a change sets the order, appends its outbox
 * row and raises the watermark in one synchronous step, which stands in for one
 * database transaction; a snapshot reads an order together with the watermark the
 * same way. The watermark is the sequence of the newest outbox row the store holds,
 * so a read at watermark W reflects every row up to W.
 */
export class OrderStore {
  readonly #orders: Map<string, StoredOrder>;
  readonly #outbox: OutboxEntry[];
  #watermark: number;

  constructor(data?: OrderStoreData) {
    this.#orders = data === undefined ? initialOrders() : new Map(Object.entries(data.orders));
    this.#outbox = data === undefined ? [] : data.outbox.map(entry => ({ ...entry }));
    this.#watermark = data?.watermark ?? 0;
  }

  /** Restores persisted data. A file written before the outbox existed holds only the orders. */
  static restore(data: unknown): OrderStore {
    const candidate = data as Partial<OrderStoreData> | null;
    if (typeof candidate === "object" && candidate !== null && Array.isArray(candidate.outbox) && typeof candidate.watermark === "number"
      && typeof candidate.orders === "object" && candidate.orders !== null) {
      return new OrderStore(candidate as OrderStoreData);
    }
    return new OrderStore({ orders: data as Record<string, StoredOrder>, outbox: [], watermark: 0 });
  }

  get orders(): ReadonlyMap<string, StoredOrder> {
    return this.#orders;
  }

  get watermark(): number {
    return this.#watermark;
  }

  get(tenantId: string, orderId: string): StoredOrder | undefined {
    return this.#orders.get(orderKey(tenantId, orderId));
  }

  /** The snapshot query: one order and the watermark, read together. */
  read(tenantId: string, orderId: string): { order: StoredOrder; watermark: number } | undefined {
    const order = this.get(tenantId, orderId);
    return order === undefined ? undefined : { order, watermark: this.#watermark };
  }

  /** Writes an order's new state and appends its outbox row, in one step. */
  commit(order: StoredOrder): OutboxEntry {
    const current = this.get(order.tenantId, order.state.orderId);
    if (current !== undefined && BigInt(order.revision) <= BigInt(current.revision)) {
      throw new Error(`Revision ${order.revision} does not advance ${order.tenantId}/${order.state.orderId} (at ${current.revision}).`);
    }
    this.#orders.set(orderKey(order.tenantId, order.state.orderId), order);
    return this.#append(order);
  }

  /** Appends an outbox row that publishes an order's current state again, unchanged. */
  republish(tenantId: string, orderId: string): OutboxEntry | null {
    const order = this.get(tenantId, orderId);
    return order === undefined ? null : this.#append(order);
  }

  /** Records where a published row landed, once the broker (or the timeline) has it. */
  markPublished(seq: number, position: SourcePosition): void {
    const entry = this.#outbox.find(row => row.seq === seq);
    if (entry !== undefined) entry.position = position;
  }

  outbox(): readonly OutboxEntry[] {
    return this.#outbox.map(entry => ({ ...entry }));
  }

  toJSON(): OrderStoreData {
    return { orders: Object.fromEntries(this.#orders), outbox: this.outbox() as OutboxEntry[], watermark: this.#watermark };
  }

  #append(order: StoredOrder): OutboxEntry {
    const entry: OutboxEntry = { seq: (this.#outbox.at(-1)?.seq ?? 0) + 1, tenantId: order.tenantId, orderId: order.state.orderId, revision: order.revision, position: null };
    this.#outbox.push(entry);
    this.#watermark = entry.seq;
    return { ...entry };
  }
}

/** The event that publishes an order's stored state. */
export function orderEvent(order: StoredOrder): OrderEvent {
  return { tenantId: order.tenantId, revision: order.revision, order: order.state };
}

// --- recovery guard (V1.1 quarantine-resync) ---------------------------------------

/** Order IDs as the application issues them; the same rule as its routes. */
export const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The outbox watermark a recovery boundary requires, or null when the context is not one this application wrote. */
export function boundaryWatermark(context: Json): number | null {
  if (typeof context !== "object" || context === null || Array.isArray(context)) return null;
  const watermark = context["watermark"];
  return typeof watermark === "number" && Number.isSafeInteger(watermark) && watermark >= 0 ? watermark : null;
}

/**
 * The acknowledgment half of a snapshot result. A snapshot acknowledges a recovery
 * boundary only when the read it served covers the boundary's watermark. Otherwise it
 * returns no acknowledgment, the gateway keeps the subscription stale and retries,
 * and nobody reaches live on a state older than the order's re-publish.
 */
export function acknowledgeRecovery(recovery: { boundaryId: string; context: Json } | undefined, watermark: number): { recoveryBoundaryId?: string } {
  if (recovery === undefined) return {};
  const required = boundaryWatermark(recovery.context);
  return required !== null && watermark >= required ? { recoveryBoundaryId: recovery.boundaryId } : {};
}

export function describePosition(position: SourcePosition): string {
  return position.kind === "kafka" ? `${position.topic}[${position.partition}]@${position.offset}` : `fixture index ${position.index}`;
}

function samePosition(a: SourcePosition, b: SourcePosition): boolean {
  if (a.kind === "kafka" && b.kind === "kafka") return a.topic === b.topic && a.partition === b.partition && a.offset === b.offset;
  return a.kind === "fixture" && b.kind === "fixture" && a.index === b.index;
}

/** True when `later` follows `earlier` in one ordered stream: the same Kafka partition, or the fixture timeline. */
function isAfter(later: SourcePosition, earlier: SourcePosition): boolean {
  if (later.kind === "kafka" && earlier.kind === "kafka") {
    return later.topic === earlier.topic && later.partition === earlier.partition && BigInt(later.offset) > BigInt(earlier.offset);
  }
  return later.kind === "fixture" && earlier.kind === "fixture" && Number(later.index) > Number(earlier.index);
}

export interface RecoveryEvidence {
  /** The application's outbox, read in one go. */
  outbox: readonly OutboxEntry[];
  /** The orders that exist, to resolve an order ID to its tenants. */
  orders: Iterable<StoredOrder>;
  incident: RecoveryIncident;
  prior: RecoveryBoundary | null;
  /**
   * The key of the record at the incident's position, when this deployment can read
   * the record back (fixture mode can; Kafka mode does not). Undefined when unknown.
   */
  sourceKey?: string | null | undefined;
}

const hold = (reason: string): RecoveryDecision => ({ decision: "hold", reason: reason.slice(0, 512) });

/**
 * The orders source's recovery guard (ADR-15B §5). The gateway asks whether
 * snapshots will supersede a record it quarantined and wants to skip. That is true
 * only if the change the record carried reaches what snapshots read, and the only
 * trustworthy account of that is the application's own outbox, never the failed
 * record's payload. So the guard
 *
 * 1. identifies the order: from the outbox row published at the failed record's
 *    position, or, for a record the application did not publish, from its key (an
 *    order ID names one order per tenant, so every tenant's order with that ID);
 * 2. answers recoverable only when every such order was re-published after the
 *    failed record (a published outbox row later in the same stream) or, for a
 *    record the application did not publish, never changed state (no outbox row);
 * 3. returns the newest re-publish's sequence as the watermark, carried forward from
 *    the prior boundary, so snapshots acknowledge only from a read that holds it.
 *
 * Anything it cannot establish holds the record for an operator. A guard that
 * always answers recoverable would let subscribers reach live on a state that is
 * missing the skipped change, and nothing downstream would notice.
 */
export function decideRecovery(evidence: RecoveryEvidence): RecoveryDecision {
  const { incident, prior, outbox, sourceKey } = evidence;
  const where = describePosition(incident.position);
  const carried = prior === null ? 0 : boundaryWatermark(prior.context);
  if (carried === null) return hold(`The boundary in force (${prior?.id ?? "none"}) has no outbox watermark this application wrote, so it cannot be carried forward.`);

  const failed = outbox.find(entry => entry.position !== null && samePosition(entry.position, incident.position));
  let affected: { tenantId: string; orderId: string }[];
  if (failed !== undefined) {
    if (sourceKey !== undefined && sourceKey !== failed.orderId) {
      return hold(`The record at ${where} is keyed ${JSON.stringify(sourceKey)}, but outbox row ${failed.seq} published order ${failed.orderId} there.`);
    }
    affected = [{ tenantId: failed.tenantId, orderId: failed.orderId }];
  } else if (sourceKey === undefined) {
    return hold(`No outbox row was published at ${where}, and this deployment cannot read the record's key, so the affected order is unknown.`);
  } else if (sourceKey === null || !ORDER_ID.test(sourceKey)) {
    return hold(`The record at ${where} ${sourceKey === null ? "has no key" : "has a key that is not an order ID"}, and no outbox row was published there, so the affected order is unknown.`);
  } else {
    affected = [...evidence.orders].filter(order => order.state.orderId === sourceKey).map(order => ({ tenantId: order.tenantId, orderId: sourceKey }));
    if (affected.length === 0) return hold(`The record at ${where} names order ${sourceKey}, which does not exist, so the outbox cannot vouch for it.`);
  }

  let watermark = carried;
  const evidenceRefs: string[] = [];
  for (const order of affected) {
    const rows = outbox.filter(entry => entry.tenantId === order.tenantId && entry.orderId === order.orderId);
    const name = `${order.tenantId}/${order.orderId}`;
    if (failed === undefined && rows.length === 0) {
      evidenceRefs.push(`${name} never changed`);
      continue;
    }
    const republished = rows.find(entry => entry.position !== null && isAfter(entry.position, incident.position));
    if (republished === undefined) {
      return hold(`Order ${name} has not been re-published after the record at ${where}${failed === undefined ? "" : ` (outbox row ${failed.seq})`}. Re-publish it, then reassess.`);
    }
    watermark = Math.max(watermark, republished.seq);
    evidenceRefs.push(`${name} re-published as outbox row ${republished.seq}`);
  }
  const failedRef = failed === undefined ? "" : `row ${failed.seq} failed at ${where}; `;
  return { decision: "recoverable", context: { watermark }, evidenceRef: `outbox: ${failedRef}${evidenceRefs.join("; ")}`.slice(0, 512) };
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
