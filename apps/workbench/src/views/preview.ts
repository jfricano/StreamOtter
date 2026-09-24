import { createClient, type Client, type ConnectionState, type Json, type Params, type StreamError, type Subscription, type SubscriptionState } from "@streamotter/client";
import type { ChannelMap, Schema } from "@streamotter/contracts";
import { ApiError } from "../api.ts";
import { h, pill, replace, time } from "../dom.ts";
import type { WorkbenchState } from "../state.ts";

const STATE_TONE: Record<SubscriptionState, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  idle: "neutral", authorizing: "info", synchronizing: "info", live: "ok", stale: "warn",
  "resync-required": "bad", failed: "bad", closed: "neutral"
};
const CONNECTION_TONE: Record<ConnectionState, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  idle: "neutral", connecting: "info", connected: "ok", reconnecting: "warn", "auth-required": "bad", closed: "neutral"
};
const MEANING: Record<SubscriptionState, string> = {
  idle: "Created; starting in the next microtask.",
  authorizing: "The gateway is running your authorize handler for this principal and parameters.",
  synchronizing: "Live capture is registered and the snapshot is loading; newer updates are buffered.",
  live: "Synchronized to the drain boundary while the source is healthy. Not proof of wall-clock freshness.",
  stale: "The view may be out of date (source outage, rebalance, overflow, disconnect, or expiry). Resynchronizes automatically.",
  "resync-required": "Automatic synchronization stopped after its attempt budget. Call resync().",
  failed: "Terminal: denied, handler failure, or invalid data. Create a new subscription.",
  closed: "Unsubscribed or the client closed."
};

interface ActivePreview {
  client: Client<ChannelMap>;
  subscription: Subscription<Json>;
  principalRef: string;
  sourceId: string;
  sourceKind: string;
  previewSessionId: string;
}

/** Keeps one live preview across tab switches; closed explicitly by the user. */
let active: ActivePreview | null = null;
const log: { at: string; text: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }[] = [];
let latest: { kind: string; revision: string; receivedAt: string; data: Json } | null = null;

function paramInputs(schema: Schema | undefined): { element: HTMLElement; read: () => Params } {
  if (schema === undefined || schema.type !== "object") {
    return { element: h("p", { class: "muted" }, "This channel's parameter schema is not an object."), read: () => ({}) };
  }
  const readers: (() => [string, string | number | boolean])[] = [];
  const fields = Object.entries(schema.properties).map(([name, child]) => {
    if (child.type === "boolean") {
      const input = h("input", { type: "checkbox" });
      readers.push(() => [name, input.checked]);
      return h("label", {}, h("span", {}, name, " ", h("span", { class: "hint" }, "boolean")), input);
    }
    if (child.type === "string" && child.enum !== undefined) {
      const select = h("select", {}, child.enum.map(value => h("option", { value }, value)));
      readers.push(() => [name, select.value]);
      return h("label", {}, h("span", {}, name), select);
    }
    const input = h("input", { type: child.type === "integer" ? "number" : "text", placeholder: child.type === "integer" ? "0" : "value" });
    readers.push(() => [name, child.type === "integer" ? Number(input.value) : input.value]);
    return h("label", {}, h("span", {}, name, " ", h("span", { class: "hint" }, child.type)), input);
  });
  return { element: h("div", { class: "stack" }, fields), read: () => Object.fromEntries(readers.map(read => read())) };
}

export function renderPreview(root: HTMLElement, state: WorkbenchState): void {
  const principal = h("select", { "aria-label": "Development principal" },
    state.principals.map(item => h("option", { value: item.ref }, `${item.ref} (tenant ${item.tenantId}, subject ${item.subject})`)));
  const channel = h("select", { "aria-label": "Channel" }, state.channels.map(item => h("option", { value: item.name }, `${item.name} v${item.version}`)));
  const paramsHost = h("div");
  let readParams: () => Params = () => ({});
  const drawParams = () => {
    const summary = state.channels.find(item => item.name === channel.value);
    const built = paramInputs(summary === undefined ? undefined : state.active.config.schemas[summary.paramsSchema]);
    readParams = built.read;
    replace(paramsHost, built.element);
  };
  channel.addEventListener("change", drawParams);

  const status = h("div", { class: "stack" });
  const dataView = h("div", { class: "data-view" });
  const timeline = h("ul", { class: "timeline", "aria-label": "Preview activity" });
  const controls = h("div", { class: "row" });
  const message = h("div");

  const note = (text: string, tone: "ok" | "warn" | "bad" | "info" | "neutral") => {
    log.unshift({ at: new Date().toISOString(), text, tone });
    if (log.length > 200) log.length = 200;
    drawLog();
  };
  const drawLog = () => replace(timeline, log.map(entry => h("li", {}, h("span", { class: "muted mono small" }, time(entry.at)), h("span", {}, pill(entry.tone === "neutral" ? "·" : entry.tone, entry.tone), " ", entry.text))));

  const drawStatus = () => {
    if (active === null) {
      replace(status, h("p", { class: "muted" }, "No preview running."));
      replace(dataView, h("span", { class: "muted" }, "Data appears here after the snapshot arrives."));
      replace(controls);
      return;
    }
    const sub = active.subscription;
    replace(status,
      h("div", { class: "row" }, h("span", { class: "muted" }, "Connection"), pill(active.client.state, CONNECTION_TONE[active.client.state]),
        h("span", { class: "muted" }, "Subscription"), pill(sub.state, STATE_TONE[sub.state])),
      h("p", { class: "small" }, MEANING[sub.state]));
    replace(dataView, latest === null
      ? h("span", { class: "muted" }, "Waiting for the snapshot…")
      : h("div", { class: "stack" },
        h("div", { class: "row small" }, pill(latest.kind, latest.kind === "snapshot" ? "info" : "neutral"), h("span", { class: "mono" }, `revision ${latest.revision}`), h("span", { class: "muted" }, `received ${time(latest.receivedAt)}`)),
        h("pre", {}, JSON.stringify(latest.data, null, 2))));
    const act = (label: string, run: () => Promise<unknown>, primary = false) => {
      const button = h("button", { type: "button", class: primary ? "primary" : "" }, label);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await run(); } catch (error) { note(describe(error), "bad"); } finally { button.disabled = false; }
      });
      return button;
    };
    const current = active;
    replace(controls,
      current.sourceKind === "fixture" ? act(`Advance "${current.sourceId}" by 1`, async () => {
        const { advanced } = await state.api.advance(current.sourceId, 1);
        note(advanced === 0 ? "No record was committed (the fixture is exhausted or paused)." : "Advanced one fixture record.", advanced === 0 ? "warn" : "info");
      }) : null,
      act("Disconnect this preview", async () => {
        await state.api.disconnect(current.previewSessionId);
        note("Disconnected the preview connection. Expect stale → resynchronization with a fresh snapshot.", "warn");
      }),
      act("Resync", async () => {
        note("Requested a fresh synchronization.", "info");
        await current.subscription.resync({ timeoutMs: 30_000 });
      }),
      act("Stop preview", async () => { await stop(); }, false));
  };

  const describe = (error: unknown) => {
    if (error instanceof ApiError) return `${error.error.code}: ${error.error.message}`;
    const stream = error as Partial<StreamError>;
    return stream.code !== undefined ? `${stream.code}: ${stream.message ?? ""}` : (error as Error).message;
  };

  const stop = async () => {
    const current = active;
    active = null;
    latest = null;
    if (current !== null) {
      await current.subscription.unsubscribe();
      await current.client.close();
      note("Preview stopped; the subscription and client were closed.", "neutral");
    }
    drawStatus();
  };

  const start = h("button", { class: "primary", type: "button" }, "Start preview");
  start.addEventListener("click", async () => {
    replace(message);
    if (state.principals.length === 0) {
      replace(message, h("div", { class: "banner warn" }, "No development principals are registered. Export `development.principals` from your handler module."));
      return;
    }
    await stop();
    const summary = state.channels.find(item => item.name === channel.value);
    if (summary === undefined) return;
    const principalRef = principal.value;
    const params = readParams();
    const sourceConfig = state.active.config.sources[summary.source];
    let session: { token: string; previewSessionId: string; expiresAt: string };
    try {
      session = await state.api.previewSession(principalRef);
    } catch (error) {
      replace(message, h("div", { class: "banner bad", role: "alert" }, describe(error)));
      return;
    }
    const client = createClient<ChannelMap>({
      origin: state.gatewayOrigin,
      path: state.gatewayPath,
      getToken: async () => {
        // Preview tokens last five minutes; mint a fresh one for the same principal when needed.
        if (Date.parse(session.expiresAt) - Date.now() < 45_000) {
          session = await state.api.previewSession(principalRef);
          if (active !== null) active.previewSessionId = session.previewSessionId;
        }
        return session.token;
      }
    });
    const subscription = client.subscribe(summary.name, { channelVersion: summary.version, params });
    active = { client, subscription, principalRef, sourceId: summary.source, sourceKind: sourceConfig?.kind ?? "unknown", previewSessionId: session.previewSessionId };
    note(`Subscribing to ${summary.name} v${summary.version} as "${principalRef}" with ${JSON.stringify(params)}.`, "info");
    client.on("state", change => {
      note(`Connection ${change.state}${change.reason === undefined ? "" : ` (${change.reason})`}.`, CONNECTION_TONE[change.state]);
      drawStatus();
    });
    client.on("error", error => note(`Connection error ${error.code}: ${error.message}`, "bad"));
    subscription.on("state", change => {
      note(`Subscription ${change.state}${change.reason === undefined ? "" : ` (${change.reason})`}.`, STATE_TONE[change.state]);
      drawStatus();
    });
    subscription.on("data", event => {
      latest = { kind: event.kind, revision: event.revision, receivedAt: event.receivedAt, data: event.data };
      note(`${event.kind === "snapshot" ? "Snapshot" : "Update"} at revision ${event.revision}.`, event.kind === "snapshot" ? "info" : "ok");
      drawStatus();
    });
    subscription.on("error", error => note(`${error.code}: ${error.message}`, "bad"));
    drawStatus();
  });

  replace(root,
    h("section", { class: "panel stack" },
      h("div", {},
        h("h2", {}, "Preview"),
        h("p", { class: "lede" }, "Subscribe through the running gateway as a registered development principal. Preview tokens use the same authorization, snapshot, and delivery path as your application; only the identity resolver differs.")),
      h("div", { class: "grid-2" },
        h("div", { class: "stack" },
          h("label", {}, h("span", {}, "Principal"), principal),
          h("label", {}, h("span", {}, "Channel"), channel)),
        h("div", { class: "stack" }, h("span", { class: "small muted" }, "Parameters"), paramsHost)),
      h("div", { class: "row" }, start),
      message),
    h("div", { class: "grid-2" },
      h("section", { class: "panel stack" }, h("h3", {}, "Delivery state"), status, controls),
      h("section", { class: "panel stack" }, h("h3", {}, "Current state"), dataView)),
    h("section", { class: "panel" }, h("h3", {}, "Activity"), timeline));
  drawParams();
  drawStatus();
  drawLog();
}
