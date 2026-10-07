import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { container } from "./dom.ts";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  StreamOtterError,
  type ChannelContract, type Client, type ConnectionState, type Json, type Params, type StateChange, type StreamError, type StreamEvent,
  type Subscription, type SubscriptionState, type Unlisten
} from "@streamotter/contracts";
import {
  createStreamOtterHooks, StreamOtterProvider, useConnectionState, useStreamOtterClient, useSubscription,
  type SubscriptionOptions, type SubscriptionResult
} from "../src/react.ts";

type Order = { orderId: string; status: string };
type Channels = { orderStatus: ChannelContract<{ orderId: string }, Order, 1> };

class FakeSubscription implements Subscription<Json> {
  readonly id: string;
  readonly channel: string;
  readonly channelVersion: number;
  readonly params: Params;
  state: SubscriptionState = "idle";
  unsubscribed = false;
  resyncs = 0;
  readonly listeners = { data: new Set<(event: StreamEvent<Json>) => void>(), state: new Set<(change: StateChange<SubscriptionState>) => void>(), error: new Set<(error: StreamError) => void>() };
  constructor(channel: string, channelVersion: number, params: Params, index: number) {
    this.id = `sub-${index}`;
    this.channel = channel;
    this.channelVersion = channelVersion;
    this.params = params;
  }
  on(event: "data" | "state" | "error", listener: (value: never) => void): Unlisten {
    const set = this.listeners[event] as Set<unknown>;
    set.add(listener);
    return () => { set.delete(listener); };
  }
  get listening(): number {
    return this.listeners.data.size + this.listeners.state.size + this.listeners.error.size;
  }
  ready(): Promise<void> { return Promise.resolve(); }
  resync(): Promise<void> { this.resyncs++; return Promise.resolve(); }
  unsubscribe(): Promise<void> { this.unsubscribed = true; this.state = "closed"; return Promise.resolve(); }
  emitState(state: SubscriptionState): void { this.state = state; for (const listener of this.listeners.state) listener({ state }); }
  emitData(data: Json, revision: string): void {
    const event: StreamEvent<Json> = { id: `e${revision}`, channel: this.channel, channelVersion: this.channelVersion, kind: "update", data, revision, receivedAt: "2026-10-06T00:00:00.000Z" };
    for (const listener of this.listeners.data) listener(event);
  }
  emitError(code: StreamError["code"]): void {
    const error = new StreamOtterError(code);
    for (const listener of this.listeners.error) listener(error);
  }
}

class FakeClient implements Client<Channels> {
  state: ConnectionState = "idle";
  readonly subscriptions: FakeSubscription[] = [];
  readonly stateListeners = new Set<(change: StateChange<ConnectionState>) => void>();
  subscribe(channel: string, options: { channelVersion: number; params: Params }): Subscription<Order> {
    const subscription = new FakeSubscription(channel, options.channelVersion, options.params, this.subscriptions.length);
    this.subscriptions.push(subscription);
    return subscription as unknown as Subscription<Order>;
  }
  on(event: "state" | "error", listener: (value: never) => void): Unlisten {
    if (event !== "state") return () => {};
    const stateListener = listener as (change: StateChange<ConnectionState>) => void;
    this.stateListeners.add(stateListener);
    return () => { this.stateListeners.delete(stateListener); };
  }
  emitState(state: ConnectionState): void { this.state = state; for (const listener of this.stateListeners) listener({ state }); }
  closed = false;
  reconnect(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; return Promise.resolve(); }
  /** Subscriptions still open. */
  get active(): FakeSubscription[] { return this.subscriptions.filter(subscription => !subscription.unsubscribed); }
}

const hooks = createStreamOtterHooks<Channels>();

let root: Root | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root!.unmount());
  root = null;
});

async function render(node: ReactNode): Promise<void> {
  root ??= createRoot(container());
  await act(async () => root!.render(node));
}

/** Renders a component that subscribes to one order and records every result it renders. */
function orderProbe(): { results: SubscriptionResult<Order>[]; latest: () => SubscriptionResult<Order>; Probe: (props: { orderId: string | null }) => null } {
  const results: SubscriptionResult<Order>[] = [];
  function Probe({ orderId }: { orderId: string | null }): null {
    const options: SubscriptionOptions<Channels, "orderStatus"> | null = orderId === null ? null : { channelVersion: 1, params: { orderId } };
    results.push(hooks.useSubscription("orderStatus", options));
    return null;
  }
  return { results, latest: () => results.at(-1)!, Probe };
}

// Test names start with the clause IDs of docs/releases/v1.3/API.md that they cover.
describe("React hooks", () => {
  it("A1: every hook throws outside a provider", async () => {
    const bare = [
      function Subscription(): null { useSubscription("orderStatus", { channelVersion: 1, params: { orderId: "a" } }); return null; },
      function ConnectionState(): null { useConnectionState(); return null; },
      function ClientHook(): null { useStreamOtterClient(); return null; }
    ];
    for (const Bare of bare) {
      const bareRoot = createRoot(container(), { onUncaughtError: () => {} });
      await assert.rejects(async () => { await act(async () => bareRoot.render(createElement(Bare))); }, (error: StreamOtterError) =>
        error.code === "INVALID_REQUEST" && /StreamOtterProvider/.test(error.message), Bare.name);
      await act(async () => bareRoot.unmount());
    }
  });

  it("A2: server rendering creates no client, subscribes to nothing and renders the no-client values", () => {
    const client = new FakeClient();
    const results: SubscriptionResult<Order>[] = [];
    const states: ConnectionState[] = [];
    const clients: (Client<Channels> | null)[] = [];
    function Page(): null {
      results.push(hooks.useSubscription("orderStatus", { channelVersion: 1, params: { orderId: "a" } }));
      states.push(hooks.useConnectionState());
      clients.push(hooks.useClient());
      return null;
    }
    let tokens = 0;
    const getToken = (): string => { tokens++; return "token"; };
    renderToString(createElement(StreamOtterProvider, { options: { origin: "http://localhost:4000", getToken } }, createElement(Page)));
    renderToString(createElement(StreamOtterProvider, { client }, createElement(Page)));
    assert.deepEqual(clients.slice(0, 1), [null], "an owned client is not created on the server");
    assert.equal(tokens, 0);
    assert.equal(client.subscriptions.length, 0, "a supplied client is not subscribed on the server");
    assert.deepEqual(states, ["idle", "idle"]);
    assert.ok(results.every(result => result.state === "idle" && result.data === undefined && result.error === undefined && !result.live));
  });

  it("P4/S1: stay idle without a client, subscribe once one is provided, and never close a supplied client", async () => {
    const { latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client: null }, createElement(Probe, { orderId: "a" })));
    assert.equal(latest().state, "idle");
    assert.equal(latest().data, undefined);
    const client = new FakeClient();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 1);
    assert.deepEqual(client.subscriptions[0]!.params, { orderId: "a" });
    assert.equal(client.subscriptions[0]!.channelVersion, 1);
    await act(async () => root!.unmount());
    root = null;
    assert.equal(client.active.length, 0);
    assert.equal(client.closed, false, "the provider does not close a client it was given");
  });

  it("S1/S4/S5/S7: render data, revision, state and errors; live clears the error; unmount unsubscribes", async () => {
    const client = new FakeClient();
    const { latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    const subscription = client.subscriptions[0]!;
    await act(async () => { subscription.emitState("authorizing"); subscription.emitState("synchronizing"); });
    assert.equal(latest().state, "synchronizing");
    assert.equal(latest().live, false);
    await act(async () => { subscription.emitData({ orderId: "a", status: "queued" }, "1"); subscription.emitState("live"); });
    assert.deepEqual(latest().data, { orderId: "a", status: "queued" });
    assert.equal(latest().revision, "1");
    assert.equal(latest().live, true);
    await act(async () => { subscription.emitState("stale"); subscription.emitError("SOURCE_UNAVAILABLE"); });
    assert.equal(latest().state, "stale");
    assert.equal(latest().error?.code, "SOURCE_UNAVAILABLE");
    assert.deepEqual(latest().data, { orderId: "a", status: "queued" }, "last known data stays while stale");
    await act(async () => { subscription.emitState("live"); });
    assert.equal(latest().error, undefined);
    await act(async () => root!.unmount());
    root = null;
    assert.equal(subscription.unsubscribed, true);
    assert.equal(subscription.listening, 0, "listeners removed on unmount");
  });

  it("S2/S4: keep the subscription for equal params in a new object, and replace it when a value changes", async () => {
    const client = new FakeClient();
    const { latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    await act(async () => { client.subscriptions[0]!.emitData({ orderId: "a", status: "queued" }, "4"); });
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 1, "a re-render with equal params does not resubscribe");
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "b" })));
    assert.equal(client.subscriptions.length, 2);
    assert.equal(client.subscriptions[0]!.unsubscribed, true);
    assert.deepEqual(client.subscriptions[1]!.params, { orderId: "b" });
    assert.equal(latest().data, undefined, "data from the previous params is not shown");
    assert.equal(latest().revision, undefined);
  });

  it("S2: treat params in a different key order as equal", async () => {
    type Multi = { stock: ChannelContract<{ site: string; sku: string }, Json, 2> };
    const client = new FakeClient();
    const multi = createStreamOtterHooks<Multi>();
    function Probe({ flip }: { flip: boolean }): null {
      multi.useSubscription("stock", { channelVersion: 2, params: flip ? { sku: "x", site: "s" } : { site: "s", sku: "x" } });
      return null;
    }
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { flip: false })));
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { flip: true })));
    assert.equal(client.subscriptions.length, 1);
  });

  it("S3: hold off while options are null", async () => {
    const client = new FakeClient();
    const { latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: null })));
    assert.equal(client.subscriptions.length, 0);
    assert.equal(latest().state, "idle");
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 1);
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: null })));
    assert.equal(client.active.length, 0);
    assert.equal(latest().state, "idle");
  });

  it("A3: leave exactly one open subscription under StrictMode", async () => {
    const client = new FakeClient();
    const { Probe } = orderProbe();
    await render(createElement(StrictMode, null, createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" }))));
    assert.equal(client.active.length, 1);
    assert.ok(client.subscriptions.slice(0, -1).every(subscription => subscription.unsubscribed && subscription.listening === 0));
  });

  it("S2/S5: replace the subscription when the client changes, clearing data and error", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client: first }, createElement(Probe, { orderId: "a" })));
    await act(async () => { first.subscriptions[0]!.emitData({ orderId: "a", status: "queued" }, "1"); first.subscriptions[0]!.emitError("SOURCE_UNAVAILABLE"); });
    assert.equal(latest().error?.code, "SOURCE_UNAVAILABLE");
    await render(createElement(StreamOtterProvider, { client: second }, createElement(Probe, { orderId: "a" })));
    assert.equal(first.subscriptions[0]!.unsubscribed, true);
    assert.equal(second.subscriptions.length, 1);
    assert.equal(latest().data, undefined);
    assert.equal(latest().error, undefined);
  });

  it("S6: resync delegates to the subscription, rejects without one, and keeps its identity", async () => {
    const client = new FakeClient();
    const { results, latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: null })));
    await assert.rejects(latest().resync(), (error: StreamOtterError) => error.code === "INVALID_REQUEST");
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    await latest().resync();
    assert.equal(client.subscriptions[0]!.resyncs, 1);
    assert.ok(results.every(result => result.resync === results[0]!.resync), "resync is the same function on every render");
  });

  it("C1: useConnectionState follows the client, is idle without one, and stops listening on unmount", async () => {
    const client = new FakeClient();
    const seen: ConnectionState[] = [];
    function State(): null { seen.push(useConnectionState()); return null; }
    await render(createElement(StreamOtterProvider, { client: null }, createElement(State)));
    assert.equal(seen.at(-1), "idle");
    await render(createElement(StreamOtterProvider, { client }, createElement(State)));
    await act(async () => client.emitState("connecting"));
    assert.equal(seen.at(-1), "connecting");
    await act(async () => client.emitState("connected"));
    assert.equal(seen.at(-1), "connected");
    await act(async () => root!.unmount());
    root = null;
    assert.equal(client.stateListeners.size, 0);
  });

  it("P1/P2/K1: the provider creates a client from options, keeps it across new getToken functions, replaces it for a new origin, and closes it on unmount", async () => {
    const clients: (Client<Channels> | null)[] = [];
    function Probe(): null { clients.push(hooks.useClient()); return null; }
    const tree = (origin: string, getToken: () => string): ReactNode =>
      createElement(StrictMode, null, createElement(StreamOtterProvider, { options: { origin, getToken } }, createElement(Probe)));
    await render(tree("http://localhost:4000", () => "first"));
    assert.equal(clients[0], null, "null until the mount effect creates the client");
    const created = clients.at(-1);
    assert.ok(created);
    assert.equal(created.state, "idle", "no connection until something subscribes");
    await render(tree("http://localhost:4000", () => "second"));
    assert.equal(clients.at(-1), created, "a new getToken function keeps the client");
    await render(tree("http://localhost:4001", () => "second"));
    const replaced = clients.at(-1);
    assert.ok(replaced !== null && replaced !== created);
    assert.equal(created.state, "closed");
    await act(async () => root!.unmount());
    root = null;
    assert.equal(replaced!.state, "closed");
  });

  it("A4: createStreamOtterHooks returns the shared hooks", () => {
    assert.equal(hooks.useSubscription, useSubscription);
    assert.equal(hooks.useClient, useStreamOtterClient);
    assert.equal(hooks.useConnectionState, useConnectionState);
  });
});
