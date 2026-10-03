import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createGateway, silentLogger, TransientMappingError,
  type ChannelMap, type FailureHandlingConfig, type FixtureRecord, type HandlerRegistry, type Json, type ProjectConfig
} from "@streamotter/gateway";
import {
  createGatewayRuntime, evidenceHash, getGatewayInternals, MemoryIncidentStore,
  type IncidentRecord, type IncidentStore
} from "@streamotter/gateway/internals";
import { observe, orderConfig, orderRecord, OrderApp, startHarness, waitFor, type Harness, type OrderState } from "./harness.ts";

/**
 * V1.1 slice B at the fixture tier: incidents, quarantine-hold with local
 * evidence, transient retries, and the guarded retry. Expected values are
 * written from the spec and ADR-15A, not read back from the gateway.
 */

const HOLD_BOTH: FailureHandlingConfig = { sources: { orders: { invalidJson: "quarantine-hold", invalidPublicPayload: "quarantine-hold" } } };
const invalidJson = (key: string | null, raw = "{\"tenantId\": \"acme\", oops"): FixtureRecord => ({ key, raw });

async function incidents(h: Harness): Promise<IncidentRecord[]> {
  await h.internals.failuresSettled();
  const store = h.internals.incidentStore();
  assert.ok(store !== null, "the gateway has an incident store");
  return [...store.list({ state: "all" }).items];
}

describe("V1.1 slice B: containment and quarantine-hold (fixture tier)", () => {
  let h: Harness | undefined;
  afterEach(async () => { await h?.close(); h = undefined; });

  it("F01: a V1 configuration opens no incident store and keeps V1 pause and resume", async () => {
    h = await startHarness({ fixtures: [invalidJson("ord_1"), orderRecord("acme", "ord_2", 1, "queued", 0)] });
    assert.equal(h.internals.incidentStore(), null);
    assert.equal(await h.advance(1), 0);
    assert.equal(h.internals.sources()[0]?.status, "paused");
    await h.internals.resumeSource("orders");
    assert.equal(h.internals.sources()[0]?.status, "paused", "resume retries the same record; it is never skipped");
    await assert.rejects(h.advance(1));
  });

  it("F03: invalid JSON under the default pause policy is recorded, held and never overtaken", async () => {
    h = await startHarness({
      failureHandling: { sources: {} },
      fixtures: [orderRecord("acme", "ord_1", 1, "queued", 0), invalidJson("ord_1"), orderRecord("acme", "ord_1", 3, "done", 100)]
    });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const subscription = h.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(subscription);
    await waitFor(() => seen.states.includes("live"), 5_000, "live");
    assert.equal(await h.advance(3), 1, "only the record before the failure commits");
    const [incident] = await incidents(h);
    assert.ok(incident !== undefined);
    assert.equal(incident.failureId, `f1:${incident.failureId.slice(3)}`);
    assert.equal(incident.failureClass, "invalid-json");
    assert.equal(incident.policy, "pause");
    assert.equal(incident.quarantine, "not-required");
    assert.equal(incident.progress, "held");
    assert.equal(incident.state, "open");
    assert.deepEqual(incident.position, { kind: "fixture", index: "1" });
    assert.equal(incident.evidence.location, "none");
    assert.equal(h.internals.sources()[0]?.status, "paused");
    await waitFor(() => seen.states.at(-1) === "stale", 5_000, "stale");
    assert.ok(!seen.data().some(order => order.status === "done"), "the record after the failure never overtakes it");
  });

  it("F04: an invalid public payload with valid routing is quarantined locally and the source stays held", async () => {
    h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [orderRecord("acme", "ord_1", 2, "processing", 20)] });
    h.app.mapOverride = value => {
      const record = value as { tenantId: string; revision: string; order: OrderState };
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: { ...record.order, progress: 101 } }];
    };
    assert.equal(await h.advance(1), 0);
    const [incident] = await incidents(h);
    assert.ok(incident !== undefined);
    assert.equal(incident.failureClass, "payload-schema");
    assert.equal(incident.stage, "map");
    assert.equal(incident.channel, "orderStatus");
    assert.equal(incident.policy, "quarantine-hold");
    assert.equal(incident.quarantine, "acknowledged");
    assert.equal(incident.quarantineCoordinates, null, "fixture evidence is local, not Kafka");
    assert.equal(incident.evidence.location, "local");
    assert.equal(incident.evidence.completeness, "complete");
    assert.equal(incident.progress, "held", "quarantine-hold never commits past the record");
    const store = h.internals.incidentStore() as IncidentStore;
    const evidence = store.getEvidence(incident.failureId);
    assert.ok(evidence !== null);
    const original = orderRecord("acme", "ord_1", 2, "processing", 20);
    assert.deepEqual(Buffer.from(evidence.value as Uint8Array).toString("utf8"), JSON.stringify(original.value));
    assert.deepEqual(Buffer.from(evidence.key as Uint8Array).toString("utf8"), "ord_1");
    assert.equal(incident.evidence.hash, evidenceHash(evidence));
    assert.deepEqual(store.events(incident.failureId).map(event => event.event), ["detected", "captured", "quarantined"]);
    assert.equal(h.internals.sources()[0]?.status, "paused");
  });

  it("F06: integrity failures hold even when the source quarantines other classes", async () => {
    const failures: [string, (value: Json) => unknown][] = [
      ["routing-invalid", value => [{ tenantId: "", params: { orderId: "ord_1" }, revision: "1", data: (value as { order: Json }).order }]],
      ["mapper-error", () => { throw new Error("boom"); }]
    ];
    for (const [failureClass, map] of failures) {
      h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [orderRecord("acme", "ord_1", 1, "queued", 0)] });
      h.app.mapOverride = map;
      assert.equal(await h.advance(1), 0);
      const [incident] = await incidents(h);
      assert.equal(incident?.failureClass, failureClass);
      assert.equal(incident?.policy, "pause");
      assert.equal(incident?.quarantine, "not-required");
      assert.equal((h.internals.incidentStore() as IncidentStore).getEvidence(incident.failureId), null, "nothing is captured for a hold");
      await h.close();
      h = undefined;
    }
  });

  it("F07: a transient mapping failure that succeeds on retry commits with no incident", async () => {
    h = await startHarness({
      failureHandling: { sources: { orders: { transientMapperRetries: 2, replaySafeMapping: true } } },
      fixtures: [orderRecord("acme", "ord_1", 1, "queued", 0)]
    });
    let calls = 0;
    const app = h.app;
    app.mapOverride = value => {
      calls++;
      if (calls < 3) throw new TransientMappingError("pricing service unavailable");
      app.mapOverride = null;
      const record = value as { tenantId: string; revision: string; order: OrderState };
      return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
    };
    const started = Date.now();
    assert.equal(await h.advance(1), 1);
    assert.equal(calls, 3, "two retries after the first attempt");
    assert.ok(Date.now() - started >= 1_200, "waits 250 ms then 1 s between attempts");
    assert.deepEqual(await incidents(h), []);
    assert.equal(h.internals.sources()[0]?.status, "healthy");
  });

  it("F08: retries are bounded, and an exhausted transient failure or a timeout holds", async () => {
    h = await startHarness({
      failureHandling: { sources: { orders: { transientMapperRetries: 1, replaySafeMapping: true, invalidJson: "quarantine-hold" } } },
      fixtures: [orderRecord("acme", "ord_1", 1, "queued", 0)]
    });
    let calls = 0;
    h.app.mapOverride = () => { calls++; throw new TransientMappingError("still down"); };
    assert.equal(await h.advance(1), 0);
    assert.equal(calls, 2, "one retry, no nested multiplication");
    const [incident] = await incidents(h);
    assert.equal(incident?.failureClass, "mapper-transient");
    assert.equal(incident?.policy, "pause");
    await h.close();

    h = await startHarness({
      failureHandling: { sources: { orders: { transientMapperRetries: 2, replaySafeMapping: true } } },
      fixtures: [orderRecord("acme", "ord_1", 1, "queued", 0)],
      limits: { handlerTimeoutMs: 50 }
    });
    let timeouts = 0;
    h.app.mapOverride = () => { timeouts++; return new Promise(() => undefined); };
    assert.equal(await h.advance(1), 0);
    assert.equal(timeouts, 1, "a timeout is not retried");
    assert.equal((await incidents(h))[0]?.failureClass, "mapper-timeout");
  });

  it("F11: an oversize record holds, and evidence over the capture budget is never quarantined", async () => {
    h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [invalidJson("ord_1", "x".repeat(2_048))], limits: { maxSourceRecordBytes: 1_024 } });
    assert.equal(await h.advance(1), 0);
    let [incident] = await incidents(h);
    assert.equal(incident?.failureClass, "oversize");
    assert.equal(incident?.policy, "pause");
    await h.close();

    h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [invalidJson("k".repeat(70 * 1024))] });
    assert.equal(await h.advance(1), 0);
    [incident] = await incidents(h);
    assert.equal(incident?.failureClass, "invalid-json");
    assert.equal(incident?.policy, "quarantine-hold");
    assert.equal(incident?.evidence.completeness, "incomplete");
    assert.equal(incident?.quarantine, "not-required", "incomplete evidence is not written anywhere");
    assert.equal(incident?.recovery, "held");
    assert.equal((h.internals.incidentStore() as IncidentStore).getEvidence(incident.failureId), null);
    assert.equal(h.internals.sources()[0]?.status, "paused");
  });

  it("redelivery after a retry keeps one incident identity and does not quarantine twice", async () => {
    h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [invalidJson("ord_1")] });
    assert.equal(await h.advance(1), 0);
    const [first] = await incidents(h);
    await h.internals.resumeSource("orders");
    assert.equal(h.internals.sources()[0]?.status, "paused");
    const all = await incidents(h);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.failureId, first?.failureId);
    assert.equal(all[0]?.observations, 2);
    const events = (h.internals.incidentStore() as IncidentStore).events(first?.failureId as string).map(event => event.event);
    assert.equal(events.filter(event => event === "quarantined").length, 1);
    assert.ok(events.includes("retrying"));
  });

  it("a held record that processes after a repair resolves its incident as processed", async () => {
    h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [orderRecord("acme", "ord_1", 1, "queued", 0), orderRecord("acme", "ord_1", 2, "processing", 50)] });
    h.app.mapOverride = () => { throw new Error("handler bug"); };
    assert.equal(await h.advance(1), 0);
    h.app.mapOverride = null;
    await h.internals.resumeSource("orders");
    assert.equal(await h.advance(1), 1, "the retried record committed on resume; the next one follows");
    const [incident] = await incidents(h);
    assert.equal(incident?.state, "resolved");
    assert.equal(incident?.progress, "processed");
    assert.equal(h.internals.sources()[0]?.status, "healthy");
  });

  it("refuses a retry while an advance is pending or uncertain", async () => {
    h = await startHarness({ failureHandling: HOLD_BOTH, fixtures: [invalidJson("ord_1")] });
    assert.equal(await h.advance(1), 0);
    const store = h.internals.incidentStore() as IncidentStore;
    const [incident] = await incidents(h);
    assert.ok(incident !== undefined);
    store.update(incident.failureId, incident.revision, { progress: "uncertain" }, { event: "operator", detail: "test", operationId: null });
    await assert.rejects(h.internals.resumeSource("orders"), (error: { code: string; details: { status: number; reason: string } }) => {
      assert.equal(error.code, "SOURCE_UNAVAILABLE");
      assert.equal(error.details.status, 409);
      assert.equal(error.details.reason, "advance-unresolved");
      return true;
    });
  });
});

describe("V1.1 slice B: multi-channel records and store faults", () => {
  it("F05: a record whose second output fails delivers nothing from the first channel", async () => {
    const base = orderConfig();
    const config = {
      ...base,
      channels: { ...base.channels, orderAudit: { ...base.channels.orderStatus, handlersRef: "orderAudit" } },
      failureHandling: HOLD_BOTH
    } as unknown as ProjectConfig;
    const app = new OrderApp();
    app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const handlers = app.handlers() as unknown as HandlerRegistry<ChannelMap>;
    const statusHandlers = handlers.channels["orderStatus"] as HandlerRegistry<ChannelMap>["channels"][string];
    const registry = {
      ...handlers,
      channels: {
        ...handlers.channels,
        orderAudit: { ...statusHandlers, map: ({ record }: { record: { value: Json } }) => [{ tenantId: "acme", params: { orderId: "ord_1" }, revision: (record.value as { revision: string }).revision, data: { orderId: "ord_1", status: "done", progress: 500 } }] }
      }
    } as unknown as HandlerRegistry<ChannelMap>;
    const gateway = createGateway({
      config, handlers: registry, mode: "development", logger: silentLogger,
      development: { principals: {}, fixtures: { orders: [orderRecord("acme", "ord_1", 2, "processing", 50)] } }
    });
    const { origin } = await gateway.start();
    const internals = getGatewayInternals(gateway);
    const { createClient } = await import("@streamotter/client");
    const client = createClient<ChannelMap>({ origin, getToken: () => "alice@acme" });
    try {
      const seen = observe(client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
      await waitFor(() => seen.states.includes("live"), 5_000, "live");
      const before = seen.events.length;
      assert.equal(await internals.advanceFixture("orders", 1), 0);
      await internals.failuresSettled();
      const [incident] = (internals.incidentStore() as IncidentStore).list({}).items;
      assert.equal(incident?.failureClass, "payload-schema");
      assert.equal(incident?.channel, "orderAudit");
      assert.equal(seen.events.length, before, "the valid orderStatus output was never admitted");
      assert.ok(!seen.events.some(event => event.revision === "2"));
    } finally {
      await client.close();
      await gateway.stop({ timeoutMs: 2_000 });
    }
  });

  it("F12: a journal failure keeps the source paused with no quarantine and no commit", async () => {
    class FailingStore extends MemoryIncidentStore {
      override observe(): never { throw new Error("disk I/O error"); }
    }
    const errors: string[] = [];
    const { gateway } = createGatewayRuntime({
      config: { ...orderConfig(), failureHandling: HOLD_BOTH } as unknown as ProjectConfig,
      handlers: new OrderApp().handlers() as unknown as HandlerRegistry<ChannelMap>,
      mode: "development",
      logger: { info: () => undefined, warn: () => undefined, error: message => { errors.push(message); } },
      development: { principals: {}, fixtures: { orders: [invalidJson("ord_1"), orderRecord("acme", "ord_2", 1, "queued", 0)] } }
    }, { incidentStore: new FailingStore() });
    await gateway.start();
    const internals = getGatewayInternals(gateway);
    try {
      assert.equal(await internals.advanceFixture("orders", 2), 0);
      await internals.failuresSettled();
      assert.equal(internals.sources()[0]?.status, "paused");
      assert.ok(errors.some(message => message.startsWith("The failure journal could not record an incident")));
      assert.equal(internals.incidentStore()?.getEvidence("anything"), null);
    } finally {
      await gateway.stop({ timeoutMs: 2_000 });
    }
  });

  it("F29: an open incident from another source generation refuses startup", async () => {
    const store = new MemoryIncidentStore();
    store.observe({
      failureId: "f1:old", sourceId: "orders", generation: "fixture-0", position: { kind: "fixture", index: "0" }, clusterId: null,
      timestamp: null, failureClass: "invalid-json", stage: "validate", errorCode: "INVALID_PAYLOAD", channel: null, policy: "pause",
      diagnosis: "test", evidence: { location: "none", completeness: "unavailable", valueBytes: null, keyBytes: null, headerCount: 0, hash: "" },
      fingerprints: { config: "c", handlerBuildId: "h", policyRevision: "p", gatewayVersion: "v" }, observedAt: new Date().toISOString()
    });
    const { gateway } = createGatewayRuntime({
      config: { ...orderConfig(), failureHandling: { sources: {} } } as unknown as ProjectConfig,
      handlers: new OrderApp().handlers() as unknown as HandlerRegistry<ChannelMap>,
      mode: "development",
      logger: silentLogger,
      development: { principals: {}, fixtures: { orders: [] } }
    }, { incidentStore: store });
    await assert.rejects(gateway.start(), (error: { code: string; message: string }) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.match(error.message, /generation "fixture-0"/);
      return true;
    });
    await gateway.stop();
  });
});
