/**
 * Handler module for fixture mode:
 *   streamotter dev --config streamotter.json --handlers dist/server/fixture-handlers.js
 *
 * Fixture mode has no separate database. The snapshot store is a development read
 * model fed by the same order events the gateway reads, so snapshots and updates
 * describe one revision progression. Kafka mode (kafka-handlers.ts) instead reads the
 * application's authoritative store, which the application writes before publishing.
 */
import type { DevelopmentOptions, HandlerRegistry, Json, Principal } from "@streamotter/contracts";
import type { AppChannels } from "../generated/streamotter.generated.ts";
import {
  canRead, decodeOrderEvent, initialOrders, nextState, orderKey, SEED_ORDERS, USERS, verifyToken, type OrderEvent, type StoredOrder
} from "./domain.ts";

const readModel = initialOrders();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

function apply(event: OrderEvent): void {
  const key = orderKey(event.tenantId, event.order.orderId);
  const current = readModel.get(key);
  if (current !== undefined && BigInt(event.revision) > BigInt(current.revision)) {
    readModel.set(key, { ...current, revision: event.revision, state: event.order });
  }
}

export const handlers: HandlerRegistry<AppChannels> = {
  authenticate: ({ token }) => verifyToken(token),
  channels: {
    orderStatus: {
      authorize: ({ principal, params }) => canRead(readModel, principal, params.orderId),
      map: ({ record }) => {
        const event = decodeOrderEvent(record.value);
        if (event === null) return [];
        apply(event);
        return [{ tenantId: event.tenantId, params: { orderId: event.order.orderId }, revision: event.revision, data: event.order }];
      },
      snapshot: async ({ principal, params, signal }) => {
        // Read first, then (optionally) wait: this models a snapshot taken just before a
        // concurrent change is published. Set ORDER_SNAPSHOT_DELAY_MS to watch StreamOtter
        // buffer the newer update and release it after the snapshot.
        const order = readModel.get(orderKey(principal.tenantId, params.orderId));
        if (order === undefined) throw new Error("Order not found");
        const delay = Number(process.env["ORDER_SNAPSHOT_DELAY_MS"] ?? "0");
        if (delay > 0) await sleep(delay, signal);
        return { revision: order.revision, data: { ...order.state } };
      }
    }
  }
};

/** A deterministic timeline: every seeded order advances to delivered, interleaved. */
function fixtureTimeline(): { key: string; value: Json }[] {
  const cursors = new Map<string, StoredOrder>(SEED_ORDERS.map(seed => {
    const key = orderKey(seed.tenantId, seed.orderId);
    return [key, initialOrders().get(key)!];
  }));
  const records: { key: string; value: Json }[] = [];
  let minute = 1;
  for (let round = 0; round < 4; round++) {
    for (const [key, order] of cursors) {
      const next = nextState(order, `2026-09-24T09:${String(minute++).padStart(2, "0")}:00.000Z`);
      if (next === null) continue;
      cursors.set(key, next);
      const event: OrderEvent = { tenantId: next.tenantId, revision: next.revision, order: next.state };
      records.push({ key: next.state.orderId, value: event as unknown as Json });
    }
  }
  return records;
}

function devPrincipal(subject: string, tenantId: string): Principal {
  return { subject, tenantId, sessionId: `dev-${subject}`, expiresAt: "2099-01-01T00:00:00.000Z", claims: { role: "customer" } };
}

/** Development-only principals and fixtures; `streamotter start` never uses them. */
export const development: DevelopmentOptions = {
  principals: {
    ...Object.fromEntries(Object.entries(USERS).map(([ref, user]) => [ref, devPrincipal(user.subject, user.tenantId)])),
    mallory: devPrincipal("mallory", "acme")
  },
  fixtures: { orders: fixtureTimeline() }
};
