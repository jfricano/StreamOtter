/**
 * Browser checks for the order-dashboard example: the built app server (child process)
 * and an in-process development gateway running the example's fixture handlers.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProjectConfig } from "@streamotter/contracts";
import { createGateway, silentLogger, type Gateway } from "@streamotter/gateway";
import { getGatewayInternals, type GatewayInternals } from "@streamotter/gateway/internals";
import { development, handlers } from "../../examples/order-dashboard/src/server/fixture-handlers.ts";
import { waitFor } from "../integration/harness.ts";
import { launch, openPage } from "./browser.ts";
import type { Browser, Page } from "playwright";

const EXAMPLE = resolve(import.meta.dirname, "../../examples/order-dashboard");
const APP = resolve(EXAMPLE, "dist/server/app.js");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

describe("order-dashboard example in a browser", { skip: existsSync(APP) ? false : "run pnpm build first" }, () => {
  let gateway: Gateway;
  let internals: GatewayInternals;
  let app: ChildProcess;
  let appOrigin: string;
  let browser: Browser;
  let page: Page;
  let problems: string[];

  before(async () => {
    const port = await freePort();
    appOrigin = `http://127.0.0.1:${port}`;
    const config = JSON.parse(await readFile(resolve(EXAMPLE, "streamotter.json"), "utf8")) as ProjectConfig;
    gateway = createGateway({
      config: { ...config, gateway: { ...config.gateway, port: 0, allowedOrigins: [appOrigin] } },
      handlers: handlers as never, development, mode: "development", logger: silentLogger
    });
    const { origin } = await gateway.start();
    internals = getGatewayInternals(gateway);
    app = spawn(process.execPath, [APP], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STREAMOTTER_GATEWAY_ORIGIN: origin }, stdio: "pipe" });
    let output = "";
    app.stdout?.on("data", chunk => { output += chunk; });
    await waitFor(() => output.includes("Order dashboard"), 10_000, "app server");
    browser = await launch();
    ({ page, problems } = await openPage(browser));
  });
  after(async () => {
    await browser?.close();
    app?.kill("SIGTERM");
    await gateway?.stop();
    delete process.env["ORDER_SNAPSHOT_DELAY_MS"];
  });

  const log = () => page.getByRole("list", { name: "Delivery log" }).innerText();
  /** Log lines in chronological order (the view shows newest first). */
  const chronological = async () => (await log()).split("\n").map(line => line.replace(/^\d\d:\d\d:\d\d\s*/, "").trim()).filter(Boolean).reverse();

  it("shows an update that arrives while the snapshot is loading only after the snapshot", async () => {
    process.env["ORDER_SNAPSHOT_DELAY_MS"] = "1200";
    await page.goto(appOrigin);
    await page.getByRole("button", { name: "Alice" }).click();
    await page.locator(".badge", { hasText: "Loading" }).waitFor();
    // The next fixture record moves Acme ord_1001 to "picking" (revision 2) mid-snapshot.
    assert.equal(await internals.advanceFixture("orders", 1), 1);
    await page.locator(".badge", { hasText: "Live" }).first().waitFor();
    process.env["ORDER_SNAPSHOT_DELAY_MS"] = "0";
    await page.locator(".status-title", { hasText: /^picking$/i }).waitFor();
    const lines = await chronological();
    const snapshot = lines.indexOf("Snapshot: placed (revision 1).");
    const update = lines.indexOf("Update: picking (revision 2).");
    const live = lines.indexOf("Delivery live.");
    assert.ok(snapshot >= 0 && snapshot < update && update < live, lines.join(" | "));
    assert.match(await page.locator(".order-body").innerText(), /revision 2/);
  });

  it("never shows another tenant's order that has the same ID", async () => {
    // The rest of round one: Acme ord_1002, Acme ord_1003, then Globex ord_1001 (same ID as Alice's).
    assert.equal(await internals.advanceFixture("orders", 3), 3);
    await page.waitForTimeout(300);
    const updates = (await chronological()).filter(line => line.startsWith("Update:"));
    assert.deepEqual(updates, ["Update: picking (revision 2)."]);
  });

  it("denies an order the user does not own and offers no recovery for it", async () => {
    await page.getByRole("button", { name: /Try order ord_1003/ }).click();
    await page.getByRole("alert").filter({ hasText: "You don't have access to this order." }).waitFor();
    await page.locator(".badge", { hasText: "Unavailable" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Reconnect" }).count(), 0);
    assert.doesNotMatch(await page.locator(".order-body").innerText(), /placed|picking/i, "no order data rendered");
  });

  it("resynchronizes with a fresh snapshot after Reconnect", async () => {
    await page.getByRole("button", { name: /^ord_1001/ }).click();
    await page.locator(".badge", { hasText: "Live" }).first().waitFor();
    const before = (await chronological()).length;
    await page.getByRole("button", { name: "Reconnect" }).click();
    await page.waitForFunction(count => (document.querySelector('[aria-label="Delivery log"]')?.children.length ?? 0) > count + 4, before);
    await page.locator(".badge", { hasText: "Live" }).first().waitFor();
    const recent = (await chronological()).slice(before);
    const stale = recent.indexOf("Delivery stale.");
    const snapshot = recent.indexOf("Snapshot: picking (revision 2).");
    assert.ok(stale >= 0 && snapshot > stale && recent.lastIndexOf("Delivery live.") > snapshot, recent.join(" | "));
  });

  it("renders the React usage example with live and denied orders", async () => {
    await page.goto(`${appOrigin}/react`);
    await page.locator(".badge", { hasText: "Live" }).nth(1).waitFor();
    await page.getByText("You don't have access to this order.").waitFor();
    assert.equal(await page.locator(".badge", { hasText: "Live" }).count(), 2);
  });

  it("fits a phone-width viewport and loads without console or CSP errors", async () => {
    const mobile = await openPage(browser, { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
    await mobile.page.goto(appOrigin);
    await mobile.page.getByRole("button", { name: "Carol" }).click();
    await mobile.page.locator(".badge", { hasText: "Live" }).first().waitFor();
    const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow of ${overflow}px`);
    assert.deepEqual([...problems, ...mobile.problems], []);
  });
});
