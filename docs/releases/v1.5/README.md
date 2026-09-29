# V1.5 "Contain, explain, recover" (proposal)

**Status:** proposed, revision 0.3. Not yet approved as 1.0, not implemented, not on the roadmap yet.

| Document | What it is |
| --- | --- |
| [V1_5_SOURCE_FAILURE_SPEC.md](./V1_5_SOURCE_FAILURE_SPEC.md) | The behavioral specification. Start with "Revision 0.2" near the top for what changed after checking the code. |
| [adr/ADR-15A](./adr/ADR-15A-failure-journal-and-handoff.md) | Failure journal, quarantine handoff, and moving the offset |
| [adr/ADR-15B](./adr/ADR-15B-recovery-barrier.md) | Failure classification, the recovery guard, and snapshot acknowledgment |
| [adr/ADR-15C](./adr/ADR-15C-operator-authority-and-redrive.md) | Operator service, socket, health probes, and redrive |
| [V1_5_ACCEPTANCE_PLAN.md](./V1_5_ACCEPTANCE_PLAN.md) | Scenario families F01–F48 and release gates (unchanged from 0.1) |
| [V1_5_IMPLEMENTATION_HANDOFF.md](./V1_5_IMPLEMENTATION_HANDOFF.md) | Slices, ownership, and the proposed roadmap row (unchanged from 0.1) |

The V1 specification and the roadmap stay authoritative until the owner approves this as revision 1.0. The roadmap row goes in at that point.

## Decisions

| Decision | Status |
| --- | --- |
| Simpler redrive (ADR-15C §5) | Accepted, September 29, 2026 |
| Journal engine: `node:sqlite`, else `better-sqlite3` (ADR-15A §2) | Accepted, September 29, 2026 |
| Boundary retirement as a per-source choice, default `generation` (ADR-15B §4) | Proposed, awaiting confirmation |
| Adopt V1.5 between the V1 launch and V2.0, and add the roadmap row | Open; done at revision 1.0 |
