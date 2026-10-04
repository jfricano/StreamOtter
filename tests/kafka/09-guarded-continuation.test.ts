import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import kafkajs from "kafkajs";
import type { FailureHandlingConfig, SourceRecoveryHandlers } from "@streamotter/contracts";
import { initJournal, nodeSupportsJournal, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import {
  brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produceRaw, readTopic, startKafkaHarness, testAdmin,
  uniqueName, waitForEmptyGroup, type KafkaHarness
} from "./helpers.ts";

/**
 * V1.1 slice C against a real broker: the guarded advance commits exactly past
 * the quarantined record after the barrier is durable, a refused quarantine
 * write never advances, and a crash on either side of the commit reconciles
 * from the group's actual position at restart.
 */

const available = await brokerAvailable();
const skip = !available ? "local Kafka is not running" : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;
const { ConfigResourceTypes } = kafkajs;

async function setup(): Promise<{ topic: string; quarantine: string; state: string; group: string; failureHandling: FailureHandlingConfig }> {
  const topic = await createTopic(1);
  const quarantine = await createTopic(1, [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }]);
  const state = await mkdtemp(join(tmpdir(), "so-kafka-resync-"));
  initJournal(state, "order-dashboard", [{ sourceId: "orders", generation: "orders-1", kind: "kafka" }]);
  return {
    topic, quarantine, state, group: uniqueName("so-group"),
    failureHandling: { quarantine: { topic: quarantine, capture: "full-record" }, sources: { orders: { invalidJson: "quarantine-resync" } } }
  };
}

const recoverable: SourceRecoveryHandlers = { recover: () => ({ decision: "recoverable", context: { watermark: 1 }, evidenceRef: "kafka-test" }) };
const good = (revision: number) => Buffer.from(orderValue("acme", "ord_1", revision, "processing", revision * 10));

async function firstIncident(k: KafkaHarness, done: (incident: IncidentRecord) => boolean, timeoutMs = 20_000): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await k.internals.failuresSettled();
    const [incident] = (k.internals.incidentStore() as IncidentStore).list({ state: "all" }).items;
    if (incident !== undefined && done(incident)) return incident;
    if (Date.now() > deadline) assert.fail(`incident never reached the expected state: ${JSON.stringify(incident ?? null)}`);
    await sleep(100);
  }
}

async function waitForCommitted(group: string, topic: string, offset: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await committedOffsets(group, topic))[0] === offset) return;
    await sleep(100);
  }
  assert.fail(`never committed ${offset}; committed ${JSON.stringify(await committedOffsets(group, topic))}`);
}

describe("V1.1 slice C: guarded continuation against Kafka", { skip }, () => {
  let k: KafkaHarness | undefined;
  afterEach(async () => { await k?.close(); k = undefined; });
  after(() => closeKafkaHelpers());

  it("F21: advances exactly past the quarantined record after the barrier, and later records flow", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state, recovery: { orders: recoverable } });
    k.app.put("acme", "alice", "ord_1", 1, "queued", 0);
    const seen = observe(k.client().subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } }));
    await waitFor(() => seen.states.includes("live"), 15_000, "live");
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }, { key: Buffer.from("ord_1"), value: good(2) }]);
    const incident = await firstIncident(k, item => item.progress === "advanced");
    assert.equal(incident.quarantine, "acknowledged");
    await waitForCommitted(s.group, s.topic, "2");
    assert.equal((await readTopic(s.quarantine, 1)).length, 1);
    await waitFor(() => seen.events.some(event => event.revision === "2"), 15_000, "the next record delivered");
    assert.equal(seen.states.at(-1), "live");
    assert.equal(k.app.recoveryInputs.at(-1)?.boundaryId, incident.boundaryId, "the resynchronizing snapshot acknowledged the boundary");
  });

  it("F13: a quarantine write the broker refuses holds the record and never advances", async () => {
    const s = await setup();
    k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state, recovery: { orders: recoverable } });
    // Shrink the topic after the startup check, so the write itself is refused as too large.
    await (await testAdmin()).alterConfigs({
      validateOnly: false,
      resources: [{ type: ConfigResourceTypes.TOPIC, name: s.quarantine, configEntries: [{ name: "max.message.bytes", value: "1024" }] }]
    });
    await sleep(1_000);
    await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from(`{"pad": "${"x".repeat(4_000)}"`) }]);
    const incident = await firstIncident(k, item => item.quarantine === "failed" || item.quarantine === "unknown");
    assert.equal(incident.progress, "held");
    assert.equal(incident.guard, null, "the guard is never consulted without acknowledged evidence");
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.equal((await committedOffsets(s.group, s.topic))[0], "-1");
  });

  for (const crashAt of ["before-advance", "after-advance"] as const) {
    const id = crashAt === "before-advance" ? "F16" : "F17";
    it(`${id}: a crash ${crashAt === "before-advance" ? "after the barrier, before the commit" : "after the commit, before the final journal write"} reconciles from the group's position`, { timeout: 120_000 }, async () => {
      const s = await setup();
      await produceRaw(s.topic, [{ key: Buffer.from("ord_1"), value: Buffer.from("{not json") }, { key: Buffer.from("ord_1"), value: good(2) }]);
      const child = fork(resolve(import.meta.dirname, "resync-crash-child.ts"), [], {
        execArgv: ["--conditions=streamotter-source", "--no-warnings"],
        env: { ...process.env, TOPIC: s.topic, GROUP: s.group, QUARANTINE: s.quarantine, STATE: s.state, CRASH_AT: crashAt },
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      });
      const messages: { type: string; failureId?: string }[] = [];
      child.on("message", message => messages.push(message as { type: string }));
      const exited = new Promise(done => child.once("exit", done));
      try {
        await waitFor(() => messages.some(message => message.type === crashAt), 60_000, `child reached ${crashAt}`);
      } finally {
        child.kill("SIGKILL");
        await exited;
      }
      const crashedFailureId = messages.find(message => message.type === crashAt)?.failureId;
      assert.equal((await committedOffsets(s.group, s.topic))[0], crashAt === "before-advance" ? "-1" : "1");
      await waitForEmptyGroup(s.group);

      k = await startKafkaHarness({ topic: s.topic, group: s.group, failureHandling: s.failureHandling, stateDirectory: s.state, recovery: { orders: recoverable } });
      const incident = await firstIncident(k, item => item.progress === "advanced");
      assert.equal(incident.failureId, crashedFailureId, "the same incident, not a new one");
      const events = (k.internals.incidentStore() as IncidentStore).events(incident.failureId).map(event => event.event);
      if (crashAt === "after-advance") {
        assert.ok(events.includes("advance-confirmed"));
        assert.equal(events.filter(event => event === "advance-pending").length, 1, "confirmed from the group position, not advanced again");
      } else {
        assert.ok(events.filter(event => event === "advance-pending").length >= 2, "the first prepare was not committed, so the record was evaluated again");
      }
      const boundary = (k.internals.incidentStore() as IncidentStore).boundary("orders");
      assert.ok(boundary !== null, "the barrier persisted before the commit survives the crash");
      assert.ok(boundary.failureIds.includes(incident.failureId));
      await waitForCommitted(s.group, s.topic, "2");
    });
  }
});
