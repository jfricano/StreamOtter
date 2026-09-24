/**
 * Vanilla TypeScript order view built on the StreamOtter SDK. It renders the actual
 * subscription lifecycle: a snapshot first, then full-state updates, and explicit
 * stale/resynchronizing states. It never presents a disconnected view as live.
 */
import { createClient, type Client, type ConnectionState, type StreamError, type Subscription, type SubscriptionState } from "@streamotter/client";
import { channelVersions, type AppChannels, type OrderState } from "../generated/streamotter.generated.ts";
import { appMode, currentToken, gatewayOrigin, signIn, type Session } from "./session.ts";

const DELIVERY: Record<SubscriptionState, { label: string; tone: "ok" | "warn" | "bad" | "info"; help: string }> = {
  idle: { label: "Starting", tone: "info", help: "Preparing the subscription." },
  authorizing: { label: "Checking access", tone: "info", help: "The server is confirming you can see this order." },
  synchronizing: { label: "Loading", tone: "info", help: "Loading the current order state." },
  live: { label: "Live", tone: "ok", help: "Up to date. Changes appear as they happen." },
  stale: { label: "Reconnecting", tone: "warn", help: "Updates are paused; this may be out of date. It will refresh automatically." },
  "resync-required": { label: "Needs refresh", tone: "bad", help: "Automatic recovery stopped. Refresh to try again." },
  failed: { label: "Unavailable", tone: "bad", help: "This order can't be shown." },
  closed: { label: "Closed", tone: "info", help: "Not subscribed." }
};

const app = document.getElementById("app") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  element.append(...children.filter((child): child is Node | string => child !== null));
  return element;
}

function present(...items: (Node | string | null)[]): (Node | string)[] {
  return items.filter((item): item is Node | string => item !== null);
}

/** Width is set through the CSSOM: the page's CSP forbids inline style attributes. */
function progressFill(percent: number): HTMLDivElement {
  const fill = el("div");
  fill.style.width = `${percent}%`;
  return fill;
}

function describeError(error: StreamError): string {
  switch (error.code) {
    case "FORBIDDEN": return "You don't have access to this order.";
    case "UNAUTHENTICATED": return "Your session ended. Sign in again.";
    case "SOURCE_UNAVAILABLE": return "Order updates are temporarily unavailable; the view may be stale.";
    case "RESYNC_REQUIRED": return "Automatic recovery stopped. Use Refresh to try again.";
    default: return error.message;
  }
}

function renderSignIn(): void {
  const buttons = ["alice", "carol", "bob"].map(user => {
    const button = el("button", { type: "button" }, user[0]!.toUpperCase() + user.slice(1));
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await renderDashboard(await signIn(user));
      } catch (error) {
        button.disabled = false;
        alert((error as Error).message);
      }
    });
    return button;
  });
  app.replaceChildren(el("main", {}, el("section", { class: "panel signin" },
    el("h2", {}, "Sign in to track your orders"),
    el("p", { class: "muted small" }, "Development demo identities. Alice and Carol belong to Acme; Bob belongs to Globex and has an order with the same ID as Alice's."),
    el("div", { class: "row" }, ...buttons))));
}

async function renderDashboard(session: Session): Promise<void> {
  const client: Client<AppChannels> = createClient<AppChannels>({ origin: gatewayOrigin(), getToken: () => currentToken(session) });
  const response = await fetch("/api/orders", { headers: { authorization: `Bearer ${session.token}` } });
  const { orders, restrictedOrderId } = await response.json() as { orders: { orderId: string; status: string }[]; restrictedOrderId: string };

  const connection = el("span", { class: "badge info", role: "status" }, "Connecting");
  const signOut = el("button", { type: "button" }, "Sign out");
  const list = el("ul", { class: "orders", "aria-label": "Your orders" });
  const detail = el("section", { class: "panel", "aria-live": "polite" });
  const log = el("ol", { class: "log", "aria-label": "Delivery log" });

  let current: { subscription: Subscription<OrderState>; orderId: string } | null = null;
  let latest: OrderState | null = null;
  let revision = "";
  let lastError: StreamError | null = null;

  const note = (text: string) => {
    log.prepend(el("li", {}, el("span", { class: "muted mono" }, new Date().toLocaleTimeString([], { hour12: false })), el("span", {}, text)));
    while (log.children.length > 80) log.lastElementChild?.remove();
  };

  const draw = () => {
    if (current === null) {
      detail.replaceChildren(el("p", { class: "muted" }, "Choose an order."));
      return;
    }
    const delivery = DELIVERY[current.subscription.state];
    const stale = current.subscription.state !== "live";
    const actions = el("div", { class: "row" });
    if (appMode() === "kafka") {
      const advance = el("button", { type: "button", class: "primary" }, "Advance order");
      advance.addEventListener("click", async () => {
        advance.disabled = true;
        const result = await fetch(`/api/orders/${current?.orderId ?? ""}/advance`, { method: "POST", headers: { authorization: `Bearer ${session.token}` } });
        note(result.ok ? "The store changed and the application published the new state to Kafka." : `Advance refused (${result.status}).`);
        advance.disabled = false;
      });
      actions.append(advance);
    }
    const refresh = el("button", { type: "button" }, "Refresh");
    refresh.addEventListener("click", () => {
      note("Requested a fresh snapshot.");
      current?.subscription.resync().catch((error: StreamError) => note(describeError(error)));
    });
    const reconnect = el("button", { type: "button" }, "Reconnect");
    reconnect.addEventListener("click", () => {
      note("Replacing the connection; subscriptions resynchronize with fresh snapshots.");
      client.reconnect().catch((error: StreamError) => note(describeError(error)));
    });
    // A failed subscription is terminal: offer recovery only while it can still recover.
    if (current.subscription.state !== "failed") actions.append(refresh, reconnect);
    detail.className = `panel${stale ? " stale" : ""}`;
    detail.replaceChildren(...present(
      el("div", { class: "row" }, el("h2", {}, `Order ${current.orderId}`), el("span", { class: `badge ${delivery.tone}` }, delivery.label)),
      latest === null
        ? el("p", { class: "muted order-body" }, current.subscription.state === "failed" ? "" : "Loading…")
        : el("div", { class: "order-body" },
          el("div", { class: "status-title" }, latest.status.replaceAll("-", " ")),
          el("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(latest.progress), "aria-label": "Order progress" },
            progressFill(latest.progress)),
          el("p", {}, latest.note),
          el("p", { class: "muted small" }, `Updated ${new Date(latest.updatedAt).toLocaleString()} · revision ${revision}`)),
      el("p", { class: "muted small" }, delivery.help),
      lastError === null ? null : el("div", { class: `notice ${lastError.code === "FORBIDDEN" ? "bad" : "warn"}`, role: "alert" }, describeError(lastError)),
      appMode() === "fixture"
        ? el("div", { class: "notice info" }, "Fixture mode: advance the “orders” fixture in the StreamOtter workbench to see updates.")
        : null,
      actions));
  };

  const open = async (orderId: string) => {
    if (current !== null) {
      await current.subscription.unsubscribe();
      note(`Unsubscribed from ${current.orderId}.`);
    }
    latest = null;
    revision = "";
    lastError = null;
    const subscription = client.subscribe("orderStatus", { channelVersion: channelVersions.orderStatus, params: { orderId } });
    current = { subscription, orderId };
    for (const item of list.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item.dataset["orderId"] === orderId));
    subscription.on("data", event => {
      latest = event.data;
      revision = event.revision;
      note(`${event.kind === "snapshot" ? "Snapshot" : "Update"}: ${event.data.status} (revision ${event.revision}).`);
      draw();
    });
    subscription.on("state", ({ state, reason }) => {
      if (state === "live") lastError = null;
      note(`Delivery ${state}${reason === undefined ? "" : ` (${reason})`}.`);
      draw();
    });
    subscription.on("error", error => {
      lastError = error;
      draw();
    });
    draw();
  };

  for (const order of orders) {
    const button = el("button", { type: "button", "data-order-id": order.orderId, "aria-pressed": "false" }, el("span", {}, order.orderId), el("span", { class: "muted small" }, order.status));
    button.addEventListener("click", () => void open(order.orderId));
    list.append(el("li", {}, button));
  }
  const restricted = el("button", { type: "button" }, `Try order ${restrictedOrderId} (not yours)`);
  restricted.addEventListener("click", () => void open(restrictedOrderId));

  client.on("state", ({ state }: { state: ConnectionState }) => {
    const tone = state === "connected" ? "ok" : state === "auth-required" ? "bad" : state === "reconnecting" ? "warn" : "info";
    connection.className = `badge ${tone}`;
    connection.textContent = { idle: "Idle", connecting: "Connecting", connected: "Connected", reconnecting: "Reconnecting", "auth-required": "Sign-in required", closed: "Closed" }[state];
    note(`Connection ${state}.`);
  });
  signOut.addEventListener("click", async () => {
    await client.close();
    renderSignIn();
  });

  app.replaceChildren(
    el("header", {}, el("h1", {}, "Order status"), el("span", { class: "spacer" }), el("span", { class: "muted small" }, session.name), connection, signOut),
    el("main", {},
      el("div", { class: "layout" },
        el("section", { class: "panel" }, el("h2", {}, "Your orders"), list, el("p", {}), restricted),
        detail),
      el("section", { class: "panel" }, el("h2", {}, "Delivery log"), log)));
  draw();
  if (orders[0] !== undefined) void open(orders[0].orderId);
}

renderSignIn();
