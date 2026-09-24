import { ApiError } from "../api.ts";
import { h, pill, replace } from "../dom.ts";
import { sourceTone, type WorkbenchState } from "../state.ts";

const STEP_ICON = { ok: "✓", failed: "✗", skipped: "–" } as const;

export function renderConnect(root: HTMLElement, state: WorkbenchState): void {
  const table = h("tbody");
  const results = h("div", { class: "stack" });

  const refresh = async () => {
    try {
      const [{ items }, health] = await Promise.all([state.api.sources(), state.api.health()]);
      state.sources = items;
      state.ready = health.ready;
      state.refreshShell();
      draw();
    } catch (error) {
      replace(results, h("div", { class: "banner bad" }, (error as Error).message));
    }
  };

  const showSteps = (sourceId: string, steps: { stage: string; outcome: "ok" | "failed" | "skipped"; message: string }[]) => {
    const failed = steps.find(step => step.outcome === "failed");
    replace(results, h("section", { class: "panel" },
      h("h3", {}, `Connection check: ${sourceId}`),
      failed === undefined
        ? h("p", { class: "muted" }, "Every stage that applies to this source succeeded.")
        : h("p", {}, "The first failing stage is ", h("strong", {}, failed.stage), ". Later stages were skipped."),
      h("ul", { class: "steps" }, steps.map(step => h("li", {},
        h("span", { class: step.outcome, "aria-label": step.outcome }, STEP_ICON[step.outcome]),
        h("span", { class: "mono" }, step.stage),
        h("span", {}, step.message))))));
  };

  const action = (label: string, run: () => Promise<void>, primary = false) => {
    const button = h("button", { class: primary ? "primary" : "", type: "button" }, label);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await run();
      } catch (error) {
        const message = error instanceof ApiError ? `${error.error.code}: ${error.error.message}` : (error as Error).message;
        replace(results, h("div", { class: "banner bad", role: "alert" }, message));
      } finally {
        button.disabled = false;
      }
    });
    return button;
  };

  const draw = () => {
    replace(table, state.sources.map(source => {
      const config = state.active.config.sources[source.sourceId];
      const detail = config?.kind === "kafka"
        ? `${config.topics.join(", ")} · group ${config.consumerGroup} · ${config.startFrom}`
        : config?.kind === "fixture" ? `fixture "${config.fixtureRef}"` : "";
      const advanceCount = h("input", { type: "number", min: 1, max: 100, value: 1, "aria-label": `Records to advance for ${source.sourceId}`, class: "small" });
      return h("tr", {},
        h("td", {}, h("strong", {}, source.sourceId), h("div", { class: "muted small" }, detail)),
        h("td", {}, source.kind),
        h("td", {}, pill(source.status, sourceTone(source.status)), source.reason === undefined ? null : h("div", { class: "small mono" }, source.reason)),
        h("td", {}, h("div", { class: "row" },
          action("Check connection", async () => showSteps(source.sourceId, (await state.api.checkSource(source.sourceId)).steps)),
          source.status === "paused" ? action("Resume at uncommitted position", async () => {
            await state.api.resumeSource(source.sourceId);
            await refresh();
          }, true) : null,
          source.kind === "fixture" ? [advanceCount, action("Advance fixture", async () => {
            const { advanced } = await state.api.advance(source.sourceId, Number(advanceCount.value));
            replace(results, h("div", { class: "banner info" }, `Advanced ${advanced} record(s) of "${source.sourceId}". See Inspect for their path.`));
            await refresh();
          })] : null)));
    }));
  };

  replace(root,
    h("section", { class: "panel stack" },
      h("div", {},
        h("h2", {}, "Connect"),
        h("p", { class: "lede" }, "Sources are configured stream connections. A check reports each stage—resolve, connect, TLS, authenticate, metadata—so a failure names where it stopped. Credentials are referenced by environment variable and never shown.")),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Source"), h("th", {}, "Kind"), h("th", {}, "Status"), h("th", {}, "Actions"))),
        table)),
      h("div", { class: "row" }, action("Refresh", refresh))),
    results,
    h("section", { class: "panel" },
      h("h3", {}, "What the statuses mean"),
      h("dl", { class: "explain" },
        h("dt", {}, "healthy"), h("dd", {}, "Consuming; subscriptions on this source can synchronize."),
        h("dt", {}, "degraded"), h("dd", {}, "Connection lost or the consumer group is rebalancing. Views are stale and resynchronize automatically when it recovers."),
        h("dt", {}, "paused"), h("dd", {}, "An unprocessable record stopped consumption without committing it. Fix the cause, then resume: the same record is retried, never skipped."))));
  draw();
  void refresh();
}
