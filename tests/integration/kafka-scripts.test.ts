import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";

// The pid-file ownership checks in scripts/kafka/*stop.sh, run against fake brokers: a node process
// whose command line ends like Kafka's ("... kafka.Kafka <config>"). No real broker is started.
const ROOT = resolve(import.meta.dirname, "../..");
const fakes: ChildProcess[] = [];
after(() => { for (const fake of fakes) fake.kill("SIGKILL"); });

/** A checkout holding only the script, plus a symbolic link to it; returns both paths. */
async function checkout(script: string): Promise<{ real: string; link: string }> {
  const real = await realpath(await mkdtemp(join(tmpdir(), "so-kafka-scripts-")));
  await mkdir(join(real, "scripts/kafka"), { recursive: true });
  await mkdir(join(real, ".local"));
  await copyFile(join(ROOT, "scripts/kafka", script), join(real, "scripts/kafka", script));
  const link = join(await mkdtemp(join(tmpdir(), "so-kafka-link-")), "checkout");
  await symlink(real, link);
  return { real, link };
}

async function fakeBroker(pidfile: string, ...args: string[]): Promise<ChildProcess> {
  const fake = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...args], { stdio: "ignore" });
  fakes.push(fake);
  await mkdir(dirname(pidfile), { recursive: true });
  await writeFile(pidfile, `${fake.pid}\n`);
  return fake;
}

function run(script: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn("bash", [script, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => done({ code: code ?? -1, stdout, stderr }));
  });
}

const alive = (fake: ChildProcess): boolean => fake.exitCode === null && fake.signalCode === null;
const exited = (fake: ChildProcess): Promise<unknown> =>
  alive(fake) ? new Promise(done => fake.once("exit", done)) : Promise.resolve();

describe("local Kafka scripts", () => {
  it("stop.sh stops this checkout's broker when run through a symbolic link", async () => {
    const { real, link } = await checkout("stop.sh");
    const pidfile = join(real, ".local/kafka.pid");
    const fake = await fakeBroker(pidfile, "kafka.Kafka", join(real, ".local/kafka-server.properties"));
    const result = await run(join(link, "scripts/kafka/stop.sh"));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), "Kafka stopped.");
    await exited(fake);
    assert.equal(existsSync(pidfile), false);
  });

  it("stop.sh keeps the pid file of a Kafka broker started with another checkout's config", async () => {
    const { real } = await checkout("stop.sh");
    const pidfile = join(real, ".local/kafka.pid");
    // Another checkout whose path ends with this one's: a plain substring match would claim it.
    const fake = await fakeBroker(pidfile, "kafka.Kafka", `/elsewhere${real}/.local/kafka-server.properties`);
    const result = await run(join(real, "scripts/kafka/stop.sh"));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /names a running Kafka process .*kept the pid file/);
    assert.equal(existsSync(pidfile), true);
    assert.equal(alive(fake), true);
  });

  it("stop.sh removes a pid file whose pid now belongs to an unrelated process", async () => {
    const { real } = await checkout("stop.sh");
    const pidfile = join(real, ".local/kafka.pid");
    const fake = await fakeBroker(pidfile, "unrelated");
    const result = await run(join(real, "scripts/kafka/stop.sh"));
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /removed a stale pid file/);
    assert.equal(existsSync(pidfile), false);
    assert.equal(alive(fake), true);
  });

  it("replicated-stop.sh stops a node when run through a symbolic link", async () => {
    const { real, link } = await checkout("replicated-stop.sh");
    const node = join(real, ".local/kafka-replicated/node-1");
    const fake = await fakeBroker(join(node, "pid"), "kafka.Kafka", join(node, "server.properties"));
    const result = await run(join(link, "scripts/kafka/replicated-stop.sh"), "--node", "1", "--kill");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), "Node 1 stopped (SIGKILL).");
    await exited(fake);
    assert.equal(existsSync(join(node, "pid")), false);
  });
});
