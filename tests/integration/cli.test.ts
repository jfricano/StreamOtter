import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { createClient } from "@streamotter/client";
import { canonicalJsonPretty, type Result } from "@streamotter/contracts";
import { waitFor } from "./harness.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CLI = resolve(ROOT, "packages/cli/src/main.ts");

function runCli(args: string[], cwd = ROOT): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(process.execPath, ["--conditions=streamotter-source", "--no-warnings", CLI, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => done({ code: code ?? -1, stdout, stderr }));
  });
}

function startCli(args: string[], cwd: string): { child: ChildProcessWithoutNullStreams; output: () => string } {
  const child = spawn(process.execPath, ["--conditions=streamotter-source", "--no-warnings", CLI, ...args], { cwd });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  return { child, output: () => output };
}

describe("CLI: init, validate, generate, dev, start", () => {
  it("prints usage and uses exit code 2 for invalid invocations", async () => {
    assert.equal((await runCli([])).code, 2);
    assert.equal((await runCli(["--help"])).code, 0);
    const unknown = await runCli(["deploy"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /Unknown command "deploy"/);
    assert.equal((await runCli(["validate", "--config", "x.json", "--bogus"])).code, 2);
    assert.equal((await runCli(["validate", "--config", "missing.json"])).code, 2);
  });

  it("scaffolds a project, refuses to overwrite it, and the scaffold validates, generates, and runs", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "so-init-"));
    const project = join(dir, "my-app");
    const init = await runCli(["init", project]);
    assert.equal(init.code, 0, init.stderr);
    for (const file of ["streamotter.json", "server/handlers.mjs", "web/example.ts", "README.md"]) {
      assert.ok((await readFile(join(project, file), "utf8")).length > 0, file);
    }
    const again = await runCli(["init", project]);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /Refusing to overwrite existing files: streamotter\.json/);

    const validate = await runCli(["validate", "--config", "streamotter.json"], project);
    assert.equal(validate.code, 0, validate.stderr);
    assert.match(validate.stdout, /Fingerprint: sha256:[0-9a-f]{64}/);

    const generate = await runCli(["generate", "--config", "streamotter.json", "--out", "generated"], project);
    assert.equal(generate.code, 0, generate.stderr);
    const types = await readFile(join(project, "generated/streamotter.generated.ts"), "utf8");
    assert.match(types, /jobProgress: ChannelContract<JobParams, JobProgress, 1>/);
    assert.match(types, /state: "queued" \| "running" \| "succeeded" \| "failed";/);

    // Regenerating overwrites generator-owned files but never hand-written ones.
    assert.equal((await runCli(["generate", "--config", "streamotter.json", "--out", "generated"], project)).code, 0);
    await writeFile(join(project, "generated/streamotter.client.example.ts"), "// hand-written\n");
    const blocked = await runCli(["generate", "--config", "streamotter.json", "--out", "generated"], project);
    assert.equal(blocked.code, 2);
    assert.match(blocked.stderr, /not created by the generator: streamotter\.client\.example\.ts/);

    // `dev` runs the scaffold with its registered fixtures and development principal (ephemeral port).
    const scaffold = JSON.parse(await readFile(join(project, "streamotter.json"), "utf8")) as { gateway: { port: number } };
    scaffold.gateway.port = 0;
    await writeFile(join(project, "streamotter.json"), JSON.stringify(scaffold, null, 2));
    const dev = startCli(["dev", "--config", "streamotter.json", "--handlers", "server/handlers.mjs", "--management-port", "0"], project);
    try {
      // The banner arrives line by line; wait for its last line before parsing it.
      await waitFor(() => /Press Ctrl\+C to stop/.test(dev.output()), 20_000, "dev banner");
      const token = /Token\s+(\S+)/.exec(dev.output())![1]!;
      const management = /Management\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(dev.output())![1]!;
      const gatewayOrigin = /Gateway\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(dev.output())![1]!;
      assert.match(dev.output(), /Principals\s+developer/);
      const call = async <T>(path: string, body: unknown): Promise<Result<T>> => (await fetch(`${management}${path}`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body)
      })).json() as Promise<Result<T>>;
      const preview = await call<{ token: string }>("/management/v1/preview-sessions", { fixturePrincipalRef: "developer" });
      assert.ok(preview.ok);
      if (!preview.ok) return;
      const client = createClient({ origin: gatewayOrigin, getToken: () => preview.data.token });
      const job = client.subscribe("jobProgress", { channelVersion: 1, params: { jobId: "job_1" } });
      const percents: number[] = [];
      job.on("data", event => { percents.push((event.data as { percent: number }).percent); });
      await job.ready();
      await call("/management/v1/dev/fixtures/advance", { sourceId: "jobs", count: 4 });
      await waitFor(() => percents.at(-1) === 100, 5_000, "fixture updates");
      assert.deepEqual(percents, [0, 25, 60, 90, 100]);
      await client.close();
    } finally {
      const exited = dev.child.exitCode !== null
        ? Promise.resolve(dev.child.exitCode)
        : new Promise<number | null>(done => dev.child.once("exit", done));
      dev.child.kill("SIGINT");
      assert.equal(await exited, 0, `graceful shutdown on SIGINT exits 0\n${dev.output()}`);
    }
    assert.match(dev.output(), /Received SIGINT; shutting down gracefully/);
  });

  it("exports from the workbench API and validates in the CLI with the same canonical form and fingerprint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "so-export-"));
    await runCli(["init", join(dir, "app")]);
    const original = JSON.parse(await readFile(join(dir, "app/streamotter.json"), "utf8")) as unknown;
    const canonical = canonicalJsonPretty(original);
    await writeFile(join(dir, "exported.json"), canonical);
    const fromOriginal = await runCli(["validate", "--config", join(dir, "app/streamotter.json")]);
    const fromExport = await runCli(["validate", "--config", join(dir, "exported.json")]);
    const fp = (text: string) => /sha256:([0-9a-f]{64})/.exec(text)?.[1];
    assert.equal(fp(fromExport.stdout), fp(fromOriginal.stdout));
    assert.doesNotMatch(fromExport.stdout, /not in canonical form/);
    assert.match(fromOriginal.stdout, /not in canonical form/);
  });

  it("rejects TypeScript handler modules, invalid configs, and fixture sources in production", async () => {
    const dir = await mkdtemp(join(tmpdir(), "so-reject-"));
    await runCli(["init", join(dir, "app")]);
    const app = join(dir, "app");
    await writeFile(join(app, "handlers.ts"), "export const handlers = {};\n");
    const ts = await runCli(["dev", "--config", "streamotter.json", "--handlers", "handlers.ts"], app);
    assert.equal(ts.code, 2);
    assert.match(ts.stderr, /loads compiled JavaScript modules/);
    const production = await runCli(["start", "--config", "streamotter.json", "--handlers", "server/handlers.mjs"], app);
    assert.equal(production.code, 2);
    assert.match(production.stderr, /fixture sources are development-only/);
    await writeFile(join(app, "bad.json"), JSON.stringify({ configVersion: 2 }));
    const invalid = await runCli(["validate", "--config", "bad.json"], app);
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /\/configVersion\s+UNSUPPORTED_FEATURE/);
  });
});
