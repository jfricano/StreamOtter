import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HealthReason } from "@streamotter/contracts";
import { healthBody, startHealthListener } from "../src/runtime/health.ts";

describe("health listener unit (ADR-15C §4)", () => {
  it("orders and de-duplicates reasons; none means ok", () => {
    assert.deepEqual(healthBody([]), { status: "ok", reasons: [] });
    assert.deepEqual(healthBody(["quarantine", "source-held", "quarantine", "starting"]), { status: "unavailable", reasons: ["starting", "source-held", "quarantine"] });
  });

  it("reports starting from the readiness callback, survives a throwing callback, and closes idempotently", async () => {
    let reasons: HealthReason[] = ["starting"];
    let throwing = false;
    const listener = await startHealthListener({ host: "127.0.0.1", port: 0, readiness: () => { if (throwing) throw new Error("boom"); return reasons; } });
    try {
      let response = await fetch(`${listener.origin}/health/ready`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "unavailable", reasons: ["starting"] });
      response = await fetch(`${listener.origin}/health/live`);
      assert.equal(response.status, 200, "liveness does not depend on readiness");
      reasons = ["source-unavailable"];
      assert.deepEqual(await (await fetch(`${listener.origin}/health/ready`)).json(), { status: "unavailable", reasons: ["source-unavailable"] });
      throwing = true;
      response = await fetch(`${listener.origin}/health/ready`);
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), /boom/);
    } finally {
      await Promise.all([listener.close(), listener.close()]);
    }
    await assert.rejects(fetch(`${listener.origin}/health/live`));
  });
});
