/**
 * Child process for the slice C crash tests: a gateway with a quarantine-resync
 * source that stops forever at a chosen point around the guarded advance. The
 * parent SIGKILLs it there (F16: barrier persisted, offset not committed; F17:
 * offset committed, final journal write lost).
 */
import { silentLogger } from "@streamotter/gateway";
import { createGatewayRuntime } from "@streamotter/gateway/internals";
import { OrderApp } from "../integration/harness.ts";
import { kafkaConfig, ROOT } from "./helpers.ts";

const { TOPIC, GROUP, QUARANTINE, STATE, CRASH_AT } = process.env as Record<string, string>;
const app = new OrderApp();
const stopForever = (point: string) => async (failureId: string) => {
  if (CRASH_AT !== point) return;
  process.send?.({ type: point, failureId });
  await new Promise(() => undefined);
};
const { gateway } = createGatewayRuntime({
  config: kafkaConfig({
    topic: TOPIC!, group: GROUP!,
    failureHandling: { quarantine: { topic: QUARANTINE!, capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-resync" } } }
  }),
  handlers: { ...app.handlers(), sources: { orders: { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "crash-test" }) } } },
  mode: "development",
  development: { principals: {}, fixtures: {} },
  stateDirectory: STATE!,
  logger: silentLogger,
  configDir: ROOT
}, { advanceHooks: { beforeAdvance: stopForever("before-advance"), afterAdvance: stopForever("after-advance") } });
const { origin } = await gateway.start();
process.send?.({ type: "ready", origin });
