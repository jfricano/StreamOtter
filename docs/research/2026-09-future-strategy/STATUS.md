# Research and decision status

Updated September 29, 2026. Statuses use the plan's ladder: proposed → investigating → evidence ready → decision recorded → implemented → verified → released. Keep "recommended", "approved" and "shipped" separate.

## Research packets

| Packet | Question | Serves | Status | Evidence / next step |
| --- | --- | --- | --- | --- |
| R01 | What's implemented, released, verified, planned? | Claims, launch status | Evidence ready | [R01_BASELINE.md](./R01_BASELINE.md) |
| R02 | Which competitor contracts overlap? | Positioning | Proposed | Desk research only, unless P04 is decided otherwise |
| R03 | What must an adopter provide for coherent state sync? | V1 guide, V1.1 recovery guard | Decision recorded | ADR-15B covers the recovery boundary. The adopter guide update waits for implementation. |
| R04 | Can one gateway be monitored and recovered safely? | V1.x/V1.1 hardening | Decision recorded | Folded into V1.1: health probes (ADR-15C §4), runbooks (spec §11.2) |
| R05 | Which store and admission design fit V2.0? | V2.0 | Investigating | [V2.0 store outline](../../releases/v2.0/STORE_DESIGN_OUTLINE.md). The spikes haven't started. |
| R06 | What is a durable client checkpoint? | V2.0 SDK | Proposed | Starts alongside R05 |
| R07 | Retention, replay fairness, permission changes | V2.0 | Proposed | Starts alongside R05 |
| R08 | Multi-gateway ownership, fencing, revocation | V2.1 | Proposed | Needs a usable R05 store contract first |
| R09 | Schemas, clusters, filters, config evolution | V2.2 | Proposed | Placement recorded in the roadmap (independent clusters and bounded filters in V2.2) |
| R10 | Does generation, rehearsal and diagnosis reduce work? | DX | Proposed | V1.1 Failures view and reproduction bundles are the first test |
| R11 | Commands: durable acceptance, ambiguous outcomes | V3.0 | Proposed | Before the V3.0 API freeze |
| R12 | Teams and environments: promotion, rollback, isolation | V3.1 | Proposed | Before V3.1. Must map V1.1 operator actions to roles. |
| R13 | Transport conformance | V3.2 | Proposed | Shared behavior suite before the WebSocket adapter |
| R14 | Later expansions and operating cost | Beyond V3 | Proposed | Periodic review. Each option needs an owner decision. |

## Owner decisions

| Decision | Status |
| --- | --- |
| P01: bounded V1.x production health and compatibility work | **Decided:** delivered as part of V1.1 |
| P02: place V2 items the roadmap never assigned | **Decided** once PR #6 merges: replay diagnostics and migration checks in V2.0; independent clusters and bounded filters in V2.2 |
| P03: accept the V2 reference deployment and its storage costs | Open. Decided after R05 evidence. |
| P04: optional external or comparative trials | Open. Recommendation: not now; desk research (R02) is enough until V2 design. |
| P05: later scope changes (commands, teams, transports, hosting) | Standing rule: each is its own owner decision |
| V1.1 adoption, redrive, journal engine, boundary retirement | **Decided** September 29, 2026; see [releases/v1.1](../../releases/v1.1/README.md) |

## Gates

| Gate | Meaning | Status |
| --- | --- | --- |
| G0 | Baseline clarity | **Passed** (R01) |
| G1 | V2.0 design readiness: store, ordering, checkpoint and retention decisions, plus failing crash tests | Not started. The outline exists. |
| G2 | V2.0 release readiness | Not started |
| G3 | V2.1/V2.2 readiness | Not started |
| G4 | Each V3 increment, gated separately | Not started |
| G5 | Approval for any beyond-V3 expansion | Per option |
