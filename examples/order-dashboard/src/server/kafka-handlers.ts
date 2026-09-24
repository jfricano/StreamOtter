/**
 * Handler module for Kafka mode:
 *   streamotter dev --config streamotter.kafka.json --handlers dist/server/kafka-handlers.js
 *
 * The application server (app.ts --kafka) owns the authoritative order store. It
 * writes a change first and then publishes the full new state to Kafka, so every
 * change newer than a snapshot eventually reaches the source. These handlers read
 * snapshots and ownership from that store through its internal API.
 */
import type { HandlerRegistry, Principal } from "@streamotter/contracts";
import type { AppChannels } from "../generated/streamotter.generated.ts";
import { decodeOrderEvent, verifyToken, type OrderState } from "./domain.ts";
import { internalServiceToken } from "./service-token.ts";

const APP_ORIGIN = process.env["ORDER_APP_INTERNAL_ORIGIN"] ?? "http://127.0.0.1:3000";

async function loadOrder(principal: Principal, orderId: string, signal: AbortSignal): Promise<{ owner: string; revision: string; state: OrderState } | null> {
  const response = await fetch(`${APP_ORIGIN}/internal/orders/${encodeURIComponent(principal.tenantId)}/${encodeURIComponent(orderId)}`, {
    headers: { "x-service-token": internalServiceToken() },
    signal
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Order service responded ${response.status}`);
  return await response.json() as { owner: string; revision: string; state: OrderState };
}

export const handlers: HandlerRegistry<AppChannels> = {
  authenticate: ({ token }) => verifyToken(token),
  channels: {
    orderStatus: {
      authorize: async ({ principal, params, signal }) => (await loadOrder(principal, params.orderId, signal))?.owner === principal.subject,
      map: ({ record }) => {
        const event = decodeOrderEvent(record.value);
        if (event === null) return [];
        return [{ tenantId: event.tenantId, params: { orderId: event.order.orderId }, revision: event.revision, data: event.order }];
      },
      snapshot: async ({ principal, params, signal }) => {
        const order = await loadOrder(principal, params.orderId, signal);
        if (order === null) throw new Error("Order not found");
        return { revision: order.revision, data: order.state };
      }
    }
  }
};
