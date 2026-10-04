# V1.1 "Contain, explain, recover" plan

**Owner amendment — October 1, 2026; reconciled October 2:** The next planned increment is **V1.1**, renamed from V1.5. The approved revision 1.0 source-failure specification and September 29 decisions remain in force. ADR-15A/B/C keep their stable decision IDs. This milestone label does not change npm or protocol versions. Lontra Creek separately owns replacing its existing `/workbench/` tour with the actual workbench UI in an isolated synthetic visitor sandbox; no new page is added.

**Status:** approved, revision 1.0 (September 29, 2026). Implementation started October 3, 2026; see the [log](./IMPLEMENTATION_LOG.md). Not released. On the roadmap between the V1 launch and V2.0.

| Document | What it is |
| --- | --- |
| [V1_1_SOURCE_FAILURE_SPEC.md](./V1_1_SOURCE_FAILURE_SPEC.md) | The approved behavioral specification, code-review revision history, and owner amendment. |
| [adr/ADR-15A](./adr/ADR-15A-failure-journal-and-handoff.md) | Failure journal, quarantine handoff, and moving the offset |
| [adr/ADR-15B](./adr/ADR-15B-recovery-barrier.md) | Failure classification, the recovery guard, and snapshot acknowledgment |
| [adr/ADR-15C](./adr/ADR-15C-operator-authority-and-redrive.md) | Operator service, socket, health probes, and redrive |
| [V1_1_ACCEPTANCE_PLAN.md](./V1_1_ACCEPTANCE_PLAN.md) | Scenario families F01–F48 and release gates, aligned with the approved ADRs and frontend amendment |
| [V1_1_IMPLEMENTATION_HANDOFF.md](./V1_1_IMPLEMENTATION_HANDOFF.md) | Slices, ownership, settled ADRs, and recorded roadmap placement |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | The build: PR sequence, branching, work breakdown, ownership, verification, and Lontra Creek coordination |
| [V1_1_API.md](./V1_1_API.md) | Draft API specification the slices build against: configuration, handlers, incidents, operator service, IPC, health, CLI, and the decisions it adds |
| [WORKBENCH_HOST_CONTRACT.md](./WORKBENCH_HOST_CONTRACT.md) | WHC-1, the interface for running the published workbench outside loopback (spec §10), defined before implementation |
| [EVIDENCE.md](./EVIDENCE.md) | Requirement-to-evidence matrix for F01–F48 |
| [IMPLEMENTATION_LOG.md](./IMPLEMENTATION_LOG.md) | Working record and handoff: current state, decisions, runs and failures |
| [ACCEPTANCE_PACKET.md](./ACCEPTANCE_PACKET.md) | The final acceptance packet (handoff §7): what is implemented, verified and published, limitations, and the recommended release status |
| [REVIEW.md](./REVIEW.md) | The independent review of #12–#18: every finding, the PR it corrects, its fix commit and its regression test |

The V1 specification still governs shipped behavior. This specification governs V1.1 work; the ADRs refine it where they say so.

## Library and site ownership

The library owns a documented, version-pinned way to consume the actual published workbench frontend and adapt supported validation, preview, inspection, export, and Failures operations. Define and verify that integration contract before the site enables its sandbox; it is planned work, not an existing export. Lontra Creek owns visitor sessions, constrained synthetic bindings, resource limits, hosting, and cleanup. This does not expose production management, operator sockets, native management credentials, arbitrary code/broker/offset/file operations, or protected evidence to visitors. See the separate [site planning PR](https://github.com/jfricano/lontra-creek/pull/26); its canonical folder will be `docs/releases/v1.1/` in that repository.

The frontend/integration seam is an explicit upstream deliverable in this library plan, verified with native synthetic fixtures and a clean packed/published install. Library publication does not require Lontra Creek's hosted sandbox or its LC11 acceptance to pass. The two V1.1 milestones have independent scope, schedules, package/site versions, and release decisions. Lontra Creek depends on specific capabilities in an exact published package, not on a package version named `1.1.0`; a compatible seam can ship in an earlier library release without declaring the entire native V1.1 increment complete.

## Decisions

| Decision | Status |
| --- | --- |
| Simpler redrive (ADR-15C §5) | Accepted, September 29, 2026 |
| Journal engine: `node:sqlite`, else `better-sqlite3` (ADR-15A §2) | Accepted, September 29, 2026 |
| Journal engine refined (D1): `node:sqlite` with a Node 24.15 floor | Accepted, October 4, 2026 |
| `streamotter sources rebaseline` as a command | Accepted, October 4, 2026 |
| Boundary retirement as a per-source choice, default `generation`; operator mode documented as unsafe (ADR-15B §4) | Accepted, September 29, 2026 |
| Adopt the source-failure increment between the V1 launch and V2.0 | Accepted, September 29, 2026; milestone renamed V1.1 October 1 |
