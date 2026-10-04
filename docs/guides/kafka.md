# Connect to Kafka

This guide replaces a fixture source with a Kafka topic, covers TLS and SASL, and explains how StreamOtter tracks progress, and what happens when a record is bad or the gateway restarts. It also covers the quarantine topic for V1.1's opt-in failure policies.

StreamOtter uses KafkaJS 2.2.4 internally. It is verified against **Apache Kafka 4.1.2** (see the [support matrix](#what-is-verified)); other broker versions and managed Kafka services are unverified.

## What your topic needs to look like

StreamOtter delivers *state*, not an event log. Each record is the full new state of one entity:

- **JSON values** (`"codec": "json"`). The `map` handler receives the decoded value as `record.value`, and the key as a UTF-8 string (`record.key`).
- **Keyed by entity.** Changes to one channel instance must arrive in order, so give every change to an entity the same key: one entity, one partition.
- **A revision on every change.** The revision is a decimal string (`"1"`, `"42"`, up to 39 digits) that increases with each change and never resets, not even when the entity is deleted and recreated. A version column that you increment in the same transaction as the change works well.
- **No tombstones.** A record with a null value has no meaning in V1: represent deletion as explicit state (for example `"status": "deleted"`). A tombstone pauses the source like any other invalid record.
- **Every change reaches the topic.** Your `snapshot` handler reads your database, and the gateway fills the gap from the topic, so a change that was committed but never published would be missed. Publish through a transactional outbox, or the equivalent, so that database and topic can't disagree.

An example value:

```json
{ "accountId": "acme", "version": 7, "order": { "orderId": "ord_1001", "status": "processing", "progress": 40 } }
```

## Configure the source

```json
{
  "connections": {
    "cluster": {
      "brokers": ["kafka-1.example.com:9093", "kafka-2.example.com:9093"],
      "tls": { "caFile": "certs/ca.pem" },
      "sasl": { "mechanism": "scram-sha-512", "username": { "env": "KAFKA_USERNAME" }, "password": { "env": "KAFKA_PASSWORD" } }
    }
  },
  "sources": {
    "orders": {
      "kind": "kafka",
      "generation": "orders-1",
      "connectionRef": "cluster",
      "topics": ["orders.status"],
      "consumerGroup": "orders-app-streamotter",
      "codec": "json",
      "startFrom": "latest"
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `brokers` | Bootstrap brokers of one cluster. V1 allows only one connection profile across the active sources. |
| `tls` | `{ "caFile": "…" }` trusts that CA; the path is relative to `streamotter.json`. `{}` uses the system trust store: implemented, but not verified. `false` is plaintext, which only `streamotter dev` accepts. |
| `sasl` | Optional. `plain`, `scram-sha-256`, or `scram-sha-512`. `username` and `password` name environment variables, never literal values. |
| `generation` | Any identifier. Change it when you recreate the topics or point the source at a different cluster; it is part of every record's identity. |
| `consumerGroup` | Used only by this source of this gateway. Never share it with another application or with a second gateway. |
| `startFrom` | Where a **new** consumer group starts: `latest` (only new records) or `earliest` (the whole topic). With `latest`, the gateway commits the start position as soon as it joins, so a restart before the first record is processed doesn't skip records produced in between. Once the group has committed offsets, it always resumes from them. If a committed offset has fallen outside the topic's retained range (retention deleted it), Kafka resets the group to the `startFrom` position, so records can be skipped or read again; the gateway logs a warning when that happens. |

Missing environment variables or an unreadable CA file stop startup with a clear message and never print the values. Credentials never appear in exports, logs, or traces.

Then point your channel at the source (`"source": "orders"`) and write a `map` handler that turns a record into the channel's state. See [Add live state to an existing app](./existing-app.md#5-write-the-handlers).

## Progress and commits

The gateway commits a record's offset only after it has fully processed it: validated, mapped, and admitted to (or explicitly invalidated for) every interested subscription. A record that no subscription cares about, or that `map` filters out with `[]`, is committed too. A commit never means that a browser received the data, and source progress never waits for browsers. A slow client is disconnected rather than allowed to hold up the topic.

## When a record is bad

Invalid JSON, a tombstone, a record over `limits.maxSourceRecordBytes` (1 MiB by default), a `map` handler that throws or returns invalid data, and a conflicting duplicate revision all **pause the source at that record**. Nothing at or after it is committed, and nothing is skipped. Every subscription on the source goes `stale`, and the gateway logs a diagnostic without the payload.

To recover, fix the cause (usually your `map` handler: correct it, or have it return `[]` for records it should ignore), then retry the same record:

- in development, press **Resume** in the workbench's Connect tab;
- from code, call `gateway.resumeSource("orders")`;
- with `streamotter start`, deploy the fix and restart the gateway. It resumes from the last committed offset, which is the paused record.

That is the default. V1.1 adds opt-in failure policies: every bad record becomes a durable incident, and for invalid JSON and payload-schema failures the original record can be copied to a quarantine topic, then held, or moved past only when your application's recovery guard approves. Nothing is ever skipped silently. See [Handle bad records](./source-failures.md).

## The quarantine topic (V1.1)

Only needed when a Kafka source uses `quarantine-hold` or `quarantine-resync`. The gateway writes the original key, value and headers there, byte for byte (original headers get a `src.` prefix), with the incident's metadata in a `streamotter-envelope` header and its ID in `streamotter-failure-id`.

**Create it before you start the gateway.** The gateway never creates topics, and it refuses to start if the topic is missing.

```bash
kafka-topics.sh --bootstrap-server kafka-1.example.com:9093 --command-config admin.properties --create \
  --topic orders-app.streamotter.quarantine --partitions 1 --replication-factor 3 \
  --config max.message.bytes=1130496 --config min.insync.replicas=2 --config retention.ms=604800000
```

- **`max.message.bytes` must be at least `limits.maxSourceRecordBytes` plus 80 KiB** (81,920 bytes), so the largest record the gateway accepts fits with its headers. With the default 1 MiB limit that's 1,130,496 bytes, more than Kafka's default of 1,048,588. Startup reads the setting and refuses a smaller one. If you raise `maxSourceRecordBytes`, raise this too.
- **One cluster.** It must be on the cluster of the quarantining sources, and those sources must share one connection profile. Writes and reads use that profile's credentials.
- **Not a source topic.** Validation refuses a quarantine topic that is also a configured source topic. Nothing consumes it automatically.
- **Replication is yours to choose.** Writes use an idempotent producer with `acks=all`, so `min.insync.replicas` and the replication factor decide what survives a broker failure. `streamotter status` reports both. Broker-failure behavior has only been tested against a single broker so far, so these settings are not a StreamOtter guarantee.
- **Retention decides how long evidence can be read back** for `evaluate` and `redrive`. Seven days is a reasonable start. Expired evidence is reported as expired; it never clears a recovery requirement. See [the runbook](./source-failures.md#64-topic-retention-and-expired-evidence).
- **Protect it like the source data.** It holds full records. Give read access to operators only.

**ACLs.** In addition to its source permissions, the gateway's principal needs Describe, DescribeConfigs, Write and Read on the quarantine topic, and Read and Delete on consumer groups with the prefix `streamotter-<projectId>-quarantine-read-`, which evidence read-back uses as throwaway groups that never commit. The full table and an example are in the [runbook](./source-failures.md#61-credentials-and-acls); ACL-enabled brokers are not tested yet.

**Source retention matters too.** A held record is never committed, so set the source topics' retention well above how long a hold may last. If retention deletes a held record, the gateway holds the source rather than jumping past it.

**A changed cluster is an integrity failure.** Each incident records the Kafka cluster ID it was captured on. If the source's connection profile now reaches another cluster, or the startup check can't read the cluster ID, the same position may name a different record, so the incident holds: it is never quarantined or advanced, and no record of that source can be redriven until it is resolved. If the source really moved, change its `generation` and rebaseline; see [the runbook](./source-failures.md#64-topic-retention-and-expired-evidence).

## Restarts and crashes

On a restart, clients reconnect by themselves and resynchronize from fresh snapshots. Records that were processed but not yet committed when a gateway crashed are processed again, and revisions make that harmless: an update no newer than what a view already shows is discarded.

After a **crash** (not a graceful stop), Kafka keeps the dead gateway in the consumer group until its 30-second session expires. A replacement started right away has to wait for that inside its own 30-second startup deadline, so its first start can fail (exit code 1, with source diagnostics). Starting again succeeds once the old session has expired. Run the gateway under a supervisor that restarts it after a short delay; see [Run in production](../DEPLOYMENT.md).

## Diagnose connection problems

`streamotter dev` shows staged checks in the workbench's Connect tab. When startup fails, both `dev` and `start` print the same stages:

```text
Source "orders" diagnostics:
  ✓ resolve      …
  ✓ connect      …
  ✗ tls          The TLS handshake failed (…). Check the CA file and that the listener uses TLS.
  - authenticate …
```

| Failing stage | Usual cause |
| --- | --- |
| `resolve` | A broker host name doesn't resolve |
| `connect` | Wrong port, a firewall, or the broker is down |
| `tls` | Wrong CA file, or a plaintext listener behind a TLS configuration |
| `authenticate` | Wrong SASL mechanism, username, or password |
| `metadata` | The topic doesn't exist, or the user may not read it |

## What is verified

KafkaJS 2.2.4 against Apache Kafka 4.1.2 (single-node KRaft), from the [implementation status](../IMPLEMENTATION_STATUS.md#kafka-support-matrix-kafkajs-224--apache-kafka-412):

| Mode | Status |
| --- | --- |
| Plaintext (development only; `start` refuses it) | Verified |
| TLS with a supplied CA | Verified |
| TLS + SASL PLAIN, SCRAM-SHA-256, SCRAM-SHA-512 | Verified |
| TLS with the system trust store (`"tls": {}`) | Implemented, not verified |
| Wrong password, untrusted CA, missing topic | Verified to fail at the right stage without leaking credentials |
| Other Kafka versions and managed services | Unverified |

Also verified against real Kafka: explicit per-record commits, poison records pausing without skipping, redelivery after a crash without the displayed state going backwards, rebalances and broker outages marking views `stale` and resynchronizing, and `startFrom` for new groups.

V1.1 failure handling (unreleased), against the same single local broker: byte-exact quarantine of binary keys, invalid UTF-8 and repeated headers; refusal of a missing or undersized quarantine topic; holding a source for 35 seconds without losing group membership; holding when the group position moves past a held record; advancing past a record with the commit confirmed by reading it back, including a gateway killed on either side of the commit; and reading evidence back byte for byte. On a local three-broker cluster (F47): acknowledged quarantine copies survived the leader's SIGKILL, and writes were refused, with the source held, while two of three brokers were down. Not yet tested: ACL-enabled brokers, network partitions, and managed services. See the [implementation status](../IMPLEMENTATION_STATUS.md#v11-source-failure-handling-unreleased).

## A local broker

Any Apache Kafka broker works for development. The StreamOtter repository's test setup (`pnpm kafka:setup && pnpm kafka:start`, described in [CONTRIBUTING.md](../../CONTRIBUTING.md)) runs Kafka 4.1.2 with plaintext, TLS, and SASL listeners and a throwaway CA. It's intended for working on StreamOtter itself, but it is also a convenient way to try a Kafka source.
