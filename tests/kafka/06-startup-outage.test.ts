import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { observe, OrderApp, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, kafkaConfig, orderValue, produce, ROOT, startKafkaHarness, uniqueName } from "./helpers.ts";

const run = promisify(execFile);
const available = await brokerAvailable();

async function ready(port: number): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
  return { status: response.status, body: await response.json() };
}

async function live(port: number): Promise<number> {
  return (await fetch(`http://127.0.0.1:${port}/health/live`)).status;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

describe("startup deadline and source outage", { skip: available ? false : "local Kafka is not running" }, () => {
  after(() => closeKafkaHelpers());

  it("rolls back and rejects when brokers are unreachable within the startup deadline", { timeout: 90_000 }, async () => {
    const port = await freePort();
    const healthPort = await freePort();
    const gateway = createGateway({
      config: kafkaConfig({ topic: "so-unreachable", group: uniqueName("so-unreachable"), connection: { brokers: ["127.0.0.1:1"], tls: false }, port }),
      handlers: new OrderApp().handlers(), mode: "development", development: { principals: {}, fixtures: {} }, logger: silentLogger,
      health: { port: healthPort }
    });
    const started = Date.now();
    const starting = gateway.start();
    // F43: while startup waits on the brokers, liveness is ok and readiness says starting.
    let probed: { status: number; body: unknown } | null = null;
    for (let attempt = 0; attempt < 50 && probed === null; attempt++) {
      probed = await ready(healthPort).catch(() => null);
      if (probed === null) await new Promise(done => setTimeout(done, 100));
    }
    assert.deepEqual(probed, { status: 503, body: { status: "unavailable", reasons: ["starting"] } });
    assert.equal(await live(healthPort), 200);
    await assert.rejects(starting, { code: "SOURCE_UNAVAILABLE" });
    await assert.rejects(fetch(`http://127.0.0.1:${healthPort}/health/live`), "the health listener closes with the failed start");
    const elapsed = Date.now() - started;
    assert.ok(elapsed <= 31_000, `rejected after ${elapsed} ms`);
    // The listener opened by the failed attempt was released.
    const probe = createServer();
    await new Promise<void>((done, fail) => { probe.once("error", fail); probe.listen(port, "127.0.0.1", done); });
    await new Promise<void>(done => probe.close(() => done()));
    await gateway.stop();
  });

  it("marks views stale during a broker outage and resynchronizes after recovery", { timeout: 240_000 }, async () => {
    const healthPort = await freePort();
    const k = await startKafkaHarness({ health: { port: healthPort } });
    assert.deepEqual(await ready(healthPort), { status: 200, body: { status: "ok", reasons: [] } });
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const sub = k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready();
    const stoppedAt = Date.now();
    await run(resolve(ROOT, "scripts/kafka/stop.sh"));
    try {
      await waitFor(() => sub.state === "stale", 60_000, "stale after the broker stopped");
      const detectedAfter = Date.now() - stoppedAt;
      assert.equal(seen.reasons[seen.states.indexOf("stale")], "SOURCE_UNAVAILABLE");
      assert.notEqual(k.internals.sources()[0]?.status, "healthy");
      // F43: a broker outage makes the gateway unready but never unalive.
      assert.deepEqual(await ready(healthPort), { status: 503, body: { status: "unavailable", reasons: ["source-unavailable"] } });
      assert.equal(await live(healthPort), 200);
      console.log(`# outage detected after ${detectedAfter} ms`);
    } finally {
      await run(resolve(ROOT, "scripts/kafka/start.sh"), { timeout: 120_000 });
    }
    const restartedAt = Date.now();
    await waitFor(() => k.internals.sources()[0]?.status === "healthy", 120_000, "source healthy after restart");
    await waitFor(() => sub.state === "live", 60_000, "live after recovery");
    assert.deepEqual(await ready(healthPort), { status: 200, body: { status: "ok", reasons: [] } });
    console.log(`# recovered ${Date.now() - restartedAt} ms after the broker restarted`);
    k.app.put("acme", "alice", "ord_1", 2, "processing", 50);
    await produce(k.topic, [{ key: "ord_1", value: orderValue("acme", "ord_1", 2, "processing", 50) }]);
    await waitFor(() => seen.events.at(-1)?.revision === "2", 60_000, "delivery after recovery");
    assert.ok(seen.events.filter(event => event.kind === "snapshot").length >= 2, "recovery used a fresh snapshot");
    await k.close();
  });
});
