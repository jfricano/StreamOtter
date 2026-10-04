# StreamOtter library release plans

This directory owns native package behavior, APIs/configuration, CLI/workbench tooling, compatibility, acceptance evidence, and npm release gates. It does not own Lontra Creek hosting or visitor sessions.

- [V1.1 — Contain, explain, recover](v1.1/README.md): the approved source-failure increment, renamed from V1.5, plus the planned published workbench frontend/integration contract.
- [V1.2 — Quality review](v1.2/README.md): an independent review of V1 and V1.1 together, and its fixes.
- [V1.2.1 — Deferred minor fixes](v1.2.1/README.md): fixes for the 33 minor findings V1.2 deferred and the V1.1 review's J7 (issues #21 to #54).
- **Next release:** V1.1, V1.2 and V1.2.1 ship together as `0.2.0-rc.1`, with one CHANGELOG entry. The milestone folders keep each increment's plan, evidence and log.
- [V2.0 delivery-store outline](v2.0/STORE_DESIGN_OUTLINE.md): a separate future design.
- [Release process](../RELEASE_PLAN.md) and [checklist](../RELEASE_CHECKLIST.md).
- [Future-strategy research](../research/2026-09-future-strategy/README.md): advisory background and historical evidence.

Lontra Creek maintains its [site/demo planning PR](https://github.com/jfricano/lontra-creek/pull/26) separately, with canonical documents under its own `docs/releases/v1.1/`. Matching milestone labels do not require simultaneous releases; the site consumes an exact published npm package with the capabilities required by each enabled feature.
