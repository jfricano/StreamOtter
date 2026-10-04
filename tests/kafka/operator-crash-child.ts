/**
 * Child process for the slice D crash test (F35): a gateway that advances past
 * a quarantined record, is repaired, evaluates it and starts a redrive, then
 * stops forever right after the redrive's intent is journaled. The parent
 * SIGKILLs it there, so the operation has an intent and no result.
 */
import type { Json } from "@streamotter/contracts";
import { silentLogger } from "@streamotter/gateway";
import { createGatewayRuntime, getGatewayInternals } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { OrderApp } from "../integration/harness.ts";
import { kafkaConfig, ROOT } from "./helpers.ts";

const { TOPIC, GROUP, QUARANTINE, STATE, OPERATION_ID } = process.env as Record<string, string>;
const app = new OrderApp();
app.put("acme", "alice", "ord_1", 2, "processing", 20);
const { gateway } = createGatewayRuntime({
  config: kafkaConfig({
    topic: TOPIC!, group: GROUP!,
    failureHandling: {
      quarantine: { topic: QUARANTINE!, capture: "full-record" },
      sources: { orders: { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync", replaySafeMapping: true } }
    }
  } as never),
  handlers: { ...app.handlers(), sources: { orders: { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "crash-test" }) } } },
  mode: "development",
  development: { principals: {}, fixtures: {} },
  stateDirectory: STATE!,
  logger: silentLogger,
  configDir: ROOT
}, {
  operatorHooks: {
    afterIntent: async operationId => {
      process.send?.({ type: "intent", operationId });
      await new Promise(() => undefined);
    }
  }
});
await gateway.start();
const internals = getGatewayInternals(gateway);
const op = getGatewayOperator(gateway);
process.send?.({ type: "ready" });
for (;;) {
  await internals.failuresSettled();
  const [incident] = (await op.listFailures({ state: "all" })).items;
  if (incident?.progress === "advanced") {
    app.mapOverride = (value: Json) => {
      const record = value as { tenantId: string; revision: string; order: { orderId: string; status: string; progress: number } };
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: { ...record.order, status: "done" } }];
    };
    const { plan } = await op.evaluate({ failureId: incident.failureId, expectedRevision: incident.revision });
    if (plan === null) throw new Error("no plan issued");
    process.send?.({ type: "plan", failureId: incident.failureId, revision: incident.revision, planId: plan.planId, fingerprint: plan.fingerprint });
    await op.redrive({ failureId: incident.failureId, planId: plan.planId, planFingerprint: plan.fingerprint, expectedRevision: incident.revision, operationId: OPERATION_ID! });
    break;
  }
  await new Promise(done => setTimeout(done, 100));
}
