import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import kafkajs from "kafkajs";
import { observe, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, orderValue, PLAINTEXT, produce, startKafkaHarness } from "./helpers.ts";

const { Kafka, logLevel } = kafkajs;
const available = await brokerAvailable();

describe("consumer-group rebalance triggers resynchronization", { skip: available ? false : "local Kafka is not running" }, () => {
  after(() => closeKafkaHelpers());

  it("marks subscriptions stale during a rebalance and resynchronizes when the gateway owns its partitions again", { timeout: 120_000 }, async () => {
    const k = await startKafkaHarness();
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();

    // Simulate a membership change in the gateway's dedicated group (for example, a misconfigured
    // second deployment). The intruder never processes anything; it only joins and leaves.
    const intruder = new Kafka({ clientId: "intruder", brokers: PLAINTEXT, logLevel: logLevel.NOTHING })
      .consumer({ groupId: k.group, sessionTimeout: 10_000 });
    await intruder.connect();
    await intruder.subscribe({ topics: [k.topic] });
    await intruder.run({ autoCommit: false, eachMessage: async () => { await new Promise(() => undefined); } });
    await waitFor(() => seen.states.includes("stale"), 30_000, "stale during rebalance");
    assert.equal(seen.reasons[seen.states.indexOf("stale")], "SOURCE_UNAVAILABLE");
    await waitFor(() => k.internals.sources()[0]?.status === "healthy", 30_000, "gateway rejoined");
    await intruder.disconnect();
    await waitFor(() => sub.state === "live" && seen.states.lastIndexOf("live") > seen.states.indexOf("stale"), 60_000, "resynchronized after rejoin");
    const snapshotsBefore = seen.events.filter(event => event.kind === "snapshot").length;
    assert.ok(snapshotsBefore >= 2, "a fresh snapshot followed the rebalance");

    k.app.put("acme", "alice", "ord_1", 2, "processing", 20);
    await produce(k.topic, [{ key: "ord_1", value: orderValue("acme", "ord_1", 2, "processing", 20) }]);
    await waitFor(() => seen.events.at(-1)?.revision === "2" && sub.state === "live", 60_000, "delivery continues after the rebalance");
    await k.close();
  });
});
