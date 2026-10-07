# Review of the launch kit (October 5, 2026)

## The reviews
Two separate review passes that didn't write the kit (both were AI review passes), done read-only, with nothing posted. Their full reports aren't kept in this folder; this file and `review/FIX_DECISIONS.md` summarize them.
- **Accuracy and consistency:** every claim checked against the repo clone, a local copy of the lontra-creek source and screenshots, the 0.2.0-rc.1 rollout plan (not published), npm, the GitHub API and the live sites.
- **Strategy:** is it special, realistic for one person, clear in five minutes; do the drafts land; reputation risks.

Binding calls for the fix pass followed (`review/FIX_DECISIONS.md`). They were applied in two passes: one to the drafts, one to this file, `PUBLIC_LAUNCH.md` and `README.md`.

## Counts
- Accuracy: **4 blockers, 19 should-fix, 19 nits.**
- Strategy: **5 top changes**, plus about 73 per-file findings (26 must, 38 should, 9 could).
- Verdict in short: the concept was right, but the kit didn't use it; the plan rested on five things that weren't true yet, with no fallback; three drafts disagreed with the plan; and the repo calls the AI review passes "independent review".

## What was fixed
**The plan (`PUBLIC_LAUNCH.md`)**
- A one-screen summary: five things to do now, the minimum launch (gates and bonuses), the concept in three lines, eight yes/no decisions (down from 17).
- "Can you make it lie?" is the launch, led by the home page's "Drop my connection" button, with two local tiers; the hosted Lab, the hosting configuration change for S02–S05 and `/blog` are bonuses, not gates.
- B1: Fouled sensor (S01, retry) and Garbled reading (S02, quarantine) described separately; no single run claims both. B2: no claim that the hosted Lab runs all eight exercises (S01 and S06 only, until a hosting configuration change lands; S07–S09 never).
- Bad-record wording: the default `pause` holds the source and copies nothing; the byte-for-byte copy and the journal come only with `failureHandling` on (a correction made during the pass).
- The launch visuals (PR #65) are listed with their caveats (§9).
- G4 no longer requires S07–S09 on staging. The Discussion draft's internal notes now sit outside it. No Playwright recording of the hosted Lab. One recording plan (GIF, then S01 and S02 on a local stack, labeled).
- Console.dev at `1.0.0-rc.1` is named as the one exception to the quiet rc. Newsletters cut to Cooperpress, Data Engineering Weekly and Changelog News (if still publishing); no Confluent newsletter or Get Kafka-Nated email.
- Four reveals cut to two articles plus a LinkedIn origin post. One Medium plan, never a duplicate story.
- Calendar weekdays corrected for a Tuesday T-0, with no owner tasks on weekends; T-0's publishing chores moved to T-1 evening.
- Hours re-estimated item by item, an HN Plan B added, star goals removed, the lineage overclaims dropped, the Sept-differences table updated, and the nits (N1–N9, N18) taken.

**The drafts** (a parallel pass; each file's header notes its changes): the hook in Show HN, the article, Reddit, LinkedIn; the hosted-Lab conditions (B3, B4); one AI sentence in `drafts/ai-disclosure.md`; the new `drafts/making-it-lie.md`; the origin story as a LinkedIn post; the Medium, Console.dev and recording conflicts; the "if they were AI agents" hedges removed.

**The index (`README.md`)** lists only files that exist; the missing-`REVIEW.md` row is now this file.

## Left for Jason, on purpose
- The eight decisions (D1–D8), including the AI sentence's wording and whether it goes in GitHub-bound text (README, Discussion, release notes).
- Checking your HN account; writing the Show HN comment and title, the Reddit posts and "Making it lie" in your own words.
- Naming the outside integrator by the D3 date, or deciding without one.
- Switching on the hosted Lab and the hosting configuration change (the hosting setup and your approval).
- Not applied, because they were outside both fix passes' files: the review passes' suggestions for `FACTS.md` (note the repo's "independent review" wording, the "Drop my connection" control, the local Lab's Docker needs; N15's S01/S02–S09 wording) and for `briefs/channels.md` (N16, the :13 and :193 Lab lines, a short summary at the top). `PUBLIC_LAUNCH.md` carries the corrected facts.

## Repo follow-ups (one small docs PR when you say go)
Listed with line numbers in `PUBLIC_LAUNCH.md` §10:
- `docs/guides/source-failures.md:3` still says "not yet in a published release".
- `docs/IMPLEMENTATION_STATUS.md:155` still says "No production health endpoint".
- `README.md:32`, "Try it in five minutes" → "Try it without Kafka".
- "Independent review" in `CHANGELOG.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/API_AND_FEATURE_ROADMAP.md`, the `docs/releases/v1.1/REVIEW.md` title, and about a dozen more release docs.

## Architecture fact-check (2026-10-05)
Checked every technical claim in `PUBLIC_LAUNCH.md` and the nine launch drafts against the repo at `main` 1c75aaa (code wins over the architecture page). No draft said "exactly once", "guaranteed delivery" or "every update reaches the browser", or implied deltas or replay; defaults, limits, test counts, failure classes and the circuit breaker (five incidents per 60 s, per `contracts/src/failures.ts`) checked out. Changed:
- `PUBLIC_LAUNCH.md` §2 (S02): the source held under `quarantine-hold` comes back by `retry-current`; the recovery guard and `reassess` apply only under `quarantine-resync`.
- "Slow clients are disconnected" → an overflowing subscription re-snapshots, and a client that stops acknowledging (no receipt in 5 s) is disconnected: `drafts/hn-faq.md`, `drafts/press-kit.md` ("Bounded delivery"), `drafts/reddit.md` (r/node), `drafts/social-thread.md` post 4 (count note updated to 255).
- `drafts/press-kit.md` screenshot 7 caption: the trace order no longer puts the commit after the browser's receipt.
- `drafts/social-thread.md` post 6 note: with `failureHandling` on, `pause` still records an incident.
- `drafts/hn-faq.md`: durable incidents need a state directory; the load-test quote matches `IMPLEMENTATION_STATUS.md` word for word; new "Architecture" section (commit point and crash windows, whole-state frames, backpressure, tenant isolation, where state lives, throughput, one gateway and V2, the six packages) with repo paths, plus a launch-day card row.
