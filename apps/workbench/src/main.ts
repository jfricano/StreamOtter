import { ApiError, ManagementApi } from "./api.ts";
import { h, pill, replace } from "./dom.ts";
import { candidateDiffers, prettyConfig, type WorkbenchState } from "./state.ts";
import { renderConnect } from "./views/connect.ts";
import { renderDefine } from "./views/define.ts";
import { renderExport } from "./views/export.ts";
import { renderInspect } from "./views/inspect.ts";
import { renderPreview } from "./views/preview.ts";

type Tab = "connect" | "define" | "preview" | "inspect" | "export";
const TABS: [Tab, string][] = [["connect", "Connect"], ["define", "Define"], ["preview", "Preview"], ["inspect", "Inspect"], ["export", "Export"]];

const app = document.getElementById("app") as HTMLElement;
const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";

function renderGate(error?: string): void {
  const input = h("input", { type: "password", autocomplete: "off", spellcheck: "false", required: true, id: "token" });
  const form = h("form", { class: "panel stack gate" },
    h("h1", {}, "StreamOtter Workbench"),
    h("p", { class: "muted" }, "Enter the management token printed by ", h("code", {}, "streamotter dev"), ". It is valid for this run only and is kept in memory; reloading the page asks again."),
    h("label", { for: "token" }, "Management token", input),
    error === undefined ? null : h("div", { class: "banner bad", role: "alert" }, error),
    h("button", { class: "primary", type: "submit" }, "Open workbench"));
  form.addEventListener("submit", event => {
    event.preventDefault();
    void open(input.value.trim());
  });
  replace(app, h("main", {}, form));
  input.focus();
}

async function open(token: string): Promise<void> {
  const api = new ManagementApi(token);
  try {
    const [config, channels, sources, principals, health] = await Promise.all([
      api.config(), api.channels(), api.sources(), api.principals(), api.health()
    ]);
    const state: WorkbenchState = {
      api,
      gatewayOrigin: meta("streamotter-gateway-origin"),
      gatewayPath: meta("streamotter-gateway-path") || "/streamotter/socket.io",
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
    let cleanup: (() => void) | null = null;

    const drawTopbar = () => replace(topbar,
      h("div", { class: "brand" }, h("h1", {}, "StreamOtter Workbench"), h("small", {}, config.config.projectId)),
      h("span", { class: "spacer" }),
      h("span", { class: "muted small" }, "Gateway ", h("code", {}, state.gatewayOrigin || "unknown")),
      state.ready ? pill("Sources ready", "ok") : pill("Sources not ready", "warn"),
      h("span", { class: "muted small mono", title: `Active configuration sha256:${state.active.fingerprint}` }, `active sha256:${state.active.fingerprint.slice(0, 12)}…`),
      candidateDiffers(state) ? pill("Candidate edited · restart required to apply", "warn") : null);

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
      switch (tab) {
        case "connect": renderConnect(main, state); break;
        case "define": renderDefine(main, state); break;
        case "preview": renderPreview(main, state); break;
        case "inspect": cleanup = renderInspect(main, state); break;
        case "export": renderExport(main, state); break;
      }
    };
    replace(app, topbar, tabs, main);
    drawTopbar();
    show("connect");
  } catch (error) {
    renderGate(error instanceof ApiError && error.status === 401
      ? "That token was not accepted. Copy it again from the streamotter dev output."
      : `The management API is unavailable: ${(error as Error).message}`);
  }
}

renderGate();
