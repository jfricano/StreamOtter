import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { container } from "./dom.ts";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  StreamOtterError,
  type ChannelContract, type Client, type ConnectionState, type Json, type Params, type StateChange, type StreamError, type StreamEvent,
  type Subscription, type SubscriptionState, type Unlisten, type WaitOptions
} from "@streamotter/contracts";
import {
  createStreamOtterHooks, StreamOtterProvider, useConnectionState, useStreamOtterClient, useSubscription,
  type SubscriptionOptions, type SubscriptionResult
} from "../src/react.ts";

type Order = { orderId: string; status: string };
type Channels = {
  orderStatus: ChannelContract<{ orderId: string }, Order, 1 | 2>;
  orderNotes: ChannelContract<{ orderId: string }, Json, 1>;
};

/** Behaves like the SDK's subscription where the hook can tell: `unsubscribe()` emits `closed` to the listeners still registered, then drops them. */
class FakeSubscription implements Subscription<Json> {
  readonly id: string;
  readonly channel: string;
  readonly channelVersion: number;
  readonly params: Params;
  state: SubscriptionState = "idle";
  unsubscribed = false;
  rejectUnsubscribe = false;
  /** How many listeners the hook still had registered when it called `unsubscribe()` (S7 says none). */
  listeningAtUnsubscribe = -1;
  readonly resyncs: (WaitOptions | undefined)[] = [];
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
  resync(options?: WaitOptions): Promise<void> { this.resyncs.push(options); return Promise.resolve(); }
  unsubscribe(): Promise<void> {
    this.unsubscribed = true;
    this.listeningAtUnsubscribe = this.listening;
    this.emitState("closed");
    for (const set of Object.values(this.listeners)) set.clear();
    return this.rejectUnsubscribe ? Promise.reject(new StreamOtterError("CLIENT_CLOSED")) : Promise.resolve();
  }
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
  closed = false;
  readonly subscriptions: FakeSubscription[] = [];
  readonly stateListeners = new Set<(change: StateChange<ConnectionState>) => void>();
  subscribe(channel: string, options: { channelVersion: number; params: Params }): Subscription<Order> {
    if (this.closed) throw new StreamOtterError("CLIENT_CLOSED");
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
  reconnect(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; this.state = "closed"; return Promise.resolve(); }
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

async function unmount(): Promise<void> {
  await act(async () => root!.unmount());
  root = null;
}

type Probe = { results: SubscriptionResult<Order>[]; latest: () => SubscriptionResult<Order>; Probe: (props: { orderId: string | null }) => null };

/** Renders a component that subscribes to one order and records every result it renders. */
function orderProbe(): Probe {
  const results: SubscriptionResult<Order>[] = [];
  function Probe({ orderId }: { orderId: string | null }): null {
    const options: SubscriptionOptions<Channels, "orderStatus"> | null = orderId === null ? null : { channelVersion: 1, params: { orderId } };
    results.push(hooks.useSubscription("orderStatus", options));
    return null;
  }
  return { results, latest: () => results.at(-1)!, Probe };
}

/** Every result rendered from index `since` on shows no data, no error and is not live. */
function allEmpty(results: SubscriptionResult<Order>[], since: number): boolean {
  const rendered = results.slice(since);
  return rendered.length > 0 && rendered.every(result => result.data === undefined && result.revision === undefined && result.error === undefined && !result.live);
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
    client.state = "connected";
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
    assert.deepEqual(clients, [null, client]);
    assert.equal(tokens, 0, "an owned client is not created on the server");
    assert.equal(client.subscriptions.length, 0, "a supplied client is not subscribed on the server");
    assert.deepEqual(states, ["idle", "idle"], "the server snapshot is idle even for a connected client");
    assert.equal(results.length, 2);
    assert.ok(allEmpty(results, 0) && results.every(result => result.state === "idle"));
  });

  it("P1: the provider rejects options without a getToken function at render", async () => {
    root = createRoot(container(), { onUncaughtError: () => {} });
    await assert.rejects(async () => {
      await act(async () => root!.render(createElement(StreamOtterProvider, { options: { origin: "http://localhost:4000" } as never })));
    }, (error: StreamOtterError) => error.code === "INVALID_REQUEST" && /getToken/.test(error.message));
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
    await unmount();
    assert.equal(client.active.length, 0);
    assert.equal(client.closed, false, "the provider does not close a client it was given");
  });

  it("S1/S4/S5/S7: render data, revision, state and errors; live clears the error; unmount unsubscribes with no render after it", async () => {
    const client = new FakeClient();
    const { results, latest, Probe } = orderProbe();
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
    const rendered = results.length;
    await unmount();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(subscription.unsubscribed, true);
    assert.equal(subscription.listeningAtUnsubscribe, 0, "listeners removed before unsubscribe()");
    assert.equal(results.length, rendered, "the closed state emitted by unsubscribe() does not render");
  });

  it("S7: a rejected unsubscribe() is ignored", async () => {
    const client = new FakeClient();
    const { Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    client.subscriptions[0]!.rejectUnsubscribe = true;
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "b" })));
    await unmount();
    // An unhandled rejection would fail the test run; nothing else to assert.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(client.active.length, 0);
  });

  it("S2/S4: keep the subscription for equal params in a new object; a changed value replaces it and shows no old data", async () => {
    const client = new FakeClient();
    const { results, latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    await act(async () => { client.subscriptions[0]!.emitData({ orderId: "a", status: "queued" }, "4"); client.subscriptions[0]!.emitState("live"); });
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 1, "a re-render with equal params does not resubscribe");
    assert.deepEqual(latest().data, { orderId: "a", status: "queued" });
    const since = results.length;
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "b" })));
    assert.equal(client.subscriptions.length, 2);
    assert.equal(client.subscriptions[0]!.unsubscribed, true);
    assert.deepEqual(client.subscriptions[1]!.params, { orderId: "b" });
    assert.ok(allEmpty(results, since), "no render after the params change shows the previous data");
  });

  it("S2: a changed channelVersion or channel is a new identity", async () => {
    const client = new FakeClient();
    const results: SubscriptionResult<Json>[] = [];
    function Versioned({ version, channel }: { version: 1 | 2; channel: "orderStatus" | "orderNotes" }): null {
      results.push(hooks.useSubscription(channel, { channelVersion: version as 1, params: { orderId: "b" } }));
      return null;
    }
    const tree = (version: 1 | 2, channel: "orderStatus" | "orderNotes"): ReactNode =>
      createElement(StreamOtterProvider, { client }, createElement(Versioned, { version, channel }));
    await render(tree(1, "orderStatus"));
    await act(async () => { client.subscriptions[0]!.emitData({ orderId: "b", status: "queued" }, "1"); });
    let since = results.length;
    await render(tree(2, "orderStatus"));
    assert.equal(client.subscriptions.length, 2);
    assert.equal(client.subscriptions[1]!.channelVersion, 2);
    assert.ok(results.slice(since).every(result => result.data === undefined));
    await act(async () => { client.subscriptions[1]!.emitData({ orderId: "b", status: "packed" }, "2"); });
    since = results.length;
    await render(tree(2, "orderNotes"));
    assert.equal(client.subscriptions.length, 3);
    assert.equal(client.subscriptions[2]!.channel, "orderNotes");
    assert.ok(results.slice(since).every(result => result.data === undefined));
    assert.equal(client.active.length, 1);
  });

  it("S2: params in a different key order are equal; a value of another type is not", async () => {
    type Multi = { stock: ChannelContract<{ site: string | number; sku: string }, Json, 2> };
    const client = new FakeClient();
    const multi = createStreamOtterHooks<Multi>();
    function Probe({ params }: { params: Multi["stock"]["params"] }): null {
      multi.useSubscription("stock", { channelVersion: 2, params });
      return null;
    }
    const tree = (params: Multi["stock"]["params"]): ReactNode => createElement(StreamOtterProvider, { client }, createElement(Probe, { params }));
    await render(tree({ site: "1", sku: "x" }));
    await render(tree({ sku: "x", site: "1" }));
    assert.equal(client.subscriptions.length, 1, "key order does not matter");
    await render(tree({ site: 1, sku: "x" }));
    assert.equal(client.subscriptions.length, 2, "the number 1 is not the string \"1\"");
  });

  it("S2: options without a numeric channelVersion or a params object throw at render", async () => {
    const client = new FakeClient();
    for (const options of [{ channelVersion: "1", params: { orderId: "a" } }, { channelVersion: 1 }, { channelVersion: 1, params: "a" }]) {
      function Bad(): null { useSubscription("orderStatus", options as never); return null; }
      const badRoot = createRoot(container(), { onUncaughtError: () => {} });
      await assert.rejects(async () => {
        await act(async () => badRoot.render(createElement(StreamOtterProvider, { client }, createElement(Bad))));
      }, (error: StreamOtterError) => error.code === "INVALID_REQUEST" && /channelVersion and params/.test(error.message), JSON.stringify(options));
      await act(async () => badRoot.unmount());
    }
    assert.equal(client.subscriptions.length, 0);
  });

  it("S3/S4: hold off while options are null; the same identity returning later starts from idle", async () => {
    const client = new FakeClient();
    const { results, latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: null })));
    assert.equal(client.subscriptions.length, 0);
    assert.equal(latest().state, "idle");
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 1);
    await act(async () => { client.subscriptions[0]!.emitData({ orderId: "a", status: "queued" }, "1"); client.subscriptions[0]!.emitState("live"); });
    assert.equal(latest().live, true);
    let since = results.length;
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: null })));
    assert.equal(client.active.length, 0);
    assert.equal(latest().state, "idle");
    assert.ok(allEmpty(results, since), "nothing of the unsubscribed stream is rendered once options are null");
    since = results.length;
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 2, "the same identity subscribes again");
    assert.ok(allEmpty(results, since), "no render shows the old subscription's data or live state");
    assert.equal(latest().state, "idle", "the new subscription's own state");
  });

  it("A3: StrictMode mounts twice and leaves exactly one open subscription", async () => {
    const client = new FakeClient();
    const { Probe } = orderProbe();
    await render(createElement(StrictMode, null, createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" }))));
    assert.equal(client.subscriptions.length, 2, "the development double mount subscribed twice");
    assert.equal(client.active.length, 1);
    assert.ok(client.subscriptions[0]!.unsubscribed && client.subscriptions[0]!.listening === 0);
  });

  it("S2/S5: replace the subscription when the client changes, showing no old data or error", async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { results, latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client: first }, createElement(Probe, { orderId: "a" })));
    await act(async () => { first.subscriptions[0]!.emitData({ orderId: "a", status: "queued" }, "1"); first.subscriptions[0]!.emitError("SOURCE_UNAVAILABLE"); });
    assert.equal(latest().error?.code, "SOURCE_UNAVAILABLE");
    const since = results.length;
    await render(createElement(StreamOtterProvider, { client: second }, createElement(Probe, { orderId: "a" })));
    assert.equal(first.subscriptions[0]!.unsubscribed, true);
    assert.equal(second.subscriptions.length, 1);
    assert.ok(allEmpty(results, since));
  });

  it("S6: resync forwards its options to the subscription, rejects without one, and keeps its identity", async () => {
    const client = new FakeClient();
    const { results, latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: null })));
    await assert.rejects(latest().resync(), (error: StreamOtterError) => error.code === "INVALID_REQUEST");
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    await latest().resync({ timeoutMs: 5 });
    await latest().resync();
    assert.deepEqual(client.subscriptions[0]!.resyncs, [{ timeoutMs: 5 }, undefined]);
    assert.ok(results.every(result => result.resync === results[0]!.resync), "resync is the same function on every render");
  });

  it("S8: two components with the same identity hold two subscriptions", async () => {
    const client = new FakeClient();
    const { Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" }), createElement(Probe, { orderId: "a" })));
    assert.equal(client.active.length, 2);
  });

  it("S9: a supplied client that is closed is not subscribed to, and renders idle", async () => {
    const client = new FakeClient();
    await client.close();
    const { latest, Probe } = orderProbe();
    await render(createElement(StreamOtterProvider, { client }, createElement(Probe, { orderId: "a" })));
    assert.equal(client.subscriptions.length, 0);
    assert.equal(latest().state, "idle");
  });

  it("S9/P2: replacing the owned client in the same commit as a child's new identity does not throw, and the child subscribes on the new client", async () => {
    const clients: (Client<Channels> | null)[] = [];
    const subscribed: { client: Client<Channels>; params: Params }[] = [];
    const { Probe } = orderProbe();
    // Records which client each subscribe() reaches; the hook reads `subscribe` from the client at effect time.
    function Watch(): null {
      const client = hooks.useClient();
      if (client !== null && !clients.includes(client)) {
        const original = client.subscribe.bind(client);
        client.subscribe = ((channel, options) => { subscribed.push({ client, params: options.params }); return original(channel, options); }) as typeof client.subscribe;
      }
      clients.push(client);
      return null;
    }
    const tree = (origin: string, orderId: string): ReactNode =>
      createElement(StreamOtterProvider, { options: { origin, getToken: () => "token" } }, createElement(Watch), createElement(Probe, { orderId }));
    await render(tree("http://localhost:4000", "a"));
    const created = clients.at(-1);
    assert.ok(created);
    assert.deepEqual(subscribed.map(entry => entry.params), [{ orderId: "a" }]);
    await render(tree("http://localhost:4001", "b"));
    const replaced = clients.at(-1);
    assert.ok(replaced && replaced !== created);
    assert.equal(created.state, "closed");
    assert.deepEqual(subscribed.map(entry => [entry.client === replaced, entry.params]), [[false, { orderId: "a" }], [true, { orderId: "b" }]], "b subscribed once, on the replacement client only");
    await unmount();
    assert.equal(replaced.state, "closed");
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
    await unmount();
    assert.equal(client.stateListeners.size, 0);
  });

  it("P1/P2/K1: the provider creates a client from options, keeps it across new getToken functions, replaces it for a new origin or path, and closes it on unmount", async () => {
    const clients: (Client<Channels> | null)[] = [];
    function Probe(): null { clients.push(hooks.useClient()); return null; }
    const tree = (origin: string, path: string | undefined, getToken: () => string): ReactNode =>
      createElement(StrictMode, null, createElement(StreamOtterProvider, { options: { origin, ...(path !== undefined && { path }), getToken } }, createElement(Probe)));
    await render(tree("http://localhost:4000", undefined, () => "first"));
    assert.equal(clients[0], null, "null until the mount effect creates the client");
    const created = clients.at(-1);
    assert.ok(created);
    assert.equal(created.state, "idle", "no connection until something subscribes");
    await render(tree("http://localhost:4000", undefined, () => "second"));
    assert.equal(clients.at(-1), created, "a new getToken function keeps the client");
    await render(tree("http://localhost:4001", undefined, () => "second"));
    const replaced = clients.at(-1);
    assert.ok(replaced !== null && replaced !== created);
    assert.equal(created.state, "closed");
    await render(tree("http://localhost:4001", "/custom/socket", () => "second"));
    const repathed = clients.at(-1);
    assert.ok(repathed !== null && repathed !== replaced);
    assert.equal(replaced!.state, "closed");
    await unmount();
    assert.equal(repathed!.state, "closed");
  });

  it("P5: a new key on the provider closes the owned client and creates one for the next identity", async () => {
    const clients: (Client<Channels> | null)[] = [];
    function Probe(): null { clients.push(hooks.useClient()); return null; }
    const tree = (user: string): ReactNode =>
      createElement(StreamOtterProvider, { key: user, options: { origin: "http://localhost:4000", getToken: () => user } }, createElement(Probe));
    await render(tree("alice"));
    const alice = clients.at(-1);
    assert.ok(alice);
    await render(tree("bob"));
    const bob = clients.at(-1);
    assert.ok(bob && bob !== alice);
    assert.equal(alice.state, "closed");
    assert.notEqual(bob.state, "closed");
  });

  it("P1/P4: switching from a supplied client to options creates an owned client and leaves the supplied one open", async () => {
    const supplied = new FakeClient();
    const clients: (Client<Channels> | null)[] = [];
    function Probe(): null { clients.push(hooks.useClient()); return null; }
    await render(createElement(StreamOtterProvider, { client: supplied }, createElement(Probe)));
    assert.equal(clients.at(-1), supplied);
    await render(createElement(StreamOtterProvider, { options: { origin: "http://localhost:4000", getToken: () => "token" } }, createElement(Probe)));
    const owned = clients.at(-1);
    assert.ok(owned && owned !== supplied);
    assert.equal(supplied.closed, false);
    await unmount();
    assert.equal(owned.state, "closed");
  });

  it("A4: createStreamOtterHooks returns the shared hooks", () => {
    assert.equal(hooks.useSubscription, useSubscription);
    assert.equal(hooks.useClient, useStreamOtterClient);
    assert.equal(hooks.useConnectionState, useConnectionState);
  });
});
