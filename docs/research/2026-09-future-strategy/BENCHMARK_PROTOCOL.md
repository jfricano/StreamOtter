# StreamOtter verification and optional comparison protocol

**Version:** Proposed protocol 1.0 · 28 September 2026  
**Status:** No scenarios in this document have been executed as part of this report.  
**Purpose:** Produce defensible evidence for current-state integration, retained delivery, commands and operations without confusing their guarantees.

## 1. Scope and comparison policy

Engineering verification of a promised capability is a release requirement. Building competing implementations is an optional research tool, not a prerequisite imposed on the roadmap. Preserve the owned-gateway direction and do not delay ordinary development for an exhaustive market test. [S01] [S02]

When a comparison is approved, use a small common reference application and a bounded question. Begin with the closest documented contract and a competent application-built baseline. Do not implement five complete competing platforms. A docs-only comparison must remain labeled docs-only.

## 2. Three tracks, not one aggregate score

### Track S — Current-state view

Common application: existing order/status records, an authoritative snapshot API, consistent domain revisions, stable per-instance source partitioning, application identity and tenant policy. Updates are complete current-state values. Success is correct convergence or an explicit declared failure state—not receiving every intermediate update.

Provide each implementation with the same application prerequisites. Count any implementation-specific snapshot coordination, history store, client reducers and recovery code separately. Do not give StreamOtter an outbox while depriving the baseline of equivalent source correctness. Candidate comparisons: Centrifugo’s documented state/recovery path and a well-built Socket.IO plus application snapshot implementation. [S03] [S10] [S11] [S20] [S21]

### Track E — Retained application events

Common application: independently meaningful activity events with stable identities; configured retention; declared stream ordering; durable source-to-store acceptance; client-side checkpoint persistence; idempotent example application handler. Success is no silently missing authorized event within the promised recovery window and failure model; duplicates are measured and tolerated as specified.

A cache-only deployment belongs in a different contract class until its missing durability/application responsibilities are supplied and counted. Compare equivalent outcomes rather than using weaker persistence settings to manufacture a latency or cost advantage. [S02] [S11]

### Track C — Commands and operations

Common application: a named authorized command with a stable idempotency key, durable acceptance receipt, separate backend execution and correlated outcome. Include an existing application HTTP endpoint as a design baseline. Test the request-to-outcome lifecycle rather than only broker publication speed. Team/environment and transport-conformance scenarios accompany their respective increments. [S02]

## 3. Reproducibility requirements

Record exact source commit, package/server versions, edition/license, OS/CPU/memory, runtime flags, broker topology, history-store durability and replication settings, proxy, schemas, handler code, authentication policy, retention and limits. Include all required services and custom glue code.

The run manifest must include a random seed, logical event corpus, fanout distribution, payload sizes, client/handler behavior, fault injection points and duration, clock methodology, warmup, repetitions, errors, skipped tests and cleanup. Use monotonic elapsed timing within a process; calibrate or explicitly qualify measurements spanning different host clocks.

Run a smoke profile first, then scale only within an approved resource budget. Suggested *experimental inputs*, not capacity claims: 10/200/1,000 clients; 0.5/8/48 KiB serialized frames; narrow versus wide fanout; no replay versus small versus retention-boundary backlogs. Validate those inputs against each implementation’s configured limits. Stop before an uncontrolled shared-machine or paid-service load test.

Keep connection count, active subscriptions, source records, mapped logical events, fanout frames and replayed events separate in results. A million messages cannot be a useful unit until it is defined.

## 4. Independent oracles and failure evidence

The reference application keeps a ground-truth record of domain changes and expected event identities. A separate verifier reads this record and the client-observed trace. Do not accept the gateway’s own success counter as proof of delivery.

For state tests, compare expected full state at a defined quiescent/drain boundary, monotonic accepted revisions, invalidated epochs and visible stale/recovery states. Noncontiguous revisions are valid; a jump in revision number is not automatically an omitted event.

For event tests, compare the set and declared order of durably admitted, authorized, in-retention events with successful handler results. Record duplicates, handler attempts, persisted checkpoints and any explicit unrecoverable interval. Safety (no unauthorized or falsely confirmed result) and liveness (eventual completion within the declared policy) are distinct measurements.

For commands, distinguish received request, durable handoff, broker acceptance, backend execution, observed outcome and delivered receipt. Loss of the response must not be misclassified as proof that nothing happened.

## 5. Scenario matrix

| ID | Scenario / injection | Required observation / acceptance boundary | Gate |
| --- | --- | --- | --- |
| T01 | Update while snapshot is loading; test snapshot before and after the update. | Snapshot precedes accepted newer updates; no update is overwritten by stale state; `live` follows the defined boundary. | V1 regression / R03 |
| T02 | Older, duplicate, noncontiguous and very large revisions. | Correct numerical comparison; harmless duplicates; no false requirement that revisions be consecutive. | V1 regression / R03 |
| T03 | Same revision with conflicting payload; entity deletion/recreation. | Conflict fails visibly; recreation follows the declared revision/identity contract rather than silently resetting authority. | V1 regression / R03 |
| T04 | Database change deliberately not published; incompatible partition/source contract. | Demonstrate the documented limitation; do not claim universal omission detection. Detectable incompatibilities report failure, other upstream obligations remain explicit. | Claims / R03 |
| T05 | Overflow or late snapshot from an invalidated synchronization epoch. | Old generation cannot restore `live`; resource bounds and bounded resynchronization hold. | V1 regression / R03 |
| T06 | Token expiry/revocation while auth, snapshot or send is pending. | Protected data is not delivered after the relevant authority boundary; retry cannot restore revoked access. | All / R03,R07 |
| T07 | Broker loss, poison record, recovery and source resume. | Stale/diagnostic state matches declared behavior; no silent skip or uncontrolled retry; healthy independent sources handled as specified. | V1/V2 / R04 |
| T08 | SIGKILL/restart and graceful drain behind a proxy. | Recovery under documented session/startup timing; no false-ready health; no exposed development management. | V1.x / R04 |
| T09 | Chromium, Firefox and WebKit plus configured production-origin checks. | Same claimed SDK behavior; denied origins stay denied; report each actually tested platform. | Compatibility / R04 |
| T10 | Slow receiver, reconnect storm, hot channel, concurrent normal clients. | Finite measured memory/queues; healthy clients and broker progress within the approved workload envelope; explicit overload outcomes. | All / R04,R07 |
| T11 | Crash before durable append. | Source progress does not cross an unaccepted record; retry preserves logical identity. | V2.0 / R05 |
| T12 | Crash after durable append but before source commit. | Redelivery does not create an extra logical event; record remains recoverable. | V2.0 / R05 |
| T13 | Crash after source commit but before fanout notification. | Retained history still drives delivery; notification loss cannot silently lose the accepted event. | V2.0 / R05 |
| T14 | Store restart/failover/restore under selected durability settings. | Accepted records survive within the approved failure model, or a separately approved explicit limitation applies; restored generations cannot fake continuity. | V2.0 / R05 |
| T15 | Handler rejects; then succeeds. | No advanced checkpoint after failure; retries retain identity; correct duplicate-tolerant example result. | V2.0 / R06 |
| T16 | Handler side effect succeeds; checkpoint persistence fails or browser terminates. | Permitted duplicate on resume is visible and safe in the example; no exactly-once external-side-effect claim. | V2.0 / R06 |
| T17 | Multi-tab resume, logout/login, parameter/channel-version/cursor-generation mismatch. | Checkpoints and cached data are correctly scoped; no cross-user reuse or accidental shared-consumer behavior. | V2.0 / R06 |
| T18 | Cursor expires or retained range disappears during paging/replay. | Explicit unavailable/expired result; event mode does not silently jump to newest; declared state fallback remains separate. | V2.0 / R07 |
| T19 | Live events arrive during history replay; lost wakeup; preview canceled. | Defined replay-to-live boundary has no silent hole; bounded eventual read; diagnostic replay never rebroadcasts to unrelated live clients. | V2.0 / R07 |
| T20 | Revoke history access during a page, handler wait or long replay. | Delivery and subsequent reads follow current permission policy; behavior does not reveal forbidden payloads or pretend skipped data was delivered. | V2.0 / R07 |
| T21 | Client on gateway B; ingestion on A; then move client and rebalance source. | Routing and retained recovery do not depend on original process memory. | V2.1 / R08 |
| T22 | Partition old owner, admit new owner, delay old writes; drop inter-node signals. | Fencing protects history/ownership; wakeups are not the sole authority; revocation follows its specified failure bound. | V2.1 / R08 |
| T23 | Registry-compatible but public-semantic-breaking change; cluster/topic recreation; filter revision. | Required generation/compatibility changes occur; identity never accidentally collides; no unjustified compatibility claim. | V2.2 / R09 |
| T24 | Generated TS, React lifecycle, AsyncAPI and exported workbench config. | Runtime/type agreement; cleanup on parameter/account changes; docs list only negotiated/shipped behavior; runtime works without workbench. | V2.2 / R10 |
| T25 | Repeat command key, change payload, replay key under another identity/version. | Durable dedup scope enforced; conflicts explicit; no arbitrary-topic action. | V3.0 / R11 |
| T26 | Crash around idempotency/outbox/broker handoff; lose receipt; outcomes duplicate or arrive late. | Stable receipt lookup and retry identity; acceptance distinct from business completion; ambiguous status remains explicit. | V3.0 / R11 |
| T27 | Conflicting config revisions, unauthorized workspace promotion, partial rollout and rollback. | Role/environment isolation; attributable immutable deployment; rollback does not imply event/business reversal. | V3.1 / R12 |
| T28 | Run negotiated state/event/command suites through both transport adapters. | Same advertised behavior, bounded failure and authorization; unsupported capability fails without semantic downgrade. | V3.2 / R13 |

These are proposed minimum scenario families, not a claim that each family is one test or that 28 tests exhaust the state space. Expand boundary cases and randomized traces where justified.

## 6. What to measure

Record p50/p95/p99 where a sample size justifies percentiles, plus full sample count, maxima, failures and censored/time-limited runs. A handful of integration checks does not justify a polished percentile claim.

Separate source-to-store latency, store-to-SDK latency, handler-completion latency, stale-detection time, replay duration, snapshot request amplification, total process memory, queue/store bytes and egress. Record healthy-client latency during catch-up, not only idle throughput.

For workflow studies, record time spent learning prerequisites, configuring sources, mapping/authorizing, integrating UI, rehearsing failure, diagnosing, packaging and upgrading. Count both handwritten glue and generated artifacts, but do not confuse fewer lines with maintainability automatically. Internal developers’ familiarity must be disclosed.

## 7. Result classification

Use **Pass**, **Fail**, **Not run**, **Not applicable to this contract**, or **Blocked**. Never translate “not applicable” into a competitive failure without explaining why the contract differs. Record known limitations and workarounds and include their costs.

Predeclare the configured retention/failure/resource envelope and release criteria before observing the results. Do not tune a competitor into its weakest configuration or discard unfavorable StreamOtter runs. A fair report can conclude different products suit different jobs.

## 8. Result record template

```yaml
experiment_id: Txx
track: state | retained-events | commands-operations
status: not-run
question: ""
product_and_edition: ""
repo_commit_or_package_versions: []
source_ids: []
hardware_and_topology: ""
persistence_and_failover_settings: ""
retention_and_limits: ""
application_prerequisites: ""
seed_and_corpus_hash: ""
workload_and_fault_schedule: ""
independent_oracle: ""
expected_contract: ""
observed_results: null
failures_and_counterexamples: []
latency_resource_samples: null
custom_code_and_services_required: []
limitations: []
reproduction_command: ""
evidence_paths: []
verifier: ""
decision_informed: ""
```

## 9. Publishable conclusions

A result supports only its measured version, contract and envelope. It can establish that a particular implementation met a criterion, identify a reproducible defect, or show a workflow improvement in the recorded exercise. It does not establish market prevalence, superiority across all workloads, universal security, or production readiness for every deployment.

Publish sanitized reproduction material when useful. Do not include tokens, real customer payloads, unrestricted management endpoints, private infrastructure identifiers, or unverifiable performance summaries.


[S01]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/FOUNDING.md "Founding direction"
[S02]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/API_AND_FEATURE_ROADMAP.md "Product versions and API roadmap"
[S03]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/V1_API.md "V1 API specification"
[S04]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/IMPLEMENTATION_STATUS.md "V1 implementation status"
[S05]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/DEPLOYMENT.md "Production deployment guide"
[S06]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/RESEARCH.md "Existing research brief"
[S07]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/WEBSITE_AND_DEMO_PLAN.md "Home site and live demo plan"
[S08]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/tests/integration/sync.test.ts "Synchronization acceptance-test source"
[S09]: https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/README.md "Documentation index"
[S10]: https://centrifugal.dev/blog/2026/07/27/app-owned-state-stream-subscriptions "Centrifugo: app-owned state with stream subscriptions"
[S11]: https://centrifugal.dev/docs/server/history_and_recovery "Centrifugo: stream history and recovery"
[S12]: https://centrifugal.dev/docs/server/consumers "Centrifugo: asynchronous consumers"
[S13]: https://ably.com/docs/platform/integrations/inbound/kafka-connector "Ably: Kafka connector"
[S14]: https://ably.com/docs/livesync/postgres/models "Ably LiveSync: frontend data models"
[S15]: https://lightstreamer.com/products/kafka-connector/ "Lightstreamer: Kafka connector"
[S16]: https://github.com/Lightstreamer/Lightstreamer-kafka-connector/blob/main/README.md "Lightstreamer Kafka connector README"
[S17]: https://docs.aklivity.io/latest/ "Aklivity documentation and edition overview"
[S18]: https://docs.aklivity.io/latest/concepts/proxy/sse/ "Zilla: SSE proxy"
[S19]: https://docs.aklivity.io/latest/concepts/proxy/http/ "Zilla: HTTP proxy"
[S20]: https://socket.io/docs/v4/delivery-guarantees/ "Socket.IO: delivery guarantees"
[S21]: https://socket.io/docs/v4/connection-state-recovery/ "Socket.IO: connection-state recovery"
[S22]: https://kafka.apache.org/41/design/design/ "Apache Kafka 4.1 design"
[S23]: https://www.postgresql.org/docs/current/transaction-iso.html "PostgreSQL: transaction isolation"
[S24]: https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/ "Redis: persistence"
[S25]: https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html "Debezium: outbox event router"
[S26]: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html "Confluent: schema evolution and compatibility"
[S27]: https://www.asyncapi.com/docs/concepts/asyncapi-document/adding-messages "AsyncAPI: adding messages"
[S28]: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html "OWASP: WebSocket security"
