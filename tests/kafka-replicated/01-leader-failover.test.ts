import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { SourceRecoveryHandlers } from "@streamotter/contracts";
import { nodeSupportsJournal, type IncidentRecord } from "@streamotter/gateway/internals";
import { sleep } from "../integration/harness.ts";
import {
  closeReplicatedHelpers, committedOffset, createReplicatedTopic, electPreferredLeaders, groupCoordinatedBy, groupCoordinator, killBroker,
  partitionState, produceBatch, replicatedAvailable, restoreCluster, SKIP_MESSAGE, startBroker, topicSettings, waitForPartition, type LedgerEntry
} from "./helpers.ts";
import {
  badRecord, checkEvidence, checkWithReader, eventsOf, goodRecord, incidentAt, incidents, QUARANTINE_MAX_MESSAGE_BYTES, QUARANTINE_MIN_ISR,
  quarantineTopicConfig, startReplicatedGateway, waitForIncident, type ReplicatedGateway
} from "./scenario.ts";

/**
 * F47, leader failure: a quarantine-resync gateway quarantines a stream of bad
 * records while the quarantine partition's leader is SIGKILLed mid-stream.
 * The quarantine topic has replication factor 3, min.insync.replicas=2 and
 * unclean leader election disabled; the writer uses acks=all.
 *
 * Expected: every write acknowledged before the kill is readable byte for byte
 * from the new leader while the old one is still down; a write that starts
 * inside the failover window is not acknowledged and its record stays held
 * (no commit past it) until an operator retry after the failover; nothing
 * advances without acknowledged evidence; after recovery every record the
 * source moved past has evidence identical to what the test produced.
 *
 * The source partition and the group coordinator live on a broker that is not
 * killed. Offset commits still wait for the killed broker until the controller
 * fences it, because it stays in the __consumer_offsets ISR until then; so to
 * start a quarantine write inside the window, the guard holds one record once
 * and the test retries it right after the kill (a resync retry always writes a
 * fresh acknowledged copy, spec §6 step 4, and needs no commit to get there).
 */

const available = await replicatedAvailable();
const skip = !available ? SKIP_MESSAGE : !nodeSupportsJournal() ? "the journal needs Node 24.15 or newer" : false;

const BAD_RECORDS = 16;
/** The bad record whose guard holds once; it is retried right after the kill. */
const HELD_INDEX = 7;
const KILLED = 1;
const STEADY = 2;

describe("F47: quarantine evidence under a leader failure (replicated Kafka)", { skip }, () => {
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

  it("keeps every acknowledged write across a SIGKILL of the quarantine leader, and advances only past acknowledged evidence", { timeout: 300_000 }, async () => {
    const group = await groupCoordinatedBy(STEADY);
    const topic = await createReplicatedTopic(STEADY);
    const quarantine = await createReplicatedTopic(KILLED, quarantineTopicConfig);
    const settings = await topicSettings(quarantine);
    assert.equal(settings["min.insync.replicas"], QUARANTINE_MIN_ISR);
    assert.equal(settings["max.message.bytes"], QUARANTINE_MAX_MESSAGE_BYTES);
    assert.equal(settings["unclean.leader.election.enable"], "false");

    // Records go in as bad1, good1, bad2, good2, ...; the held record is bad<HELD_INDEX>.
    const heldOffset = String(2 * (HELD_INDEX - 1));
    let holdOnce = true;
    const guard: SourceRecoveryHandlers = {
      recover: ({ incident }) => {
        if (holdOnce && incident.position.kind === "kafka" && incident.position.offset === heldOffset) {
          return { decision: "hold", reason: "the test holds this record once" };
        }
        return { decision: "recoverable", context: { watermark: 1 }, evidenceRef: "kafka-replicated-test" };
      }
    };
    gw = await startReplicatedGateway({ topic, quarantine, group, guard });
    const { k } = gw;
    const ledger: LedgerEntry[] = [];
    let revision = 1;
    // One bad record of 256 KiB, so a large write is replicated before the failure too.
    for (let index = 1; index <= HELD_INDEX; index++) {
      ledger.push(...await produceBatch(topic, [badRecord(index, index === 3 ? 256 * 1024 : 0), goodRecord(++revision)]));
    }
    const held = ledger.find(entry => entry.offset === heldOffset)!;
    assert.equal(held.kind, "bad");
    const denied = await waitForIncident(k, heldOffset, incident => incident.recovery === "denied", "held by the guard");
    assert.equal(denied.quarantine, "acknowledged");
    assert.equal(await groupCoordinator(group), STEADY, "the group coordinator is on a broker that is not killed");
    console.log(`# quarantine topic: RF 3, ${JSON.stringify(settings)}, leader ${KILLED}; source topic RF 3 led by ${STEADY}; group coordinator ${STEADY}`);

    const ackedBeforeKill: IncidentRecord[] = (await incidents(k)).filter(incident => incident.quarantine === "acknowledged");
    assert.equal(ackedBeforeKill.length, HELD_INDEX, "every bad record so far has acknowledged evidence");
    assert.equal(await committedOffset(group, topic), heldOffset, "the source holds at the guarded record");
    const killedAt = await killBroker(KILLED);
    holdOnce = false;
    // An operator retry right after the kill: the record is redelivered and a fresh quarantine write starts inside the window.
    await k.internals.resumeSource("orders");
    console.log(`# SIGKILLed quarantine leader ${KILLED} after ${ackedBeforeKill.length} acknowledged writes; retried source offset ${heldOffset} at once`);

    // The rest of the stream keeps arriving during the failure.
    const producing = (async () => {
      for (let index = HELD_INDEX + 1; index <= BAD_RECORDS; index++) {
        ledger.push(...await produceBatch(topic, [badRecord(index), goodRecord(++revision)]));
        await sleep(250);
      }
    })();

    // The write inside the window is not acknowledged; the record holds and is never committed past.
    const windowed = await waitForIncident(k, heldOffset, incident => incident.observations >= 2 && incident.quarantine !== "pending", "a second write outcome", 60_000);
    const windowedAt = Date.now() - killedAt;
    const windowedDetail = eventsOf(k, windowed.failureId).filter(event => event.event === "quarantine-unknown" || event.event === "held").at(-1)?.detail ?? null;
    console.log(`# write started inside the failover window: ${windowed.quarantine} after ${windowedAt} ms (${windowedDetail})`);
    assert.ok(windowed.quarantine === "unknown" || windowed.quarantine === "failed", `a write to the killed leader was ${windowed.quarantine}`);
    assert.equal(windowed.progress, "held");
    assert.equal(k.internals.sources()[0]?.status, "paused");
    assert.equal(await committedOffset(group, topic), heldOffset, "the held record is not committed past");

    const failedOver = await waitForPartition(quarantine, state => state.leader !== KILLED && state.leader > 0, "a new leader", 60_000, [KILLED]);
    const failoverMs = Date.now() - killedAt;
    console.log(`# new quarantine leader ${failedOver.leader} seen ${failoverMs} ms after the kill; ISR ${JSON.stringify(failedOver.isr)}`);
    assert.ok(!failedOver.isr.includes(KILLED));

    // With the old leader still down, everything acknowledged before the kill is on the new leader, byte for byte.
    const whileDown = await checkEvidence({ quarantine, ledger, acknowledged: ackedBeforeKill, committed: null });
    const readerMs = await checkWithReader(quarantine, ackedBeforeKill, ledger, [KILLED]);
    console.log(`# with broker ${KILLED} down: ${whileDown.acknowledgedChecked} pre-kill acknowledgments verified byte for byte on leader ${failedOver.leader} by a plain consumer and by KafkaQuarantineReader (${readerMs} ms); ${whileDown.records} records up to the high watermark`);
    assert.equal(await committedOffset(group, topic), heldOffset, "still held after the failover, until a retry");

    // Bring the killed broker back while the stream drains.
    const restartedAt = Date.now();
    let killedIsBack = false;
    const restarted = startBroker(KILLED).then(() => { killedIsBack = true; });
    await producing;
    ledger.sort((a, b) => Number(a.offset) - Number(b.offset));

    // Drain. A held record whose write was not acknowledged gets an operator retry (it retries, never
    // skips) once the partition has a live leader, at most once per failed observation.
    const end = BigInt(ledger.at(-1)!.offset) + 1n;
    const retries: { offset: string; quarantine: string; detail: string | null; atMs: number }[] = [];
    const retriedAt = new Map<string, number>();
    const deadline = Date.now() + 180_000;
    for (;;) {
      const committed = await committedOffset(group, topic);
      const list = await incidents(k);
      if (committed !== "-1" && BigInt(committed) === end) break;
      for (const incident of list) {
        if (incident.progress === "advanced") assert.equal(incident.quarantine, "acknowledged", `advanced without acknowledged evidence: ${JSON.stringify(incident)}`);
        assert.notEqual(incident.progress, "uncertain", `an advance became uncertain: ${JSON.stringify(eventsOf(k, incident.failureId))}; gateway log: ${JSON.stringify(gw.logger.entries)}`);
      }
      const blocked = list.find(incident => incident.state === "open" && incident.progress === "held" && (incident.quarantine === "unknown" || incident.quarantine === "failed"));
      if (blocked !== undefined && blocked.position.kind === "kafka" && k.internals.sources()[0]?.status === "paused") {
        assert.ok(committed === "-1" || BigInt(committed) <= BigInt(blocked.position.offset), `committed ${committed} past held ${blocked.position.offset}`);
        const leader = (await partitionState(quarantine, killedIsBack ? [] : [KILLED]).catch(() => null))?.leader ?? -1;
        if (leader > 0 && (leader !== KILLED || killedIsBack) && (retriedAt.get(blocked.failureId) ?? 0) < blocked.observations) {
          retriedAt.set(blocked.failureId, blocked.observations);
          const detail = eventsOf(k, blocked.failureId).filter(event => event.event === "quarantine-unknown" || event.event === "held").at(-1)?.detail ?? null;
          retries.push({ offset: blocked.position.offset, quarantine: blocked.quarantine, detail, atMs: Date.now() - killedAt });
          await k.internals.resumeSource("orders");
        }
      }
      if (Date.now() > deadline) assert.fail(`never drained: committed ${committed} of ${end}; ${JSON.stringify(list.filter(incident => incident.state === "open"))}`);
      await sleep(100);
    }
    console.log(`# all ${ledger.length} records committed ${Date.now() - killedAt} ms after the kill`);
    console.log(`# operator retries after the failover: ${retries.length} ${JSON.stringify(retries)}`);
    assert.ok(retries.some(retry => retry.offset === heldOffset), "the held record proceeded only after a retry");

    // The journal's own event times, relative to the kill, for the records quarantined after it.
    const timeline = (await incidents(k))
      .filter(incident => incident.position.kind === "kafka" && BigInt(incident.position.offset) >= BigInt(heldOffset))
      .map(incident => {
        const events = eventsOf(k, incident.failureId);
        const at = (name: string) => { const event = events.findLast(entry => entry.event === name); return event === undefined ? null : Date.parse(event.at) - killedAt; };
        return {
          offset: incident.position.kind === "kafka" ? incident.position.offset : "?", lastDetected: at("detected"), lastAcknowledged: at("quarantined"),
          advanced: at("advance-confirmed"), unknownWrites: events.filter(entry => entry.event === "quarantine-unknown").length
        };
      })
      .sort((a, b) => Number(a.offset) - Number(b.offset));
    console.log(`# timeline after the kill (ms): ${JSON.stringify(timeline)}`);

    await restarted;
    const rejoined = await waitForPartition(quarantine, state => state.isr.length === 3, "the killed broker back in the ISR", 120_000);
    console.log(`# broker ${KILLED} back in the ISR ${Date.now() - restartedAt} ms after its restart began; leader ${rejoined.leader}`);

    // After recovery: the journal's view, checked against the ledger and the topic.
    const final = await incidents(k);
    assert.equal(final.length, BAD_RECORDS, "one incident per bad record");
    for (const entry of ledger.filter(item => item.kind === "bad")) {
      const incident = incidentAt(final, entry.offset);
      assert.ok(incident !== undefined, `no incident for bad record ${entry.offset}`);
      assert.equal(incident.quarantine, "acknowledged");
      assert.equal(incident.progress, "advanced");
    }
    for (const before of ackedBeforeKill) {
      if (before.position.kind === "kafka" && before.position.offset === heldOffset) continue;
      const now = final.find(incident => incident.failureId === before.failureId);
      assert.deepEqual(now?.quarantineCoordinates, before.quarantineCoordinates, "an acknowledgment from before the kill still names the same coordinates");
    }
    const committed = await committedOffset(group, topic);
    assert.equal(committed, String(end));
    // Every acknowledgment, before the kill and after it, is still there after the old leader rejoined.
    await checkEvidence({ quarantine, ledger, acknowledged: ackedBeforeKill, committed: null });
    const check = await checkEvidence({ quarantine, ledger, acknowledged: final, committed });
    await checkWithReader(quarantine, final, ledger);
    assert.ok((check.copies.get(heldOffset) ?? 0) >= 2, "the retried record has its pre-kill copy and a fresh acknowledged one");
    const duplicated = [...check.copies].filter(([, count]) => count > 1);
    console.log(`# after recovery: ${check.records} quarantine records for ${BAD_RECORDS} bad records; copies per source offset where more than one ${JSON.stringify(duplicated)}; all byte-identical to the ledger`);
    console.log(`# gateway warnings/errors: ${gw.logger.entries.length} ${JSON.stringify([...new Set(gw.logger.entries.map(entry => entry.message))])}`);
  });
});
