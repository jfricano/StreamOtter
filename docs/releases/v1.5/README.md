# V1.5 "Contain, explain, recover" (proposal)

**Status:** proposed, revision 0.2. Not approved, not implemented, not on the roadmap yet.

| Document | What it is |
| --- | --- |
| [V1_5_SOURCE_FAILURE_SPEC.md](./V1_5_SOURCE_FAILURE_SPEC.md) | The behavioral specification. Start with "Revision 0.2" near the top for what changed after checking the code. |
| [adr/ADR-15A](./adr/ADR-15A-failure-journal-and-handoff.md) | Failure journal, quarantine handoff, and moving the offset |
| [adr/ADR-15B](./adr/ADR-15B-recovery-barrier.md) | Failure classification, the recovery guard, and snapshot acknowledgment |
| [adr/ADR-15C](./adr/ADR-15C-operator-authority-and-redrive.md) | Operator service, socket, health probes, and redrive |
| [V1_5_ACCEPTANCE_PLAN.md](./V1_5_ACCEPTANCE_PLAN.md) | Scenario families F01–F48 and release gates (unchanged from 0.1) |
| [V1_5_IMPLEMENTATION_HANDOFF.md](./V1_5_IMPLEMENTATION_HANDOFF.md) | Slices, ownership, and the proposed roadmap row (unchanged from 0.1) |

The V1 specification and the roadmap stay authoritative until the owner approves this as revision 1.0. The roadmap row goes in at that point.

## Decisions for the owner

1. Adopt V1.5 as the increment between the V1 launch and V2.0.
2. When a recovery boundary can be retired: by operator action, or only by a source generation change (ADR-15B §4).
3. Accept the simpler redrive in ADR-15C §5 instead of the 0.1 resynchronize-on-redrive text.
4. Journal engine: accept `node:sqlite` if it's usable on Node 24; otherwise `better-sqlite3`, a new native dependency (ADR-15A §2).
