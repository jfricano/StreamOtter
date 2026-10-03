/** Compile-time acceptance checks, including intentional invalid API uses. */
import {
  createClient, type ManagementOperations, type StreamEvent, type SocketAuth, type ProjectConfig, type WorkbenchHostConfig,
  type WorkbenchOperation
} from "./api";
import { project, type AppChannels, type OrderState } from "./example";

const client = createClient<AppChannels>({ getToken: () => "application-token" });
client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_123" } });

// @ts-expect-error Unknown channels cannot be subscribed to.
client.subscribe("privateKafkaTopic", { channelVersion: 1, params: { orderId: "ord_123" } });
// @ts-expect-error The generated channel contract fixes its supported version.
client.subscribe("orderStatus", { channelVersion: 2, params: { orderId: "ord_123" } });
// @ts-expect-error An order identifier is required.
client.subscribe("orderStatus", { channelVersion: 1, params: {} });
// @ts-expect-error Client tenant claims are not channel parameters.
client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "x", tenantId: "other-tenant" } });
// @ts-expect-error Durable replay is absent from V1.
client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "x" }, recovery: { cursor: "x" } });
// @ts-expect-error Commands are absent from V1.
client.command("requestOrderRefresh", {});

const order = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "x" } });
order.on("data", event => {
  const progress: number = event.data.progress;
  void progress;
  // @ts-expect-error Generated payloads do not have arbitrary fields.
  event.data.secretInternalCost;
});

// @ts-expect-error V1 state events always carry a revision.
const missingRevision: StreamEvent<OrderState> = {
  id: "event", channel: "orderStatus", channelVersion: 1, kind: "update",
  receivedAt: "2026-09-14T00:00:00.000Z", data: { orderId: "x", status: "done", progress: 100 }
};
void missingRevision;
// @ts-expect-error The protocol does not accept a client-supplied principal.
const spoofedAuth: SocketAuth = { token: "x", protocolVersion: 1, principal: { subject: "admin" } };
void spoofedAuth;
const invalidProject: ProjectConfig<AppChannels> = {
  ...project,
  channels: {
    orderStatus: {
      ...project.channels.orderStatus,
      // @ts-expect-error Unsupported delivery modes fail statically as well as at runtime.
      delivery: { kind: "events", overflow: "resync" }
    }
  }
};
void invalidProject;

// Workbench host contract (WHC-1), added with the V1.1 workbench seam.
const hosted: WorkbenchHostConfig = {
  hostContract: 1, apiBase: "/workbench/api/v1", auth: { mode: "session" },
  environment: { kind: "sandbox", label: "Synthetic fixture" }
};
void hosted;
// @ts-expect-error Only host contract 1 exists.
const futureContract: WorkbenchHostConfig = { hostContract: 2 };
void futureContract;
// @ts-expect-error A boot block never carries a credential.
const tokenInBootBlock: WorkbenchHostConfig = { hostContract: 1, auth: { mode: "token", token: "secret" } };
void tokenInBootBlock;
// @ts-expect-error Retiring a recovery boundary is CLI-only and never a workbench operation.
const retire: WorkbenchOperation = "sources.retire-boundary";
void retire;
const discovered: ManagementOperations["GET /management/v1/workbench"]["response"] = {
  hostContract: 1, operations: ["health", "failures.list"], limits: { maxRequestBytes: 65_536 }
};
void discovered;
