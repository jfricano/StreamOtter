# ADR-15A: Failure journal and acknowledged quarantine handoff

**Status:** Proposed · September 29, 2026 · Decides spec §5 and §6
**Baseline read:** `packages/gateway/src/sources/kafka.ts`, `sources/types.ts`, `runtime/gateway.ts` (`#process`, `resumeSource`), `runtime/identity.ts` at `7b40678`.

## Context

V1 already does most of what the draft calls "hold": any failure in `#process` returns `{ kind: "pause" }`, the adapter pauses every topic of the source and seeks the failing partition back to the record (`kafka.ts` `#pauseAt`), and `#setSourceStatus(paused)` moves every subscription on the source to `waiting-source`/`stale` (`subscription.ts` `onSourceUnavailable`). Nothing can reach `live` again until the source is ready. `resumeSource` resumes without re-seeking and retries the same record.

What V1.5 adds is evidence, a durable record of what happened, and a controlled way to move past the record. The questions are where the slow work runs, what stores it, and how the offset moves.

## Decision

### 1. Every failure pauses first; disposition runs outside the fetch loop

All failure classes keep returning `pause` from `#process`. The adapter's existing pause-and-seek runs unchanged. The new failure service then works on the held record **after** `eachBatch` has returned, not inside it.

The draft implies quarantine publish (up to ~30 s with retries) and the recovery guard (10 s) run while the record is in flight. Inside `eachBatch` that means holding a KafkaJS batch across long awaits with manual `heartbeat()` calls against a 30 s session timeout. Pausing first reuses the tested V1 path, keeps the consumer loop free, and makes "held" the state every crash window falls back to.

Moving past the record is a new adapter method rather than a new `ProcessOutcome`:

```ts
interface SourceAdapter {
  // existing: start, stop, resume, check
  /** Commit exactly offset+1 for a held record, confirm it, seek past it, and resume. */
  advancePast(held: HeldPosition): Promise<AdvanceResult>; // "advanced" | "not-held" | "uncertain"
}
```

`advancePast` refuses unless the adapter is paused at exactly that topic/partition/offset in the current assignment. It commits `offset+1`, reads the committed offset back through the admin client, and only then seeks and resumes. If the read-back disagrees or fails, the result is `uncertain` and the source stays paused. This is a change from V1's ordinary commit path, where a failed commit is logged and processing continues (`kafka.ts` catch block); that path is unchanged for ordinary records.

**Must be verified in slice B:** that KafkaJS 2.2.4 keeps heartbeating and group membership while every topic of the consumer is paused for longer than `sessionTimeout`, and that `commitOffsets` is accepted while paused. The existing poison test pauses briefly; a long-hold test is needed.

### 2. Journal: built-in `node:sqlite`, one file per project

Use Node's built-in `node:sqlite` (`DatabaseSync`) so enabling quarantine adds no npm dependency. Settings: `journal_mode=WAL`, `synchronous=FULL`, a schema-version table, and forward-only migrations run by `streamotter init --failures`. The gateway takes an exclusive lock (a `journal.lock` file opened `wx` holding pid, projectId and start time, plus a row in the journal naming the project and each source's generation) and refuses to start on any mismatch. A missing journal is never recreated by `start`.

**Open risk:** `node:sqlite` still prints an `ExperimentalWarning` (observed on Node 22.22; the Node 24 status must be checked). If it's still experimental on Node 24, the fallback is `better-sqlite3`, a native addon with prebuilt binaries. Either choice sits behind one small `Journal` interface so the swap is local.

### 3. Incident identity reuses the V1 source-record ID

`failureId = "f1:" + sourceRecordId(projectId, sourceId, generation, position)` (`identity.ts:41`). The redelivered record gets the same ID with no new hashing scheme. V1 allows exactly one Kafka connection profile per project (`config.ts` rejects `MULTIPLE_CONNECTIONS`), so the draft's "cluster identity" is not needed in the ID. It is still recorded: the gateway reads the Kafka `clusterId` at startup, stores it with each incident, and refuses to advance an incident whose `clusterId` differs, which catches a profile silently repointed at another cluster.

### 4. Evidence goes into Kafka verbatim, metadata goes into headers

The draft's JSON envelope with byte-safe encoding runs into a broker limit. Kafka's default `max.message.bytes` is 1,048,588 bytes, and V1 accepts source records up to `maxSourceRecordBytes` (1 MiB). A base64 envelope of a 1 MiB record is about 1.4 MiB, and the draft's 2 MiB envelope ceiling would be rejected by a default topic.

So a quarantine record is:

- **key:** the original key bytes (or null);
- **value:** the original value bytes (or null for a tombstone);
- **headers:** `streamotter-envelope` (compact JSON of the §5.2 metadata, ≤ 16 KiB), `streamotter-failure-id`, and the original headers copied with a `src.` prefix.

At startup the gateway reads the quarantine topic's `max.message.bytes` and `min.insync.replicas` through the admin client. It refuses to enable quarantine if the topic cannot hold `maxSourceRecordBytes` plus 80 KiB, and reports the replication settings in `status`, never as a guarantee.

### 5. Producer settings

One KafkaJS producer per gateway on the project's connection profile (separate SASL credentials allowed): `acks: -1`, `idempotent: true`, `maxInFlightRequests: 1`, `allowAutoTopicCreation: false`, a 10 s request deadline, and two retries. A timeout is recorded as `quarantine-unknown`, never as success.

### 6. Adapter input carries raw evidence

`SourceInput` gains `keyBytes`, `headers` and `timestamp`. The existing `key: string | null` stays for `SourceRecord`. Today's UTF-8 key decode (`message.key.toString("utf8")`) is lossy, which is why the raw bytes are needed.

## Ordering for one failing record

1. `#process` returns `pause` with a trusted failure class (see ADR-15B §1). The adapter pauses and seeks back (unchanged).
2. The failure service writes the incident and `held` state to the journal. If that fails, the source stays paused and readiness goes false.
3. For a quarantine policy, publish to the quarantine topic, then record the acknowledged partition and offset.
4. `quarantine-hold` stops here. `quarantine-resync` goes to ADR-15B.
5. Before advancing, persist the barrier and `advance-pending`, then `advancePast`, then `advance-confirmed`.

The draft's crash table (§6) holds, with one simplification: every crash window restarts into "paused at the committed offset", because nothing is committed until step 5.

## Consequences

- No new npm dependency if `node:sqlite` is acceptable, and no new service.
- Ordinary V1 installs are untouched: no journal, no producer, the same pause path.
- Quarantine topics must be provisioned with a raised `max.message.bytes`. That goes in the runbook and the startup check.
- Tests F10–F18 and F27–F30 apply, plus the long-pause heartbeat test above.
