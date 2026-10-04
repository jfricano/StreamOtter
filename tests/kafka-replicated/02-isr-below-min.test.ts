import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { SourceRecoveryHandlers } from "@streamotter/contracts";
import { nodeSupportsJournal } from "@streamotter/gateway/internals";
import { sleep, waitFor } from "../integration/harness.ts";
import {
  closeReplicatedHelpers, committedOffset, createReplicatedTopic, electPreferredLeaders, groupCoordinatedBy, groupCoordinator, highWatermark,
  killBroker, produceBatch, replicatedAvailable, restoreCluster, SKIP_MESSAGE, startBroker, topicSettings, waitForPartition
} from "./helpers.ts";
import {
  badRecord, checkEvidence, checkWithReader, eventsOf, goodRecord, incidentAt, incidents, QUARANTINE_MIN_ISR, quarantineTopicConfig, startReplicatedGateway,
  waitForIncident, type ReplicatedGateway
} from "./scenario.ts";

/**
 * F47, ISR below min.insync.replicas: two of the three brokers are SIGKILLed,
 * leaving the quarantine partition (replication factor 3, min.insync.replicas=2)
 * with one in-sync replica. The leader, the source partition and the group
 * coordinator all stay on the surviving broker, so the only thing that changes
 * for the gateway is the quarantine topic's ISR.
 *
 * Expected: no quarantine write is acknowledged while the ISR is below the
 * minimum (a write in flight as the ISR collapses, and NOT_ENOUGH_REPLICAS once
 * it has); the source holds at the record without committing past it; once
 * the replicas are back, a retry is acknowledged and the source proceeds; the
 * evidence is byte-identical to what the test produced.
 *
 * The guard holds the first bad record once, so the test can start a write
 * at a chosen moment with an operator retry (no offset commit is needed for that).
 */

const available = await replicatedAvailable();
const skip = !available ? SKIP_MESSAGE : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;

const SURVIVOR = 3;
const KILLED = [1, 2];

describe("F47: quarantine evidence with the ISR below min.insync.replicas (replicated Kafka)", { skip }, () => {
  let gw: ReplicatedGateway | undefined;
  before(async () => {
    await restoreCluster();
    await electPreferredLeaders();
  });
  afterEach(async () => {
    await gw?.k.close();
    gw = undefined;
    await restoreCluster();
  });
  after(() => closeReplicatedHelpers());

  it("acknowledges no write below min.insync.replicas, holds the source, and proceeds once the replicas return", { timeout: 300_000 }, async () => {
    const group = await groupCoordinatedBy(SURVIVOR);
    const topic = await createReplicatedTopic(SURVIVOR);
    const quarantine = await createReplicatedTopic(SURVIVOR, quarantineTopicConfig);
    const settings = await topicSettings(quarantine);
    assert.equal(settings["min.insync.replicas"], QUARANTINE_MIN_ISR);

    let holdOnce = true;
    const guard: SourceRecoveryHandlers = {
      recover: ({ incident }) => holdOnce && incident.position.kind === "kafka" && incident.position.offset === "1"
        ? { decision: "hold", reason: "the test holds this record once" }
        : { decision: "recoverable", context: { watermark: 1 }, evidenceRef: "kafka-replicated-test" }
    };
    gw = await startReplicatedGateway({ topic, quarantine, group, guard });
    const { k } = gw;
    // good(0) bad(1) good(2) bad(3) good(4): the source holds at offset 1 behind the guard.
    const ledger = await produceBatch(topic, [goodRecord(2), badRecord(1), goodRecord(3), badRecord(2), goodRecord(4)]);
    const [, b1] = ledger;
    assert.equal(b1?.offset, "1");
    const first = await waitForIncident(k, "1", incident => incident.recovery === "denied", "held by the guard");
    assert.equal(first.quarantine, "acknowledged");
    const preKillCoordinates = first.quarantineCoordinates;
    assert.equal(await committedOffset(group, topic), "1");
    assert.equal(await groupCoordinator(group), SURVIVOR, "the group coordinator is the surviving broker");
    console.log(`# quarantine topic: RF 3, ${JSON.stringify(settings)}; quarantine, source and group coordinator all on broker ${SURVIVOR}; killing ${KILLED.join(" and ")}`);

    // Kill two brokers; retry the held record at once, so its write is in flight while the ISR collapses.
    const killedAt = Math.max(...await Promise.all(KILLED.map(id => killBroker(id))));
    holdOnce = false;
    await k.internals.resumeSource("orders");
    const inFlight = await waitForIncident(k, "1", incident => incident.observations >= 2 && incident.quarantine !== "pending", "the in-flight write's outcome", 60_000);
    const inFlightDetail = eventsOf(k, inFlight.failureId).filter(event => event.event === "quarantine-unknown" || event.event === "held").at(-1)?.detail;
    console.log(`# write in flight while the ISR collapsed: ${inFlight.quarantine} after ${Date.now() - killedAt} ms (${inFlightDetail})`);
    assert.ok(inFlight.quarantine === "unknown" || inFlight.quarantine === "failed", `a write with the ISR collapsing was ${inFlight.quarantine}`);
    assert.equal(inFlight.progress, "held");
    assert.deepEqual(inFlight.quarantineCoordinates, preKillCoordinates, "no new acknowledged coordinates");

    const shrunk = await waitForPartition(quarantine, state => state.isr.length === 1, "the ISR shrinking to one", 60_000, KILLED);
    const shrinkMs = Date.now() - killedAt;
    assert.deepEqual(shrunk.isr, [SURVIVOR]);
    console.log(`# quarantine ISR ${JSON.stringify(shrunk.isr)} (leader ${shrunk.leader}) seen ${shrinkMs} ms after the kill`);

    // A retry with the ISR below the minimum: the broker refuses it with NOT_ENOUGH_REPLICAS.
    await waitFor(() => k.internals.sources()[0]?.status === "paused", 15_000, "paused before the retry");
    await k.internals.resumeSource("orders");
    const refused = await waitForIncident(k, "1", incident => incident.observations >= 3 && incident.quarantine !== "pending", "the below-minimum write's outcome", 60_000);
    const refusedDetail = eventsOf(k, refused.failureId).filter(event => event.event === "quarantine-unknown" || event.event === "held").at(-1)?.detail ?? "";
    console.log(`# write with ISR ${JSON.stringify(shrunk.isr)} below min.insync.replicas=${QUARANTINE_MIN_ISR}: ${refused.quarantine} (${refusedDetail})`);
    assert.ok(refused.quarantine === "unknown" || refused.quarantine === "failed");
    assert.match(refusedDetail, /NOT_ENOUGH_REPLICAS/);
    assert.equal(refused.progress, "held");

    // The source holds: nothing committed past the record, nothing behind it processed, for as long as the ISR is short.
    const holdStarted = Date.now();
    await sleep(5_000);
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.equal(await committedOffset(group, topic), "1", "no commit past the held record");
    const during = await incidents(k);
    assert.equal(during.length, 1, "nothing behind the held record was processed");
    assert.equal(during[0]?.quarantine, refused.quarantine);
    const visibleDuring = await highWatermark(quarantine);
    console.log(`# held ${Date.now() - holdStarted} ms with the ISR short; committed offset stays 1; quarantine high watermark ${visibleDuring} (1 is the pre-kill copy)`);

    // Replicas return.
    const restartedAt = Date.now();
    await Promise.all(KILLED.map(id => startBroker(id)));
    const enough = await waitForPartition(quarantine, state => state.isr.length >= 2, "the ISR back to the minimum", 120_000);
    const enoughMs = Date.now() - restartedAt;
    const full = await waitForPartition(quarantine, state => state.isr.length === 3, "the full ISR", 120_000);
    console.log(`# ISR ${JSON.stringify(enough.isr)} ${enoughMs} ms after the restarts began; full ISR ${JSON.stringify(full.isr)} after ${Date.now() - restartedAt} ms`);
    assert.equal(await committedOffset(group, topic), "1", "returning replicas alone do not move the source");

    // An operator retry now is acknowledged, and the source proceeds through the rest of the stream.
    await k.internals.resumeSource("orders");
    const retriedAt = Date.now();
    const advanced = await waitForIncident(k, "1", incident => incident.progress === "advanced", "advanced", 60_000);
    assert.equal(advanced.quarantine, "acknowledged");
    assert.notDeepEqual(advanced.quarantineCoordinates, preKillCoordinates, "a fresh acknowledged copy");
    const end = String(ledger.length);
    const deadline = Date.now() + 60_000;
    while (await committedOffset(group, topic) !== end) {
      if (Date.now() > deadline) assert.fail(`never reached offset ${end}; committed ${await committedOffset(group, topic)}`);
      await sleep(100);
    }
    console.log(`# after the retry: acknowledged and advanced in ${Date.now() - retriedAt} ms; all ${ledger.length} records committed`);

    const final = await incidents(k);
    assert.equal(final.length, 2);
    for (const entry of ledger.filter(item => item.kind === "bad")) {
      const incident = incidentAt(final, entry.offset);
      assert.equal(incident?.quarantine, "acknowledged");
      assert.equal(incident?.progress, "advanced");
    }
    const check = await checkEvidence({ quarantine, ledger, acknowledged: [first, ...final], committed: end });
    await checkWithReader(quarantine, [first, ...final], ledger);
    console.log(`# quarantine records: ${check.records}; copies per source offset ${JSON.stringify([...check.copies])}; source offset 1 acknowledged at ${JSON.stringify(preKillCoordinates)} before the kill and ${JSON.stringify(advanced.quarantineCoordinates)} after; all byte-identical to the ledger (plain consumer and KafkaQuarantineReader)`);
    console.log(`# events for source offset 1: ${JSON.stringify(eventsOf(k, advanced.failureId).map(event => `${event.event}${event.detail === null ? "" : `: ${event.detail}`}`))}`);
    console.log(`# gateway warnings/errors: ${gw.logger.entries.length} ${JSON.stringify([...new Set(gw.logger.entries.map(entry => entry.message))])}`);
  });
});
