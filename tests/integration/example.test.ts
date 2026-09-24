import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { generateFiles } from "@streamotter/cli";
import type { ProjectConfig } from "@streamotter/contracts";
import { runScenarios } from "../../examples/order-dashboard/scripts/scenarios.ts";

describe("order-dashboard reference example", () => {
  it("demonstrates the snapshot race, disconnect/resynchronization, and rejected access", async () => {
    const results = await runScenarios();
    for (const result of results) assert.ok(result.passed, `${result.name}: ${result.detail}`);
    assert.equal(results.length, 3);
  });

  it("keeps its committed generated contract in sync with streamotter.json", async () => {
    const root = new URL("../../examples/order-dashboard/", import.meta.url);
    const config = JSON.parse(await readFile(new URL("streamotter.json", root), "utf8")) as ProjectConfig;
    for (const file of generateFiles(config)) {
      assert.equal(await readFile(new URL(`src/generated/${file.path}`, root), "utf8"), file.content, `${file.path} is stale; rerun streamotter generate`);
    }
  });
});
