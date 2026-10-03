import type {
  EvaluationResult, FailureClass, IncidentDetail, IncidentProgress, IncidentQuarantine, IncidentRecovery, IncidentSummary, OperationResult,
  OperatorSourceStatus, OperatorStatus, WorkbenchOperation
} from "@streamotter/contracts";
import { ApiError } from "../api.ts";
import { h, pill, replace, time, unavailable } from "../dom.ts";
import type { WorkbenchState } from "../state.ts";

/**
 * The V1.1 failure console (spec §10). Everything shown comes from the operator routes and is
 * untrusted: it is inserted as text only (dom.ts), never parsed as markup. Raw record bytes are
 * never requested or shown; they stay in the local CLI. Every action sends the revision of the
 * incident as last displayed, so a stale view is refused by the gateway instead of acting on a guess.
 */

const PAGE_SIZE = 20;
type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

/** Only these classes can take a quarantine policy; the others are integrity failures and are never skipped. */
const QUARANTINABLE: readonly FailureClass[] = ["invalid-json", "payload-schema"];

// Captured, quarantined, advanced and recovered are separate facts, each with its own wording (F44).
const QUARANTINE: Record<IncidentQuarantine, [Tone, string]> = {
  "not-required": ["neutral", "No quarantine copy: the policy does not require one."],
  pending: ["warn", "The quarantine write has not been acknowledged yet."],
  unknown: ["warn", "The outcome of the quarantine write is unknown."],
  acknowledged: ["info", "A quarantine copy was written and acknowledged."],
  failed: ["bad", "The quarantine write failed."]
};
const PROGRESS: Record<IncidentProgress, [Tone, string]> = {
  held: ["warn", "The source is held at this record; nothing after it is processed."],
  retrying: ["warn", "The record is being retried."],
  "advance-pending": ["warn", "An advance past the record was started but is not confirmed."],
  advanced: ["info", "The source position advanced past the record without processing it."],
  processed: ["ok", "The record was processed on a retry."],
  uncertain: ["bad", "An advance could not be confirmed; the source holds until it is reconciled."]
};
const RECOVERY: Record<IncidentRecovery, [Tone, string]> = {
  "not-applicable": ["neutral", "No snapshot recovery applies to this incident."],
  "guard-pending": ["warn", "The recovery guard has not decided yet."],
  held: ["warn", "The recovery guard held the source."],
  "boundary-in-force": ["info", "A recovery boundary is in force: snapshots must acknowledge it before subscriptions recover."],
  denied: ["bad", "Recovery was denied."]
};
const RESULT_TONE: Record<OperationResult["result"], "info" | "warn" | "bad"> = { completed: "info", refused: "warn", failed: "bad", unknown: "warn" };

const enumPill = (value: string, [tone, title]: [Tone, string]) => h("span", { class: `pill ${tone}`, title }, value);

function stateLabel(item: IncidentSummary): HTMLSpanElement {
  // "resolved" appears only when the incident's state says so.
  return item.state === "resolved" ? pill(item.resolution === null ? "resolved" : `resolved · ${item.resolution}`, "neutral") : pill("open", "warn");
}

function positionText(item: IncidentSummary): string {
  return item.position.kind === "fixture"
    ? `fixture record ${item.position.index}`
    : `${item.position.topic} partition ${item.position.partition} offset ${item.position.offset}`;
}

function evidenceText(item: IncidentSummary): string {
  const { location, completeness } = item.evidence;
  if (location === "none") return `Not captured (${completeness}).`;
  const where = item.position.kind === "fixture" ? "Local fixture evidence, not Kafka"
    : location === "kafka" ? "Kafka quarantine topic" : "Local journal spool, not Kafka";
  return `${where} (${completeness}).`;
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? `${error.error.code}: ${error.error.message}` : (error as Error).message;
}

function facts(rows: [string, Node | string | null][]): HTMLDListElement {
  return h("dl", { class: "facts" }, rows.flatMap(([term, value]) => [h("dt", {}, term), h("dd", {}, value ?? "—")]));
}

function operationBanner(title: string, result: OperationResult): HTMLDivElement {
  return h("div", { class: `banner ${RESULT_TONE[result.result]} operation-result`, role: "status" },
    h("div", {}, h("strong", {}, `${title}: ${result.result}`), ` · outcome ${result.outcome}`),
    h("div", {}, result.message),
    h("div", { class: "small mono" }, `operation ${result.operationId}`, result.incidentRevision === null ? "" : ` · incident revision ${result.incidentRevision}`));
}

export function renderFailures(root: HTMLElement, state: WorkbenchState): void {
  const can = (operation: WorkbenchOperation) => state.can(operation);
  let status: OperatorStatus | null = null;
  let cursors: (string | undefined)[] = [undefined];
  let nextCursor: string | null = null;
  let selected: string | null = null;
  let listRequest = 0;

  const statusBody = h("div", { class: "stack" });
  const statusOutput = h("div", { class: "stack" });
  const listMessage = h("div");
  const tbody = h("tbody");
  const pageInfo = h("span", { class: "muted small" });
  const detailBody = h("div", { class: "stack" });
  const actionOutput = h("div", { class: "stack", "aria-live": "polite" });
  const detailSection = h("section", { class: "panel stack", "aria-label": "Incident detail", hidden: true }, detailBody, actionOutput);

  const sourceFilter = h("select", { "aria-label": "Filter failures by source" });
  const stateFilter = h("select", { "aria-label": "Filter failures by state" },
    h("option", { value: "all" }, "Open and resolved"), h("option", { value: "open" }, "Open"), h("option", { value: "resolved" }, "Resolved"));
  const previous = h("button", { type: "button" }, "Previous page");
  const next = h("button", { type: "button" }, "Next page");

  const fillSources = () => {
    const ids = new Set([...state.sources.map(source => source.sourceId), ...(status?.sources.map(source => source.sourceId) ?? [])]);
    const current = sourceFilter.value;
    replace(sourceFilter, h("option", { value: "" }, "All sources"), [...ids].sort().map(id => h("option", { value: id }, id)));
    sourceFilter.value = ids.has(current) ? current : "";
  };

  // --- operator status ---------------------------------------------------------------

  const circuitCell = (source: OperatorSourceStatus) => {
    const { circuit } = source;
    const text = h("div", {},
      pill(circuit.state, circuit.state === "open" ? "bad" : "neutral"),
      h("div", { class: "small muted" }, `${circuit.recentIncidents} of ${circuit.limit} automatic advances in ${Math.round(circuit.windowMs / 1000)} s · revision ${circuit.revision}`),
      circuit.reason === null ? null : h("div", { class: "small" }, circuit.reason));
    if (circuit.state !== "open") return text;
    if (!can("sources.reopen-circuit")) return h("div", { class: "stack" }, text, unavailable("Reopen circuit", ["sources.reopen-circuit"]));
    const reason = h("input", { type: "text", maxlength: 512, placeholder: "Reason (required)", "aria-label": `Reason to reopen the circuit of ${source.sourceId}` });
    const button = h("button", { type: "button" }, "Reopen circuit");
    button.addEventListener("click", async () => {
      if (reason.value.trim() === "") {
        replace(statusOutput, h("div", { class: "banner warn", role: "alert" }, "A reason is required to reopen a circuit."));
        return;
      }
      button.disabled = true;
      try {
        const result = await state.api.reopenCircuit({ sourceId: source.sourceId, expectedCircuitRevision: circuit.revision, reason: reason.value });
        replace(statusOutput, operationBanner(`Reopen circuit of ${source.sourceId}`, result));
        await loadStatus(false);
      } catch (error) {
        replace(statusOutput, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
      } finally {
        button.disabled = false;
      }
    });
    return h("div", { class: "stack" }, text, h("div", { class: "row" }, reason, button));
  };

  const drawStatus = () => {
    if (status === null) return;
    const { gateway, store, quarantine } = status;
    replace(statusBody,
      store.durable ? null : h("div", { class: "banner warn", role: "status" },
        h("strong", {}, `The ${store.kind} incident store is not durable. `),
        "Incidents, holds, boundaries and plans are lost when the gateway restarts."),
      facts([
        ["Gateway", `${gateway.mode} · ${gateway.version} · ${gateway.state}`],
        ["Configuration", h("span", { class: "mono small" }, gateway.configFingerprint)],
        ["Handler build", h("span", { class: "mono small" }, gateway.handlerBuildId)],
        ["Incident store", `${store.kind}${store.durable ? " (durable)" : " (not durable)"} · ${store.sizeBytes} of ${store.limitBytes} bytes · schema ${store.schemaVersion}`],
        ["Quarantine topic", quarantine === null ? "Not configured" : quarantine.topic ?? "Not configured"]
      ]),
      h("p", { class: "muted small" }, "Source connection is the consumer's connection state only. It is not subscription health: a connected source does not mean any subscription is live. Use Preview to see subscription state."),
      h("div", { class: "table-wrap" }, h("table", { "aria-label": "Operator status by source" },
        h("thead", {}, h("tr", {}, ["Source", "Source connection", "Held incident", "Open incidents", "Circuit", "Boundary in force"].map(label => h("th", {}, label)))),
        h("tbody", {}, status.sources.map(source => h("tr", {},
          h("td", {}, h("strong", {}, source.sourceId), h("div", { class: "small muted" }, `invalid JSON: ${source.policy.invalidJson} · invalid payload: ${source.policy.invalidPublicPayload}`)),
          // Never a success colour: a connected consumer is not evidence that subscriptions are synchronized.
          h("td", {}, pill(source.status, source.status === "paused" ? "bad" : source.status === "degraded" ? "warn" : "neutral"),
            source.reason === undefined ? null : h("div", { class: "small mono" }, source.reason)),
          h("td", {}, source.heldIncident === null ? h("span", { class: "muted" }, "None") : (() => {
            const open = h("button", { type: "button", class: "link mono small", "aria-label": `Details for ${source.heldIncident.failureId}` }, source.heldIncident.failureId);
            const id = source.heldIncident.failureId;
            open.addEventListener("click", () => void select(id));
            return h("div", {}, open, h("div", { class: "small muted" }, `revision ${source.heldIncident.revision}`));
          })()),
          h("td", {}, String(source.openIncidents)),
          h("td", {}, circuitCell(source)),
          h("td", {}, source.boundary === null ? h("span", { class: "muted" }, "None")
            : h("div", {}, h("span", { class: "mono small" }, source.boundary.boundaryId),
              h("div", { class: "small muted" }, `revision ${source.boundary.revision} · retires on ${source.boundary.retirement} · since ${source.boundary.since}`)))))))));
  };

  const loadStatus = async (clearOutput: boolean) => {
    if (clearOutput) replace(statusOutput);
    try {
      status = await state.api.operatorStatus();
      fillSources();
      drawStatus();
    } catch (error) {
      replace(statusBody, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
    }
  };

  // --- list --------------------------------------------------------------------------

  const drawList = (items: readonly IncidentSummary[]) => {
    replace(tbody, items.length === 0
      ? h("tr", {}, h("td", { colspan: 11, class: "muted" }, "No incidents match these filters."))
      : items.map(item => {
        const open = h("button", { type: "button", "aria-label": `Details for ${item.failureId}` }, "Details");
        open.addEventListener("click", () => void select(item.failureId));
        return h("tr", { "data-failure-id": item.failureId, class: item.failureId === selected ? "selected" : null },
          h("td", {}, h("div", { class: "mono small" }, item.failureId), open),
          h("td", {}, item.sourceId),
          h("td", {}, h("code", {}, item.stage), " ", h("span", {}, item.failureClass)),
          h("td", { class: "mono small", title: item.firstObservedAt }, time(item.firstObservedAt)),
          h("td", { class: "mono small", title: item.lastObservedAt }, time(item.lastObservedAt)),
          h("td", {}, String(item.observations)),
          h("td", {}, item.policy),
          h("td", {}, enumPill(item.quarantine, QUARANTINE[item.quarantine])),
          h("td", {}, enumPill(item.progress, PROGRESS[item.progress])),
          h("td", {}, enumPill(item.recovery, RECOVERY[item.recovery])),
          h("td", {}, stateLabel(item)));
      }));
  };

  const loadList = async () => {
    const cursor = cursors.at(-1);
    const request = ++listRequest;
    try {
      const page = await state.api.failures({
        state: stateFilter.value as "open" | "resolved" | "all",
        limit: PAGE_SIZE,
        ...(sourceFilter.value === "" ? {} : { sourceId: sourceFilter.value }),
        ...(cursor === undefined ? {} : { cursor })
      });
      if (request !== listRequest) return; // A newer filter or page request superseded this one.
      nextCursor = page.nextCursor;
      previous.disabled = cursors.length === 1;
      next.disabled = nextCursor === null;
      replace(pageInfo, `Page ${cursors.length}`);
      replace(listMessage);
      drawList(page.items);
    } catch (error) {
      replace(listMessage, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
    }
  };

  const restart = () => {
    cursors = [undefined];
    void loadList();
  };
  sourceFilter.addEventListener("change", restart);
  stateFilter.addEventListener("change", restart);
  next.addEventListener("click", () => {
    if (nextCursor === null) return;
    cursors.push(nextCursor);
    void loadList();
  });
  previous.addEventListener("click", () => {
    if (cursors.length > 1) cursors.pop();
    void loadList();
  });

  // --- detail and actions --------------------------------------------------------------

  const refreshAll = async (failureId: string) => {
    await Promise.all([loadDetail(failureId), loadList(), loadStatus(false)]);
  };

  /** Runs a mutation and shows its OperationResult verbatim, then reloads what it may have changed. */
  const act = (label: string, run: () => Promise<OperationResult>, failureId: string, primary = false) => {
    const button = h("button", { type: "button", class: primary ? "primary" : "" }, label);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await run();
        replace(actionOutput, operationBanner(label, result));
        await refreshAll(failureId);
      } catch (error) {
        replace(actionOutput, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
        button.disabled = false;
      }
    });
    return button;
  };

  const showEvaluation = (detail: IncidentDetail, evaluation: EvaluationResult) => {
    const redriveOutput = h("div", { class: "stack" });
    let redrive: Node | null = null;
    if (evaluation.plan !== null) {
      const plan = evaluation.plan;
      if (!can("failures.redrive")) {
        redrive = unavailable("Redrive", ["failures.redrive"]);
      } else {
        const button = h("button", { type: "button", class: "primary" }, "Redrive this plan");
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            // Exactly the plan that was evaluated, and the revision it was evaluated at.
            const result = await state.api.redrive({ failureId: detail.failureId, planId: plan.planId, planFingerprint: plan.fingerprint, expectedRevision: detail.revision });
            replace(redriveOutput, operationBanner("Redrive", result));
            await refreshAll(detail.failureId);
          } catch (error) {
            replace(redriveOutput, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
            button.disabled = false;
          }
        });
        redrive = button;
      }
    }
    replace(actionOutput, h("section", { class: "panel stack evaluation", "aria-label": "Evaluation result" },
      h("h3", {}, "Evaluation"),
      facts([
        ["Validation", pill(evaluation.validation, evaluation.validation === "valid" ? "info" : "bad")],
        ["Redrive eligible", evaluation.eligible ? "Yes" : `No${evaluation.ineligibleReason === null ? "" : `: ${evaluation.ineligibleReason}`}`],
        ["Plan", evaluation.plan === null ? "No plan issued" : h("span", { class: "mono small" }, `${evaluation.plan.planId} · ${evaluation.plan.fingerprint}`)],
        ["Plan expires", evaluation.plan === null ? null : evaluation.plan.expiresAt]
      ]),
      evaluation.errors.length === 0 ? null : h("ul", { class: "issues" }, evaluation.errors.map(error =>
        h("li", {}, h("code", {}, error.stage), error.failureClass === null ? "" : ` ${error.failureClass}`, `: ${error.message}`))),
      h("p", { class: "muted small" }, "Outputs are privileged metadata about what the record maps to now. They are not evidence that any browser received anything."),
      evaluation.outputs.length === 0 ? h("p", { class: "muted" }, "No outputs.") : h("ul", { class: "issues" }, evaluation.outputs.map(output =>
        h("li", {}, h("code", {}, output.channel), ` v${output.channelVersion} · revision ${output.revision}`))),
      redrive === null ? null : h("div", { class: "row" }, redrive),
      redriveOutput));
  };

  const drawDetail = (detail: IncidentDetail) => {
    const integrity = !QUARANTINABLE.includes(detail.failureClass);
    const held = detail.state === "open" && detail.progress === "held";
    const actions: (Node | null)[] = [];
    if (held) {
      actions.push(can("sources.retry-current")
        ? act(integrity ? "Retry after repair" : "Retry current record",
          () => state.api.retryCurrent({ sourceId: detail.sourceId, failureId: detail.failureId, expectedRevision: detail.revision }), detail.failureId, true)
        : unavailable("Retry current", ["sources.retry-current"]));
      if (detail.policy === "quarantine-resync") {
        actions.push(can("sources.reassess")
          ? act("Reassess", () => state.api.reassess({ sourceId: detail.sourceId, failureId: detail.failureId, expectedRevision: detail.revision }), detail.failureId)
          : unavailable("Reassess", ["sources.reassess"]));
      }
    }
    if (can("failures.evaluate")) {
      const evaluate = h("button", { type: "button" }, "Evaluate");
      evaluate.addEventListener("click", async () => {
        evaluate.disabled = true;
        try {
          showEvaluation(detail, await state.api.evaluate({ failureId: detail.failureId, expectedRevision: detail.revision }));
        } catch (error) {
          replace(actionOutput, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
        } finally {
          evaluate.disabled = false;
        }
      });
      actions.push(evaluate);
    } else {
      actions.push(unavailable("Evaluate", ["failures.evaluate"]));
    }
    if (can("failures.export")) {
      const exportButton = h("button", { type: "button" }, "Export metadata bundle");
      exportButton.addEventListener("click", async () => {
        exportButton.disabled = true;
        try {
          const bundle = await state.api.exportFailure(detail.failureId);
          const content = `${JSON.stringify(bundle, null, 2)}\n`;
          const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
          replace(actionOutput, h("div", { class: "stack" },
            h("div", { class: "banner info", role: "status" }, "Metadata only: raw record bytes are never part of a workbench export."),
            h("a", { href: url, download: "streamotter-failure.json", class: "mono" }, "Download streamotter-failure.json"),
            h("pre", { class: "data-view", "aria-label": "Reproduction bundle" }, content)));
        } catch (error) {
          replace(actionOutput, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
        } finally {
          exportButton.disabled = false;
        }
      });
      actions.push(exportButton);
    } else {
      actions.push(unavailable("Export", ["failures.export"]));
    }

    const { explanation, evidence } = detail;
    replace(detailBody,
      h("div", { class: "row" }, h("h3", { class: "mono" }, detail.failureId), stateLabel(detail), pill(detail.failureClass, integrity ? "bad" : "warn")),
      h("dl", { class: "explain" },
        h("dt", {}, "What failed"), h("dd", {}, explanation.whatFailed),
        h("dt", {}, "Evidence"), h("dd", {}, explanation.evidence),
        h("dt", {}, "Disposition"), h("dd", {}, explanation.disposition),
        h("dt", {}, "What snapshots must establish"), h("dd", {}, explanation.snapshots ?? "Nothing for this incident."),
        h("dt", {}, "Next action"), h("dd", {}, explanation.nextAction, " ", h("code", {}, detail.nextAction))),
      h("h4", {}, "Diagnosis"),
      h("pre", { class: "data-view diagnosis", "aria-label": "Diagnosis" }, detail.diagnosis.message),
      h("h4", {}, "Lifecycle"),
      facts([
        ["Evidence captured", evidenceText(detail)],
        ["Quarantine write", h("span", {}, enumPill(detail.quarantine, QUARANTINE[detail.quarantine]), " ", QUARANTINE[detail.quarantine][1])],
        ["Source position", h("span", {}, enumPill(detail.progress, PROGRESS[detail.progress]), " ", PROGRESS[detail.progress][1])],
        ["Snapshot recovery", h("span", {}, enumPill(detail.recovery, RECOVERY[detail.recovery]), " ", RECOVERY[detail.recovery][1])],
        ["Incident state", stateLabel(detail)]
      ]),
      h("h4", {}, "Incident"),
      facts([
        ["Source", `${detail.sourceId} · generation ${detail.generation}`],
        ["Position", positionText(detail)],
        ["Kafka cluster", detail.clusterId ?? "None (not Kafka)"],
        ["Stage and class", `${detail.stage} · ${detail.failureClass} · ${detail.errorCode}`],
        ["Channel", detail.channel ?? "Unknown"],
        ["Impact", detail.impact],
        ["Policy", detail.policy],
        ["Observations", `${detail.observations} · first ${detail.firstObservedAt} · last ${detail.lastObservedAt}`],
        ["Revision", String(detail.revision)]
      ]),
      h("h4", {}, "Evidence"),
      facts([
        ["Where", evidenceText(detail)],
        ["Size", evidence.location === "none" ? null : `value ${evidence.valueBytes ?? "none (tombstone)"} bytes · key ${evidence.keyBytes ?? "none"} bytes · ${evidence.headerCount} header(s)`],
        ["Hash", evidence.hash === "" ? null : h("span", { class: "mono small" }, evidence.hash)],
        ["Quarantine coordinates", detail.quarantineCoordinates === null ? null : `partition ${detail.quarantineCoordinates.partition} offset ${detail.quarantineCoordinates.offset}`]
      ]),
      h("p", { class: "muted small" }, "Raw record bytes are never shown in the workbench. They stay with the local operator CLI."),
      h("h4", {}, "Boundary and guard"),
      facts([
        ["Boundary", detail.boundary === null ? "None" : h("span", {}, h("span", { class: "mono small" }, detail.boundary.boundaryId),
          ` · revision ${detail.boundary.revision} · ${detail.boundary.state} · retires on ${detail.boundary.retirement}`)],
        ["Guard", detail.guard === null ? "Not run" : `${detail.guard.decision}${detail.guard.reason === null ? "" : ` · ${detail.guard.reason}`} · ${detail.guard.at}`],
        ["Guard evidence", detail.guard?.evidenceRef ?? null]
      ]),
      h("h4", {}, "Fingerprints"),
      facts([
        ["Configuration", h("span", { class: "mono small" }, detail.fingerprints.config)],
        ["Handler build", h("span", { class: "mono small" }, detail.fingerprints.handlerBuildId)],
        ["Policy revision", h("span", { class: "mono small" }, detail.fingerprints.policyRevision)],
        ["Gateway version", h("span", { class: "mono small" }, detail.fingerprints.gatewayVersion)]
      ]),
      h("h4", {}, "History"),
      h("ul", { class: "timeline", "aria-label": "Incident history" }, detail.history.map(event => h("li", {},
        h("span", { class: "mono small", title: event.at }, time(event.at)),
        h("span", {}, h("code", {}, event.event), event.detail === null ? "" : ` ${event.detail}`, event.operationId === null ? "" : h("span", { class: "muted small mono" }, ` ${event.operationId}`))))),
      h("h4", {}, "Actions"),
      integrity
        ? h("div", { class: "banner warn", role: "note" }, h("strong", {}, `Integrity failure (${detail.failureClass}). `),
          "StreamOtter never skips it, so there is no skip or advance control. Repair the cause (the producer's data or your handler), then retry the current record.")
        : null,
      h("div", { class: "row actions" }, actions));
  };

  const loadDetail = async (failureId: string) => {
    try {
      const detail = await state.api.failure(failureId);
      if (selected !== failureId) return;
      drawDetail(detail);
    } catch (error) {
      replace(detailBody, h("div", { class: "banner bad", role: "alert" }, errorText(error)));
    }
  };

  const select = async (failureId: string) => {
    selected = failureId;
    detailSection.hidden = false;
    replace(actionOutput);
    replace(detailBody, h("p", { class: "muted" }, "Loading…"));
    for (const row of tbody.querySelectorAll("tr[data-failure-id]")) row.classList.toggle("selected", row.getAttribute("data-failure-id") === failureId);
    await loadDetail(failureId);
  };

  const refresh = h("button", { type: "button" }, "Refresh");
  refresh.addEventListener("click", () => {
    void loadStatus(true);
    void loadList();
    if (selected !== null) void loadDetail(selected);
  });

  fillSources();
  replace(root,
    h("section", { class: "panel stack" },
      h("div", {},
        h("h2", {}, "Failures"),
        h("p", { class: "lede" }, "Records the gateway could not process, what happened to each, and the supported next step. Captured, quarantined, advanced and recovered are separate facts. Incident data is shown as text and raw record bytes never leave the gateway.")),
      h("div", { class: "row" }, sourceFilter, stateFilter, refresh),
      listMessage,
      h("div", { class: "table-wrap" }, h("table", { "aria-label": "Incidents" },
        h("thead", {}, h("tr", {}, ["Incident", "Source", "Stage / class", "First seen", "Last seen", "Count", "Policy", "Quarantine", "Progress", "Recovery", "State"].map(label => h("th", {}, label)))),
        tbody)),
      h("div", { class: "row" }, previous, next, pageInfo)),
    detailSection,
    h("section", { class: "panel stack", "aria-label": "Operator status" }, h("h3", {}, "Operator status"), statusBody, statusOutput));
  previous.disabled = true;
  next.disabled = true;
  void loadStatus(true);
  void loadList();
}
