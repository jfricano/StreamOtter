# Handle bad records: source-failure policies and the operator runbook

October 2026 · Applies to the V1.1 source-failure features, which are not yet in a published release.

A Kafka record your gateway can't process stops its source. That was true in V1 and it stays the default. V1.1 adds three things you can turn on:

- **A durable record of every failure** (an *incident*), kept in a local journal, with a stable ID, the failure's class, its position, and its history.
- **Quarantine**: the original record, byte for byte, is copied to a Kafka topic you provide. The source stays held at the record, or, with an application-owned recovery guard, moves past it.
- **Operator commands**: inspect, retry, re-check, evaluate and redrive a single record, from the CLI, from your own code, or from the workbench in development.

Nothing changes for a configuration without `failureHandling`. Your gateway pauses on a bad record exactly as before, needs no writable disk and no quarantine topic.

This guide is the runbook: how to turn the features on, how to choose a policy, how to write the application code honestly, how to operate, and what to do when things go wrong. The exact types and refusal codes are in the [V1.1 API draft](../releases/v1.1/V1_1_API.md); the design is in the [V1.1 specification](../releases/v1.1/V1_1_SOURCE_FAILURE_SPEC.md) and [ADR-15A/B/C](../releases/v1.1/adr/). What is tested is in the [implementation status](../IMPLEMENTATION_STATUS.md#v11-source-failure-handling-unreleased).

## 1. Before you start

- **Node.js 24.15 or later** wherever the journal runs. Earlier Node 24 releases print an experimental warning for `node:sqlite`, so the gateway refuses to open a journal on them.
- **One gateway per project**, as in V1. The journal belongs to exactly one gateway process.
- **A persistent local directory** for the journal (a mounted volume in a container). The journal is not a database service and is not shared between hosts.
- **For Kafka sources that quarantine:** a pre-provisioned quarantine topic on the same cluster, and the ACLs in [§6.1](#61-credentials-and-acls).

Not covered by V1.1: skipping a record silently (there is no `ignore`, `discard` or `force-skip`), bulk or scheduled replay, editing a record, and publishing anything back to a business topic.

## 2. Turn it on

### 2.1 Add `failureHandling` to `streamotter.json`

```json
{
  "failureHandling": {
    "quarantine": { "topic": "orders-app.streamotter.quarantine", "capture": "full-record" },
    "sources": {
      "orders": { "invalidJson": "quarantine-hold", "invalidPublicPayload": "quarantine-hold" }
    }
  }
}
```

- `sources` is keyed by source ID. A source with no entry keeps V1 behavior, but its failures are still recorded as incidents.
- `quarantine` is required as soon as a Kafka source uses a quarantine policy. `capture` must be `"full-record"`: capturing payloads is an explicit choice, because records can hold confidential data.
- The quarantine topic must not be one of your source topics.

`streamotter validate --config streamotter.json` checks all of this. The rules and their issue codes are in [API §2](../releases/v1.1/V1_1_API.md#2-project-configuration-failurehandling-slice-a--normative-implemented-in-packagescontractssrcfailurests).

### 2.2 Provision the quarantine topic

Create it yourself; the gateway never creates topics. Its `max.message.bytes` must be at least `limits.maxSourceRecordBytes` plus 80 KiB (81,920 bytes). With the default 1 MiB record limit, that is **1,130,496** bytes, above Kafka's default of 1,048,588. Startup refuses a missing or undersized topic. See [Connect to Kafka: the quarantine topic](./kafka.md#the-quarantine-topic-v11).

### 2.3 Create the journal

```bash
npx streamotter init --failures --config streamotter.json --state-dir /var/lib/streamotter/orders-app
```

This creates the state directory (mode 0700) if needed, its `run/` subdirectory (0700), and `journal.sqlite` (0600). It refuses to overwrite an existing journal. The configuration must already have a `failureHandling` section.

Run it as the user the gateway runs as. Ordinary startup never creates a journal, so a missing one is always a visible error, never a silent fresh start.

### 2.4 Start the gateway with the new options

```bash
NODE_ENV=production npx streamotter start --config streamotter.json --handlers dist/handlers.js \
  --state-dir /var/lib/streamotter/orders-app \
  --handler-build-id "$GIT_SHA" \
  --operator-socket \
  --health 127.0.0.1:7402
```

| Flag | Gateway option | What it does |
| --- | --- | --- |
| `--state-dir <dir>` | `stateDirectory` | Where the journal lives. Required in production when any source uses a quarantine policy. |
| `--handler-build-id <id>` | `handlerBuildId` | 1 to 128 characters naming your handler build, such as a commit SHA. Recorded in every incident and in redrive plan fingerprints. Default `"unspecified"`. |
| `--operator-socket` | `operatorSocket: true` | Serves the operator API on `<dir>/run/operator.sock` for the CLI. Requires `--state-dir` and a `failureHandling` section. |
| `--health <host:port>` | `health: { host, port }` | A read-only health listener; see [Run in production: health checks](../DEPLOYMENT.md#health-checks). Works with or without failure handling. Accepts `host:port`, `[ipv6]:port` or a bare port (bound to 127.0.0.1). `dev` has no `--health`. |

Without `--state-dir`, `streamotter dev` keeps incidents in memory and logs that they are not durable. That is fine for trying policies. `start` in production refuses a quarantine policy without one. A production gateway whose sources all use `pause` starts without a state directory, but its incidents are then in memory only, so set one anyway.

From your own code:

```ts
import { createGateway } from "streamotter/gateway";
import { getGatewayOperator } from "streamotter/gateway/operator";

const gateway = createGateway({
  config, handlers, mode: "production",
  stateDirectory: "/var/lib/streamotter/orders-app",
  handlerBuildId: process.env.GIT_SHA,
  operatorSocket: true,                      // optional: lets the CLI reach this process
  health: { host: "127.0.0.1", port: 7402 }  // optional
});
await gateway.start();
const operator = getGatewayOperator(gateway); // the same operations as the CLI, in-process
```

### 2.5 Rehearse in development first

A fixture record can carry raw text, decoded exactly like broker bytes, so you can rehearse invalid JSON without Kafka:

```js
export const development = {
  principals: { developer: { subject: "dev", tenantId: "acme", sessionId: "dev", claims: {} } },
  fixtures: { orders: [{ key: "ord_1", value: { /* a good record */ } }, { key: "ord_2", raw: "{not json" }] }
};
```

A fixture source may use quarantine policies. Its evidence stays in the local store and is labeled "fixture evidence, not Kafka" everywhere. Advance the fixture in the workbench, then open the **Failures** tab.

## 3. Choose a policy

Each source gets a policy for two failure classes. Everything else always pauses.

| Policy | What happens to the record | When to use it |
| --- | --- | --- |
| `pause` (default) | The source stops at the record. An incident is recorded. Nothing is copied. | You want V1 behavior with a durable record of what happened. |
| `quarantine-hold` | The original record is written to the quarantine topic and acknowledged. The source still stops at it; nothing is committed past it. | **Start here.** You want the evidence preserved and a human to decide. |
| `quarantine-resync` | After a fresh acknowledged copy, your recovery guard decides. If it approves, the offset moves past the record, and every later snapshot on the source must acknowledge a recovery boundary before a view can be `live`. | Only when your application can prove that its snapshots already cover what the record would have changed ([§4](#4-write-an-honest-recovery-guard)). |

Which class can take which policy:

| Failure class | Raised when | Policies |
| --- | --- | --- |
| `invalid-json` | The value isn't UTF-8 JSON within the nesting limit | `invalidJson`: any of the three |
| `payload-schema` | Routing passed, but the mapped data fails the channel's payload schema | `invalidPublicPayload`: any of the three |
| `mapper-transient` | `map` threw a `TransientMappingError` on every allowed attempt | Bounded retry, then pause |
| `mapper-error`, `mapper-timeout` | `map` threw, or exceeded `handlerTimeoutMs` | Pause |
| `routing-invalid` | `map` returned a bad tenant, params, revision, shape or count | Pause; never skipped |
| `revision-conflict` | The same revision maps to different data | Pause; never skipped |
| `tombstone`, `oversize` | A null value, or a record over `maxSourceRecordBytes` | Pause |

Broker outages, rebalances, shutdown, journal failures and quarantine failures are not failure classes. They keep V1's outage handling and never create a skippable incident.

Per-source options, all optional:

| Option | Default | Meaning |
| --- | --- | --- |
| `transientMapperRetries` | `0` | `1` or `2` more attempts after a `TransientMappingError`, waiting 250 ms then 1 s. Requires `replaySafeMapping: true`. |
| `replaySafeMapping` | `false` | Your declaration that every `map` handler of the source is side-effect-free and safe to repeat. Required for retries and for redrive. StreamOtter can't check it. |
| `automaticAdvanceLimit` | `{ "incidents": 5, "windowMs": 60000 }` | The circuit breaker for `quarantine-resync`: incidents 1–20, window 1 s to 1 h. When it trips, the source holds until an operator reopens it. |
| `boundaryRetirement` | `"generation"` | How a recovery boundary ends; `quarantine-resync` only. See [§4.3](#43-retiring-a-boundary). |

To signal a transient failure from `map`:

```ts
import { TransientMappingError } from "streamotter/gateway";

map: async ({ record, signal }) => {
  const rate = await rates.lookup(record.value, signal).catch(error => { throw new TransientMappingError("rates service unavailable", { cause: error }); });
  return [/* … */];
}
```

## 4. Write an honest recovery guard

`quarantine-resync` moves past a record your gateway could not read. That is only honest if your snapshots already reflect whatever that record changed. A healthy consumer, an acknowledged quarantine write, or a newer record proves nothing about it. So the gateway asks your application, and then makes every snapshot confirm the answer.

### 4.1 The guard

Add `handlers.sources[sourceId].recover` for each source with a `quarantine-resync` policy. Startup refuses a missing guard, and a guard for a source that doesn't use `quarantine-resync`.

The guard receives the incident (ID, class, Kafka position, evidence hash), the source generation, and the boundary currently in force (`prior`, or `null`). It returns either:

- `{ decision: "hold", reason }`: keep the source held. Return this whenever you can't prove coverage.
- `{ decision: "recoverable", context, evidenceRef }`: `context` is JSON of at most 16 KiB that your snapshots will check. It must carry forward everything `prior.context` required. `evidenceRef` (at most 512 characters) says what you checked; it is stored for operators.

It runs at most once at a time per source, with a 10-second limit whatever `handlerTimeoutMs` is. A throw, a timeout or an invalid answer keeps the source held.

What makes a guard honest is evidence the gateway doesn't have. One pattern, for an application that publishes through a transactional outbox whose relay records the Kafka position of each row it publishes:

```ts
sources: {
  orders: {
    async recover({ incident, prior, signal }) {
      // Which outbox row produced the record at this position? The relay recorded it.
      const row = await outbox.findByPosition(incident.position, signal);
      if (row === null) return { decision: "hold", reason: "no outbox row for this position; its effect is unknown" };
      // The state change was committed in the same transaction as the outbox row,
      // so the database already holds it. Snapshots must read at least this far.
      const previous = (prior?.context as { outboxSeq?: number } | undefined)?.outboxSeq ?? 0;
      return {
        decision: "recoverable",
        context: { outboxSeq: Math.max(previous, row.seq) },
        evidenceRef: `outbox row ${row.seq}, committed ${row.committedAt}`
      };
    }
  }
}
```

The guard is only as good as the outbox behind it. Keep every row from the moment an entity was created (or at least from the oldest position the guard may still be asked about); a pruned or restored-without-history outbox makes a changed entity look unchanged. Decide "never changed" from the entity's own state (for example, still at its creation revision), never from finding no rows. And when more than one row recorded the same position, as after a topic was re-created with the outbox kept, hold.

A guard that always returns `recoverable` is not a guard. If invalid bytes hide which entity changed and your snapshots can lag the topic, the right answer is `hold`. The order dashboard has a complete guard to copy: [`decideRecovery`](../../examples/order-dashboard/src/server/domain.ts) checks an outbox watermark and the published position, and its README [explains each check](../../examples/order-dashboard/README.md#source-failures-quarantine-resync-and-the-recovery-guard).

### 4.2 Acknowledge the boundary in every snapshot

When the guard approves, the gateway stores a recovery boundary (its ID starts with `rb1:`) and moves the offset. From then on, every snapshot on every channel of that source receives `recovery: { boundaryId, context }`, including new subscriptions and after restarts. A snapshot counts only if it returns the same `recoveryBoundaryId`:

```ts
async snapshot({ principal, params, recovery, signal }) {
  // Read the state and how far this replica has applied, in one transaction.
  const { row, appliedSeq } = await orders.readWithWatermark(principal.tenantId, params.orderId, signal);
  const result = { revision: String(row.version), data: row.order };
  if (recovery === undefined) return result;
  const required = (recovery.context as { outboxSeq: number }).outboxSeq;
  // Behind the boundary: don't acknowledge. The attempt is retried with backoff and the view stays stale.
  return appliedSeq >= required ? { ...result, recoveryBoundaryId: recovery.boundaryId } : result;
}
```

- **Return the ID only when `recovery` is present.** An ID returned when no boundary is in force is `INVALID_PAYLOAD`.
- **When your read is behind, omit the ID; don't throw.** An omitted or different ID is a retryable `SOURCE_UNAVAILABLE` attempt: the view stays `stale` and the SDK's normal backoff applies. A thrown error fails the subscription with `HANDLER_FAILED`.
- The boundary is checked again after the pre-delivery authorization, so a snapshot that started under an older boundary doesn't count.

The gateway checks the identity and lifecycle of the boundary. It can't check that your database really contains the change. That claim is yours, as V1's snapshot consistency already is.

### 4.3 Retiring a boundary

A boundary stays in force until it is superseded by the next approved incident on the source, or retired. `boundaryRetirement` picks how:

| Mode | How it ends | Use it when |
| --- | --- | --- |
| `generation` (default) | Only when you change the source's `generation` (a rebaseline). | You want the safe default. Every snapshot keeps acknowledging until then. |
| `application` | After each acknowledged snapshot, the gateway calls `handlers.sources[id].retire({ boundary })`; `true` retires it. One call at a time, 10-second limit. | Your application can prove the boundary is permanently behind it, for example a database watermark. Startup refuses this mode without `retire`. |
| `operator` | `streamotter sources retire-boundary` (CLI or in-process only). | Rarely, and only after a person has verified the claim. |

A generation change always retires the boundary, whatever the mode. No mode retires a boundary while an incident it covers is still held.

> **Operator retirement is the unsafe option.** Retiring a boundary tells the gateway that every future snapshot already reflects the quarantined record. StreamOtter can't check that. If the claim is wrong, subscribers can reach `live` while showing state that's missing the change the quarantined record carried, and nothing downstream will flag it.
>
> Reasonable uses: development and fixtures; a record that provably had no state effect (a duplicate, a test message on the wrong topic, an entity since deleted); a verified manual repair, described in `--reason`; a short bridge while you write a real `retire` handler. Not a reason: dropping the acknowledgment code from snapshots, or making an alert go away. If you retire boundaries routinely on a source, it needs `application` mode.

## 5. Operate

### 5.1 Where to look

| Question | Command |
| --- | --- |
| Is anything held? Is the journal healthy? Is a circuit open? | `streamotter status --state-dir <dir>` |
| Which incidents are open? | `streamotter failures list --state-dir <dir>` (open incidents by default, oldest first; `--state resolved` or `all`, `--source <id>`, `--limit` up to 200) |
| What happened to one record, and what can I do? | `streamotter failures show --state-dir <dir> --failure <failureId>` |
| A file to attach to a bug report | `streamotter failures export --state-dir <dir> --failure <failureId> --out incident.json` |

Every command takes `--json` for scripts. The CLI talks to the gateway serving `<dir>/run/operator.sock`, so that gateway must run with `--operator-socket`, and you must run the CLI as the gateway's user.

`failures show` keeps separate facts separate. Read them separately:

| Field | Values | Means |
| --- | --- | --- |
| `state` | `open`, `resolved` | Whether the incident still needs anything |
| `progress` | `held`, `retrying`, `advance-pending`, `advanced`, `processed`, `uncertain` | What happened to the source position. `processed` means the record went through on a retry; `advanced` means the source moved past it under a boundary. |
| `quarantine` | `not-required`, `pending`, `unknown`, `acknowledged`, `failed` | Whether a copy is in the quarantine topic. `unknown` is never treated as success. |
| `recovery` | `not-applicable`, `guard-pending`, `held`, `boundary-in-force`, `denied` | What the recovery guard decided |
| `evidence.completeness` | `complete`, `incomplete`, `unavailable`, `expired` | Whether the original bytes can be read back |
| `nextAction` | `repair-and-retry`, `reassess`, `evaluate`, `reopen-circuit`, `none` | The supported next step, also explained in plain words |

None of these says a browser shows correct data. That is still each subscription's `live` state.

### 5.2 Act

Every action names the incident (or circuit, or boundary) and the revision you saw. If anything changed since, it's refused rather than applied. There is no `--force`, no wildcard and no bulk form. Get the revision from `failures show` or `status`.

| Situation | Command | What it does |
| --- | --- | --- |
| You fixed the cause (publisher, mapping, schema) | `sources retry-current --source <id> --failure <fid> --expected-revision <n>` | Resumes the source at the held record, which is processed again. Never skips it. Waits up to 15 s and reports `retried` (processed), `advanced`, `held` (failed again, with the reason) or `retrying` (not settled yet). |
| The guard held, and you fixed what it checks | `sources reassess --source <id> --failure <fid> --expected-revision <n>` | Like retry, for an eligible `quarantine-resync` incident whose recovery is `held` or `denied`: a fresh quarantine copy, the circuit, then the guard again. Never overrides an integrity failure. |
| The circuit breaker opened | `sources reopen-circuit --source <id> --expected-circuit-revision <n> --reason "<what you fixed>"` | Closes the circuit and clears its window. Approves no record; follow with `reassess` or `retry-current`. |
| A record was advanced past, and you want its state delivered now that the mapping works | `failures evaluate --failure <fid> --expected-revision <n>`, then `failures redrive --failure <fid> --plan <planId> --plan-fingerprint <fp> --expected-revision <n>` | Evaluate reads the original back, runs the current mapping without delivering, tracing or committing, and issues a five-minute single-use plan when redrive is allowed. Redrive checks everything again and admits the outputs through the normal revision filter: `reprocessed` if a subscription took a frame, `superseded` if current state was already newer. Nothing is published to Kafka and no offset moves. |
| Retire a boundary by hand (`boundaryRetirement: "operator"` only) | `sources retire-boundary --source <id> --boundary <bid> --expected-revision <n> --reason "<what you verified>" --confirm <bid>` | See the warning in [§4.3](#43-retiring-a-boundary). The CLI prints it and sends nothing unless `--confirm` repeats the boundary ID. |

Redrive needs: an `advanced` incident of an eligible class, `replaySafeMapping: true`, no open integrity incident on the source, readable evidence, and a mapping that now succeeds. Otherwise `evaluate` says why in `ineligibleReason`.

`retry-current`'s outcome `held` exits 0, because the operation completed. Read the outcome, not just the exit code.

### 5.3 Exit codes and refusals

| Exit | Meaning |
| --- | --- |
| `0` | Completed (including an outcome such as `held`) |
| `1` | Runtime failure: the gateway isn't running or reachable, an operator error, or the operation `failed` |
| `2` | Invalid usage or request (`INVALID_REQUEST`) |
| `3` | Refused: the gateway understood the request and declined it |
| `4` | Unknown outcome |

Refusals carry an `outcome` you can act on:

| Outcome | Do |
| --- | --- |
| `stale-revision` | Read the current revision with `failures show` or `status`, check what changed, and decide again. |
| `not-held`, `advance-unresolved`, `in-progress` | The record isn't waiting on you right now. Check `status`; an unresolved advance is reconciled at the next start. |
| `circuit-open` | Fix the cause, then `reopen-circuit`. While the circuit of a `quarantine-resync` source is open, every retry is refused, `gateway.resumeSource` included. |
| `integrity-class`, `policy-not-resync` | The class or policy can't be reassessed or redriven. Repair and `retry-current`. |
| `plan-expired`, `plan-unknown`, `fingerprint-changed` | Evaluate again; see [§6.6](#66-stale-or-expired-plans). |
| `evidence-expired`, `evidence-unavailable` | See [§6.4](#64-topic-retention-and-expired-evidence) and [§6.1](#61-credentials-and-acls). |
| `not-replay-safe`, `integrity-fault-open`, `not-advanced` | Redrive isn't allowed for this incident; `failures show` explains the next action. |
| `retirement-mode`, `incident-held` | Boundary retirement is off for this source, or an incident it covers is still held. |
| `operation-id-reused`, `operation-in-progress` | Use a new `--operation-id` for a new redrive. |
| `nothing-to-rebaseline` | `sources rebaseline` found nothing from an earlier generation; see [§6.10](#610-rebaseline-a-source). |
| `journal-unavailable` | The operation couldn't be recorded, so nothing was done; see [§6.3](#63-full-disk-or-full-journal). |

The full list is in [API §6](../releases/v1.1/V1_1_API.md#6-operator-service-slices-c-d).

### 5.4 In the workbench (development)

Under `streamotter dev` with a `failureHandling` section, the workbench shows a **Failures** tab. It lists incidents with evidence, quarantine, source position and recovery kept apart, explains each one, and offers retry, reassess, reopen-circuit, evaluate, redrive and a metadata-only export. Each action sends the revision on screen and shows the result as returned. It never shows raw record bytes, and it has no retire-boundary action.

The workbench is development tooling. It never connects to a production gateway or its operator socket. In production, use the CLI or `getGatewayOperator`.

### 5.5 Raw evidence

Original record bytes are confidential by default.

- `failures show --raw` prints them only as base64 with a 64-byte hex preview, never as text. Control and bidirectional-override characters in any printed string are escaped.
- `failures export --include-raw --out <file>` adds them to the bundle. The file is created with mode 0600 and never overwrites an existing one.
- No HTTP route returns raw bytes, and the health listener never mentions incidents.

Protect the quarantine topic, the state directory and their backups as you protect the source data. StreamOtter doesn't encrypt either at rest.

## 6. Incident procedures

Each procedure starts from what you see: readiness reasons from the [health listener](../DEPLOYMENT.md#health-checks), `streamotter status`, and gateway log lines. Log lines carry IDs and categories, never payloads or credentials.

### 6.1 Credentials and ACLs

The quarantine producer and reader use the connection profile of the quarantining sources, so the gateway's one Kafka principal needs, beyond V1's source ACLs:

| Resource | Operations | Used for |
| --- | --- | --- |
| Quarantine topic | Describe, DescribeConfigs | Startup check of the topic and its `max.message.bytes` |
| Quarantine topic | Write | Quarantine writes (idempotent producer, `acks=all`) |
| Quarantine topic | Read | Reading evidence back for `show --raw`, `export --include-raw`, `evaluate` and `redrive` |
| Consumer groups with the **prefix** `streamotter-<projectId>-quarantine-read-` | Read, Delete | Each read-back uses a throwaway group that never commits and is deleted afterwards |
| Each source's consumer group | Describe (V1's Read already includes it) | Reading the committed offset at startup to reconcile an unresolved advance |

For example, with Kafka's `kafka-acls.sh` and project ID `orders-app`:

```bash
kafka-acls.sh --bootstrap-server kafka-1.example.com:9093 --command-config admin.properties --add \
  --allow-principal User:orders-app --topic orders-app.streamotter.quarantine \
  --operation Describe --operation DescribeConfigs --operation Write --operation Read
kafka-acls.sh --bootstrap-server kafka-1.example.com:9093 --command-config admin.properties --add \
  --allow-principal User:orders-app --resource-pattern-type prefixed \
  --group streamotter-orders-app-quarantine-read- --operation Read --operation Delete
```

These follow from the client calls the gateway makes. A broker with ACLs enabled has not been tested yet, so check them in a staging cluster.

| Symptom | Likely cause | Do |
| --- | --- | --- |
| Startup fails: "The quarantine topic is missing" | The topic doesn't exist, **or** the principal can't Describe it | Check both. |
| Startup fails reading the topic's configuration | No DescribeConfigs on the topic | Grant it. |
| Incidents show `quarantine: failed` (for example `TOPIC_AUTHORIZATION_FAILED`); readiness reports `quarantine` | No Write on the topic | Grant Write, then `retry-current`. The record is written again when it is redelivered. |
| `show --raw`, `evaluate` or `redrive` report `evidence-unavailable` "not authorized to read the quarantine topic" | No Read on the topic or the read-group prefix | Grant them. |
| Log: "Could not delete a quarantine read's throwaway consumer group" | No Delete on the group prefix | Grant it, then delete the leftover `…-quarantine-read-<uuid>` groups. |

Credentials themselves (environment variables, CA files) work as in V1: a wrong password fails at the `authenticate` diagnostic stage without printing values.

### 6.2 Quarantine topic outage

The quarantine topic lives on your source cluster, so a whole-cluster outage is a source outage: views go `stale` and recover as in V1. This procedure is for the quarantine topic alone failing: its partition leader is unavailable, `min.insync.replicas` can't be met, it was deleted, or writes are refused.

What happens: the write times out after 10 seconds and two retries, or the broker refuses it. A timeout is recorded as `quarantine: unknown`, never as success. A definite refusal is `failed`. Either way the source stays held at the record, nothing is committed, and readiness reports `quarantine`. A `quarantine-resync` source never advances without a fresh acknowledged copy. Other sources keep running.

Do:

1. Fix the topic (leader, replicas, ACL, or re-create it with the right `max.message.bytes`).
2. Run `sources retry-current` for the held incident, or restart the gateway. The gateway doesn't rewrite in the background; an `unknown` write is retried only when the record is redelivered.
3. Expect duplicates. A lost acknowledgment can leave two copies in the topic. They share the `streamotter-failure-id` header and the gateway reads back only the one at the recorded coordinates.

If you re-created the topic, copies recorded at old coordinates are gone; their incidents report `evidence-unavailable` or `expired`.

Replication settings decide what survives a broker failure. `status` reports the topic's replication factor and `min.insync.replicas`; StreamOtter reports them and doesn't guarantee them. Broker-failure behavior has only been tested against a single broker so far.

### 6.3 Full disk or full journal

Symptoms: the log line "The failure journal could not record an incident; the source stays paused and nothing is skipped" (or "…could not record a state change…"); readiness reports `journal`; `status` shows the journal near its limit; operator actions are refused with `journal-unavailable`; errors are `OVERLOADED` with reason `journal-full`.

Limits: the journal holds at most 256 MiB. The local raw spool, used for fixture evidence, holds 16 MiB. It keeps at most 10,000 operator operations, pruning the oldest finished ones. Nothing else is evicted: the journal refuses the write and the source stays held, because unresolved decision state must not be lost.

Do:

1. If the disk is full, free space on the volume. Keep the WAL file (`journal.sqlite-wal`) and never delete journal files to make room.
2. Run `sources retry-current` for each held incident, or restart. A failed journal write is retried when the record is redelivered; readiness clears after the next successful write.
3. If the journal itself reached 256 MiB, V1.1 has no command to prune resolved incidents, and the limit isn't configurable. Archive the journal and follow [§6.8](#68-lost-or-damaged-local-state). For Kafka sources an incident stores metadata only, so this takes a very large number of incidents; watch `status` (`--json` gives `store.sizeBytes` and `store.limitBytes`).

### 6.4 Topic retention and expired evidence

Two topics have retention that matters.

**The quarantine topic.** Its retention decides how long evidence can be read back. A reference policy is 7 days. When a copy has been removed, `failures show --raw` shows no bytes and `evaluate` reports `evidence-expired` (naming the earliest retained offset) and issues no plan. The incident and any boundary stay in the journal; expired evidence never clears a recovery requirement. `quarantine-resync` writes a fresh copy before every advance, so an expired older copy never authorizes one. If you need the bytes longer, export them first: `failures export --include-raw --out <file>`.

**The source topic.** A held record is uncommitted, so retention can delete it while you work on the fix. The gateway then sees the group's position past the held record without a recorded advance. It holds the source ("Source progress moved past a held record without a recorded advance; the source is held") instead of treating that as progress. Retries hold again, because the record is gone. The way out is a rebaseline ([§6.10](#610-rebaseline-a-source)). Prevent it: keep source retention well above how long a hold may last, and alert on readiness. The same applies when someone resets the group's offsets by hand or another consumer commits on the group.

### 6.5 Repair a poison record

`failures show` names the class, the stage and the next action. Then:

| Cause | Repair |
| --- | --- |
| Your mapping is wrong (`mapper-error`, `mapper-timeout`, `routing-invalid`, `payload-schema` from a mapping bug) | Fix `map` or the schema, deploy with a new `--handler-build-id`, and restart. The held record is redelivered first. If it processes, the incident resolves as `processed`; nothing was skipped. When the cause was outside your code (data your mapper reads, a configuration service), fix it and `retry-current` without restarting. |
| A dependency was down (`mapper-transient`) | When it's back, `retry-current`. |
| The record itself is bad: `invalid-json`, or a value your schema rightly rejects (`payload-schema`) | The bytes in Kafka can't be repaired, and a retry fails the same way. Either let the guard decide: switch that class to `quarantine-resync`, add an honest guard and snapshot acknowledgment ([§4](#4-write-an-honest-recovery-guard)), and restart; the redelivered record follows the new policy. Or rebaseline past it ([§6.10](#610-rebaseline-a-source)). |
| `tombstone`, `oversize` | Never skipped, and never reach `map`, so no handler change helps. Fix the publisher, then rebaseline past the record ([§6.10](#610-rebaseline-a-source)). |
| `revision-conflict` | Never skipped. If your mapping produced the conflicting revision, fix it and restart. If the publisher did, fix the publisher; the record already in the topic then needs a rebaseline ([§6.10](#610-rebaseline-a-source)). |

A record whose redelivered bytes differ from the evidence captured for the same position is an integrity failure ("evidence-conflict"): the source stays held. Find out why the topic changed under the same offset (a re-created topic without a `generation` change is the usual reason).

After a repair, subscriptions resynchronize from fresh snapshots as in V1.

### 6.6 Stale or expired plans

A redrive plan is in gateway memory: at most 64 at a time, five minutes each, single use, gone after a restart.

| Refusal | Why | Do |
| --- | --- | --- |
| `plan-expired` | More than five minutes passed | Evaluate again and redrive promptly. |
| `plan-unknown` | The gateway restarted, or the plan was used | Evaluate again. |
| `fingerprint-changed` | The record now maps to different output, or the evidence changed, since the plan was issued; nothing was admitted | Evaluate again and review the new outputs before approving. |
| `stale-revision`, `generation-changed` | The incident or the source changed | Check `failures show`; evaluate again if redrive still makes sense. |

The plan fingerprint covers the incident and its revision, the source generation, the evidence hash, the configuration fingerprint, the handler build ID, channel versions and the mapped outputs. Changing any of them requires a new evaluation.

### 6.7 Crash and restart

Restart after a crash as in V1: wait for the dead consumer's 30-second session to expire, or let your supervisor retry after a short delay ([Run in production](../DEPLOYMENT.md#keep-it-running)).

On start, before any source is ready, the gateway:

- **Takes the journal lock.** `journal.lock` names the owning pid and host. A lock left by a dead process on the same host is replaced. A lock naming another host is refused, because its owner can't be checked: confirm that gateway is stopped, remove the lock, and start again.
- **Restores the boundary in force**, so no snapshot after a restart skips it.
- **Reconciles unresolved advances** (`advance-pending`, `uncertain`) against the consumer group's committed offset. Offset + 1 confirms the advance. At or below the record means it never happened, and the incident is `held` again. Anything further is unexplained, and the source holds. If the committed offset can't be read, the incident stays `uncertain` and held; restart once the broker is reachable.
- **Marks interrupted operator operations `unknown`.** They're logged ("An operator operation was interrupted by a restart; its outcome is unknown and it is not rerun") and never rerun. A CLI command that was waiting may have exited 1 or 4.

After an `unknown` operation: run `failures show` and read the incident's history, which records each operation ID. Decide again from what you see. For a redrive, evaluate again and approve the new plan with a new operation ID; reusing the old ID returns the recorded `unknown`.

A quarantine write whose acknowledgment was lost in the crash is written again when the record is redelivered, so the topic can hold duplicates.

### 6.8 Lost or damaged local state

The journal is the only record of incidents, decisions and recovery boundaries. The guarantees hold while the journal volume survives. They don't cover losing it, or restoring an unrelated old copy.

| Startup refusal (`details.reason`) | Meaning |
| --- | --- |
| `state-dir-missing`, `journal-missing` | The directory or `journal.sqlite` is gone |
| `journal-corrupt`, `journal-unreadable`, `not-a-journal` | The file fails its integrity check, or isn't a StreamOtter journal |
| `schema-newer` | A newer gateway build wrote it; see [§8](#8-upgrade-and-downgrade) |
| `project-mismatch` | It belongs to another project |
| `state-dir-insecure`, `journal-insecure`, `run-dir-insecure` | Permissions or ownership are wrong; see [Run in production](../DEPLOYMENT.md#the-state-directory) |
| `journal-locked` | Another gateway owns it, or left a lock on another host |
| `generation-changed-with-open-incidents`, `source-removed-with-open-incidents` | The configuration changed a source's `generation`, or removed a source, while it has open incidents. For a generation you changed on purpose, see [§6.10](#610-rebaseline-a-source) |
| `failure-handling-removed` | `failureHandling` was removed while the journal still holds open incidents or boundaries in force; see [§8](#8-upgrade-and-downgrade) |

The gateway never recreates, repairs or replaces a journal on its own. Don't run `init --failures` as a quick fix: an empty journal forgets every boundary, so snapshots would stop being asked to cover records that were skipped.

**Restore from a backup** when you have one. Back up the state directory with the gateway stopped (`journal.sqlite` and any `journal.sqlite-wal`; skip `run/` and `journal.lock`). A backup older than the latest changes can lack incidents and boundaries created since. The gateway holds a source whose position moved past a held record it knows about, but it can't detect a boundary it never saw. Check `status` after restoring and compare it with what you know happened.

**Start a new journal** only when there is no usable backup. If the journal is intact and an incident just can't be closed any other way, don't replace the journal: rebaseline the source with the journal you have ([§6.10](#610-rebaseline-a-source)). A new journal is a deliberate decision about application consistency, not a reset button:

1. Stop the gateway. Move the old journal files aside; don't delete them.
2. Write down, from the old journal if it can still be read and from your logs, every source that had a boundary in force or an open incident, and its positions.
3. For each, confirm that your authoritative store already reflects what those records carried, or repair it, and that your snapshots read it.
4. If a record that can never be processed is still in the topic, the new journal won't help: the gateway would stop on it again. Move the source's consumer group past it with Kafka's own tools while the gateway is stopped, as in [§6.10](#610-rebaseline-a-source) step 4. That is a skip you decide on, outside StreamOtter; it needs step 3's review like any other.
5. If you re-created topics or pointed a source at another cluster, change its `generation`.
6. Create a new journal with `streamotter init --failures`, start, and check `status`.

### 6.9 Two gateways, one state directory

A second gateway on the same state directory is refused: `journal-locked` for the journal, and `socket-in-use` for the operator socket if the first one serves it. Running two gateways for one project is unsupported anyway; stop the extra one.

### 6.10 Rebaseline a source

Some incidents can't be closed by a retry or a repair: source retention deleted the held record ([§6.4](#64-topic-retention-and-expired-evidence)), the record can never be processed (`tombstone`, `oversize`, bytes no mapping should accept), or you re-created the topic or moved the source to another cluster. The way out is a rebaseline: you declare that the source starts again from a new baseline, and StreamOtter records that decision. It is the only way an incident is closed without its record being processed or advanced past by policy, so it needs the same review as a new journal ([§6.8](#68-lost-or-damaged-local-state), steps 2 and 3).

1. **Record what you are leaving behind**, while the gateway still runs: `failures list --source <id>`, then `failures export --failure <fid>` for each open incident, give every incident, its position and its history.
2. **Stop the gateway.** `sources rebaseline` opens the journal itself and is refused (`journal-locked`, exit 1) while a gateway holds it.
3. **Check your authoritative store** covers what those records carried, or repair it, and that your snapshots read it.
4. **Move past the record, if it is still in the topic.** Reset the source's consumer group with Kafka's own tools, for example `kafka-consumer-groups.sh --bootstrap-server <broker> --group <consumerGroup> --topic <topic>:<partition> --reset-offsets --to-offset <offset + 1> --execute`. Skip this when retention already deleted the record, or when the source now reads a new topic or cluster.
5. **Change the source's `generation`** in `streamotter.json`. Starting now is refused with `generation-changed-with-open-incidents`, which is what you want: the old generation's incidents are still open.
6. **Run the rebaseline**, naming the source twice:

   ```bash
   streamotter sources rebaseline --config streamotter.json --state-dir /var/lib/streamotter \
     --source orders --reason "orders.status re-created after retention loss; store checked against outbox" --confirm orders
   ```

   It closes each open incident from an earlier generation as `resolved`, with resolution `rebaselined to generation <new>`, your reason and an operation ID in its history, and records the new generation, which retires that generation's recovery boundary. It exits 0 and prints what it closed. It refuses (exit 3, outcome `nothing-to-rebaseline`) when there is nothing from an earlier generation, and leaves incidents of the configured generation alone: those are still yours to retry or repair. Without `--confirm <sourceId>` it changes nothing.
7. **Start the gateway** and check `status`. The source runs from wherever its consumer group now points.

A rebaseline never moves a consumer group, never skips a record of the current generation, and never touches the quarantine topic.

## 7. Health checks

`streamotter start --health 127.0.0.1:7402` (or `health: { port: 7402 }`) serves two read-only probes on their own listener, bound to 127.0.0.1 by default:

- `GET /health/live` answers 200 `{ "status": "ok", "reasons": [] }` whenever the listener answers, including during a broker outage, so a supervisor won't restart-loop the gateway because Kafka is down.
- `GET /health/ready` answers 200 when the gateway can serve, otherwise 503 with reason categories: `starting`, `source-held`, `source-unavailable`, `journal`, `quarantine`.

The reasons map to the procedures above: `source-held` to [§6.5](#65-repair-a-poison-record) or [§6.4](#64-topic-retention-and-expired-evidence), `journal` to [§6.3](#63-full-disk-or-full-journal), `quarantine` to [§6.1](#61-credentials-and-acls) or [§6.2](#62-quarantine-topic-outage). A retained, resolved incident doesn't keep readiness false. Details are in [Run in production: health checks](../DEPLOYMENT.md#health-checks).

## 8. Upgrade and downgrade

**Upgrading.** A configuration without `failureHandling` behaves exactly as before: no journal, no producer, no new disk or Kafka permissions. `configVersion` stays `1`, and the browser protocol and SDK don't change. Existing handlers compile and run unchanged. To adopt V1.1 failure handling, follow [§2](#2-turn-it-on); start with `quarantine-hold`.

**An older gateway refuses a V1.1 configuration.** Releases without failure handling (`0.1.0-rc.3` and earlier) reject `failureHandling` as an unknown top-level key, and the CLI rejects the new flags. So a V1.1 configuration never runs silently without its policies.

**Downgrading is not automatically safe.** An incident or a recovery boundary is an obligation: a held record that must not be skipped, or a record already moved past that snapshots must keep covering. Settle them while failure handling is still configured, then remove it.

1. **Resolve every open incident**, with `failureHandling` still in place: repair and `retry-current` ([§6.5](#65-repair-a-poison-record)), until `failures list` shows nothing open.
2. **Retire every boundary in force** (`status` lists them per source). How depends on the source's `boundaryRetirement`:
   - `application`: snapshots that acknowledge it let your `retire` handler end it.
   - `operator`: `sources retire-boundary`, after you have verified the claim ([§4.3](#43-retiring-a-boundary)).
   - `generation` (the default): only a generation change ends it, and that is a rebaseline ([§6.10](#610-rebaseline-a-source)). If you don't intend one, switch the source to `"operator"`, restart, verify, and retire it by hand.

   The mode in the running configuration decides, not the mode the boundary was created under.
3. **Stop the gateway, remove `failureHandling`, and start it again.** If `--state-dir` still points at a journal with an open incident or a boundary in force for a configured source, startup refuses with `CONFIG_INVALID`, `details.reason: "failure-handling-removed"`, naming the sources (`openIncidentSources`, `boundarySources`). A journal with nothing outstanding is left untouched.
4. **Make snapshots return only `revision` and `data`** when no `recovery` is given. Written as in [§4.2](#42-acknowledge-the-boundary-in-every-snapshot), they already do. The V1 runtime rejects a snapshot with an extra `recoveryBoundaryId` field as `INVALID_PAYLOAD`.
5. **To go back to a V1 release** (`0.1.0-rc.3` or earlier), finish steps 1–4 first, then install the older version. It refuses any configuration that still contains `failureHandling` (`streamotter validate` prints `/failureHandling  UNKNOWN_KEY` and exits 2), rejects the new CLI flags, and never reads the journal. A gateway started without `--state-dir` can't see the journal either, so the startup check in step 3 only protects you while the state directory is passed.
6. **Keep the same consumer group and `generation`,** unless you are deliberately rebaselining. Renaming them is not a way around a held incident.
7. **Keep the journal and the quarantine topic.** They remain your evidence. A V1.1 build refuses a journal written by a newer build (`schema-newer`).

Scenario F48 in the [evidence matrix](../releases/v1.1/EVIDENCE.md) tracks the test of this procedure.

## 9. What is verified

Tested so far: fixture integration tests; a single local Kafka 4.1.2 broker, including SIGKILL crash tests around the advance and during a redrive; a local three-broker cluster where the quarantine leader, and then two of three brokers, were killed (acknowledged copies survived, and nothing advanced without one); Chromium browser tests of the Failures tab; packed-package install tests, including a crash and restart with the operator socket; and the downgrade refusal. Not yet: network partitions, disk loss or a managed Kafka service, a broker with ACLs enabled, Firefox and WebKit, and a crash during a downgrade. Details per scenario are in the [implementation status](../IMPLEMENTATION_STATUS.md#v11-source-failure-handling-unreleased) and the [evidence matrix](../releases/v1.1/EVIDENCE.md).
