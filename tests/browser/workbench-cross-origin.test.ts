/**
 * Browser checks for WHC-1 revision 0.3 §3.4: a host page on one loopback origin whose boot block
 * names a second loopback origin as `apiOrigin`, in `session` mode. This mirrors a static site
 * (streamotter.app) whose API and HttpOnly, SameSite=Strict session cookie live on another origin of
 * the same site (demo.streamotter.app); here the two origins are two ports of 127.0.0.1, which are
 * likewise same-site. The API origin answers CORS for exactly the page origin; a third origin does
 * not answer CORS at all.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkbenchHostManifest, WorkbenchOperation } from "@streamotter/contracts";
import { createManagementHandler } from "@streamotter/gateway/management";
import { FAR_FUTURE, orderRecord, startHarness, type Harness } from "../integration/harness.ts";
import { launch, openPage } from "./browser.ts";
import type { Browser, Page } from "playwright";

const WORKBENCH = resolve(import.meta.dirname, "../../apps/workbench/dist");
const API_BASE = "/workbench/api/v1";
const REDIRECT_API = "/redirect-api/v1";
/** Answers every request with the JSON body `null`, with the status in the path. */
const NULL_API = (status: number) => `/null-api/${status}/v1`;
const OPERATIONS: readonly WorkbenchOperation[] = ["health", "sources", "channels", "config", "config.validate", "config.export", "source-checks", "traces"];
const COOKIE = "demo_session";

interface Seen { method: string; path: string; headers: IncomingMessage["headers"] }

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const close = (server: Server | undefined) => new Promise<void>(done => {
  if (server === undefined) return done();
  server.close(() => done());
  server.closeAllConnections();
});
const record = (seen: Seen[], request: IncomingMessage): URL => {
  const url = new URL(request.url ?? "/", "http://host.invalid");
  seen.push({ method: request.method ?? "GET", path: `${url.pathname}${url.search}`, headers: request.headers });
  return url;
};

describe("workbench with a cross-origin API in session mode (WHC-1 §3.4)", { skip: existsSync(resolve(WORKBENCH, "workbench-host.json")) ? false : "run pnpm build first" }, () => {
  let h: Harness;
  let site: Server;
  let api: Server;
  let bare: Server;
  let siteOrigin: string;
  let apiOrigin: string;
  let bareOrigin: string;
  let browser: Browser;
  let page: Page;
  let problems: string[];
  let manifest: WorkbenchHostManifest;
  const siteSeen: Seen[] = [];
  const apiSeen: Seen[] = [];
  const bareSeen: Seen[] = [];
  const sessions = new Set<string>();
  const boots: Record<string, { config: unknown; target: () => string }> = {};
  const browserRequests: { url: string; headers: Record<string, string> }[] = [];

  /** The manifest's CSP with its placeholders filled in the way WHC-1 §2 tells a host to. */
  const csp = (target: string) => [
    "default-src 'none'",
    ...Object.entries(manifest.csp).map(([directive, sources]) =>
      [directive, ...sources.map(source => (source === "<api origin>" ? target : source)).filter(source => !source.startsWith("<"))].join(" ")),
    "base-uri 'none'",
    "form-action 'none'"
  ].join("; ");

  const head = () => `<meta charset="utf-8">
  <title>Hosted workbench, cross-origin API</title>
  <link rel="stylesheet" href="/workbench/assets/${manifest.entry.hostStyle}" integrity="${manifest.integrity[manifest.entry.hostStyle]}">`;

  const staticPage = (config: unknown) => `<!doctype html>
<html lang="en">
<head>
  ${head()}
</head>
<body>
  <header><a href="/">Site</a></header>
  <script type="application/json" id="${manifest.bootElementId}">
${JSON.stringify(config, null, 2).replace(/</g, "\\u003c")}
  </script>
  <div id="${manifest.mountElementId}"></div>
  <footer>Site footer</footer>
  <script type="module" src="/workbench/assets/${manifest.entry.script}" integrity="${manifest.integrity[manifest.entry.script]}"></script>
</body>
</html>`;

  /** The site writes the boot block from its own script, then imports app.js (WHC-1 §3.1). */
  const scriptedPage = (name: string) => `<!doctype html>
<html lang="en">
<head>
  ${head()}
</head>
<body>
  <div id="${manifest.mountElementId}"></div>
  <script type="module" src="/workbench/site/loader-${name}.js"></script>
</body>
</html>`;

  const loader = (config: unknown) => `const boot = document.createElement("script");
boot.type = "application/json";
boot.id = ${JSON.stringify(manifest.bootElementId)};
boot.textContent = ${JSON.stringify(JSON.stringify(config))};
document.getElementById(${JSON.stringify(manifest.mountElementId)}).before(boot);
await import("/workbench/assets/${manifest.entry.script}");
`;

  before(async () => {
    manifest = JSON.parse(await readFile(resolve(WORKBENCH, "workbench-host.json"), "utf8")) as WorkbenchHostManifest;
    h = await startHarness({
      principals: { alice: { subject: "alice", tenantId: "acme", sessionId: "dev-alice", expiresAt: FAR_FUTURE, claims: {} } },
      fixtures: [orderRecord("acme", "ord_1", 2, "processing", 40)]
    });
    const handler = createManagementHandler({
      gateway: h.gateway,
      operations: OPERATIONS,
      authorize: request => {
        const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(request.headers.cookie ?? "")?.[1];
        return cookie !== undefined && sessions.has(cookie);
      }
    });
    const open = createManagementHandler({ gateway: h.gateway, operations: OPERATIONS, authorize: () => true });

    // The API origin: CORS for exactly the site origin, with credentials and the workbench header.
    api = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = record(apiSeen, request);
      if (url.pathname === "/session" && request.method === "GET") {
        const id = randomBytes(16).toString("base64url");
        sessions.add(id);
        response.setHeader("Set-Cookie", `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`);
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("session started");
        return;
      }
      const allowed = request.headers.origin === siteOrigin;
      if (allowed) {
        response.setHeader("Access-Control-Allow-Origin", siteOrigin);
        response.setHeader("Access-Control-Allow-Credentials", "true");
      }
      response.setHeader("Vary", "Origin");
      if (request.method === "OPTIONS") {
        response.statusCode = allowed ? 204 : 403;
        if (allowed) {
          response.setHeader("Access-Control-Allow-Methods", "GET, POST");
          response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-StreamOtter-Workbench");
        }
        response.end();
        return;
      }
      if (url.pathname.startsWith(`${REDIRECT_API}/`)) {
        // A host answering an expired session with a redirect: the workbench must not follow it.
        response.statusCode = 302;
        response.setHeader("Location", `${apiOrigin}/redirected${url.pathname}`);
        response.end();
        return;
      }
      const nullStatus = /^\/null-api\/(\d{3})\/v1\//.exec(url.pathname)?.[1];
      if (nullStatus !== undefined) {
        response.statusCode = Number(nullStatus);
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end("null");
        return;
      }
      if (url.pathname.startsWith(`${API_BASE}/`)) {
        void handler(request, response, url.pathname.slice(API_BASE.length));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    // An origin that serves the same API but answers no CORS at all.
    bare = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = record(bareSeen, request);
      if (url.pathname.startsWith(`${API_BASE}/`)) {
        void open(request, response, url.pathname.slice(API_BASE.length));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    // The static site: pages and the published assets, no API.
    site = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = record(siteSeen, request);
      const pageName = /^\/workbench\/([a-z-]+)\/$/.exec(url.pathname)?.[1];
      const loaderName = /^\/workbench\/site\/loader-([a-z-]+)\.js$/.exec(url.pathname)?.[1];
      const boot = boots[pageName ?? loaderName ?? ""];
      response.setHeader("X-Content-Type-Options", "nosniff");
      if (boot !== undefined && pageName !== undefined) {
        response.setHeader("Content-Security-Policy", csp(boot.target()));
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(pageName === "scripted" ? scriptedPage(pageName) : staticPage(boot.config));
        return;
      }
      if (boot !== undefined && loaderName !== undefined) {
        response.setHeader("Content-Type", "text/javascript");
        response.end(loader(boot.config));
        return;
      }
      const asset = /^\/workbench\/assets\/(app\.js|workbench-host\.css)$/.exec(url.pathname)?.[1];
      if (asset !== undefined) {
        response.setHeader("Content-Type", asset.endsWith(".js") ? "text/javascript" : "text/css");
        response.end(readFileSync(resolve(WORKBENCH, asset)));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    [siteOrigin, apiOrigin, bareOrigin] = await Promise.all([listen(site), listen(api), listen(bare)]);
    assert.notEqual(siteOrigin, apiOrigin);

    const main = {
      hostContract: 1,
      apiOrigin,
      apiBase: API_BASE,
      auth: { mode: "session" },
      environment: { kind: "sandbox", label: "Cross-origin API" }
    };
    boots["main"] = { config: main, target: () => apiOrigin };
    boots["scripted"] = { config: main, target: () => apiOrigin };
    boots["redirect"] = { config: { ...main, apiBase: REDIRECT_API }, target: () => apiOrigin };
    boots["no-cors"] = { config: { ...main, apiOrigin: bareOrigin }, target: () => bareOrigin };
    boots["null-unauthenticated"] = { config: { ...main, apiBase: NULL_API(401) }, target: () => apiOrigin };
    boots["null-ok"] = { config: { ...main, apiBase: NULL_API(200) }, target: () => apiOrigin };

    browser = await launch();
    ({ page, problems } = await openPage(browser));
    page.on("request", request => {
      // A request still in flight when the browser closes rejects; it has nothing left to record.
      request.allHeaders().then(headers => browserRequests.push({ url: request.url(), headers }), () => undefined);
    });
  });
  after(async () => {
    await browser?.close();
    await Promise.all([close(site), close(api), close(bare)]);
    await h?.close();
  });

  const apiCalls = () => apiSeen.filter(entry => entry.path.startsWith(`${API_BASE}/`) && entry.method !== "OPTIONS");
  const pageErrors = () => problems.filter(problem => problem.startsWith("pageerror"));

  it("without a session, shows the session-ended state; Reload recovers once the API origin has set its cookie", async () => {
    await page.goto(`${siteOrigin}/workbench/main/`);
    await page.getByRole("heading", { name: "Session ended" }).waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Reload the page to continue/);
    assert.deepEqual(apiCalls().map(call => call.path), [`${API_BASE}/workbench`], "the 401 stopped the workbench after discovery");
    assert.deepEqual(pageErrors(), []);
    // The API origin sets its own HttpOnly, SameSite=Strict cookie (in the browser's cookie jar).
    const started = await page.context().request.get(`${apiOrigin}/session`);
    assert.equal(started.status(), 200);
    await page.getByRole("button", { name: "Reload" }).click();
    await page.getByText("Sources ready").waitFor();
    problems.length = 0; // Chromium logged the deliberate 401.
  });

  it("calls only the API origin, with the cookie and X-StreamOtter-Workbench, and never Authorization", async () => {
    apiSeen.length = 0;
    siteSeen.length = 0;
    browserRequests.length = 0;
    await page.goto(`${siteOrigin}/workbench/main/`);
    await page.getByText("Sources ready").waitFor();
    await page.getByText("Sandbox · Cross-origin API").waitFor();
    await page.getByRole("tab", { name: "Define" }).click();
    await page.getByRole("button", { name: "Validate candidate" }).click();
    await page.getByText(/^Valid\./).waitFor();

    const calls = apiCalls();
    assert.ok(calls.length >= 6, `requests reached the API origin: ${calls.map(call => call.path).join(", ")}`);
    assert.ok(calls.some(call => call.method === "POST" && call.path === `${API_BASE}/config/validate`));
    for (const call of calls) {
      const label = `${call.method} ${call.path}`;
      assert.equal(call.headers.origin, siteOrigin, label);
      assert.equal(call.headers["x-streamotter-workbench"], "1", label);
      assert.equal(call.headers.authorization, undefined, label);
      assert.match(call.headers.cookie ?? "", new RegExp(`${COOKIE}=`), `the API origin's cookie is included: ${label}`);
    }
    const preflights = apiSeen.filter(entry => entry.method === "OPTIONS");
    assert.ok(preflights.length > 0, "the custom header makes every request preflighted");
    for (const preflight of preflights) {
      assert.equal(preflight.headers.origin, siteOrigin);
      assert.match(preflight.headers["access-control-request-headers"] ?? "", /x-streamotter-workbench/);
      assert.equal(preflight.headers.cookie, undefined, "preflights never carry credentials");
    }
    assert.deepEqual(siteSeen.filter(entry => entry.path.includes("/api/")), [], "nothing went to the page's own origin's API");
    await page.waitForTimeout(100);
    for (const request of browserRequests) {
      const target = new URL(request.url).origin;
      assert.ok(target === siteOrigin || target === apiOrigin, `unexpected origin ${request.url}`);
      assert.equal(request.headers["authorization"], undefined, request.url);
    }
    assert.equal(await page.evaluate(() => document.cookie), "", "the HttpOnly cookie is invisible to scripts");
    assert.deepEqual(problems, []);
  });

  it("an UNAUTHENTICATED answer mid-session shows the session-ended state and stops every request", async () => {
    await page.getByRole("tab", { name: "Inspect" }).click();
    await page.getByRole("columnheader", { name: "Stage" }).waitFor();
    const polled = apiCalls().filter(call => call.path.startsWith(`${API_BASE}/traces`)).length;
    await page.waitForTimeout(1_200);
    assert.ok(apiCalls().filter(call => call.path.startsWith(`${API_BASE}/traces`)).length > polled, "Inspect polls while the session lasts");
    sessions.clear(); // The host ends the visitor's session.
    await page.getByRole("heading", { name: "Session ended" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Reload" }).count(), 1);
    const count = apiSeen.length;
    await page.waitForTimeout(1_500);
    assert.equal(apiSeen.length, count, "no request after the session ended: polling stopped");
    assert.deepEqual(pageErrors(), []);
    problems.length = 0;
    await page.context().request.get(`${apiOrigin}/session`);
  });

  it("reads a boot block that the site's own script writes before importing app.js", async () => {
    await page.goto(`${siteOrigin}/workbench/scripted/`);
    await page.getByText("Sources ready").waitFor();
    assert.equal(await page.locator(`#${manifest.mountElementId}`).getAttribute("data-streamotter-workbench"), "");
    assert.deepEqual(problems, []);
  });

  it("refuses a redirect from the API origin instead of following it", async () => {
    await page.goto(`${siteOrigin}/workbench/redirect/`);
    await page.getByText(/The workbench API is unavailable/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Retry" }).count(), 1);
    assert.ok(apiSeen.some(entry => entry.method === "GET" && entry.path === `${REDIRECT_API}/workbench`), "the redirecting answer was received");
    assert.deepEqual(apiSeen.filter(entry => entry.path.startsWith("/redirected")), [], "the redirect target was never requested");
    assert.deepEqual(pageErrors(), []);
    problems.length = 0;
  });

  it("a 401 whose JSON body is not a Result still ends the session, and a 200 with one is an unexpected response", async () => {
    await page.goto(`${siteOrigin}/workbench/null-unauthenticated/`);
    await page.getByRole("heading", { name: "Session ended" }).waitFor();
    assert.equal(apiSeen.filter(entry => entry.path.startsWith(`${NULL_API(401)}/`) && entry.method !== "OPTIONS").length, 1, "nothing after the 401");
    await page.goto(`${siteOrigin}/workbench/null-ok/`);
    await page.getByText("The workbench API is unavailable: Unexpected response (200).").waitFor();
    assert.deepEqual(pageErrors(), []);
    problems.length = 0; // Chromium logged the deliberate 401.
  });

  it("an API origin that does not answer CORS shows as unavailable, not as a crash", async () => {
    await page.goto(`${siteOrigin}/workbench/no-cors/`);
    await page.getByText(/The workbench API is unavailable/).waitFor();
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByText(/The workbench API is unavailable/).waitFor();
    assert.ok(bareSeen.length > 0, "the browser asked");
    assert.deepEqual(bareSeen.filter(entry => entry.method !== "OPTIONS"), [], "no request got past the refused preflight");
    assert.deepEqual(pageErrors(), []);
  });
});
