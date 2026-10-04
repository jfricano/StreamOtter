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
