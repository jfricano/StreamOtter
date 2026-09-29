# StreamOtter roadmap traceability and proposed refinements

**Baseline:** 28 September 2026; `jfricano/StreamOtter@7b406780dd52c921cf88a98834e81e1677fc4a8d`.  
**Authority:** Existing roadmap governs sequencing. This crosswalk proposes research and limited refinements; it does not change scope. [S02]

## 1. Version and increment crosswalk

| Existing commitment | Recommendation | Research / proof | Change authority |
| --- | --- | --- | --- |
| V1 engineering acceptance / public launch | Preserve separate runtime Gate A and Lontra Creek Gate B. Verify current status rather than infer launch from library tests. | R01, R10; pinned published dependency, actual deployment and isolated Failure Lab evidence. | Existing plan; new reprioritization needs owner approval. |
| V1.x migration, configuration polish, fixtures, compatibility | Retain; propose a small production-health and support-matrix pass without exposing development management. | R03, R04, R10. | Bounded implementation within policy; new feature scope confirmed by owner. |
| V2.0 retained events, store, cursors, history, checkpoints | Retain. Freeze the persistence and checkpoint contract before signatures become difficult to change. | R05, R06, R07; crash/restore, expired cursor, authorization and replay fairness tests. | Existing direction; consequential dependency/guarantee choices escalated. |
| V2.1 multiple gateways, ownership/fanout, shared revocation, topology/metrics | Retain store-before-distribution dependency. Specify failure/propagation bounds. | R08; node movement, lost notification, fencing, partition and revocation evidence. | Existing direction; topology choice via ADR. |
| V2.2 registry/Avro, React hooks, AsyncAPI | Retain. Design for them early; promote earlier only for a documented blocker with owner approval. | R09, R10; compatibility and lifecycle/generation tests. | Any reordered delivery needs explicit approval. |
| V3.0 named commands and durable idempotency/receipts | Retain. Existing application API remains valid; business completion stays separate. | R11; all handoff and ambiguous-outcome crash windows. | Existing direction; no arbitrary-topic publishing by implication. |
| V3.1 teams, environments, revisions, promotion/rollback/audits | Retain as optional operating layer. | R12; authority matrix, immutable artifacts, isolation and rollback evidence. | Shared operations do not automatically authorize managed hosting. |
| V3.2 plain WebSocket | Retain with Socket.IO maintained. | R13; same semantic suite under both adapters. | Moving SSE or removing Socket.IO requires product approval. |

## 2. Full feature-matrix crosswalk

This section captures items present in the broader roadmap that are not all named in its short increment table. “Proposed placement” is not a claim that the current roadmap already assigns that precise increment.

| Feature family | Existing allocation | Research / proposed placement clarification |
| --- | --- | --- |
| Workbench | V1 local flow; V2 replay/topology; V3 shared operations. | R10 throughout; replay views with V2.0, topology V2.1, shared management V3.1. Preserve one configuration model. |
| Kafka sources | V1 ordinary cluster connectivity; V2 independent clusters; V3 environment profiles. | R09 proposes independent-cluster identity/health with V2.2 unless required earlier; owner must confirm placement. Multiple brokers in one cluster are not a new V2 feature. |
| Fixtures | V1 deterministic failures; V2 recovery/rebalance; V3 command cases. | R03/R05–R08/R11. Extend fixtures before each feature’s claim is made. |
| Payload contracts | V1 JSON validation/types; V2 Registry then Avro; V3 deployment compatibility; Protobuf later. | R09; bind public contract checks to generation and V3.1 promotion. |
| Application channels | V1 state; V2 retained events; V3 catalog. | R05–R07 and R12. State and event semantics remain distinct. |
| Mapping/filtering | V1 exact parameter matching; V2 declared bounded filters; V3 shared policies. | R09 proposes V2.2 filter extension; R12 for shared policy management. Identity/cursor effects reviewed before implementation. |
| Browser SDK | V1 lifecycle; V2 resume/checkpoint/history; V3 commands. | R06/R07/R11. Preserve after-handler semantics without claiming external atomicity. |
| Framework integration | V1 vanilla/React example; V2 supported React hooks. | R10 in V2.2. Other bindings remain later candidates. |
| Socket.IO | Supported in V1 and maintained. | R13 establishes continuing regression coverage. |
| Plain WebSocket / SSE | WebSocket V3; SSE beyond core V3. | R13, then R14. No transport change may silently weaken semantics. |
| Recovery | V1 snapshots; V2 durable retained replay. | R03 then R05–R07. Diagnostic replay is not a production broadcast. |
| Flow control | V1 finite queues; V2 replay/shared budgets; V3 workspace quotas. | R07/R08/R12. Test total memory and fair service, not only local counters. |
| Gateway deployment | V1 one; V2 coordinated gateways; V3 environment operation. | R04/R08/R12. No unsupported horizontal replica recipe. |
| Access | V1 app identity/revocation; V2 history and cross-node revocation; V3 workspace isolation. | R07/R08/R12. Define permission freshness during partitions. |
| Observability | V1 diagnostics; V2 persistent metadata/metrics/topology; V3 audits. | R04 proposes minimal prod-safe health early; replay diagnostics with V2.0, topology/metrics scope V2.1, audits V3.1. Earlier metrics needed for tests need not become a new public platform. |
| Configuration | V1 validate/export; V2 migration/deployment checks; V3 revisions/promotion/rollback. | R09 proposes basic migration checks alongside first store schema/config changes; full promotion in R12. Preserve handler and secret references. |
| Browser-to-backend actions | Existing application API in V1/V2; commands V3. | R11. Do not retroactively turn subscription APIs into command channels. |
| Documentation generation | V1 types/examples; V2 AsyncAPI; V3 catalog/change reports. | R10/R12; generated declarations must describe shipped capabilities. |
| Public site and live demo | Separate launch milestone; extend only for shipped increments. | R01/R10; site package pin, published fixes, verified deployment, no fictional future feature demonstrations. |

## 3. Beyond-V3 crosswalk

| Existing option | Retain / gate | Research packet |
| --- | --- | --- |
| SSE | Retain as separate adapter proposal with explicit auth, resume and acknowledgment mapping. | R13/R14 |
| Protobuf and formats | Retain; release-specific decoding and evolution path. | R09/R14 |
| Other brokers | Retain; validate source contracts before public plugin abstraction. | R14 |
| Extra SDKs | Retain; real platform lifecycle requirements. | R10/R13/R14 |
| Managed hosting | Retain as separate service/commercial scope, not a consequence of launching a demo. | R12/R14 |
| Multi-region | Retain; consistency, recovery, residency and cost ADR. | R08/R14 |
| Transformations and joins | Retain as a distinct processing-model decision. | R09/R14 |
| Long-term archive/replay | Retain; separate cold-data retention and replay budget. | R05/R07/R14 |
| AI-assisted config/diagnosis | Retain after deterministic diagnostics and reviewable changes. | R10/R12/R14 |

## 4. Decisions the owner should actually see

**P01 — Bounded V1.x hardening.** Confirm whether minimal production health and explicit compatibility work may be delivered ahead of durable events. This is a focused operational improvement, not a demand to delay V2 until broad enterprise readiness.

**P02 — Place matrix-only V2 commitments.** Assign independent clusters, bounded filtering, diagnostic metadata and migration tooling to explicit increments. Proposed allocations above are a starting point, not silent edits to the roadmap.

**P03 — Accept the V2 reference deployment.** Approve consequential persistent-storage/topology costs and failure guarantees after R05 evidence. Ordinary schema/index details remain engineering decisions within that agreement.

**P04 — Optional external/comparative validation.** Decide only if a concrete trial would resolve a consequential uncertainty. The default remains desk research and engineering verification; no interview or rival prototype quota is introduced.

**P05 — Approve later scope changes individually.** Changes to commands, team controls, transport order, managed hosting or the owned-gateway model are product decisions. An agent cannot infer approval from this advisory report.

## 5. What must not be lost in future planning

The lightweight state path remains usable without a delivery store or workspace. Recovery is bounded; event retention and domain state are not the same thing. Cursors remain opaque and scoped. Semantic changes require compatibility treatment even when JSON stays unchanged. Event identity, revision and cursor remain separate. Application authority and management authority remain separate. The gateway continues to operate without the workbench. Product milestones do not mechanically require breaking package/protocol versions. [S02] [S03]


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
