import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGateway, defineProject, silentLogger, type ProjectConfig } from "@streamotter/gateway";
import { OrderApp, orderConfig, type TestChannels } from "./harness.ts";

function kafkaConfig(tls: false | { caFile?: string }): ProjectConfig<TestChannels> {
  const base = orderConfig();
  return {
    ...base,
    connections: { cluster: { brokers: ["localhost:9092"], tls } },
    sources: {
      orders: {
        kind: "kafka", generation: "g1", connectionRef: "cluster", topics: ["orders.status"],
        consumerGroup: "streamotter-test", codec: "json", startFrom: "earliest"
      }
    }
  };
}

describe("acceptance 8–9: configuration boundaries", () => {
  it("defineProject validates structure synchronously and reports issues", () => {
    assert.doesNotThrow(() => defineProject(orderConfig()));
    const invalid = {
      ...orderConfig(),
      channels: { orderStatus: { ...orderConfig().channels.orderStatus, delivery: { kind: "events", overflow: "resync" } } }
    } as unknown as ProjectConfig<TestChannels>;
    assert.throws(() => defineProject(invalid), (error: { code: string; details: { issues: { code: string }[] } }) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.equal(error.details.issues[0]?.code, "UNSUPPORTED_FEATURE");
      return true;
    });
  });

  it("rejects development options, fixture sources, and plaintext Kafka in production", () => {
    const app = new OrderApp();
    assert.throws(() => createGateway({
      config: orderConfig(), handlers: app.handlers(), mode: "production", logger: silentLogger,
      development: { principals: {}, fixtures: { orders: [] } }
    }), (error: { code: string; message: string }) => error.code === "CONFIG_INVALID"
      && /development options are rejected/.test(error.message) && /fixture sources are development-only/.test(error.message));
    assert.throws(() => createGateway({ config: kafkaConfig(false), handlers: app.handlers(), mode: "production", logger: silentLogger }),
      /plaintext connections are development-only/);
    assert.doesNotThrow(() => createGateway({ config: kafkaConfig({}), handlers: app.handlers(), mode: "production", logger: silentLogger }));
  });

  it("requires registered fixtures and valid development principals in development", () => {
    const app = new OrderApp();
    assert.throws(() => createGateway({ config: orderConfig(), handlers: app.handlers(), mode: "development", logger: silentLogger }),
      /development\.fixtures\.orders is required/);
    assert.throws(() => createGateway({
      config: orderConfig(), handlers: app.handlers(), mode: "development", logger: silentLogger,
      development: { principals: { ghost: { subject: "", tenantId: "t", sessionId: "s", expiresAt: "soon", claims: {} } }, fixtures: { orders: [] } }
    }), /development\.principals\.ghost/);
  });

  it("validates the trusted handler registry against the channels", () => {
    const app = new OrderApp();
    const handlers = app.handlers();
    const development = { principals: {}, fixtures: { orders: [] } };
    assert.throws(() => createGateway({
      config: orderConfig(), mode: "development", development, logger: silentLogger,
      handlers: { ...handlers, channels: {} } as never
    }), /handlers\.channels\.orderStatus is missing/);
    assert.throws(() => createGateway({
      config: orderConfig(), mode: "development", development, logger: silentLogger,
      handlers: { ...handlers, channels: { ...handlers.channels, extra: handlers.channels.orderStatus } } as never
    }), /does not match a configured channel/);
    assert.throws(() => createGateway({
      config: orderConfig(), mode: "development", development, logger: silentLogger,
      handlers: { channels: handlers.channels } as never
    }), /authenticate must be a function/);
  });

  it("fails startup when referenced secrets are missing, without leaking values", async () => {
    const config = kafkaConfig({});
    const withSasl: ProjectConfig<TestChannels> = {
      ...config,
      connections: {
        cluster: {
          brokers: ["localhost:9093"], tls: {},
          sasl: { mechanism: "scram-sha-256", username: { env: "SO_TEST_MISSING_USER" }, password: { env: "SO_TEST_MISSING_PASSWORD" } }
        }
      }
    };
    const gateway = createGateway({ config: withSasl, handlers: new OrderApp().handlers(), mode: "production", logger: silentLogger });
    await assert.rejects(gateway.start(), (error: { code: string; message: string }) =>
      error.code === "CONFIG_INVALID" && error.message.includes("SO_TEST_MISSING_USER, SO_TEST_MISSING_PASSWORD"));
    const withCa = { ...config, connections: { cluster: { brokers: ["localhost:9093"], tls: { caFile: "missing-ca.pem" } } } };
    const second = createGateway({ config: withCa, handlers: new OrderApp().handlers(), mode: "production", logger: silentLogger, configDir: "/nonexistent" });
    await assert.rejects(second.start(), /CA file missing-ca\.pem could not be read/);
  });

  it("rolls back and reports when the listener port is in use", async () => {
    const app = new OrderApp();
    const development = { principals: {}, fixtures: { orders: [] } };
    const first = createGateway({ config: orderConfig(), handlers: app.handlers(), mode: "development", development, logger: silentLogger });
    const { origin } = await first.start();
    const port = Number(new URL(origin).port);
    const config = { ...orderConfig(), gateway: { ...orderConfig().gateway, port } };
    const second = createGateway({ config, handlers: app.handlers(), mode: "development", development, logger: silentLogger });
    await assert.rejects(second.start(), new RegExp(`Port ${port} is already in use`));
    await first.stop();
  });
});
