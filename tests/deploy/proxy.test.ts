/**
 * Production-shaped deployment check. One HTTPS origin served by Caddy (TLS termination):
 *
 *   https://localhost:<port>/streamotter/*  →  gateway (compiled `streamotter start`, production
 *                                              mode, Kafka over TLS + SASL SCRAM-SHA-512)
 *   https://localhost:<port>/*              →  order-dashboard application (Kafka mode)
 *
 * The second deployment turns failure handling on, as docs/DEPLOYMENT.md describes for production:
 * a state directory created by `streamotter init --failures`, the example's quarantine-resync policy
 * and recovery guard, the operator socket and the health listener, both on the gateway's host only.
 *
 * Requires: pnpm build, the local broker (pnpm kafka:start), Caddy (scripts/deploy/setup-caddy.sh),
 * and the headless browser (pnpm browsers:setup).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { io } from "socket.io-client";
import type { StreamError } from "@streamotter/contracts";
import { sleep, waitFor } from "../integration/harness.ts";
import { brokerAvailable, CA_FILE, closeKafkaHelpers, SASL_PASSWORD, SASL_TLS, SASL_USER, uniqueName } from "../kafka/helpers.ts";
import { launch, openPage } from "../browser/browser.ts";
import type { Browser, Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "../..");
const CADDY = resolve(ROOT, ".local/caddy/caddy");
const CLI = resolve(ROOT, "packages/cli/bin/streamotter.js");
const EXAMPLE = resolve(ROOT, "examples/order-dashboard");
const APP = resolve(EXAMPLE, "dist/server/app.js");

const ready = existsSync(CADDY) && existsSync(APP) && existsSync(resolve(ROOT, "packages/cli/dist/main.js")) && await brokerAvailable();
const skip = ready ? false : "needs pnpm build, pnpm kafka:start, scripts/deploy/setup-caddy.sh";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

interface Proc { child: ChildProcess; output: () => string }
function run(command: string, args: string[], env: NodeJS.ProcessEnv): Proc {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", chunk => { output += chunk; });
  child.stderr?.on("data", chunk => { output += chunk; });
  return { child, output: () => output };
}

async function stop(proc: Proc | undefined, signal: NodeJS.Signals = "SIGTERM"): Promise<number | null> {
  if (proc === undefined || proc.child.exitCode !== null || proc.child.signalCode !== null) return proc?.child.exitCode ?? null;
  const exited = new Promise<number | null>(done => proc.child.once("exit", code => done(code)));
  proc.child.kill(signal);
  return exited;
}

/** Runs the compiled CLI to completion, as an operator on the gateway's host would. */
function cli(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface Deployment {
  dir: string;
  origin: string;
  caddy: Proc;
  app: Proc;
  gateway: Proc;
  startGateway: () => Promise<Proc>;
  browser: Browser;
  page: Page;
  problems: string[];
  sockets: string[];
  /** With failure handling: the state directory and the health listener's port. */
  state: string | null;
  healthPort: number | null;
}

/**
 * Starts Caddy, the application and the compiled production gateway on one HTTPS origin, and opens a
 * browser page. With failureHandling, the application also creates the quarantine topic.
 */
async function deploy(options: { failureHandling: boolean }): Promise<Deployment> {
  const dir = await mkdtemp(join(tmpdir(), "so-deploy-"));
  // Certificate for https://localhost from a throwaway CA.
  const ssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=Deploy Test CA", "-keyout", "ca-key.pem", "-out", "ca.pem");
  ssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "site-key.pem", "-out", "site.csr");
  await writeFile(join(dir, "site.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  ssl("x509", "-req", "-in", "site.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-days", "2", "-extfile", "site.ext", "-out", "site.pem");

  const [proxyPort, appPort, gatewayPort] = [await freePort(), await freePort(), await freePort()];
  const origin = `https://localhost:${proxyPort}`;
  const secrets = {
    ORDER_DASHBOARD_SECRET: "deploy-test-session-secret-0123456789abcdef",
    ORDER_SERVICE_TOKEN: "deploy-test-service-token-0123456789abcdef"
  };
  const topic = uniqueName("orders-deploy");
  const quarantine = options.failureHandling ? uniqueName("orders-deploy-quarantine") : null;

  // Production gateway configuration: TLS + SCRAM to Kafka, exact browser origin, no fixtures.
  const base = JSON.parse(await readFile(resolve(EXAMPLE, quarantine === null ? "streamotter.kafka.json" : "streamotter.kafka-resync.json"), "utf8")) as Record<string, any>;
  const config = {
    ...base,
    gateway: { ...base["gateway"], host: "127.0.0.1", port: gatewayPort, allowedOrigins: [origin] },
    connections: {
      cluster: {
        brokers: SASL_TLS, tls: { caFile: CA_FILE },
        sasl: { mechanism: "scram-sha-512", username: { env: "ORDERS_KAFKA_USERNAME" }, password: { env: "ORDERS_KAFKA_PASSWORD" } }
      }
    },
    sources: { orders: { ...base["sources"]["orders"], connectionRef: "cluster", topics: [topic], consumerGroup: uniqueName("so-deploy") } },
    ...(quarantine === null ? {} : { failureHandling: { ...base["failureHandling"], quarantine: { ...base["failureHandling"]["quarantine"], topic: quarantine } } })
  };
  await writeFile(join(dir, "streamotter.json"), JSON.stringify(config, null, 2));
  await writeFile(join(dir, "Caddyfile"), [
    "{", "  admin off", "  auto_https disable_redirects", "  skip_install_trust", "}",
    `https://localhost:${proxyPort} {`,
    `  tls ${join(dir, "site.pem")} ${join(dir, "site-key.pem")}`,
    `  handle /streamotter/* {`, `    reverse_proxy 127.0.0.1:${gatewayPort}`, "  }",
    "  handle {", `    reverse_proxy 127.0.0.1:${appPort}`, "  }",
    "}", ""
  ].join("\n"));

  const caddy = run(CADDY, ["run", "--config", join(dir, "Caddyfile"), "--adapter", "caddyfile"], {});
  const app = run(process.execPath, [APP, "--kafka"], {
    ...secrets, PORT: String(appPort), HOST: "127.0.0.1", STREAMOTTER_GATEWAY_ORIGIN: origin,
    ORDER_TOPIC: topic, ORDER_DATA_FILE: join(dir, "orders.json"), ...(quarantine === null ? {} : { ORDER_QUARANTINE_TOPIC: quarantine })
  });
  await waitFor(() => app.output().includes("Order dashboard (Kafka mode)"), 60_000, "application server");

  // The operator socket's path must fit in 103 bytes, and macOS's per-user temporary directory alone
  // takes about 50, so the state directory lives under /tmp.
  const state = quarantine === null ? null : await realpath(await mkdtemp("/tmp/so-deploy-state-"));
  const healthPort = quarantine === null ? null : await freePort();
  if (state !== null) {
    const init = cli(["init", "--failures", "--config", join(dir, "streamotter.json"), "--state-dir", state]);
    assert.equal(init.code, 0, init.stderr);
  }
  const startGateway = async () => {
    const proc = run(process.execPath, [
      CLI, "start", "--config", join(dir, "streamotter.json"),
      "--handlers", resolve(EXAMPLE, quarantine === null ? "dist/server/kafka-handlers.js" : "dist/server/kafka-resync-handlers.js"),
      ...(state === null ? [] : ["--state-dir", state, "--handler-build-id", "deploy-test", "--operator-socket", "--health", `127.0.0.1:${healthPort}`])
    ], {
      ...secrets, NODE_ENV: "production", ORDER_APP_INTERNAL_ORIGIN: `http://127.0.0.1:${appPort}`,
      ORDERS_KAFKA_USERNAME: SASL_USER, ORDERS_KAFKA_PASSWORD: SASL_PASSWORD
    });
    await waitFor(() => /listening on/.test(proc.output()) || proc.child.exitCode !== null, 60_000, "production gateway");
    assert.match(proc.output(), /listening on http:\/\/127\.0\.0\.1:\d+ path \/streamotter\/socket\.io\. No management/);
    return proc;
  };
  const gateway = await startGateway();
  await waitFor(() => /serving initial configuration|server running|HTTPS/i.test(caddy.output()) || caddy.child.exitCode !== null, 15_000, "caddy").catch(() => undefined);
  assert.equal(caddy.child.exitCode, null, caddy.output());

  const browser = await launch();
  const { page, problems } = await openPage(browser, { ignoreHTTPSErrors: true });
  const sockets: string[] = [];
  page.on("websocket", socket => sockets.push(socket.url()));
  return { dir, origin, caddy, app, gateway, startGateway, browser, page, problems, sockets, state, healthPort };
}

/**
 * While no gateway is listening, the proxy answers a reconnect attempt with 502 and the browser logs
 * the failed handshake itself. Whether an attempt lands in that window depends on the client's backoff
 * jitter, so only that error, on this socket and only during a restart (problems from index `from`),
 * is expected; any other problem still fails the test.
 */
function dropRestartHandshakeErrors(problems: string[], from: number, origin: string): void {
  const handshake = new RegExp(`^console: WebSocket connection to 'wss://localhost:${new URL(origin).port}/streamotter/socket\\.io/\\?EIO=4&transport=websocket' failed: Error during WebSocket handshake: Unexpected response code: 502$`);
  problems.splice(from, problems.length - from, ...problems.slice(from).filter(problem => !handshake.test(problem)));
}

async function teardown(deployment: Deployment | undefined): Promise<void> {
  if (deployment === undefined) return;
  await deployment.browser.close();
  await stop(deployment.gateway);
  await stop(deployment.app);
  await stop(deployment.caddy);
  if (deployment.state !== null) await rm(deployment.state, { recursive: true, force: true });
}

describe("deployment behind a TLS-terminating reverse proxy", { skip }, () => {
  let deployment: Deployment | undefined;
  let dir: string;
  let origin: string;
  let gateway: Proc;
  let startGateway: () => Promise<Proc>;
  let page: Page;
  let problems: string[];
  let sockets: string[];

  before(async () => {
    deployment = await deploy({ failureHandling: false });
    ({ dir, origin, gateway, startGateway, page, problems, sockets } = deployment);
  });

  after(async () => {
    // The restart test replaces the gateway process.
    if (deployment !== undefined) deployment.gateway = gateway;
    await teardown(deployment);
    await closeKafkaHelpers();
  });

  it("serves the app and the gateway from one HTTPS origin, with the socket over WSS through the proxy", async () => {
    await page.goto(origin);
    await page.getByRole("button", { name: "Alice" }).click();
    await page.locator(".badge", { hasText: "Live" }).first().waitFor({ timeout: 20_000 });
    assert.ok(sockets.some(url => url.startsWith(`wss://localhost:${new URL(origin).port}/streamotter/socket.io/`)), sockets.join(", "));
  });

  it("delivers an application-published Kafka change to the browser", async () => {
    await page.getByRole("button", { name: "Advance order" }).click();
    await page.locator(".status-title", { hasText: /^picking$/i }).waitFor({ timeout: 20_000 });
    assert.match(await page.locator(".order-body").innerText(), /revision 2/);
  });

  it("enforces exact origins through the proxy and exposes no management routes", async () => {
    const ca = await readFile(join(dir, "ca.pem"), "utf8");
    const attempt = (headers: Record<string, string>) => new Promise<string>(done => {
      const socket = io(origin, {
        path: "/streamotter/socket.io", transports: ["websocket"], reconnection: false, forceNew: true,
        auth: { token: "x", protocolVersion: 1 }, extraHeaders: headers, ca
      });
      socket.once("connect_error", (error: Error & { data?: StreamError }) => { socket.close(); done(error.data?.code ?? error.message); });
      socket.once("so:hello", () => { socket.close(); done("connected"); });
    });
    assert.equal(await attempt({ origin: "https://evil.example" }), "FORBIDDEN");
    assert.equal(await attempt({}), "FORBIDDEN", "browser Origin required in production");
    assert.equal(await attempt({ origin }), "UNAUTHENTICATED", "allowed origin reaches application authentication");
    const management = await page.request.get(`${origin}/management/v1/health`);
    assert.equal(management.status(), 404);
    await assert.rejects(fetch("http://127.0.0.1:7401/management/v1/health"));
  });

  it("recovers the browser view across a graceful gateway restart", async () => {
    const before = problems.length;
    assert.equal(await stop(gateway, "SIGTERM"), 0, "graceful shutdown");
    await page.locator(".badge", { hasText: "Reconnecting" }).first().waitFor({ timeout: 10_000 });
    gateway = await startGateway();
    await page.locator(".badge", { hasText: "Live" }).first().waitFor({ timeout: 60_000 });
    dropRestartHandshakeErrors(problems, before, origin);
    await page.getByRole("button", { name: "Advance order" }).click();
    await page.locator(".status-title", { hasText: /^packed$/i }).waitFor({ timeout: 20_000 });
    assert.match(await page.locator(".order-body").innerText(), /revision 3/);
    assert.deepEqual(problems, []);
  });
});

describe("deployment behind the proxy with failure handling on", { skip }, () => {
  let d: Deployment;
  let token: string;
  let failureId: string;

  before(async () => { d = await deploy({ failureHandling: true }); });
  after(async () => {
    await teardown(d);
    await closeKafkaHelpers();
  });

  /** An operator command against the gateway's operator socket, with --json. */
  const operator = (...args: string[]) => {
    const result = cli([...args, "--state-dir", d.state!, "--json"]);
    assert.equal(result.code, 0, `${args.join(" ")}: exit ${result.code}\n${result.stdout}${result.stderr}`);
    return JSON.parse(result.stdout) as Record<string, any>;
  };
  /** The health listener, which only the gateway's host reaches; it is never routed through the proxy. */
  const readiness = async () => {
    const response = await fetch(`http://127.0.0.1:${d.healthPort}/health/ready`);
    return { status: response.status, reasons: ((await response.json()) as { reasons: string[] }).reasons };
  };
  /** A browser user's request to the application, through the proxy. */
  const api = async (path: string, body: unknown = {}) => {
    const response = await d.page.request.post(`${d.origin}${path}`, { headers: { authorization: `Bearer ${token}` }, data: body });
    return { status: response.status(), body: await response.json() as Record<string, unknown> };
  };
  const orderBadge = (label: string) => d.page.locator(".panel .badge", { hasText: label });

  it("serves live state through the proxy, ready, with the operator socket answering on the host", async () => {
    await d.page.goto(d.origin);
    await d.page.getByRole("button", { name: "Alice" }).click();
    await orderBadge("Live").waitFor({ timeout: 20_000 });
    assert.deepEqual(await readiness(), { status: 200, reasons: [] });
    const status = operator("status");
    assert.equal(status["gateway"]["mode"], "production");
    assert.equal(status["gateway"]["handlerBuildId"], "deploy-test");
    assert.equal(status["store"]["kind"], "sqlite");
    assert.equal(status["quarantine"]["maxMessageBytes"], 2 * 1024 * 1024);
    assert.deepEqual(status["sources"].map((source: { sourceId: string }) => source.sourceId), ["orders"]);
    token = ((await (await d.page.request.post(`${d.origin}/api/session`, { data: { user: "alice" } })).json()) as { token: string }).token;
  });

  it("holds the source on a bad record while the app keeps serving, and the operator sees why", async () => {
    // A broken serializer, rehearsed: the change is committed, but truncated bytes are published.
    const rehearsed = await api("/api/orders/ord_1001/advance", { rehearse: "invalid-json" });
    assert.equal(rehearsed.status, 200);
    const deadline = Date.now() + 20_000;
    let probe = await readiness();
    while (probe.status === 200 && Date.now() < deadline) {
      await sleep(100);
      probe = await readiness();
    }
    assert.deepEqual(probe, { status: 503, reasons: ["source-held"] });

    // The source pauses before its quarantine write and recovery guard finish, so wait for both.
    const settled = Date.now() + 20_000;
    let items = operator("failures", "list")["items"] as Record<string, any>[];
    while (!(items.length === 1 && items[0]!["quarantine"] === "acknowledged" && items[0]!["recovery"] === "denied") && Date.now() < settled) {
      await sleep(250);
      items = operator("failures", "list")["items"] as Record<string, any>[];
    }
    const [incident, ...others] = items;
    assert.equal(others.length, 0);
    assert.ok(incident !== undefined);
    failureId = incident["failureId"];
    assert.equal(incident["failureClass"], "invalid-json");
    assert.equal(incident["quarantine"], "acknowledged");
    assert.equal(incident["progress"], "held");
    assert.equal(incident["recovery"], "denied", "the example's guard holds: the order has not been re-published");
    const shown = operator("failures", "show", "--failure", failureId, "--raw");
    assert.equal(shown["raw"]["complete"], true, shown["raw"]["note"]);
    assert.equal(shown["nextAction"], "reassess");

    // The view is marked out of date, the socket through the proxy stays up, and the application keeps serving.
    await orderBadge("Reconnecting").waitFor({ timeout: 20_000 });
    assert.equal(await d.page.locator("header .badge").innerText(), "Connected");
    assert.equal((await d.page.request.get(d.origin)).status(), 200);
    const orders = await d.page.request.get(`${d.origin}/api/orders`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(orders.status(), 200);
  });

  it("recovers through the operator CLI once the application re-publishes the order", async () => {
    const republished = await api("/api/orders/ord_1001/republish");
    assert.equal(republished.status, 200);
    const shown = operator("failures", "show", "--failure", failureId);
    const result = operator("sources", "reassess", "--source", "orders", "--failure", failureId, "--expected-revision", String(shown["revision"]));
    assert.equal(result["result"], "completed", result["message"]);
    assert.equal(result["outcome"], "advanced", result["message"]);

    await orderBadge("Live").waitFor({ timeout: 30_000 });
    await d.page.locator(".status-title", { hasText: /^picking$/i }).waitFor({ timeout: 20_000 });
    assert.match(await d.page.locator(".order-body").innerText(), /revision 2/);
    assert.deepEqual(await readiness(), { status: 200, reasons: [] });
    assert.deepEqual(operator("failures", "list")["items"], [], "nothing left open");

    await d.page.getByRole("button", { name: "Advance order" }).click();
    await d.page.locator(".status-title", { hasText: /^packed$/i }).waitFor({ timeout: 20_000 });
    assert.match(await d.page.locator(".order-body").innerText(), /revision 3/);
    assert.deepEqual(d.problems, []);
  });

  it("keeps the recovery boundary and serves the operator socket again after a graceful restart", async () => {
    const boundary = operator("status")["sources"][0]["boundary"];
    assert.match(boundary?.["boundaryId"] ?? "", /^rb1:/, "the advance left a boundary in force");
    const before = d.problems.length;
    assert.equal(await stop(d.gateway, "SIGTERM"), 0, "graceful shutdown");
    assert.equal(existsSync(join(d.state!, "run", "operator.sock")), false, "a graceful stop removes the socket");
    await orderBadge("Reconnecting").waitFor({ timeout: 10_000 });
    d.gateway = await d.startGateway();
    // Snapshots after the restart must still acknowledge the boundary; the application's do.
    await orderBadge("Live").waitFor({ timeout: 60_000 });
    dropRestartHandshakeErrors(d.problems, before, d.origin);
    assert.equal(operator("status")["sources"][0]["boundary"]?.["boundaryId"], boundary["boundaryId"]);
    assert.deepEqual(await readiness(), { status: 200, reasons: [] });
    await d.page.getByRole("button", { name: "Advance order" }).click();
    await d.page.locator(".status-title", { hasText: /^shipped$/i }).waitFor({ timeout: 20_000 });
    assert.match(await d.page.locator(".order-body").innerText(), /revision 4/);
    assert.deepEqual(d.problems, []);
  });
});
