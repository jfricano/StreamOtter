# StreamOtter V1.1 — Acceptance packet

**Status:** For the owner's review, October 4, 2026. This is the final acceptance packet the [implementation handoff](./V1_1_IMPLEMENTATION_HANDOFF.md) §7 asks for. It summarizes; the evidence itself is in the [evidence matrix](./EVIDENCE.md) and the [implementation log](./IMPLEMENTATION_LOG.md), which keeps the failed runs.

Three words are used strictly here:

- **Implemented:** code and tests are on the V1.1 branches, and the tests passed in a recorded run in this build environment.
- **Independently verified:** a run by someone other than the builder, or on CI, of the same commit. **Nothing in V1.1 is independently verified yet.** No V1.1 branch has merged, so CI has not run the extended tiers (Kafka, browser, deploy) on it.
- **Published:** on npm. **Nothing in V1.1 is published.** The latest release is still `0.1.0-rc.3`.

## 1. The product question

> Can the integrator resolve a bad source record with less improvised machinery, while still knowing exactly what the source and browser state do — and do not — establish?

**Yes, with the limits below.** Before V1.1, a bad record paused its source until someone called `resumeSource` from code, with nothing recorded about why or what happened next. With V1.1:

- every unprocessable record opens a durable incident with a trusted failure class, its position and a byte-exact copy of the original (quarantine-hold);
- the source moves past a record only when the application's own recovery guard vouches for it, and from then on every snapshot must prove it covers that record before a view goes live (quarantine-resync);
- the operator sees, explains, retries, evaluates, redrives and, as a last resort, rebaselines from one CLI or the workbench's Failures tab, and every decision is recorded with its reason and outcome, including an `unknown` outcome after a crash;
- readiness says which category of problem holds the gateway, and never names a topic, record or incident.

What the runtime cannot establish, and says so in the docs and the UI: whether the application's guard and snapshots are *true*. It checks identity and lifecycle of the recovery boundary, not the application's data ([runbook §4](../../guides/source-failures.md#4-write-an-honest-recovery-guard)). The order-dashboard example shows an honest guard to copy.

## 2. Baseline-to-release diff

Baseline: `main` at `b0109ba` (`0.1.0-rc.3` plus docs). Release candidate: the stack of PRs below, ending at `feat/v1.1-operations-release`.

| PR | Branch | Content |
| --- | --- | --- |
| #12 | `docs/v1.1-implementation-plan` | Plan, API draft, WHC-1 host contract, evidence matrix, log |
| #14 | `feat/v1.1-workbench-host` | WHC-1 revision 0.3: the published workbench hosted under a site route (Lontra Creek's sandbox depends on it) |
| #13 | `feat/v1.1-contracts` | Slice A: `failureHandling` configuration, failure classes, handler types |
| #15 | `feat/v1.1-quarantine-hold` | Slice B: incidents, the SQLite journal, quarantine-hold, transient retries |
| #16 | `feat/v1.1-guarded-continuation` | Slice C: recovery guard, recovery boundaries, snapshot acknowledgment, circuit breaker |
| #17 | `feat/v1.1-operator` | Slice D: operator service, local socket, CLI, Failures tab, Kafka read-back |
| (slice E) | `feat/v1.1-operations-release` | Health listener, downgrade refusal, `sources rebaseline`, reference guard, runbook and guides, crash tests, replicated-broker test, this packet |

Overall against `main`: about 120 files and 20,000 lines added, about half of them in `packages/` and most of the rest tests and docs. The [CHANGELOG](../../../CHANGELOG.md) lists every user-visible change under Unreleased.

**Compatibility.** A configuration without `failureHandling` behaves exactly as V1: no journal, no producer, no new permissions. `configVersion` stays `1`; the browser protocol and the SDK are unchanged. Proven by the unchanged V1 suites passing on every slice (F01).

## 3. ADRs and owner decisions

| Decision | Status |
| --- | --- |
| [ADR-15A](./adr/ADR-15A-failure-journal-and-handoff.md) failure journal and handoff | Accepted September 29, 2026 |
| [ADR-15B](./adr/ADR-15B-recovery-barrier.md) recovery barrier | Accepted September 29, 2026 |
| [ADR-15C](./adr/ADR-15C-operator-authority-and-redrive.md) operator authority and redrive | Accepted September 29, 2026 |
| D1: journal engine `node:sqlite`, Node 24.15 or later | Decided by the owner October 4, 2026 |
| `sources rebaseline` as a command rather than a manual procedure | Decided by the owner October 4, 2026 |
| D2–D9 in the [API draft §11](./V1_1_API.md#11-decisions-this-draft-adds) | Proposed, implemented as written; none changes V1 behavior |

## 4. Scenario evidence

Of the acceptance plan's 48 scenarios, by the matrix's own rules (no row is *verified* until a recorded independent run):

| Status | Rows |
| --- | --- |
| Implemented | F01–F08, F10–F12, F14, F16, F17, F19–F24, F26–F40, F42, F44, F46 |
| Partial | F09, F13, F15, F18, F25, F41, F43, F47, F48 |
| Not run | F45 (Firefox and WebKit) |

What each partial row lacks is named in the [matrix](./EVIDENCE.md) and in [implementation status](../../IMPLEMENTATION_STATUS.md#v11-source-failure-handling-unreleased). Failed runs, and what each turned out to be, are kept in the [log](./IMPLEMENTATION_LOG.md).

Final run of every tier on `feat/v1.1-operations-release` (Node 24.21.0, pnpm 11.19.0, Kafka 4.1.2, headless Chromium 141): see the log's slice E entry for commands and counts.

## 5. Dependency and resource changes

- **No new npm dependency.** The journal uses Node's built-in `node:sqlite`.
- **Node:** failure handling with a state directory needs Node 24.15 or later (D1). Without failure handling, the V1 floor is unchanged.
- **Disk:** a state directory owned by the gateway's user, holding `journal.sqlite` (at most 256 MiB) and its WAL, a 16 MiB local spool used only for fixture evidence, and `run/` for the operator socket.
- **Kafka:** one pre-provisioned quarantine topic per project, written with an idempotent producer and `acks=all`; no topic is ever created by the gateway. Read-back uses short-lived consumer groups that never commit and are deleted.
- **Ports:** the optional health listener, on loopback by default.

## 6. Compatibility matrix

| Dimension | Covered here | Not covered |
| --- | --- | --- |
| Node | 24.21.0 for every tier; the journal tests also on 26.10.0; on 24.14.0 the journal refuses to open (`node-version`) | CI's Node 24 and 26 runs of the extended tiers |
| Kafka | 4.1.2: a single local broker (TLS and SASL SCRAM), and a three-broker replicated cluster for F47 | Brokers with ACLs enabled; managed services |
| Browsers | Headless Chromium 141 | Firefox, WebKit (F45); Playwright's pinned Chrome Headless Shell |
| Operating systems | Linux | macOS and Windows (the operator socket is Unix-only) |
| Deployment | Production CLI behind Caddy over HTTPS and WSS; packed and installed packages | The proxy deployment with failure handling on |

## 7. Permissions and retention

The Kafka ACLs and the retention guidance are in the runbook: [credentials and ACLs](../../guides/source-failures.md#61-credentials-and-acls) and [topic retention](../../guides/source-failures.md#64-topic-retention-and-expired-evidence). In short: Describe, DescribeConfigs, Write and Read on the quarantine topic, and Read and Delete on the `streamotter-<projectId>-quarantine-read-` group prefix. Keep source retention well above how long a hold may last; the quarantine topic's retention decides how long evidence can be read back (7 days is the reference).

These ACLs follow from the client calls. They have not been checked against a broker with authorization enabled.

## 8. Rollback and rebaseline

- **Rollback (downgrade):** [runbook §8](../../guides/source-failures.md#8-upgrade-and-downgrade). Resolve incidents and retire boundaries with failure handling still configured; startup refuses to drop `failureHandling` while the journal still holds obligations (`failure-handling-removed`). `0.1.0-rc.3` refuses a V1.1 configuration (`UNKNOWN_KEY`), so it can't run one silently.
- **Rebaseline:** [runbook §6.10](../../guides/source-failures.md#610-rebaseline-a-source) with `streamotter sources rebaseline`, and [§6.8](../../guides/source-failures.md#68-lost-or-damaged-local-state) when the journal itself is lost.

## 9. Remaining limitations

- The truth of an application's guard and snapshot acknowledgment can't be checked by the runtime.
- Quarantine uses the quarantining source's Kafka credentials; separate quarantine credentials aren't supported.
- No command prunes resolved incidents. The journal stops at 256 MiB and then holds the source rather than lose state.
- Moving a consumer group past a record still in the topic is done with Kafka's own tools, not by StreamOtter.
- The operator socket is not available on Windows.
- Some status fields (`store.durable`, `openIncidents`, `circuit.reason`, `quarantine.topic`) are returned but not yet described in the API draft.
- `KafkaQuarantineReader` reports `unavailable` on a coordinator reload (`GROUP_LOAD_IN_PROGRESS`) right after a broker rejoins, instead of retrying within its deadline. It fails closed; the operator repeats the command.
- If a source's group coordinator is lost during an advance, the assignment epoch changes and the incident becomes `uncertain`; a restart reconciles it. Seen once in an F47 development run, not covered by a test.
- The partial and not-run rows in §4.

## 10. Recommended release status

**Ready to merge as a release candidate, not as a final release.** Recommended path:

1. Merge the stack in order (#12, #14, #13, #15, #16, #17, then slice E), retargeting each PR to `main` as its base merges.
2. Let CI run the extended tiers on `main`, including the browser tier on Playwright's pinned browser, and add the Firefox and WebKit run for F45.
3. Publish as `0.2.0-rc.1` (a new minor: new configuration and CLI surface, no breaking change), with the owner's go.
4. Before a final `0.2.0`: an ACL-enabled broker run, the proxy deployment with failure handling on, and one integrator walking the runbook end to end.
