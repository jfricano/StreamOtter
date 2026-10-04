import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { GatewayLogger } from "@streamotter/contracts";
import { KafkaSourceAdapter } from "../../packages/gateway/src/sources/kafka.ts";
import type { SourceSink } from "../../packages/gateway/src/sources/types.ts";
import { sleep } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, createTopic, PLAINTEXT, produce, uniqueName } from "./helpers.ts";

/**
 * The guarded advance's read-back client and gateway shutdown: a stop that
 * begins while advancePast is committing must not leave an admin client
 * connected after stop() has released the adapter's connections. Whether a
 * late client outlives stop() is a race, so the test checks the cause: no
 * read-back (which needs the client) is attempted once stop() has begun.
 */

const skip = (await brokerAvailable()) ? false : "local Kafka is not running";
const openSockets = () => process.getActiveResourcesInfo().filter(name => name === "TCPSocketWrap").length;

describe("advancePast during stop", { skip }, () => {
  after(closeKafkaHelpers);

  it("creates no admin client once stop() has begun, and reports the commit as uncertain", async () => {
    const topic = await createTopic(1);
    await produce(topic, [{ key: "ord_1", value: "{not json" }]);
    // Let the helper clients settle so the socket count below only reflects the adapter.
    await sleep(500);
    const baseline = openSockets();
    const warnings: string[] = [];
    const logger: GatewayLogger = { info: () => undefined, warn: message => { warnings.push(message); }, error: () => undefined };
    let held!: () => void;
    const isHeld = new Promise<void>(resolve => { held = resolve; });
    const sink: SourceSink = {
      process: async () => ({ kind: "pause", code: "INVALID_PAYLOAD", failureClass: "invalid-json" }),
      setStatus: () => undefined,
      held: () => held(),
      logger,
      stopSignal: new AbortController().signal
    };
    const adapter = new KafkaSourceAdapter({
      projectId: "order-dashboard", sourceId: "orders",
      source: { kind: "kafka", generation: "orders-1", connectionRef: "local", topics: [topic], consumerGroup: uniqueName("so-group"), codec: "json", startFrom: "earliest" },
      connection: { brokers: PLAINTEXT, tls: false, ca: null, sasl: null },
      sink,
      onCommit: () => undefined
    });
    await adapter.start();
    await isHeld;
    // advancePast runs up to its commit request; stop() begins while that request is in flight.
    const advancing = adapter.advancePast({ position: { kind: "kafka", topic, partition: 0, offset: "0" } });
    const stopping = adapter.stop(Date.now() + 10_000);
    const [result] = await Promise.all([advancing, stopping]);
    assert.equal(result, "uncertain");
    // The read-back needs the admin client; once stop() has begun it must not be created, so no read-back is attempted.
    assert.deepEqual(warnings.filter(message => /read back|did not match/.test(message)), [], "no committed-offset read-back after stop() began");
    await sleep(1_000);
    assert.equal(openSockets(), baseline, "every connection the adapter opened is closed after stop and advancePast settle");
  });
});
