import { createClient, type Client } from "@streamotter/client";
import {
  createGateway, silentLogger,
  type ChannelContract, type DevelopmentOptions, type Gateway, type GatewayLogger, type HandlerRegistry, type Json,
  type Limits, type Principal, type ProjectConfig, type StateChange, type StreamError, type StreamEvent,
  type Subscription, type SubscriptionState
} from "@streamotter/gateway";
import { getGatewayInternals, type GatewayInternals } from "@streamotter/gateway/internals";

export type OrderParams = { orderId: string };
export type OrderState = { orderId: string; status: "queued" | "processing" | "done"; progress: number };
export type TestChannels = { orderStatus: ChannelContract<OrderParams, OrderState, 1> };

export const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

export function orderConfig(limits: Partial<Limits> = {}): ProjectConfig<TestChannels> {
  return {
    configVersion: 1,
    projectId: "order-dashboard",
    gateway: { host: "127.0.0.1", port: 0, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:3000"] },
    connections: {},
    sources: { orders: { kind: "fixture", generation: "fixture-1", fixtureRef: "orders" } },
    schemas: {
      OrderParams: {
        type: "object", additionalProperties: false, required: ["orderId"],
        properties: { orderId: { type: "string", minLength: 1, maxLength: 128 } }
      },
      OrderState: {
        type: "object", additionalProperties: false, required: ["orderId", "status", "progress"],
        properties: {
          orderId: { type: "string", minLength: 1, maxLength: 128 },
          status: { type: "string", enum: ["queued", "processing", "done"] },
          progress: { type: "integer", minimum: 0, maximum: 100 }
        }
      }
    },
    channels: {
      orderStatus: {
        version: 1, source: "orders", paramsSchema: "OrderParams", payloadSchema: "OrderState",
        handlersRef: "orderStatus", delivery: { kind: "state", overflow: "resync" }
      }
    },
    limits
  };
}

/** A fixture record: the order's tenant, revision, and state. */
export function orderRecord(tenantId: string, orderId: string, revision: number | string, status: OrderState["status"], progress: number): { key: string; value: Json } {
  return { key: orderId, value: { tenantId, revision: String(revision), order: { orderId, status, progress } } };
}

export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitFor(predicate: () => boolean, timeoutMs = 5_000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(10);
  }
}

/**
 * Application-owned services for tests: an authoritative order store with
 * revisions, token → principal verification, and ownership rules. Handlers are
 * overridable per test to inject delays, failures, and races.
 */
export class OrderApp {
  readonly orders = new Map<string, { tenantId: string; owner: string; revision: string; state: OrderState }>();
  snapshotCalls = 0;
  authorizeCalls = 0;
  authenticateCalls = 0;
  /** Optional gate awaited inside snapshot before reading the store. */
  snapshotGate: (() => Promise<void>) | null = null;
  /** When "end", the snapshot reads the store after the gate; otherwise before. */
  snapshotReads: "start" | "end" = "start";
  authorizeGate: (() => Promise<void>) | null = null;
  authenticateGate: (() => Promise<void>) | null = null;
  authorizeOverride: ((principal: Principal, params: OrderParams) => boolean | Promise<boolean>) | null = null;
  mapOverride: ((value: Json) => unknown) | null = null;
  revokedSessions = new Set<string>();
  tokenExpiry = new Map<string, string>();

  put(tenantId: string, owner: string, orderId: string, revision: number | string, status: OrderState["status"], progress: number): void {
    this.orders.set(`${tenantId}/${orderId}`, { tenantId, owner, revision: String(revision), state: { orderId, status, progress } });
  }

  /** Token format: "<subject>@<tenant>[#session]". */
  principalFor(token: string): Principal | null {
    const match = /^([a-z]+)@([a-z]+)(?:#([a-z0-9]+))?$/.exec(token);
    if (match === null) return null;
    const [, subject, tenantId, session] = match as unknown as [string, string, string, string | undefined];
    const sessionId = session ?? `${subject}-session`;
    if (this.revokedSessions.has(sessionId)) return null;
    return { subject, tenantId, sessionId, expiresAt: this.tokenExpiry.get(token) ?? FAR_FUTURE, claims: { role: "customer" } };
  }

  handlers(): HandlerRegistry<TestChannels> {
    return {
      authenticate: async ({ token }) => {
        this.authenticateCalls++;
        const principal = this.principalFor(token);
        if (this.authenticateGate !== null) await this.authenticateGate();
        return principal;
      },
      channels: {
        orderStatus: {
          authorize: async ({ principal, params }) => {
            this.authorizeCalls++;
            if (this.authorizeGate !== null) await this.authorizeGate();
            if (this.authorizeOverride !== null) return this.authorizeOverride(principal, params);
            const order = this.orders.get(`${principal.tenantId}/${params.orderId}`);
            return order !== undefined && order.owner === principal.subject;
          },
          map: ({ record }) => {
            if (this.mapOverride !== null) return this.mapOverride(record.value) as never;
            const value = record.value as { tenantId: string; revision: string; order: OrderState };
            return [{ tenantId: value.tenantId, params: { orderId: value.order.orderId }, revision: value.revision, data: value.order }];
          },
          snapshot: async ({ principal, params }) => {
            this.snapshotCalls++;
            const read = () => {
              const order = this.orders.get(`${principal.tenantId}/${params.orderId}`);
              if (order === undefined) throw new Error("order not found");
              return { revision: order.revision, data: { ...order.state } };
            };
            if (this.snapshotReads === "start") {
              const result = read();
              if (this.snapshotGate !== null) await this.snapshotGate();
              return result;
            }
            if (this.snapshotGate !== null) await this.snapshotGate();
            return read();
          }
        }
      }
    };
  }
}

export interface Harness {
  gateway: Gateway;
  internals: GatewayInternals;
  origin: string;
  path: string;
  app: OrderApp;
  clients: Client<TestChannels>[];
  client(token?: string | (() => string | Promise<string>)): Client<TestChannels>;
  advance(count?: number): Promise<number>;
  close(): Promise<void>;
}

export async function startHarness(options: {
  app?: OrderApp;
  fixtures?: { key: string | null; value: Json }[];
  limits?: Partial<Limits>;
  principals?: DevelopmentOptions["principals"];
  logger?: GatewayLogger;
} = {}): Promise<Harness> {
  const app = options.app ?? new OrderApp();
  const gateway = createGateway<TestChannels>({
    config: orderConfig(options.limits),
    handlers: app.handlers(),
    mode: "development",
    development: { principals: options.principals ?? {}, fixtures: { orders: options.fixtures ?? [] } },
    logger: options.logger ?? silentLogger
  });
  const { origin, path } = await gateway.start();
  const internals = getGatewayInternals(gateway);
  const clients: Client<TestChannels>[] = [];
  return {
    gateway, internals, origin, path, app, clients,
    client(token = "alice@acme") {
      const client = createClient<TestChannels>({
        origin,
        getToken: typeof token === "function" ? token : () => token
      });
      clients.push(client);
      return client;
    },
    advance: (count = 1) => internals.advanceFixture("orders", count),
    async close() {
      await Promise.all(clients.map(client => client.close()));
      await gateway.stop({ timeoutMs: 2_000 });
    }
  };
}

/** Records everything a subscription emits. */
export function observe<D extends Json>(subscription: Subscription<D>): {
  states: SubscriptionState[];
  reasons: (string | undefined)[];
  events: StreamEvent<D>[];
  errors: StreamError[];
  data: () => D[];
} {
  const record = { states: [] as SubscriptionState[], reasons: [] as (string | undefined)[], events: [] as StreamEvent<D>[], errors: [] as StreamError[] };
  subscription.on("state", (change: StateChange<SubscriptionState>) => {
    record.states.push(change.state);
    record.reasons.push(change.reason);
  });
  subscription.on("data", event => { record.events.push(event); });
  subscription.on("error", error => { record.errors.push(error); });
  return { ...record, data: () => record.events.map(event => event.data) };
}
