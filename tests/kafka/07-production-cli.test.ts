import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import type { DataFrame, SubscriptionFrame } from "@streamotter/contracts";
import { waitFor } from "../integration/harness.ts";
import { ack, rawConnect, rawConnectError } from "../integration/raw.ts";
import { brokerAvailable, CA_FILE, closeKafkaHelpers, createTopic, kafkaConfig, orderValue, produce, ROOT, TLS, uniqueName } from "./helpers.ts";

const available = await brokerAvailable();
const CLI = resolve(ROOT, "packages/cli/bin/streamotter.js");

describe("production build: `streamotter start` (compiled CLI) against TLS Kafka", { skip: available ? false : "local Kafka is not running" }, () => {
  after(() => closeKafkaHelpers());

  it("serves delivery only, enforces origins, and shuts down gracefully on SIGTERM", { timeout: 90_000 }, async () => {
    const topic = await createTopic(1);
    const dir = await mkdtemp(join(tmpdir(), "so-prod-"));
    const config = kafkaConfig({ topic, group: uniqueName("so-prod"), connection: { brokers: TLS, tls: { caFile: CA_FILE } } });
    await writeFile(join(dir, "streamotter.json"), JSON.stringify(config));
    const child = spawn(process.execPath, [CLI, "start", "--config", join(dir, "streamotter.json"), "--handlers", resolve(import.meta.dirname, "fixtures/production-handlers.mjs")], { env: { ...process.env, NODE_ENV: "production" } });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    try {
      await waitFor(() => /listening on (http:\/\/127\.0\.0\.1:\d+)/.test(output), 30_000, "production banner");
      const origin = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]!;
      assert.match(output, /No management or development endpoints are exposed/);
      await assert.rejects(fetch("http://127.0.0.1:7401/management/v1/health"), "no management listener in production");
      assert.equal((await fetch(`${origin}/management/v1/health`)).status, 404);

      const auth = { token: "alice-token", protocolVersion: 1 };
      assert.equal((await rawConnectError(origin, auth)).code, "FORBIDDEN", "browser Origin required");
      assert.equal((await rawConnectError(origin, { token: "nope", protocolVersion: 1 }, { origin: "http://localhost:3000" })).code, "UNAUTHENTICATED");
      const { socket } = await rawConnect(origin, auth, { origin: "http://localhost:3000" });
      const frames: DataFrame[] = [];
      const states: SubscriptionFrame[] = [];
      socket.on("so:data", (frame: DataFrame) => {
        frames.push(frame);
        socket.emit("so:receipt", { subscriptionId: frame.subscriptionId, epoch: frame.epoch, sequence: frame.sequence });
      });
      socket.on("so:state", (frame: SubscriptionFrame) => states.push(frame));
      const accepted = await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" } });
      assert.equal(accepted.ok, true);
      await waitFor(() => states.some(frame => frame.state === "live"), 10_000, "live");
      await produce(topic, [{ key: "ord_1", value: orderValue("acme", "ord_1", 2, "processing", 50) }]);
      await waitFor(() => frames.at(-1)?.event.revision === "2", 15_000, "update delivered by the production gateway");
      socket.close();
    } finally {
      const exited = child.exitCode !== null ? Promise.resolve(child.exitCode) : new Promise<number | null>(done => child.once("exit", done));
      child.kill("SIGTERM");
      assert.equal(await exited, 0, output);
    }
    assert.match(output, /Received SIGTERM; shutting down gracefully/);
    assert.ok(!/streamotter-local-secret/.test(output));
  });
});
