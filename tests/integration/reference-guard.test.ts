import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { createClient, type Client } from "@streamotter/client";
import { silentLogger, type FixtureRecord, type Gateway, type HandlerRegistry, type Json, type ProjectConfig } from "@streamotter/gateway";
import { createGatewayRuntime, getGatewayInternals, type GatewayInternals, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import type { AppChannels } from "../../examples/order-dashboard/src/generated/streamotter.generated.ts";
import { decideRecovery, initialOrders, issueToken, OrderStore, type OutboxEntry, type SourcePosition } from "../../examples/order-dashboard/src/server/domain.ts";
import { createFixtureApplication, type FixtureApplication } from "../../examples/order-dashboard/src/server/fixture-handlers.ts";
import { observe, waitFor } from "./harness.ts";

/**
 * ADR-15B §5 at the fixture tier: the order-dashboard example's own recovery guard
 * and snapshot acknowledgment, driven through the gateway with the example's
 * streamotter.json. Every scenario publishes through the example's application,
 * and the test keeps its own ledger of what it published (outbox sequence, order,
 * timeline index, revision). Expected watermarks, decisions and states come from
 * that ledger and the order state machine as the test models it, never from the
 * example's guard (acceptance plan §1).
 */

const STATUSES = ["placed", "picking", "packed", "shipped", "delivered"] as const;

interface LedgerRow { seq: number; tenantId: string; orderId: string; index: number; revision: number }

/** The test's model of the application: what it published, in order, and each order's revision. */
class Ledger {
  readonly rows: LedgerRow[] = [];
  readonly #revisions = new Map<string, number>();
  readonly app = createFixtureApplication({ timeline: "empty" });

  /** Advances an order one step through the example and records what the test expects it to have published. */
  advance(tenantId: string, orderId: string): LedgerRow {
    return this.#record(tenantId, orderId, this.revision(tenantId, orderId) + 1, this.app.advance(tenantId, orderId));
  }

  /** Re-publishes an order's current state through the example. */
  republish(tenantId: string, orderId: string): LedgerRow {
    return this.#record(tenantId, orderId, this.revision(tenantId, orderId), this.app.republish(tenantId, orderId));
  }

  /** Replaces the record published at a row's index, as a broken serializer would have written it. */
  corrupt(row: LedgerRow, record: FixtureRecord): void {
    this.app.timeline[row.index] = record;
  }

  /** Appends a record the application never published, for example a test message sent to the wrong topic. */
  foreign(record: FixtureRecord): number {
    this.app.timeline.push(record);
    return this.app.timeline.length - 1;
  }

  revision(tenantId: string, orderId: string): number {
    return this.#revisions.get(`${tenantId}/${orderId}`) ?? 1;
  }

  /** The first row for the same order published after `index`: the re-publish the guard must find. */
  republishAfter(row: { tenantId: string; orderId: string }, index: number): LedgerRow | undefined {
    return this.rows.find(other => other.tenantId === row.tenantId && other.orderId === row.orderId && other.index > index);
  }

  #record(tenantId: string, orderId: string, revision: number, published: ReturnType<FixtureApplication["advance"]>): LedgerRow {
    const row = { seq: this.rows.length + 1, tenantId, orderId, index: this.app.timeline.length - 1, revision };
    this.rows.push(row);
    this.#revisions.set(`${tenantId}/${orderId}`, revision);
    // The example must have published exactly what the ledger says, where the ledger says.
    assert.deepEqual(published, {
      seq: row.seq, tenantId, orderId, revision: String(revision), position: { kind: "fixture", index: String(row.index) }
    });
    return row;
  }
}

interface SnapshotCall { orderId: string; recovery: { boundaryId: string; context: Json } | null; revision: string; acknowledged: string | null; watermark: number }

interface Running {
  gateway: Gateway;
  internals: GatewayInternals;
  snapshots: SnapshotCall[];
  client(user?: string): Client<AppChannels>;
  close(): Promise<void>;
}

const truncated = (row: LedgerRow): FixtureRecord => ({ key: row.orderId, raw: `{"tenantId":"${row.tenantId}","revision":"${row.revision}","ord` });

async function exampleConfig(): Promise<ProjectConfig<AppChannels>> {
  const config = JSON.parse(await readFile(new URL("../../examples/order-dashboard/streamotter.json", import.meta.url), "utf8")) as ProjectConfig<AppChannels>;
  return { ...config, gateway: { ...config.gateway, port: 0 } };
}

/** Starts a development gateway on the example's configuration and handlers, recording every snapshot result. */
async function start(app: FixtureApplication): Promise<Running> {
  const config = await exampleConfig();
  assert.deepEqual(config.failureHandling?.sources["orders"], { invalidJson: "quarantine-resync", invalidPublicPayload: "quarantine-resync" });
  const snapshots: SnapshotCall[] = [];
  const channel = app.handlers.channels.orderStatus;
  const handlers: HandlerRegistry<AppChannels> = {
    ...app.handlers,
    channels: {
      orderStatus: {
        ...channel,
        snapshot: async input => {
          const result = await channel.snapshot(input);
          snapshots.push({
            orderId: input.params.orderId, recovery: input.recovery ?? null, revision: result.revision,
            acknowledged: result.recoveryBoundaryId ?? null, watermark: app.readModel.watermark
          });
          return result;
        }
      }
    }
  };
  const gateway = createGatewayRuntime<AppChannels>({ config, handlers, development: app.development, mode: "development", logger: silentLogger }).gateway;
  const { origin } = await gateway.start();
  const clients: Client<AppChannels>[] = [];
  return {
    gateway, internals: getGatewayInternals(gateway), snapshots,
    client(user = "alice") {
      const client = createClient<AppChannels>({ origin, getToken: () => issueToken(user)!.token });
      clients.push(client);
      return client;
    },
    async close() {
      await Promise.all(clients.map(client => client.close()));
      await gateway.stop({ timeoutMs: 2_000 });
    }
  };
}

async function incidents(run: Running): Promise<IncidentRecord[]> {
  await run.internals.failuresSettled();
  return [...(run.internals.incidentStore() as IncidentStore).list({ state: "all" }).items];
}

const boundary = (run: Running) => (run.internals.incidentStore() as IncidentStore).boundary("orders");
const status = (run: Running) => run.internals.sources()[0]?.status;
const watch = (run: Running, orderId: string, user = "alice") =>
  observe(run.client(user).subscribe("orderStatus", { channelVersion: 1, params: { orderId } }));

describe("order-dashboard reference recovery guard (ADR-15B §5)", () => {
  let run: Running | undefined;
  afterEach(async () => { await run?.close(); run = undefined; });

  it("advances past a bad record whose order was re-published, and snapshots acknowledge only at the re-publish's watermark", async () => {
    const ledger = new Ledger();
    ledger.advance("acme", "ord_1001");                    // index 0: picking, r2
    const failed = ledger.advance("acme", "ord_1001");     // index 1: packed, r3; the bytes on the topic are broken
    ledger.corrupt(failed, truncated(failed));
    ledger.advance("acme", "ord_1002");                    // index 2: another order
    ledger.republish("acme", "ord_1001");                  // index 3: the application re-publishes packed, r3
    const republished = ledger.republishAfter(failed, failed.index);
    assert.ok(republished !== undefined);

    run = await start(ledger.app);
    const seen = watch(run, "ord_1001");
    await waitFor(() => seen.states.includes("live"), 5_000, "live before the incident");
    assert.equal(await run.internals.advanceFixture("orders", 1), 1);
    await waitFor(() => seen.events.some(event => event.revision === "2"), 5_000, "r2 delivered");

    assert.equal(await run.internals.advanceFixture("orders", 1), 0, "the broken record is not processed");
    const [incident] = await incidents(run);
    assert.ok(incident !== undefined);
    assert.equal(incident.failureClass, "invalid-json");
    assert.equal(incident.guard?.decision, "recoverable");
    assert.equal(incident.progress, "advanced");
    assert.equal(incident.recovery, "boundary-in-force");
    assert.match(incident.guard?.evidenceRef ?? "", new RegExp(`row ${failed.seq} failed at fixture index ${failed.index}; acme/ord_1001 re-published as outbox row ${republished.seq}$`));
    const installed = boundary(run);
    assert.equal(installed?.boundaryId, incident.boundaryId);
    assert.deepEqual(installed?.context, { watermark: republished.seq });

    // The read model has applied only index 0 (outbox row 1), so the resynchronizing snapshot must not acknowledge.
    await waitFor(() => run!.snapshots.some(call => call.recovery !== null), 5_000, "a snapshot asked to acknowledge");
    const early = run.snapshots.find(call => call.recovery !== null)!;
    assert.deepEqual(early.recovery, { boundaryId: installed?.boundaryId, context: { watermark: republished.seq } });
    assert.equal(early.watermark, 1);
    assert.equal(early.acknowledged, null);
    await waitFor(() => seen.states.at(-1) === "stale", 5_000, "stale without the acknowledgment");
    assert.ok(run.internals.traces({ limit: 100, outcome: "rejected" }).items.some(trace => trace.stage === "snapshot" && trace.errorCode === "SOURCE_UNAVAILABLE"));

    // Reading on through the re-publish lets the next attempt acknowledge and reach live on the re-published state.
    const liveBefore = seen.states.filter(state => state === "live").length;
    assert.equal(await run.internals.advanceFixture("orders", 2), 2);
    await waitFor(() => seen.states.filter(state => state === "live").length > liveBefore, 8_000, "live after the re-publish");
    const acknowledged = run.snapshots.filter(call => call.acknowledged !== null);
    assert.equal(acknowledged.length, 1);
    assert.equal(acknowledged[0]?.acknowledged, installed?.boundaryId);
    assert.ok((acknowledged[0]?.watermark ?? 0) >= republished.seq);
    assert.equal(acknowledged[0]?.revision, String(republished.revision));
    const last = seen.events.at(-1);
    assert.equal(last?.revision, "3");
    assert.equal((last?.data as { status: string }).status, STATUSES[republished.revision - 1]);
    assert.equal(status(run), "healthy");
  });

  it("holds, with recovery denied, a bad record whose order has no later outbox row", async () => {
    for (const failureClass of ["invalid-json", "payload-schema"] as const) {
      const ledger = new Ledger();
      const failed = ledger.advance("acme", "ord_1001");   // index 0: picking, r2; the published record is bad
      ledger.corrupt(failed, failureClass === "invalid-json" ? truncated(failed) : {
        key: failed.orderId,
        value: {
          tenantId: failed.tenantId, revision: String(failed.revision),
          order: { orderId: failed.orderId, status: STATUSES[failed.revision - 1] as string, progress: 30, updatedAt: "2026-09-24T09:01:00.000Z", note: "x".repeat(300) }
        }
      });
      ledger.advance("acme", "ord_1002");                  // index 1: a later row, for another order
      ledger.advance("globex", "ord_1001");                // index 2: the same order ID in another tenant
      assert.equal(ledger.republishAfter(failed, failed.index), undefined, "the model expects no re-publish");

      run = await start(ledger.app);
      assert.equal(await run.internals.advanceFixture("orders", 1), 0);
      const [incident] = await incidents(run);
      assert.equal(incident?.failureClass, failureClass);
      assert.equal(incident?.guard?.decision, "hold", failureClass);
      assert.equal(incident?.recovery, "denied", failureClass);
      assert.equal(incident?.progress, "held", failureClass);
      assert.equal(incident?.state, "open");
      assert.match(incident?.guard?.reason ?? "", /Order acme\/ord_1001 has not been re-published after the record at fixture index 0 \(outbox row 1\)/);
      assert.equal(boundary(run), null, `${failureClass}: no boundary`);
      assert.equal(status(run), "paused");
      // The whole source is held, so nobody reaches live, and nothing after the record is read.
      const seen = watch(run, "ord_1002");
      await waitFor(() => seen.states.includes("stale"), 5_000, "waiting for the held source");
      assert.ok(!seen.states.includes("live"));
      assert.equal(run.snapshots.length, 0);
      await run.close();
      run = undefined;
    }
  });

  it("makes a subscription created after the advance acknowledge the boundary before it goes live", async () => {
    const ledger = new Ledger();
    const failed = ledger.advance("acme", "ord_1001");      // index 0, broken
    ledger.corrupt(failed, truncated(failed));
    const republished = ledger.republish("acme", "ord_1001"); // index 1
    run = await start(ledger.app);
    assert.equal(await run.internals.advanceFixture("orders", 1), 0);
    const [incident] = await incidents(run);
    assert.equal(incident?.progress, "advanced");
    assert.deepEqual(boundary(run)?.context, { watermark: republished.seq });
    assert.equal(await run.internals.advanceFixture("orders", 1), 1, "the re-publish is read");
    assert.equal(run.snapshots.length, 0, "no subscription existed before the advance");

    const alice = watch(run, "ord_1001");
    const carol = watch(run, "ord_1003", "carol");
    await waitFor(() => alice.states.includes("live") && carol.states.includes("live"), 5_000, "live with the acknowledgment");
    assert.equal(run.snapshots.length, 2);
    for (const call of run.snapshots) {
      assert.deepEqual(call.recovery, { boundaryId: incident?.boundaryId, context: { watermark: republished.seq } }, call.orderId);
      assert.equal(call.acknowledged, incident?.boundaryId, call.orderId);
    }
    assert.equal(alice.events.at(-1)?.revision, String(republished.revision));
    assert.equal((alice.events.at(-1)?.data as { status: string }).status, STATUSES[republished.revision - 1]);
    assert.equal(carol.events.at(-1)?.revision, "1");
  });

  it("holds a bad record whose key cannot name an existing order", async () => {
    const cases: [string | null, RegExp][] = [
      ["not an order id!", /has a key that is not an order ID/],
      [null, /has no key/],
      ["ord_9999", /names order ord_9999, which does not exist/]
    ];
    for (const [key, reason] of cases) {
      const ledger = new Ledger();
      ledger.advance("acme", "ord_1001");
      const index = ledger.foreign({ key, raw: "{oops" });
      run = await start(ledger.app);
      assert.equal(await run.internals.advanceFixture("orders", 2), 1);
      const [incident] = await incidents(run);
      assert.deepEqual(incident?.position, { kind: "fixture", index: String(index) });
      assert.equal(incident?.guard?.decision, "hold", String(key));
      assert.equal(incident?.recovery, "denied", String(key));
      assert.equal(incident?.progress, "held", String(key));
      assert.match(incident?.guard?.reason ?? "", reason);
      assert.equal(boundary(run), null);
      await run.close();
      run = undefined;
    }
  });

  it("vouches for an order that never changed, carries the prior watermark forward, and holds an order changed only before the record", async () => {
    const ledger = new Ledger();
    const failed = ledger.advance("acme", "ord_1001");      // index 0, broken
    ledger.corrupt(failed, truncated(failed));
    const changed = ledger.advance("acme", "ord_1002");     // index 1
    const republished = ledger.republish("acme", "ord_1001"); // index 2
    const neverChanged = ledger.foreign({ key: "ord_1003", raw: "{oops" }); // index 3
    const stale = ledger.foreign({ key: "ord_1002", raw: "{oops" });       // index 4
    assert.equal(ledger.rows.some(row => row.orderId === "ord_1003"), false, "the model: ord_1003 never changed");
    assert.equal(ledger.republishAfter(changed, stale), undefined, "the model: ord_1002 was not re-published after index 4");

    run = await start(ledger.app);
    assert.equal(await run.internals.advanceFixture("orders", 1), 0);
    await run.internals.failuresSettled();
    const first = boundary(run);
    assert.deepEqual(first?.context, { watermark: republished.seq });
    await waitFor(() => status(run!) === "healthy", 5_000, "healthy");
    assert.equal(await run.internals.advanceFixture("orders", 2), 2);

    assert.equal(await run.internals.advanceFixture("orders", 1), 0, "the never-changed order's record");
    await run.internals.failuresSettled();
    const second = boundary(run);
    assert.notEqual(second?.boundaryId, first?.boundaryId);
    assert.equal(second?.supersedes, first?.boundaryId);
    assert.deepEqual(second?.context, { watermark: republished.seq }, "nothing new to wait for; the prior obligation is carried");
    const store = run.internals.incidentStore() as IncidentStore;
    const byIndex = (index: number) => store.list({ state: "all" }).items.find(item => item.position.kind === "fixture" && item.position.index === String(index));
    assert.equal(byIndex(neverChanged)?.progress, "advanced");
    assert.match(byIndex(neverChanged)?.guard?.evidenceRef ?? "", /acme\/ord_1003 never changed/);

    await waitFor(() => status(run!) === "healthy", 5_000, "healthy");
    assert.equal(await run.internals.advanceFixture("orders", 1), 0, "the changed order's record");
    await run.internals.failuresSettled();
    assert.equal(byIndex(stale)?.guard?.decision, "hold");
    assert.equal(byIndex(stale)?.recovery, "denied");
    assert.match(byIndex(stale)?.guard?.reason ?? "", /Order acme\/ord_1002 has not been re-published after the record at fixture index 4\./);
    assert.equal(boundary(run)?.boundaryId, second?.boundaryId, "a hold installs nothing");
    assert.equal(status(run), "paused");
  });
});

/**
 * The guard's evidence rules on stores the fixture application cannot produce: a store
 * restored without its outbox history, and an outbox whose positions repeat. The
 * expected decisions follow from the stores the tests build, not from the guard.
 */
describe("order-dashboard reference recovery guard: incomplete or ambiguous outbox", () => {
  const kafka = (offset: string): SourcePosition => ({ kind: "kafka", topic: "orders.status", partition: 0, offset });
  const fixture = (index: string): SourcePosition => ({ kind: "fixture", index });
  const incident = (position: SourcePosition) => ({ failureId: "f1", failureClass: "invalid-json" as const, position, evidenceHash: "sha256:00" });

  /** A store restored from a file written before the outbox existed, after acme/ord_1001 changed three times. */
  function legacyStore(): OrderStore {
    const orders = Object.fromEntries(initialOrders());
    const order = orders["acme/ord_1001"]!;
    orders["acme/ord_1001"] = { ...order, revision: "4", state: { ...order.state, status: "shipped", progress: 80 } };
    return OrderStore.restore(orders);
  }

  it("does not read a missing outbox history as 'never changed' when the order's revision moved", () => {
    const store = legacyStore();
    assert.equal(store.outbox().length, 0, "the restored store has no outbox rows");
    const decision = decideRecovery({ outbox: store.outbox(), orders: store.orders.values(), incident: incident(fixture("12")), prior: null, sourceKey: "ord_1001" });
    assert.equal(decision.decision, "hold");
    assert.match(decision.decision === "hold" ? decision.reason : "", /Order acme\/ord_1001 has not been re-published after the record at fixture index 12\./);

    // An order still at its seed revision did not change, whatever the outbox holds.
    const unchanged = decideRecovery({ outbox: store.outbox(), orders: store.orders.values(), incident: incident(fixture("12")), prior: null, sourceKey: "ord_1003" });
    assert.deepEqual(unchanged, { decision: "recoverable", context: { watermark: 0 }, evidenceRef: "outbox: acme/ord_1003 never changed" });
  });

  it("does not read a pruned outbox as 'never changed'", () => {
    const store = new OrderStore();
    const order = store.get("acme", "ord_1002")!;
    const row = store.commit({ ...order, revision: "2", state: { ...order.state, status: "picking", progress: 30 } });
    store.markPublished(row.seq, fixture("0"));
    // The rows for the order were pruned; the order itself is still at revision 2.
    const pruned = store.outbox().filter(entry => entry.orderId !== "ord_1002");
    const decision = decideRecovery({ outbox: pruned, orders: store.orders.values(), incident: incident(fixture("5")), prior: null, sourceKey: "ord_1002" });
    assert.equal(decision.decision, "hold");
  });

  it("holds when more than one outbox row recorded the failed position", () => {
    const outbox: OutboxEntry[] = [
      { seq: 1, tenantId: "acme", orderId: "ord_1001", revision: "2", position: kafka("3") },
      { seq: 2, tenantId: "acme", orderId: "ord_1001", revision: "3", position: kafka("7") },
      // The topic was re-created with the outbox kept, so offsets started again.
      { seq: 50, tenantId: "acme", orderId: "ord_1002", revision: "2", position: kafka("3") }
    ];
    const decision = decideRecovery({ outbox, orders: initialOrders().values(), incident: incident(kafka("3")), prior: null });
    assert.equal(decision.decision, "hold");
    assert.match(decision.decision === "hold" ? decision.reason : "", /Outbox rows 1, 50 all record orders\.status\[0\]@3/);
  });

  it("returns a watermark at least the failed row's sequence", () => {
    // The failed row (seq 5) landed before a re-publish row with a lower sequence (seq 4), for example after a relay retried out of order.
    const outbox: OutboxEntry[] = [
      { seq: 4, tenantId: "acme", orderId: "ord_1001", revision: "2", position: kafka("8") },
      { seq: 5, tenantId: "acme", orderId: "ord_1001", revision: "2", position: kafka("6") }
    ];
    const decision = decideRecovery({ outbox, orders: initialOrders().values(), incident: incident(kafka("6")), prior: null });
    assert.equal(decision.decision, "recoverable");
    assert.deepEqual(decision.decision === "recoverable" ? decision.context : null, { watermark: 5 });
  });
});
