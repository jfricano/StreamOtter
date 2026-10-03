# StreamOtter V1.1 — Implementation handoff and roadmap amendment

**Date:** September 28, 2026\
**Status:** Execution brief accompanying the approved specification revision 1.0 and ADR-15A/B/C; implementation remains pending.\
**Purpose:** Prepare and implement the bounded V1.1 increment after product approval. This package itself has not modified the repository or authorized a production deployment.

**Owner amendment — October 1, 2026; reconciled October 2:** The next planned increment is **V1.1**, renamed from V1.5. The approved revision 1.0 source-failure specification and September 29 decisions remain in force. ADR-15A/B/C keep their stable decision IDs. This milestone label does not change npm or protocol versions. Lontra Creek separately owns replacing its existing `/workbench/` tour with the actual workbench UI in an isolated synthetic visitor sandbox; no new page is added.

## 1. Read first

Read the current `docs/FOUNDING.md`, `docs/API_AND_FEATURE_ROADMAP.md`, `docs/V1_API.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/DEPLOYMENT.md`, relevant source/contract code, and this package. Compare the working branch to inspected baseline `7b406780dd52c921cf88a98834e81e1677fc4a8d`. Reconcile relevant changes rather than overwriting them.

Use the final Future Strategy package's R01–R14 IDs for traceability. Do not mix them with the earlier interrupted R00–R14 research backlog. This V1.1 specification is a new proposed increment and supplements the final research package.

## 2. Copy-ready lead instruction

> Act as the StreamOtter engineering lead for the approved V1.1 “Contain, explain, recover” increment. Preserve the existing V1 application contract by default and implement the exact approved additions in `V1_1_SOURCE_FAILURE_SPEC.md`. Maintain a small durable task/decision/evidence record and use bounded parallel work only after shared types and ownership boundaries are defined.
>
> First verify the repository baseline and current release/launch state. Read and preserve the approved ADR-15A/B/C for incident-journal/handoff durability, application recovery barriers, and local operator/reprocessing authority; do not restart their settled decisions. Close ordinary engineering decisions within the product contract; escalate changes to guarantees, scope, new external service dependencies, public privileges, or release order.
>
> Keep KafkaJS inside the existing internal adapter. Do not add Kafka-Penguin as a runtime wrapper. Do not install a public generic error-policy plugin interface. Preserve source offset, epoch, authorization, and cancellation ownership. The selected initial algorithm is acknowledged quarantine append before source commit, with stable incident IDs and explicitly possible duplicate evidence—not a claimed atomic or exactly-once transaction.
>
> Implement slices A–E and the F01–F48 scenario families. Quarantine-hold is the first working vertical slice. Guarded continuation requires a persistent cumulative application recovery boundary; merely fetching a new snapshot is insufficient. The legacy `resumeSource` call cannot bypass new safety state when failure handling is enabled.
>
> Make reprocessing narrow. Retrying a blocked record uses the original uncommitted position. Stored dry-run evaluates one original. Approved stored redrive is gateway-local re-evaluation through the current state pipeline; it neither edits the original nor publishes to business topics, rewinds consumer groups, or provides durable browser replay. Report superseded and unknown outcomes honestly.
>
> The new incident journal and Kafka producer are opt-in costs of durable quarantine. Ordinary V1 installs must require neither. Keep one gateway and one Kafka cluster. Do not select this incident journal as the V2 delivery store without a separate V2 ADR.
>
> Build one shared operator service used by local IPC/CLI, in-process callers, and development-only management. Production does not expose the development workbench. Read-only health probes are separate and minimal. Raw evidence is sensitive and untrusted; default diagnostics/exports are redacted.
>
> Deliver and publish the frontend/integration contract described in specification §10, with native synthetic-fixture and packed/published-install evidence under F44/F46. Keep native development/production authority intact. Lontra Creek owns the synthetic hosted sandbox and its own LC11 acceptance; do not implement visitor hosting in this library repository or wait for site launch to publish the library. Coordinate supported capabilities rather than matching milestone labels or release dates.
>
> Keep repository type declarations, validation, CLI examples, docs, and tests synchronized. Use independent expected-result data for fault tests. Record failed runs and actual environments. Do not declare success from screenshots, typechecking alone, agent agreement, or test files that have not run.
>
> Deliver an integrated release candidate, a requirement-to-evidence matrix, a migration/runbook, known limitations, and a product acceptance packet. Do not publish packages, push changes, buy infrastructure, or modify production unless separately authorized in the implementation session.

## 3. Engineering ownership and dependencies

| Responsibility | Starts | Owns |
| --- | --- | --- |
| Contracts/runtime lead | Slice A | Taxonomy, process outcomes, recovery barrier, invariants and state transitions. |
| Storage/adapter engineer | After A | Byte evidence, bounded journal, producer, offset reconciliation, restart and cancellation. |
| SDK/synchronization reviewer | A through C | Snapshot coverage, source epochs, old/new subscriptions, access and revision behavior. |
| Tooling/UI engineer | After operator contracts | CLI/local IPC, Failures view, exports and health integration. |
| Independent QA/security | A through release | Expected-results model, crash tests, permissions, privacy, packaged deployment. |

These are assignable responsibilities, not a requirement to hire five people or spawn five concurrent agents. Avoid concurrent edits to shared state-machine and contract files. Integrate each slice into a reviewable working branch before widening parallel work.

## 4. Three early ADRs

**ADR-15A — Failure durability and progress.** Select the embedded journal implementation, schema/migration/locking, acknowledged producer settings, limits, pending raw spool, incident identity, retention, restart/restore rules, and exact adapter reconciliation path. Document process-crash versus disk/broker-loss guarantees. Tests F10–F18 and F27–F30 must cover it.

**ADR-15B — Application recovery boundary.** Define guard/snapshot signatures, cumulative context, current/future subscribers, channel/version changes, source-wide impact, and unsupported cases. Include a working reference application that derives coverage from independent authoritative facts. A handler that merely returns `true` without a documented domain contract is not sufficient. Tests F20–F26 govern it.

**ADR-15C — Remediation authority and reprocessing.** Define IPC permissions/session checks, guarded incident revision operations, plan binding, handler artifact identity, exactly what evaluation and live reprocessing can affect, ambiguous results, and redacted exports. Tests F31–F40 govern it.

No unresolved architecture question should be concealed behind a permissive default. If implementation would materially enlarge V1.1, return a narrow decision packet rather than silently building V2/V3.

## 5. Roadmap placement — already recorded

Retain this increment after V1 launch/polish and before V2.0, subject to the current launch gate. The roadmap already records it; this amendment renames its label and links:

| Increment | Deliverable | Depends on |
| --- | --- | --- |
| **V1.1 — Contain, explain, recover** | Native source-failure policy, protected Kafka quarantine, persistent local incident state, guarded snapshot recovery, controlled single-record reprocessing, failure console, local operator tooling and minimal health probes. | V1 state contract; explicit failure-handoff/recovery ADRs; private operator boundary; verified release candidate. |

Add a feature-matrix note: V1.1 quarantine retains **failed source-record evidence**, not an event feed or durable browser history. All V2/V3 assignments remain unchanged. Insert a link to the new specification and its acceptance plan; avoid copying the behavioral text into several competing documents.

Proposed document locations:

```text
docs/releases/v1.1/
  V1_1_SOURCE_FAILURE_SPEC.md
  V1_1_ACCEPTANCE_PLAN.md
  V1_1_IMPLEMENTATION_HANDOFF.md
```

Update the documentation index, V1 API's refinement references, implementation status, deployment guide, changelog, and security/retention notes only to reflect approved and actually implemented behavior. Resolve the roadmap's stale “no implementation released” header without turning future features into current claims. The PDF is a reading copy; Markdown is the editable specification.

## 6. Research crosswalk

| Final research packet | V1.1 use |
| --- | --- |
| R01 — Baseline/claims | Current-versus-proposed behavior, version provenance, accurate launch and support status. |
| R03 — Adopter consistency | Recovery guard, snapshot coverage, and source-omission limitations. |
| R04 — Single-gateway operations | Safe health checks, poison remedies, TLS/browser checks, shutdown/restart and support matrix. |
| R05 — Durable admission | Reuse fault-method principles only. V1.1 does not choose or deliver the V2 history store. |
| R10 — Developer workflow | Failure rehearsal, diagnostic comprehension, source-controlled configuration and released-package consumption. |

## 7. Final acceptance packet

Return the exact baseline-to-release diff summary; approved ADRs; scenario evidence with failed runs retained; dependency and resource changes; verified compatibility matrix; permission/retention configuration; rollback/rebaseline runbook; remaining limitations; and recommended release status. Distinguish “implemented,” “independently verified,” and “published.”

The key product question is: **Can the integrator resolve a bad source record with less improvised machinery, while still knowing exactly what the source and browser state do—and do not—establish?**
