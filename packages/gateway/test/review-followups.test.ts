import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayLogger, ProjectConfig, SourceRecoveryHandlers } from "@streamotter/contracts";
import type { QuarantineWriter } from "../src/failures/quarantine.ts";
import { FailureService, type FailureSource } from "../src/failures/service.ts";
import { MemoryIncidentStore } from "../src/failures/store.ts";
import { OperatorService, type OperatorHost } from "../src/operator/service.ts";
import type { AdvanceResult, HeldPosition, SourceAdapter, SourceInput } from "../src/sources/types.ts";

const silent: GatewayLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const config = {
  configVersion: 1, projectId: "order-dashboard",
  sources: { orders: { kind: "kafka", generation: "orders-1", connectionRef: "cluster", topics: ["orders"], consumerGroup: "g", codec: "json", startFrom: "earliest" } },
  failureHandling: { quarantine: { topic: "orders.quarantine", capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-resync", automaticAdvanceLimit: { incidents: 2, windowMs: 60_000 } } } }
} as unknown as ProjectConfig;
const pause = { kind: "pause", code: "INVALID_PAYLOAD", failureClass: "invalid-json", stage: "validate", channel: null, diagnosis: "bad JSON" } as const;
const rec = (offset: string): SourceInput => ({ key: "k", bytes: Buffer.from("{bad" + offset), keyBytes: Buffer.from("k"), headers: [], timestamp: null, position: { kind: "kafka", topic: "orders", partition: 0, offset } });
class Adapter implements SourceAdapter {
  readonly kind = "kafka" as const;
  results: AdvanceResult[] = [];
  async start() {} async stop() {} async resume() {} async check(): Promise<[]> { return []; }
  async advancePast(held: HeldPosition): Promise<AdvanceResult> {
    const result = this.results.shift() ?? "advanced";
    if (result === "advanced" && held.confirmed !== undefined) await held.confirmed();
    return result;
  }
}
const writer: QuarantineWriter = { publish: async () => ({ kind: "acknowledged", partition: 0, offset: "1" }), stop: async () => undefined };
const guard: SourceRecoveryHandlers = { recover: async () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "x" }) };

/** Regressions for the second review of the V1.1 review fixes (docs/releases/v1.1/REVIEW.md §5). */
describe("H: the circuit gate counts an incident advanced again once", () => {
  it("re-advancing an incident after not-held does not count it twice at the circuit gate", async () => {
    const store = new MemoryIncidentStore();
    store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
    const failures = new FailureService({ config, store, logger: silent, quarantine: writer, configFingerprint: "c".repeat(64), handlerBuildId: "b", maxSourceRecordBytes: 1 << 20, guards: { orders: guard } });
    failures.setClusterId("orders", "cluster-a");
    const adapter = new Adapter();
    const source: FailureSource = { id: "orders", config: config.sources["orders"] as FailureSource["config"], adapter };
    await failures.held(source, rec("10"), pause); // incident A advanced
    adapter.results = ["not-held"];
    await failures.held(source, rec("20"), pause); // incident B: not-held
    const b = store.open("orders")[0];
    assert.equal(b?.progress, "held");
    await failures.held(source, rec("20"), pause); // B redelivered, re-advance
    const after = store.list({ state: "all" }).items.find(i => i.position.kind === "kafka" && i.position.offset === "20");
    assert.equal(store.circuit("orders").state, "closed", "only 2 distinct incidents were ever advanced (limit 2)");
  });
});

describe("B with O6: a cluster mismatch blocks redrive", () => {
  it("a cluster-mismatch incident is an open integrity fault that blocks redrive", async () => {
    const cfg = JSON.parse(JSON.stringify(config)) as ProjectConfig;
    (cfg.failureHandling as any).sources.orders.replaySafeMapping = true;
    (cfg.failureHandling as any).sources.orders.automaticAdvanceLimit = { incidents: 5, windowMs: 60_000 };
    const store = new MemoryIncidentStore();
    store.claim("order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
    const g: SourceRecoveryHandlers = { recover: async (ctx: any) => ctx.incident.position.offset === "10"
      ? { decision: "recoverable", context: { watermark: 1 }, evidenceRef: "x" } : { decision: "hold", reason: "not yet" } };
    const make = (cluster: string) => {
      const f = new FailureService({ config: cfg, store, logger: silent, quarantine: writer, configFingerprint: "c".repeat(64), handlerBuildId: "b", maxSourceRecordBytes: 1 << 20, guards: { orders: g } });
      f.setClusterId("orders", cluster);
      return f;
    };
    const source: FailureSource = { id: "orders", config: cfg.sources["orders"] as FailureSource["config"], adapter: new Adapter() };
    const f1 = make("cluster-a");
    await f1.held(source, rec("10"), pause);
    await f1.held(source, rec("20"), pause);
    const f2 = make("cluster-b");
    await f2.start([source], async () => "21");
    await f2.held(source, rec("20"), pause);
    const all = store.list({ state: "all" }).items;
    const a = all.find(i => (i.position as any).offset === "10")!;
    const b = all.find(i => (i.position as any).offset === "20")!;
    const host: OperatorHost = {
      mode: "development", config: cfg, fingerprint: "c", handlerBuildId: "b", logger: silent, state: () => "running",
      source: () => ({ sourceId: "orders", status: "paused" } as any), traces: () => ({ items: [], nextCursor: null }),
      quarantineReport: () => null,
      quarantineReader: () => ({ read: async () => ({ kind: "found", evidence: { key: Buffer.from("k"), value: Buffer.from("{bad10"), headers: [] } }), stop: async () => undefined }) as any,
      retry: async () => undefined,
      evaluateRecord: async () => ({ kind: "ok", outputs: [{ channel: "c", channelVersion: 1, revision: "1" }], outputHash: "h" }) as any,
      redriveRecord: async () => ({ kind: "abandon" }) as any, setBoundary: () => undefined
    };
    const op = new OperatorService(host, f2);
    const evaluation = await op.evaluate({ failureId: a.failureId, expectedRevision: a.revision });
    assert.equal(evaluation.eligible, false, "redrive must be refused while a cluster-mismatch integrity fault is open");
  });
});
