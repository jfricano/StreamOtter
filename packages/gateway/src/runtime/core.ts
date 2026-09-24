import type {
  ChannelContract, ChannelHandlers, DataFrame, ErrorCode, ErrorFrame, GatewayLogger, Limits, Principal, Schema,
  Source, SourceStatus, SubscriptionFrame
} from "@streamotter/contracts";
import type { ByteBudget } from "./budget.ts";
import type { RevocationLog } from "./identity.ts";
import type { TraceBuffer } from "./traces.ts";
import type { Semaphore } from "./util.ts";
import type { SourceAdapter } from "../sources/types.ts";

/** Shared services every runtime component needs. */
export interface GatewayCore {
  readonly projectId: string;
  readonly mode: "development" | "production";
  readonly limits: Limits;
  readonly traces: TraceBuffer;
  readonly router: Router;
  readonly snapshots: Semaphore;
  readonly revocations: RevocationLog;
  readonly logger: GatewayLogger;
  readonly gatewayBudget: ByteBudget;
}

export interface RoutedSubscription {
  readonly routingKey: string;
}

/** Routing index from routing identity to the subscriptions capturing it. */
export class Router<S extends RoutedSubscription = RoutedSubscription> {
  readonly #byKey = new Map<string, Set<S>>();

  add(subscription: S): void {
    let set = this.#byKey.get(subscription.routingKey);
    if (set === undefined) {
      set = new Set();
      this.#byKey.set(subscription.routingKey, set);
    }
    set.add(subscription);
  }

  remove(subscription: S): void {
    const set = this.#byKey.get(subscription.routingKey);
    if (set === undefined) return;
    set.delete(subscription);
    if (set.size === 0) this.#byKey.delete(subscription.routingKey);
  }

  get(routingKey: string): ReadonlySet<S> | undefined {
    return this.#byKey.get(routingKey);
  }

  get size(): number {
    let total = 0;
    for (const set of this.#byKey.values()) total += set.size;
    return total;
  }
}

/** Routing identity: (project, channel, version, verified tenant, canonical parameters). */
export function routingKey(channel: string, version: number, tenantId: string, canonicalParams: string): string {
  return JSON.stringify([channel, version, tenantId, canonicalParams]);
}

export interface ChannelRuntime {
  readonly name: string;
  readonly version: number;
  readonly handlers: ChannelHandlers<ChannelContract>;
  readonly paramsSchema: Schema;
  readonly payloadSchema: Schema;
  readonly source: SourceRuntime;
  readonly subscriptions: Set<SubscriptionLike>;
}

export interface SubscriptionLike {
  onSourceUnavailable(reason: ErrorCode): void;
  onSourceReady(): void;
}

export interface SourceRuntime {
  readonly id: string;
  readonly config: Source;
  readonly channels: ChannelRuntime[];
  adapter: SourceAdapter | null;
  status: SourceStatus["status"];
  reason: ErrorCode | undefined;
  readonly ready: boolean;
}

/** What a subscription needs from the connection that owns it. */
export interface SubscriptionHost {
  readonly connectionId: string;
  readonly principal: Principal;
  readonly connectionBudget: ByteBudget;
  sendState(frame: SubscriptionFrame): void;
  sendData(frame: DataFrame): void;
  sendError(frame: ErrorFrame): void;
  /** False once the connection closed or its authentication expired. */
  canDeliver(): boolean;
  receiptTimedOut(): void;
  removeSubscription(subscriptionId: string): void;
}
