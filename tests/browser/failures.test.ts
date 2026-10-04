/**
 * Browser checks for the workbench Failures tab (spec §10, WHC-1 §4/§5): the built workbench in
 * session mode against createManagementHandler, with the gateway's operator service replaced by a
 * scripted fake. Covers capability gating, list and detail rendering, the revisions actions send,
 * refused results, integrity incidents, untrusted text (F39), and lifecycle wording (F44).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { WORKBENCH_OPERATIONS, type WorkbenchOperation } from "@streamotter/contracts";
import { createManagementHandler } from "@streamotter/gateway/management";
import { FakeOperator, fakeIncidents, HOSTILE_DIAGNOSIS, RAW_MARKER } from "../integration/fake-operator.ts";
import { orderRecord, startHarness, type Harness } from "../integration/harness.ts";
import { launch, openPage } from "./browser.ts";
import type { Browser, Page } from "playwright";

const WORKBENCH = resolve(import.meta.dirname, "../../apps/workbench/dist");
const SHELL: readonly WorkbenchOperation[] = ["health", "sources", "channels", "config", "source-checks", "traces"];
/** Hosts by name: full (every operation), none (no failure operation), readonly (list and detail only). */
const HOSTS: Record<string, readonly WorkbenchOperation[]> = {
  full: WORKBENCH_OPERATIONS,
  none: SHELL,
  readonly: [...SHELL, "failures.list", "failures.show", "operator.status"]
};

describe("workbench Failures tab", { skip: existsSync(resolve(WORKBENCH, "app.js")) ? false : "run pnpm build first" }, () => {
  let h: Harness;
  let fake: FakeOperator;
  let server: Server;
  let origin: string;
  let browser: Browser;
  let page: Page;
  let problems: string[];
  const apiPaths: string[] = [];

  before(async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 40)] });
    fake = new FakeOperator();
    h.internals.operator = () => fake;
    const handlers = new Map(Object.entries(HOSTS).map(([name, operations]) =>
      [name, createManagementHandler({ gateway: h.gateway, operations, authorize: () => true })]));
    const csp = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://host.invalid");
      const match = /^\/wb\/([a-z]+)\/(api(\/.*)|)$/.exec(url.pathname);
      const handler = match === null ? undefined : handlers.get(match[1]!);
      if (match !== null && handler !== undefined && match[3] !== undefined) {
        apiPaths.push(`${match[1]} ${request.method} ${match[3]}${url.search}`);
        void handler(request, response, `${match[3]}${url.search}`);
        return;
      }
      response.setHeader("Content-Security-Policy", csp);
      if (match !== null && handler !== undefined && match[2] === "") {
        const boot = JSON.stringify({ hostContract: 1, apiBase: `/wb/${match[1]}/api`, auth: { mode: "session" }, environment: { kind: "sandbox", label: "Failure fixtures" } });
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Failures</title><link rel="stylesheet" href="/assets/styles.css"></head>
<body><script type="application/json" id="streamotter-workbench-host">${boot}</script><div id="app"></div><script type="module" src="/assets/app.js"></script></body></html>`);
        return;
      }
      const asset = /^\/assets\/(app\.js|styles\.css)$/.exec(url.pathname)?.[1];
      if (asset !== undefined) {
        response.setHeader("Content-Type", asset === "app.js" ? "text/javascript" : "text/css");
        response.end(readFileSync(resolve(WORKBENCH, asset)));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await launch();
    ({ page, problems } = await openPage(browser));
  });
  after(async () => {
    await browser?.close();
    await new Promise<void>(done => { if (server === undefined) done(); else { server.close(() => done()); server.closeAllConnections(); } });
    await h?.close();
  });

  const tab = (name: string) => page.getByRole("tab", { name });
  const incidents = () => page.getByRole("table", { name: "Incidents" });
  const row = (failureId: string) => incidents().locator(`tr[data-failure-id="${failureId}"]`);
  const detail = () => page.getByRole("region", { name: "Incident detail" });
  const fact = (term: string) => detail().locator("dt", { hasText: new RegExp(`^${term}$`) }).locator("xpath=following-sibling::dd[1]");
  const openHost = async (name: string) => {
    await page.goto(`${origin}/wb/${name}/`);
    await page.getByText("Sources ready").waitFor();
  };
  const openFailures = async () => {
    await openHost("full");
    await tab("Failures").click();
    await row("f1:orders:fixture:3").waitFor();
  };
  const openDetail = async (failureId: string) => {
    await row(failureId).getByRole("button", { name: `Details for ${failureId}` }).click();
    await detail().getByRole("heading", { name: failureId }).waitFor();
  };

  it("F44: the Failures tab appears only when discovery lists failures.list", async () => {
    await openHost("none");
    assert.equal(await tab("Failures").count(), 0);
    assert.equal(await tab("Inspect").count(), 1);
    h.internals.operator = () => null;
    try {
      await openHost("full");
      assert.equal(await tab("Failures").count(), 0, "a gateway without an operator service does not list the failure operations");
    } finally {
      h.internals.operator = () => fake;
    }
    await openHost("full");
    await tab("Failures").waitFor();
    assert.deepEqual(apiPaths.filter(path => path.startsWith("none ") && /failures|operator/.test(path)), [], "never called where unlisted");
  });

  it("F44: lists the incidents with captured, quarantined, advanced and recovered kept distinct", async () => {
    await openFailures();
    assert.equal(await incidents().locator("tbody tr").count(), 5);
    const cells = async (failureId: string) => (await row(failureId).locator("td").allInnerTexts()).map(text => text.trim());
    const quarantined = await cells("f1:orders:fixture:3");
    assert.match(quarantined[0]!, /f1:orders:fixture:3/);
    assert.deepEqual(quarantined.slice(1, 3), ["orders", "validate invalid-json"]);
    assert.equal(await row("f1:orders:fixture:3").locator("td").nth(3).getAttribute("title"), "2026-10-03T12:01:00.000Z");
    assert.equal(await row("f1:orders:fixture:3").locator("td").nth(4).getAttribute("title"), "2026-10-03T12:02:00.000Z");
    assert.deepEqual(quarantined.slice(5), ["3", "quarantine-hold", "acknowledged", "held", "not-applicable", "open"]);
    assert.deepEqual((await cells("f1:orders:fixture:7")).slice(6), ["quarantine-resync", "acknowledged", "advanced", "boundary-in-force", "resolved · advanced"]);
    assert.deepEqual((await cells("f1:ledger:fixture:9")).slice(6), ["pause", "not-required", "held", "not-applicable", "open"]);
    assert.deepEqual((await cells("f1:notes:fixture:2")).slice(6), ["pause", "not-required", "processed", "not-applicable", "resolved · processed"]);
    for (const failureId of ["f1:orders:fixture:3", "f1:ledger:fixture:9", "f1:notes:fixture:5"]) {
      assert.doesNotMatch((await cells(failureId)).join(" "), /resolved/, `${failureId} is open and never called resolved`);
    }
    assert.deepEqual(fake.callsOf("listFailures").at(-1), { state: "all", limit: 20 });
  });

  it("F39: detail explains the incident and renders markup in a diagnosis as text; no raw bytes", async () => {
    fake.leakRaw = true; // The route drops raw evidence even if the service offered it.
    await openDetail("f1:orders:fixture:3");
    assert.equal(await detail().getByLabel("Diagnosis").innerText(), HOSTILE_DIAGNOSIS);
    assert.equal(await detail().locator("img, b, script").count(), 0, "server text never becomes markup");
    assert.equal(await page.evaluate(() => (window as unknown as { __failureXss?: number }).__failureXss), undefined);
    assert.equal(await fact("What failed").innerText(), "The record's value is not valid JSON.");
    assert.equal(await fact("Disposition").innerText(), "Quarantined, and the source is held at the record (quarantine-hold).");
    assert.equal(await fact("What snapshots must establish").innerText(), "Nothing for this incident.");
    assert.match(await fact("Next action").innerText(), /Evaluate the record .* evaluate$/);
    assert.equal(await fact("Evidence captured").innerText(), "Local fixture evidence, not Kafka (complete).");
    assert.match(await fact("Quarantine write").innerText(), /^acknowledged A quarantine copy was written/);
    assert.match(await fact("Source position").innerText(), /^held The source is held at this record/);
    assert.match(await fact("Snapshot recovery").innerText(), /^not-applicable/);
    assert.equal(await fact("Incident state").innerText(), "open");
    assert.equal(await fact("Revision").innerText(), "4");
    assert.match(await detail().getByRole("list", { name: "Incident history" }).innerText(), /detected[\s\S]*quarantined local fixture spool[\s\S]*held/);
    const text = await page.locator("body").innerText();
    assert.ok(!text.includes(RAW_MARKER) && !text.includes("valueBase64"), "raw evidence is never displayed");
    for (const call of fake.callsOf("showFailure")) assert.deepEqual(Object.keys(call as object), ["failureId"], "never asks for raw");
    fake.leakRaw = false;
  });

  it("F44: the advanced incident shows its boundary and guard, and is not presented as recovered", async () => {
    await openDetail("f1:orders:fixture:7");
    assert.equal(await fact("Incident state").innerText(), "resolved · advanced");
    assert.match(await fact("Source position").innerText(), /^advanced The source position advanced past the record without processing it/);
    assert.match(await fact("Snapshot recovery").innerText(), /^boundary-in-force A recovery boundary is in force: snapshots must acknowledge it/);
    assert.equal(await fact("What snapshots must establish").innerText(), "Snapshots must acknowledge boundary b-orders-2 before subscriptions recover.");
    assert.match(await fact("Boundary").innerText(), /b-orders-2 · revision 2 · in-force · retires on generation/);
    assert.match(await fact("Guard").innerText(), /^recoverable · snapshot handler acknowledges the boundary/);
    assert.equal(await fact("Quarantine coordinates").innerText(), "partition 0 offset 17");
    assert.equal(await detail().getByRole("button", { name: /Retry|Reassess/ }).count(), 0, "nothing to retry once it advanced");
  });

  it("F44: operator status warns about the memory store and never shows a connected source as success", async () => {
    const status = page.getByRole("region", { name: "Operator status" });
    await status.getByText("The memory incident store is not durable.").waitFor();
    const orders = status.getByRole("row", { name: /^orders/ });
    const connection = orders.locator("td").nth(1).locator(".pill");
    assert.equal(await connection.innerText(), "healthy");
    assert.doesNotMatch(await connection.getAttribute("class") ?? "", /\bok\b/, "a connected source is not a success indicator");
    assert.match(await status.innerText(), /not subscription health/);
    assert.match(await orders.innerText(), /f1:orders:fixture:3[\s\S]*revision 4[\s\S]*closed[\s\S]*b-orders-2/);
    assert.match(await status.getByRole("row", { name: /^notes/ }).innerText(), /open[\s\S]*5 of 5 automatic advances in 60 s · revision 7/);
  });

  it("retry sends the displayed revision, never a newer one, and shows a refused result verbatim", async () => {
    fake.incidents.find(item => item.failureId === "f1:orders:fixture:3")!.revision = 11;
    await openDetail("f1:orders:fixture:3");
    assert.equal(await fact("Revision").innerText(), "11");
    fake.incidents.find(item => item.failureId === "f1:orders:fixture:3")!.revision = 12; // Changed elsewhere after it was displayed.
    await detail().getByRole("button", { name: "Retry current record" }).click();
    const refused = detail().locator(".operation-result");
    await refused.getByText("Retry current record: refused").waitFor();
    assert.match(await refused.innerText(), /^Retry current record: refused · outcome stale-revision\nThe incident is at revision 12\.\noperation op-\d+ · incident revision 12$/);
    assert.deepEqual(fake.callsOf("retryCurrent").at(-1), { sourceId: "orders", failureId: "f1:orders:fixture:3", expectedRevision: 11 });
    await fact("Revision").getByText("12", { exact: true }).waitFor();
    await detail().getByRole("button", { name: "Retry current record" }).click();
    await detail().locator(".operation-result").getByText("Retry current record: completed").waitFor();
    assert.deepEqual(fake.callsOf("retryCurrent").at(-1), { sourceId: "orders", failureId: "f1:orders:fixture:3", expectedRevision: 12 });
    assert.equal(await detail().getByRole("button", { name: "Reassess" }).count(), 0, "quarantine-hold incidents are not reassessed");
  });

  it("an integrity incident offers repair-and-retry and no skip or advance control", async () => {
    await openDetail("f1:ledger:fixture:9");
    assert.match(await detail().getByRole("note").innerText(), /Integrity failure \(revision-conflict\)\. StreamOtter never skips it/);
    await detail().getByRole("button", { name: "Retry after repair" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /skip|advance|retire/i }).count(), 0, "no skip, advance or retire-boundary control anywhere");
    assert.equal(await fact("Evidence captured").innerText(), "Not captured (unavailable).");
    await detail().getByRole("button", { name: "Retry after repair" }).click();
    await detail().locator(".operation-result").getByText("Retry after repair: completed").waitFor();
    assert.deepEqual(fake.callsOf("retryCurrent").at(-1), { sourceId: "ledger", failureId: "f1:ledger:fixture:9", expectedRevision: 2 });
  });

  it("reassess is offered only for a held quarantine-resync incident and sends its revision", async () => {
    await openDetail("f1:notes:fixture:5");
    await detail().getByRole("button", { name: "Reassess" }).click();
    await detail().locator(".operation-result").getByText("Reassess: completed").waitFor();
    assert.deepEqual(fake.callsOf("reassess"), [{ sourceId: "notes", failureId: "f1:notes:fixture:5", expectedRevision: 3 }]);
  });

  it("evaluate shows the result, and redrive sends exactly the issued plan", async () => {
    fake.evaluation = {
      validation: "valid", errors: [], eligible: true, ineligibleReason: null,
      outputs: [{ channel: "orderStatus", channelVersion: 1, routing: "privileged", revision: "12" }],
      plan: { planId: "plan-7f3a", fingerprint: "sha256:9c1e", expiresAt: "2026-10-03T12:35:00.000Z" }
    };
    await openDetail("f1:orders:fixture:7");
    await detail().getByRole("button", { name: "Evaluate" }).click();
    const evaluation = detail().getByRole("region", { name: "Evaluation result" });
    await evaluation.waitFor();
    assert.match(await evaluation.innerText(), /plan-7f3a · sha256:9c1e[\s\S]*2026-10-03T12:35:00\.000Z[\s\S]*not evidence that any browser received anything[\s\S]*orderStatus v1 · revision 12/);
    assert.deepEqual(fake.callsOf("evaluate").at(-1), { failureId: "f1:orders:fixture:7", expectedRevision: 9 });
    await evaluation.getByRole("button", { name: "Redrive this plan" }).click();
    await evaluation.locator(".operation-result").getByText("Redrive: completed").waitFor();
    assert.deepEqual(fake.callsOf("redrive"), [{ failureId: "f1:orders:fixture:7", planId: "plan-7f3a", planFingerprint: "sha256:9c1e", expectedRevision: 9 }]);

    fake.evaluation = { ...fake.evaluation, validation: "invalid", eligible: false, ineligibleReason: "the handler still rejects the record", plan: null,
      errors: [{ stage: "map", failureClass: "payload-schema", message: "progress must be at most 100" }] };
    await detail().getByRole("button", { name: "Evaluate" }).click();
    await detail().getByText("No: the handler still rejects the record").waitFor();
    assert.equal(await detail().getByRole("button", { name: /Redrive/ }).count(), 0, "no plan, no redrive");
    fake.evaluation = null;
  });

  it("export shows a metadata-only bundle", async () => {
    fake.leakRaw = true;
    await openDetail("f1:orders:fixture:3");
    await detail().getByRole("button", { name: "Export metadata bundle" }).click();
    const bundle = detail().getByLabel("Reproduction bundle");
    await bundle.waitFor();
    const text = await bundle.innerText();
    assert.equal(JSON.parse(text).incident.failureId, "f1:orders:fixture:3");
    assert.ok(!text.includes(RAW_MARKER) && !text.includes("\"raw\""));
    assert.deepEqual(fake.callsOf("exportFailure").at(-1), { failureId: "f1:orders:fixture:3" });
    fake.leakRaw = false;
  });

  it("revokes the previous export's download URL when exporting again", async () => {
    await page.evaluate(() => {
      const revoked: string[] = [];
      const original = URL.revokeObjectURL.bind(URL);
      (window as unknown as { __revoked: string[] }).__revoked = revoked;
      URL.revokeObjectURL = url => { revoked.push(url); original(url); };
    });
    const href = () => page.evaluate(() => document.querySelector("a[download]")?.getAttribute("href") ?? null);
    const exportAgain = async () => {
      const previous = await href();
      await detail().getByRole("button", { name: "Export metadata bundle" }).click();
      await page.waitForFunction(old => (document.querySelector("a[download]")?.getAttribute("href") ?? null) !== old, previous);
      return (await href())!;
    };
    const first = await exportAgain();
    const second = await exportAgain();
    assert.ok(first.startsWith("blob:") && second.startsWith("blob:") && first !== second);
    const revoked = await page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked);
    assert.equal(revoked.at(-1), first, "the replaced URL is revoked");
    assert.ok(!revoked.includes(second), "the URL on the page stays usable");
  });

  it("an older detail response that arrives last never replaces a newer one", async () => {
    const failureId = "f1:orders:fixture:3";
    const incident = () => fake.incidents.find(item => item.failureId === failureId)!;
    await openDetail(failureId);
    let release!: () => void;
    const released = new Promise<void>(done => { release = done; });
    let held = 0;
    let delivered!: () => void;
    const stale = new Promise<void>(done => { delivered = done; });
    await page.route(url => url.pathname.endsWith(`/failures/${encodeURIComponent(failureId)}`), async route => {
      if (held++ > 0) return route.continue();
      const response = await route.fetch(); // Answered at the older revision, then held back.
      await released;
      await route.fulfill({ response });
      delivered();
    });
    try {
      incident().revision = 20;
      await page.getByRole("button", { name: "Refresh" }).click();
      while (held === 0) await page.waitForTimeout(20);
      incident().revision = 21;
      await page.getByRole("button", { name: "Refresh" }).click();
      await fact("Revision").getByText("21", { exact: true }).waitFor();
      release();
      await stale;
      await page.waitForTimeout(200);
      assert.equal(await fact("Revision").innerText(), "21", "the older response was dropped");
    } finally {
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  it("reopen circuit requires a reason and sends the displayed circuit revision", async () => {
    const status = page.getByRole("region", { name: "Operator status" });
    const notes = status.getByRole("row", { name: /^notes/ });
    await notes.getByRole("button", { name: "Reopen circuit" }).click();
    await status.getByText("A reason is required to reopen a circuit.").waitFor();
    assert.deepEqual(fake.callsOf("reopenCircuit"), []);
    await notes.getByLabel("Reason to reopen the circuit of notes").fill("producer fixed in release 42");
    await notes.getByRole("button", { name: "Reopen circuit" }).click();
    await status.getByText("Reopen circuit of notes: completed").waitFor();
    assert.deepEqual(fake.callsOf("reopenCircuit"), [{ sourceId: "notes", expectedCircuitRevision: 7, reason: "producer fixed in release 42" }]);
    await status.getByRole("row", { name: /^notes/ }).getByText("closed", { exact: true }).waitFor();
  });

  it("filters by source and state and pages with the cursor", async () => {
    const extra = fakeIncidents()[2]!;
    for (let index = 0; index < 25; index += 1) {
      fake.incidents.push({ ...structuredClone(extra), failureId: `f1:bulk:fixture:${index}`, sourceId: "bulk" });
    }
    fake.statusData = { ...fake.statusData, sources: [...fake.statusData.sources, { ...structuredClone(fake.statusData.sources[1]!), sourceId: "bulk", heldIncident: null }] };
    await openFailures();
    await page.locator('select[aria-label="Filter failures by source"] option[value="bulk"]').waitFor({ state: "attached" });
    await page.getByLabel("Filter failures by source").selectOption("bulk");
    await page.getByLabel("Filter failures by state").selectOption("open");
    await row("f1:bulk:fixture:19").waitFor();
    assert.equal(await incidents().locator("tbody tr").count(), 20);
    await page.getByRole("button", { name: "Next page" }).click();
    await row("f1:bulk:fixture:24").waitFor();
    assert.equal(await incidents().locator("tbody tr").count(), 5);
    assert.equal(await page.getByRole("button", { name: "Next page" }).isDisabled(), true);
    assert.deepEqual(fake.callsOf("listFailures").at(-1), { sourceId: "bulk", state: "open", limit: 20, cursor: "c:20" });
    await page.getByRole("button", { name: "Previous page" }).click();
    await row("f1:bulk:fixture:0").waitFor();
    assert.deepEqual(fake.callsOf("listFailures").at(-1), { sourceId: "bulk", state: "open", limit: 20 });
  });

  it("a host without the action operations shows them as unavailable and never calls them", async () => {
    fake = new FakeOperator();
    await openHost("readonly");
    await tab("Failures").click();
    await row("f1:orders:fixture:3").waitFor();
    await openDetail("f1:orders:fixture:3");
    for (const name of ["Retry current", "Evaluate", "Export"]) {
      await detail().getByText(`${name}: Not available in this environment`).waitFor();
    }
    await page.getByRole("region", { name: "Operator status" }).getByText("Reopen circuit: Not available in this environment").waitFor();
    assert.equal(await page.getByRole("button", { name: /Retry|Evaluate|Export|Reopen|Redrive|Reassess/ }).count(), 0);
    assert.deepEqual([...new Set(fake.calls.map(call => call.op))].sort(), ["listFailures", "showFailure", "status"]);
    assert.deepEqual(apiPaths.filter(path => path.startsWith("readonly POST")), []);
  });

  it("loads without console errors or CSP violations", () => {
    assert.deepEqual(problems, []);
  });
});
