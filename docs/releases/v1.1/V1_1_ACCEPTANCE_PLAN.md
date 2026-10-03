# StreamOtter V1.1 — Acceptance and fault-injection plan

**Date:** September 28, 2026\
**Status:** Proposed tests; no run is represented as completed.\
**Governing document:** `V1_1_SOURCE_FAILURE_SPEC.md`, approved revision 1.0 plus the October 1 owner amendment and ADR-15A/B/C.\
**Baseline inspected:** `7b406780dd52c921cf88a98834e81e1677fc4a8d`.

**Owner amendment — October 1, 2026; reconciled October 2:** The next planned increment is **V1.1**, renamed from V1.5. The approved revision 1.0 source-failure specification and September 29 decisions remain in force. ADR-15A/B/C keep their stable decision IDs. This milestone label does not change npm or protocol versions. Lontra Creek separately owns replacing its existing `/workbench/` tour with the actual workbench UI in an isolated synthetic visitor sandbox; no new page is added.

## 1. Verification method

Reuse existing V1 contract, source-failure, synchronization, access, CLI, browser, deployment, and installed-package tests. The cases below identify required **scenario families**, not a claim about the final test count. Each family may need several tests. Keep fixture tests, real-Kafka tests, filesystem/process-crash tests, and browser checks separate in the result manifest.

Use an independent expected-results ledger containing original source records, authoritative domain writes, expected authorized projections, quarantine incidents, intended offset transitions, and required recovery boundaries. Do not use the production mapper or recovery guard to generate the expected answer. Deliberately include an application guard that incorrectly echoes a boundary: document that the runtime cannot prove the domain assertion even though lifecycle tests can detect missing or mismatched acknowledgment.

At each awaited boundary, inject process death, response loss, cancellation, or rebalance as appropriate. Assert source offsets, durable journal contents, Kafka evidence, SDK states and revisions, and operational result codes—not just a final screenshot. A correctly converged final view does not excuse unauthorized intermediate output or a false `live` state.

## 2. Required scenario families

| ID | Scenario | Required result | Primary invariants |
| --- | --- | --- | --- |
| F01 | Existing V1 configuration with no new feature enabled | Same pause/resume and subscription contracts; no journal or quarantine producer required. | INV-08 |
| F02 | Unknown action, catch-all skip, integrity-class continuation, missing guard, or destination overlap | Configuration is rejected; no partial startup or implicit fallback. | INV-01,03 |
| F03 | Invalid JSON under default pause | Original offset remains uncommitted; source-wide stale; no later source record overtakes it. | INV-01,02 |
| F04 | Invalid mapped public payload with valid routing/revision | Eligibility is classified specifically; all outputs are staged before any admission. | INV-01,03 |
| F05 | Multi-channel record where one output fails validation | No valid-looking subset is delivered as if the entire record succeeded; source-wide impact recorded. | INV-02,05 |
| F06 | Invalid tenant, parameters, revision, output count, or conflicting equal revision | Hard hold, even when another class is configured for quarantine-resync. | INV-03,04,05 |
| F07 | Typed transient mapper failure succeeds after retry | Finite waits/attempts; heartbeats; original position retained until success; no overtaking. | INV-01,06 |
| F08 | Arbitrary mapper exception/timeout or transient retry exhausted | Hold without automatic skip; no nested unbounded retry multiplication. | INV-03,06 |
| F09 | Broker outage, token denial, or stalled browser | Correct existing outage/access/flow behavior; not misclassified as quarantine-eligible input. | INV-02,05 |
| F10 | Byte-preserving capture with binary key, invalid UTF-8 value, null value, timestamp, duplicate header values | Evidence preserves supplied bytes/metadata or explicitly fails completeness; no lossy reconstruction. | INV-01,04 |
| F11 | Source record, header, envelope, or local spool exceeds budget | Hold; never truncate and advance or overflow unboundedly. | INV-01,06 |
| F12 | Journal persistence fails before quarantine | No advancing commit or false quarantine success; visible disk/journal error. | INV-01,03 |
| F13 | Missing topic, denied ACL, oversized broker message, or unavailable quarantine broker | Bounded failure and hold; no silent topic creation or discard. | INV-01,06 |
| F14 | Quarantine accepted but acknowledgment lost | Mark unknown; positive retry acknowledgment needed; duplicates share stable incident identity. | INV-01,04,07 |
| F15 | Crash after evidence acknowledgment, before original commit | Original can repeat; same incident ID; no record loss or double “new incident” count. | INV-01,04 |
| F16 | Crash after prepared recovery barrier, before source commit | Restart preserves barrier and verifies actual group position before proceeding. | INV-01,02,03 |
| F17 | Commit succeeded but response/local final write lost | Journal intent/barrier survives; reconcile actual progress; never infer a missing barrier. | INV-01,02,07 |
| F18 | Stop, rebalance, or stale batch during write/guard/commit preparation | Late result cannot advance stale ownership or restore an old epoch; evidence may remain duplicated. | INV-02,03 |
| F19 | Quarantine-hold followed by guarded retry-current | Exact held record retried; no skip or new Kafka publication; normal resynchronization afterward. | INV-01,04 |
| F20 | Missing, denied, throwing, timed-out, or invalid recovery guard | Eligible record remains held; simple snapshot availability is insufficient. | INV-02,03 |
| F21 | Guarded continuation with authoritative snapshot coverage | Journal barrier precedes exact offset advance; snapshots acknowledge current boundary; drain precedes `live`. | INV-01,02 |
| F22 | Lagging snapshot returns no/wrong coverage boundary | No false `live`; explicit failure/recovery requirement; source heartbeat cannot bypass it. | INV-02 |
| F23 | New subscription/account reconnect after prior skip and gateway restart | Required persistent source barrier is passed to all applicable future snapshots; correct current access. | INV-02,05 |
| F24 | Two incidents affect different unknown entities/audiences | Cumulative guard context retains prior obligations; second incident cannot erase first. | INV-02,03 |
| F25 | Snapshot/mapper/guard completes after epoch change, revoke, stop, or new incident | Late output ignored; no unauthorized or old-epoch state restored. | INV-02,05 |
| F26 | Five distinct automatic advances, sixth within window; duplicate write storm | Sixth holds; duplicate envelopes do not inflate distinct incident count; breaker survives restart. | INV-03,06 |
| F27 | Held source record expired or group offset is out of range | Explicit source-evidence/progress error; no automatic jump to latest/earliest past the hold. | INV-01,03 |
| F28 | Raw quarantine expired before a later advance or evaluation | Read reports expiry; new skip needs renewed complete evidence; stored redrive refuses missing bytes. | INV-01,03,07 |
| F29 | Journal missing/corrupt/incompatible, wrong source generation, topic recreated | Startup/recovery refuses unsafe continuation; requires reviewed rebaseline, not automatic initialization. | INV-03,04 |
| F30 | Second gateway opens same journal; external group position moved | Exclusive-owner enforcement where observable; unrecognized movement holds; no claim of distributed safety. | INV-03,08 |
| F31 | Evaluate a retained original | No source commit/seek, Kafka publication, or browser delivery; fingerprints/output hash captured. | INV-01,07 |
| F32 | Expired plan, changed config/build/evidence/revision, or changed mapped output | Mutation refused; new evaluation/approval required. | INV-03,04 |
| F33 | Approved gateway-local reprocessing of one already-skipped valid record | Normal preparation, authorization, and revision-filtered admission at a record boundary (ADR-15C §5); no forced live-epoch invalidation, business-topic publication, or offset movement. | INV-04,05,07 |
| F34 | Reprocessed full state is older/equal to current snapshot | Superseded/duplicate outcome; no regression or fabricated revision; equal-data conflict hard-holds. | INV-02,04 |
| F35 | Redrive loses response or crashes during application admission | Recorded unknown/incomplete result; no automatic rerun; completed operation ID returns recorded result. | INV-04,07 |
| F36 | Attempt bulk, edited-payload, arbitrary-topic, cross-generation, or unsafe-mapper redrive | Explicit refusal; no hidden escape hatch. | INV-03,04,05 |
| F37 | Browser/application token reaches operator/health/raw surfaces | Cannot mutate/read protected evidence; health exposes only minimal unauthenticated/private probe data as configured. | INV-05 |
| F38 | Local socket/token permissions, path ownership/symlink, stale token, request-size/rate failures | Safe refusal; operations not exposed over public TCP or application proxy. | INV-05,06 |
| F39 | Raw payload contains secrets, markup, or instructions | Default logs/UI/exports redact; explicit raw view is text; payload cannot invoke operations. | INV-05 |
| F40 | Raw export and metadata bundle | No silent overwrite; restrictive permissions; raw inclusion explicit; bundle accurately labels missing evidence. | INV-05,07 |
| F41 | Journal capacity, topic-scan budget, audit limit, or repeated poison flood reached | Bounded memory/disk/work; source held or operation refused; necessary barriers never pruned. | INV-03,06 |
| F42 | Unaffected independent source while another is held/quarantining | Unaffected source continues within declared workload; shared limits remain enforced. | INV-02,06 |
| F43 | Healthy source, paused source, broker outage, startup, shutdown, unresolved commit | Liveness/readiness/reason states correctly separated; no restart-loop recommendation or payload leak. | INV-02,07 |
| F44 | Workbench failure lifecycle and old-state display | Captured/quarantined/advanced/recovered remain separate; unsafe actions disabled; connection ≠ subscription health. The published frontend/integration seam exercises supported synthetic development operations without exposing production management or native credentials. Native fixtures and packed/published-install evidence establish this gate; site-owned LC11-A41–A46 do not block library publication. | INV-02,07 |
| F45 | Chromium, Firefox and WebKit failure/reconnect/cleanup path | Same supported UX and SDK contract; record exact versions; no unsupported coverage claim. | INV-02,05 |
| F46 | Published/packed install, clean config, production proxy, local IPC, graceful stop/crash restart | Shipped artifacts execute contract; development server absent in production; retries/producers/consumers close. | INV-05,06,08 |
| F47 | Replicated Kafka evidence write under leader/ISR failure | Measured result matches declared acks/replication/minISR policy; no broker-failure durability claim from single-node tests. | INV-01,07 |
| F48 | Upgrade then downgrade with unresolved/advanced incidents | Preserved journal/barriers; migration safe or explicitly refused; old runtime cannot silently erase new recovery obligations. | INV-02,03,08 |

## 3. Test workload and measurements

Use an order/job model with at least two tenants, two independent sources, multiple routing instances, and the existing source's stable partition ordering. Generate full-state updates independently of the runtime mapper. Include malformed records with unknown identity, mapping defects, deletion states, noncontiguous revisions, and intentionally false snapshot coverage to document the application boundary.

Measure detection time, time held, successful quarantine acknowledgment, progress reconciliation time, snapshot recovery time, healthy-source impact, duplicate envelopes, CPU/memory, journal growth, topic writes/reads, and socket cleanup. Use declared payload sizes, source rate, fanout, client count, durations, seeds, TLS, and restart conditions. These are proposed measures; set numeric performance targets before running against the supported environment.

A run fails its safety gate on unauthorized output, unsafe progress, erased required barriers, false `live` within the declared application contract, unbounded resource growth, or an inaccurate mutation result. Do not average these failures away with a favorable latency statistic. Separately record limitations that tests cannot establish, such as whether an arbitrary application really satisfies its recovery assertion.

## 4. Evidence manifest template

```yaml
release_milestone: V1.1
status: proposed
spec_revision: '1.0'
owner_amendment: '2026-10-01; reconciled 2026-10-02'
streamotter_commit: null
package_versions: {}
node_os_browser_versions: {}
kafka_client_broker_versions: {}
topic_settings: {}
journal_driver_and_durability_settings: {}
persistent_volume_and_permissions: {}
config_and_handler_fingerprints: {}
workload_and_fault_seed: {}
expected_results_ledger: null
commands: []
scenario_results: []
raw_evidence_paths: []
observed_limits: []
failed_runs: []
unverified_combinations: []
independent_reviewer: null
product_exceptions: []
```

## 5. Release review

QA verifies scenario results and challenges the expected-results model. The technical lead confirms adapter commit semantics, byte capture, local-state recovery, lifecycle races, and package compatibility. A security reviewer checks the new raw-data and local-operator surfaces. The product owner approves changes to scope, application obligations, dependency/operating footprint, or public guarantees—not routine engineering details.

Link each release claim to passing evidence, an exact version, and an operating boundary. Update the support matrix and runbook. A separately maintained Lontra Creek scenario may use the feature only after consuming an exact published release; an unshipped source import or demo-only workaround is not release evidence.
