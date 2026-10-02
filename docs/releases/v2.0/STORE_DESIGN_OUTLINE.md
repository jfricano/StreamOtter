# V2.0 delivery store: design outline

**Status:** outline · September 29, 2026 · Research packet R05. This isn't a design and nothing here is approved. It lists what the V2.0 storage decision must settle, and in what order, so that decision can be written when V2.0 work starts.

## The job

Retained event channels need history that a resuming client can trust. An accepted event is stored before its Kafka offset is committed, keeps the same identity when it's retried, and is either replayable or explicitly reported as unavailable. It is never silently skipped. State-only (V1) deployments must keep running with no store at all.

## Settle the failure model before picking a store

1. **Which failures preserve an accepted event:** a process crash, host restart, disk loss, store failover, broker loss. Each is either covered or explicitly excluded.
2. **The admission boundary:** append to history, then commit the Kafka offset. What happens after a crash between the two, and how a retry keeps the same event identity (stable source identity plus channel mapping and version).
3. **Ordering scope:** per channel instance. How a multi-partition source becomes one cursor order without pretending unrelated offsets share one sequence.
4. **Cursors:** opaque, scoped to principal, channel version, parameters and source generation. Invalidated on a definition or history change.
5. **Retention and unavailable history:** when events may be deleted, and what `HISTORY_UNAVAILABLE` or `CURSOR_EXPIRED` look like to a client.
6. **Source failures (from V1.1):** event-channel sources default to holding on a bad record. If advancing past one is ever allowed, it writes a durable, visible gap. A quarantined position is recorded as source progress so it can't be confused with loss.
7. **Replay budgets:** replay competes with live delivery, so there are per-client and shared limits. Fresh clients must not be starved by catch-up.
8. **Authorization on replay:** re-check on each page and during long handler work. Define what a client sees when an event it could read before is no longer readable.
9. **Operations:** backup and restore, schema migrations, and what happens when notifications are lost (they only wake workers; history is the authority).

## Candidates to investigate

| Candidate | Why it's on the list | First thing to prove |
| --- | --- | --- |
| PostgreSQL | Transactional append with a uniqueness constraint gives idempotent admission; mature backup and restore | Append-then-commit crash behavior under the chosen isolation level; index and storage cost per retained event |
| Redis Streams (the one alternative) | Simple ordered append and range reads | That its persistence and failover settings actually meet the accepted-event guarantee. The default asynchronous persistence doesn't. |
| Kafka-backed history | No new service | Only if per-channel-instance indexing and replay fit without disproportionate complexity. Otherwise dropped. |

At most two spikes, local only, with no paid infrastructure. There is no universal store abstraction until one supported deployment works. The V1.1 incident journal is not a candidate.

## Tests to write before implementation

Tests to write first, each expected to fail until the store works:

- a crash after append but before commit;
- a crash after commit but before local bookkeeping;
- an append retried after a lost acknowledgment;
- an expired cursor;
- a cursor reused across a tenant or channel version;
- a revocation during a long page;
- a quarantined record on an event-channel source;
- a replay flood alongside live clients.

Each one names its independent expected result (see the [benchmark protocol](../../research/2026-09-future-strategy/BENCHMARK_PROTOCOL.md), event track).

## Decisions this outline leaves to the owner

- The accepted-event guarantee, meaning which failures are covered (feeds P03).
- The reference deployment and its storage and operating cost (P03).
- Whether an event-channel source may ever advance past a bad record, even with a visible gap.
