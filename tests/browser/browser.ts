import { resolve } from "node:path";

// Browsers are installed project-locally by scripts/browser/setup.sh.
process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= resolve(import.meta.dirname, "../../.local/ms-playwright");
const { chromium } = await import("playwright");
import type { Browser, BrowserContextOptions, Page } from "playwright";

export async function launch(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/** Opens a page that records console errors, page errors, and failed requests (CSP violations appear as console errors). */
export async function openPage(browser: Browser, options: BrowserContextOptions = {}): Promise<{ page: Page; problems: string[] }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  page.on("pageerror", error => problems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const failure = request.failure()?.errorText ?? "";
    // Socket.IO closing a WebSocket during reconnect tests is expected, not a page problem.
    if (!/websocket|ERR_ABORTED/i.test(`${request.url()} ${failure}`)) problems.push(`requestfailed: ${request.url()} ${failure}`);
  });
  return { page, problems };
}
