# StreamOtter V1.1 — Code review and fixes

October 4, 2026. This records the code review of the whole V1.1 stack (PRs #12–#18) and the fixes for it, which are on branch `feat/v1.1-review-fixes` (PR #19), stacked on #18.

## 1. How the review was run

Six reviewers each took one area: the runtime, the journal, the advance path, the operator service, the operator surfaces (socket, CLI, management API), and the workbench and reference guard. None of them wrote the code or changed the repository. They were told to distrust passing tests and to prove each finding with a scratch test. Every major finding was reproduced, and the most serious ones (R1, A, B, O3, O4, J2) were reproduced a second time before any fix started.

They found **13 major and 22 minor issues**. (The summary first given to the owner said 24 minor; the itemized list below is the complete one, with W7 covering two issues.) None was a security hole in the operator socket, the CLI's terminal escaping, the workbench's HTML handling or the WHC-1 origin rules.

These held up under review:

- The gateway never commits past an unprocessed record without acknowledged evidence, a guard decision and a journaled boundary. The one exception was R1's misclassification.
- Snapshot acknowledgment and boundary enforcement.
- A configuration without `failureHandling` behaves exactly as V1.

## 2. Findings and fixes

Every fix is one commit, named in the table, with a regression test that failed before the fix and passes after. "Corrects" is the PR that introduced the problem.

### Major

| ID | Finding | Corrects | Fix | Regression test |
| --- | --- | --- | --- | --- |
| R1 | Classification stopped at the first problem. A record with a schema failure and a later integrity failure (an invalid routing key, a throwing mapper on another channel, a revision conflict) was labelled `payload-schema`, and `quarantine-resync` advanced past it. | #13, #15 | `3995145`. With `failureHandling`, every output, channel and the conflict check is evaluated and the most severe class wins. The frame-size check runs before the schema check. Without `failureHandling` the V1 behavior is unchanged. | `tests/integration/failure-classes.test.ts`, "a record with several problems is classified by the most severe one" |
| A | After a restart, an `uncertain` incident was not counted as outstanding, so a commit on another partition lifted the unexplained-position hold. | #15, #16 | `e007fdd`. An unresolved advance (`advance-pending` or `uncertain`) holds every record of the source until a restart reconciles it. | `packages/gateway/test/failure-service.test.ts`, "keeps holding an unexplained position after restart when another partition commits" |
| B | Nothing refused an advance when the source's Kafka cluster ID had changed (ADR-15A §3). | #15, #16 | `60673da`. An incident from another cluster, or with the current cluster unknown, holds as an integrity fault and is never quarantined or advanced. At startup, an unresolved advance from another cluster becomes `uncertain` instead of being reconciled against the new cluster's offsets. | `failure-service.test.ts`, "cluster identity (ADR-15A §3)", 3 tests |
| O3 | A boundary could be retired while its own incident's advance was unresolved. | #16 | `b305d20`. Retirement, by the operator or the application, is refused with `advance-unresolved`. | `tests/integration/operator.test.ts` and `journal.test.ts`, "retire-boundary is refused while the boundary's own advance is unresolved" |
| O4 | A mapper's error message, which can quote the payload (a `JSON.parse` error does), was stored as the incident diagnosis and shown everywhere. | #15 | `3995145`. Diagnoses carry the error's name and code only. The V1 log line is unchanged. | `failure-classes.test.ts`, "incident diagnoses never quote payload text" |
| O1 | Two concurrent redrives could both use one plan. | #17 | `a3d839e`. A redrive claims its plan, and every other plan of the incident, before its first `await`. | `tests/integration/operator-races.test.ts`, O1 |
| O2 | A retry during a quarantine write made the disposition's write stale. That was reported as a journal failure, so readiness stuck at 503 `journal` and the quarantine stayed `pending`. | #15, #17 | `55587f4` (retry and reassess queue behind the source's disposition) and `72108c6` (a stale write is treated as superseded, not as a journal failure). | `operator-races.test.ts`, O2. `failure-service.test.ts`, "superseded changes" |
| J1 | Each boundary copied every earlier failure ID, so the journal grew quadratically and filled after about 2,700 automatic advances. | #16 | `646aedf`. Superseded boundaries keep no copy of the list. | `journal.test.ts`, "grows linearly with automatic advances" |
| J2 | A lock left by a crashed container named the restarted process's own pid (often 1), was read as live, and startup failed every time. | #15 | `d4a5cc4`. A lock naming this process's pid is stale unless this process holds the journal. Lock files are written atomically (J6). | `journal.test.ts`, 3 lock tests |
| J3 | `sources rebaseline` in a project with several sources closed incidents and then failed, leaving a half-done state. | #18 | `44dc05d`. Rebaseline claims every source and runs as one transaction. | `journal.test.ts`, "runs several writes as one transaction". `tests/integration/rebaseline.test.ts`, "rebaselines one source of several" |
| J4 | `init --failures` silently consumed a leftover `journal.sqlite-wal`, losing a crashed journal's last commits. | #15 | `80bec12`. `init` refuses while a `-wal` or `-shm` file is present and never deletes either. | `journal.test.ts`, "refuses to create a journal next to a leftover WAL" |
| S1 | Stopping the gateway destroyed connections whose mutation was already running. The mutation was applied, but the CLI reported exit 1 (failed). | #17 | `8b9eabd`. `close()` answers requests already handed to the operator, for at most `drainMs`. A mutation whose answer is lost, or that times out, exits 4 (unknown). | `operator-ipc.test.ts`, `operator-socket.test.ts` and `operator-cli.test.ts`, S1 tests |
| W1 | The example recovery guard read "no outbox rows" as "never changed" and vouched for an order whose revision had moved. | #18 | `20578b1`. "Never changed" is proven from the order's seed revision; anything else needs a re-publish after the failed record. | `tests/integration/reference-guard.test.ts`, "incomplete or ambiguous outbox" |

### Minor

| ID | Finding | Corrects | Fix | Regression test |
| --- | --- | --- | --- | --- |
| C | A resume racing a queued disposition could open an incident for a record that had already committed. | #15 | `d7c846a`. `beforeRetry` runs in the source's failure chain, and a disposition whose record committed opens no incident. The chain is re-entrant, so an operator action already in it doesn't wait on itself. | `failure-service.test.ts`, "retries and queued dispositions" |
| D | Recovery stayed `guard-pending` after a stop or a failed `prepareAdvance`. | #16 | `30b420d` | `failure-service.test.ts`, "guard exits" |
| E | A journal write that failed after a confirmed advance left the incident `advance-pending`. The source resumed anyway, and the next commit looked unexplained. | #16 | `361b5e1`. The adapters await a new `HeldPosition.confirmed()` (the journal write) before resuming. | `failure-service.test.ts`, "recording a confirmed advance" |
| F | The advance read-back could open a Kafka admin client after stop. | #16 | `694359d` | `tests/kafka/13-advance-stop.test.ts` |
| G | Quarantine requests used the client's 30 s timeout, not the 10 s deadline in the spec. | #15 | `85fbe6d` | `quarantine-reader.test.ts`, "quarantine writer deadline" |
| H | The circuit counted a re-advanced incident twice. | #16 | `a09c2e4` | `journal.test.ts`, "counts an incident advanced twice once" |
| J5 | KafkaJS adds inherited values for header names like `constructor`, which became invented evidence headers. | #15 | `e5bf7ba` | `quarantine-reader.test.ts`, "Kafka header flattening" |
| J6 | Lock files were not written atomically. | #15 | `d4a5cc4` | `journal.test.ts`, "never leaves a partly written lock" |
| J7 | Fixture evidence is never deleted. | #15 | Not fixed in V1.1; it affects only `streamotter dev` without Kafka. **Fixed in V1.2.1** (#56, issue #54): fixture evidence expires seven days after it was stored. | — |
| O5 | A redrive of an unknown incident reported `journal-unavailable`. | #17 | `29e7834`. It is refused `not-found`. | `operator-races.test.ts`, O5 |
| O6 | Redrive ignored `uncertain` advances and evidence conflicts as integrity faults. | #17 | `3b8499c` | `operator-races.test.ts`, O6 |
| O7 | A refused retry still bumped the incident's revision and journaled an event. | #17 | `55587f4` | `operator-races.test.ts`, O7 |
| R2 | Dropping `failureHandling` together with a generation change was refused because of the old generation's boundary. | #18 | `0ba6dd6` | `upgrade-downgrade.test.ts`, "allows dropping failureHandling together with a generation change" |
| S2 | Several `--json` errors printed plain text. | #17, #18 | `7d67a39`. Every error is `{"error": StreamError}` on stderr. | `operator-cli.test.ts`, S2 |
| S3 | API §6 described an `OperatorStatus` that didn't match the code. | #17 | `fb6ac47` (docs) | — |
| W2 | Two outbox rows at the failed position: the guard picked the oldest. | #18 | `20578b1`. The guard holds and names the rows; the watermark is at least the failed row's sequence. | `reference-guard.test.ts`, 2 tests |
| W3 | "Session ended" left a running preview's WebSocket open. | #14 | `0ff8a4b` | `tests/browser/workbench-host.test.ts`, "closes a running preview's gateway connection" |
| W4 | A 401 with a JSON body that is not a Result threw instead of ending the session. | #14 | `860c3e3` | `tests/browser/workbench-cross-origin.test.ts` |
| W5 | `apiBase` accepted percent-encoded dot segments (`%2e%2e`). | #14 | `58a6204` | `packages/contracts/test/workbench.test.ts` |
| W6 | The docs didn't say the snapshot watermark must be contiguous. | #18 | `95152a8` (docs) | — |
| W7 | An older incident-detail response could replace a newer one, and export blob URLs were never released. | #17 | `e0b703a` | `tests/browser/failures.test.ts`, 2 tests |

## 3. Behavior changes an integrator will notice

- **An unresolved advance holds the whole source.** While an incident is `advance-pending` or `uncertain`, no record on any partition of that source is processed until a restart reconciles the advance (finding A). The runbook already described this; the code now does it.
- **A changed Kafka cluster ID is an integrity fault** (finding B).
- **Exit code 4 now also covers a mutation whose answer was lost or timed out** (finding S1). A read that loses its answer still exits 1.
- **With `--json`, every error is JSON** (finding S2).
- **The example guard holds more often.** An order not at its seed revision needs a re-publish after the failed record (finding W1).
- **`init --failures` refuses next to a leftover `-wal` or `-shm` file** (finding J4). Move both aside together with the journal, or recover the old journal first.

## 4. Integration notes

The fixes were made in parallel on six branches and merged into `feat/v1.1-review-fixes`. Two points came up while combining them:

- The failure chain's `run()` became re-entrant through `AsyncLocalStorage` (C), and retry and reassess moved into the chain (O2). An operator call made from inside a disposition's async context therefore runs nested instead of queuing. The O2 race test made its retry from inside `store.update`, so it now binds that call outside the chain (`619748b`). Real operator requests arrive on their own socket or HTTP connection, outside any chain.
- Doc conflicts in API §6 were resolved by keeping both sides' additions.

## 5. Second review of the fixes

A fresh reviewer, who wrote neither the code nor the fixes, reviewed the fix diff (`24abe81..619748b`), with a focus on the re-entrant failure chain and on how fixes made in parallel interact. It found no major problem and three minor ones, each proven with a failing test. Each is fixed by its own commit, and the tests are in `packages/gateway/test/review-followups.test.ts`.

| Finding | Fix |
| --- | --- |
| H was incomplete. The circuit check in `#continue` ran before `prepareAdvance` moved the incident's entry, so an incident advanced again after a not-held attempt still counted twice there. With the default limit, the fifth distinct incident's re-advance could open the circuit. | `ab6bcb6`. The check leaves out the incident's own earlier entry. |
| B and O6 didn't connect. A cluster-mismatch incident was not one of the source-integrity faults O6 checks, so evaluate and redrive of another incident on the source were still allowed. | `05ef737` |
| D was incomplete. A crash while the guard ran left `guard-pending` in the journal. If the policy no longer resumed the guard, nothing cleared it, and every operator retry was refused as `in-progress`. | `483eb82`. Startup puts `guard-pending` back to `held`, since no guard runs in a new process. |

Also found, not fixed, and recorded here:

- **O6 reads integrity markers from the incident's event history**, which keeps the newest 200 events per incident. An incident retried more than about 100 times can lose an `evidence-conflict` or `position-moved` marker, after which O6 no longer sees that fault. An `uncertain` advance is a persisted progress value and is not affected. A persisted flag on the incident would be sturdier; that is a journal schema change, left for a later release.
- **J1 doesn't shrink journals written before it.** No migration clears `failure_ids` on boundary rows superseded earlier. No V1.1 journal exists outside development, because nothing is published, so none was added.
- **Redrive rechecks the incident's revision before taking the source's processing lock**, not inside it. Changing the revision in that gap takes a redelivery of an incident that is already `advanced`, which only an offset reset can cause. Not reproduced.

The reviewer checked these and found them sound:

- **The re-entrant `run()`.** The only production path into it from inside a chain is the intended one (operator retry → `resumeSource` → `beforeRetry`). `settled()` is never awaited inside a chain.
- **Store parity.** The memory store and the SQLite journal behave the same across advance, re-advance, uncertain and retire sequences.
- **Startup reconciliation** after crashes at each new step of E, F and B.
- **The S1 drain**, and **W1–W7**.

## 6. Found later

| Finding | Corrects | Fix |
| --- | --- | --- |
| `scripts/kafka/replicated-start.sh` and `replicated-stop.sh` checked a node's process through `/proc`, which macOS doesn't have. On a Mac, start reported that node 101 exited, exited 1 and left Java running, and stop killed nothing. The release checklist and CONTRIBUTING tell the releaser to run these on a Mac. Found by the V1.2 review. | #18 | `bdf1445`. Both scripts use `ps -ww -p <pid> -o command=`. Rerun on Linux; not yet run on macOS. |
