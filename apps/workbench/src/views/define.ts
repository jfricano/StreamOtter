import type { Schema } from "@streamotter/contracts";
import { ApiError } from "../api.ts";
import { h, pill, replace } from "../dom.ts";
import { candidateDiffers, prettyConfig, type WorkbenchState } from "../state.ts";

function describeSchema(schema: Schema | undefined): string {
  if (schema === undefined) return "unknown schema";
  if (schema.type !== "object") return schema.type;
  return Object.entries(schema.properties).map(([name, child]) => {
    const optional = schema.required.includes(name) ? "" : "?";
    const type = child.type === "string" && child.enum !== undefined ? child.enum.map(value => JSON.stringify(value)).join(" | ") : child.type;
    return `${name}${optional}: ${type}`;
  }).join(", ");
}

export function renderDefine(root: HTMLElement, state: WorkbenchState): void {
  const editor = h("textarea", { spellcheck: "false", "aria-label": "Candidate configuration JSON" });
  editor.value = state.candidateText;
  const status = h("div");
  const report = h("div");

  const drawStatus = () => {
    replace(status, candidateDiffers(state)
      ? h("div", { class: "banner warn", role: "status" },
        h("strong", {}, "Candidate only. "),
        `The running gateway still uses the active configuration (sha256:${state.active.fingerprint.slice(0, 12)}…). `,
        "Export the candidate from the Export tab, save it as streamotter.json, and restart streamotter dev to apply it.")
      : h("div", { class: "banner info", role: "status" }, "The candidate matches the active configuration."));
  };

  editor.addEventListener("input", () => {
    state.candidateText = editor.value;
    drawStatus();
    state.refreshShell();
  });

  const validate = h("button", { class: "primary", type: "button" }, "Validate candidate");
  validate.addEventListener("click", async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editor.value);
    } catch (error) {
      replace(report, h("div", { class: "banner bad", role: "alert" }, `Not valid JSON: ${(error as Error).message}`));
      return;
    }
    try {
      const result = await state.api.validate(parsed as never);
      replace(report, result.valid
        ? h("div", { class: "banner info" }, "Valid. Structural, schema, and reference checks passed. Handlers and brokers were not contacted.")
        : h("div", { class: "banner bad", role: "alert" },
          h("strong", {}, `${result.issues.length} issue(s)`),
          h("ul", { class: "issues" }, result.issues.map(issue => h("li", {}, h("code", {}, issue.path || "/"), ` ${issue.code}: ${issue.message}`)))));
    } catch (error) {
      replace(report, h("div", { class: "banner bad", role: "alert" }, error instanceof ApiError ? error.error.message : (error as Error).message));
    }
  });
  const reset = h("button", { type: "button" }, "Reset to active");
  reset.addEventListener("click", () => {
    state.candidateText = prettyConfig(state.active.config);
    editor.value = state.candidateText;
    replace(report);
    drawStatus();
    state.refreshShell();
  });

  const config = state.active.config;
  replace(root,
    h("section", { class: "panel stack" },
      h("div", {},
        h("h2", {}, "Define"),
        h("p", { class: "lede" }, "Channels are the application contract browsers subscribe to. They are independent of topic names; each has one deployed version, a parameter schema, a payload schema, and trusted handlers registered in server code.")),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Channel"), h("th", {}, "Version"), h("th", {}, "Source"), h("th", {}, "Parameters"), h("th", {}, "Payload"), h("th", {}, "Delivery"))),
        h("tbody", {}, state.channels.map(channel => h("tr", {},
          h("td", {}, h("strong", {}, channel.name)),
          h("td", {}, String(channel.version)),
          h("td", {}, channel.source),
          h("td", {}, h("code", {}, channel.paramsSchema), h("div", { class: "muted small mono" }, describeSchema(config.schemas[channel.paramsSchema]))),
          h("td", {}, h("code", {}, channel.payloadSchema), h("div", { class: "muted small mono" }, describeSchema(config.schemas[channel.payloadSchema]))),
          h("td", {}, pill("state · resync on overflow", "neutral")))))))),
    h("section", { class: "panel stack" },
      h("div", { class: "row" }, h("h3", {}, "Candidate configuration"), h("span", { class: "muted small" }, "Edits here are never applied to the running gateway.")),
      status,
      editor,
      h("div", { class: "row" }, validate, reset),
      report));
  drawStatus();
}
