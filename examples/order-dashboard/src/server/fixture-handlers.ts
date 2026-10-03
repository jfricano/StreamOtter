/**
 * Handler module for fixture mode:
 *   streamotter dev --config streamotter.json --handlers dist/server/fixture-handlers.js
 *
 * Fixture mode stands in for the application's database and topic. The application
 * side is an OrderStore: each change is committed with its outbox row, and the row is
 * published by appending it to the fixture timeline, which the gateway reads one
 * record at a time. Snapshots read a development read model fed by the same records as
 * the gateway reads them, so snapshots and updates describe one revision progression.
 * Kafka mode (kafka-handlers.ts) instead reads the application's authoritative store,
 * which the application writes before publishing.
 *
 * The orders source uses quarantine-resync (streamotter.json), so this module also
 * exports the source's recovery guard: decideRecovery in domain.ts, answered from the
 * application's outbox.
 */
import type { DevelopmentOptions, FixtureRecord, HandlerRegistry, Json, Principal } from "@streamotter/contracts";
import type { AppChannels } from "../generated/streamotter.generated.ts";
import {
  acknowledgeRecovery, canRead, decideRecovery, decodeOrderEvent, initialOrders, isOrderState, nextState, orderEvent, orderKey, OrderStore,
  SEED_ORDERS, USERS, verifyToken, type OrderEvent, type OutboxEntry, type StoredOrder
} from "./domain.ts";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/**
 * The development read model snapshots are served from. Its watermark is the outbox
 * sequence of the newest published row it has applied; the order and the watermark
 * change together, and a snapshot reads them together.
 */
class ReadModel {
  readonly orders = initialOrders();
  watermark = 0;

  /** Applies a record the gateway read. `row` is the outbox row the application published at that position, if any. */
  apply(event: OrderEvent, row: OutboxEntry | undefined): void {
    // Never take a state the public schema would reject, or a revision the gateway would refuse.
    if (!isOrderState(event.order) || !/^(0|[1-9]\d*)$/.test(event.revision)) return;
    const key = orderKey(event.tenantId, event.order.orderId);
    const current = this.orders.get(key);
    if (current !== undefined && BigInt(event.revision) > BigInt(current.revision)) {
      this.orders.set(key, { ...current, revision: event.revision, state: event.order });
    }
    if (row !== undefined && row.tenantId === event.tenantId && row.orderId === event.order.orderId && row.revision === event.revision) {
      this.watermark = Math.max(this.watermark, row.seq);
    }
  }

  read(tenantId: string, orderId: string): { order: StoredOrder; watermark: number } | undefined {
    const order = this.orders.get(orderKey(tenantId, orderId));
    return order === undefined ? undefined : { order, watermark: this.watermark };
  }
}

export interface FixtureApplication {
  /** The application's order store and outbox. */
  readonly store: OrderStore;
  /** The fixture timeline the gateway reads: one record per published outbox row. */
  readonly timeline: FixtureRecord[];
  /** What snapshots read. */
  readonly readModel: { readonly orders: ReadonlyMap<string, StoredOrder>; readonly watermark: number };
  /** Commits an order's next state and publishes it. Null when the order is unknown or already delivered. */
  advance(tenantId: string, orderId: string, at?: string): OutboxEntry | null;
  /** Publishes an order's current state again, as a new outbox row. Null when the order is unknown. */
  republish(tenantId: string, orderId: string): OutboxEntry | null;
  readonly handlers: HandlerRegistry<AppChannels>;
  readonly development: DevelopmentOptions;
}

function devPrincipal(subject: string, tenantId: string): Principal {
  return { subject, tenantId, sessionId: `dev-${subject}`, expiresAt: "2099-01-01T00:00:00.000Z", claims: { role: "customer" } };
}

/**
 * Builds the fixture-mode application. Publish everything the timeline should hold
 * before the gateway starts: the timeline is the recorded topic the gateway replays.
 * With `timeline: "demo"`, every seeded order advances to delivered, interleaved.
 */
export function createFixtureApplication(options: { timeline?: "demo" | "empty" } = {}): FixtureApplication {
  const store = new OrderStore();
  const timeline: FixtureRecord[] = [];
  const published = new Map<string, OutboxEntry>();
  const readModel = new ReadModel();

  const publish = (row: OutboxEntry | null): OutboxEntry | null => {
    if (row === null) return null;
    const order = store.get(row.tenantId, row.orderId) as StoredOrder;
    const position = { kind: "fixture" as const, index: String(timeline.length) };
    timeline.push({ key: row.orderId, value: orderEvent(order) as unknown as Json });
    store.markPublished(row.seq, position);
    const entry = { ...row, position };
    published.set(position.index, entry);
    return entry;
  };

  const handlers: HandlerRegistry<AppChannels> = {
    authenticate: ({ token }) => verifyToken(token),
    channels: {
      orderStatus: {
        authorize: ({ principal, params }) => canRead(readModel.orders, principal, params.orderId),
        map: ({ record }) => {
          const event = decodeOrderEvent(record.value);
          if (event === null) return [];
          readModel.apply(event, record.position.kind === "fixture" ? published.get(record.position.index) : undefined);
          return [{ tenantId: event.tenantId, params: { orderId: event.order.orderId }, revision: event.revision, data: event.order }];
        },
        snapshot: async ({ principal, params, recovery, signal }) => {
          // Read first, then (optionally) wait: this models a snapshot taken just before a
          // concurrent change is published. Set ORDER_SNAPSHOT_DELAY_MS to watch StreamOtter
          // buffer the newer update and release it after the snapshot.
          const read = readModel.read(principal.tenantId, params.orderId);
          if (read === undefined) throw new Error("Order not found");
          const delay = Number(process.env["ORDER_SNAPSHOT_DELAY_MS"] ?? "0");
          if (delay > 0) await sleep(delay, signal);
          return { revision: read.order.revision, data: { ...read.order.state }, ...acknowledgeRecovery(recovery, read.watermark) };
        }
      }
    },
    sources: {
      orders: {
        // The fixture timeline can be read back, so the guard also gets the failed record's key.
        recover: ({ incident, prior }) => decideRecovery({
          outbox: store.outbox(),
          orders: store.orders.values(),
          incident,
          prior,
          sourceKey: incident.position.kind === "fixture" ? timeline[Number(incident.position.index)]?.key : undefined
        })
      }
    }
  };

  const application: FixtureApplication = {
    store,
    timeline,
    readModel,
    advance(tenantId, orderId, at) {
      const order = store.get(tenantId, orderId);
      const next = order === undefined ? null : nextState(order, at);
      return next === null ? null : publish(store.commit(next));
    },
    republish: (tenantId, orderId) => publish(store.republish(tenantId, orderId)),
    handlers,
    development: {
      principals: {
        ...Object.fromEntries(Object.entries(USERS).map(([ref, user]) => [ref, devPrincipal(user.subject, user.tenantId)])),
        mallory: devPrincipal("mallory", "acme")
      },
      fixtures: { orders: timeline }
    }
  };

  if (options.timeline === "demo") {
    let minute = 1;
    for (let round = 0; round < 4; round++) {
      for (const seed of SEED_ORDERS) application.advance(seed.tenantId, seed.orderId, `2026-09-24T09:${String(minute++).padStart(2, "0")}:00.000Z`);
    }
  }
  return application;
}

const fixture = createFixtureApplication({ timeline: "demo" });

export const handlers: HandlerRegistry<AppChannels> = fixture.handlers;

/** Development-only principals and fixtures; `streamotter start` never uses them. */
export const development: DevelopmentOptions = fixture.development;
