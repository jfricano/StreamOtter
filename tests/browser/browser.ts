import { resolve } from "node:path";

// Browsers are installed project-locally by scripts/browser/setup.sh.
process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= resolve(import.meta.dirname, "../../.local/ms-playwright");
const playwright = await import("playwright");
import type { Browser, BrowserContextOptions, Page } from "playwright";

export type Engine = "chromium" | "firefox" | "webkit";
const ENGINES: readonly Engine[] = ["chromium", "firefox", "webkit"];

/** The engine the browser tier runs on: STREAMOTTER_BROWSER, chromium by default. */
export const engine: Engine = (() => {
  const name = process.env["STREAMOTTER_BROWSER"] || "chromium";
  if (!(ENGINES as readonly string[]).includes(name)) throw new Error(`STREAMOTTER_BROWSER must be one of ${ENGINES.join(", ")}, not "${name}"`);
  return name as Engine;
})();

export async function launch(): Promise<Browser> {
  return playwright[engine].launch({ headless: true });
}

/**
 * A WebSocket request, or a request the page itself cancelled (by navigating away, or Socket.IO
 * closing a transport during reconnect tests), in each engine's wording: expected, not a page problem.
 */
const EXPECTED_FAILURE = { chromium: /websocket|ERR_ABORTED/i, firefox: /websocket|NS_BINDING_ABORTED/i, webkit: /websocket|cancelled/i }[engine];

/** Opens a page that records console errors, page errors, and failed requests (CSP violations appear as console errors). */
export async function openPage(browser: Browser, options: BrowserContextOptions = {}): Promise<{ page: Page; problems: string[] }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const failure = request.failure()?.errorText ?? "";
    if (!EXPECTED_FAILURE.test(`${request.url()} ${failure}`)) problems.push(`requestfailed: ${request.url()} ${failure}`);
  });
  return { page, problems };
}
