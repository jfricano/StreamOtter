/**
 * Browser checks for the workbench host contract (WHC-1 §8, F44): the built workbench mounted by a
 * host under a non-root prefix, with a boot block in `session` mode, against createManagementHandler
 * behind a fake cookie session, served with a strict CSP and Subresource Integrity.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { WORKBENCH_OPERATIONS, type WorkbenchHostManifest, type WorkbenchOperation } from "@streamotter/contracts";
import { createManagementHandler } from "@streamotter/gateway/management";
import { FAR_FUTURE, orderRecord, startHarness, type Harness } from "../integration/harness.ts";
import { launch, openPage } from "./browser.ts";
import type { Browser, Page } from "playwright";

const WORKBENCH = resolve(import.meta.dirname, "../../apps/workbench/dist");
const VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../apps/workbench/package.json"), "utf8")) as { version: string }).version;
const PREFIX = "/workbench";
const API_BASE = `${PREFIX}/api/v1`;
const MINIMAL_API = `${PREFIX}/minimal-api/v1`;
const LEGACY_API = `${PREFIX}/legacy-api/v1`;
/** Deliberately omits traces (Inspect), dev.disconnect, and sources.resume. */
const OPERATIONS: readonly WorkbenchOperation[] = [
  "health", "sources", "channels", "config", "config.validate", "config.export", "source-checks",
  "preview-sessions", "dev.principals", "dev.fixtures.advance"
];
const DETAIL = "An isolated demo session. <b>Nothing</b> here touches a production system.";

interface Seen { method: string; path: string; headers: IncomingMessage["headers"] }

describe("workbench hosted under a site route (WHC-1)", { skip: existsSync(resolve(WORKBENCH, "workbench-host.json")) ? false : "run pnpm build first" }, () => {
  let h: Harness;
  let server: Server;
  let origin: string;
  let browser: Browser;
  let page: Page;
  let problems: string[];
  const seen: Seen[] = [];
  const sessions = new Set<string>();
  const browserRequests: { url: string; headers: Record<string, string> }[] = [];
  let manifest: WorkbenchHostManifest;

  const csp = () => {
    const gateway = h.origin;
    return [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      `connect-src 'self' ${gateway} ${gateway.replace(/^http/, "ws")}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'"
    ].join("; ");
  };

  const hostPage = (boot: unknown) => {
    // Escape "<" so host-provided strings cannot close the JSON script element.
    const json = JSON.stringify(boot, null, 2).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hosted workbench</title>
  <link rel="icon" href="${PREFIX}/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${PREFIX}/assets/styles.css" integrity="${manifest.integrity["styles.css"]}">
</head>
<body>
  <script type="application/json" id="${manifest.bootElementId}">
${json}
  </script>
  <div id="${manifest.mountElementId}"></div>
  <script type="module" src="${PREFIX}/assets/app.js" integrity="${manifest.integrity["app.js"]}"></script>
</body>
</html>`;
  };

  const boots: Record<string, unknown> = {};

  before(async () => {
    manifest = JSON.parse(await readFile(resolve(WORKBENCH, "workbench-host.json"), "utf8")) as WorkbenchHostManifest;
    h = await startHarness({
      principals: { alice: { subject: "alice", tenantId: "acme", sessionId: "dev-alice", expiresAt: FAR_FUTURE, claims: {} } },
      fixtures: [orderRecord("acme", "ord_1", 2, "processing", 40), orderRecord("acme", "ord_1", 3, "done", 100)]
    });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const handler = createManagementHandler({
      gateway: h.gateway,
      operations: OPERATIONS,
      authorize: request => {
        const cookie = /(?:^|;\s*)sandbox=([A-Za-z0-9_-]+)/.exec(request.headers.cookie ?? "")?.[1];
        return cookie !== undefined && sessions.has(cookie);
      }
    });
    // A host that offers too little for the shell, and one that predates WHC-1 (its discovery route is 404).
    const minimal = createManagementHandler({ gateway: h.gateway, operations: ["health", "config", "channels"], authorize: () => true });
    const legacy = createManagementHandler({ gateway: h.gateway, operations: WORKBENCH_OPERATIONS, authorize: () => true });
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", "http://host.invalid");
      seen.push({ method: request.method ?? "GET", path: `${url.pathname}${url.search}`, headers: request.headers });
      if (url.pathname.startsWith(`${API_BASE}/`)) {
        void handler(request, response, url.pathname.slice(API_BASE.length));
        return;
      }
      if (url.pathname.startsWith(`${MINIMAL_API}/`)) {
        void minimal(request, response, url.pathname.slice(MINIMAL_API.length));
        return;
      }
      if (url.pathname.startsWith(`${LEGACY_API}/`)) {
        if (url.pathname === `${LEGACY_API}/workbench`) {
          response.statusCode = 404;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ ok: false, requestId: "legacy", error: { code: "INVALID_REQUEST", message: "Unknown management route.", retryable: false, requestId: "legacy" } }));
          return;
        }
        void legacy(request, response, url.pathname.slice(LEGACY_API.length));
        return;
      }
      response.setHeader("Content-Security-Policy", csp());
      response.setHeader("X-Content-Type-Options", "nosniff");
      const pageName = /^\/workbench\/(?:([a-z-]+)\/)?$/.exec(url.pathname);
      if (pageName !== null && request.method === "GET") {
        const id = randomBytes(16).toString("base64url");
        sessions.add(id);
        response.setHeader("Set-Cookie", `sandbox=${id}; HttpOnly; SameSite=Strict; Path=${PREFIX}`);
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(hostPage(boots[pageName[1] ?? "main"]));
        return;
      }
      const asset = /^\/workbench\/assets\/(app\.js|styles\.css|favicon\.svg)$/.exec(url.pathname)?.[1];
      if (asset !== undefined) {
        const types: Record<string, string> = { "app.js": "text/javascript", "styles.css": "text/css", "favicon.svg": "image/svg+xml" };
        response.setHeader("Content-Type", types[asset]!);
        response.end(readFileSync(resolve(WORKBENCH, asset)));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    h.internals.allowDevelopmentOrigin(origin); // The host's gateway configuration would list its site origin.

    const sandbox = {
      hostContract: 1,
      apiBase: API_BASE,
      auth: { mode: "session" },
      gateway: { origin: h.origin, path: h.path },
      environment: { kind: "sandbox", label: "Synthetic fixture", detail: DETAIL, packageVersion: VERSION }
    };
    boots["main"] = sandbox;
    boots["invalid"] = { ...sandbox, theme: "dark" };
    boots["cross-origin"] = { ...sandbox, apiBase: "//evil.example/api" };
    boots["unsupported"] = { ...sandbox, hostContract: 2 };
    boots["mismatch"] = { ...sandbox, environment: { ...sandbox.environment, packageVersion: "0.0.0-other" } };
    boots["minimal"] = { ...sandbox, apiBase: MINIMAL_API };
    boots["legacy"] = { ...sandbox, apiBase: LEGACY_API };
    boots["no-gateway"] = { hostContract: 1, apiBase: API_BASE, auth: { mode: "session" }, environment: { kind: "development", label: "Local" } };

    browser = await launch();
    ({ page, problems } = await openPage(browser));
    page.on("request", request => {
      void request.allHeaders().then(headers => browserRequests.push({ url: request.url(), headers }));
    });
  });
  after(async () => {
    await browser?.close();
    await new Promise<void>(done => { if (server === undefined) done(); else { server.close(() => done()); server.closeAllConnections(); } });
    await h?.close();
  });

  const tab = (name: string) => page.getByRole("tab", { name });
  const apiCalls = () => seen.filter(entry => entry.path.startsWith(API_BASE));

  it("boots from the boot block under /workbench/ with no token gate, and shows the sandbox banner as text", async () => {
    await page.goto(`${origin}${PREFIX}/`);
    await page.getByText("Sources ready").waitFor();
    assert.equal(await page.getByLabel("Management token").count(), 0, "no token gate in session mode");
    assert.equal(await tab("Connect").getAttribute("aria-selected"), "true");
    await page.getByText("Sandbox · Synthetic fixture").waitFor();
    const banner = page.getByRole("note", { name: "Environment" });
    assert.equal(await banner.innerText(), `Synthetic fixture ${DETAIL}`);
    assert.equal(await banner.locator("b").count(), 0, "detail is rendered as text, never markup");
    assert.equal(await page.locator(".version-mismatch").count(), 0, "the pinned version matches the bundle");
    assert.equal(apiCalls()[0]?.path, `${API_BASE}/workbench`, "capability discovery is the first request");
  });

  it("Connect checks a source and offers fixture advancement, which is listed", async () => {
    await page.getByRole("button", { name: "Check connection" }).click();
    await page.getByText("Connection check: orders").waitFor();
    await page.getByRole("button", { name: "Advance fixture" }).waitFor();
  });

  it("Inspect is unavailable and its operation is never requested", async () => {
    await tab("Inspect").click();
    await page.getByText("Not available in this environment", { exact: true }).waitFor();
    assert.match(await page.locator("#view").innerText(), /traces/);
    await page.waitForTimeout(1_200); // Inspect would poll every second if it were rendered.
    assert.equal(apiCalls().filter(entry => entry.path.includes("/traces")).length, 0);
  });

  it("Preview subscribes through the boot block's gateway; Disconnect is unavailable", async () => {
    await tab("Preview").click();
    await page.getByLabel("Development principal").selectOption("alice");
    await page.getByRole("textbox", { name: /orderId/ }).fill("ord_1");
    await page.getByRole("button", { name: "Start preview" }).click();
    await page.locator(".pill", { hasText: "live" }).first().waitFor();
    await page.getByText("revision 1", { exact: true }).waitFor();
    await page.getByRole("button", { name: 'Advance "orders" by 1' }).click();
    await page.getByText("revision 2", { exact: true }).waitFor();
    await page.getByText("Disconnect: Not available in this environment").waitFor();
    await page.getByRole("button", { name: "Stop preview" }).click();
    assert.equal(apiCalls().filter(entry => entry.path.includes("/dev/disconnect")).length, 0);
  });

  it("Define and Export use the host's API", async () => {
    await tab("Define").click();
    await page.getByRole("button", { name: "Validate candidate" }).click();
    await page.getByText(/^Valid\./).waitFor();
    await tab("Export").click();
    await page.getByRole("button", { name: "Export candidate" }).click();
    await page.getByText("This export matches the active configuration.").waitFor();
  });

  it("never sends Authorization or a token, never calls another origin's API, and loads without console or CSP errors", async () => {
    const calls = apiCalls();
    assert.ok(calls.length >= 8);
    for (const call of calls) {
      assert.equal(call.headers.authorization, undefined, `${call.method} ${call.path}`);
      assert.equal(call.headers["x-streamotter-workbench"], "1", `${call.method} ${call.path}`);
      assert.match(call.headers.cookie ?? "", /sandbox=/, "the host's same-origin session cookie authenticates");
    }
    const unlisted = ["/traces", "/dev/disconnect", "/sources/resume", "/capabilities"];
    assert.deepEqual(calls.filter(call => unlisted.some(path => call.path.startsWith(`${API_BASE}${path}`))), []);
    await page.waitForTimeout(100);
    assert.ok(browserRequests.length > 0);
    const gatewayOrigins = [h.origin, h.origin.replace(/^http/, "ws")];
    for (const request of browserRequests) {
      const target = new URL(request.url).origin;
      assert.ok(target === origin || gatewayOrigins.includes(target), `unexpected origin ${request.url}`);
      if (target !== origin) assert.ok(new URL(request.url).pathname.startsWith(h.path), `only the gateway's Socket.IO path: ${request.url}`);
      assert.equal(request.headers["authorization"], undefined, request.url);
    }
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]), [0, 0, ""], "the HttpOnly cookie is invisible to scripts");
    assert.deepEqual(problems, []);
  });

  for (const [name, title, text] of [
    ["invalid", "Workbench configuration error", "/theme"],
    ["cross-origin", "Workbench configuration error", "/apiBase"],
    ["unsupported", "Unsupported host contract", "host contract 2"]
  ] as const) {
    it(`a${name === "unsupported" ? "n unsupported" : name === "invalid" ? "n invalid" : " cross-origin"} boot block shows its screen and makes no requests`, async () => {
      const before = seen.length;
      await page.goto(`${origin}${PREFIX}/${name}/`);
      await page.getByRole("heading", { name: title }).waitFor();
      assert.match(await page.getByRole("alert").innerText(), new RegExp(text.replace(/[/]/g, "\\/")));
      await page.waitForTimeout(200);
      const after = seen.slice(before).map(entry => entry.path);
      assert.deepEqual(after.filter(path => path.startsWith(`${PREFIX}/api`)), [], "zero API requests");
      assert.equal(after.filter(path => !path.startsWith(`${PREFIX}/${name}/`) && !path.startsWith(`${PREFIX}/assets/`)).length, 0, `only the page and its assets: ${after.join(", ")}`);
    });
  }

  it("warns when the pinned package version differs from the bundled one", async () => {
    await page.goto(`${origin}${PREFIX}/mismatch/`);
    await page.getByText("Sources ready").waitFor();
    assert.match(await page.locator(".version-mismatch").innerText(), new RegExp(`expects @streamotter/workbench 0\\.0\\.0-other, but the loaded workbench is ${VERSION.replace(/\./g, "\\.")}`));
  });

  it("without a gateway in the boot block, Preview is unavailable and development shows no sandbox banner", async () => {
    await page.goto(`${origin}${PREFIX}/no-gateway/`);
    await page.getByText("Sources ready").waitFor();
    await page.getByText("Development · Local").waitFor();
    assert.equal(await page.getByRole("note", { name: "Environment" }).count(), 0);
    await tab("Preview").click();
    await page.getByText("Not available in this environment", { exact: true }).waitFor();
    assert.match(await page.locator("#view").innerText(), /gateway \(boot block\)/);
    assert.deepEqual(problems, []);
  });

  it("stops with the missing names when the host lacks an operation the shell needs", async () => {
    const before = seen.length;
    await page.goto(`${origin}${PREFIX}/minimal/`);
    await page.getByText("Missing: sources").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Not available in this environment/);
    assert.deepEqual(seen.slice(before).map(entry => entry.path).filter(path => path.startsWith(MINIMAL_API)), [`${MINIMAL_API}/workbench`]);
  });

  it("treats a 404 from discovery as a pre-WHC-1 native server: its operations, and no others", async () => {
    await page.goto(`${origin}${PREFIX}/legacy/`);
    await page.getByText("Sources ready").waitFor();
    await tab("Inspect").click();
    await page.getByRole("columnheader", { name: "Stage" }).waitFor();
    assert.equal(await page.getByText("Not available in this environment").count(), 0);
    // The only console message is Chromium logging the discovery 404 that this case is about.
    assert.deepEqual(problems, ["console: Failed to load resource: the server responded with a status of 404 (Not Found)"]);
    assert.deepEqual(seen.filter(entry => entry.path.startsWith(LEGACY_API) && entry.headers.authorization !== undefined), []);
  });
});
