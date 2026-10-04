/**
 * WHC-1 revision 0.3 §2.1: dist/workbench-host.css, generated from styles.css with every selector
 * scoped under [data-streamotter-workbench]. The transformer is checked directly, then in Chromium
 * on a host page with its own header, footer, element styles and custom properties.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { WorkbenchHostManifest } from "@streamotter/contracts";
import { CssScopeError, HOST_SCOPE, scopeStylesheet } from "../../apps/workbench/scope-css.ts";
import { launch, openPage } from "./browser.ts";
import type { Browser, Page } from "playwright";

const WORKBENCH = resolve(import.meta.dirname, "../../apps/workbench/dist");
const SOURCE = resolve(import.meta.dirname, "../../apps/workbench/src/styles.css");
const S = HOST_SCOPE;

describe("workbench-host.css transformer", () => {
  it("moves :root, html, body and * onto the mount and prefixes everything else, inside @media and @supports too", () => {
    const input = `/* a comment { with braces } */
:root { --a: 1px; }
@media (prefers-color-scheme: dark) {
  :root { --a: 2px; }
}
@supports (display: grid) { .x { display: grid; } }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  color: red;
}
body > main { padding: 0; }
h1, p, button { margin: 0; }
.pill::before { content: "{,}"; }
nav.tabs button[aria-selected="true"], a[title="html, body"] { color: red; }
:focus-visible { outline: 0; }`;
    assert.equal(scopeStylesheet(input), [
      `${S} { --a: 1px; }`,
      "@media (prefers-color-scheme: dark) {",
      `  ${S} { --a: 2px; }`,
      "}",
      "@supports (display: grid) {",
      `  ${S} .x { display: grid; }`,
      "}",
      `${S}, ${S} * { box-sizing: border-box; }`,
      `${S} { margin: 0; color: red; }`,
      `${S} > main { padding: 0; }`,
      `${S} h1, ${S} p, ${S} button { margin: 0; }`,
      `${S} .pill::before { content: "{,}"; }`,
      `${S} nav.tabs button[aria-selected="true"], ${S} a[title="html, body"] { color: red; }`,
      `${S} :focus-visible { outline: 0; }`,
      ""
    ].join("\n"));
  });

  it("fails on anything it cannot scope safely", () => {
    for (const css of [
      "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
      "@import url(other.css);",
      "@font-face { font-family: x; src: local(x); }",
      "@property --x { syntax: '<length>'; inherits: false; initial-value: 0px; }",
      "@media screen { @keyframes spin { to { opacity: 1; } } }",
      ".a { .b { color: red; } }",
      ".a { & .b { color: red; } }",
      ".x html { color: red; }",
      "html.dark .x { color: red; }",
      "main body { color: red; }",
      ".a :root { color: red; }",
      ":host { color: red; }",
      "> p { color: red; }",
      ".a, { color: red; }",
      "{ color: red; }",
      ".a { color: red;",
      ".a { color: red; } }",
      ".a { content: \"x; }",
      "/* unterminated"
    ]) {
      assert.throws(() => scopeStylesheet(css), CssScopeError, css);
    }
  });

  it("dist/workbench-host.css is generated from styles.css, and every selector in it is scoped", { skip: existsSync(resolve(WORKBENCH, "workbench-host.css")) ? false : "run pnpm build first" }, async () => {
    const generated = await readFile(resolve(WORKBENCH, "workbench-host.css"), "utf8");
    const scoped = scopeStylesheet(await readFile(SOURCE, "utf8"));
    assert.ok(generated.endsWith(scoped), "the published file is the transformer's output for the current styles.css");
    assert.equal(await readFile(resolve(WORKBENCH, "styles.css"), "utf8"), await readFile(SOURCE, "utf8"), "native styles.css is published unchanged");
    const rules = scoped.split("\n").filter(line => line.trim().startsWith(S) || line.trim().startsWith("."));
    assert.ok(rules.length > 50);
    for (const rule of rules) {
      for (const selector of rule.trim().slice(0, rule.trim().indexOf(" { ")).split(", ")) {
        assert.ok(selector === S || selector.startsWith(`${S} `), selector);
      }
    }
  });
});

describe("workbench-host.css on a styled host page", { skip: existsSync(resolve(WORKBENCH, "workbench-host.json")) ? false : "run pnpm build first" }, () => {
  let server: Server;
  let origin: string;
  let browser: Browser;
  let page: Page;
  let manifest: WorkbenchHostManifest;

  const SITE_CSS = `:root { --radius: 3px; --accent: rgb(200, 30, 30); --bg: rgb(255, 250, 240); }
html { background: var(--bg); }
body { margin: 12px; font: 17px/1.7 Georgia, serif; color: rgb(20, 20, 20); }
h1 { font-size: 40px; color: var(--accent); margin: 10px 0; }
p { margin: 5px; color: rgb(60, 60, 60); }
button { border-radius: var(--radius); background: var(--accent); color: white; padding: 2px 3px; border: 2px solid black; font: inherit; }
`;

  /** The same host markup with and without the workbench mounted. */
  const hostPage = (withWorkbench: boolean) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Site</title>
  <link rel="stylesheet" href="/site.css">
  ${withWorkbench ? `<link rel="stylesheet" href="/workbench/assets/${manifest.entry.hostStyle}" integrity="${manifest.integrity[manifest.entry.hostStyle]}">` : ""}
</head>
<body>
  <header><h1 id="site-title">Lontra Creek</h1><p id="site-text">The site's own text.</p><button id="site-button" type="button">Site action</button></header>
  ${withWorkbench ? `<script type="application/json" id="${manifest.bootElementId}">{ "hostContract": 1, "apiBase": "/api/v1", "auth": { "mode": "session" } }</script>` : ""}
  <div id="${manifest.mountElementId}"></div>
  <footer><p id="footer-text">Footer</p><button id="footer-button" type="button">Footer action</button></footer>
  ${withWorkbench ? `<script type="module" src="/workbench/assets/${manifest.entry.script}"></script>` : ""}
</body>
</html>`;

  before(async () => {
    manifest = JSON.parse(await readFile(resolve(WORKBENCH, "workbench-host.json"), "utf8")) as WorkbenchHostManifest;
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url ?? "/", "http://host.invalid").pathname;
      response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'");
      if (path === "/plain/" || path === "/hosted/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(hostPage(path === "/hosted/"));
      } else if (path === "/site.css") {
        response.setHeader("Content-Type", "text/css");
        response.end(SITE_CSS);
      } else if (path === `/workbench/assets/${manifest.entry.hostStyle}` || path === `/workbench/assets/${manifest.entry.script}`) {
        response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css");
        response.end(readFileSync(resolve(WORKBENCH, path.slice("/workbench/assets/".length))));
      } else if (path.startsWith("/api/v1/")) {
        // The visitor has no session: the workbench shows its session-ended screen (h1, p, button.primary).
        response.statusCode = 401;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: false, requestId: "r1", error: { code: "UNAUTHENTICATED", message: "No session.", retryable: false, requestId: "r1" } }));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await launch();
    ({ page } = await openPage(browser));
  });
  after(async () => {
    await browser?.close();
    await new Promise<void>(done => { if (server === undefined) done(); else { server.close(() => done()); server.closeAllConnections(); } });
  });

  const HOST_ELEMENTS = ["html", "body", "#site-title", "#site-text", "#site-button", "#footer-text", "#footer-button"];
  const PROPERTIES = [
    "color", "background-color", "font-size", "font-family", "line-height", "font-weight", "box-sizing",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-left",
    "border-top-left-radius", "border-top-width", "cursor", "--radius", "--accent", "--bg"
  ];
  const hostStyles = () => page.evaluate(({ selectors, properties }) => Object.fromEntries(selectors.map(selector => {
    const style = getComputedStyle(document.querySelector(selector)!);
    return [selector, Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property).trim()]))];
  })), { selectors: HOST_ELEMENTS, properties: PROPERTIES });

  for (const colorScheme of ["light", "dark"] as const) {
    it(`leaves the host's elements and custom properties unchanged and styles only the mount (${colorScheme})`, async () => {
      await page.emulateMedia({ colorScheme });
      await page.goto(`${origin}/plain/`);
      const baseline = await hostStyles();
      assert.equal(baseline["#site-title"]!["font-size"], "40px", "the host page's own styles apply");
      assert.equal(baseline["#site-button"]!["border-top-left-radius"], "3px");

      await page.goto(`${origin}/hosted/`);
      await page.getByRole("heading", { name: "Session ended" }).waitFor();
      assert.deepEqual(await hostStyles(), baseline, "no host element changed");

      const mount = page.locator(`#${manifest.mountElementId}`);
      assert.equal(await mount.getAttribute("data-streamotter-workbench"), "");
      const inside = await page.evaluate(id => {
        const root = document.getElementById(id)!;
        const style = (element: Element) => getComputedStyle(element);
        return {
          radius: style(root).getPropertyValue("--radius").trim(),
          accent: style(root).getPropertyValue("--accent").trim(),
          background: style(root).backgroundColor,
          fontSize: style(root).fontSize,
          h1: style(root.querySelector("h1")!).fontSize,
          p: style(root.querySelector("p")!).marginBottom,
          panel: style(root.querySelector(".panel")!).borderTopLeftRadius,
          button: style(root.querySelector("button.primary")!).backgroundColor,
          buttonRadius: style(root.querySelector("button.primary")!).borderTopLeftRadius
        };
      }, manifest.mountElementId);
      const dark = colorScheme === "dark";
      assert.deepEqual(inside, {
        radius: "8px",
        accent: dark ? "#4493f8" : "#1f6feb",
        background: dark ? "rgb(14, 17, 22)" : "rgb(246, 247, 249)",
        fontSize: "14px",
        h1: "16px",
        p: "8px",
        panel: "8px",
        button: dark ? "rgb(68, 147, 248)" : "rgb(31, 111, 235)",
        buttonRadius: "6px"
      });
    });
  }

  it("no rule in workbench-host.css matches an element outside the mount", async () => {
    const outside = await page.evaluate(({ id, file }) => {
      const root = document.getElementById(id)!;
      const sheet = Array.from(document.styleSheets).find(candidate => candidate.href?.endsWith(file));
      if (sheet === undefined) return ["stylesheet not loaded"];
      const found: string[] = [];
      const visit = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSGroupingRule) visit(rule.cssRules);
          else if (rule instanceof CSSStyleRule) {
            for (const element of Array.from(document.querySelectorAll(rule.selectorText))) {
              if (element !== root && !root.contains(element)) found.push(`${rule.selectorText} matched <${element.tagName.toLowerCase()}>`);
            }
          } else found.push(`unexpected rule: ${rule.cssText.slice(0, 60)}`);
        }
      };
      visit(sheet.cssRules);
      return found;
    }, { id: manifest.mountElementId, file: manifest.entry.hostStyle });
    assert.deepEqual(outside, []);
  });
});
