/** Compile-time acceptance checks, including intentional invalid API uses. */
import {
  createClient, TransientMappingError,
  type HandlerRegistry, type ManagementOperations, type ProjectConfig, type SocketAuth, type SourceRecoveryHandlers, type StreamEvent,
  type WorkbenchHostConfig, type WorkbenchHostManifest, type WorkbenchOperation
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

// --- V1.1 source-failure handling (additive) ----------------------------------

const v11Project: ProjectConfig<AppChannels> = {
  ...project,
  failureHandling: {
    quarantine: { topic: "orders.streamotter.quarantine", capture: "full-record" },
    sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-hold", boundaryRetirement: "application" } }
  }
};
void v11Project;
const skipPolicy: ProjectConfig<AppChannels> = {
  ...project,
  // @ts-expect-error There is no ignore, discard, or skip policy.
  failureHandling: { sources: { orders: { invalidJson: "ignore" } } }
};
void skipPolicy;
const integrityPolicy: ProjectConfig<AppChannels> = {
  ...project,
  // @ts-expect-error Integrity failures have no policy key; they always hold.
  failureHandling: { sources: { orders: { revisionConflict: "quarantine-resync" } } }
};
void integrityPolicy;
const metadataCapture: ProjectConfig<AppChannels> = {
  ...project,
  // @ts-expect-error Only full-record capture exists in V1.1.
  failureHandling: { quarantine: { topic: "q", capture: "metadata-only" }, sources: {} }
};
void metadataCapture;

const guard: SourceRecoveryHandlers = {
  recover: ({ prior, incident }) => incident.failureClass === "invalid-json" && prior === null
    ? { decision: "recoverable", context: { watermark: "42" }, evidenceRef: "outbox:42" }
    : { decision: "hold", reason: "coverage unknown" },
  retire: ({ boundary }) => boundary.id.length > 0
};
void guard;
// @ts-expect-error The guard cannot return a skip decision.
const skippingGuard: SourceRecoveryHandlers = { recover: () => ({ decision: "skip" }) };
void skippingGuard;
// @ts-expect-error The gateway assigns boundary IDs; a guard returns only context.
const forgedBoundary: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", boundary: { id: "rb1:x", context: {} }, evidenceRef: "x" }) };
void forgedBoundary;

declare const v11Handlers: HandlerRegistry<AppChannels>;
const acknowledging: HandlerRegistry<AppChannels> = {
  ...v11Handlers,
  sources: { orders: guard },
  channels: {
    orderStatus: {
      ...v11Handlers.channels.orderStatus,
      snapshot: ({ recovery }) => ({
        revision: "7",
        data: { orderId: "x", status: "done", progress: 100 },
        ...(recovery === undefined ? {} : { recoveryBoundaryId: recovery.boundaryId })
      })
    }
  }
};
void acknowledging;
void new TransientMappingError("pricing service unavailable");

// Workbench host contract (WHC-1), added with the V1.1 workbench seam.
const hosted: WorkbenchHostConfig = {
  hostContract: 1, apiBase: "/workbench/api/v1", auth: { mode: "session" },
  environment: { kind: "sandbox", label: "Synthetic fixture" }
};
void hosted;
// Revision 0.3: a cross-origin API in session mode. That apiOrigin requires session mode is checked
// at runtime by validateWorkbenchHostConfig (packages/contracts/test/workbench.test.ts), not here.
const splitOrigin: WorkbenchHostConfig = {
  hostContract: 1, apiOrigin: "https://demo.streamotter.app", apiBase: "/workbench/api/v1", auth: { mode: "session" }
};
void splitOrigin;
// @ts-expect-error apiOrigin is one origin string, never a list or a URL object.
const originList: WorkbenchHostConfig = { hostContract: 1, apiOrigin: ["https://a.example"], auth: { mode: "session" } };
void originList;
const entry: WorkbenchHostManifest["entry"] = { script: "app.js", style: "styles.css", hostStyle: "workbench-host.css", icon: "favicon.svg" };
void entry;
// @ts-expect-error Revision 0.3 manifests always name the scoped stylesheet for hosts.
const unscopedOnly: WorkbenchHostManifest["entry"] = { script: "app.js", style: "styles.css", icon: "favicon.svg" };
void unscopedOnly;
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
