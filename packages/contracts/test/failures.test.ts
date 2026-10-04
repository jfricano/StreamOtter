import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  policyFor, QUARANTINE_ELIGIBLE_CLASSES, resolveSourcePolicy, TransientMappingError, validateProjectConfig,
  type ConfigIssue, type FailureHandlingConfig
} from "@streamotter/contracts";

/** A project with one Kafka source and one fixture source, so topic overlap and fixture rules can be checked. */
function config(failureHandling: unknown): Record<string, unknown> {
  return {
    configVersion: 1,
    projectId: "orders-app",
    gateway: { host: "127.0.0.1", port: 7400, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:3000"] },
    connections: { main: { brokers: ["localhost:9092"], tls: false } },
    sources: {
      orders: { kind: "kafka", generation: "g1", connectionRef: "main", topics: ["orders.v1"], consumerGroup: "orders-gw", codec: "json", startFrom: "earliest" },
      demo: { kind: "fixture", generation: "f1", fixtureRef: "demo" }
    },
    schemas: {
      P: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 64 } } },
      D: { type: "object", additionalProperties: false, required: [], properties: {} }
    },
    channels: {
      order: { version: 1, source: "orders", paramsSchema: "P", payloadSchema: "D", handlersRef: "order", delivery: { kind: "state", overflow: "resync" } }
    },
    failureHandling
  };
}

function issues(failureHandling: unknown): ConfigIssue[] {
  return validateProjectConfig(config(failureHandling)).issues;
}

function codes(failureHandling: unknown): string[] {
  return issues(failureHandling).map(issue => `${issue.code} ${issue.path}`);
}

const quarantine = { topic: "orders.quarantine", capture: "full-record" };

describe("failureHandling validation (F02)", () => {
  it("accepts a configuration without failureHandling, and an empty sources map", () => {
    const legacy = config(undefined);
    delete legacy["failureHandling"];
    assert.deepEqual(validateProjectConfig(legacy).issues, []);
    assert.deepEqual(issues({ sources: {} }), []);
  });

  it("accepts every documented policy shape", () => {
    assert.deepEqual(issues({
      quarantine,
      sources: {
        orders: {
          invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-hold", transientMapperRetries: 2, replaySafeMapping: true,
          automaticAdvanceLimit: { incidents: 5, windowMs: 60_000 }, boundaryRetirement: "application"
        },
        demo: { invalidJson: "quarantine-hold" }
      }
    }), []);
  });

  it("rejects skip-like actions with a message that names the rule", () => {
    for (const action of ["ignore", "discard", "skip", "force-skip", "drop"]) {
      const found = issues({ quarantine, sources: { orders: { invalidJson: action } } });
      assert.equal(found.length, 1, action);
      assert.equal(found[0]?.path, "/failureHandling/sources/orders/invalidJson");
      assert.match(found[0]?.message ?? "", /never skips a record silently/);
    }
    assert.deepEqual(codes({ sources: { orders: { invalidJson: "retry" } } }), ["INVALID_VALUE /failureHandling/sources/orders/invalidJson"]);
  });

  it("rejects catch-all and integrity-class policies as unknown keys", () => {
    assert.deepEqual(codes({ sources: { orders: { all: "quarantine-hold", revisionConflict: "quarantine-resync", invalidTenant: "quarantine-hold" } } }), [
      "UNKNOWN_KEY /failureHandling/sources/orders/all",
      "UNKNOWN_KEY /failureHandling/sources/orders/revisionConflict",
      "UNKNOWN_KEY /failureHandling/sources/orders/invalidTenant"
    ]);
  });

  it("rejects unknown sources and unknown top-level keys", () => {
    assert.deepEqual(codes({ sources: { payments: {} }, stateDirectory: "/var/lib/x" }), [
      "UNKNOWN_KEY /failureHandling/stateDirectory",
      "UNKNOWN_REFERENCE /failureHandling/sources/payments"
    ]);
  });

  it("requires a quarantine topic for a Kafka source using a quarantine policy, but not for a fixture source", () => {
    assert.deepEqual(codes({ sources: { orders: { invalidJson: "quarantine-hold" } } }), ["REQUIRED /failureHandling/quarantine"]);
    assert.deepEqual(codes({ sources: { demo: { invalidJson: "quarantine-hold" } } }), []);
  });

  it("rejects a quarantine topic that is also an ingestion topic", () => {
    const found = issues({ quarantine: { topic: "orders.v1", capture: "full-record" }, sources: {} });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.path, "/failureHandling/quarantine/topic");
    assert.match(found[0]?.message ?? "", /must not be an ingestion topic/);
  });

  it("requires full-record capture and a valid topic name", () => {
    assert.deepEqual(codes({ quarantine: { topic: "bad topic!", capture: "metadata-only" }, sources: {} }), [
      "INVALID_VALUE /failureHandling/quarantine/topic",
      "INVALID_VALUE /failureHandling/quarantine/capture"
    ]);
    assert.deepEqual(codes({ quarantine: {}, sources: {} }), [
      "REQUIRED /failureHandling/quarantine/topic",
      "REQUIRED /failureHandling/quarantine/capture"
    ]);
  });

  it("requires replaySafeMapping for transient retries and bounds the retry count", () => {
    assert.deepEqual(codes({ sources: { orders: { transientMapperRetries: 1 } } }), ["INVALID_VALUE /failureHandling/sources/orders/transientMapperRetries"]);
    assert.deepEqual(codes({ sources: { orders: { transientMapperRetries: 3, replaySafeMapping: true } } }), ["INVALID_VALUE /failureHandling/sources/orders/transientMapperRetries"]);
    assert.deepEqual(codes({ sources: { orders: { transientMapperRetries: 2, replaySafeMapping: "yes" } } }), [
      "INVALID_TYPE /failureHandling/sources/orders/replaySafeMapping",
      "INVALID_VALUE /failureHandling/sources/orders/transientMapperRetries"
    ]);
  });

  it("accepts the circuit and retirement settings only with quarantine-resync, within bounds", () => {
    assert.deepEqual(codes({ quarantine, sources: { orders: { invalidJson: "quarantine-hold", boundaryRetirement: "operator" } } }), [
      "INVALID_VALUE /failureHandling/sources/orders/boundaryRetirement"
    ]);
    assert.deepEqual(codes({ quarantine, sources: { orders: { invalidJson: "quarantine-resync", automaticAdvanceLimit: { incidents: 0, windowMs: 10 } } } }), [
      "INVALID_VALUE /failureHandling/sources/orders/automaticAdvanceLimit/incidents",
      "INVALID_VALUE /failureHandling/sources/orders/automaticAdvanceLimit/windowMs"
    ]);
    assert.deepEqual(codes({ quarantine, sources: { orders: { invalidJson: "quarantine-resync", boundaryRetirement: "never" } } }), [
      "INVALID_VALUE /failureHandling/sources/orders/boundaryRetirement"
    ]);
  });
});

describe("policy resolution", () => {
  const handling: FailureHandlingConfig = { quarantine: { topic: "q", capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-resync" } } };

  it("defaults every unspecified setting to V1 behavior", () => {
    assert.deepEqual(resolveSourcePolicy(undefined, "orders"), {
      invalidJson: "pause", invalidPublicPayload: "pause", transientMapperRetries: 0, replaySafeMapping: false,
      automaticAdvanceLimit: { incidents: 5, windowMs: 60_000 }, boundaryRetirement: "generation"
    });
    assert.equal(resolveSourcePolicy(handling, "orders").invalidJson, "quarantine-resync");
    assert.equal(resolveSourcePolicy(handling, "toString").invalidJson, "pause");
  });

  it("applies quarantine policies only to the two eligible classes", () => {
    const policy = { ...resolveSourcePolicy(handling, "orders"), invalidPublicPayload: "quarantine-hold" as const };
    assert.deepEqual([...QUARANTINE_ELIGIBLE_CLASSES], ["invalid-json", "payload-schema"]);
    assert.equal(policyFor(policy, "invalid-json"), "quarantine-resync");
    assert.equal(policyFor(policy, "payload-schema"), "quarantine-hold");
    for (const integrity of ["routing-invalid", "revision-conflict", "mapper-error", "mapper-timeout", "mapper-transient", "tombstone", "oversize"] as const) {
      assert.equal(policyFor(policy, integrity), "pause", integrity);
    }
  });
});

describe("TransientMappingError", () => {
  it("is recognized by brand across copies, not by name", () => {
    const error = new TransientMappingError("pricing unavailable", { cause: new Error("ECONNRESET") });
    assert.equal(TransientMappingError.is(error), true);
    assert.equal(error.name, "TransientMappingError");
    const lookalike = Object.assign(new Error("x"), { name: "TransientMappingError" });
    assert.equal(TransientMappingError.is(lookalike), false);
    assert.equal(TransientMappingError.is(JSON.parse(JSON.stringify({ name: "TransientMappingError" }))), false);
    const foreign = new Error("other copy");
    Object.defineProperty(foreign, Symbol.for("streamotter.TransientMappingError"), { value: true });
    assert.equal(TransientMappingError.is(foreign), true);
  });
});
