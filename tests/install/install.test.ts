/**
 * Pack-and-install test (release plan, workstream 1). Packs every public package with pnpm, as
 * `pnpm publish` would, installs the tarballs with npm into a fresh project outside the workspace,
 * and uses them the way an application does: check the tarballs, run the CLI workflow, bundle a
 * browser app with the SDK, type-check against the published declarations, and drive the gateway
 * programmatically. Nothing in the consumer project can reach workspace links or TypeScript sources.
 *
 * Run with `pnpm test:install` (builds first). npm fetches the third-party dependencies (Socket.IO,
 * KafkaJS, TypeScript, esbuild, @types/node) from the registry. With the local broker running
 * (`pnpm kafka:start`), the installed `streamotter start` is also run against TLS Kafka.
 *
 * After publishing, `STREAMOTTER_INSTALL_FROM=registry pnpm test:install` runs the same checks
 * against the workspace version as published on the npm registry instead of local tarballs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { DataFrame, SubscriptionFrame } from "@streamotter/contracts";
import { waitFor } from "../integration/harness.ts";
import { ack, rawConnect } from "../integration/raw.ts";
import { brokerAvailable, CA_FILE, closeKafkaHelpers, createTopic, kafkaConfig, orderValue, produce, TLS, uniqueName } from "../kafka/helpers.ts";

const ROOT = resolve(import.meta.dirname, "../..");

interface PublicPackage { name: string; dir: string; compiled: boolean }
const PACKAGES: readonly PublicPackage[] = [
  { name: "@streamotter/contracts", dir: "packages/contracts", compiled: true },
  { name: "@streamotter/client", dir: "packages/client", compiled: true },
  { name: "@streamotter/gateway", dir: "packages/gateway", compiled: true },
  { name: "@streamotter/cli", dir: "packages/cli", compiled: true },
  { name: "@streamotter/workbench", dir: "apps/workbench", compiled: false }
];

interface Manifest {
  name: string;
  version: string;
  license?: string;
  author?: string;
  homepage?: string;
  bugs?: { url?: string };
  repository?: { type?: string; url?: string; directory?: string };
  publishConfig?: { access?: string; exports?: unknown };
  exports?: unknown;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

interface Tarball { file: string; manifest: Manifest; entries: readonly string[] }
interface RunResult { code: number | null; stdout: string; stderr: string }

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const rootManifest = readJson<Manifest>(join(ROOT, "package.json"));
const workspaceManifests = new Map(PACKAGES.map(pkg => [pkg.name, readJson<Manifest>(join(ROOT, pkg.dir, "package.json"))]));
const VERSION = workspaceManifests.get("@streamotter/contracts")!.version;
const LICENSE = readFileSync(join(ROOT, "LICENSE"), "utf8");
const FROM_REGISTRY = process.env["STREAMOTTER_INSTALL_FROM"] === "registry";
const NPM = existsSync(join(dirname(process.execPath), "npm")) ? join(dirname(process.execPath), "npm") : "npm";

/** The environment a user's shell would have: no pnpm/npm script variables or NODE_OPTIONS from this run. */
function userEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(npm|pnpm)_/i.test(key) && key !== "NODE_OPTIONS") env[key] = value;
  }
  env["PATH"] = `${dirname(process.execPath)}${delimiter}${process.env["PATH"] ?? ""}`;
  return { ...env, ...extra };
}

function run(command: string, args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<RunResult> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? userEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 120_000);
    child.on("error", fail);
    child.on("close", code => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

function startProcess(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = userEnv()) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const exited = new Promise<number | null>(done => child.once("exit", code => done(code)));
  return {
    output: () => output,
    async stop(signal: NodeJS.Signals): Promise<number | null> {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      return exited;
    }
  };
}

/** The pnpm running this script, or the version pinned by packageManager. */
function pnpm(): { command: string; args: string[] } {
  const execPath = process.env["npm_execpath"];
  if (execPath !== undefined && /^pnpm\//.test(process.env["npm_config_user_agent"] ?? "")) {
    return /\.[cm]?js$/.test(execPath) ? { command: process.execPath, args: [execPath] } : { command: execPath, args: [] };
  }
  return { command: "npx", args: ["-y", rootManifest.packageManager ?? "pnpm"] };
}

async function tar(args: readonly string[]): Promise<string> {
  const result = await run("tar", args, { cwd: ROOT });
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

/** Removes the in-repository `streamotter-source` condition from an exports map. */
function withoutSourceCondition(value: unknown): unknown {
  if (Array.isArray(value) || typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "streamotter-source").map(([key, inner]) => [key, withoutSourceCondition(inner)]));
}

const kafka = await brokerAvailable();

describe(FROM_REGISTRY ? `published ${VERSION} installed from the npm registry` : "packed packages installed with npm outside the workspace", () => {
  let work = "";
  let consumer = "";
  const tarballs = new Map<string, Tarball>();
  const bin = (name: string) => join(consumer, "node_modules/.bin", name);

  before(async () => {
    work = await realpath(await mkdtemp(join(tmpdir(), "streamotter-install-")));
    const destination = join(work, "tarballs");
    await mkdir(destination);
    if (FROM_REGISTRY) {
      for (const pkg of PACKAGES) {
        const fetched = await run(NPM, ["pack", `${pkg.name}@${VERSION}`, "--pack-destination", destination], { cwd: work, timeoutMs: 120_000 });
        assert.equal(fetched.code, 0, `npm pack ${pkg.name}@${VERSION} from the registry:\n${fetched.stderr}`);
      }
    } else {
      assert.ok(existsSync(join(ROOT, "packages/cli/dist/main.js")) && existsSync(join(ROOT, "apps/workbench/dist/index.html")), "run `pnpm build` first (pnpm test:install does)");
      const { command, args } = pnpm();
      const filters = PACKAGES.flatMap(pkg => ["--filter", pkg.name]);
      const packed = await run(command, [...args, "-r", ...filters, "pack", "--pack-destination", destination], { cwd: ROOT, env: process.env, timeoutMs: 180_000 });
      assert.equal(packed.code, 0, `${packed.stdout}\n${packed.stderr}`);
    }
    for (const file of (await readdir(destination)).filter(name => name.endsWith(".tgz"))) {
      const path = join(destination, file);
      const manifest = JSON.parse(await tar(["-xOzf", path, "package/package.json"])) as Manifest;
      const entries = (await tar(["-tzf", path])).split("\n").filter(Boolean).map(entry => entry.replace(/^package\//, ""));
      tarballs.set(manifest.name, { file: path, manifest, entries });
    }
    assert.deepEqual([...tarballs.keys()].sort(), PACKAGES.map(pkg => pkg.name).sort(), "one tarball per public package");

    consumer = join(work, "consumer");
    await mkdir(consumer);
    await writeFile(join(consumer, "package.json"), `${JSON.stringify({ name: "streamotter-install-check", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`);
    const tools = [
      `typescript@${rootManifest.devDependencies?.["typescript"]}`,
      `@types/node@${rootManifest.devDependencies?.["@types/node"]}`,
      `esbuild@${workspaceManifests.get("@streamotter/workbench")!.devDependencies?.["esbuild"]}`
    ];
    const packages = FROM_REGISTRY ? PACKAGES.map(pkg => `${pkg.name}@${VERSION}`) : [...tarballs.values()].map(tarball => tarball.file);
    const freshness = FROM_REGISTRY ? "--prefer-online" : "--prefer-offline";
    const installed = await run(NPM, ["install", "--no-audit", "--no-fund", freshness, ...packages, ...tools], { cwd: consumer, timeoutMs: 300_000 });
    assert.equal(installed.code, 0, `npm install failed:\n${installed.stdout}\n${installed.stderr}`);
  });

  after(async () => {
    await closeKafkaHelpers();
    if (work !== "" && process.env["STREAMOTTER_KEEP_INSTALL"] === undefined) await rm(work, { recursive: true, force: true });
  });

  it("gives every public package the same version", () => {
    for (const [name, manifest] of workspaceManifests) assert.equal(manifest.version, VERSION, `${name} version`);
  });

  for (const pkg of PACKAGES) {
    it(`${pkg.name}: tarball manifest and contents`, async () => {
      const { manifest, entries, file } = tarballs.get(pkg.name)!;
      const workspace = workspaceManifests.get(pkg.name)!;
      assert.equal(manifest.version, VERSION);
      assert.ok(!JSON.stringify(manifest).includes("workspace:"), "workspace: protocol rewritten");
      for (const [dependency, range] of Object.entries({ ...manifest.dependencies })) {
        if (dependency.startsWith("@streamotter/")) assert.equal(range, VERSION, `${dependency} pinned to the release version`);
      }
      assert.equal(manifest.license, "MIT");
      assert.ok(typeof manifest.author === "string" && manifest.author.length > 0, "author");
      assert.equal(manifest.repository?.directory, pkg.dir);
      assert.equal(manifest.repository?.url, workspaceManifests.get("@streamotter/contracts")!.repository?.url);
      assert.match(manifest.homepage ?? "", /^https:\/\//);
      assert.match(manifest.bugs?.url ?? "", /^https:\/\//);
      assert.equal(manifest.publishConfig?.access, "public");
      assert.ok(!JSON.stringify(manifest.exports ?? null).includes("streamotter-source"), "published exports omit the source condition");
      if (workspace.exports !== undefined) assert.deepEqual(manifest.exports, withoutSourceCondition(workspace.exports), "published exports match the workspace exports");

      const topLevel = new Set(entries.map(entry => entry.split("/")[0]!));
      for (const required of ["package.json", "README.md", "LICENSE", "dist"]) assert.ok(topLevel.has(required), `contains ${required}`);
      for (const entry of topLevel) assert.ok(["package.json", "README.md", "LICENSE", "dist", "src", "bin"].includes(entry), `unexpected top-level entry ${entry}`);
      for (const entry of entries) assert.doesNotMatch(entry, /(^|\/)(test|tests|node_modules)\/|\.test\.|tsbuildinfo|\.DS_Store/, `unexpected file ${entry}`);
      assert.equal(await tar(["-xOzf", file, "package/LICENSE"]), LICENSE, "LICENSE matches the repository");

      const readme = await tar(["-xOzf", file, "package/README.md"]);
      const relativeLinks = [...readme.matchAll(/\]\(([^)\s]+)/g)].map(match => match[1]!).filter(target => !/^(https?:|mailto:|#)/.test(target));
      assert.deepEqual(relativeLinks, [], "README links are absolute (npm cannot resolve relative links)");

      if (pkg.compiled) {
        const sources = entries.filter(entry => entry.startsWith("src/") && entry.endsWith(".ts") && !entry.endsWith(".d.ts")).map(entry => entry.slice(4, -3));
        const outputs = entries.filter(entry => entry.startsWith("dist/") && entry.endsWith(".js")).map(entry => entry.slice(5, -3));
        assert.ok(sources.length > 0);
        assert.deepEqual([...outputs].sort(), [...sources].sort(), "dist contains exactly the compiled sources (no stale output)");
        for (const source of sources) assert.ok(entries.includes(`dist/${source}.d.ts`), `declarations for ${source}`);
        assert.equal(manifest.main, "./dist/index.js");
        assert.equal(manifest.types, "./dist/index.d.ts");
        assert.ok(entries.includes("dist/index.js") && entries.includes("dist/index.d.ts"), "main and types files exist");
      } else {
        for (const asset of ["index.html", "app.js", "styles.css", "THIRD_PARTY_LICENSES.txt"]) assert.ok(entries.includes(`dist/${asset}`), `workbench ${asset}`);
      }
      if (pkg.name === "@streamotter/cli") {
        assert.ok(entries.includes("bin/streamotter.js"));
        assert.match(manifest.bin?.["streamotter"] ?? "", /bin\/streamotter\.js$/);
      }
    });
  }

  it("installs real copies, deduplicated, with no links back to the workspace", async () => {
    const root = await realpath(consumer);
    for (const pkg of PACKAGES) {
      const directory = join(consumer, "node_modules", pkg.name);
      assert.ok(!(await lstat(directory)).isSymbolicLink(), `${pkg.name} is not a link`);
      assert.ok((await realpath(directory)).startsWith(root), `${pkg.name} lives in the consumer project`);
      assert.equal(readJson<Manifest>(join(directory, "package.json")).version, VERSION);
      assert.ok(!existsSync(join(directory, "node_modules/@streamotter")), `${pkg.name} has no nested StreamOtter copies`);
    }
    assert.ok(existsSync(bin("streamotter")), "the streamotter bin is linked");
  });

  it("CLI: init, validate, generate", async () => {
    const help = await run(bin("streamotter"), ["--help"], { cwd: consumer });
    assert.equal(help.code, 0);
    assert.match(help.stdout, /streamotter init <directory>/);
    const init = await run(bin("streamotter"), ["init", "app"], { cwd: consumer });
    assert.equal(init.code, 0, init.stderr);
    for (const file of ["streamotter.json", "server/handlers.mjs", "web/example.ts", "README.md"]) assert.ok(existsSync(join(consumer, "app", file)), `init created ${file}`);
    const validate = await run(bin("streamotter"), ["validate", "--config", "app/streamotter.json"], { cwd: consumer });
    assert.equal(validate.code, 0, validate.stderr);
    assert.match(validate.stdout, /Fingerprint: sha256:[0-9a-f]{64}/);
    const generate = await run(bin("streamotter"), ["generate", "--config", "app/streamotter.json", "--out", "app/generated"], { cwd: consumer });
    assert.equal(generate.code, 0, generate.stderr);
    assert.ok(existsSync(join(consumer, "app/generated/streamotter.generated.ts")));
    const invalid = await run(bin("streamotter"), ["validate", "--config", "missing.json"], { cwd: consumer });
    assert.equal(invalid.code, 2, "invalid input exits 2");
  });

  it("CLI: dev serves the workbench and the installed SDK receives fixture updates", async () => {
    const configPath = join(consumer, "app/streamotter.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as { gateway: { port: number } };
    config.gateway.port = 0;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(join(consumer, "dev-subscribe.mjs"), DEV_SUBSCRIBE);
    const dev = startProcess(bin("streamotter"), ["dev", "--config", "app/streamotter.json", "--handlers", "app/server/handlers.mjs", "--management-port", "0"], consumer);
    try {
      // The banner arrives line by line; wait for its last line before parsing it.
      await waitFor(() => /Press Ctrl\+C to stop/.test(dev.output()), 30_000, `dev banner\n${dev.output()}`);
      const output = dev.output();
      const workbench = /Workbench\s+(http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1];
      assert.ok(workbench !== undefined, `the workbench is found in the installed package\n${output}`);
      const token = /Token\s+(\S+)/.exec(output)![1]!;
      const management = /Management\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]!;
      const gateway = /Gateway\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]!;

      const page = await fetch(`${workbench}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      const html = await page.text();
      const assets: string[] = [...html.matchAll(/(?:src|href)="\.?\/?([\w.-]+\.(?:js|css))"/g)].map(match => match[1]!);
      assert.deepEqual(assets.sort(), ["app.js", "styles.css"]);
      for (const asset of assets) {
        const response: Response = await fetch(`${workbench}/${asset}`);
        assert.equal(response.status, 200, `workbench asset ${asset}`);
        assert.ok((await response.arrayBuffer()).byteLength > 0);
      }
      const health = await fetch(`${management}/management/v1/health`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(health.status, 200);

      const subscribed = await run(process.execPath, ["dev-subscribe.mjs", management, token, gateway], { cwd: consumer, timeoutMs: 30_000 });
      assert.equal(subscribed.code, 0, `${subscribed.stdout}\n${subscribed.stderr}`);
      const result = JSON.parse(subscribed.stdout) as { percents: number[]; states: string[] };
      assert.deepEqual(result.percents, [0, 25, 60, 90, 100]);
      assert.deepEqual(result.states.slice(0, 3), ["authorizing", "synchronizing", "live"]);
    } finally {
      assert.equal(await dev.stop("SIGINT"), 0, `graceful shutdown on SIGINT\n${dev.output()}`);
    }
  });

  it("CLI: start refuses the development scaffold in production", async () => {
    const start = await run(bin("streamotter"), ["start", "--config", "app/streamotter.json", "--handlers", "app/server/handlers.mjs"], { cwd: consumer, env: userEnv({ NODE_ENV: "production" }) });
    assert.equal(start.code, 2, start.stderr);
    assert.match(start.stderr, /fixture sources are development-only/);
  });

  it("bundles a browser app with @streamotter/client from the published build", async () => {
    await mkdir(join(consumer, "out"), { recursive: true });
    const bundled = await run(bin("esbuild"), [
      "app/web/example.ts", "--bundle", "--format=esm", "--platform=browser", "--target=es2022",
      "--outfile=out/web.js", "--metafile=out/web.meta.json", "--log-level=warning"
    ], { cwd: consumer });
    assert.equal(bundled.code, 0, bundled.stderr);
    const inputs = Object.keys((JSON.parse(await readFile(join(consumer, "out/web.meta.json"), "utf8")) as { inputs: Record<string, unknown> }).inputs);
    for (const input of inputs) assert.match(input, /^(app\/|node_modules\/)/, `bundle input ${input} comes from the consumer project`);
    assert.ok(inputs.some(input => input.startsWith("node_modules/@streamotter/client/dist/")), "SDK from dist");
    assert.ok(inputs.some(input => input.startsWith("node_modules/@streamotter/contracts/dist/")), "contracts from dist");
    assert.ok(inputs.some(input => input.startsWith("node_modules/socket.io-client/")), "Socket.IO client");
    assert.ok(!inputs.some(input => /@streamotter\/[^/]+\/src\//.test(input)), "no TypeScript sources bundled");
    const bundle = await readFile(join(consumer, "out/web.js"), "utf8");
    assert.match(bundle, /so:subscribe/);
    assert.match(bundle, /\/streamotter\/socket\.io/);
  });

  it("type-checks application code against the published declarations", async () => {
    await mkdir(join(consumer, "check"), { recursive: true });
    await writeFile(join(consumer, "check/web.ts"), WEB_CHECK);
    await writeFile(join(consumer, "check/server.ts"), SERVER_CHECK);
    const strict = { strict: true, noEmit: true, skipLibCheck: false, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ES2023" };
    // Browser code: bundler resolution, DOM, and no Node.js types.
    await writeFile(join(consumer, "tsconfig.web.json"), JSON.stringify({
      compilerOptions: { ...strict, module: "ESNext", moduleResolution: "Bundler", lib: ["ES2023", "DOM", "DOM.Iterable"], types: [] },
      include: ["check/web.ts", "app/web/**/*.ts", "app/generated/**/*.ts"]
    }, null, 2));
    // Server code: Node.js ESM resolution.
    await writeFile(join(consumer, "tsconfig.server.json"), JSON.stringify({
      compilerOptions: { ...strict, module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2023"], types: ["node"] },
      include: ["check/server.ts"]
    }, null, 2));
    for (const project of ["tsconfig.web.json", "tsconfig.server.json"]) {
      const checked = await run(bin("tsc"), ["-p", project], { cwd: consumer });
      assert.equal(checked.code, 0, `${project}\n${checked.stdout}${checked.stderr}`);
    }
  });

  it("drives @streamotter/gateway programmatically with the installed SDK", async () => {
    await writeFile(join(consumer, "gateway-check.mjs"), GATEWAY_CHECK);
    const checked = await run(process.execPath, ["gateway-check.mjs"], { cwd: consumer, timeoutMs: 60_000 });
    assert.equal(checked.code, 0, `${checked.stdout}\n${checked.stderr}`);
    const result = JSON.parse(checked.stdout) as {
      events: string[]; states: string[]; revoked: { closedSubscriptions: number; closedConnections: number };
      afterRevoke: { client: string; subscription: string; statesSinceRevoke: string[] };
    };
    assert.deepEqual(result.events, ["snapshot:1:queued", "update:2:shipped"]);
    assert.deepEqual(result.states.slice(0, 3), ["authorizing", "synchronizing", "live"]);
    assert.deepEqual(result.revoked, { closedSubscriptions: 1, closedConnections: 1 });
    assert.equal(result.afterRevoke.client, "auth-required");
    assert.equal(result.afterRevoke.subscription, "stale");
    assert.ok(!result.afterRevoke.statesSinceRevoke.includes("live"), "revoked access is not restored");
  });

  it("CLI: start (installed) delivers from TLS Kafka in production", { skip: kafka ? false : "local Kafka is not running (pnpm kafka:start)", timeout: 120_000 }, async () => {
    const topic = await createTopic(1);
    const dir = join(consumer, "production");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "streamotter.json"), JSON.stringify(kafkaConfig({ topic, group: uniqueName("so-install"), connection: { brokers: TLS, tls: { caFile: CA_FILE } } })));
    await copyFile(join(ROOT, "tests/kafka/fixtures/production-handlers.mjs"), join(dir, "handlers.mjs"));
    const start = startProcess(bin("streamotter"), ["start", "--config", "production/streamotter.json", "--handlers", "production/handlers.mjs"], consumer, userEnv({ NODE_ENV: "production" }));
    try {
      await waitFor(() => /listening on (http:\/\/127\.0\.0\.1:\d+)/.test(start.output()), 45_000, `production banner\n${start.output()}`);
      const origin = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(start.output())![1]!;
      assert.equal((await fetch(`${origin}/management/v1/health`)).status, 404, "no management routes in production");
      const { socket } = await rawConnect(origin, { token: "alice-token", protocolVersion: 1 }, { origin: "http://localhost:3000" });
      const frames: DataFrame[] = [];
      const states: SubscriptionFrame[] = [];
      socket.on("so:data", (frame: DataFrame) => {
        frames.push(frame);
        socket.emit("so:receipt", { subscriptionId: frame.subscriptionId, epoch: frame.epoch, sequence: frame.sequence });
      });
      socket.on("so:state", (frame: SubscriptionFrame) => states.push(frame));
      const accepted = await ack(socket, "so:subscribe", { requestId: crypto.randomUUID(), subscriptionId: crypto.randomUUID(), channel: "orderStatus", channelVersion: 1, params: { orderId: "ord_1" } });
      assert.equal(accepted.ok, true);
      await waitFor(() => states.some(frame => frame.state === "live"), 15_000, "live");
      await produce(topic, [{ key: "ord_1", value: orderValue("acme", "ord_1", 2, "processing", 50) }]);
      await waitFor(() => frames.at(-1)?.event.revision === "2", 15_000, "update delivered");
      socket.close();
    } finally {
      assert.equal(await start.stop("SIGTERM"), 0, start.output());
    }
  });
});

/** Run in the consumer project: a preview session on `streamotter dev`, subscribed with the installed SDK. */
const DEV_SUBSCRIBE = `import { createClient } from "@streamotter/client";

const [management, token, gatewayOrigin] = process.argv.slice(2);
async function call(path, body) {
  const response = await fetch(management + path, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(path + ": " + result.error.code + " " + result.error.message);
  return result.data;
}

const preview = await call("/management/v1/preview-sessions", { fixturePrincipalRef: "developer" });
const client = createClient({ origin: gatewayOrigin, getToken: () => preview.token });
const job = client.subscribe("jobProgress", { channelVersion: 1, params: { jobId: "job_1" } });
const percents = [];
const states = [];
job.on("data", event => percents.push(event.data.percent));
job.on("state", ({ state }) => states.push(state));
await job.ready({ timeoutMs: 10_000 });
await call("/management/v1/dev/fixtures/advance", { sourceId: "jobs", count: 4 });
const deadline = Date.now() + 10_000;
while (percents.at(-1) !== 100 && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
await job.unsubscribe();
await client.close();
console.log(JSON.stringify({ percents, states }));
`;

/** Run in the consumer project: the programmatic gateway API, the management subpath, and the SDK. */
const GATEWAY_CHECK = `import { createClient } from "@streamotter/client";
import { createGateway, defineProject, silentLogger } from "@streamotter/gateway";
import { startManagementServer } from "@streamotter/gateway/management";

const config = defineProject({
  configVersion: 1,
  projectId: "installCheck",
  gateway: { host: "127.0.0.1", port: 0, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:5173"] },
  connections: {},
  sources: { orders: { kind: "fixture", generation: "orders-1", fixtureRef: "orders" } },
  schemas: {
    OrderParams: {
      type: "object", additionalProperties: false, required: ["orderId"],
      properties: { orderId: { type: "string", minLength: 1, maxLength: 64 } }
    },
    Order: {
      type: "object", additionalProperties: false, required: ["orderId", "status"],
      properties: { orderId: { type: "string", minLength: 1, maxLength: 64 }, status: { type: "string", enum: ["queued", "shipped"] } }
    }
  },
  channels: {
    orderStatus: {
      version: 1, source: "orders", paramsSchema: "OrderParams", payloadSchema: "Order",
      handlersRef: "orderStatus", delivery: { kind: "state", overflow: "resync" }
    }
  }
});

// The application's authoritative state and session policy.
const orders = new Map([["acme/ord_1", { revision: "1", data: { orderId: "ord_1", status: "queued" } }]]);
const revokedSessions = new Set();
const alice = { subject: "alice", tenantId: "acme", sessionId: "s1", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} };
const handlers = {
  authenticate: ({ token }) => (token === "alice-token" && !revokedSessions.has(alice.sessionId) ? alice : null),
  channels: {
    orderStatus: {
      authorize: ({ principal, params }) => orders.has(principal.tenantId + "/" + params.orderId),
      map: ({ record }) => {
        const { tenantId, revision, order } = record.value;
        orders.set(tenantId + "/" + order.orderId, { revision, data: order });
        return [{ tenantId, params: { orderId: order.orderId }, revision, data: order }];
      },
      snapshot: ({ principal, params }) => {
        const order = orders.get(principal.tenantId + "/" + params.orderId);
        if (order === undefined) throw new Error("unknown order");
        return order;
      }
    }
  }
};
const development = {
  principals: {},
  fixtures: { orders: [{ key: "ord_1", value: { tenantId: "acme", revision: "2", order: { orderId: "ord_1", status: "shipped" } } }] }
};

const until = async (predicate, label) => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for " + label);
    await new Promise(done => setTimeout(done, 20));
  }
};

const gateway = createGateway({ config, handlers, mode: "development", development, logger: silentLogger });
const { origin } = await gateway.start();
const management = await startManagementServer({ gateway, port: 0, workbenchDir: null });
const client = createClient({ origin, getToken: () => "alice-token" });
const order = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
const events = [];
const states = [];
order.on("data", event => events.push(event.kind + ":" + event.revision + ":" + event.data.status));
order.on("state", ({ state }) => states.push(state));
await order.ready({ timeoutMs: 10_000 });

const advanced = await fetch(management.origin + "/management/v1/dev/fixtures/advance", {
  method: "POST",
  headers: { authorization: "Bearer " + management.token, "content-type": "application/json" },
  body: JSON.stringify({ sourceId: "orders", count: 1 })
});
if (advanced.status !== 200) throw new Error("fixture advance failed: " + advanced.status);
await until(() => events.length === 2, "the fixture update");

// Update the durable policy first, then revoke; reconnection must not restore access.
revokedSessions.add(alice.sessionId);
const revokedAt = states.length;
const revoked = await gateway.revoke({ kind: "session", tenantId: "acme", sessionId: alice.sessionId });
await until(() => client.state === "auth-required", "auth-required");
const afterRevoke = { client: client.state, subscription: order.state, statesSinceRevoke: states.slice(revokedAt) };

await client.close();
await management.close();
await gateway.stop();
console.log(JSON.stringify({ events, states, revoked, afterRevoke }));
`;

/** Browser code type-checked against the published client declarations and the generated contract. */
const WEB_CHECK = `import { createClient, isStreamError, type StreamError, type SubscriptionState } from "@streamotter/client";
import { channelVersions, type AppChannels } from "../app/generated/streamotter.generated.js";

export function watchJob(element: HTMLElement): () => Promise<void> {
  const client = createClient<AppChannels>({ getToken: async () => "session-token" });
  const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId: "job_1" } });
  job.on("data", event => {
    const percent: number = event.data.percent;
    element.textContent = event.data.state + " " + percent + "% r" + event.revision;
  });
  job.on("state", ({ state }: { state: SubscriptionState }) => { element.dataset["delivery"] = state; });
  job.on("error", (error: StreamError) => { if (isStreamError(error)) console.warn(error.code, error.retryable); });
  // @ts-expect-error: parameters are typed from the generated contract
  client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { orderId: "x" } });
  // @ts-expect-error: unknown channels are rejected
  client.subscribe("unknownChannel", { channelVersion: 1, params: {} });
  return async () => {
    await job.unsubscribe();
    await client.close();
  };
}
`;

/** Server code type-checked against the published gateway, contracts, and CLI declarations (NodeNext). */
const SERVER_CHECK = `import { generateFiles, EXIT } from "@streamotter/cli";
import { compareRevisions, validateProjectConfig, type ProjectConfig } from "@streamotter/contracts";
import { createGateway, defineProject, silentLogger, type ChannelHandlers, type HandlerRegistry, type Principal } from "@streamotter/gateway";
import { startManagementServer } from "@streamotter/gateway/management";
import { readFileSync } from "node:fs";
import type { AppChannels } from "../app/generated/streamotter.generated.js";

const config = defineProject<AppChannels>(JSON.parse(readFileSync("app/streamotter.json", "utf8")) as ProjectConfig<AppChannels>);
const principal: Principal = { subject: "u1", tenantId: "t1", sessionId: "s1", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} };

export const handlers: HandlerRegistry<AppChannels> = {
  authenticate: async ({ token, signal }) => (signal.aborted || token !== "ok" ? null : principal),
  channels: {
    jobProgress: {
      authorize: ({ principal: who, params }) => who.tenantId === "t1" && params.jobId.length > 0,
      map: () => [],
      snapshot: async ({ params }) => ({ revision: "1", data: { jobId: params.jobId, state: "queued", percent: 0 } })
    }
  }
};

// @ts-expect-error: snapshot data must match the channel's payload type
export const wrongSnapshot: ChannelHandlers<AppChannels["jobProgress"]>["snapshot"] = async () => ({ revision: "1", data: { jobId: "x" } });

export async function main(): Promise<number> {
  const gateway = createGateway({ config, handlers, mode: "production", logger: silentLogger });
  const address: { origin: string; path: string } = await gateway.start();
  const result: { closedSubscriptions: number; closedConnections: number } = await gateway.revoke({ kind: "subject", tenantId: "t1", subject: "u1" });
  await gateway.stop({ timeoutMs: 5_000 });
  const starter: typeof startManagementServer = startManagementServer;
  void starter;
  const valid: boolean = validateProjectConfig(config).valid;
  const files: readonly { path: string; content: string }[] = generateFiles(config);
  return valid && compareRevisions("2", "10") < 0 && files.length > 0 && address.path.length > 0 && result.closedConnections >= 0 ? EXIT.ok : EXIT.runtime;
}
`;
