# R01: baseline and claims reconciliation

**Status:** evidence ready · September 29, 2026 · Packet R01 of the [research execution plan](./RESEARCH_EXECUTION_PLAN.md)

**Naming update — October 2, 2026:** V1.5 below is the historical label at the recorded baseline; the same planned increment is now V1.1 in `docs/releases/v1.1/`. This does not rewrite the historical evidence.

## Baseline delta

The report inspected `7b40678` (September 27, 2026). Since then, `main` has changed documentation only:

| Change | Where |
| --- | --- |
| V1.5 specification 1.0 with ADR-15A/B/C | `docs/releases/v1.1/` (PRs #4, #5) |
| Roadmap: current-status note and V1.5 row | `docs/API_AND_FEATURE_ROADMAP.md` (PR #5) |
| Roadmap: V1.5 consequences and strategy ideas for V2/V3 | PR #6 (open at the time of writing) |

There are no code changes, so the report's technical baseline still holds.

## Release and launch status

| Item | Status | Source |
| --- | --- | --- |
| Published release | `0.1.0-rc.3` on npm (`latest`), six packages released together | [CHANGELOG](../../../CHANGELOG.md), [implementation status](../../IMPLEMENTATION_STATUS.md) |
| Engineering Gate A | Met | [implementation status](../../IMPLEMENTATION_STATUS.md), [site plan](../../WEBSITE_AND_DEMO_PLAN.md) |
| Public launch Gate B | **Not met.** The Lontra Creek production stack passes CI but isn't hosted, and the Failure Lab is still in integration | Lontra Creek `README.md` at `2397e2c` |
| Production health endpoint | None in V1. Planned in V1.5 (ADR-15C §4) | [deployment guide](../../DEPLOYMENT.md), root README "Limits in V1" |

## Claims check

Checked: the root README, the package READMEs, the guides, the deployment guide, the roadmap and the implementation status. Searched for guarantee wording, exactly-once, zero data loss, production-ready, unique or first, and browser and platform support.

| Finding | Disposition |
| --- | --- |
| The roadmap header said "No implementation released" while rc.3 was on npm | **Fixed** in PR #5 with a current-status note. The original planning text is kept. |
| `live` is described as a drain boundary, not freshness (`packages/client/README.md:56`) | Correct; matches the V1 contract |
| Browser support: "Chromium only; Firefox and Safari untested" | Correct and visible (status doc, root README) |
| Broker TLS with system trust, managed Kafka, other proxies are labeled unverified | Correct and visible (status doc, Kafka support matrix) |
| No exactly-once, zero-loss, uniqueness or enterprise claims found | Nothing to fix |
| Repository test counts (114 core, 20 Kafka, 13 browser, …) | Reported by the project and not re-run for this packet. They stay "reported", per the research plan's evidence levels. |

**Exit condition met:** no public claim found conflates planned capability with shipped behavior. Unverified support and launch status are stated explicitly.

## Revisit when

A release after rc.3 is published, Gate B passes, or V1.5 implementation starts.
