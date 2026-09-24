/**
 * Reproducible order-dashboard scenarios against the real gateway, SDK, and this
 * example's handlers (fixture mode):
 *   1. an update arriving while the snapshot is loading,
 *   2. a disconnect followed by resynchronization,
 *   3. rejected access (non-owner, other tenant, forged token).
 *
 *   pnpm --filter order-dashboard scenarios
 */
import { readFile } from "node:fs/promises";
import { createClient, type Client, type SubscriptionState } from "@streamotter/client";
import type { ProjectConfig, StreamEvent } from "@streamotter/contracts";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { getGatewayInternals } from "@streamotter/gateway/internals";
import type { AppChannels, OrderState } from "../src/generated/streamotter.generated.ts";
import { issueToken } from "../src/server/domain.ts";
import { development, handlers } from "../src/server/fixture-handlers.ts";

export interface ScenarioResult { name: string; passed: boolean; detail: string }

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function watch(client: Client<AppChannels>, orderId: string) {
  const subscription = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId } });
  const timeline: string[] = [];
  const events: StreamEvent<OrderState>[] = [];
  const states: SubscriptionState[] = [];
  subscription.on("state", ({ state, reason }) => {
    states.push(state);
    timeline.push(`state:${state}${reason === undefined ? "" : `(${reason})`}`);
  });
  subscription.on("data", event => {
    events.push(event);
    timeline.push(`${event.kind}:r${event.revision}`);
  });
  return { subscription, timeline, events, states };
}

export async function runScenarios(): Promise<ScenarioResult[]> {
  const config = JSON.parse(await readFile(new URL("../streamotter.json", import.meta.url), "utf8")) as ProjectConfig<AppChannels>;
  const gateway = createGateway<AppChannels>({
    config: { ...config, gateway: { ...config.gateway, port: 0 } },
    handlers, development, mode: "development", logger: silentLogger
  });
  const { origin } = await gateway.start();
  const internals = getGatewayInternals(gateway);
  const clients: Client<AppChannels>[] = [];
  const client = (token: () => string) => {
    const created = createClient<AppChannels>({ origin, getToken: token });
    clients.push(created);
    return created;
  };
  const results: ScenarioResult[] = [];
  const run = async (name: string, body: () => Promise<string>) => {
    try {
      results.push({ name, passed: true, detail: await body() });
    } catch (error) {
      results.push({ name, passed: false, detail: (error as Error).message });
    }
  };

  try {
    await run("Update arrives while the snapshot is loading", async () => {
      process.env["ORDER_SNAPSHOT_DELAY_MS"] = "600";
      const alice = issueToken("alice")!;
      const view = watch(client(() => alice.token), "ord_1001");
      await waitFor(() => view.states.includes("synchronizing"), 5_000, "synchronizing");
      // The fixture's next record moves acme/ord_1001 to "picking" (revision 2) mid-snapshot.
      if (await internals.advanceFixture("orders", 1) !== 1) throw new Error("fixture did not advance");
      await view.subscription.ready({ timeoutMs: 10_000 });
      process.env["ORDER_SNAPSHOT_DELAY_MS"] = "0";
      const expected = ["state:authorizing", "state:synchronizing", "snapshot:r1", "update:r2", "state:live"];
      if (JSON.stringify(view.timeline) !== JSON.stringify(expected)) throw new Error(`timeline ${view.timeline.join(" → ")}`);
      return view.timeline.join(" → ");
    });

    await run("Disconnect, change while away, resynchronize", async () => {
      const preview = internals.createPreviewSession("alice");
      const view = watch(client(() => preview.token), "ord_1002");
      await view.subscription.ready({ timeoutMs: 10_000 });
      internals.disconnectPreviewSession(preview.previewSessionId);
      await waitFor(() => view.states.includes("stale"), 5_000, "stale");
      // While disconnected, acme/ord_1002 moves to revision 2. It is not replayed; the snapshot carries it.
      if (await internals.advanceFixture("orders", 1) !== 1) throw new Error("fixture did not advance");
      await waitFor(() => view.subscription.state === "live" && view.events.length === 2, 10_000, "resynchronized");
      const kinds = view.events.map(event => `${event.kind}:r${event.revision}`).join(", ");
      if (kinds !== "snapshot:r1, snapshot:r2") throw new Error(`events ${kinds}`);
      return view.timeline.join(" → ");
    });

    await run("Rejected access fails closed", async () => {
      const outcomes: string[] = [];
      const cases: [string, () => string, string][] = [
        ["mallory (same tenant, not the owner) → ord_1001", () => internals.createPreviewSession("mallory").token, "ord_1001"],
        ["bob (Globex) → ord_1003 (an Acme order)", () => issueToken("bob")!.token, "ord_1003"],
        ["forged token → ord_1001", () => "forged.token", "ord_1001"]
      ];
      for (const [label, token, orderId] of cases) {
        const view = watch(client(token), orderId);
        const code = await view.subscription.ready({ timeoutMs: 5_000 }).then(() => "live", (error: { code: string }) => error.code);
        if (code === "live" || view.events.length > 0) throw new Error(`${label} received data`);
        outcomes.push(`${label}: ${code}`);
      }
      return outcomes.join("; ");
    });
  } finally {
    await Promise.all(clients.map(created => created.close()));
    await gateway.stop();
  }
  return results;
}

if (import.meta.main) {
  const results = await runScenarios();
  for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}\n      ${result.detail}`);
  process.exit(results.every(result => result.passed) ? 0 : 1);
}
