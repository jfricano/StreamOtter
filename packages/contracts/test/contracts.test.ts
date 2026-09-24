import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalJson, canonicalizeParams, compareRevisions, isRevision, isUuid, StreamOtterError,
  streamError, utf8ByteLength, validateProjectConfig, validateSchemaDefinition, validateValue,
  type ConfigIssue, type Schema
} from "@streamotter/contracts";

const orderParams: Schema = {
  type: "object", additionalProperties: false, required: ["orderId"],
  properties: { orderId: { type: "string", minLength: 1, maxLength: 128 } }
};

function baseConfig(): Record<string, unknown> {
  return {
    configVersion: 1,
    projectId: "order-dashboard",
    gateway: { host: "127.0.0.1", port: 7400, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:3000"] },
    connections: {},
    sources: { orders: { kind: "fixture", generation: "fixture-1", fixtureRef: "orders" } },
    schemas: {
      OrderParams: orderParams,
      OrderState: {
        type: "object", additionalProperties: false, required: ["orderId", "status", "progress"],
        properties: {
          orderId: { type: "string", minLength: 1, maxLength: 128 },
          status: { type: "string", enum: ["queued", "processing", "done"] },
          progress: { type: "integer", minimum: 0, maximum: 100 }
        }
      }
    },
    channels: {
      orderStatus: {
        version: 1, source: "orders", paramsSchema: "OrderParams", payloadSchema: "OrderState",
        handlersRef: "orderStatus", delivery: { kind: "state", overflow: "resync" }
      }
    }
  };
}

function codes(issues: readonly ConfigIssue[]): string[] {
  return issues.map(issue => `${issue.code} ${issue.path}`);
}

describe("revisions", () => {
  it("accepts only canonical unsigned decimals up to 39 digits", () => {
    for (const valid of ["0", "1", "10", "9".repeat(39)]) assert.equal(isRevision(valid), true, valid);
    for (const invalid of ["", "01", "-1", "1.0", " 1", "1e3", "9".repeat(40), 1, null]) {
      assert.equal(isRevision(invalid), false, String(invalid));
    }
  });

  it("compares numerically beyond Number precision", () => {
    assert.equal(compareRevisions("9", "10"), -1);
    assert.equal(compareRevisions("10", "9"), 1);
    assert.equal(compareRevisions("123", "123"), 0);
    assert.equal(compareRevisions("9007199254740993", "9007199254740992"), 1);
    assert.equal(compareRevisions("0", "0"), 0);
  });
});

describe("canonical JSON", () => {
  it("sorts keys, normalizes -0, and rejects non-JSON", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: -0, c: [2, 1] } }), '{"a":{"c":[2,1],"d":0},"b":1}');
    assert.throws(() => canonicalJson({ a: Number.NaN }));
    assert.throws(() => canonicalJson({ a: () => 1 }));
    assert.throws(() => canonicalJson(new Date()));
  });

  it("keeps __proto__ as an ordinary key", () => {
    const value = JSON.parse('{"__proto__":{"x":1},"a":1}') as unknown;
    assert.equal(canonicalJson(value), '{"__proto__":{"x":1},"a":1}');
  });

  it("counts UTF-8 bytes", () => {
    assert.equal(utf8ByteLength("abc"), 3);
    assert.equal(utf8ByteLength("é"), 2);
    assert.equal(utf8ByteLength("€"), 3);
    assert.equal(utf8ByteLength("🦦"), 4);
    assert.equal(utf8ByteLength("🦦"), Buffer.byteLength("🦦"));
  });
});

describe("schemas", () => {
  it("rejects unsupported keywords instead of ignoring them", () => {
    const issues: ConfigIssue[] = [];
    validateSchemaDefinition({ type: "string", pattern: "^a" }, "/schemas/X", issues);
    validateSchemaDefinition({ oneOf: [] }, "/schemas/Y", issues);
    validateSchemaDefinition({ type: "object", properties: {}, required: [] }, "/schemas/Z", issues);
    validateSchemaDefinition({ type: "array", items: { type: "string" } }, "/schemas/W", issues);
    validateSchemaDefinition({ $ref: "#/x", type: "string" }, "/schemas/V", issues);
    assert.deepEqual(codes(issues), [
      "SCHEMA_UNSUPPORTED_KEYWORD /schemas/X/pattern",
      "SCHEMA_UNSUPPORTED_TYPE /schemas/Y/type",
      "REQUIRED /schemas/Z/additionalProperties",
      "REQUIRED /schemas/W/maxItems",
      "SCHEMA_UNSUPPORTED_KEYWORD /schemas/V/$ref"
    ]);
  });

  it("limits nesting depth to 16", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 16; i++) schema = { type: "array", items: schema, maxItems: 1 };
    const issues: ConfigIssue[] = [];
    validateSchemaDefinition(schema, "", issues);
    assert.equal(issues[0]?.code, "SCHEMA_DEPTH_EXCEEDED");
  });

  it("validates values with strings measured in code points", () => {
    const schema: Schema = { type: "string", minLength: 1, maxLength: 2 };
    assert.equal(validateValue(schema, "🦦🦦"), null);
    assert.notEqual(validateValue(schema, "🦦🦦🦦"), null);
    assert.notEqual(validateValue(schema, ""), null);
  });

  it("validates integers, bounds, arrays, and closed objects", () => {
    assert.equal(validateValue({ type: "integer", minimum: 0, maximum: 100 }, 5), null);
    assert.notEqual(validateValue({ type: "integer" }, 1.5), null);
    assert.notEqual(validateValue({ type: "integer" }, 2 ** 53), null);
    assert.notEqual(validateValue({ type: "number" }, Number.POSITIVE_INFINITY), null);
    assert.notEqual(validateValue({ type: "array", items: { type: "null" }, maxItems: 1 }, [null, null]), null);
    const object: Schema = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "boolean" }, b: { type: "null" } } };
    assert.equal(validateValue(object, { a: true }), null);
    assert.equal(validateValue(object, { a: true, b: null }), null);
    assert.equal(validateValue(object, { a: true, c: 1 })?.path, "$.c");
    assert.equal(validateValue(object, {})?.path, "$.a");
  });

  it("canonicalizes parameters without normalizing case or Unicode", () => {
    const schema: Schema = {
      type: "object", additionalProperties: false, required: ["z", "a", "n"],
      properties: { z: { type: "string" }, a: { type: "boolean" }, n: { type: "integer" } }
    };
    const result = canonicalizeParams(schema, { z: "Ä", a: true, n: -0 });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.canonical, '{"a":true,"n":0,"z":"Ä"}');
    const decomposed = canonicalizeParams(schema, { z: "Ä", a: true, n: 0 });
    assert.equal(decomposed.ok && decomposed.canonical, '{"a":true,"n":0,"z":"Ä"}');
    assert.notEqual(decomposed.ok && decomposed.canonical, result.ok && result.canonical);
    const upper = canonicalizeParams(schema, { z: "a", a: true, n: 0 });
    const lower = canonicalizeParams(schema, { z: "A", a: true, n: 0 });
    assert.notEqual(upper.ok && upper.canonical, lower.ok && lower.canonical);
    assert.equal(canonicalizeParams(schema, { z: "x", a: true }).ok, false);
  });
});

describe("project configuration", () => {
  it("accepts the reference fixture configuration", () => {
    assert.deepEqual(validateProjectConfig(baseConfig()), { valid: true, issues: [] });
  });

  it("accepts the contract example's Kafka/SASL configuration", () => {
    const config = baseConfig();
    config["connections"] = {
      ordersCluster: {
        brokers: ["kafka.example.internal:9093"], tls: {},
        sasl: { mechanism: "scram-sha-256", username: { env: "ORDERS_KAFKA_USERNAME" }, password: { env: "ORDERS_KAFKA_PASSWORD" } }
      }
    };
    config["sources"] = {
      orders: {
        kind: "kafka", generation: "orders-stream-1", connectionRef: "ordersCluster", topics: ["orders.status"],
        consumerGroup: "streamotter-order-dashboard", codec: "json", startFrom: "latest"
      }
    };
    assert.deepEqual(validateProjectConfig(config).issues, []);
  });

  it("rejects unknown keys and deferred V2/V3 features clearly", () => {
    const config = baseConfig();
    const channels = config["channels"] as Record<string, Record<string, unknown>>;
    const channel = channels["orderStatus"] as Record<string, unknown>;
    channel["delivery"] = { kind: "events", overflow: "resync", history: { storeRef: "x" } };
    channel["recovery"] = { cursor: true };
    config["commands"] = {};
    config["unexpected"] = true;
    const { valid, issues } = validateProjectConfig(config);
    assert.equal(valid, false);
    assert.deepEqual(codes(issues).sort(), [
      "UNKNOWN_KEY /unexpected",
      "UNSUPPORTED_FEATURE /channels/orderStatus/delivery/history",
      "UNSUPPORTED_FEATURE /channels/orderStatus/delivery/kind",
      "UNSUPPORTED_FEATURE /channels/orderStatus/recovery",
      "UNSUPPORTED_FEATURE /commands"
    ]);
    assert.match(issues.find(issue => issue.path.endsWith("delivery/kind"))?.message ?? "", /V2/);
  });

  it("rejects bad identifiers, references, handler refs, and parameter schemas", () => {
    const config = baseConfig();
    config["projectId"] = "1bad";
    const schemas = config["schemas"] as Record<string, unknown>;
    schemas["OrderParams"] = {
      type: "object", additionalProperties: false, required: ["orderId"],
      properties: { orderId: { type: "string" }, tags: { type: "array", items: { type: "string" }, maxItems: 2 } }
    };
    const channels = config["channels"] as Record<string, Record<string, unknown>>;
    const channel = channels["orderStatus"] as Record<string, unknown>;
    channel["handlersRef"] = "other";
    channel["source"] = "orders.status";
    channel["payloadSchema"] = "Missing";
    const { issues } = validateProjectConfig(config);
    assert.deepEqual(codes(issues).sort(), [
      "HANDLERS_REF_MISMATCH /channels/orderStatus/handlersRef",
      "INVALID_IDENTIFIER /projectId",
      "INVALID_PARAMS_SCHEMA /schemas/OrderParams/properties/tags",
      "INVALID_PARAMS_SCHEMA /schemas/OrderParams/properties/tags",
      "UNKNOWN_REFERENCE /channels/orderStatus/payloadSchema",
      "UNKNOWN_REFERENCE /channels/orderStatus/source"
    ]);
  });

  it("rejects wildcard origins, shared consumer groups, and multiple profiles", () => {
    const config = baseConfig();
    (config["gateway"] as Record<string, unknown>)["allowedOrigins"] = ["*", "http://localhost:3000/"];
    config["connections"] = {
      a: { brokers: ["localhost:9092"], tls: false },
      b: { brokers: ["localhost:9093"], tls: false }
    };
    const kafka = { kind: "kafka", generation: "g1", topics: ["t"], codec: "json", startFrom: "earliest" };
    config["sources"] = {
      one: { ...kafka, connectionRef: "a", consumerGroup: "group" },
      two: { ...kafka, connectionRef: "b", consumerGroup: "group" }
    };
    (config["channels"] as Record<string, Record<string, unknown>>)["orderStatus"]!["source"] = "one";
    const { issues } = validateProjectConfig(config);
    assert.deepEqual(codes(issues).sort(), [
      "CONSUMER_GROUP_CONFLICT /sources/two/consumerGroup",
      "INVALID_VALUE /gateway/allowedOrigins/0",
      "INVALID_VALUE /gateway/allowedOrigins/1",
      "MULTIPLE_CONNECTIONS /sources"
    ]);
  });

  it("rejects inconsistent and unknown limits", () => {
    const config = baseConfig();
    config["limits"] = { maxDataFrameBytes: 2_000_000, maxBogus: 1, handlerTimeoutMs: 0 };
    assert.deepEqual(codes(validateProjectConfig(config).issues).sort(), [
      "INVALID_VALUE /limits/handlerTimeoutMs",
      "UNKNOWN_KEY /limits/maxBogus"
    ]);
    config["limits"] = { maxDataFrameBytes: 2_000_000 };
    assert.deepEqual(codes(validateProjectConfig(config).issues), ["INCONSISTENT_LIMITS /limits/maxDataFrameBytes"]);
  });
});

describe("errors", () => {
  it("serializes StreamOtterError to exactly the public StreamError shape", () => {
    const error = new StreamOtterError("FORBIDDEN", { requestId: "r1" });
    assert.ok(error instanceof Error);
    assert.deepEqual(JSON.parse(JSON.stringify(error)), {
      code: "FORBIDDEN", message: "This subscription is not permitted.", retryable: false, requestId: "r1"
    });
    assert.deepEqual(streamError("TIMEOUT"), { code: "TIMEOUT", message: "The operation did not complete before its deadline.", retryable: true, requestId: "" });
  });

  it("recognizes UUIDs", () => {
    assert.equal(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), true);
    assert.equal(isUuid("not-a-uuid"), false);
  });
});
