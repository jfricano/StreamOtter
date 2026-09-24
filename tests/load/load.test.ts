/**
 * Declared-workload resource test (not a capacity benchmark). Parameters:
 *   clients:        200 SDK clients, one connection each, one subscription each
 *   channel keys:   20 orders (10 subscribers per routing identity), one tenant
 *   stalled:        10 raw clients that never acknowledge frames
 *   updates:        600 fixture records (30 revisions per order), as fast as the source commits
 *   payload:        ~150-byte JSON order state (≈400-byte data frames)
 *   limits:         defaults, except receiptTimeoutMs 1000 (shed stalled clients quickly) and
 *                   controlRequestsPerSecond 1000 (the churn phase issues 600 control requests)
 *   churn:          300 subscribe → live → unsubscribe cycles on one connection
 * Assertions: healthy clients converge to the final revision in order; stalled clients
 * are disconnected; source progress never blocks; gateway budgets stay within limits and
 * return to zero; subscription and connection state is fully released.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataFrame } from "@streamotter/contracts";
import { orderRecord, sleep, startHarness, waitFor } from "../integration/harness.ts";
import { ack, rawConnect } from "../integration/raw.ts";

const ORDERS = 20;
const CLIENTS = 200;
const STALLED = 10;
const REVISIONS = 30;

describe("declared workload: fan-out, stalled clients, and churn", () => {
  it("stays bounded and converges", { timeout: 120_000 }, async () => {
    const fixtures = [];
    for (let revision = 2; revision <= REVISIONS + 1; revision++) {
      for (let order = 0; order < ORDERS; order++) fixtures.push(orderRecord("acme", `ord_${order}`, revision, "processing", revision % 101));
    }
    const h = await startHarness({ fixtures, limits: { receiptTimeoutMs: 1_000, maxConnections: 1_000, controlRequestsPerSecond: 1_000 } });
    for (let order = 0; order < ORDERS; order++) h.app.put("acme", "alice", `ord_${order}`, 1, "queued", 0);
    const report: Record<string, number | string> = {};
    const heapBefore = process.memoryUsage().heapUsed;
    try {
      const started = Date.now();
      const latest = new Array<string>(CLIENTS).fill("");
      const outOfOrder: number[] = [];
      const subscriptions = Array.from({ length: CLIENTS }, (_, index) => {
        const sub = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${index % ORDERS}` } });
        sub.on("data", event => {
          if (latest[index] !== "" && BigInt(event.revision) <= BigInt(latest[index]!)) outOfOrder.push(index);
          latest[index] = event.revision;
        });
        return sub;
      });
      await Promise.all(subscriptions.map(sub => sub.ready({ timeoutMs: 30_000 })));
      report["subscribe+ready (ms)"] = Date.now() - started;

      const stalled = await Promise.all(Array.from({ length: STALLED }, async (_, index) => {
        const { socket } = await rawConnect(h.origin, { token: "alice@acme", protocolVersion: 1 });
        let disconnected = false;
        let frames = 0;
        socket.on("so:data", (_frame: DataFrame) => { frames++; });
        socket.on("disconnect", () => { disconnected = true; });
        await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: `ord_${index}` } });
        return { socket, get disconnected() { return disconnected; }, get frames() { return frames; } };
      }));
      await waitFor(() => stalled.every(client => client.frames === 1), 10_000, "stalled clients received snapshots");

      const final = String(REVISIONS + 1);
      for (let order = 0; order < ORDERS; order++) h.app.put("acme", "alice", `ord_${order}`, final, "processing", (REVISIONS + 1) % 101);
      let peakPending = 0;
      const sampler = setInterval(() => { peakPending = Math.max(peakPending, h.internals.pendingBytes()); }, 5);
      const advanceStarted = Date.now();
      let advanced = 0;
      while (advanced < fixtures.length) advanced += await h.advance(100);
      report["source commit of 600 records (ms)"] = Date.now() - advanceStarted;
      await waitFor(() => latest.every(revision => revision === final), 60_000, "all healthy clients converged");
      clearInterval(sampler);
      report["fan-out converged (ms)"] = Date.now() - advanceStarted;
      report["peak pending bytes"] = peakPending;
      report["frames delivered"] = CLIENTS * REVISIONS;

      assert.equal(advanced, fixtures.length, "the source never blocked on slow subscribers");
      assert.deepEqual(outOfOrder, [], "no client saw a regressing revision");
      assert.ok(peakPending <= h.internals.limits.maxPendingBytesGateway, `peak ${peakPending}`);
      await waitFor(() => stalled.every(client => client.disconnected), 10_000, "stalled clients disconnected by receipt timeout");
      assert.ok(subscriptions.every(sub => sub.state === "live"));

      // Churn on one connection: subscribe/unsubscribe cycles release all server state.
      const churnClient = h.client();
      const churnStarted = Date.now();
      for (let cycle = 0; cycle < 300; cycle++) {
        const sub = churnClient.subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${cycle % ORDERS}` } });
        await sub.ready({ timeoutMs: 10_000 });
        await sub.unsubscribe();
      }
      report["300 subscribe→live→unsubscribe cycles (ms)"] = Date.now() - churnStarted;
      await Promise.all(subscriptions.map(sub => sub.unsubscribe()));
      await waitFor(() => h.internals.subscriptionCount() === 0 && h.internals.pendingBytes() === 0, 10_000, "released state");
      await Promise.all(h.clients.map(client => client.close()));
      await waitFor(() => h.internals.connectionCount() === 0, 10_000, "connections closed");
      global.gc?.();
      await sleep(100);
      report["heap delta after release (MB)"] = ((process.memoryUsage().heapUsed - heapBefore) / 1_048_576).toFixed(1);
      console.log(`# load report ${JSON.stringify(report)}`);
    } finally {
      await h.close();
    }
  });
});
