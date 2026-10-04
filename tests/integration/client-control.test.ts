import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { observe, orderRecord, sleep, startHarness, type Harness } from "./harness.ts";

describe("client control requests stay in step with the gateway", () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it("unsubscribing before the subscribe is acknowledged releases it on the gateway", async () => {
    h = await startHarness({ limits: { receiptTimeoutMs: 1_000 } });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("acme", "alice", "ord_2", 1, "queued", 0);
    const client = h.client();
    const keep = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_2" } });
    const seenKeep = observe(keep);
    await keep.ready({ timeoutMs: 5_000 });
    const brief = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(brief.state, "authorizing", "the subscribe is on the wire");
    await brief.unsubscribe();
    await sleep(100);
    assert.equal(h.internals.subscriptionCount(), 1);
    await sleep(1_500); // Longer than receiptTimeoutMs: an orphaned snapshot would have dropped the connection.
    assert.ok(!seenKeep.states.includes("stale"), "the other subscription was never disturbed");
  });

  it("a resync refused over the rate limit is retried instead of freezing in authorizing", async () => {
    h = await startHarness({ limits: { controlRequestsPerSecond: 5 } });
    const client = h.client();
    const subs = [];
    for (let i = 0; i < 12; i++) h.app.put("acme", "alice", `ord_${i}`, 1, "queued", 0);
    for (let wave = 0; wave < 2; wave++) {
      for (let i = 0; i < 6; i++) subs.push(client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${wave * 6 + i}` } }));
      await Promise.all(subs.map(s => s.ready({ timeoutMs: 5_000 })));
      await sleep(2_100); // Refill the burst.
    }
    const seen = subs.map(s => observe(s));
    const results = await Promise.allSettled(subs.map(s => s.resync({ timeoutMs: 8_000 })));
    assert.ok(seen.some(s => s.errors.some(e => e.code === "OVERLOADED")), "some resyncs were refused");
    assert.deepEqual(results.map(r => r.status), subs.map(() => "fulfilled"));
    assert.deepEqual(subs.map(s => s.state), subs.map(() => "live"));
    assert.equal(client.state, "connected");
  });

  it("unsubscribing many subscriptions at once releases every one on the gateway", async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_9", 2, "processing", 20)], limits: { controlRequestsPerSecond: 5, receiptTimeoutMs: 1_000 } });
    const client = h.client();
    const subs = [];
    for (let i = 0; i < 12; i++) h.app.put("acme", "alice", `ord_${i}`, 1, "queued", 0);
    for (let wave = 0; wave < 2; wave++) {
      for (let i = 0; i < 6; i++) subs.push(client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: `ord_${wave * 6 + i}` } }));
      await Promise.all(subs.map(s => s.ready({ timeoutMs: 5_000 })));
      await sleep(2_100);
    }
    const keep = subs[0]!;
    const seenKeep = observe(keep);
    await Promise.all(subs.slice(1).map(s => s.unsubscribe())); // 11 requests against a burst of 10.
    assert.equal(h.internals.subscriptionCount(), 1);
    await h.advance(1); // An update for ord_9, which was unsubscribed.
    await sleep(1_500);
    assert.ok(!seenKeep.states.includes("stale"), "the remaining subscription was never disturbed");
  });
});
