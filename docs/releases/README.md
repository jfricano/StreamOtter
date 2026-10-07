# StreamOtter library release plans

This directory owns native package behavior, APIs/configuration, CLI/workbench tooling, compatibility, acceptance evidence, and npm release gates. It does not own Lontra Creek hosting or visitor sessions.

- [V1.1 — Contain, explain, recover](v1.1/README.md): the approved source-failure increment, renamed from V1.5, plus the published workbench host contract (WHC-1). Shipped in `0.2.0-rc.1`.
- [V1.2 — Quality review](v1.2/README.md): an independent review of V1 and V1.1 together, and its fixes.
- [V1.2.1 — Deferred minor fixes](v1.2.1/README.md): fixes for the 33 minor findings V1.2 deferred and the V1.1 review's J7 (issues #21 to #54).
- **Current release:** V1.1, V1.2 and V1.2.1 shipped together as `0.2.0-rc.1`, published to npm `latest` on October 5, 2026, with one CHANGELOG entry. The milestone folders keep each increment's plan, evidence and log.
- **Next:** fixes ship as `0.2.0-rc.N`; `1.0.0` is the V1 public launch, with later milestones as `1.x` minors ([npm versions](../API_AND_FEATURE_ROADMAP.md#npm-versions)).
- [Public API trim before 1.0.0](1.0.0/PUBLIC_API_TRIM.md): which exports become private before the public launch, and why. Proposed; the [audit](1.0.0/PUBLIC_API_AUDIT.md) has the evidence.
- [0.2.0-rc.1 release handoff](0.2.0-rc.1/RELEASE_HANDOFF.md): PRs and merge order, the verified publication, remaining limitations, acceptance checks and rollback.
- [V2.0 delivery-store outline](v2.0/STORE_DESIGN_OUTLINE.md): a separate future design.
- [V2.3 event journey verification](v2.3/V2_3_EVENT_JOURNEY_VERIFICATION.md): a proposal, not approved. It moved here from `docs/v2/` on October 4, 2026, so all release plans live under `docs/releases/`.
- [Release process](../RELEASE_PLAN.md) and [checklist](../RELEASE_CHECKLIST.md).
- [Future-strategy research](../research/2026-09-future-strategy/README.md): advisory background and historical evidence.

Lontra Creek maintains its [site/demo planning PR](https://github.com/jfricano/lontra-creek/pull/26) separately, with canonical documents under its own `docs/releases/v1.1/`. Matching milestone labels do not require simultaneous releases; the site consumes an exact published npm package with the capabilities required by each enabled feature.
