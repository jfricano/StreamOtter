# V1.1 "Contain, explain, recover" plan

**Owner amendment — October 1, 2026; reconciled October 2:** The next planned increment is **V1.1**, renamed from V1.5. The approved revision 1.0 source-failure specification and September 29 decisions remain in force. ADR-15A/B/C keep their stable decision IDs. This milestone label does not change npm or protocol versions. Lontra Creek separately owns replacing its existing `/workbench/` tour with the actual workbench UI in an isolated synthetic visitor sandbox; no new page is added.

**Status:** approved, revision 1.0 (September 29, 2026). Not implemented. On the roadmap between the V1 launch and V2.0.

| Document | What it is |
| --- | --- |
| [V1_1_SOURCE_FAILURE_SPEC.md](./V1_1_SOURCE_FAILURE_SPEC.md) | The approved behavioral specification, code-review revision history, and owner amendment. |
| [adr/ADR-15A](./adr/ADR-15A-failure-journal-and-handoff.md) | Failure journal, quarantine handoff, and moving the offset |
| [adr/ADR-15B](./adr/ADR-15B-recovery-barrier.md) | Failure classification, the recovery guard, and snapshot acknowledgment |
| [adr/ADR-15C](./adr/ADR-15C-operator-authority-and-redrive.md) | Operator service, socket, health probes, and redrive |
| [V1_1_ACCEPTANCE_PLAN.md](./V1_1_ACCEPTANCE_PLAN.md) | Scenario families F01–F48 and release gates, aligned with the approved ADRs and frontend amendment |
| [V1_1_IMPLEMENTATION_HANDOFF.md](./V1_1_IMPLEMENTATION_HANDOFF.md) | Slices, ownership, settled ADRs, and recorded roadmap placement |

The V1 specification still governs shipped behavior. This specification governs V1.1 work; the ADRs refine it where they say so.

## Library and site ownership

The library owns a documented, version-pinned way to consume the actual published workbench frontend and adapt supported validation, preview, inspection, export, and Failures operations. Define and verify that integration contract before the site enables its sandbox; it is planned work, not an existing export. Lontra Creek owns visitor sessions, constrained synthetic bindings, resource limits, hosting, and cleanup. This does not expose production management, operator sockets, native management credentials, arbitrary code/broker/offset/file operations, or protected evidence to visitors. Library publication has its own acceptance gate and does not wait for hosted site launch. See the separate [site plan](https://github.com/jfricano/lontra-creek/tree/main/docs/releases/v1.1).

## Decisions

| Decision | Status |
| --- | --- |
| Simpler redrive (ADR-15C §5) | Accepted, September 29, 2026 |
| Journal engine: `node:sqlite`, else `better-sqlite3` (ADR-15A §2) | Accepted, September 29, 2026 |
| Boundary retirement as a per-source choice, default `generation`; operator mode documented as unsafe (ADR-15B §4) | Accepted, September 29, 2026 |
| Adopt the source-failure increment between the V1 launch and V2.0 | Accepted, September 29, 2026; milestone renamed V1.1 October 1 |
