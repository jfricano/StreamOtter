import {
  isWorkbenchOperation, PRE_WHC1_NATIVE_OPERATIONS, WORKBENCH_HOST_CONTRACT, WORKBENCH_MOUNT_ELEMENT_ID,
  type WorkbenchHostConfigIssue, type WorkbenchOperation
} from "@streamotter/contracts";
import { ApiError, ManagementApi, type ApiAuth } from "./api.ts";
import { h, pill, replace, UNAVAILABLE_TEXT } from "./dom.ts";
import { readBoot, WORKBENCH_VERSION, type HostSettings } from "./host.ts";
import { candidateDiffers, prettyConfig, type WorkbenchState } from "./state.ts";
import { renderConnect } from "./views/connect.ts";
import { renderDefine } from "./views/define.ts";
import { renderExport } from "./views/export.ts";
import { renderInspect } from "./views/inspect.ts";
import { renderPreview } from "./views/preview.ts";

type Tab = "connect" | "define" | "preview" | "inspect" | "export";
const TABS: [Tab, string][] = [["connect", "Connect"], ["define", "Define"], ["preview", "Preview"], ["inspect", "Inspect"], ["export", "Export"]];

/** WHC-1 §4: what each surface needs. A tab whose operations are not all offered shows as unavailable. */
const SHELL_OPERATIONS: readonly WorkbenchOperation[] = ["config", "health", "channels", "sources"];
const TAB_OPERATIONS: Readonly<Record<Tab, readonly WorkbenchOperation[]>> = {
  connect: ["source-checks"],
  define: ["config.validate"],
  preview: ["dev.principals", "preview-sessions"],
  inspect: ["traces"],
  export: ["config.export"]
};

const app = document.getElementById(WORKBENCH_MOUNT_ELEMENT_ID) as HTMLElement;
/** Set on the mount element when a boot block is present; workbench-host.css scopes every rule under it (WHC-1 §2.1). */
const HOSTED_ATTRIBUTE = "data-streamotter-workbench";

/** A full-page message shown instead of the workbench; makes no requests. */
function renderNotice(title: string, ...body: (Node | string | null)[]): void {
  replace(app, h("main", {}, h("section", { class: "panel stack gate", role: "alert" }, h("h1", {}, title), ...body)));
}

function renderConfigError(issues: readonly WorkbenchHostConfigIssue[]): void {
  renderNotice("Workbench configuration error",
    h("p", {}, "This page's workbench boot block is invalid, so the workbench made no requests. The site that hosts it needs to correct it."),
    h("ul", { class: "issues" }, issues.map(issue => h("li", {}, h("code", {}, issue.path || "/"), ` ${issue.message}`))));
}

function renderUnsupported(reason: string): void {
  renderNotice("Unsupported host contract",
    h("p", {}, `${reason} This workbench (${WORKBENCH_VERSION}) implements host contract ${WORKBENCH_HOST_CONTRACT} only, so it stopped here.`));
}

function renderGate(settings: HostSettings, error?: string): void {
  const input = h("input", { type: "password", autocomplete: "off", spellcheck: "false", required: true, id: "token" });
  const form = h("form", { class: "panel stack gate" },
    h("h1", {}, "StreamOtter Workbench"),
    h("p", { class: "muted" }, "Enter the management token printed by ", h("code", {}, "streamotter dev"), ". It is valid for this run only and is kept in memory; reloading the page asks again."),
    h("label", { for: "token" }, "Management token", input),
    error === undefined ? null : h("div", { class: "banner bad", role: "alert" }, error),
    h("button", { class: "primary", type: "submit" }, "Open workbench"));
  form.addEventListener("submit", event => {
    event.preventDefault();
    void open(settings, { mode: "token", token: input.value.trim() });
  });
  replace(app, h("main", {}, form));
  input.focus();
}

/** Session mode has no token to re-enter; a failure offers a retry instead. */
function renderSessionFailure(settings: HostSettings, message: string): void {
  const retry = h("button", { class: "primary", type: "button" }, "Retry");
  retry.addEventListener("click", () => void open(settings, { mode: "session" }));
  renderNotice("StreamOtter Workbench", h("div", { class: "banner bad" }, message), h("div", { class: "row" }, retry));
}

/** Session mode: the host answered 401 or UNAUTHENTICATED. Nothing to retry until the visitor has a new session. */
function renderSessionEnded(): void {
  const reload = h("button", { class: "primary", type: "button" }, "Reload");
  reload.addEventListener("click", () => location.reload());
  renderNotice("Session ended",
    h("p", {}, "Your session with this environment has ended, so the workbench stopped. Reload the page to continue, or start a new session on the hosting site."),
    h("div", { class: "row" }, reload));
}

/** Learns the offered operations (WHC-1 §4). A 404 means a pre-WHC-1 native server. */
async function discover(api: ManagementApi): Promise<{ operations: Set<WorkbenchOperation>; maxRequestBytes: number | null } | "unsupported"> {
  try {
    const discovery = await api.workbench();
    if (discovery.hostContract !== WORKBENCH_HOST_CONTRACT || !Array.isArray(discovery.operations)) return "unsupported";
    const limit = discovery.limits?.maxRequestBytes;
    return {
      operations: new Set(discovery.operations.filter(isWorkbenchOperation)),
      maxRequestBytes: typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 ? limit : null
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { operations: new Set(PRE_WHC1_NATIVE_OPERATIONS), maxRequestBytes: null };
    throw error;
  }
}

function environmentPill(settings: HostSettings): HTMLSpanElement {
  const { kind, label } = settings.environment;
  const name = kind === "sandbox" ? "Sandbox" : "Development";
  return pill(label === null ? name : `${name} · ${label}`, kind === "sandbox" ? "info" : "neutral");
}

async function open(settings: HostSettings, auth: ApiAuth): Promise<void> {
  let cleanup: (() => void) | null = null;
  const api = new ManagementApi({ apiBase: settings.apiBase, apiOrigin: settings.apiOrigin }, auth, () => {
    cleanup?.();
    cleanup = null;
    renderSessionEnded();
  });
  try {
    const discovered = await discover(api);
    if (discovered === "unsupported") {
      renderUnsupported("The host's discovery endpoint reports a different workbench host contract.");
      return;
    }
    const { operations } = discovered;
    api.restrict(operations, discovered.maxRequestBytes);
    const missingShell = SHELL_OPERATIONS.filter(operation => !operations.has(operation));
    if (missingShell.length > 0) {
      renderNotice("StreamOtter Workbench",
        h("p", {}, `${UNAVAILABLE_TEXT}: the workbench needs operations this host does not offer.`),
        h("p", { class: "muted small" }, "Missing: ", h("code", {}, missingShell.join(", "))));
      return;
    }
    const [config, channels, sources, principals, health] = await Promise.all([
      api.config(), api.channels(), api.sources(),
      operations.has("dev.principals") ? api.principals() : Promise.resolve({ items: [] }),
      api.health()
    ]);
    const state: WorkbenchState = {
      api,
      host: settings,
      can: operation => operations.has(operation),
      gatewayOrigin: settings.gateway?.origin ?? "",
      gatewayPath: settings.gateway?.path ?? "",
      active: config,
      candidateText: prettyConfig(config.config),
      channels: channels.items,
      sources: sources.items,
      principals: principals.items,
      ready: health.ready,
      refreshShell: () => drawTopbar()
    };
    const topbar = h("header", { class: "topbar" });
    const tabs = h("nav", { class: "tabs", role: "tablist", "aria-label": "Workbench sections" });
    const main = h("main", { id: "view", role: "tabpanel" });
    let current: Tab = "connect";

    const drawTopbar = () => replace(topbar,
      h("div", { class: "brand" }, h("h1", {}, "StreamOtter Workbench"), h("small", {}, config.config.projectId)),
      environmentPill(settings),
      h("span", { class: "spacer" }),
      h("span", { class: "muted small" }, "Gateway ", h("code", {}, settings.gateway === null ? "not configured" : state.gatewayOrigin || "unknown")),
      state.ready ? pill("Sources ready", "ok") : pill("Sources not ready", "warn"),
      h("span", { class: "muted small mono", title: `Active configuration sha256:${state.active.fingerprint}` }, `active sha256:${state.active.fingerprint.slice(0, 12)}…`),
      candidateDiffers(state) ? pill("Candidate edited · restart required to apply", "warn") : null);

    const missingFor = (tab: Tab): string[] => {
      const missing: string[] = TAB_OPERATIONS[tab].filter(operation => !operations.has(operation));
      if (tab === "preview" && settings.gateway === null) missing.push("gateway (boot block)");
      return missing;
    };

    const show = (tab: Tab) => {
      cleanup?.();
      cleanup = null;
      current = tab;
      replace(tabs, TABS.map(([id, label]) => {
        const button = h("button", { type: "button", role: "tab", "aria-selected": String(id === current), id: `tab-${id}` }, label);
        button.addEventListener("click", () => show(id));
        return button;
      }));
      main.setAttribute("aria-labelledby", `tab-${tab}`);
      const missing = missingFor(tab);
      if (missing.length > 0) {
        replace(main, h("section", { class: "panel stack" },
          h("h2", {}, TABS.find(([id]) => id === tab)?.[1] ?? tab),
          h("p", { class: "unavailable" }, UNAVAILABLE_TEXT),
          h("p", { class: "muted small" }, "This host does not offer: ", h("code", {}, missing.join(", ")))));
        return;
      }
      switch (tab) {
        case "connect": renderConnect(main, state); break;
        case "define": renderDefine(main, state); break;
        case "preview": renderPreview(main, state); break;
        case "inspect": cleanup = renderInspect(main, state); break;
        case "export": renderExport(main, state); break;
      }
    };

    const { kind, label, detail, packageVersion } = settings.environment;
    // Host-provided strings are inserted as text nodes only (dom.ts), never parsed as markup.
    const sandbox = kind === "sandbox"
      ? h("div", { class: "environment-banner", role: "note", "aria-label": "Environment" }, h("strong", {}, label ?? "Sandbox"), detail === null ? null : h("span", {}, ` ${detail}`))
      : null;
    const mismatch = packageVersion !== null && packageVersion !== WORKBENCH_VERSION
      ? h("div", { class: "banner warn version-mismatch", role: "status" },
        `Version mismatch: this page expects @streamotter/workbench ${packageVersion}, but the loaded workbench is ${WORKBENCH_VERSION}.`)
      : null;
    replace(app, topbar, sandbox, mismatch, tabs, main);
    drawTopbar();
    show("connect");
  } catch (error) {
    if (auth.mode === "token") {
      renderGate(settings, error instanceof ApiError && error.status === 401
        ? "That token was not accepted. Copy it again from the streamotter dev output."
        : `The management API is unavailable: ${(error as Error).message}`);
    } else if (error instanceof ApiError && error.error.code === "UNAUTHENTICATED") {
      renderSessionEnded();
    } else {
      renderSessionFailure(settings, `The workbench API is unavailable: ${(error as Error).message}`);
    }
  }
}

// Runs while app.js is evaluated: the boot block must already be in the document (host.ts, readBoot).
const boot = readBoot();
if (boot.kind !== "ok" || boot.settings.hosted) app.setAttribute(HOSTED_ATTRIBUTE, "");
switch (boot.kind) {
  case "invalid": renderConfigError(boot.issues); break;
  case "unsupported": renderUnsupported(`This page asks for workbench host contract ${boot.hostContract}.`); break;
  case "ok":
    if (boot.settings.auth === "session") void open(boot.settings, { mode: "session" });
    else renderGate(boot.settings);
    break;
}
