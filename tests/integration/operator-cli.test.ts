import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { runCli as runCliInProcess } from "@streamotter/cli";
import {
  StreamOtterError,
  type EvaluationResult, type IncidentDetail, type IncidentSummary, type OperationResult, type OperatorStatus, type Page, type RawEvidenceView, type ReproductionBundle
} from "@streamotter/contracts";
import { startOperatorSocket, type OperatorSocket } from "@streamotter/gateway/operator";
import { BOUNDARY_ID, FAILURE_ID, FakeOperator, HOSTILE_KEY, HOSTILE_VALUE } from "../../packages/gateway/test/fake-operator.ts";
import { orderConfig } from "./harness.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/cli/src/main.ts");
const POSIX = process.platform !== "win32";

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
  const parent = mkdtempSync(join(tmpdir(), "so-cli-"));
  temporary.push(parent);
  const state = join(parent, "state");
  mkdirSync(join(state, "run"), { recursive: true, mode: 0o700 });
  chmodSync(state, 0o700);
  chmodSync(join(state, "run"), 0o700);
  return state;
}

/** Every mutating command with the flags it needs. */
const MUTATIONS: Record<string, string[]> = {
  "sources retry-current": ["--source", "orders", "--failure", FAILURE_ID, "--expected-revision", "3", "--reason", "producer fixed"],
  "sources reassess": ["--source", "orders", "--failure", FAILURE_ID, "--expected-revision", "3"],
  "sources reopen-circuit": ["--source", "orders", "--expected-circuit-revision", "1", "--reason", "flood is over"],
  "sources retire-boundary": ["--source", "orders", "--boundary", BOUNDARY_ID, "--expected-revision", "2", "--reason", "verified the repair", "--confirm", BOUNDARY_ID],
  "failures redrive": ["--failure", FAILURE_ID, "--plan", "plan-1", "--plan-fingerprint", "sha256:plan", "--expected-revision", "3", "--operation-id", "redrive-1"]
};

/**
 * A socket at <state>/run/operator.sock that reads the request and then drops
 * the connection (`drop`) or never answers: a gateway that stopped, or hung,
 * after the request reached it.
 */
async function unansweringGateway(state: string, drop: boolean): Promise<{ received(): Promise<void>; close(): Promise<void> }> {
  writeFileSync(join(state, "run", "operator.token"), `${"t".repeat(43)}\n`, { mode: 0o600 });
  const sockets = new Set<Socket>();
  let notify: (() => void) | null = null;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("data", chunk => {
      if (!chunk.includes(0x0a)) return;
      notify?.();
      if (drop) socket.destroy();
    });
  });
  await new Promise<void>(done => server.listen(join(state, "run", "operator.sock"), done));
  return {
    received: () => new Promise<void>(done => { notify = done; }),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(done => server.close(() => done()));
    }
  };
}

/** Characters a terminal acts on; none may reach stdout or stderr from record data. */
const TERMINAL_CONTROL = new RegExp("[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f]");

describe("CLI operator commands over the local socket (API §10)", { skip: POSIX ? false : "Unix-domain sockets only" }, () => {
  const operator = new FakeOperator();
  let directory: string;
  let socket: OperatorSocket;
  const cli = (...args: string[]) => runCli([...args, "--state-dir", directory]);

  before(async () => {
    directory = stateDirectory();
    socket = await startOperatorSocket({ stateDirectory: directory, operator, logger: { info() {}, warn() {}, error() {} }, ratePerSecond: 1_000, burst: 1_000 });
  });
  after(async () => {
    await socket.close();
    for (const path of temporary) rmSync(path, { recursive: true, force: true });
  });
  beforeEach(() => {
    operator.calls.length = 0;
    operator.result = "completed";
    operator.throwing.clear();
  });

  it("status prints the gateway, journal and sources, or the data verbatim with --json", async () => {
    const human = await cli("status");
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /^Gateway\s+production 1\.1\.0, running/m);
    assert.match(human.stdout, /held at f1:orders\/0\/42 \(revision 3\)/);
    const json = await cli("status", "--json");
    assert.equal(json.code, 0, json.stderr);
    const status = JSON.parse(json.stdout) as OperatorStatus;
    assert.equal(status.sources[0]?.boundary?.boundaryId, BOUNDARY_ID);
    assert.deepEqual(operator.calledOps(), ["status", "status"]);
  });

  it("failures list sends the filters and pages with --cursor", async () => {
    const human = await cli("failures", "list", "--source", "orders", "--state", "open", "--limit", "5");
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /^FAILURE\s+SOURCE\s+CLASS/m);
    assert.match(human.stdout, /f1:orders\/0\/42\s+orders\s+invalid-json\s+open\s+held\s+3\s+repair-and-retry/);
    assert.match(human.stdout, /More: --cursor page-2/);
    assert.deepEqual(operator.calls[0]?.args, { sourceId: "orders", state: "open", limit: 5 });
    const json = await cli("failures", "list", "--cursor", "page-2", "--json");
    assert.equal((JSON.parse(json.stdout) as Page<IncidentSummary>).nextCursor, null);

    const badState = await cli("failures", "list", "--state", "everything");
    assert.equal(badState.code, 2);
    assert.match(badState.stderr, /state must be open, resolved or all/);
    assert.equal((await cli("failures", "list", "--limit", "many")).code, 2);
    assert.equal((await cli("failures", "list", "--limit", "500")).code, 2);
    assert.equal(operator.calls.length, 2);
  });

  it("F39: failures show never shows raw bytes unless --raw, and then only as base64 and hex", async () => {
    const plain = await cli("failures", "show", "--failure", FAILURE_ID);
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(plain.stdout, /^Failure\s+f1:orders\/0\/42 \(revision 3, open\)/m);
    assert.match(plain.stdout, /What failed\s+Record orders\/0\/42 is not valid JSON\./);
    assert.doesNotMatch(plain.stdout, /Raw evidence/);
    assert.doesNotMatch(plain.stdout, new RegExp(HOSTILE_VALUE.toString("base64").slice(0, 24)));
    assert.deepEqual(operator.calls[0]?.args, { failureId: FAILURE_ID });

    const shown = await cli("failures", "show", "--failure", FAILURE_ID, "--raw");
    assert.equal(shown.code, 0, shown.stderr);
    assert.deepEqual(operator.calls[1]?.args, { failureId: FAILURE_ID, includeRaw: true });
    assert.match(shown.stdout, /shown as base64 and hex only/);
    assert.ok(shown.stdout.includes(HOSTILE_VALUE.toString("base64")), "value as base64");
    assert.ok(shown.stdout.includes(HOSTILE_KEY.toString("base64")), "key as base64");
    assert.ok(shown.stdout.includes(HOSTILE_VALUE.subarray(0, 8).toString("hex").replace(/(..)(?!$)/g, "$1 ")), "hex preview");
    assert.match(shown.stdout, /header "trace\\u001b\[0m"/);
    assert.doesNotMatch(shown.stdout, TERMINAL_CONTROL);
    assert.doesNotMatch(shown.stdout, /hunter2|<script>|ignore previous instructions/);
    assert.doesNotMatch(shown.stderr, TERMINAL_CONTROL);

    const json = await cli("failures", "show", "--failure", FAILURE_ID, "--raw", "--json");
    const detail = JSON.parse(json.stdout) as IncidentDetail & { raw?: RawEvidenceView };
    assert.equal(detail.raw?.valueBase64, HOSTILE_VALUE.toString("base64"));
    assert.equal(detail.raw?.headers[0]?.name, "trace\u001b[0m");
    assert.doesNotMatch(json.stdout, TERMINAL_CONTROL);

    // The operation embedded in the record bytes was displayed, never sent.
    assert.deepEqual(operator.calledOps(), ["showFailure", "showFailure", "showFailure"]);
  });

  it("F40: failures export writes a 0600 bundle, never overwrites, and includes raw bytes only with --include-raw", async () => {
    const out = join(directory, "..", "bundle.json");
    const written = await cli("failures", "export", "--failure", FAILURE_ID, "--out", out);
    assert.equal(written.code, 0, written.stderr);
    assert.match(written.stdout, /Wrote the reproduction bundle .* \(mode 0600\)/);
    assert.match(written.stdout, /Raw evidence not included/);
    assert.equal(statSync(out).mode & 0o777, 0o600);
    const bundle = JSON.parse(readFileSync(out, "utf8")) as ReproductionBundle;
    assert.equal(bundle.bundleVersion, 1);
    assert.equal(bundle.raw, undefined);
    assert.equal(bundle.evidence.included, false);
    assert.deepEqual(operator.calls[0]?.args, { failureId: FAILURE_ID });

    const before = readFileSync(out, "utf8");
    const again = await cli("failures", "export", "--failure", FAILURE_ID, "--out", out, "--include-raw");
    assert.equal(again.code, 2);
    assert.match(again.stderr, /Refusing to overwrite/);
    assert.equal(readFileSync(out, "utf8"), before);
    assert.equal(operator.calls.length, 1, "refused before contacting the gateway");

    const withRaw = join(directory, "..", "bundle-raw.json");
    const rawExport = await cli("failures", "export", "--failure", FAILURE_ID, "--include-raw", "--out", withRaw, "--json");
    assert.equal(rawExport.code, 0, rawExport.stderr);
    assert.deepEqual(JSON.parse(rawExport.stdout), { path: withRaw, bundleVersion: 1, rawIncluded: true });
    assert.equal(statSync(withRaw).mode & 0o777, 0o600);
    const rawBundle = JSON.parse(readFileSync(withRaw, "utf8")) as ReproductionBundle;
    assert.equal(rawBundle.raw?.valueBase64, HOSTILE_VALUE.toString("base64"));
    assert.equal(rawBundle.evidence.included, true);

    const stdout = await cli("failures", "export", "--failure", FAILURE_ID);
    assert.equal(stdout.code, 0, stdout.stderr);
    const printed = JSON.parse(stdout.stdout) as ReproductionBundle;
    assert.equal(printed.raw, undefined);
    assert.doesNotMatch(stdout.stdout, new RegExp(HOSTILE_VALUE.toString("base64").slice(0, 24)));
    const rawStdout = await cli("failures", "export", "--failure", FAILURE_ID, "--include-raw");
    assert.equal((JSON.parse(rawStdout.stdout) as ReproductionBundle).raw?.keyBase64, HOSTILE_KEY.toString("base64"));
  });

  it("failures evaluate prints the plan and the redrive command", async () => {
    const human = await cli("failures", "evaluate", "--failure", FAILURE_ID, "--expected-revision", "3");
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /^Validation\s+valid/m);
    assert.match(human.stdout, /output orderStatus v1 revision 42 \(privileged\)/);
    assert.match(human.stdout, /failures redrive --state-dir .* --failure f1:orders\/0\/42 --plan plan-1 --plan-fingerprint sha256:plan --expected-revision 3/);
    const json = await cli("failures", "evaluate", "--failure", FAILURE_ID, "--expected-revision", "3", "--json");
    assert.equal((JSON.parse(json.stdout) as EvaluationResult).plan?.planId, "plan-1");
    assert.equal((await cli("failures", "evaluate", "--failure", FAILURE_ID)).code, 2);
  });

  it("every mutation exits 0 completed, 3 refused, 1 failed, 4 unknown, and --json prints the result verbatim", { timeout: 120_000 }, async () => {
    const expected = { completed: 0, refused: 3, failed: 1, unknown: 4 } as const;
    for (const [command, flags] of Object.entries(MUTATIONS)) {
      for (const [result, code] of Object.entries(expected) as [OperationResult["result"], number][]) {
        operator.result = result;
        const human = await cli(...command.split(" "), ...flags);
        assert.equal(human.code, code, `${command} ${result}: ${human.stderr}`);
        assert.match(human.stdout.split("\n")[0] ?? "", new RegExp(`^${result}: `), command);
        assert.match(human.stdout, new RegExp(`The operation ended ${result}\\.`));
      }
      operator.result = "refused";
      const json = await cli(...command.split(" "), ...flags, "--json");
      assert.equal(json.code, 3);
      const parsed = JSON.parse(json.stdout) as OperationResult;
      assert.equal(parsed.result, "refused");
      assert.equal(parsed.outcome, "stale-revision");
    }
    const calls = operator.calls;
    assert.deepEqual(calls.find(call => call.op === "retryCurrent")?.args, { sourceId: "orders", failureId: FAILURE_ID, expectedRevision: 3, reason: "producer fixed" });
    assert.deepEqual(calls.find(call => call.op === "reopenCircuit")?.args, { sourceId: "orders", expectedCircuitRevision: 1, reason: "flood is over" });
    assert.deepEqual(calls.find(call => call.op === "retireBoundary")?.args, { sourceId: "orders", boundaryId: BOUNDARY_ID, expectedRevision: 2, reason: "verified the repair" });
    assert.deepEqual(calls.find(call => call.op === "redrive")?.args, {
      failureId: FAILURE_ID, planId: "plan-1", planFingerprint: "sha256:plan", expectedRevision: 3, operationId: "redrive-1"
    });
  });

  it("sources retire-boundary prints the ADR-15B warning and exits 2 without sending unless --confirm matches", async () => {
    const base = MUTATIONS["sources retire-boundary"]!.slice(0, -2);
    const missing = await cli("sources", "retire-boundary", ...base);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /every future snapshot already reflects the\s+quarantined record\. StreamOtter cannot check that\./);
    assert.match(missing.stderr, /--confirm b1-orders/);
    const wrong = await cli("sources", "retire-boundary", ...base, "--confirm", "b2-orders");
    assert.equal(wrong.code, 2);
    assert.equal(operator.calls.length, 0);

    const confirmed = await cli("sources", "retire-boundary", ...base, "--confirm", BOUNDARY_ID);
    assert.equal(confirmed.code, 0, confirmed.stderr);
    assert.match(confirmed.stderr, /StreamOtter cannot check that/);
  });

  it("maps operator errors: INVALID_REQUEST exits 2, anything else 1, and --json reports the error on stderr", async () => {
    operator.throwing.set("showFailure", new StreamOtterError("INVALID_REQUEST", { message: "No incident f1:none." }));
    const invalid = await cli("failures", "show", "--failure", "f1:none");
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /INVALID_REQUEST: No incident f1:none\./);
    operator.throwing.set("status", new StreamOtterError("SOURCE_UNAVAILABLE", { message: "The journal is unavailable." }));
    const runtime = await cli("status", "--json");
    assert.equal(runtime.code, 1);
    assert.equal(runtime.stdout, "");
    assert.equal((JSON.parse(runtime.stderr) as { error: { code: string } }).error.code, "SOURCE_UNAVAILABLE");
  });

  it("refuses bad usage with exit 2 before contacting the gateway: no state dir, unknown subcommand, foreign flags, --force, bad numbers", async () => {
    const cases: string[][] = [
      ["status"],
      ["failures", "list", "--json"],
      ["failures", "purge", "--state-dir", "x"],
      ["failures", "--state-dir", "x"],
      ["sources", "retry-current", "--state-dir", "x", "--source", "orders", "--failure", FAILURE_ID, "--expected-revision", "3", "--force"],
      ["failures", "list", "--state-dir", "x", "--raw"],
      ["failures", "show", "--state-dir", "x", "--failure", FAILURE_ID, "--include-raw"],
      ["sources", "reassess", "--state-dir", "x", "--source", "orders", "--failure", FAILURE_ID, "--expected-revision", "-1"],
      ["sources", "reassess", "--state-dir", "x", "--source", "orders", "--failure", FAILURE_ID, "--expected-revision", "1.5"],
      ["sources", "reopen-circuit", "--state-dir", "x", "--source", "orders", "--expected-circuit-revision", "1"],
      ["failures", "show", "--state-dir", "x", "--failure", FAILURE_ID, "extra"]
    ];
    for (const args of cases) {
      const run = await runCli(args);
      assert.equal(run.code, 2, `${args.join(" ")}: ${run.stderr}`);
    }
    assert.deepEqual(operator.calls, []);
  });

  it("S2: with --json every error is {\"error\": StreamError} on stderr, stdout stays empty, and exit codes are unchanged", async () => {
    const parent = resolve(directory, "..");
    const existing = join(parent, "exists.json");
    writeFileSync(existing, "{}");
    const config = join(parent, "streamotter.json");
    writeFileSync(config, JSON.stringify({ ...orderConfig(), failureHandling: { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } } }));
    const retire = MUTATIONS["sources retire-boundary"]!.slice(0, -2);
    const rebaseline = ["sources", "rebaseline", "--source", "orders", "--reason", "topic recreated", "--confirm", "orders"];
    const cases: { name: string; args: string[]; code: number; error?: string }[] = [
      { name: "missing --failure", args: ["failures", "show"], code: 2 },
      { name: "unknown subcommand", args: ["failures", "purge"], code: 2 },
      { name: "status with an argument", args: ["status", "extra"], code: 2 },
      { name: "a flag of another subcommand", args: ["failures", "list", "--raw"], code: 2 },
      { name: "a flag no command has", args: ["sources", "retry-current", ...MUTATIONS["sources retry-current"]!, "--force"], code: 2 },
      { name: "a bad number", args: ["sources", "reassess", "--source", "orders", "--failure", FAILURE_ID, "--expected-revision", "-1"], code: 2 },
      { name: "retire-boundary without --confirm", args: ["sources", "retire-boundary", ...retire], code: 2 },
      { name: "export to an existing file", args: ["failures", "export", "--failure", FAILURE_ID, "--out", existing], code: 2 },
      { name: "rebaseline without --config", args: rebaseline, code: 2 },
      { name: "rebaseline with a foreign flag", args: [...rebaseline, "--config", config, "--failure", FAILURE_ID], code: 2 },
      { name: "rebaseline without --confirm", args: [...rebaseline.slice(0, -2), "--config", config], code: 2 },
      { name: "rebaseline without a journal", args: [...rebaseline, "--config", config], code: 2, error: "CONFIG_INVALID" }
    ];
    for (const { name, args, code, error: expected = "INVALID_REQUEST" } of cases) {
      const human = await cli(...args);
      assert.equal(human.code, code, `${name} (human): ${human.stderr}`);
      const json = await cli(...args, "--json");
      assert.equal(json.code, code, `${name}: ${json.stderr}`);
      assert.equal(json.stdout, "", name);
      const lines = json.stderr.trimEnd().split("\n");
      assert.equal(lines.length, 1, `${name}: stderr is one JSON line, got ${json.stderr}`);
      const error = (JSON.parse(lines[0]!) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
      assert.equal(error.code, expected, name);
      assert.ok(error.message.length > 0, name);
      if (name === "retire-boundary without --confirm") {
        assert.match(error.message, /--confirm b1-orders/);
        assert.match(String(error.details?.["warning"]), /StreamOtter cannot check that/);
      }
    }
    assert.deepEqual(operator.calls, []);

    // An error from the gateway on a retirement: the warning is not printed as text in front of the JSON.
    operator.throwing.set("retireBoundary", new StreamOtterError("INVALID_REQUEST", { message: "No boundary b1-orders." }));
    const refused = await cli("sources", "retire-boundary", ...MUTATIONS["sources retire-boundary"]!, "--json");
    assert.equal(refused.code, 2);
    assert.equal(refused.stdout, "");
    assert.equal((JSON.parse(refused.stderr) as { error: { message: string } }).error.message, "No boundary b1-orders.");
  });

  it("S1: a mutation whose answer is lost exits 4 and says what to check; a read whose answer is lost exits 1", async () => {
    const state = stateDirectory();
    const gateway = await unansweringGateway(state, true);
    try {
      const retry = await runCli(["sources", "retry-current", "--state-dir", state, ...MUTATIONS["sources retry-current"]!]);
      assert.equal(retry.code, 4, retry.stderr);
      assert.match(retry.stderr, /^The outcome of sources retry-current is unknown/);
      assert.match(retry.stderr, /Check `streamotter status` and `streamotter failures show --failure f1:orders\/0\/42`/);
      const reopen = await runCli(["sources", "reopen-circuit", "--state-dir", state, ...MUTATIONS["sources reopen-circuit"]!]);
      assert.equal(reopen.code, 4, reopen.stderr);
      const redrive = await runCli(["failures", "redrive", "--state-dir", state, ...MUTATIONS["failures redrive"]!, "--json"]);
      assert.equal(redrive.code, 4, redrive.stderr);
      assert.equal(redrive.stdout, "");
      const error = (JSON.parse(redrive.stderr) as { error: { message: string; details: Record<string, unknown> } }).error;
      assert.deepEqual(error.details, { reason: "no-answer", operationId: "redrive-1" });
      assert.match(error.message, /sending it again with --operation-id redrive-1 returns the recorded result/);
      for (const read of [["status"], ["failures", "show", "--failure", FAILURE_ID], ["failures", "evaluate", "--failure", FAILURE_ID, "--expected-revision", "3"]]) {
        const run = await runCli([...read, "--state-dir", state]);
        assert.equal(run.code, 1, `${read.join(" ")}: ${run.stderr}`);
        assert.match(run.stderr, /^INTERNAL: The gateway's operator socket answered unexpectedly: the connection closed before a complete answer\./);
      }
    } finally {
      await gateway.close();
    }
  });

  it("S1: a mutation that times out exits 4; a read that times out exits 1", async () => {
    const state = stateDirectory();
    const gateway = await unansweringGateway(state, false);
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const cases: [string[], number][] = [
        [["sources", "reassess", ...MUTATIONS["sources reassess"]!], 4],
        [["status"], 1]
      ];
      for (const [args, expected] of cases) {
        const err: string[] = [];
        const received = gateway.received();
        const pending = runCliInProcess([...args, "--state-dir", state], { out: () => undefined, err: line => err.push(line), shutdownSignal: new Promise(() => undefined) });
        await received;
        mock.timers.tick(30_000);
        assert.equal(await pending, expected, err.join("\n"));
        assert.match(err.join("\n"), expected === 4 ? /unknown: .*TIMEOUT: The gateway did not answer reassess within 30000 ms/ : /^TIMEOUT: /);
      }
    } finally {
      mock.timers.reset();
      await gateway.close();
    }
  });

  it("exits 1 with a clear message when no gateway serves the state directory", async () => {
    const idle = stateDirectory();
    const run = await runCli(["status", "--state-dir", idle]);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /No gateway is serving the operator socket/);
    assert.match(run.stderr, /--operator-socket/);
    const missing = await runCli(["failures", "list", "--state-dir", join(idle, "nope")]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /does not exist/);
  });

  it("F38: refuses to read a token file other users can read", async () => {
    const tokenPath = join(directory, "run/operator.token");
    chmodSync(tokenPath, 0o644);
    try {
      const run = await cli("status");
      assert.equal(run.code, 1);
      assert.match(run.stderr, /Operator token file .* is accessible to group or others/);
    } finally {
      chmodSync(tokenPath, 0o600);
    }
    assert.deepEqual(operator.calls, []);
  });

  it("start --operator-socket requires --state-dir", async () => {
    const run = await runCli(["start", "--config", "x.json", "--handlers", "x.mjs", "--operator-socket"]);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /--operator-socket requires --state-dir/);
    assert.equal(existsSync(join(ROOT, "run")), false);
    const help = await runCli(["--help"]);
    assert.match(help.stdout, /streamotter sources retire-boundary .* --confirm <boundaryId>/);
  });
});
