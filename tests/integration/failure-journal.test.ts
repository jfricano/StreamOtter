import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { createGateway, silentLogger, type FailureHandlingConfig, type FixtureRecord } from "@streamotter/gateway";
import { getGatewayInternals, initJournal, nodeSupportsJournal, type IncidentStore } from "@streamotter/gateway/internals";
import { orderConfig, OrderApp } from "./harness.ts";

/**
 * V1.1 slice B with the durable journal: incidents survive a restart under the
 * same identity, startup refuses a missing journal or a second owner, and
 * `streamotter init --failures` is the only way a journal is created.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/cli/src/main.ts");
const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold" } } };
const SOURCES = [{ sourceId: "orders", generation: "fixture-1", kind: "fixture" as const }];
const skip = nodeSupportsJournal() ? false : "the journal needs Node 24.15 or newer";

function gatewayAt(stateDirectory: string, fixtures: FixtureRecord[]) {
  return createGateway({
    config: { ...orderConfig(), failureHandling: HOLD },
    handlers: new OrderApp().handlers(),
    mode: "development",
    stateDirectory,
    logger: silentLogger,
    development: { principals: {}, fixtures: { orders: fixtures } }
  });
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, ["--conditions=streamotter-source", "--no-warnings", CLI, ...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => done({ code: code ?? -1, stdout, stderr }));
  });
}

describe("V1.1 slice B: the durable failure journal", { skip }, () => {
  it("F15 (fixture): an incident and its evidence survive a restart under the same identity, quarantined once", async () => {
    const state = await mkdtemp(join(tmpdir(), "so-journal-"));
    initJournal(state, "order-dashboard", SOURCES);
    const fixtures: FixtureRecord[] = [{ key: "ord_1", raw: "{not json" }];

    const first = gatewayAt(state, fixtures);
    await first.start();
    let internals = getGatewayInternals(first);
    assert.equal(await internals.advanceFixture("orders", 1), 0);
    await internals.failuresSettled();
    const [before] = (internals.incidentStore() as IncidentStore).list({}).items;
    assert.equal(before?.quarantine, "acknowledged");
    await first.stop();

    const second = gatewayAt(state, fixtures);
    await second.start();
    internals = getGatewayInternals(second);
    try {
      assert.equal(await internals.advanceFixture("orders", 1), 0);
      await internals.failuresSettled();
      const store = internals.incidentStore() as IncidentStore;
      const items = store.list({ state: "all" }).items;
      assert.equal(items.length, 1, "the repeat is the same incident, not a new one");
      assert.equal(items[0]?.failureId, before?.failureId);
      assert.equal(items[0]?.observations, 2);
      assert.equal(store.events(before?.failureId as string).filter(event => event.event === "quarantined").length, 1);
      assert.equal(Buffer.from(store.getEvidence(before?.failureId as string)?.value as Uint8Array).toString(), "{not json");
    } finally {
      await second.stop();
    }
  });

  it("F29: startup refuses a missing journal and never creates one", async () => {
    const state = await mkdtemp(join(tmpdir(), "so-journal-"));
    const gateway = gatewayAt(state, []);
    await assert.rejects(gateway.start(), (error: Error) => {
      assert.match(error.message, /streamotter init --failures/);
      return true;
    });
    await assert.rejects(stat(join(state, "journal.sqlite")), { code: "ENOENT" });
    await gateway.stop();
  });

  it("F30: a second gateway cannot open a journal another gateway holds", async () => {
    const state = await mkdtemp(join(tmpdir(), "so-journal-"));
    initJournal(state, "order-dashboard", SOURCES);
    const owner = gatewayAt(state, []);
    await owner.start();
    const intruder = gatewayAt(state, []);
    try {
      await assert.rejects(intruder.start(), (error: { code: string; details?: { reason?: string } }) => {
        assert.equal(error.code, "SOURCE_UNAVAILABLE");
        return true;
      });
    } finally {
      await intruder.stop();
      await owner.stop();
    }
    const after = gatewayAt(state, []);
    await after.start();
    await after.stop();
  });

  it("streamotter init --failures creates the journal once and refuses to overwrite it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "so-journal-cli-"));
    const configPath = join(dir, "streamotter.json");
    await writeFile(configPath, JSON.stringify({ ...orderConfig(), failureHandling: HOLD }));
    const state = join(dir, "state");
    const created = await runCli(["init", "--failures", "--config", configPath, "--state-dir", state]);
    assert.equal(created.code, 0, created.stderr);
    assert.match(created.stdout, /Created the failure journal/);
    assert.ok((await stat(join(state, "journal.sqlite"))).isFile());
    const header = (await readFile(join(state, "journal.sqlite"))).subarray(0, 16).toString("latin1");
    assert.equal(header, "SQLite format 3\u0000");
    const again = await runCli(["init", "--failures", "--config", configPath, "--state-dir", state]);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /never overwritten/);
    const missing = await runCli(["init", "--failures", "--config", configPath]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--state-dir/);
  });
});
