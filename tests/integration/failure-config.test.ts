import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChannelMap, FailureHandlingConfig, HandlerRegistry, ProjectConfig, SourceRecoveryHandlers } from "@streamotter/contracts";
import { createGateway, silentLogger } from "@streamotter/gateway";
import { failureHandlingIssues } from "@streamotter/gateway/internals";
import { OrderApp, orderConfig } from "./harness.ts";

const ALL = { policies: ["pause", "quarantine-hold", "quarantine-resync"] as const, transientRetries: true };
const guard: SourceRecoveryHandlers = { recover: () => ({ decision: "hold", reason: "not yet" }) };

function setup(failureHandling: FailureHandlingConfig | undefined, sources?: Record<string, unknown>): { config: ProjectConfig; handlers: HandlerRegistry<ChannelMap> } {
  const config = { ...orderConfig(), ...(failureHandling === undefined ? {} : { failureHandling }) } as ProjectConfig;
  const handlers = { ...new OrderApp().handlers(), ...(sources === undefined ? {} : { sources }) } as unknown as HandlerRegistry<ChannelMap>;
  return { config, handlers };
}

describe("V1.1 slice A: failure handling checks at gateway construction", () => {
  it("accepts legacy configurations and explicit pause policies unchanged", () => {
    for (const failureHandling of [undefined, { sources: {} }, { sources: { orders: { invalidJson: "pause" as const } } }]) {
      const { config, handlers } = setup(failureHandling);
      assert.deepEqual(failureHandlingIssues(config, handlers), []);
      assert.doesNotThrow(() => createGateway({ config, handlers, mode: "development", development: { principals: {}, fixtures: { orders: [] } }, logger: silentLogger }));
    }
  });

  it("refuses a policy this build cannot carry out instead of treating it as pause", () => {
    const { config, handlers } = setup({ sources: { orders: { invalidJson: "quarantine-hold", transientMapperRetries: 1, replaySafeMapping: true } } });
    assert.throws(
      () => createGateway({ config, handlers, mode: "development", development: { principals: {}, fixtures: { orders: [] } }, logger: silentLogger }),
      (error: { code: string; details: { issues: string[] } }) => {
        assert.equal(error.code, "CONFIG_INVALID");
        assert.deepEqual(error.details.issues, [
          "failureHandling.sources.orders.invalidJson is \"quarantine-hold\", which this gateway build does not support yet",
          "failureHandling.sources.orders.transientMapperRetries is not supported by this gateway build yet"
        ]);
        return true;
      }
    );
  });

  it("requires a recovery guard for quarantine-resync (F02 missing guard)", () => {
    const { config, handlers } = setup({ sources: { orders: { invalidJson: "quarantine-resync" } } });
    assert.deepEqual(failureHandlingIssues(config, handlers, ALL), [
      "source orders uses quarantine-resync, which requires a recovery guard at handlers.sources.orders.recover"
    ]);
    const withGuard = setup({ sources: { orders: { invalidJson: "quarantine-resync" } } }, { orders: guard });
    assert.deepEqual(failureHandlingIssues(withGuard.config, withGuard.handlers, ALL), []);
  });

  it("rejects guards for unknown or non-resync sources and malformed guards", () => {
    const unknown = setup({ sources: {} }, { payments: guard });
    assert.deepEqual(failureHandlingIssues(unknown.config, unknown.handlers, ALL), ["handlers.sources.payments does not match a configured source"]);
    const holdOnly = setup({ sources: { orders: { invalidJson: "quarantine-hold" } } }, { orders: guard });
    assert.deepEqual(failureHandlingIssues(holdOnly.config, holdOnly.handlers, ALL), [
      "handlers.sources.orders is only used by a source whose failure policy is quarantine-resync"
    ]);
    const malformed = setup({ sources: { orders: { invalidPublicPayload: "quarantine-resync" } } }, { orders: { recover: "yes" } });
    assert.deepEqual(failureHandlingIssues(malformed.config, malformed.handlers, ALL), ["handlers.sources.orders.recover must be a function"]);
  });

  it("matches retire() to the application retirement mode", () => {
    const missing = setup({ sources: { orders: { invalidJson: "quarantine-resync", boundaryRetirement: "application" } } }, { orders: guard });
    assert.deepEqual(failureHandlingIssues(missing.config, missing.handlers, ALL), [
      "handlers.sources.orders.retire must be a function because boundaryRetirement is \"application\""
    ]);
    const unused = setup({ sources: { orders: { invalidJson: "quarantine-resync" } } }, { orders: { ...guard, retire: () => true } });
    assert.deepEqual(failureHandlingIssues(unused.config, unused.handlers, ALL), [
      "handlers.sources.orders.retire is only used when boundaryRetirement is \"application\""
    ]);
  });
});
