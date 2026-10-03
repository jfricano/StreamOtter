import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import type { FailureHandlingConfig, IncidentSummary, OperatorStatus, Page } from "@streamotter/contracts";
import { initJournal, nodeSupportsJournal } from "@streamotter/gateway/internals";
import { callOperator } from "@streamotter/gateway/operator";
import { startHarness, type Harness } from "./harness.ts";

/**
 * The operator socket served by a real gateway (API §10): it starts with the
 * gateway when operatorSocket is true, the CLI reaches it, and stop removes it.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/cli/src/main.ts");
const HOLD: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };

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

const temporary: string[] = [];
function stateDirectory(): string {
  const state = mkdtempSync(join(tmpdir(), "so-sock-"));
  temporary.push(state);
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "fixture-1", kind: "fixture" }]);
  return state;
}

const skip = process.platform === "win32" ? "Unix-domain sockets only" : !nodeSupportsJournal() && "the journal needs Node 24.15 or newer";

describe("operator socket on a running gateway (API §10)", { skip }, () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });
  after(() => { for (const path of temporary) rmSync(path, { recursive: true, force: true }); });

  it("serves the CLI while running and removes the socket and token on stop", async () => {
    const state = stateDirectory();
    h = await startHarness({ stateDirectory: state, operatorSocket: true, failureHandling: HOLD, fixtures: [{ key: "ord_1", raw: "{not json" }] });
    await h.advance(1);
    await h.internals.failuresSettled();
    const socket = join(state, "run", "operator.sock");
    assert.ok(existsSync(socket), "socket exists while running");

    const status = await callOperator(state, "status", {}) as OperatorStatus;
    assert.equal(status.sources[0]?.sourceId, "orders");

    const list = await runCli(["failures", "list", "--state-dir", state, "--json"]);
    assert.equal(list.code, 0, list.stderr);
    const page = JSON.parse(list.stdout) as Page<IncidentSummary>;
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.failureClass, "invalid-json");

    const human = await runCli(["status", "--state-dir", state]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /orders/);

    await h.close();
    h = undefined;
    assert.equal(existsSync(socket), false, "socket removed on stop");
    assert.equal(existsSync(join(state, "run", "operator.token")), false, "token removed on stop");
    const stopped = await runCli(["status", "--state-dir", state]);
    assert.notEqual(stopped.code, 0);
    assert.match(stopped.stderr, /^UNSUPPORTED_CAPABILITY: No gateway is serving the operator socket/);
  });

  it("is not started unless operatorSocket is true", async () => {
    const state = stateDirectory();
    h = await startHarness({ stateDirectory: state, failureHandling: HOLD });
    assert.equal(existsSync(join(state, "run", "operator.sock")), false);
  });
});
