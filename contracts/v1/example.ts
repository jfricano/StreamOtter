/** Compiles against the V1 contract, which now re-exports the real gateway and SDK. */
import {
  createClient, createGateway, defineProject,
  type ChannelContract, type HandlerRegistry, type Json, type Principal,
  type Revision, type StreamError, type SubscriptionState
} from "./api";

export type OrderParams = { orderId: string };
export type OrderState = {
  orderId: string;
  status: "queued" | "processing" | "done";
  progress: number;
};
/** In a shipped project this type is generated from the channel schemas. */
export type AppChannels = {
  orderStatus: ChannelContract<OrderParams, OrderState, 1>;
};

export const project = defineProject<AppChannels>({
  configVersion: 1,
  projectId: "order-dashboard",
  gateway: {
    host: "127.0.0.1",
    port: 7400,
    path: "/streamotter/socket.io",
    allowedOrigins: ["http://localhost:3000"]
  },
  connections: {
    ordersCluster: {
      brokers: ["kafka.example.internal:9093"],
      tls: {},
      sasl: {
        mechanism: "scram-sha-256",
        username: { env: "ORDERS_KAFKA_USERNAME" },
        password: { env: "ORDERS_KAFKA_PASSWORD" }
      }
    }
  },
  sources: {
    orders: {
      kind: "kafka", generation: "orders-stream-1", connectionRef: "ordersCluster",
      topics: ["orders.status"], consumerGroup: "streamotter-order-dashboard",
      codec: "json", startFrom: "latest"
    }
  },
  schemas: {
    OrderParams: {
      type: "object", additionalProperties: false, required: ["orderId"],
      properties: { orderId: { type: "string", minLength: 1, maxLength: 128 } }
    },
    OrderState: {
      type: "object", additionalProperties: false,
      required: ["orderId", "status", "progress"],
      properties: {
        orderId: { type: "string", minLength: 1, maxLength: 128 },
        status: { type: "string", enum: ["queued", "processing", "done"] },
        progress: { type: "integer", minimum: 0, maximum: 100 }
      }
    }
  },
  channels: {
    orderStatus: {
      version: 1, source: "orders", paramsSchema: "OrderParams",
      payloadSchema: "OrderState", handlersRef: "orderStatus",
      delivery: { kind: "state", overflow: "resync" }
    }
  }
});

/** Application-owned identity, authorization, decoding, and authoritative storage. */
export interface ApplicationServices {
  verifyToken(token: string, signal: AbortSignal): Promise<Principal | null>;
  canReadOrder(principal: Principal, orderId: string, signal: AbortSignal): Promise<boolean>;
  decodeOrderRecord(value: Json): {
    tenantId: string;
    revision: Revision;
    order: OrderState;
  } | null;
  loadOrder(tenantId: string, orderId: string, signal: AbortSignal): Promise<{
    revision: Revision;
    data: OrderState;
  }>;
}

export function buildGateway(services: ApplicationServices) {
  const handlers: HandlerRegistry<AppChannels> = {
    authenticate: ({ token, signal }) => services.verifyToken(token, signal),
    channels: {
      orderStatus: {
        authorize: ({ principal, params, signal }) =>
          services.canReadOrder(principal, params.orderId, signal),
        map: ({ record }) => {
          const decoded = services.decodeOrderRecord(record.value);
          if (decoded === null) return [];
          return [{
            tenantId: decoded.tenantId,
            params: { orderId: decoded.order.orderId },
            revision: decoded.revision,
            data: decoded.order
          }];
        },
        snapshot: ({ principal, params, signal }) =>
          services.loadOrder(principal.tenantId, params.orderId, signal)
      }
    }
  };
  return createGateway({ config: project, handlers, mode: "development" });
}

export async function mountOrderView(options: {
  orderId: string;
  getToken: (signal: AbortSignal) => Promise<string>;
  render: (state: OrderState) => void;
  showState: (state: SubscriptionState) => void;
  showError: (error: StreamError) => void;
}) {
  const client = createClient<AppChannels>({
    origin: "http://localhost:7400",
    getToken: ({ signal }) => options.getToken(signal)
  });
  const subscription = client.subscribe("orderStatus", {
    channelVersion: 1,
    params: { orderId: options.orderId }
  });
  subscription.on("data", ({ data }) => options.render(data));
  subscription.on("state", ({ state }) => options.showState(state));
  subscription.on("error", options.showError);
  try {
    await subscription.ready({ timeoutMs: 30_000 });
  } catch (error) {
    await subscription.unsubscribe();
    await client.close();
    throw error;
  }
  return async () => {
    await subscription.unsubscribe();
    await client.close();
  };
}
