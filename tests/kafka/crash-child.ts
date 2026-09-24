/**
 * Child process for the crash test: a development gateway whose commit of a chosen
 * revision never happens. The parent SIGKILLs this process after admission.
 */
import type { Json, SourceRecord } from "@streamotter/contracts";
import { createGatewayRuntime } from "@streamotter/gateway/internals";
import { silentLogger } from "@streamotter/gateway";
import { OrderApp } from "../integration/harness.ts";
import { kafkaConfig, ROOT } from "./helpers.ts";

const { TOPIC, GROUP, CRASH_REVISION } = process.env as Record<string, string>;
const app = new OrderApp();
app.put("acme", "alice", "ord_1", 1, "queued", 0);
const revisionAt = new Map<string, { revision: string; recordId: string }>();
app.mapOverride = (value: Json) => {
  const record = value as { tenantId: string; revision: string; order: { orderId: string } };
  return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
};
const handlers = app.handlers();
const originalMap = handlers.channels.orderStatus.map;
handlers.channels.orderStatus.map = input => {
  const value = input.record.value as { revision: string };
  revisionAt.set(JSON.stringify(input.record.position), { revision: value.revision, recordId: input.record.id });
  return originalMap(input);
};

const { gateway } = createGatewayRuntime({
  config: kafkaConfig({ topic: TOPIC!, group: GROUP! }),
  handlers,
  mode: "development",
  development: { principals: {}, fixtures: {} },
  logger: silentLogger,
  configDir: ROOT
}, {
  beforeCommit: async (_sourceId: string, position: SourceRecord["position"]) => {
    const seen = revisionAt.get(JSON.stringify(position));
    if (seen === undefined || seen.revision !== CRASH_REVISION) return;
    process.send?.({ type: "admitted-not-committed", recordId: seen.recordId, position });
    await new Promise(() => undefined); // The commit never happens; the parent kills us.
  }
});
const { origin } = await gateway.start();
process.send?.({ type: "ready", origin });
