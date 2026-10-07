/**
 * V1.3 React hooks against a running gateway: components render a snapshot, a live update and a
 * denial, StrictMode opens no extra subscription, and unmounting unsubscribes on the gateway.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Window } from "happy-dom";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createStreamOtterHooks, StreamOtterProvider, type SubscriptionResult } from "@streamotter/client/react";
import { orderRecord, sleep, startHarness, waitFor, type Harness, type OrderState, type TestChannels } from "./harness.ts";

const window = new Window({ url: "http://localhost:3000/" });
Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });

const { useSubscription, useConnectionState } = createStreamOtterHooks<TestChannels>();

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

  it("renders the snapshot, live updates, and a denial; unmounting unsubscribes", async () => {
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
});
