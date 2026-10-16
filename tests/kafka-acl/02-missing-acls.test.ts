import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import type { SourceRecoveryHandlers } from "@streamotter/contracts";
import { nodeSupportsJournal, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import { sleep, waitFor } from "../integration/harness.ts";
import { orderValue, startKafkaHarness, type KafkaHarness } from "../kafka/helpers.ts";
import { recordingLogger } from "../kafka-replicated/helpers.ts";
import {
  aclAdmin, aclBrokerAvailable, closeAclHelpers, committedOffset, createAclTopic, failureSetup, freePort, gatewayAcls, GATEWAY_CONNECTION, grant, groupsWithPrefix,
  produceRaw, READ_GROUP_PREFIX, readiness, revoke, revokeAllGatewayAcls, SKIP_MESSAGE, type GatewayAcl
} from "./helpers.ts";

/**
 * Each ACL of the runbook's table (docs/guides/source-failures.md §6.1) taken away in turn, on the
 * ACL-enabled broker: the gateway reports the refusal the runbook's symptom table documents, and
 * never moves past a held record because of it (F13, denied ACL).
 */

const skip = !(await aclBrokerAvailable()) ? SKIP_MESSAGE : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;
const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "acl-test" }) };
const good = (revision: number) => Buffer.from(orderValue("acme", "ord_1", revision, "processing", revision * 10));

async function incident(k: KafkaHarness, done: (incident: IncidentRecord) => boolean, timeoutMs = 30_000): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await k.internals.failuresSettled();
    const [found] = (k.internals.incidentStore() as IncidentStore).list({ state: "all" }).items;
    if (found !== undefined && done(found)) return found;
    if (Date.now() > deadline) assert.fail(`incident never reached the expected state: ${JSON.stringify(found ?? null)}`);
    await sleep(100);
  }
}

/** The runbook's ACLs for a fresh setup, granted except the named ones. */
async function setupWithout(policy: "quarantine-hold" | "quarantine-resync", ...missing: GatewayAcl[]) {
  await revokeAllGatewayAcls();
  const s = await failureSetup(policy);
  const acls = gatewayAcls(s);
  await grant(...Object.entries(acls).filter(([name]) => !missing.includes(name as GatewayAcl)).map(([, acl]) => acl));
  return { ...s, acls };
}

describe("the gateway on an ACL-enabled broker with one runbook ACL missing", { skip }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => {
    await k?.close();
    k = undefined;
    await revokeAllGatewayAcls();
  });
  after(() => closeAclHelpers());

  it("V1's source ACLs: no Read on the source topic fails startup at once; no Read on its group runs into the startup deadline", { timeout: 120_000 }, async () => {
    const s = await setupWithout("quarantine-hold", "source-topic-read");
    const start = () => startKafkaHarness({ topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state });
    await assert.rejects(start(), (error: { code: string; message: string }) => {
      assert.equal(error.code, "SOURCE_UNAVAILABLE");
      assert.equal(error.message, "A source failed to start: Not authorized to access topics: [Topic authorization failed]");
      return true;
    });
    await grant(s.acls["source-topic-read"]);
    await revoke(s.acls["source-group-read"]);
    await assert.rejects(start(), (error: { code: string; message: string }) => {
      assert.equal(error.code, "SOURCE_UNAVAILABLE");
      assert.equal(error.message, "Sources did not become ready within the 30-second startup deadline.");
      return true;
    });
  });

  it("no ACL on the quarantine topic: startup refuses it as missing", { timeout: 60_000 }, async () => {
    const s = await setupWithout("quarantine-hold", "quarantine-describe", "quarantine-describe-configs", "quarantine-write", "quarantine-read");
    await assert.rejects(
      startKafkaHarness({ topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state }),
      (error: { code: string; message: string }) => {
        assert.equal(error.code, "CONFIG_INVALID");
        assert.match(error.message, /quarantine topic is missing/);
        return true;
      }
    );
  });

  it("no DescribeConfigs on the quarantine topic: startup fails reading its configuration", { timeout: 60_000 }, async () => {
    const s = await setupWithout("quarantine-hold", "quarantine-describe-configs");
    await assert.rejects(
      startKafkaHarness({ topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state }),
      (error: { code: string; message: string }) => {
        assert.equal(error.code, "SOURCE_UNAVAILABLE");
        assert.equal(error.message, "A source failed to start: Not authorized to access topics: [Topic authorization failed]");
        return true;
      }
    );
  });

  it("no Write on the quarantine topic (and none anywhere): startup fails connecting the quarantine producer", { timeout: 60_000 }, async () => {
    const s = await setupWithout("quarantine-hold", "quarantine-write");
    await assert.rejects(
      startKafkaHarness({ topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state }),
      (error: { code: string; message: string }) => {
        // The quarantine producer is idempotent, and Kafka allows that only to a principal with Write on
        // some topic (or IdempotentWrite on the cluster).
        assert.equal(error.code, "SOURCE_UNAVAILABLE");
        assert.equal(error.message, "A source failed to start: Cluster authorization failed");
        return true;
      }
    );
  });

  it("F13: no Write on the quarantine topic: the write is refused, the record is held, and nothing advances until Write is granted and retried", { timeout: 120_000 }, async () => {
    const s = await setupWithout("quarantine-resync", "quarantine-write");
    // Write on some other topic, as a principal that also produces elsewhere has, so the idempotent producer starts.
    const elsewhere = await createAclTopic(1);
    await grant({ ...s.acls["quarantine-write"]!, resourceName: elsewhere });
    const healthPort = await freePort();
    k = await startKafkaHarness({
      topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state,
      recovery: { orders: recoverable }, health: { port: healthPort }
    });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }, { key: Buffer.from("ord_1"), value: good(2) }]);
    const refused = await incident(k, item => item.quarantine === "failed" || item.quarantine === "unknown");
    assert.equal(refused.quarantine, "failed", "a definite refusal, not an unknown outcome");
    assert.equal(refused.progress, "held");
    assert.equal(refused.guard, null, "the guard is never consulted without an acknowledged copy");
    const history = (k.internals.incidentStore() as IncidentStore).events(refused.failureId).map(event => event.detail);
    assert.ok(history.includes("quarantine write refused: TOPIC_AUTHORIZATION_FAILED"), JSON.stringify(history));
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.deepEqual(await readiness(healthPort), { status: 503, reasons: ["source-held", "quarantine"] });
    await sleep(2_000);
    assert.equal(await committedOffset(s.group, s.topic), "-1", "neither the held record nor the one after it is committed");

    // The runbook's procedure: grant Write, then retry-current.
    await grant(s.acls["quarantine-write"]);
    const current = await incident(k, item => item.failureId === refused.failureId);
    const result = await getGatewayOperator(k.gateway).retryCurrent({ sourceId: "orders", failureId: refused.failureId, expectedRevision: current.revision });
    assert.equal(result.result, "completed", result.message);
    assert.equal(result.outcome, "advanced", result.message);
    const advanced = await incident(k, item => item.progress === "advanced");
    assert.equal(advanced.quarantine, "acknowledged");
    await waitFor(() => k!.internals.sources()[0]?.status === "healthy", 15_000, "healthy after the advance");
    const deadline = Date.now() + 20_000;
    while (await committedOffset(s.group, s.topic) !== "2") {
      if (Date.now() > deadline) assert.fail("the record after the advanced one was never committed");
      await sleep(100);
    }
    assert.deepEqual(await readiness(healthPort), { status: 200, reasons: [] });
  });

  it("no Read on the quarantine topic or the read-group prefix: read-back is not authorized and no plan is issued; no Delete leaves the group behind", { timeout: 120_000 }, async () => {
    const s = await setupWithout("quarantine-resync");
    const logger = recordingLogger();
    k = await startKafkaHarness({
      topic: s.topic, group: s.group, connection: GATEWAY_CONNECTION, failureHandling: s.failureHandling, stateDirectory: s.state,
      recovery: { orders: recoverable }, logger
    });
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }]);
    const advanced = await incident(k, item => item.progress === "advanced");
    const op = getGatewayOperator(k.gateway);

    for (const missing of ["quarantine-read", "read-group-read"] as const) {
      await revoke(s.acls[missing]);
      const detail = await op.showFailure({ failureId: advanced.failureId, includeRaw: true });
      assert.equal(detail.raw?.complete, false, missing);
      assert.equal(detail.raw?.valueBase64, null, missing);
      assert.match(detail.raw?.note ?? "", /not authorized to read the quarantine topic/, missing);
      const evaluation = await op.evaluate({ failureId: advanced.failureId, expectedRevision: advanced.revision });
      assert.equal(evaluation.eligible, false, missing);
      assert.equal(evaluation.ineligibleReason, "evidence-unavailable", missing);
      assert.equal(evaluation.plan, null, missing);
      await grant(s.acls[missing]);
    }
    assert.deepEqual(await groupsWithPrefix(READ_GROUP_PREFIX), []);

    await revoke(s.acls["read-group-delete"]);
    const detail = await op.showFailure({ failureId: advanced.failureId, includeRaw: true });
    assert.equal(detail.raw?.complete, true, "the read itself needs no Delete");
    await waitFor(() => logger.entries.some(entry => entry.message === "Could not delete a quarantine read's throwaway consumer group"), 10_000, "the deletion warning");
    const leftover = await groupsWithPrefix(READ_GROUP_PREFIX);
    assert.equal(leftover.length, 1, "the throwaway group is left behind");
    assert.equal(logger.entries.find(entry => entry.message === "Could not delete a quarantine read's throwaway consumer group")?.fields?.["groupId"], leftover[0]);
    // The runbook's procedure: grant Delete, then delete the leftover group.
    await grant(s.acls["read-group-delete"]);
    await (await aclAdmin()).deleteGroups(leftover);
  });
});
