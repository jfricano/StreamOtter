/**
 * V1.3 React hooks against a running gateway: components render a snapshot, a live update and a
 * denial, StrictMode opens no extra subscription, unmounting unsubscribes on the gateway, and an
 * owned client asks the latest getToken. Test names start with clause IDs from docs/releases/v1.3/API.md.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Window } from "happy-dom";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Client } from "@streamotter/client";
import { createStreamOtterHooks, StreamOtterProvider, type SubscriptionResult } from "@streamotter/client/react";
import { orderRecord, sleep, startHarness, waitFor, type Harness, type OrderState, type TestChannels } from "./harness.ts";

const window = new Window({ url: "http://localhost:3000/" });
Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });

const { useSubscription, useConnectionState, useClient } = createStreamOtterHooks<TestChannels>();

/** Lets the gateway and React run, in act scopes, until the rendered results satisfy `predicate`. */
async function rendered(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await act(() => sleep(10));
  }
}

describe("React hooks with a running gateway", () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({ fixtures: [orderRecord("acme", "ord_1", 2, "processing", 40)] });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    h.app.put("acme", "bob", "ord_2", 1, "queued", 0);
  });
  after(() => h.close());

  it("P1/S1/S4/S5/A3: renders the snapshot, live updates, and a denial; unmounting unsubscribes", async () => {
    const results = new Map<string, SubscriptionResult<OrderState>>();
    const connection: string[] = [];
    function Order({ orderId }: { orderId: string }): null {
      results.set(orderId, useSubscription("orderStatus", { channelVersion: 1, params: { orderId } }));
      return null;
    }
    function Connection(): null {
      connection.push(useConnectionState());
      return null;
    }
    const element = window.document.body.appendChild(window.document.createElement("div"));
    const root = createRoot(element as unknown as Element);
    const options = { origin: h.origin, getToken: () => "alice@acme" };
    await act(async () => root.render(createElement(StrictMode, null,
      createElement(StreamOtterProvider, { options },
        createElement(Connection), createElement(Order, { orderId: "ord_1" }), createElement(Order, { orderId: "ord_2" })))));

    await rendered(() => results.get("ord_1")?.live === true, "ord_1 live");
    assert.deepEqual(results.get("ord_1")?.data, { orderId: "ord_1", status: "queued", progress: 0 });
    assert.equal(results.get("ord_1")?.revision, "1");
    assert.equal(connection.at(-1), "connected");

    await rendered(() => results.get("ord_2")?.state === "failed", "ord_2 denied");
    assert.equal(results.get("ord_2")?.error?.code, "FORBIDDEN");
    assert.equal(results.get("ord_2")?.data, undefined);

    await h.advance(1);
    await rendered(() => results.get("ord_1")?.revision === "2", "the update");
    assert.deepEqual(results.get("ord_1")?.data, { orderId: "ord_1", status: "processing", progress: 40 });

    // StrictMode's double mount opened no extra subscription on the gateway.
    assert.equal(h.internals.subscriptionCount(), 1);

    await act(async () => root.unmount());
    await waitFor(() => h.internals.subscriptionCount() === 0, 5_000, "unsubscribed on the gateway");
  });

  it("P3: the owned client calls the getToken from the latest render", async () => {
    // A holder, because TypeScript does not see the assignment made while rendering.
    const seen: { client: Client<TestChannels> | null } = { client: null };
    const live: boolean[] = [];
    function Order(): null {
      seen.client = useClient();
      live.push(useSubscription("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }).live);
      return null;
    }
    const element = window.document.body.appendChild(window.document.createElement("div"));
    const root = createRoot(element as unknown as Element);
    const calls: string[] = [];
    const tree = (name: string) => createElement(StreamOtterProvider, {
      options: { origin: h.origin, getToken: () => { calls.push(name); return "alice@acme"; } }
    }, createElement(Order));

    await act(async () => root.render(tree("first")));
    await rendered(() => live.at(-1) === true, "live with the first getToken");
    const created = seen.client;
    assert.ok(created);
    await act(async () => root.render(tree("second")));
    assert.equal(seen.client, created, "a new getToken function keeps the client");
    assert.deepEqual(calls, ["first"]);

    await act(async () => created.reconnect());
    await rendered(() => calls.includes("second") && live.at(-1) === true, "live again after reconnecting");
    assert.deepEqual(calls, ["first", "second"]);

    await act(async () => root.unmount());
    await waitFor(() => h.internals.subscriptionCount() === 0, 5_000, "unsubscribed on the gateway");
  });
});
