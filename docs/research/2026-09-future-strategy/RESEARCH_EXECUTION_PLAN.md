# StreamOtter research execution plan

**Date:** 28 September 2026  
**Status:** Proposed work packets; research execution and product changes are not yet authorized by this document alone.  
**Authority:** Preserve `docs/FOUNDING.md`, `docs/API_AND_FEATURE_ROADMAP.md`, and the exact current API contract.  
**Baseline:** `jfricano/StreamOtter@7b406780dd52c921cf88a98834e81e1677fc4a8d`.

## Operating rules

Run bounded research alongside implementation. A design question blocks only the feature whose guarantee depends on it. Keep external interviews, design partners, usability studies and comparative implementations optional; the existing founding direction does not make them prerequisites. A source-based comparison is not an executed benchmark. [S01] [S02]

Every packet produces: the question; source/version inventory; observations and counterexamples; options; a recommendation; the specific decision it supports; limitations; and reproducible evidence where execution occurred. Use a separate verifier for consequential correctness claims. Keep accepted decisions in the repository, not only in agent conversations.

Suggested responsibility names below are roles to assign, not claims that a team has been assembled. The product owner approves material scope/sequence/dependency changes. The technical lead owns bounded engineering decisions within approved scope. QA/security reviewers independently challenge evidence.

## R01 — Baseline and claims reconciliation

**When / owner:** Now; documentation/release lead with product owner review.

**Question:** What is currently implemented, packaged, documented, independently verified, and only planned?

**Method:** Pin current commit and packages. Reconcile roadmap planning language against implementation status and changelog. Verify release provenance through tags/registry/CI when access is available. Consult Lontra Creek’s separate Gate B evidence without assuming runtime Gate A proves launch readiness. Check the generator/file-writing separation request. Inventory every public claim of freshness, recovery, durability, scale, production support, and uniqueness. [S02] [S04] [S07]

**Artifact:** `claims-register.md`, with claim, version, source, evidence level, limitation, owner, and last check; small documentation patch proposal.

**Exit:** No identified public claim silently conflates planned capability with shipped behavior. Unverified launch/support status remains explicit. Findings here can correct documentation without reopening the whole product plan.

## R02 — Contract-level competitive comparison

**When / owner:** Now, then before material public comparison; research lead.

**Question:** What user work do alternatives actually remove, under which contracts and editions?

**Method:** Maintain the comparator matrix for Centrifugo, Ably Kafka/Models, Lightstreamer, Zilla, and competent DIY. Record snapshot integration, recovery cache versus authoritative retained delivery, checkpoint timing, permission revalidation, diagnostics, deployment dependencies, license/edition, and application responsibilities. Resolve unknowns through official docs or a narrow optional trial; never turn a missing document into proof of missing functionality. [S10] [S11] [S12] [S13] [S14] [S15] [S17] [S20]

**Artifact:** `competitor-contracts.md`, dated/versioned, each cell Documented / Observed / Unknown; optional executable comparison proposal with a stop condition.

**Exit:** A defensible explanation of overlap and testable differentiation. No required winner, price ranking, competitor reimplementation, or demand forecast.

## R03 — Adopter state-consistency contract

**When / owner:** Now; integration engineer and independent reviewer.

**Question:** Can an ordinary target application supply the revision, snapshot and publication boundary V1 requires?

**Method:** Extend a reference app with controlled transaction/publication timing. Test snapshots ahead and behind, duplicates, noncontiguous revisions, conflicting equal revisions, numeric precision, deletion/recreation, and deliberately unsupported partition reassignment. Include an explicit example of an upstream omission that the runtime cannot detect. Describe an application-owned outbox recipe without requiring that every adopter use the same database or CDC product. [S03] [S08] [S25]

**Artifact:** An integration recipe, prerequisites checklist, executable source-contract scenarios, and a responsibility diagram expressed in text or code.

**Exit:** The supported path converges correctly; invalid assumptions fail visibly where detectable; undetectable upstream omissions are disclosed rather than misrepresented as automatically covered.

## R04 — Single-gateway operational envelope

**When / owner:** Now / bounded V1.x; runtime and operations lead.

**Question:** What minimal hardening makes the declared deployment monitorable and recoverable?

**Method:** Propose separate process liveness, readiness and source status with no development-management exposure. Exercise source outage, source poison/resume, restart session timing, reverse proxy, WebKit/Firefox, publicly trusted TLS and one explicitly selected broker/service extension. Confirm the existing KafkaJS adapter workaround remains isolated and version-tested; do not rewrite solely from age or a maintainer anecdote. Expand support only where evidence exists. [S04] [S05]

**Artifact:** Proposed operational contract, support matrix, repeatable deployment checks, restart/runbook evidence.

**Exit:** Health accurately distinguishes failure classes without leaking secrets or causing automatic restart loops. Claimed platform combinations have named test results; all other combinations remain unverified.

## R05 — Durable delivery-store and admission ADR

**When / owner:** Before V2.0 store implementation; principal engineer, storage reviewer.

**Question:** What persistence topology can honestly support the retained-delivery contract?

**Method:** Specify failure scope and durability settings before selecting technology. Evaluate a PostgreSQL reference design and at most one justified alternative, such as Redis Streams, under equivalent persistence requirements. Examine atomic uniqueness, channel sequence allocation, commit visibility, retention deletion, source incarnation, generation changes, notification loss, backup/restore, and migrations. Fault-inject every boundary around append and Kafka commit. A restore must not reuse a cursor generation if continuity is no longer valid. [S02] [S22] [S23] [S24]

**Artifact:** Storage ADR; failure-model table; crash-boundary tests; schema/migration sketch; operating-cost model. Mark all unexecuted experiments unexecuted.

**Exit:** One supported reference topology selected. Accepted-event identity survives retries; source progress never outruns required durable admission. Any data-loss exception is explicit, bounded and product-approved—not hidden in default configuration.

## R06 — SDK checkpoint and application-processing contract

**When / owner:** Before V2.0 SDK API freeze; SDK lead.

**Question:** What does an advanced checkpoint prove, and what can repeat?

**Method:** Test async handler success/failure, durable-checkpoint failure, termination between side effect and checkpoint, multiple tabs, account switching, expired tokens, parameter canonicalization and concurrent resume. Investigate whether consumers share or independently own checkpoints; do not let identical keys create an accidental competing-consumer model. Preserve state-mode synchronous receipt semantics. [S02] [S03]

**Artifact:** Checkpoint ADR, consumption-style API examples, compatibility tests, duplicate-tolerant reference handler.

**Exit:** Durable checkpoint timing is observable and documented. Redelivery is safe in the example; no claim that arbitrary external side effects are exactly once. A history inspection cannot move a live checkpoint.

## R07 — Retention, replay fairness and permission changes

**When / owner:** Before V2.0 release; runtime/security reviewers.

**Question:** How does replay remain complete within its contract, bounded, and authorized?

**Method:** Define retention by time/count/bytes as applicable; test boundary races during paging, cursor expiration, source/mapping generation changes and unavailable stores. Test replay while live traffic continues, reconnect storms, hot channels, slow handlers and permission revocation mid-page. Decide how authorization interacts with gaps without disclosing protected data. Test replay cancellation and diagnostic previews independently of live subscribers. [S02] [S28]

**Artifact:** Replay policy ADR, authorization matrix, fairness budgets, test evidence and capacity envelope.

**Exit:** No silent tail jump for event channels. Unavailable ranges are explicit. Revocation is enforced under the specified model. Healthy users remain within the approved workload envelope; observed limits are documented, not generalized.

## R08 — Multi-gateway ownership, fencing and revocation

**When / owner:** Before V2.1 implementation and release; distributed-systems lead.

**Question:** How do ingestion owners and connection owners cooperate without relying on one node’s memory?

**Method:** Start with the selected store. Use clients connected to non-ingesting nodes; kill or partition owners; reassign partitions; drop notifications; delay stale owners; reconnect clients to another node; drain a gateway; lose access to revocation state. Define fencing and policy-freshness limits before tests. Test shared revocation both in normal operation and under partitions. [S02] [S22]

**Artifact:** Ownership ADR, topology/runbook, safety and liveness test results, scoped revocation bound.

**Exit:** Stale ingestion ownership cannot corrupt the retained stream; missed wakeups cannot become lost events; cross-node client movement preserves declared recovery; unauthorized delivery does not continue beyond the approved failure policy.

## R09 — Schemas, clusters, filtering and configuration evolution

**When / owner:** Begin design during V2.0; complete before assigned V2 increments; contracts/integration lead.

**Question:** Which changes alter decoding, delivery identity, or public compatibility?

**Method:** Follow JSON Schema/Registry before Avro. Test nullable/union/logical representations, public JSON generation, invalid records and mixed producer versions. Check public type generation against runtime validators. Define source incarnations across independent clusters. Bound filter expressiveness and its effect on cursor identity, authorization and query cost. Place each broad feature-matrix commitment in an explicit increment. [S02] [S26]

**Artifact:** Compatibility ADR and fixtures; feature ownership/sequence proposal; configuration migration checks.

**Exit:** Registry compatibility is never treated as proof of public semantic compatibility. Independent sources cannot collide in identity. Unsupported transformations fail clearly rather than becoming an accidental stream-processing language.

## R10 — Developer workflow, generated artifacts and diagnostics

**When / owner:** Continuous in bounded slices; developer-experience lead.

**Question:** Does the complete workflow actually reduce configuration, recovery and diagnosis work?

**Method:** Use the fixture and installed-package paths to record time to a trustworthy feature, seeded-failure diagnosis and corrective steps. Record developer familiarity and supplied prerequisites. Add React lifecycle checks and AsyncAPI consistency checks at V2.2. Keep internal walkthroughs separate from optional unassisted external integrations. Verify exported work runs without the workbench, and the demo consumes released packages rather than repository internals. [S01] [S02] [S07] [S27]

**Artifact:** Workflow scorecard, friction backlog, generated-artifact contract tests, failure-rehearsal recipes.

**Exit:** Specific friction reductions have evidence. No invented external time saving or usability superiority. Team can identify exactly which confusing step the next improvement removes.

## R11 — Commands, durable acceptance and business outcomes

**When / owner:** Before V3.0; API/runtime lead with security review.

**Question:** What additional value does the command interface supply over an existing application endpoint?

**Method:** Specify named command authorization, idempotency scope and retention, payload conflicts, durable handoff/outbox, receipt lookup, timeouts and unknown outcomes. Test crashes before/after publication and receipt persistence, duplicate/out-of-order business outcomes, expired requests, and replay attempts across principals/versions. Compare conceptually with a well-designed HTTP endpoint; optional executable comparison is not required to proceed. [S02] [S25]

**Artifact:** Command ADR, state/receipt contract, threat model, fault suite, reference request-to-outcome application.

**Exit:** No arbitrary browser-to-topic publishing. `accepted` never means business completion. Ambiguous retry uses a stable identity, and neither the gateway nor example silently duplicates business effects.

## R12 — Team/environment operations and management isolation

**When / owner:** Before V3.1; platform lead and independent security reviewer.

**Question:** What does safe collaborative promotion and rollback require beyond the local workbench?

**Method:** Model viewer/operator/deployer workflows and tenant/environment boundaries. Test immutable artifacts, secret references, handler version compatibility, optimistic concurrency, unauthorized cross-workspace reads, partial rollout, rollback, and audit tampering/retention policy. Decide hosted versus self-operated boundaries explicitly; team workspaces alone do not authorize a hosted service. [S02] [S03] [S28]

**Artifact:** Management threat model, access matrix, deployment ADR, promotion/rollback tests, operational runbook.

**Exit:** A deployment action is attributable and bounded. Rollback is described as configuration deployment, not reversal of source events or business side effects. Ordinary V1/V2 adoption still requires no team workspace.

## R13 — Transport conformance

**When / owner:** Before V3.2; SDK/transport lead.

**Question:** Can plain WebSocket deliver the same negotiated behavior without a silent downgrade?

**Method:** Extract protocol-independent scenario definitions and run through Socket.IO and the new adapter. Cover connect, auth, expiration, cleanup, loss, resume, unsupported capabilities, limits, errors, command receipts and version negotiation. Measure real deployment constraints rather than assuming protocol minimalism improves the product. Record SSE as later work unless an owner-approved blocker changes the sequence. [S02] [S20] [S21]

**Artifact:** Adapter contract, conformance runner, compatibility matrix, migration notes.

**Exit:** Same promised semantics under both supported adapters. Any unavoidable difference is explicit and capability-gated; fallback never pretends to preserve a guarantee it cannot supply.

## R14 — Later opportunities, economics and support footprint

**When / owner:** At roadmap reviews, not as continuous speculative building; product/technical leads.

**Question:** Which additional job justifies another permanent operating and support burden?

**Method:** Evaluate each beyond-V3 option against the trigger and guardrail in the main report. Model compute, storage, retention, fanout, egress, support and migration with an explicit workload. Record current pricing/license assumptions only after fresh verification. Consider optional evidence from actual adoption without declaring small samples representative. Review whether state-only users are paying complexity costs for unrelated features. [S01] [S02]

**Artifact:** One decision brief per candidate: job, evidence, bounded scope, dependencies, cost assumptions, risk, alternatives, exclusions and owner decision.

**Exit:** Promote, defer, decline, or investigate narrowly. No feature enters the committed roadmap solely because competitors list it or an agent can implement it quickly.

## Sequencing and work-in-progress

Begin R01/R02 documentation synthesis, R03/R04 bounded baseline work and R05 architecture questions. R06/R07 can progress alongside the chosen V2.0 store design. R08 depends on a usable store contract, not a fully finished marketing launch. R09/R10 should expose adoption issues early without silently moving their release commitments. R11–R13 begin before their respective API freezes. R14 is a periodic decision review.

Keep a research task’s result separate from implementation acceptance. A recommended architecture is not a passed fault test; a passed test is not a released capability. Use these statuses: proposed, investigating, evidence ready, decision recorded, implemented, independently verified, released. Link any skipped or accepted-risk scenario to an owner-approved limitation.

## Decision-packet template

```text
ID / date / owner:
Question and affected roadmap increment:
Authority and currently approved scope:
Evidence (source IDs, versions, test artifacts):
Counterevidence / failed tests / unknowns:
Options and consequences:
Recommendation and rationale:
Compatibility / security / operating cost:
Decision needed from: technical lead | product owner
Accepted decision and explicit exclusions:
Implementation tasks:
Verification tasks and independent reviewer:
Revisit trigger:
```

Proposed evidence storage: `docs/research/`, with runtime-changing ADRs in the project’s chosen ADR location and reproducible tests in the test tree. Do not put secrets or customer payloads in evidence bundles.


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
