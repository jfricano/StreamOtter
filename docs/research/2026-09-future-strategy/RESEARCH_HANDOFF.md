# StreamOtter research-to-roadmap handoff

**Prepared:** 28 September 2026  
**Purpose:** Give the delivery team a bounded instruction for using the accompanying research. This document does not itself authorize repository writes, paid services, external outreach, or production changes.

## Copy-ready instruction for the project lead

You are the delivery/research lead for StreamOtter. Use this report package to sharpen evidence and implementation decisions for the existing roadmap, not to replace the founder’s product direction.

First inspect the current `docs/FOUNDING.md`, `docs/API_AND_FEATURE_ROADMAP.md`, `docs/V1_API.md`, `docs/IMPLEMENTATION_STATUS.md`, and deployment/site plans. The report reviewed `jfricano/StreamOtter` at commit `7b406780dd52c921cf88a98834e81e1677fc4a8d`; reconcile changes since that snapshot. The founding document owns mission, the roadmap owns sequencing, and exact current contracts supersede illustrative forecast APIs. Product milestones are not automatically breaking SemVer or protocol releases.

Preserve the owned Node/TypeScript gateway, the application-owned business logic, the lightweight state-only workflow, the workbench/runtime separation and explicit delivery limits. Do not substitute a competing gateway, require a new durable store for every state-only deployment, move SSE into current scope, add hosted service operations, or change product promises without approval.

Prepare a bounded work plan from R01–R14. Start baseline/claims reconciliation, the contract-level competitor matrix, source-consistency integration work, production-envelope checks, and the V2 storage design investigation. Use the existing tests and examples wherever practical. Research must not become a blanket development freeze. Customer interviews, design-partner recruitment and competing prototypes are optional—not release prerequisites under the current founding direction.

For each packet, record the exact question, sources and versions, observations, counterevidence, architecture/product decision, implementation implications, limitations, and independent verification. Treat repository-reported results as reported until reproduced. Treat vendor documentation as described capability, not comparative performance. No result may be marked passed without evidence. Keep failed runs and uncertainty visible.

Before V2.0 implementation, resolve durable admission, source identity, ordering, cursor generation, checkpoints, retention and replay budgets. Before V2.1, resolve ingestion versus connection ownership, fencing and shared revocation. Before V3.0, resolve durable command acceptance, ambiguous outcomes and idempotency. Before V3.1, resolve operator/environment isolation. Before V3.2, establish transport-independent conformance.

The report proposes a bounded V1.x health/compatibility pass and explicit placement of matrix-only V2 commitments. Present those as short owner decision packets rather than silently editing scope. Ordinary engineering details within an approved contract remain the technical lead’s responsibility. Batch nonurgent product decisions and explain tradeoffs.

Keep the source register, research findings, decision log, support matrix and reproducible tests in durable project artifacts. Do not send private payloads to outside services or enable public management endpoints as a research shortcut. Obtain approval before paid benchmark infrastructure, account creation, external outreach or production changes. Supply a final research disposition showing which questions are resolved, what remains unknown, which increments can proceed, and which narrow decisions still need the owner.

## Suggested repository placement

The package is standalone. A project maintainer can place it under a directory such as `docs/research/2026-09-future-strategy/`, with links from the existing research brief and roadmap. Preserve those documents’ authority rather than replacing them with this report. Do not duplicate source registers into competing mutable copies without a clear owner.

## Required output of the first work packet

1. A current-baseline delta from the inspected commit, including release and public-demo status.
2. A claims register and contract-level competitor matrix with unknowns visibly marked.
3. A short decision packet for V1.x operational hardening and placement of matrix-only V2 features.
4. A V2 storage/identity/checkpoint ADR outline with explicit failure model and executable test plan.
5. A bounded implementation/research sequence with verification owners and no implied customer-discovery hold.

## Research finding template

```text
Finding ID and date:
Question / affected increment:
Classification: documented | reproducibly observed | externally observed | hypothesis
Sources / pinned versions:
What the evidence establishes:
What it does NOT establish:
Counterevidence or alternative explanation:
Recommended action:
Scope / dependency / compatibility impact:
Decision owner and disposition:
Evidence artifact and revisit trigger:
```

## Change-control reminder

The report’s recommendations are not automatically accepted requirements. Keep “recommended,” “approved,” “implemented,” “verified” and “released” distinct. In particular, an architectural suggestion to investigate PostgreSQL is not an instruction to commit to it without the storage ADR and product-impact review.
