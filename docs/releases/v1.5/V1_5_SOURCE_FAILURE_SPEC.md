# StreamOtter V1.5 — Contain, explain, recover

## Product and behavioral specification

**Prepared for:** Jason Fricano / StreamOtter  
**Date:** September 28, 2026 · revised September 29, 2026  
**Document revision:** 0.2: baseline checked against the code; ADR-15A/B/C proposed. Not yet approved.  
**Inspected baseline:** `jfricano/StreamOtter@7b406780dd52c921cf88a98834e81e1677fc4a8d`  
**Headline feature:** Native source-failure policies, durable quarantine, and controlled single-record reprocessing.  
**Companions:** `V1_5_ACCEPTANCE_PLAN.md`, `V1_5_IMPLEMENTATION_HANDOFF.md`, and [`adr/`](./adr/).

> A bad Kafka record should have an explicit fate, an inspectable explanation, and a safe recovery path. Neither putting it in quarantine nor advancing an offset establishes that a browser view is correct.

### Authority and evidence

This document proposes the V1.5 increment requested by the product owner. It does not claim implementation, executed tests, release approval, or changes to a repository. Once approved, its explicit additions refine V1 source-failure behavior; all other V1 contracts remain in force. The founding document retains mission authority, the roadmap retains sequencing authority, and public declarations must match the approved behavioral specification. Product milestone **V1.5 is not automatically package version 1.5.0 or protocol version 1.5**.

Repository facts are marked **Baseline** and linked to inspected sources. Requirements, defaults, interface sketches, and acceptance criteria below are **proposed design**, not existing APIs. The final Future Strategy research package remains advisory background; this specification supplements it rather than replacing it. Sources and review limits appear in §18.

### Revision 0.2: what changed after checking the code

Revision 0.1 was written from the repository's documents. Revision 0.2 checks its baseline claims against the source at the same commit (`7b40678`, which is still `main`). Every "Baseline" statement in §2 holds. The three ADRs change or pin down the following. Where an ADR departs from the 0.1 text, the ADR's decision is proposed and the text below is annotated, not silently rewritten.

| Topic | 0.1 text | 0.2 decision | Where |
| --- | --- | --- | --- |
| Where disposition work runs | Implied inside record processing | Every failure pauses through the existing V1 path first; quarantine and the guard run after the fetch loop returns; a new `advancePast` adapter call moves the offset | [ADR-15A](./adr/ADR-15A-failure-journal-and-handoff.md) §1 |
| Journal engine | "embedded SQLite, driver TBD" | Built-in `node:sqlite` (no new dependency), `better-sqlite3` as the fallback if it's still experimental on Node 24 | ADR-15A §2 |
| `failureId` | New versioned hash including cluster identity | Reuse V1 `sourceRecordId`; record the Kafka `clusterId` and refuse to advance on mismatch | ADR-15A §3 |
| Quarantine record format / 2 MiB envelope | Byte-safe envelope up to 2 MiB | Original key and value bytes verbatim, metadata in headers; the default broker limit (~1 MiB) can't hold a 2 MiB envelope, so startup checks the topic's `max.message.bytes` | ADR-15A §4, amends §13 |
| Failure classification | Policy per failure class | The code reports all of these as `INVALID_PAYLOAD`; add an internal `FailureClass` so integrity failures can't be quarantined and skipped | [ADR-15B](./adr/ADR-15B-recovery-barrier.md) §1 |
| Recovery guard and barrier | `sourceRecoveryRef` + snapshot acknowledgment | `handlers.sources[id].recover`; snapshot input `recovery`, output `recoveryBoundaryId`; additive types | ADR-15B §2–3 |
| Retiring a barrier | Not specified | **Owner decision:** operator retirement vs. generation change only | ADR-15B §4 |
| `operations` / `health` settings | Top-level project config | `GatewayOptions` and `streamotter start` flags; only `failureHandling` stays in project config | [ADR-15C](./adr/ADR-15C-operator-authority-and-redrive.md) §2, amends §9 |
| Operator caller identity | "local caller/session identity as available" | Node can't read peer credentials; the boundary is filesystem permissions plus a token | ADR-15C §3 |
| Redrive | Invalidate live epochs and resynchronize | Re-evaluate through the normal pipeline and admit at a record boundary; `admit` already filters older revisions | ADR-15C §5, amends §8.3 |

## 1. Outcome, user, and release boundary

The primary user remains a JavaScript/TypeScript application team already using Kafka to deliver current-state web views. The operational user is the engineer diagnosing a stalled source, not a business user asking to replay transactions. [P1]

**V1.5 outcome:** The engineer can identify a failing record, distinguish data defects from integrity or infrastructure failures, preserve permitted evidence, choose an allowed response, and verify separately what happened to source progress and application synchronization.

A representative journey is: a malformed order update pauses intake; the workbench identifies the failing stage; the configured policy saves the record to quarantine; an application recovery guard either permits snapshot-based continuation or keeps the source held; the engineer fixes the integration, evaluates the stored record, and deliberately retries or reprocesses it. The interface never replaces “unknown” with “fixed.”

### In scope

| Capability | V1.5 commitment |
| --- | --- |
| Failure policy | Per-source, closed-set policies; legacy pause default; bounded retry for explicitly transient mapper failures; quarantine-and-hold; guarded quarantine-and-resynchronize. |
| Quarantine | One first-class Kafka sink on the existing cluster; protected evidence; stable incident identity; durable write-before-offset rules; bounded local incident journal. |
| Reprocessing | Retry the currently blocked original position; dry-run one retained original record; explicitly approve gateway-local reprocessing of one already-skipped record. |
| Recovery correctness | Source-wide invalidation, application-backed recovery barriers, restart-safe handling, and normal authorization/revision checks. |
| Developer experience | Workbench failure view, actionable traces, redacted reproduction bundles, and local CLI operations. |
| Small operational improvements | Optional minimal production health checks; structured incident/status diagnostics; bounded shutdown/restart handling; targeted compatibility checks. |
| Packaging and documentation | Updated types and validator, installed-package tests, migration/runbook, and a version-pinned reference scenario. |

### Explicit exclusions

No silent `ignore`, automatic bulk replay, edited-payload publication, arbitrary Kafka-topic publishing, scheduled retry queues, business-side-effect execution, or general dead-letter processing service. No durable browser event history, SDK checkpoints, multi-gateway coordination, new browser transport, Schema Registry, team permissions, hosted service, or AI-driven remediation. Those capabilities retain their existing later-release boundaries. [P2]

V1.5 retains **one gateway per project, one configured Kafka cluster, JSON full-state channels, and Socket.IO over WebSocket**. A Kafka quarantine topic is failure evidence, not the V2 delivery store. Its existence creates no promise that missed browser events can be replayed.

## 2. Baseline and intentional changes

**Baseline:** Invalid JSON, unsupported tombstones, invalid mapped values/revisions, mapper errors, and revision conflicts currently pause the source without advancing the failing position. `resumeSource` retries the original uncommitted position. All source subscriptions are conservatively made stale. The adapter manually commits records, processes one partition batch at a time, and seeks back on pause. [P3, P4]

**Baseline:** V1 uses source generations and record coordinates for identity. Snapshots and events must describe the same revision progression. `live` means synchronization through a defined drain boundary while the source is healthy; it is not proof of wall-clock freshness. [P3]

**Baseline:** The internal adapter passes value bytes, a decoded key, and position, but not the full raw key/header/timestamp evidence required here. Extending that capture boundary is implementation work, not an already available feature. [P5]

**Intentional changes:** V1.5 introduces opt-in persistent failure handling, controlled record disposition, narrowly scoped local operations, and optional read-only health probes. It does not enable V1's development management interface in production. Existing configurations without these options retain their source-failure semantics and do not require writable storage, a quarantine topic, or an additional producer.

## 3. Non-negotiable invariants

**INV-01 — No implicit loss.** A record may advance under ordinary successful processing or an explicitly authorized quarantine disposition. Never treat logging, a timeout, or a failed quarantine write as successful handling.

**INV-02 — No false `live`.** Detection of a source-processing failure invalidates affected source epochs before any continuation. A quarantine acknowledgment, healthy Kafka heartbeat, subsequent valid event, or operator click cannot by itself restore a subscription to `live`.

**INV-03 — Fail closed on uncertainty.** Unknown classification, incomplete evidence, unavailable incident state, ambiguous progress, failed recovery assessment, or cancellation leaves the source held or unavailable. Integrity failures cannot be bypassed through the quarantine policy.

**INV-04 — Identity and monotonicity.** Stable source/incident identities survive retry. Domain revisions remain separate from offsets, incident IDs, and operator-operation IDs. Reprocessing never manufactures a newer domain revision or resets the original consumer group.

**INV-05 — Existing access rules apply.** Normal authentication, authorization, revocation, expiry, epoch checks, and tenant routing apply to all resumed and reprocessed state. Diagnostic access never grants application access, and application tokens never grant operator access.

**INV-06 — Bounded work.** Finite input, journal, topic-scan, retry, mapper, publication, preview, and operation budgets exist. Reaching a limit has a visible outcome; it does not silently drop evidence required for safe progress.

**INV-07 — Separate observations.** Captured, Kafka-acknowledged, source-advanced, handler-valid, admitted, SDK-received, and resynchronized are distinct facts. None means a human saw an update or a business transaction completed.

**INV-08 — No hidden dependency expansion.** Legacy state-only deployments stay disk/store-optional. Enabling durable quarantine explicitly adds Kafka write permissions and a persistent local failure journal, not an external database service.

## 4. Failure taxonomy and policy

Classification is performed by trusted runtime stages. Do not choose a policy by searching exception text, accepting an arbitrary error-code string from input, or collapsing every `INVALID_PAYLOAD` into a skippable event.

| Failure class | Default | Permitted opt-in treatment |
| --- | --- | --- |
| Invalid JSON in an otherwise bounded source record | Pause | Quarantine-and-hold; guarded quarantine-and-resynchronize. |
| Public mapped data violates its payload schema, after routing and revision validation | Pause | Quarantine-and-hold; guarded quarantine-and-resynchronize. |
| Mapper explicitly signals a transient dependency failure | Pause | Bounded retry of original record; exhaustion pauses. Evidence capture is allowed. |
| Arbitrary mapper exception or timeout | Pause | Quarantine evidence may be captured, but no automatic skipping. |
| Invalid tenant/parameters/revision, inconsistent equal revisions, excess mapping output, or partial admission detected | Pause | Evidence and repair only. No continuation override. |
| Unsupported tombstone, input too large, unknown decode format | Pause | Bounded metadata/evidence when possible; no automatic skipping in V1.5. |
| Broker/network/authentication failure, lost assignment, shutdown, journal/disk failure, quarantine unavailable | Existing outage/hold behavior | Bounded infrastructure recovery only; never classify the outage as a bad record to discard. |
| Authorization failure or slow browser | Existing V1 access/flow-control behavior | Not a source DLQ event. Preserve existing isolation and overload handling. |

### Policy vocabulary

`pause` retains the current V1 behavior. `quarantine-hold` preserves the permitted record and keeps its source position uncommitted. `quarantine-resync` permits offset advancement only after the durable and recovery requirements in §§6–7 succeed. **No `ignore`, `discard`, or `force-skip` option is provided.**

Policy is configured per source and per supported failure class. Unspecified classes pause. Arbitrary exception handlers and catch-all “quarantine every error” policies are rejected. This keeps a failing mapper deployment from silently excluding an entire stream.

A mapper opts into bounded automatic retry by throwing a new trusted `TransientMappingError`; data cannot construct this classification. Retry requires the integrator's explicit declaration that mapping is side-effect-free and safe to repeat. Two additional attempts are the proposed maximum, with cancellable waits of 250 ms and 1,000 ms and the normal per-attempt timeout. No later record in the source overtakes the retry. Maintain consumer heartbeats, and abandon stale assignments. Retry exhaustion holds; it does not fall through to automatic quarantine-and-advance.

A circuit breaker stops automatic quarantine-and-resynchronize after **five distinct incidents in a rolling 60-second window** per source. The sixth is captured if possible but held without offset advancement. This proposed default is adjustable within documented finite bounds; distinct incidents, not duplicate writes, count. Persist the breaker state for enabled durable-failure deployments. Reopening requires an explicit operator action after correction.

## 5. Evidence, identifiers, and storage

### 5.1 Two narrowly scoped stores

The Kafka quarantine topic stores protected record evidence. A local persistent incident journal stores decision state, write acknowledgments, recovery barriers, operation plans, and bounded audit metadata. The journal is not a delivery-history database, remote control plane, or browser checkpoint store.

**Reference design:** an embedded SQLite journal on a persistent local filesystem, with transactions and durability settings appropriate to process/OS restart. The implementation ADR must select and verify a Node-24-compatible driver, synchronization settings, migrations, locking, and restore behavior. Do not introduce a separately operated SQL service. A different embedded implementation is acceptable only with the same verified contract and no additional service dependency.

One gateway exclusively owns the journal. Startup refuses a competing owner or mismatched project/source identity. `init` explicitly creates its metadata; ordinary startup never silently replaces a missing, unreadable, corrupt, or incompatible journal. Quarantine-enabled container deployments require a mounted persistent volume.

The guarantee covers the declared Kafka durability configuration and restart with the journal volume intact. It does **not** cover losing that volume, restoring unrelated old state, arbitrary broker loss, or unauthorized group-offset edits. Such recovery requires an explicit rebaseline procedure and application-consistency review; do not auto-clear barriers after disaster recovery.

### 5.2 Incident envelope

| Field group | Required content |
| --- | --- |
| Identity | `envelopeVersion`, `projectId`, `sourceId`, source generation, stable source-record ID, stable `failureId`. |
| Original position | Cluster identity/generation, topic, partition, decimal offset; original timestamp where available. |
| Evidence | Original value bytes/null and key bytes/null; bounded headers as exposed by the client; completeness flags and content hash. Use byte-safe encoding, not lossy UTF-8 reserialization. |
| Diagnosis | Trusted failure class, processing stage, sanitized code, observation time, failed channel/version when known, and impact certainty. |
| Provenance | Configuration fingerprint, declared handler-build identity, policy revision, and gateway version. |
| Disposition | Separate quarantine-write, source-progress, and recovery states; evidence location and broker coordinates after acknowledgment. |

Derive `failureId` from a versioned hash of project, source, source generation, and original record coordinates. *(0.2: reuse V1 `sourceRecordId` with an `f1:` prefix; see ADR-15A §3.)* A repeated observation of that record is the same incident even if its error changes after a repair. Store observations separately. A conflicting content hash for the same original identity is an integrity failure, not a new harmless duplicate.

One source record can map to several channels. Prepare and validate **all** outputs before admitting any. Do not quarantine one output, deliver another, and call the record atomically handled. Unknown tenant/channel impact is displayed as **source-wide / unknown**, never guessed from untrusted bytes.

### 5.3 Retention and data protection

Full evidence capture is an explicit option because records may contain confidential data. The raw quarantine topic and any pending local raw spool are privileged, separate from browser channels. The deployment must protect both storage locations and backups; transport TLS alone does not encrypt stored payloads. Record the operator-selected at-rest encryption and backup-access controls rather than implying the product supplies encryption it has not implemented. Logs, default UI views, health responses, and ordinary exports contain metadata only. Raw display/download is deliberate and audited; render content as text, never executable markup. Credentials, handler source code, and resolved connection secrets are never attached to incidents.

The reference retention policy is seven days for raw evidence and thirty days for resolved incident/operation metadata. These are proposed defaults, not a guarantee that Kafka retains a record for exactly that period. Report effective topic retention and size limits; evidence can expire sooner or be unavailable. Unresolved decision records and cumulative recovery barriers must not be pruned merely because their raw evidence expires.

Topics are pre-provisioned by the operator. Disable automatic topic creation. The quarantine topic must not overlap any configured ingestion topic; there is no automatic quarantine-topic consumer feeding the application. Apply dedicated write/read ACLs. Topic replication and minimum in-sync replica settings must substantiate the declared deployment failure model. A single-broker development fixture is not evidence of broker-failure durability.

## 6. Quarantine and source-progress algorithm

The mandatory first implementation uses **acknowledged append followed by explicit source-offset commit**, with stable IDs and potentially duplicate quarantine records. It does not claim atomic Kafka transactions or exactly-once quarantine. KafkaJS supports transactional offsets, but adopting that alternate algorithm is separately deferred and must not be assumed to solve browser or application correctness. [T1–T3]

For one failing record:

1. Freeze processing for the whole source. Invalidate its subscription epochs, unsent frames, and in-flight snapshots before deciding disposition. Preserve independent sources and the operator interface.
2. Prepare a bounded, complete envelope. Persist the incident and its held recovery state in the journal. If persistence fails, leave the original position uncommitted and report an operational failure.
3. For a quarantine policy, publish the evidence to the allowlisted same-cluster topic using `acks=all`. Enforce a finite request deadline and bounded retry. A timeout is **unknown**, not successful quarantine. Do not advance on a local enqueue alone.
4. Record acknowledged quarantine coordinates durably. Before a held incident is later advanced, verify that complete evidence is still retained, or append and acknowledge a fresh copy of the original; an expired historical acknowledgment is insufficient. A crash or unknown response may produce duplicate envelopes; group them by stable `failureId`. If evidence cannot be saved completely, hold rather than substitute a truncated copy and advance.
5. For `quarantine-hold`, remain held. For `quarantine-resync`, invoke the recovery guard in §7. On denial, exception, missing configuration, or timeout, remain held. No other class may enter this path.
6. Persist the accepted cumulative recovery barrier and the intent to advance **before** committing the original offset. Recheck source assignment, generation, stop signal, policy/config identity, and incident revision after every awaited boundary.
7. Commit exactly the next offset after the blocked record, without skipping later positions. Record the result. If the commit outcome is uncertain, keep the source held and reconcile against the actual group position under the sole-owner assumption. Never continue while advertising certainty the adapter does not have.
8. Release intake only after successful reconciliation. Fresh snapshots must satisfy the recovery barrier; normal buffered-update draining and SDK receipt checks establish `live` independently for each subscription.

On restart, restore incident/barrier state before marking a source ready. A record redelivered after a quarantine write reuses its ID. A commit that succeeded before a crash must not erase the stored recovery requirement. Unexplained external offset movement, source recreation without a generation change, or missing required state blocks continuation. On recovery, verify that every held original position is still available; retention loss or an out-of-range group offset must not silently invoke `startFrom` and jump past the incident.

### Critical crash outcomes

| Failure boundary | Required outcome |
| --- | --- |
| Before evidence is journaled | No skip/commit; original remains retryable. |
| After journal capture, before Kafka acknowledgment | Resume bounded quarantine attempt or hold; original uncommitted. |
| Kafka accepted evidence but acknowledgment was lost | Quarantine may be duplicated; do not infer success or advance without a positive acknowledged retry. |
| After acknowledged quarantine, before offset commit | Original may repeat; same incident ID; normal recovery gate still required. |
| After source commit, before local completion bookkeeping | Durable barrier already exists; reconcile group progress; fresh snapshots still must satisfy it. |
| Rebalance or stop while a handler/write is pending | Late result cannot commit or restore `live`; a completed write may remain as duplicate evidence. |
| Journal missing/corrupt after replacement | Refuse quarantine-enabled startup; no empty-state fallback. |

## 7. Making continuation honest

### 7.1 Why another snapshot alone is insufficient

A malformed event may conceal both the entity and its revision. Fetching a lagging snapshot and labeling it current could silently lose the very change that was quarantined. Therefore **quarantine-and-resynchronize requires an additional application-owned recovery contract**, not just permission to skip.

The conservative unit of impact remains the entire source. Per-entity or per-partition isolation is deferred until reliable impact classification and routing evidence justify it.

### 7.2 Recovery guard and cumulative barrier

Configure a trusted `sourceRecovery` handler reference for each source using `quarantine-resync`. The guard receives the incident identity/evidence reference, source generation, current configuration, and prior cumulative recovery context. It returns either `hold` or an application-backed recoverable decision with a bounded opaque snapshot barrier and an evidence reference.

A recoverable decision attests that the source's authoritative snapshot system can supersede the excluded input for **every potentially affected current or future channel instance**, including deletions and audience-specific projections. It must preserve all previous unresolved barrier obligations when a second incident occurs. Typical evidence is an application database/CDC watermark or a verified decision that the record has no domain-state effect. A Kafka offset alone is not automatically such evidence.

If the application cannot establish that relation—for example because invalid bytes conceal the domain change and snapshots lag the source—the correct result is `hold`. An operator note saying “looks safe” is not a replacement for this contract.

The gateway assigns and durably stores a `recoveryBoundaryId` with the guard's cumulative context. Every later snapshot for that source receives the required boundary/context and must explicitly report that it satisfies that boundary. This applies after reconnection and to subscriptions created after the incident, not just those active at the time. A missing or mismatched acknowledgment cannot yield `live`.

The application remains responsible for the truth of its snapshot/barrier assertion, just as it already owns V1 snapshot/event consistency. StreamOtter validates identity, lifecycle, and declared coverage; it does not independently prove the database contents or infer unpublished changes.

### 7.3 No weaker hidden mode

The browser retains the existing subscription states and conservative public source-unavailable reason. Detailed incident information belongs to operators. No `live-with-unknown-gaps` state is introduced under the existing promise. Other sources can continue; affected subscriptions remain stale, synchronizing, or explicitly require recovery until their normal contract is met.

A quarantine episode is not cleared merely because the source heartbeat recovered. Repeated failures invalidate newly established boundaries as needed. State may eventually be healthy while an incident remains available for investigation; those are separate facts.

## 8. Controlled reprocessing, not a retry platform

### 8.1 Retry the currently blocked original record

`retry-current` retries the held, uncommitted record after repair. It does not skip it, rewrite it, rewind a group, or create a new Kafka record. Require the incident ID and expected revision to prevent a stale console action from resuming a different failure. Retain the existing `resumeSource` operation for compatible basic deployments; quarantine-aware tooling uses the guarded operation. For an enabled failure policy, even the legacy programmatic call must respect journal holds, circuit state, and recovery barriers; it is not a bypass.

A successful retry means ordinary processing and offset progress were verified. The resulting subscriptions still perform fresh authorized synchronization. If raw input is irreparably malformed, the integrator must repair authoritative state/publication or satisfy the guarded quarantine contract; a retry button cannot repair bytes in Kafka.

### 8.2 Evaluate one retained record

A dry-run loads exactly one original record from the configured quarantine evidence location and runs the current decode/map/schema/revision validation in a dedicated bounded evaluation path. It does not publish, advance offsets, send data, call production snapshot mutations, or change disposition. Trusted mapping functions must be side-effect-free; a dry-run cannot sandbox arbitrary application side effects by assertion.

The result reports current validation, possible routing identities as privileged metadata, which prior errors remain, and whether live reprocessing is eligible. It is **not** evidence that a browser received anything. Issue a short-lived plan containing incident/evidence hash, source generation, channel versions, configuration/handler-build fingerprints, and canonical mapped-output hash.

### 8.3 Single-record gateway-local redrive

*(0.2: ADR-15C §5 proposes a simpler mechanism for this section: re-evaluate and admit at a record boundary, without invalidating live epochs. Under review.)*

For an already-advanced quarantined record, an operator may approve the exact dry-run plan. V1.5 redrive means **re-evaluating the original bytes through StreamOtter's current mapping and state-delivery rules**, not publishing them back into the application's original Kafka topic. This avoids triggering unrelated consumer business effects or inserting an old event behind newer source records.

Require an unexpired plan, the same verified source generation, unchanged contract/build fingerprints, complete evidence, replay-safe handlers, and no unresolved source-integrity fault. Re-evaluate on execution; if mapped output changes, invalidate the plan. No editing of payloads or routing destinations is permitted in V1.5.

Serialize with the source at a record boundary; invalidate affected live epochs and register bounded capture for the fresh synchronization. Submit validated reprocessed full states through the normal revision/routing/authorization path, using original source identity and current compatible channel identity. Fresh authoritative snapshots, followed by the normal drain, determine the visible result. Never advance or rewind the ingestion consumer for this action, and never insert directly into client state or a diagnostic socket.

Old full states can legitimately be superseded by newer snapshots. Equal-revision conflicts still hard-stop; access remains current; account changes and late results cannot resurrect data. Record `reprocessed`, `superseded`, `failed`, or `unknown`, with admission/synchronization observations separately. Even `reprocessed` does not mean business completion or universal browser delivery.

Persist operation intent before action. The same completed operation ID returns its recorded result. If a crash leaves the action's result ambiguous, report `unknown` and require review/new approval; do not silently rerun it. The state contract tolerates repeats, but V1.5 does not promise exactly-once operator effects.

**Deliberately deferred:** bulk or scheduled redrive; edited records; destination selection; republishing to the original business topic; durable event replay. For malformed bytes that cannot be decoded, stored reprocessing will still fail; repairing and publishing a new authoritative event belongs to the application, not this tool.

## 9. Proposed configuration and API surfaces

The following is a **new configuration fragment**, not a runnable V1 configuration. *(0.2: `operations` and `health` move to gateway options and `start` flags, and `stateDirectory` moves with them; see ADR-15C §2.)* Source IDs and topic/profile references must resolve against the real project. Final TypeScript declarations and validator tests are the first implementation slice.

```json
{
  "failureHandling": {
    "stateDirectory": "/var/lib/streamotter/failures",
    "quarantine": {
      "topic": "orders.streamotter.quarantine",
      "capture": "full-record"
    },
    "sources": {
      "orders": {
        "invalidJson": "quarantine-hold",
        "invalidPublicPayload": "quarantine-hold",
        "transientMapperRetries": 0,
        "automaticAdvanceLimit": { "incidents": 5, "windowMs": 60000 }
      }
    }
  },
  "operations": { "socketPath": "/run/streamotter/operator.sock" },
  "health": { "host": "127.0.0.1", "port": 7402 }
}
```

Changing either eligible class to `quarantine-resync` additionally requires a named `sourceRecoveryRef` and the snapshot barrier contract. Transient retries or stored redrive additionally require `replaySafeMapping: true`; this is an application declaration, not a runtime proof. The quarantine producer uses the source's existing cluster profile; separate least-privilege credentials may be referenced, but cross-cluster writes are rejected. Unknown keys/actions and missing dependencies fail validation.

### Local operator API, exposed through the CLI

| Operation | Behavior |
| --- | --- |
| `failures list/show` | Bounded metadata queries with source/filter scope; raw evidence requires separate permission/explicit request. |
| `failures export` | Redacted reproduction bundle; original raw record only with explicit opt-in and protected output file. |
| `sources retry-current` | Guarded retry of the exact held incident; no skip. |
| `sources reassess` | Re-run the configured recovery guard for a held, eligible quarantined incident. Cannot override integrity failures. |
| `failures evaluate` | Dry-run retained original record and issue an expiring, fingerprinted plan. |
| `failures redrive` | Execute the exact reviewed gateway-local plan; no business-topic publishing. |
| `sources reopen-circuit` | Explicitly reset a stopped automatic-disposition circuit after repair; does not approve a record or bypass recovery. |
| `status` | Structured operational state, incident completeness, source progress, and active recovery requirements. |

Mutations require an expected incident revision and exact plan/confirmation fingerprint where relevant. No blanket `--force` or wildcard bulk mutation. CLI output supports JSON and clear human-readable results; exit status distinguishes validation/refusal, operational failure, and unresolved outcome. Structured result codes, not a bare exit 0, establish what happened.

## 10. Workbench: a failure console inside the existing workflow

Add a **Failures** view linked from source diagnostics and traces. List source, stage/class, incident ID, first/last observation, duplicate count if observed, selected policy, quarantine-write outcome, source disposition, and recovery state. Never expose guessed affected tenants or call a stored record “resolved” merely because it was archived.

The detail view explains: what failed; evidence availability; why it was held or eligible to continue; whether the position advanced; what snapshots must establish; and the next supported action. Integrity failures show a repair action, not an enabled skip control.

In development, the local management session can perform these operations against its own development gateway. In production, use the local CLI/in-process API. The workbench must not silently connect to production operator sockets or reuse application credentials. Production metadata exports can be inspected offline; raw display is opt-in.

The guided fixture exercises a valid update, a malformed record, quarantine-and-hold, a repair/retry or guarded continuation, an old redrive that is superseded, and a revision conflict that remains held. Show the connection state next to subscription state so a connected socket is never the success indicator.

A reproduction bundle contains version/config fingerprints, sanitized incident metadata, relevant trace stages, a synthetic reproducer where available, expected behavior, and the supported remedy. It excludes resolved secrets and production payloads by default. This implements the research plan's diagnostic-workflow emphasis without adding an AI console. [R1]

## 11. Small supporting improvements

### 11.1 Optional production health probes

Add a separate, read-only, loopback/private health listener. `GET /health/live` reports that the process can serve the probe; `GET /health/ready` reports readiness to accept useful subscriptions under the configured source requirements. Startup incomplete, required source held/unavailable, unreconciled offset outcome, journal failure, or required quarantine publication failure makes readiness false. A retained historical incident does not keep readiness false after safe recovery.

Use 200/503, minimal reason categories, and no raw topic names, incident payloads, credentials, or browser-accessible CORS. Readiness is not a freshness certificate. A broker outage must not turn liveness false solely to induce a restart loop. Detailed source diagnostics remain local operator data. This is not the existing development management server. [P6]

### 11.2 Better source diagnostics and recovery instructions

Add structured lifecycle events for detected, retrying, captured, quarantine-unknown, quarantined, held, advance-pending, advance-confirmed, snapshot-recovery-required, and operator outcomes. Existing public browser reasons stay conservative. Default logs retain redacted metadata only; explain unavailable evidence instead of returning an empty successful result.

Runbooks must cover credentials/ACLs, quarantine outage, full disk/journal, topic retention, poison repair, stale plans, process restart after a crash, and loss of local state. Heartbeat/watchdog logic must distinguish intentional bounded processing from a dead consumer without masking a real outage.

### 11.3 Targeted compatibility and packaging

Exercise the failure/recovery view in Chromium, Firefox, and WebKit; keep existing untested combinations labeled unverified until they pass. Test a same-origin production proxy, loopback/local operator boundary, exact published package installation, generated code, cleanup, and shutdown. Do not add framework bindings or new broker services to V1.5 merely to enlarge a support table.

## 12. Security and operator boundary

No production development workbench, public remediation HTTP endpoint, public source-offset reset, or application-accessible raw quarantine channel is introduced. The production operator transport is opt-in **local IPC**: a Unix-domain socket for the initially supported macOS/Linux hosts, in a protected directory. Use restrictive directory/socket/token permissions, ownership checks, bounded message size/rate, and a per-start secret stored in an owner-readable file. Do not pass credentials as URL query strings or expose the socket through the browser reverse proxy. A Node in-process API may share the same service implementation.

V1.5 has one trusted local operator boundary, not V3 roles or multi-user governance. Local machine administrators remain trusted. Each mutation records operation ID, time, local caller/session identity as available, incident revision, fingerprints, reason, and observed result. This is an operational audit trail, not tamper-proof compliance logging.

The journal and its tokens must be excluded from Git and generated bundles. Failures to meet filesystem protection or source-identity checks refuse startup. File exports default to restrictive permissions, do not overwrite silently, and clearly mark raw evidence. Raw-record content is untrusted data throughout; it cannot specify actions, executable handlers, topics, or configuration changes.

## 13. Limits and resource behavior

Proposed defaults below must be validated against the selected implementation, not published as capacity claims.

| Budget | Proposed default / rule |
| --- | --- |
| Raw value eligible for complete quarantine | At most the existing 1 MiB source-record budget. Oversize records hold. |
| Additional captured key/headers | 64 KiB combined; excess holds without automatic advance. |
| Serialized quarantine envelope | *(0.2)* Original bytes verbatim plus ≤ 80 KiB of headers; startup requires the topic's `max.message.bytes` ≥ `maxSourceRecordBytes` + 80 KiB. Never truncate to make a skip succeed. |
| Quarantine requests | One in flight per source; 10-second attempt deadline, at most two additional attempts; heartbeats continue. |
| Transient mapper retry | Zero by default; opt-in maximum two additional attempts. |
| Recovery guard | 10 seconds; at most one active per source; bounded context of 16 KiB. |
| Automatic continuation circuit | Five distinct incidents per source per rolling 60 seconds; next holds. |
| Failure journal | 256 MiB total; 16 MiB maximum raw pending spool; preserve unresolved control state. Full means hold/refuse mutations, not silent eviction. |
| Evidence page | 50 incidents default, 200 maximum; scans bounded by bytes, records, and time. |
| Stored evaluation/redrive | One operation per source; preview plan expires after five minutes. |
| Operator request | 64 KiB metadata input; no arbitrary payload edit/upload endpoint. |

Journal pruning may remove expired resolved metadata and raw spool already safely captured, but never a source's required cumulative barrier or an unresolved progress decision. Kafka evidence availability is checked when requested; expiration yields a named unavailable/expired outcome. Rate-limited diagnostics can aggregate repeated observations without concealing skipped positions or failed writes. If a bound prevents retaining necessary safety state, pause and explain why.

A requested raw record must be available as complete bytes; a metadata-only placeholder is not eligible for stored redrive. Separate failure-policy, Kafka client, and browser synchronization retries so they cannot multiply into an unbounded retry tree.

## 14. Compatibility and versioning

Legacy configuration remains valid and means pause-on-source-failure. New configuration fields are accepted only by the new runtime; older versions must reject them rather than silently ignore policy. Keep `configVersion: 1` only if the new validator/declarations can express the additive shape clearly; any required schema migration must be documented before merge. The browser protocol and existing state-channel meanings do not change for this increment.

Keep `resumeSource` semantics: retry, never skip. Operator-aware APIs add guarded alternatives instead of repurposing that method. New operator/error vocabulary must not leak into old clients as undocumented public guarantees. SDK receipts remain V1 synchronous-dispatch receipts; no after-handler checkpoint promise is added.

Downgrading a quarantine-enabled deployment is **not automatically safe**. Stop, reconcile held/advanced positions and recovery barriers, preserve evidence, and establish that the old snapshot path can satisfy consistency before disabling new configuration. Keep the same consumer group and source generation unless an intentional rebaseline procedure requires otherwise; changing names is not a shortcut around a held incident.

## 15. Definition of done

V1.5 is a release candidate only when all mandatory scenario families in the acceptance plan have reproducible evidence or an explicitly approved scope change. In particular: legacy behavior passes; quarantine never advances before required evidence/barrier durability; false `live` is prevented across recovery/restart; policy cannot bypass integrity failures; redrive cannot publish business commands, rewind groups, or regress state; protected operations remain private; resource ceilings and retention failures are visible; and packaged artifacts work without the development workbench.

The evidence manifest names code and package versions, environment, broker/topic settings, journal durability settings, workload, fault seed, commands, expected/observed behavior, and reviewer. Include crash tests against real Kafka, a persistent volume restart, and a replicated-broker case before claiming tolerance of broker failure. A development-only single-broker pass must be labeled accordingly.

Use an expected-results ledger independent of the production mapper and state machine. Preserve failed runs. Passing tests supports only the tested operating envelope; neither this specification nor an agent's review is a completed security audit.

## 16. Implementation slices and bounded design decisions

| Slice | Deliverable and exit |
| --- | --- |
| A — Contract and threat model | New config/types, taxonomy, guard/barrier contract, journal crash model, and test IDs. No public behavior change until the contract is settled. |
| B — Containment and quarantine-hold | Byte-preserving adapter input, complete output staging, stable incidents, protected journal/topic writer, legacy/default tests, and write-failure/crash evidence. |
| C — Guarded continuation | Cumulative barrier persistence, snapshot acknowledgment, exact offset reconciliation, circuit breaker, restart/late-result tests. |
| D — Operator workflow | Local IPC/in-process service, CLI, protected development Failures view, dry-run and single-record reprocessing, redacted exports. |
| E — Operations and release | Health probes, diagnostics/runbooks, browser/proxy/package tests, reference scenario, independent verification, migration and release notes. |

Quarantine-hold may be merged and demonstrated before guarded continuation, but do not call V1.5 complete while its required continuation and controlled reprocessing paths remain unverified. A safety blocker narrows or defers the affected capability only through an explicit product decision.

Resolve three ADRs early: **failure journal and acknowledged handoff**, **application recovery barrier and conservative impact scope**, and **local operator authority and redrive meaning**. These are implementation decisions inside this proposal, not a request to build alternative platforms. Escalate only material changes to guarantees, new external services, public privileges, scope, or release sequencing.

## 17. Roadmap integration

Insert **V1.5 — Contain, explain, recover** after the existing V1 launch/polish gate and before V2.0, unless the owner explicitly changes launch priority. This draft does not establish whether Lontra Creek's separate launch gate has since completed. Link the specification rather than copying it into multiple roadmap documents.

The V1.5 increment absorbs the already proposed bounded operational-hardening work and adds native source-failure policies. It supports final research packets **R03** (application consistency), **R04** (single-gateway operations), and **R10** (workflow/diagnostics), while contributing failure-boundary evidence to **R05** without implementing the V2 delivery store. [R1]

V2.0 remains retained event channels/history/cursors/checkpoints; V2.1 remains coordinated gateways; V2.2 remains schemas/hooks/generated contracts. V3 commands, shared operations, and transport extensions remain separate. The V1.5 local incident journal must not silently become their architecture or an excuse to ship their APIs early.

**Release description to use after verification:** “StreamOtter now gives source failures explicit policies, protected quarantine evidence, and controlled recovery—without treating a skipped record as proof of a synchronized application.” Avoid “zero data loss,” “exactly-once recovery,” “safe to ignore bad records,” or a claim that every failure can be isolated automatically.

## 18. Sources and review limits

Project documents and selected adapter code were read at the baseline commit above on September 28, 2026. No code was changed and no test suite was executed for this specification. Kafka-Penguin is an architectural inspiration, not a dependency; its README documents FailFast, Ignore, and Dead Letter Queue strategies and creation of KafkaJS client objects. [P7] V1.5 instead keeps ownership of StreamOtter's existing source/offset/state boundary.

- **P1 — Founding direction:** [StreamOtter founding document](https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/FOUNDING.md).
- **P2 — Roadmap:** [Product versions and API roadmap](https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/API_AND_FEATURE_ROADMAP.md).
- **P3 — Current behavior:** [V1 API](https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/V1_API.md).
- **P4 — Adapter inspection:** [Kafka source adapter](https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/packages/gateway/src/sources/kafka.ts).
- **P5 — Capture boundary:** [Source adapter types](https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/packages/gateway/src/sources/types.ts).
- **P6 — Current operational boundary:** [Deployment guide](https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/DEPLOYMENT.md).
- **P7 — Inspiration:** [Kafka-Penguin README](https://github.com/oslabs-beta/kafka-penguin). Moving branch; reviewed as a description, not executed or audited.
- **R1 — Prior final research package:** `StreamOtter_Future_Strategy_Package.zip`, especially `RESEARCH_EXECUTION_PLAN.md` and `RESEARCH_HANDOFF.md`, dated September 28, 2026. This is the final 14-packet package, not the earlier interrupted 15-item backlog.
- **T1 — KafkaJS consumption:** [Manual offsets, pause/seek, heartbeats, and batch validity](https://kafka.js.org/docs/consuming). These APIs support the implementation; they do not independently guarantee StreamOtter's policy.
- **T2 — KafkaJS producing:** [Producer acknowledgments and configuration](https://kafka.js.org/docs/producing). An acknowledged write and an idempotent producer setting must not be described as end-to-end exactly-once processing.
- **T3 — KafkaJS transactions:** [Transactional production and offsets](https://kafka.js.org/docs/transactions). A possible later handoff optimization, not the selected V1.5 algorithm.
- **T4 — Apache Kafka topic configuration:** [Kafka 4.1 topic settings](https://kafka.apache.org/41/configuration/topic-configs/). Durability and retention depend on the supported topic/broker configuration; recheck versions at implementation.

The selected sources substantiate baseline behavior and implementation primitives. The failure journal, recovery guard, policies, defaults, operator interfaces, and acceptance gates are original proposed design decisions in this document. They must be implemented and tested before being advertised as capabilities.
