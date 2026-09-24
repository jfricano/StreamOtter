/**
 * Production-shaped deployment check. One HTTPS origin served by Caddy (TLS termination):
 *
 *   https://localhost:<port>/streamotter/*  →  gateway (compiled `streamotter start`, production
 *                                              mode, Kafka over TLS + SASL SCRAM-SHA-512)
 *   https://localhost:<port>/*              →  order-dashboard application (Kafka mode)
 *
 * Requires: pnpm build, the local broker (pnpm kafka:start), Caddy (scripts/deploy/setup-caddy.sh),
 * and the headless browser (pnpm browsers:setup).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { io } from "socket.io-client";
import type { StreamError } from "@streamotter/contracts";
import { waitFor } from "../integration/harness.ts";
import { brokerAvailable, CA_FILE, closeKafkaHelpers, SASL_PASSWORD, SASL_TLS, SASL_USER, uniqueName } from "../kafka/helpers.ts";
import { launch, openPage } from "../browser/browser.ts";
import type { Browser, Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "../..");
const CADDY = resolve(ROOT, ".local/caddy/caddy");
const CLI = resolve(ROOT, "packages/cli/bin/streamotter.js");
const EXAMPLE = resolve(ROOT, "examples/order-dashboard");
const APP = resolve(EXAMPLE, "dist/server/app.js");

const ready = existsSync(CADDY) && existsSync(APP) && existsSync(resolve(ROOT, "packages/cli/dist/main.js")) && await brokerAvailable();

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

describe("deployment behind a TLS-terminating reverse proxy", { skip: ready ? false : "needs pnpm build, pnpm kafka:start, scripts/deploy/setup-caddy.sh" }, () => {
  let dir: string;
  let origin: string;
  let caddy: Proc | undefined;
  let app: Proc | undefined;
  let gateway: Proc | undefined;
  let startGateway: () => Promise<Proc>;
  let browser: Browser;
  let page: Page;
  let problems: string[];
  const sockets: string[] = [];

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "so-deploy-"));
    // Certificate for https://localhost from a throwaway CA.
    const ssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
    ssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=Deploy Test CA", "-keyout", "ca-key.pem", "-out", "ca.pem");
    ssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "site-key.pem", "-out", "site.csr");
    await writeFile(join(dir, "site.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
    ssl("x509", "-req", "-in", "site.csr", "-CA", "ca.pem", "-CAkey", "ca-key.pem", "-CAcreateserial", "-days", "2", "-extfile", "site.ext", "-out", "site.pem");

    const [proxyPort, appPort, gatewayPort] = [await freePort(), await freePort(), await freePort()];
    origin = `https://localhost:${proxyPort}`;
    const secrets = {
      ORDER_DASHBOARD_SECRET: "deploy-test-session-secret-0123456789abcdef",
      ORDER_SERVICE_TOKEN: "deploy-test-service-token-0123456789abcdef"
    };
    const topic = uniqueName("orders-deploy");

    // Production gateway configuration: TLS + SCRAM to Kafka, exact browser origin, no fixtures.
    const base = JSON.parse(await readFile(resolve(EXAMPLE, "streamotter.kafka.json"), "utf8")) as Record<string, any>;
    const config = {
      ...base,
      gateway: { ...base["gateway"], host: "127.0.0.1", port: gatewayPort, allowedOrigins: [origin] },
      connections: {
        cluster: {
          brokers: SASL_TLS, tls: { caFile: CA_FILE },
          sasl: { mechanism: "scram-sha-512", username: { env: "ORDERS_KAFKA_USERNAME" }, password: { env: "ORDERS_KAFKA_PASSWORD" } }
        }
      },
      sources: { orders: { ...base["sources"]["orders"], connectionRef: "cluster", topics: [topic], consumerGroup: uniqueName("so-deploy") } }
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

    caddy = run(CADDY, ["run", "--config", join(dir, "Caddyfile"), "--adapter", "caddyfile"], {});
    app = run(process.execPath, [APP, "--kafka"], {
      ...secrets, PORT: String(appPort), HOST: "127.0.0.1", STREAMOTTER_GATEWAY_ORIGIN: origin,
      ORDER_TOPIC: topic, ORDER_DATA_FILE: join(dir, "orders.json")
    });
    await waitFor(() => app!.output().includes("Order dashboard (Kafka mode)"), 60_000, "application server");
    startGateway = async () => {
      const proc = run(process.execPath, [CLI, "start", "--config", join(dir, "streamotter.json"), "--handlers", resolve(EXAMPLE, "dist/server/kafka-handlers.js")], {
        ...secrets, NODE_ENV: "production", ORDER_APP_INTERNAL_ORIGIN: `http://127.0.0.1:${appPort}`,
        ORDERS_KAFKA_USERNAME: SASL_USER, ORDERS_KAFKA_PASSWORD: SASL_PASSWORD
      });
      await waitFor(() => /listening on/.test(proc.output()) || proc.child.exitCode !== null, 60_000, "production gateway");
      assert.match(proc.output(), /listening on http:\/\/127\.0\.0\.1:\d+ path \/streamotter\/socket\.io\. No management/);
      return proc;
    };
    gateway = await startGateway();
    await waitFor(() => /serving initial configuration|server running|HTTPS/i.test(caddy!.output()) || caddy!.child.exitCode !== null, 15_000, "caddy").catch(() => undefined);
    assert.equal(caddy.child.exitCode, null, caddy.output());

    browser = await launch();
    ({ page, problems } = await openPage(browser, { ignoreHTTPSErrors: true }));
    page.on("websocket", socket => sockets.push(socket.url()));
  });

  after(async () => {
    await browser?.close();
    await stop(gateway);
    await stop(app);
    await stop(caddy);
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
    assert.equal(await stop(gateway, "SIGTERM"), 0, "graceful shutdown");
    await page.locator(".badge", { hasText: "Reconnecting" }).first().waitFor({ timeout: 10_000 });
    gateway = await startGateway();
    await page.locator(".badge", { hasText: "Live" }).first().waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Advance order" }).click();
    await page.locator(".status-title", { hasText: /^packed$/i }).waitFor({ timeout: 20_000 });
    assert.match(await page.locator(".order-body").innerText(), /revision 3/);
    assert.deepEqual(problems, []);
  });
});
