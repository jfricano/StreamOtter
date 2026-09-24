import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { DataFrame, SubscriptionFrame } from "@streamotter/contracts";
import { createGateway, silentLogger, type KafkaConnection } from "@streamotter/gateway";
import { startManagementServer } from "@streamotter/gateway/management";
import { OrderApp, waitFor } from "../integration/harness.ts";
import { ack, rawConnect, rawConnectError } from "../integration/raw.ts";
import {
  brokerAvailable, CA_FILE, closeKafkaHelpers, createTopic, kafkaConfig, orderValue, produce, ROOT, SASL_PASSWORD, SASL_TLS,
  SASL_USER, startKafkaHarness, TLS, UNTRUSTED_CA_FILE, uniqueName
} from "./helpers.ts";

const available = await brokerAvailable();
const APP_ORIGIN = "http://localhost:3000";

process.env["SO_TEST_KAFKA_USER"] = SASL_USER;
process.env["SO_TEST_KAFKA_PASSWORD"] = SASL_PASSWORD;
process.env["SO_TEST_KAFKA_WRONG_PASSWORD"] = "not-the-password";

const sasl = (mechanism: "plain" | "scram-sha-256" | "scram-sha-512", password = "SO_TEST_KAFKA_PASSWORD"): KafkaConnection => ({
  brokers: SASL_TLS, tls: { caFile: CA_FILE }, sasl: { mechanism, username: { env: "SO_TEST_KAFKA_USER" }, password: { env: password } }
});

describe("supported Kafka connection modes (production gateway)", { skip: available ? false : "local Kafka is not running" }, () => {
  after(() => closeKafkaHelpers());

  for (const [label, connection] of [
    ["TLS with a supplied CA", { brokers: TLS, tls: { caFile: CA_FILE } }],
    ["TLS + SASL PLAIN", sasl("plain")],
    ["TLS + SASL SCRAM-SHA-256", sasl("scram-sha-256")],
    ["TLS + SASL SCRAM-SHA-512", sasl("scram-sha-512")]
  ] as const) {
    it(`consumes and delivers over ${label}`, { timeout: 60_000 }, async () => {
      const k = await startKafkaHarness({ connection, mode: "production" });
      k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
      const steps = await k.internals.checkSource("orders");
      assert.deepEqual(steps.map(step => `${step.stage}:${step.outcome}`), [
        "resolve:ok", "connect:ok", "tls:ok", `authenticate:${"sasl" in connection ? "ok" : "skipped"}`, "metadata:ok"
      ]);
      const { socket } = await rawConnect(k.origin, { token: "alice@acme", protocolVersion: 1 }, { origin: APP_ORIGIN });
      const frames: DataFrame[] = [];
      const states: SubscriptionFrame[] = [];
      socket.on("so:data", (frame: DataFrame) => {
        frames.push(frame);
        socket.emit("so:receipt", { subscriptionId: frame.subscriptionId, epoch: frame.epoch, sequence: frame.sequence });
      });
      socket.on("so:state", (frame: SubscriptionFrame) => states.push(frame));
      const result = await ack(socket, "so:subscribe", {
        requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" }
      });
      assert.equal(result.ok, true);
      await waitFor(() => states.some(frame => frame.state === "live"), 10_000, "live");
      await produce(k.topic, [{ key: "ord_1", value: orderValue("acme", "ord_1", 2, "done", 100) }]);
      await waitFor(() => frames.at(-1)?.event.revision === "2", 15_000, "update over the secured source");
      socket.close();
      await k.close();
    });
  }

  it("enforces exact origins in production and never exposes management", { timeout: 60_000 }, async () => {
    const k = await startKafkaHarness({ connection: { brokers: TLS, tls: { caFile: CA_FILE } }, mode: "production" });
    const auth = { token: "alice@acme", protocolVersion: 1 };
    assert.equal((await rawConnectError(k.origin, auth)).code, "FORBIDDEN", "a missing Origin is rejected in production");
    assert.equal((await rawConnectError(k.origin, auth, { origin: "http://localhost:3001" })).code, "FORBIDDEN");
    const allowed = await rawConnect(k.origin, auth, { origin: APP_ORIGIN });
    allowed.socket.close();
    await assert.rejects(startManagementServer({ gateway: k.gateway, port: 0 }), { code: "FORBIDDEN" });
    assert.throws(() => k.internals.createPreviewSession("alice"), { code: "FORBIDDEN" });
    await assert.rejects(k.internals.advanceFixture("orders", 1), { code: "FORBIDDEN" });
    const probe = await fetch(`${k.origin}/management/v1/health`);
    assert.equal(probe.status, 404, "the delivery listener serves no management routes");
    await k.close();
  });

  it("fails startup with a wrong SASL password and diagnoses the authenticate stage without leaking it", { timeout: 60_000 }, async () => {
    const topic = await createTopic(1);
    const logged: string[] = [];
    const logger = { info: () => undefined, warn: (message: string, fields?: unknown) => logged.push(`${message} ${JSON.stringify(fields)}`), error: (message: string, fields?: unknown) => logged.push(`${message} ${JSON.stringify(fields)}`) };
    const gateway = createGateway({
      config: kafkaConfig({ topic, group: uniqueName("so-bad"), connection: sasl("scram-sha-256", "SO_TEST_KAFKA_WRONG_PASSWORD") }),
      handlers: new OrderApp().handlers(), mode: "production", logger, configDir: ROOT
    });
    const started = Date.now();
    await assert.rejects(gateway.start(), { code: "SOURCE_UNAVAILABLE" });
    assert.ok(Date.now() - started < 32_000, "within the thirty-second startup deadline");
    const { getGatewayInternals } = await import("@streamotter/gateway/internals");
    const steps = await getGatewayInternals(gateway).checkSource("orders");
    assert.deepEqual(steps.map(step => `${step.stage}:${step.outcome}`), ["resolve:ok", "connect:ok", "tls:ok", "authenticate:failed", "metadata:skipped"]);
    const everything = JSON.stringify(steps) + logged.join("\n");
    assert.ok(!everything.includes("not-the-password") && !everything.includes(SASL_PASSWORD), "no credential appears in diagnostics or logs");
    await gateway.stop();
  });

  it("diagnoses an untrusted CA at the TLS stage", { timeout: 60_000 }, async () => {
    const topic = await createTopic(1);
    const gateway = createGateway({
      config: kafkaConfig({ topic, group: uniqueName("so-ca"), connection: { brokers: TLS, tls: { caFile: UNTRUSTED_CA_FILE } } }),
      handlers: new OrderApp().handlers(), mode: "production", logger: silentLogger, configDir: ROOT
    });
    const { getGatewayInternals } = await import("@streamotter/gateway/internals");
    const steps = await getGatewayInternals(gateway).checkSource("orders");
    assert.deepEqual(steps.map(step => `${step.stage}:${step.outcome}`), ["resolve:ok", "connect:ok", "tls:failed", "authenticate:skipped", "metadata:skipped"]);
    assert.match(steps[2]!.message, /TLS handshake failed/);
  });

  it("reports a missing topic at the metadata stage", async () => {
    const gateway = createGateway({
      config: kafkaConfig({ topic: "so-test-does-not-exist", group: uniqueName("so-missing") }),
      handlers: new OrderApp().handlers(), mode: "development", development: { principals: {}, fixtures: {} }, logger: silentLogger
    });
    const { getGatewayInternals } = await import("@streamotter/gateway/internals");
    const steps = await getGatewayInternals(gateway).checkSource("orders");
    assert.equal(steps.at(-1)?.outcome, "failed");
    assert.match(steps.at(-1)!.message, /not found: so-test-does-not-exist/);
  });
});
