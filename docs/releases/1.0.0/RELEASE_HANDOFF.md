# StreamOtter 1.0.0-rc.1 — release handoff

October 16, 2026 · Prepared, not published. The release candidate for `1.0.0`, the V1 public launch. This page says what ships, what has to be true before the tag, and what the owner does to publish. It links the detailed documents instead of repeating them, and contains no credentials.

## What ships

All six packages at `1.0.0-rc.1`: `streamotter`, `@streamotter/contracts`, `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli` and `@streamotter/workbench`. The user-facing story is the `1.0.0-rc.1` entry in [CHANGELOG.md](../../../CHANGELOG.md):

- React hooks (V1.3): `@streamotter/client/react` and `streamotter/react` ([V1.3](../v1.3/README.md)).
- The public API trimmed before 1.0 commits to it ([PUBLIC_API_TRIM.md](PUBLIC_API_TRIM.md)). This is the only change that can break an app's code built on `0.2.0-rc.1`: a type error at build time, or a missing-export error at startup in plain JavaScript. Behavior changes are in the CHANGELOG's Changed and Fixed sections; one can hold a source at startup that `0.2.0-rc.1` ran.
- Source-failure fixes from the clean-machine run of the public docs (#83), and record data kept out of the "Source paused" log line (#70).
- `streamotter init` writes canonical configuration, and the CLI, workbench and `nextAction` wording are corrected.

No configuration, protocol, `configVersion` or journal format change. The docs site (`apps/docs`) and blog (`apps/blog`) live in this repository but are not npm packages; this release doesn't publish them.

**Release rule** (the launch plan's release path, approved by the owner as decision D3 on October 7): `1.0.0` is `1.0.0-rc.N` republished with only its version and changelog changed, after at least seven days on that candidate with no blocking bug. A runtime fix ships as `rc.N+1`, and the seven days start again.

## Merged since 0.2.0-rc.1

| PR | What |
| --- | --- |
| [#70](https://github.com/jfricano/StreamOtter/pull/70) | The "Source paused" log line keeps record data out |
| [#73](https://github.com/jfricano/StreamOtter/pull/73) | V1.3 React hooks |
| [#72](https://github.com/jfricano/StreamOtter/pull/72), [#77](https://github.com/jfricano/StreamOtter/pull/77), [#79](https://github.com/jfricano/StreamOtter/pull/79) | Doc comments on every export, the public API trim, and the docs site with its release channel |
| [#76](https://github.com/jfricano/StreamOtter/pull/76) | The blog app |
| [#78](https://github.com/jfricano/StreamOtter/pull/78), [#80](https://github.com/jfricano/StreamOtter/pull/80) | Manual Pages deploy workflows for the docs and blog, and their pnpm bootstrap fix |
| [#83](https://github.com/jfricano/StreamOtter/pull/83) | Fixes for the five defects a clean-room run of the public docs found, and documentation corrections |
| #60, #62–#67, #69, #71, #74, #82 | Documentation, brand assets, Under the Hood, promotion docs and repository housekeeping |

## Gates before the tag

The roadmap's [npm versions](../../API_AND_FEATURE_ROADMAP.md#npm-versions) puts the four checks from the V1.1 [acceptance packet §10](../v1.1/ACCEPTANCE_PACKET.md#10-recommended-release-status) before `1.0.0-rc.1`:

| Check | State |
| --- | --- |
| A Kafka broker with ACLs enabled | `pnpm test:kafka:acl` (new): one Kafka 4.1.2 broker with authorization on, where the gateway holds exactly the runbook's ACLs. It runs a plain channel, quarantine-hold and quarantine-resync end to end, then removes each ACL in turn and checks the documented symptom; it also corrected the runbook's symptom table. It runs as the **Kafka with ACLs** job in Extended checks and in the publishing workflow's preparation job. Results: [implementation status](../../IMPLEMENTATION_STATUS.md). |
| Firefox and WebKit (F45) | The browser tier now runs in Chromium, Firefox and WebKit: the **Browser tests in firefox** and **Browser tests in webkit** jobs in Extended checks. Both passed all 59 tests on this branch on October 16 ([run 38835942346](https://github.com/jfricano/StreamOtter/actions/runs/38835942346)), with every other Extended job; the run on the release `main` is the evidence for the tag. |
| The proxy deployment with `failureHandling` on | `test:deploy` (in Extended checks and the preparation job) now also runs the compiled `streamotter start` behind Caddy with a state directory, quarantine-resync, the operator socket and the health listener: a bad record holds the source while the app keeps serving, the CLI shows the incident, `sources reassess` advances it, and a graceful restart keeps the recovery boundary. |
| One integrator walks the [source-failure runbook](../../guides/source-failures.md) end to end on their own machine with real Kafka | **Open, the owner's.** No outside integrator is named. A clean-room agent run of the public docs on `0.2.0-rc.1` (October 14) found five defects, fixed in #83, but it ran on Linux and isn't a person. The plan is the owner's own Mac run on the release source (the no-Kafka recipe and `npm run dev:lab` in lontra-creek, about 30–45 minutes) and the wording of a public gate issue. Whether that satisfies the check is the owner's call. |

Then the [release checklist](../../RELEASE_CHECKLIST.md): main-push CI and **Extended checks** on the exact release `main`, including the replicated tier, the Kafka with ACLs job and the Firefox and WebKit jobs.

## What does not gate this candidate

These gate the launch or `1.0.0`, not `1.0.0-rc.1`:

- **The hosted ACL change on streamotter.dev** (the trial and then enforcement, run by the rollout with devops). T-0 is set only after enforcement is accepted. The local ACL tier above tests the library against a broker with authorization; it does not replace the hosted rollout.
- **The site on the candidate:** there is no staging environment. "Staged on rc.1" means the site's Pages previews plus the live production backend on `1.0.0-rc.1`, so that re-pin is a public change on the live demo. It comes after Stage 5 finishes on the current backend, and the T-7 rehearsal runs on it. The backend moves to `1.0.0` on launch day. Publishing changes nothing on the site until a Lontra Creek PR moves its pin.
- **Pup Patrol** may pin the candidate for a preview; it moves to `1.0.0` after launch day.
- **docs.streamotter.dev and blog.streamotter.dev:** preview deployments worked on October 15 (after #80). Production docs build only from the `v1.0.0` tag (`DOCS_CHANNEL=release`, which refuses a prerelease). The blog must be live before T-7.
- **The recording** and the remaining launch-kit items in the promotion plan.

## Owner steps

1. Review and merge the release preparation PR. Ordinary merges never publish.
2. Confirm main-push CI is green on the exact merge commit, then run **Extended checks** on it (Actions → Extended checks → Run workflow, branch `main`) and check every job, including the ACL tier and Firefox/WebKit.
3. Do the runbook walk above, and decide the integrator check. Check that mail to info@streamotter.dev reaches you: the [code of conduct](../../../CODE_OF_CONDUCT.md) names it as the reporting address, and it ships in the tagged source.
4. Set the CHANGELOG heading's date: a one-line PR replaces "not yet published" with the planned publication date, as the `v0.2.0-rc.1` tag did, so the GitHub release's changelog link shows it. Its merge commit is the release commit; main-push CI must pass on it.
5. Tag that exact commit:

   ```bash
   git fetch origin main
   git tag -a v1.0.0-rc.1 -m "StreamOtter 1.0.0-rc.1" <merge commit>
   git push origin v1.0.0-rc.1
   ```

6. Actions → **Publish approved npm release** → Run workflow from `main` with tag `v1.0.0-rc.1` and a distribution tag. The launch plan says `latest` ("leave rc.1 on `latest` until `1.0.0`"), as with every release candidate so far; the workflow accepts `latest` or `next` for a prerelease, and the choice is the owner's. Review the preparation results and approve the `npm-release` job.
7. The workflow verifies the registry and the install (with TLS Kafka) and creates the GitHub prerelease. Then check the npm pages show the new READMEs.

After publishing, a follow-up PR records the publication (as for `0.2.0-rc.1`): the receipt in this file, the CHANGELOG link to the GitHub release, and the README, implementation status and release plan status lines. With `latest` on the candidate, the docs preview banner reads "npm latest is 1.0.0-rc.1"; `UPCOMING` in `apps/docs/src/site.ts` stays `1.0` until `1.0.0` is out. Between merging the release preparation and publishing, a docs preview built from `main` names `1.0.0-rc.1` as npm `latest` and links an npm page that doesn't exist yet, so don't deploy a docs preview in that window. If the candidate goes on `next` instead, that banner stays wrong until `1.0.0`.

## After publishing

- `npx streamotter@1.0.0-rc.1 --help` runs, and [Can you make it lie?](../../make-it-lie.md) works in a clean folder on the candidate, step by step (it was written against `0.2.0-rc.1`; run it again on `1.0.0-rc.1` and on `1.0.0`).
- The Console.dev Betas email is the one announcement at `1.0.0-rc.1`; everything else waits for `1.0.0` (launch plan).

## Toward 1.0.0: one launch day

The owner decided on October 16 that `1.0.0` drops the same day as the updated demo and the marketing, all ready together ([launch plan §3](../../promotion/launch-1.0/PUBLIC_LAUNCH.md#3-gates-and-timing)). So everything is staged and tested on `1.0.0-rc.1`, and launch day only switches it over.

**Before launch day, on `1.0.0-rc.1`:**
- Publish `1.0.0-rc.1` (above); the seven-day soak with no blocking bug starts.
- In this order: the Kafka ACL enforcement accepted on the current backend (Stage 5), then the live backend re-pinned to rc.1 (a full rollout), then the T-7 rehearsal on it with the hosted Lab and the site's Pages previews.
- A docs preview and a blog preview with the 1.0 article, from `main`.
- The recording and GIF, on the rc.1 backend.
- Open and review, without merging: the `1.0.0` release PR (versions and the CHANGELOG entry only; the README, implementation status and release plan naming `1.0.0`), the Lontra Creek pin PR to `1.0.0`, the 1.0 article's post PR, and lontra-creek #56 (the docs link).
- Go/no-go at T-1.

**On launch day, before anything is posted** (the first post at 11:00 ET or later, with Codex on hand from the start; the backend rollout is the long step, and Stage 3's staging-to-acceptance alone took about 1 h 45 min):
1. Merge the `1.0.0` release PR; main-push CI on it.
2. Tag `v1.0.0` and run the publish workflow with `latest`; it verifies the registry and the install.
3. Deploy docs.streamotter.dev from the `v1.0.0` tag (the release channel).
4. Roll the backend out on `1.0.0`: merge the Lontra Creek pin PR and #56, then the image (registry approval), candidate, recovery evidence, activation and browser acceptance, with Codex.
5. Merge the 1.0 article and deploy the blog; update Medium; publish the GitHub release; pin the Discussion.
6. Check the site, docs and install on `1.0.0`, then post.

If step 2 or 4 fails, move the day: nothing has been announced. Pup Patrol moves to `1.0.0` after launch day. A runtime fix found during the soak ships as `rc.N+1` and restarts the seven days.

## Rollback

Never unpublish. If `1.0.0-rc.1` is broken and was published on `latest`: move `latest` back to `0.2.0-rc.1` for all six packages, deprecate `1.0.0-rc.1` with what is wrong, and fix forward as `1.0.0-rc.2` through the same checklist ([corrections](../../RELEASE_CHECKLIST.md#corrections-and-partial-releases)). Moving a distribution tag is a metadata correction and needs the owner's separate authorization. The journal schema is unchanged, so `0.2.0-rc.1` opens a journal the candidate wrote as it is. Going back brings back the defects listed under Fixed; for example, a source held for another Kafka cluster is no longer held at startup.
