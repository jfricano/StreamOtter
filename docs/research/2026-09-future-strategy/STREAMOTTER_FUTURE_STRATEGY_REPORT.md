# StreamOtter: competitive findings and future development strategy

## Research plan for V2, V3, and beyond

**Prepared for Jason Fricano / Orca Solutions**  
**Research date:** 28 September 2026  
**Status:** Advisory report and proposed research program; not an approved scope change  
**Repository:** `jfricano/StreamOtter`  
**Inspected revision:** `7b406780dd52c921cf88a98834e81e1677fc4a8d`

> **Recommendation:** Continue the existing product direction. Make the path from an existing Kafka application to a trustworthy, diagnosable live feature the organizing principle. Preserve the lightweight V1 state workflow while adding V2 event durability and V3 commands/governance as explicit, independently verified capabilities—not as prerequisites for every user.

## Executive assessment

StreamOtter addresses a substantive engineering problem, but it enters an established category. Its best-supported opportunity is not exclusive ownership of snapshot synchronization, reconnect recovery, or Kafka-to-browser delivery. It is a coherent developer workflow: configure an application channel, integrate typed client code, understand its guarantees, rehearse failure, diagnose the result, and deploy an integration that remains understandable. This is already the founding document’s position, not a new direction imposed by this report. [S01] [S06]

The roadmap is more developed than the earlier conversational assessment suggested. It already separates current-state delivery from retained events, keeps commands distinct from business execution, postpones distributed delivery until shared recovery exists, and treats compatibility as semantic rather than merely syntactic. The appropriate response to the competitive findings is to sharpen the evidence and implementation decisions around that roadmap—not replace it with a generic real-time platform checklist. [S02]

Three conclusions should guide future development.

**First, compete on the complete workflow and on precise contracts.** Comparable tools already solve significant portions of the problem. Centrifugo is the closest technical comparator identified in this review; Ably, Lightstreamer, Zilla, and a well-built Socket.IO integration are also relevant. Their presence establishes alternatives, not StreamOtter’s inferiority or a measured market opportunity. The burden is to demonstrate where StreamOtter removes work or makes behavior easier to verify.

**Second, V2 is a semantic expansion, not simply a stronger version of V1.** A current-state view may recover by loading a new snapshot. A retained activity feed cannot silently substitute the latest state for missed events. The proposed V2 delivery store, event identities, client checkpoints, retention policy, and replay-to-live boundary therefore require an explicit failure model. [S02]

**Third, V3 contains two distinct adoption decisions.** Application developers may want named commands with reliable receipts; platform teams may want environment management and auditability. Deliver those increments independently. Do not force team administration into a single-developer integration or make command submission a replacement for an application’s existing business API. [S01] [S02]

The research program should run alongside development. It should resolve storage, ownership, authorization, compatibility, and operational questions before the relevant capability ships. It should not create a mandatory interview campaign or a rival-product bake-off before useful work can continue. The founding and roadmap documents explicitly reject those prerequisites. Optional external trials and bounded comparative implementations can strengthen evidence, but introducing them as mandatory gates would require an owner-approved change. [S01] [S02]

### Recommended sequence at a glance

| Horizon | Retain the existing milestone | Add the following research emphasis |
| --- | --- | --- |
| V1.x / release hygiene | Preserve the state workflow and finish the applicable public-launch obligations. | Reconcile documentation status; production-safe health; browser and broker compatibility; honest guarantee language. |
| V2.0 | Retained event channels, delivery store, cursors, paged history, SDK checkpoints. | Prove the source-to-store handoff, replay continuity, checkpoint failure behavior, retention, and resource limits. |
| V2.1 | Multiple gateways, coordinated delivery, shared revocation, topology and metrics. | Separate ingestion ownership from connection ownership; test stale owners, missed notifications, partitions, and cross-node authorization. |
| V2.2 | Registry/Avro, React hooks, AsyncAPI. | Keep upstream schema evolution distinct from public API compatibility; measure integration burden. |
| V3.0–V3.2 | Named commands; team/environment operations; plain WebSocket. | Prove durable acceptance, ambiguous outcomes, deployment isolation, and transport equivalence. |
| Beyond | Adapters, SDKs, hosting, regions, archives, transformations, AI assistance. | Require a specific job, bounded semantics, and an explicit owner decision for each expansion. |

The rows summarize the existing roadmap and proposed research priorities. They are not claims that V2/V3 capabilities are implemented. [S02]

## 1. Basis, authority, and limits

### 1.1 What was inspected

This review used the connected GitHub repository, pinned to the revision shown above. It inspected the founding document, roadmap, research brief, V1 contract sections, implementation status, production deployment guide, documentation index, home-site plan, and a selected synchronization-test source range. It also reviewed current primary documentation for competing products and relevant infrastructure. The complete source register is in `SOURCES.md`; a machine-readable manifest records the inspection scope. [S01] [S02] [S03] [S04] [S05] [S06] [S07] [S08] [S09]

The repository is `jfricano/StreamOtter`, not the hyphenated spelling supplied in the request. The Medium article body was not retrievable in this pass. Its title and the earlier discussion supply context only. This report does not claim a fresh article-body audit, repeat an unverified broken-link finding, or use earlier conversational descriptions as technical evidence.

No tests, comparative deployments, customer interviews, pricing surveys, or security audit were executed. Repository test counts are project-reported results. Vendor documentation establishes described behavior, not independently established performance or ease of use. “Not verified here” does not mean “not supported” or “broken.”

### 1.2 Respect the project’s existing decisions

The authority hierarchy is important: founding direction governs mission; the roadmap governs sequencing; the detailed V1 API and implementation refinements govern current behavior. Roadmap code samples are forecasts, not a replacement for the implemented contract. Product milestones, package SemVer, configuration versions, channel versions, and protocol versions are separate axes. [S02] [S03]

This report proposes additional evidence and bounded hardening. It does not authorize a gateway rewrite, a managed service, altered license terms, a new broker, a transport migration, or a reordered product vision. In particular, the owned Node/TypeScript gateway is an explicit product decision. Competition should inform its execution; it is not permission for an agent to substitute someone else’s runtime. [S01]

## 2. Current baseline: what V1 establishes and what it does not

### 2.1 A real synchronization contract

The V1 contract defines application-owned snapshots and full replacement updates with monotonic domain revisions. The gateway captures updates before requesting a snapshot, reconciles the snapshot boundary, and only reports `live` after the specified drain boundary. A stale generation cannot regain authority simply because its delayed snapshot arrives. The selected test source exercises updates during snapshot loading, duplicate/older revisions, large numeric revisions, and invalidated synchronization. This is meaningful engineering content, not just a socket wrapper. [S03] [S08]

However, the contract is conditional. The application must supply coherent snapshot/event progression, and V1 expects a channel instance’s changes from one stable Kafka partition in revision order. An unpublished upstream change is not automatically detectable. A non-atomic database update plus event publication is not made atomic by the gateway. [S03]

### 2.2 Evidence exists, with a defined perimeter

The inspected implementation status identifies `0.1.0-rc.3`, reports completed V1 components, and records core, real-Kafka, browser, deployment, installed-package, and bounded-load tests. It reports 114 core tests, 20 Kafka tests, 13 browser checks, four deployment checks, and 20 installed-package checks. These results were not reproduced for this report, and their counts are not a proxy for comprehensive correctness. [S04]

The documented deployment remains one gateway per project. The production process exposes no development-management surface and currently has no production health endpoint. Browser automation covers Chromium, not Safari/Firefox. Some broker/authentication and deployment combinations are unverified. These are documented boundaries to investigate—not evidence that the implementation has failed those environments. [S04] [S05]

### 2.3 Four distinctions to preserve in every release

| Statement | Defensible interpretation | Interpretation to reject |
| --- | --- | --- |
| Connected | A transport connection exists. | The application view is synchronized. |
| Live | The subscription reached the defined synchronization boundary while its source is healthy. | The display is proven correct and current in wall-clock time. |
| V1 SDK receipt | Frame validation and admission to synchronous listener dispatch occurred. | Arbitrary asynchronous application work committed, or a human saw the result. |
| V2/V3 durable acceptance | The promised persistence boundary completed under the declared failure model. | Every downstream business action happened exactly once. |

The first three distinctions follow the V1 contract; the last follows the proposed V2/V3 contracts. They should become reusable explanatory elements in examples, diagnostics, documentation, and generated APIs. [S02] [S03]

### 2.4 Documentation and launch status need a small reconciliation pass

The roadmap’s planning header still says no implementation has been released, while the implementation record reports published release candidates. Preserve the historical planning date, but add a current-status pointer so readers do not mistake forecast text for release status. This is a documentation-consistency task, not a reason to rewrite the roadmap. [S02] [S04]

The home site is a separate project, Lontra Creek. The runtime records engineering Gate A as met; public-launch Gate B belongs to that separate project. Its live operation was not verified here. The plan also records a requested separation of type generation from file writing for the site’s playground. Check the current status of that request and Gate B before asserting that the public-launch obligations are complete. [S07]

## 3. Competitive findings

### 3.1 Compare contracts and workflows, not checkmarks

A feature called “recovery” can mean a reconnect cache, reconstruction from an authoritative snapshot, replay of every retained event, or resumption after application-handler persistence. Those are different contracts. A feature called “commands” can mean browser publication, internal server-API ingestion, or a durable business-request receipt. The comparison must name which one is offered and what the application must still implement.

| Comparator | Documented overlap | Research consequence |
| --- | --- | --- |
| Centrifugo | Kafka consumption, stream recovery, position checks, latest-state recovery, and application-owned snapshot integration. | Closest technical comparison for state synchronization and recovery. Test exact SDK/version behavior and total integration work. [S10] [S11] [S12] |
| Ably | Kafka connector plus a separate LiveSync/Models product surface for state loading and synchronization. | Evaluate both surfaces without assuming they form one drop-in Kafka/state/checkpoint solution. [S13] [S14] |
| Lightstreamer | Kafka delivery, filtering, adaptive data flow, authentication hooks, and schema-related integration. | Relevant to operational breadth and slow-client behavior; identify mode and edition before comparing guarantees. [S15] [S16] |
| Zilla / Aklivity | Protocol mediation, specification-driven configuration, authentication/schema support, and separately described governance/console offerings. | Relevant to both the V2 integration experience and V3 platform workflow, not only raw transport. [S17] [S18] [S19] |
| Socket.IO plus application code | Ordered delivery, optional recovery, and documented application work for stronger delivery guarantees. | Use a competent baseline with its required storage/snapshot logic, not a deliberately fragile demo. [S20] [S21] |

### 3.2 Centrifugo substantially overlaps—but its history contract matters

Centrifugo’s July 2026 `getState` material addresses the snapshot/subscription gap and subsequent resynchronization, including a Kafka-aggregator example. StreamOtter should not claim this problem or the existence of an integrated solution is unique. [S10]

A material distinction remains to investigate: Centrifugo describes its standard stream history as a bounded, non-authoritative cache, with explicit incomplete-recovery handling. StreamOtter’s V2 roadmap instead makes its delivery history authoritative for retained replay and advances source progress only after durable admission. That is not proof StreamOtter will be better; it is a different promise with additional implementation and operational costs. Compare the actual configured contract, including any extra application persistence, rather than treating “history available” as equivalent. [S11] [S02]

For current-state applications, a short reconnect cache plus database fallback may already be sufficient. For retained events that cannot be reconstructed from present state, the distinction can matter. The research question is which application jobs require the stronger contract and whether the added integration and operating burden is justified.

### 3.3 Correct the Ably framing

Ably is not limited to database-connected LiveSync: it documents a Kafka connector. Its Models documentation separately describes state synchronization and lifecycle behavior. A fair assessment must examine their integration boundary; neither the existence of both features nor a database-centric example proves a fully composed equivalent to StreamOtter. Do not publish “Ably cannot connect Kafka” or “its Kafka connector automatically provides our entire state contract.” [S13] [S14]

### 3.4 Do not conflate open connectors with whole-platform licensing

For every comparator, record the exact release, edition, deployment topology, required services, and applicable component licenses. Lightstreamer’s connector and its underlying delivery platform are distinct evaluation units. Aklivity’s documentation distinguishes community, Plus, and governed-console offerings. This report makes no current relative-price or license-compatibility conclusion. That investigation belongs in any procurement or public comparison exercise. [S15] [S17]

### 3.5 Novelty, usefulness, adoption, and commercial value are separate

The existence of alternatives does not make the project pointless. Conversely, a thoughtful implementation does not prove easier adoption, lower cost, a large addressable market, or willingness to pay. The current evidence supports a credible product hypothesis and a substantive implementation baseline. It does not establish community preference or commercial demand.

The strongest proposed positioning remains:

> A TypeScript-first integration toolkit for Kafka-backed live applications, with explicit delivery behavior, reviewable configuration, and failure rehearsal and diagnosis built into the development workflow.

Use this as positioning to test—not as a claim of demonstrated superiority.

## 4. A durable focus for the product

### 4.1 Optimize for time to a trustworthy feature

The founding document already selects this objective. Make it operational: a feature is not “done” when its first message arrives. It is done when authorized data arrives, cleanup works, failure produces the declared state, recovery is understood, exported configuration is reproducible, and another developer can diagnose a seeded problem. [S01]

The proposed differentiator is reduced coordination work across those steps. It may be expressed through clearer configuration, fewer application-specific recovery components, more useful diagnostics, or a smaller operational footprint for the selected use case. These are measurable hypotheses, not marketing facts yet.

### 4.2 Treat failure rehearsal as a product capability

Extend the same failure vocabulary from fixtures into debugging and release evidence. A useful rehearsal says what failed, what the client should show, what is safe to retry, which progress boundary was reached, and what the operator should do next. Distinguish the source, mapping, policy, queue, transport, SDK, and application boundaries.

A bounded trace bundle and reproducible scenario can be valuable even when no new transport feature is added. Keep payload capture opt-in, metadata redacted, and inspection independent of production delivery. The public Failure Lab should teach these contracts without exposing management powers to arbitrary visitors. [S01] [S03] [S07]

### 4.3 Preserve progressive adoption

A V1 user should not acquire a delivery database, a cluster coordinator, a team workspace, or an event-command API merely by upgrading packages. The roadmap explicitly preserves the earlier state-only path. Build its regression tests before the new dependency-heavy increments. [S02]

For every new capability, answer: Which additional job does this solve? Which new dependency or operating responsibility does it introduce? What happens when that dependency fails? Can an existing state-only application ignore it? A feature that cannot answer those questions is not ready for inclusion.

## 5. Recommendations for V1.x and V2

### 5.1 Small hardening work should not wait for an enterprise platform

Propose a bounded V1.x operational pass: production-safe liveness/readiness/source-health distinctions, structured diagnostics, restart guidance, and explicit support-matrix expansion. A Kafka outage should not necessarily cause an indiscriminate liveness restart loop; readiness and per-source degradation need separate design. None of this requires turning on the development management API in production. The current absence of a production health endpoint makes this a concrete addition, not a claim that one already exists. [S05]

Also investigate Safari/Firefox behavior, real deployment paths, publicly trusted broker TLS, and the operational blast radius of source-pausing poison records. Keep untested combinations labeled unverified. Reproduce documented fixed races only as regression tests; do not reopen them as current defects without new evidence. [S03] [S04]

### 5.2 V2.0: choose one durable delivery contract before choosing a store

Retain the planned event mode and state mode. Define the failure model first: which process, storage, and failover failures preserve an accepted record; when retention permits removal; and how the system reports unavailable history. A store name alone is not a guarantee.

The storage ADR should resolve stable event identity, append deduplication, the append-before-source-commit boundary, cursor generation, ordering, retention cleanup, authorized paging, backup/restore, migrations, and notification loss. It must address a crash after the delivery append but before the Kafka commit without producing a new logical identity on retry. [S02]

**Recommended investigation order, not a mandated implementation:** evaluate one PostgreSQL-backed reference design and one justified alternative such as Redis Streams. Consider Kafka-backed retained delivery only if its channel indexing and replay model fit without creating disproportionate complexity. Start with at most two concrete spikes; do not create a universal store abstraction before one supported deployment works.

PostgreSQL’s isolation rules and Redis’s persistence settings illustrate why configuration matters. Transactional reads must reflect the intended concurrency model; default asynchronous persistence cannot be assumed to satisfy the chosen accepted-record guarantee. A candidate must be tested under its actual persistence and failover configuration. [S23] [S24]

Do not confuse the application-to-Kafka publication boundary with the Kafka-to-delivery-store boundary. A reference transactional-outbox recipe can help the first; V2’s own admission contract solves the second. StreamOtter should explain both without claiming to own the application transaction. [S03] [S25]

### 5.3 V2.0: make client progress and recovery explicit

The roadmap’s after-handler model is soundly scoped: advance a durable checkpoint after successful handling and checkpoint persistence; tolerate redelivery because arbitrary application side effects are not atomically coupled to that checkpoint. Preserve this limitation in names, examples, and diagnostics. [S02]

Test handler failure, checkpoint-store failure, browser termination between the two, account switching, multiple tabs, and reused keys. A saved cursor must not silently cross tenants, parameters, channel versions, or source generations. History inspection must not advance the live subscription. An event stream with an expired cursor must not silently skip ahead; a state channel may use its explicitly configured snapshot fallback.

Authorization needs a decision for history pages and ongoing replay, including revocation during a long page or handler operation. Separate legitimate filtering from discontinuity. Define what the client observes when a formerly accessible event is no longer accessible, without leaking protected existence or payloads. This is a contract question to resolve, not an invitation to invent an undocumented skip policy.

### 5.4 V2.1: multiple gateways are more than multiple processes

Keep V2.1 dependent on process-independent recovery. Kafka ingestion ownership and browser connection ownership are different concerns. Test a client attached to a node that does not consume its Kafka partition, then move that connection while ingestion ownership changes. A lost notification must delay work at most within the declared policy; it must not delete the retained event. [S02]

The ownership ADR must define fencing against stale writers, duplicate admission on rebalance, a bounded catch-up/read mechanism, node draining, and revocation propagation. Specify what disconnected nodes may deliver when they cannot verify permission freshness. “Shared revocation” needs a documented propagation/failure bound, not a best-effort broadcast marketed as instantaneous enforcement.

Topology and metrics should answer operational questions: Which node owns ingestion? Where are clients attached? How much replay is queued? Which source or history store is degraded? Are fresh clients being starved by historical catch-up? Prefer those answers over an attractive diagram with no diagnostic value.

### 5.5 V2.2: integration features must preserve meaning

Keep the planned JSON Schema/Schema Registry path before Avro decoding, and retain JSON public payloads unless a later contract explicitly changes that. Upstream schema compatibility and browser-facing channel compatibility are separate concerns. A registry-compatible change can still alter routing, authorization, or user-visible interpretation. Confluent’s format-specific compatibility documentation is a reference, not a substitute for StreamOtter’s own public contract. [S02] [S26]

Supported React hooks should handle unsubscribe, changing parameters, account changes, errors, and recovery without hiding the SDK’s states. AsyncAPI export should describe the actual message direction and negotiated behavior, not forecast V3 commands as available now. [S02] [S27]

The broader roadmap also promises independently configured clusters, bounded filtering, migration/deployment checks, persistent diagnostic metadata, and replay tools. These need explicit owning increments: the short increment table does not place every matrix item. `ROADMAP_TRACEABILITY.md` identifies the proposed allocation decisions rather than silently losing these commitments.

## 6. Recommendations for V3

### 6.1 V3.0: commands need a durable receipt, not a misleading success message

Retain named, allowlisted commands. Compare their usefulness against an existing HTTP command endpoint plus correlated events—not only against direct browser publishing to Kafka. The product value must be coherent authorization, validation, idempotency, receipts, and diagnosis across the request/outcome lifecycle.

The command ADR must specify the exact point at which `accepted` becomes true, durable idempotency scope and retention, receipt lookup, payload conflict behavior, and the crash windows between recording a request and publishing it. Unknown outcomes require reuse of the same key and a queryable receipt. They are not permission to generate a new request automatically. Backend execution remains application-owned and may require its own deduplication. [S02]

Do not use a broker acknowledgment as proof of successful business execution. Show command acceptance, observed outcome, timeout/unknown, rejection, and expiration as distinct facts. Test replayed or out-of-order outcome events and command-version changes. Reusing the V2 persistence layer may be sensible, but only if its retention and transactional boundaries satisfy commands; “we already have a database” is not the design.

### 6.2 V3.1: governance should be an optional operating layer

Preserve workspaces, environments, roles, immutable configuration artifacts, revision checks, promotion, rollback, and audit records as the planned increment. Treat this as a platform-team workflow rather than an obligatory new setup step for every application developer. [S02]

Research the workflow from developer proposal through validation, staging, approval, production rollout, and rollback. Verify that each role can do only what it needs. Configuration revisions should identify compatible handler artifacts and external secret references without exposing credentials. Rollback should restore a compatible deployment artifact, not imply that already-published messages or business actions were undone.

The management surface’s security boundary changes substantially when it moves from local development into shared operations. Require its own threat model and negative tests. Do not gradually expose local-only administrative endpoints and assume a login screen makes them safe. The WebSocket security guidance is a baseline input; operator authorization, deployment control, and retained-data privacy require additional project-specific analysis. [S03] [S28]

### 6.3 V3.2: prove semantic equivalence before adding transports

The existing plan keeps Socket.IO and adds plain WebSocket, with SSE later. Preserve that sequence absent a documented blocker that justifies an owner-approved change. Extract a transport-independent behavior suite before implementing the new adapter. Test the same lifecycle, permissions, delivery modes, control-message ordering, cancellation, recovery, and errors through both paths. [S02]

A different wire protocol is not itself a product improvement. Compare actual integration constraints and operating results. Capability negotiation must refuse unsupported behavior rather than falling back to a transport that quietly weakens recovery or authorization.

## 7. Beyond V3: keep options, not accumulating promises

| Candidate | Evidence that should justify a bounded increment | Principal guardrail |
| --- | --- | --- |
| SSE | A concrete one-way deployment/browser requirement not met well by supported paths. | Define auth, reconnect, resume, and any HTTP acknowledgment/command channel. |
| Protobuf / more codecs | A documented source format requirement in a target integration. | Codec-specific evolution and type-generation tests. |
| Additional brokers | A real use case with a materially different source contract. | No lowest-common-denominator promise of identical ordering or durability. |
| Additional SDKs/frameworks | A repeatable integration need outside current TypeScript/React support. | Lifecycle and platform-specific suspension/cleanup behavior. |
| Managed hosting | Evidence that operating burden, rather than missing runtime capability, blocks use. | Separate tenant isolation, metering, service operations, support and commercial scope. |
| Multi-region | A specified latency, residency, or resilience requirement. | Explicit consistency, failover, retention and cost policy. |
| Transformations / joins | A bounded derived-feed job not responsibly handled by application mapping. | Do not smuggle a stream processor into mapper callbacks. |
| Archive / long-term replay | A recovery need beyond the supported hot window. | Indexing, deletion/privacy, restoration and replay budgets. |
| AI-assisted configuration / diagnosis | Deterministic diagnostics already explain the relevant failure classes. | Reviewable suggestions; no silent production changes, invented guarantees, or uncontrolled payload disclosure. |

These are the existing beyond-V3 candidates, with proposed entry tests. They remain options, not release promises. No presumed market size or numerical demand threshold is supplied by this review. [S02]

## 8. Research program and decision gates

The companion execution plan contains 14 research packets. Each has a question, method, evidence artifact, dependency, and exit condition. The work is partitioned so a question blocks only the capability whose correctness depends on it.

| Packet | Question to resolve | Decision served |
| --- | --- | --- |
| R01 | What is implemented, released, verified, and still only planned? | Current claims, release/launch status and documentation authority. |
| R02 | Which competitor contracts and integration burdens actually overlap? | Honest differentiation and optional comparative trial selection. |
| R03 | What must an adopter provide for coherent state synchronization? | V1 integration contract, outbox/reference recipes, failure diagnostics. |
| R04 | Can the supported single-gateway deployment be monitored and recovered safely? | Bounded operational hardening and compatibility expansion. |
| R05 | Which durable store and admission design satisfy the chosen failure model? | V2.0 architecture. |
| R06 | What exactly is a durable client checkpoint? | V2.0 SDK and application-processing contract. |
| R07 | How do retention, replay, current permissions and budgets interact? | V2.0 safe recovery and cost envelope. |
| R08 | How do ingestion, connections, fencing and revocation coordinate? | V2.1 distributed operation. |
| R09 | How do schema, cluster and filter changes affect identity and compatibility? | V2.2 and explicit placement of matrix-only commitments. |
| R10 | Does generation, rehearsal and diagnosis reduce integration work? | Developer experience improvements and support evidence. |
| R11 | What durable request/outcome contract adds value over the application API? | V3.0 commands. |
| R12 | How can teams safely promote and roll back integrations? | V3.1 governance. |
| R13 | Can another transport preserve the same product semantics? | V3.2 adapter. |
| R14 | Which later expansion solves a demonstrated additional job? | Beyond-V3 decisions and operating-cost review. |

### 8.1 Evidence levels

Use four labels throughout the project: **documented**, **observed in a reproducible project test**, **observed in an external integration**, and **hypothesis/recommendation**. A vendor sentence and a passing local test are not interchangeable. An external trial provides useful context without becoming a statistically representative survey.

Record failures and contradictory observations, not just favorable demonstrations. A report of feature absence should distinguish “not documented in the sources examined” from “tested and unavailable in this version.” A performance result needs a workload and environment, not a marketing adjective.

### 8.2 Gates that advance development without creating a research moratorium

**G0 — Baseline clarity:** source/claim inventory, authority reconciliation, and current release/launch status recorded. This is a small documentation gate, not proof of product-market fit.

**G1 — V2.0 design readiness:** approved store/ordering/checkpoint/retention ADRs and executable failure scenarios. No requirement for a competing prototype or a signed customer.

**G2 — V2.0 release readiness:** declared crash, cursor, authorization, replay and compatibility scenarios pass with retained evidence; outstanding limitations match public claims.

**G3 — V2.1/V2.2 readiness:** distributed ownership and integration contracts have independent verification; state-only deployments retain their previous dependency boundary.

**G4 — V3 increment readiness:** commands, management and transport each have their own evidence packet. Passing one does not authorize the others.

**G5 — Expansion approval:** an owner decision states the new job, expected value, dependency/support cost, and explicit exclusions. Interesting technology alone does not pass this gate.

## 9. How to compare and measure fairly

### 9.1 Separate three experimental tracks

**State track:** authoritative snapshot plus current-state updates. Compare convergence, invalidation, reconnect behavior, snapshot load, integration code, and diagnosis. Centrifugo and a competent DIY implementation are the first optional executable comparisons.

**Retained-event track:** independently meaningful events, durable admission, client checkpoint persistence, bounded retention, and explicit recovery failure. Do not compare a cache configuration to a durable contract and call the difference a speed win. Record the extra storage and application code needed by each implementation.

**Command track:** authorized request, durable acceptance, receipt lookup, correlated business outcome, and ambiguous failures. Compare with a well-designed existing HTTP endpoint; sending a WebSocket message is not equivalent to the promised command lifecycle.

The benchmark protocol supplies scenarios and evidence fields. No comparative implementation or performance result is claimed in this report.

### 9.2 Metrics that reflect the product promise

| Measure | What to record | Common misinterpretation to avoid |
| --- | --- | --- |
| Time to trustworthy feature | Setup through auth, failure rehearsal, cleanup, export and diagnosis; prerequisites listed separately. | Calling time to first message the total integration cost. |
| Diagnosis accuracy and time | Correct failing stage and safe next action for seeded incidents. | Counting an error toast as a useful diagnosis. |
| State convergence | Expected state/revision at a defined boundary, stale detection, and recovery time. | Treating connection uptime as freshness. |
| Event continuity | Accepted unique events handled within the contract, duplicates, explicit unavailable ranges. | Counting duplicate transport receipts as completed processing. |
| Resource behavior | Total process memory, queue bytes, store I/O, snapshot/replay load and healthy-client latency. | Treating a queue cap as a cap on all memory. |
| Adoption/maintenance effort | Custom code, permissions setup, schema changes, upgrades and support interventions. | Treating stars or one happy-path demo as durable adoption. |

Performance runs should pin source/package versions, infrastructure, schemas, payload size, event rate, fanout, retention, client behavior and fault timing. Report repetitions, distributions, and failed runs. Use an independent oracle for expected state/event sets rather than asking the same implementation to declare itself correct.

### 9.3 Model operating cost without pretending to have market prices

Use a transparent cost model: gateway/ingestion compute + retained storage and indexes + replication/backups + network egress + replay/snapshot work + engineering/support time. Managed competitors need the same workload and region assumptions. An MIT-licensed component is not automatically cheaper to operate, and a hosted service’s fee is not its entire integration cost.

**Illustrative arithmetic, not observed StreamOtter traffic:** 1,000 accepted logical events/second at 500 bytes each produce 43.2 GB of payload per day before indexes, metadata, replication, backups, or per-channel materialization. Retaining event history can change the operating footprint materially even before browser fanout. Store logical data once where safe; quantify rather than assume the effect of each index and projection.

Do not publish a cost-per-million-message comparison until “message” has the same meaning across source records, mapped events, fanout deliveries, and replay attempts.

## 10. Risks and explicit non-goals

The principal strategic risk is feature accumulation that makes the original integration harder. Preserve a short, production-honest state workflow and keep the diagnostic experience coherent as modes multiply.

The principal engineering risk is describing guarantees more strongly than the actual persistence, ordering, or permission boundary supports. In V2, durability configuration and checkpoint behavior are part of the feature. In V3, ambiguous outcomes and rollback limits are part of the interface—not documentation footnotes.

The principal evidence risk is overinterpreting internal tests, vendor claims, or isolated developer reports. Measure improvements where possible; label uncertainty where not. Do not convert this report into claims of unique invention, enterprise certification, independent audit, proven market demand, or comparative superiority.

The principal maintenance risk is supporting too many combinations at once: stores, brokers, codecs, transports, SDKs and deployment topologies multiply the test matrix. Support one explicit path well before generalizing, keep compatibility boundaries visible, and retire speculative abstractions that do not serve a shipped capability.

**Do not add by implication:** global exactly-once processing, indefinite offline delivery, omniscient freshness detection, mobile push, a workflow engine, a general stream processor, multi-region consistency, or a managed SaaS business. These require separate product decisions and contracts.

## 11. Recommended first work packet

Start R01–R04 and the R05 design investigation. This means reconciling status, updating the contract-level competitor matrix, tightening the application integration guide, and defining production health and store requirements. Extend existing deterministic fixtures while V2 design proceeds. Do not pause development to recruit users or rebuild every competitor.

Before implementing V2’s store, publish the architecture decision and failing tests for its crash boundaries. Before claiming scale, test clients and ingestion owners on different nodes. Before promising commands, prove receipts under ambiguous outcomes. Before adding a new ecosystem, state which user job makes its permanent support cost worthwhile.

The project can remain ambitious without becoming unfocused. Its strongest organizing idea is already present: **make live application behavior easier to understand, verify, and maintain.** V2 and V3 should deepen that promise, not replace it with a longer feature list.

## Package guide and sources

`RESEARCH_EXECUTION_PLAN.md` contains the 14 actionable research packets. `ROADMAP_TRACEABILITY.md` maps existing commitments to proposed research and identifies sequencing decisions that still need approval. `BENCHMARK_PROTOCOL.md` defines three tracks and 28 scenarios without claiming results. `RESEARCH_HANDOFF.md` gives a bounded instruction to the project team. `SOURCES.md` and `source_manifest.json` provide the evidence register.

**Repository evidence:** [S01] Founding direction; [S02] roadmap; [S03] V1 API; [S04] implementation status; [S05] deployment; [S06] existing research; [S07] site/demo plan; [S08] selected synchronization tests; [S09] documentation index.

**Competitor evidence:** [S10] Centrifugo state integration; [S11] recovery; [S12] consumers; [S13] Ably Kafka connector; [S14] Ably Models; [S15] Lightstreamer product; [S16] connector reference; [S17] Aklivity editions; [S18] Zilla SSE; [S19] Zilla HTTP; [S20] Socket.IO guarantees; [S21] recovery.

**Engineering references:** [S22] Kafka design; [S23] PostgreSQL isolation; [S24] Redis persistence; [S25] Debezium outbox; [S26] schema evolution; [S27] AsyncAPI messages; [S28] OWASP WebSocket security.


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
