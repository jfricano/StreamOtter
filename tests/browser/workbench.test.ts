/**
 * Browser checks for the workbench (built assets in apps/workbench/dist) served by the
 * development management server, driving a real gateway and the SDK preview path.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { canonicalJson } from "@streamotter/contracts";
import { startManagementServer, type ManagementServer } from "@streamotter/gateway/management";
import { FAR_FUTURE, orderRecord, startHarness, type Harness } from "../integration/harness.ts";
import { launch, openPage } from "./browser.ts";
import type { Browser, Page } from "playwright";

const WORKBENCH = resolve(import.meta.dirname, "../../apps/workbench/dist");
const TOKEN = "browser-test-management-token-0123456789";

describe("workbench in a browser", { skip: existsSync(resolve(WORKBENCH, "index.html")) ? false : "run pnpm build first" }, () => {
  let h: Harness;
  let m: ManagementServer;
  let browser: Browser;
  let page: Page;
  let problems: string[];

  before(async () => {
    h = await startHarness({
      principals: { alice: { subject: "alice", tenantId: "acme", sessionId: "dev-alice", expiresAt: FAR_FUTURE, claims: {} } },
      fixtures: [orderRecord("acme", "ord_1", 2, "processing", 40), orderRecord("acme", "ord_1", 3, "done", 100)]
    });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    m = await startManagementServer({ gateway: h.gateway, port: 0, token: TOKEN, workbenchDir: WORKBENCH });
    browser = await launch();
    ({ page, problems } = await openPage(browser));
  });
  after(async () => {
    await browser?.close();
    await m?.close();
    await h?.close();
  });

  const tab = (name: string) => page.getByRole("tab", { name });

  it("rejects a wrong token and opens with the per-run token", async () => {
    await page.goto(`${m.origin}/`);
    await page.getByLabel("Management token").fill("not-the-token");
    await page.getByRole("button", { name: "Open workbench" }).click();
    await page.getByRole("alert").filter({ hasText: "not accepted" }).waitFor();
    await page.getByLabel("Management token").fill(TOKEN);
    await page.getByRole("button", { name: "Open workbench" }).click();
    await page.getByText("Sources ready").waitFor();
    assert.equal(await tab("Connect").getAttribute("aria-selected"), "true");
    problems.length = 0; // The deliberate wrong-token attempt logged expected 401 responses.
  });

  it("Connect shows source status and staged checks", async () => {
    await page.getByRole("row", { name: /orders/ }).getByText("healthy").waitFor();
    await page.getByRole("button", { name: "Check connection" }).click();
    await page.getByText("Connection check: orders").waitFor();
    assert.match(await page.locator(".steps").innerText(), /resolve[\s\S]*metadata/);
  });

  it("Preview subscribes through the gateway, applies updates, and recovers from a disconnect", async () => {
    await tab("Preview").click();
    await page.getByLabel("Development principal").selectOption("alice");
    await page.getByLabel("Channel").selectOption("orderStatus");
    await page.getByRole("textbox", { name: /orderId/ }).fill("ord_1");
    await page.getByRole("button", { name: "Start preview" }).click();
    await page.locator(".pill", { hasText: "live" }).first().waitFor();
    await page.getByText("revision 1", { exact: true }).waitFor();

    await page.getByRole("button", { name: 'Advance "orders" by 1' }).click();
    await page.getByText("revision 2", { exact: true }).waitFor();

    h.app.put("acme", "alice", "ord_1", 3, "done", 100); // The application's store moves on while disconnected.
    await h.advance(1);
    await page.getByText("revision 3", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Disconnect this preview" }).click();
    await page.getByText("Subscription stale.").waitFor();
    await page.getByText("Snapshot at revision 3.").waitFor();
    await page.locator(".pill", { hasText: "live" }).first().waitFor();
    const activity = await page.getByRole("list", { name: "Preview activity" }).innerText();
    assert.ok(activity.indexOf("Snapshot at revision 3.") < activity.indexOf("Subscription stale."), "newest first: stale, then the fresh snapshot");
  });

  it("Inspect lists the stages a record passed through", async () => {
    await tab("Inspect").click();
    const table = page.locator("tbody");
    for (const stage of ["source", "validate", "map", "queue", "send", "receipt", "commit", "snapshot", "authorize"]) {
      await table.locator("code", { hasText: new RegExp(`^${stage}$`) }).first().waitFor();
    }
    await page.getByLabel("Filter by outcome").selectOption("failed");
    await page.getByText("No traces yet").waitFor();
  });

  it("Define marks an edited candidate as requiring a restart and validates it", async () => {
    await tab("Define").click();
    const editor = page.getByLabel("Candidate configuration JSON");
    const candidate = JSON.parse(await editor.inputValue()) as Record<string, unknown>;
    candidate["projectId"] = "renamed-project";
    await editor.fill(JSON.stringify(candidate, null, 2));
    await page.getByText("Candidate edited · restart required to apply").waitFor();
    await page.getByRole("button", { name: "Validate candidate" }).click();
    await page.getByText(/^Valid\./).waitFor();
    candidate["commands"] = {};
    await editor.fill(JSON.stringify(candidate, null, 2));
    await page.getByRole("button", { name: "Validate candidate" }).click();
    await page.getByText(/Commands are a V3 feature/).waitFor();
    delete candidate["commands"];
    await editor.fill(JSON.stringify(candidate, null, 2));
  });

  it("Export returns canonical content whose fingerprint matches the CLI's algorithm", async () => {
    await tab("Export").click();
    await page.getByRole("button", { name: "Export candidate" }).click();
    await page.getByText("Restart required.").waitFor();
    const content = await page.getByLabel("Canonical content").innerText();
    const expected = createHash("sha256").update(canonicalJson(JSON.parse(content))).digest("hex");
    await page.getByText(`sha256:${expected}`, { exact: true }).waitFor();
    assert.equal(JSON.parse(content).projectId, "renamed-project");
    const download = page.getByRole("link", { name: "Download streamotter.json" });
    assert.equal(await download.getAttribute("download"), "streamotter.json");
  });

  it("keeps the token only in memory and loads without console or CSP errors", async () => {
    await page.reload();
    await page.getByLabel("Management token").waitFor();
    const stored = await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]);
    assert.deepEqual(stored, [0, 0, ""]);
    assert.ok(!(await page.content()).includes(TOKEN));
    assert.deepEqual(problems, []);
  });
});
