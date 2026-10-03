import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSameOriginApiPath, isWorkbenchOperation, PRE_WHC1_NATIVE_OPERATIONS, validateWorkbenchHostConfig, WORKBENCH_OPERATIONS
} from "@streamotter/contracts";

const paths = (input: unknown): string[] => {
  const result = validateWorkbenchHostConfig(input);
  return result.ok ? [] : result.issues.map(issue => issue.path);
};

describe("workbench host contract (WHC-1) boot block", () => {
  it("accepts the documented session-mode sandbox example and the minimal block", () => {
    const example = {
      hostContract: 1,
      apiBase: "/workbench/api/v1",
      auth: { mode: "session" },
      gateway: { origin: "https://lontracreek.example", path: "/sandbox/socket.io" },
      environment: {
        kind: "sandbox",
        label: "Synthetic fixture",
        detail: "An isolated demo session. Nothing here touches a production system.",
        packageVersion: "0.1.0-rc.3"
      }
    };
    const result = validateWorkbenchHostConfig(example);
    assert.ok(result.ok);
    assert.deepEqual(result.config, example);
    assert.deepEqual(paths({ hostContract: 1 }), []);
    assert.deepEqual(paths({ hostContract: 1, auth: { mode: "token" }, gateway: { origin: "http://127.0.0.1:7400" }, environment: { kind: "development" } }), []);
    assert.deepEqual(paths({ hostContract: 1, gateway: { origin: "http://[::1]:7400" } }), []);
  });

  it("requires hostContract and reports any other value as unsupported", () => {
    assert.deepEqual(paths({}), ["/hostContract"]);
    for (const value of [2, "1", 0, null]) {
      const result = validateWorkbenchHostConfig({ hostContract: value, unknown: true });
      assert.ok(!result.ok);
      assert.equal(result.issues.length, 1, "an unsupported contract is reported alone");
      assert.equal(result.issues[0]!.path, "/hostContract");
      assert.match(result.issues[0]!.message, /Unsupported host contract/);
    }
    for (const value of [null, [], "x", 1]) assert.deepEqual(paths(value), [""]);
  });

  it("refuses unknown fields at every level", () => {
    assert.deepEqual(paths({ hostContract: 1, theme: "dark" }), ["/theme"]);
    assert.deepEqual(paths({ hostContract: 1, auth: { mode: "session", token: "x" } }), ["/auth/token"]);
    assert.deepEqual(paths({ hostContract: 1, gateway: { origin: "https://a.example", tls: true } }), ["/gateway/tls"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "development", color: "red" } }), ["/environment/color"]);
  });

  it("allows only an absolute same-origin apiBase without a trailing slash", () => {
    for (const valid of ["/management/v1", "/workbench/api/v1", "/a", "/a-b/c_d/~e"]) {
      assert.equal(isSameOriginApiPath(valid), true, valid);
      assert.deepEqual(paths({ hostContract: 1, apiBase: valid }), [], valid);
    }
    for (const invalid of [
      "", "/", "/api/", "api/v1", "//evil.example/api", "https://evil.example/api", "/api//v1", "/api/../x", "/./api",
      "/api?x=1", "/api#x", "/api\\v1", "/api v1", `/${"a".repeat(300)}`, 7
    ]) {
      assert.equal(isSameOriginApiPath(invalid), false, String(invalid));
      assert.deepEqual(paths({ hostContract: 1, apiBase: invalid }), ["/apiBase"], String(invalid));
    }
  });

  it("validates auth mode, gateway origin and path", () => {
    assert.deepEqual(paths({ hostContract: 1, auth: { mode: "cookie" } }), ["/auth/mode"]);
    assert.deepEqual(paths({ hostContract: 1, auth: "session" }), ["/auth"]);
    for (const origin of ["https://a.example/", "https://a.example/path", "ftp://a.example", "a.example", "https://", ""]) {
      assert.deepEqual(paths({ hostContract: 1, gateway: { origin } }), ["/gateway/origin"], origin);
    }
    assert.deepEqual(paths({ hostContract: 1, gateway: { origin: "https://a.example", path: "socket.io" } }), ["/gateway/path"]);
  });

  it("requires a sandbox label and bounds label and detail lengths", () => {
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox" } }), ["/environment/label"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "production", label: "x" } }), ["/environment/kind"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox", label: "x".repeat(64), detail: "y".repeat(280) } }), []);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox", label: "x".repeat(65) } }), ["/environment/label"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox", label: "ok", detail: "y".repeat(281) } }), ["/environment/detail"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox", label: "🦦".repeat(64) } }), [], "lengths count characters, not UTF-16 units");
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox", label: "  " } }), ["/environment/label"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "sandbox", label: "a\u0000b" } }), ["/environment/label"]);
    assert.deepEqual(paths({ hostContract: 1, environment: { kind: "development", packageVersion: "^0.1.0" } }), ["/environment/packageVersion"]);
  });

  it("has a closed operation vocabulary without the CLI-only retire-boundary action", () => {
    assert.equal(new Set(WORKBENCH_OPERATIONS).size, WORKBENCH_OPERATIONS.length);
    assert.equal(WORKBENCH_OPERATIONS.length, 24);
    assert.ok(Object.isFrozen(WORKBENCH_OPERATIONS));
    assert.equal(isWorkbenchOperation("failures.redrive"), true);
    assert.equal(isWorkbenchOperation("sources.retire-boundary"), false);
    assert.equal(isWorkbenchOperation("toString"), false);
    for (const operation of PRE_WHC1_NATIVE_OPERATIONS) assert.ok(isWorkbenchOperation(operation));
    assert.ok(!PRE_WHC1_NATIVE_OPERATIONS.some(operation => operation.startsWith("failures.") || operation === "operator.status" || operation === "workbench"));
  });
});
