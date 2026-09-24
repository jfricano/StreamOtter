import type { Trace } from "@streamotter/contracts";
import { ApiError } from "../api.ts";
import { h, pill, replace, short, time } from "../dom.ts";
import type { WorkbenchState } from "../state.ts";

const STAGES: [Trace["stage"], string][] = [
  ["source", "A record was read from the source."],
  ["validate", "Size, encoding, and JSON checks. Rejections pause the source."],
  ["map", "Your map handler selected public state. Filtered means it returned no outputs."],
  ["authorize", "A handshake or subscription was authorized or rejected."],
  ["snapshot", "Your snapshot handler returned authoritative state for a subscription."],
  ["queue", "Admission into a subscription's bounded buffer. Filtered: older or duplicate revision. Rejected: overflow."],
  ["send", "A data frame was sent to the SDK."],
  ["receipt", "The SDK confirmed receipt of a frame (not application processing or rendering)."],
  ["commit", "Source progress was committed after processing. Not evidence of browser delivery."]
];
const OUTCOME_TONE = { ok: "ok", filtered: "neutral", rejected: "warn", failed: "bad" } as const;
const MAX_ROWS = 1_000;

export function renderInspect(root: HTMLElement, state: WorkbenchState): () => void {
  const rows: Trace[] = [];
  let cursor: string | undefined;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tbody = h("tbody");
  const message = h("div");
  const source = h("select", { "aria-label": "Filter by source" }, h("option", { value: "" }, "All sources"), state.sources.map(item => h("option", { value: item.sourceId }, item.sourceId)));
  const channel = h("select", { "aria-label": "Filter by channel" }, h("option", { value: "" }, "All channels"), state.channels.map(item => h("option", { value: item.name }, item.name)));
  const outcome = h("select", { "aria-label": "Filter by outcome" }, h("option", { value: "" }, "All outcomes"), ["ok", "filtered", "rejected", "failed"].map(value => h("option", { value }, value)));
  const live = h("input", { type: "checkbox", checked: true, "aria-label": "Follow new traces" });

  const draw = () => replace(tbody, rows.length === 0
    ? h("tr", {}, h("td", { colspan: 7, class: "muted" }, "No traces yet. Start a preview or advance a fixture to see records move through the stages."))
    : [...rows].reverse().map(trace => h("tr", {},
      h("td", { class: "mono small" }, time(trace.at)),
      h("td", {}, h("code", {}, trace.stage)),
      h("td", {}, pill(trace.outcome, OUTCOME_TONE[trace.outcome])),
      h("td", {}, trace.sourceId ?? ""),
      h("td", {}, trace.channel ?? ""),
      h("td", { class: "mono small", title: trace.subscriptionId ?? "" }, short(trace.subscriptionId)),
      h("td", { class: "mono small" }, trace.errorCode ?? ""))));

  const load = async (reset: boolean) => {
    if (reset) {
      rows.length = 0;
      cursor = undefined;
    }
    try {
      const page = await state.api.traces({ limit: cursor === undefined ? 200 : 500, ...(cursor === undefined ? {} : { cursor }), sourceId: source.value, channel: channel.value, outcome: outcome.value });
      rows.push(...page.items);
      if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
      if (page.nextCursor !== null) cursor = page.nextCursor;
      replace(message);
      draw();
    } catch (error) {
      if (error instanceof ApiError && error.error.code === "TRACE_CURSOR_EXPIRED") {
        replace(message, h("div", { class: "banner warn" }, "Older traces were evicted from the bounded buffer; showing the latest."));
        await load(true);
        return;
      }
      replace(message, h("div", { class: "banner bad" }, (error as Error).message));
    }
  };

  const setLive = () => {
    if (timer !== null) clearInterval(timer);
    timer = live.checked ? setInterval(() => void load(false), 1_000) : null;
  };
  for (const filter of [source, channel, outcome]) filter.addEventListener("change", () => void load(true));
  live.addEventListener("change", setLive);
  const reload = h("button", { type: "button" }, "Reload latest");
  reload.addEventListener("click", () => void load(true));

  replace(root,
    h("section", { class: "panel stack" },
      h("div", {},
        h("h2", {}, "Inspect"),
        h("p", { class: "lede" }, "Recent trace metadata from the gateway's bounded in-memory buffer. Payloads and credentials are never captured; traces are diagnostics, not a recovery log.")),
      h("div", { class: "row" }, source, channel, outcome, h("label", { class: "row" }, live, h("span", {}, "Follow")), reload),
      message,
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Time", "Stage", "Outcome", "Source", "Channel", "Subscription", "Error"].map(label => h("th", {}, label)))),
        tbody))),
    h("section", { class: "panel" }, h("h3", {}, "Stages"), h("dl", { class: "explain" }, STAGES.flatMap(([stage, text]) => [h("dt", {}, h("code", {}, stage)), h("dd", {}, text)]))));
  draw();
  void load(true);
  setLive();
  return () => { if (timer !== null) clearInterval(timer); };
}
