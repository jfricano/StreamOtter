# StreamOtter 1.0.0: public launch playbook

October 5, 2026 · Prepared for Jason Fricano · **Status: draft, revised after two review passes (see `REVIEW.md`). Updated Oct 7 with your answers: D2 is no, so the hosted Lab, the hosting configuration change and `/blog` are launch gates.** Nothing has been posted, submitted, emailed or changed anywhere. This builds on the Sept 27 plan (`docs/promotion/PLAN.md`); Sept decisions stand unless §8 says otherwise. Ground truth: `FACTS.md`.

---

## On one screen

**The concept in three lines**
1. The launch is a question: **"Can you make it lie?"** StreamOtter's one promise is that a view never says `live` while it's wrong, and a bad record is never skipped silently.
2. Anyone can test that today: press **"Drop my connection"** on the streamotter.dev home page and watch `live` → `stale` → `live`. Then borrow a bench in the hosted Failure Lab (S01–S06), or break it locally (no Kafka, about two minutes; or real Kafka with Docker).
3. One Show HN in your words, one 1.0 article, your own short "Making it lie" piece a week later. Built with Claude Code and Codex, said in one identical sentence everywhere (D4, approved Oct 7).

**Do these five things now** (about 75 minutes; none of them waits on 1.0)

| # | Do this | Time | Where |
| --- | --- | --- | --- |
| 1 | **Check your HN account.** Log in, note its age and karma (in a private note, not in this repo; see §11). If it's new or little-used, start ordinary participation now in your own words, or ask hn@ycombinator.com. If it can't submit by T-7, use Plan B (§4.5) | 5 min | news.ycombinator.com |
| 2 | **Fix the Medium story in place:** the AI sentence and the drafting line (`drafts/ai-disclosure.md`) in the first two paragraphs; `[DEMO URL, added at launch]` → the getting-started link; "I" not "we" in the intro | 20 min | `drafts/medium-audit.md` |
| 3 | **Approve the AI sentence** (or rewrite it once; after that it's identical everywhere) | 5 min | `drafts/ai-disclosure.md` |
| 4 | **Contact the KafkaSocks co-authors and the kafka-penguin team before launch** (notes kept privately) | 25 min | Appendix A |
| 5 | **Record the "Drop my connection" GIF** (10–15 s, live → stale → live) on the home page. It doubles as the browser check of whether the live demo answers, which the static page couldn't confirm | 20 min | `drafts/hero-demo-script.md` |

**The launch gates.** T-0 happens when these are true (D2 answered no, Oct 7: the launch waits for all of them):
- **Gates:** `1.0.0` on npm (via a quiet `1.0.0-rc.1` that passed the four roadmap §8 checks); streamotter.dev re-pinned to `1.0.0` with "Drop my connection" working and the "why this matters" annotations shipped ([site-annotations.md](site-annotations.md)); the local "make it lie" path documented in the repo; the labeled recording and GIF ready; your HN account able to submit Show HN (or Plan B).
- **Also gates since Oct 7:** the hosted Lab benches on (`lab.enabled`), the hosting configuration change so the Lab runs S01–S06 (S07–S09 stay local and CI only, by design), and streamotter.dev/blog with RSS and the 1.0 article ([briefs/blog.md](briefs/blog.md)).

**Decisions** (your answers of Oct 7 in bold; the drafts get updated to match)

| # | Decision | Answer | Why |
| --- | --- | --- | --- |
| D1 | Make "Can you make it lie?" the launch, led by "Drop my connection", with the hosted Lab and the two local tiers? | **Yes** (Oct 7) | The product's promise turned into something a stranger can test, with three ways in |
| D2 | Launch without the hosted benches, the hosting configuration change and `/blog` if they aren't ready by T-7? | **No** (Oct 7: "we can hold launch for these") | All three are gates. The launch date is set by the slowest of them and G1 |
| D3 | Release path: integrator named by **Fri Oct 16** and runbook walk done by **Fri Oct 30** (if nobody, you decide, e.g. walk it yourself on a clean machine and say so in the gate issue); `1.0.0-rc.1` quiet at T-14 apart from a Console.dev Betas email; `1.0.0` at T-5? | **An integrator is lined up, pending confirmation** (Oct 7); dates are proposals | Timeboxes the one gate with no owner; Betas only takes pre-1.0 versions |
| D4 | Use the one AI sentence on every outward-facing surface (Show HN comment, articles, Reddit, LinkedIn, social, Medium), never optional? | **Yes** (Oct 7), with Codex named next to Claude Code (`drafts/ai-disclosure.md`) | Said first, it reads as confidence; found later, it reads as hiding |
| D5 | Also put it (one line) in the README, which is the Show HN URL? Release notes and the Discussion can link to it | **No, for now** (Oct 7) | HN readers land on the README first. If no, the HN comment carries it |
| D6 | Reword "independent review" in the repo docs to "review by separate AI agent sessions that didn't write the code", before `1.0.0-rc.1`? | **Open.** With D5 no, the proposal is neutral wording instead: "a separate review pass" | "Independent" reads as outside people; HN will read those docs, and the 1.0 npm pages should carry the corrected text |
| D7 | Two articles (1.0 at T-0; your short "Making it lie" at T+7), the origin story as a LinkedIn post, and one Medium story updated in place? | **Open:** you asked about a LinkedIn page for the project. Recommendation: no page (the Sept "no brand accounts" decision stands); post from your own profile | Half the writing, and each piece has a reason to exist |
| D8 | HN Plan B: if your account can't submit by T-7, lead with r/apachekafka on T-0 and do Show HN later, once the account qualifies? | **Yes** (Oct 7) | Never a friend's account, never a repost; the rest of the plan doesn't depend on HN |
| D9 | No bots that post, reply, vote or DM anywhere; instead a read-only weekly listening digest (Reddit, Stack Overflow, HN, GitHub, dev.to), from which you pick at most two threads and reply by hand with disclosure? | **Yes** (Oct 7) | Every platform's rules ban promotional bots, and it would undercut the launch's honesty. About 15 min a week, replacing the optional Stack Overflow item. See `briefs/listening.md` |

**Your time:** about 16.5 hours from today to T+14, counting the decisions, approvals and your own writing; about 14.5 in the lean version (§5). Not counted: publishing rc.1 and 1.0.0, and the engineering approvals in the release and site work.

**Launch visuals** are ready (repo copies in StreamOtter PR #65, launch visuals); the list and caveats are in §9.

---

## 1. Diagnosis: why the soft launch didn't land

### What was checked (October 5)

| Asset | Found | How |
| --- | --- | --- |
| Medium, "Introducing StreamOtter: Live data that tells you when it's wrong" | Published Sept 26, 2026, a 9-minute read on the personal profile `kaleidoscopesharts.medium.com` (72 followers shown), not in a publication. Opens "You have probably built this. An order-status page…". **Still has `[DEMO URL, added at launch]`, no AI-assistance sentence, and "we" throughout.** The `authenticate` sample reads `tenantId: session.accountId`, so the `zsession` typo looks fixed (confirm in the editor) | Web fetch |
| Medium's AI policy | Disclose AI assistance "within the first two paragraphs"; "AI-assisted text without a disclosure will similarly be restricted to distribution on the author's personal network" | [Medium help](https://help.medium.com/hc/en-us/articles/22576852947223-Artificial-Intelligence-AI-content-policy), fetched Oct 5 |
| github.com/jfricano/StreamOtter | 0 stars, 0 forks, Discussions off, homepage = the npm org page. The description ("Kafka-to-browser state channels: …") is fine | `gh api` |
| README | Opens with the mission line, not the Kafka-to-browser line; still has the heading "Try it in five minutes"; no AI line | Repo clone |
| streamotter.dev | Up. Pins **`0.1.0-rc.3`**. The home page has the "Drop my connection" / "Restore it" control. `/lab` lists the four V1 exercises (Fouled sensor, Flash flood takes the relay, Laptop on a satellite link, Relay restart), with no Source failures track. `/blog` is 404. Home says "Five minutes, no Kafka needed". Whether the live demo answers couldn't be told from the static HTML (the no-JavaScript fallback) | Web fetch; site source |
| V1.1 preview | The Source failures track lists S01 (the existing Fouled sensor) plus 8 new exercises, S02–S09. They need a backend on a release with quarantine | Preview screenshots (not in this repo) |

### Why it underperformed
1. **It was never distributed.** No HN, Reddit, newsletter or LinkedIn post pointed at it, by design: the Sept plan held the push for the demo. A 72-follower profile was the whole audience.
2. **Medium probably held it back.** Unlabeled AI-assisted stories are limited to the author's network. One sentence fixes that.
3. **There was nothing to do.** The call to action was a placeholder. For this product, watching it stay honest under failure is the argument.
4. **"Introducing X" plus a feature tour** reads like every library announcement. The distinctive material (failure handling, the lineage, the Lab) came later.
5. **The front door doesn't explain itself**, and "release candidate of 0.1.0" said "come back later".

### What changes for 1.0

| Soft launch | 1.0 launch |
| --- | --- |
| An article announces it | **A question is the launch:** can you make it lie? |
| `0.1.0-rc.3`, "the API may change" | **`1.0.0`**, with the roadmap §8 compatibility promise |
| No failure story | **V1.1 failure handling is the headline:** by default (`pause`) a bad record holds its source; with `failureHandling` on, per-source policies can also quarantine a byte-for-byte copy, each failure is a journaled incident, and recovery is under operator control. Never skipped silently |
| Nothing for people who can't reach the demo | **"Drop my connection"** first (per visitor, no bench), then the local tiers, and a labeled GIF and recording for everyone |
| "We" | **"I"**, with the lineage in one short paragraph |
| Medium, unlabeled | **One Medium story, labeled, updated in place**, canonical to the post on `/blog` |

---

## 2. The concept: "Can you make it lie?"

### The rule people test
A subscribed view must never report `live` while it shows something other than the newest state your snapshot and the topic's revisions imply. A bad record must never be skipped silently: by default (`pause`) the source holds at it and nothing is copied; with `failureHandling` on, each failure is a journaled incident, and under `quarantine-hold` or `quarantine-resync` the quarantine copy must be byte for byte. Breaking any of those is a finding.

### Ways to break it (lead with the first)
1. **On streamotter.dev, today:** press "Drop my connection" on the home page. Every view says `stale` until fresh snapshots arrive, then `live` again. Per visitor, no bench. (Confirm in a browser: five-things #5.)
2. **Local tier (a), no Kafka, about two minutes:** `npx streamotter init .` in a new folder, add one fixture record `{ key, raw: "{not json" }` and a `quarantine-hold` policy for the scaffold's source (`docs/guides/source-failures.md` §2.5), run `streamotter dev`, advance the fixture, and watch the source hold at the bad record and the workbench Failures tab fill. Recipe verified in a clean folder on `0.2.0-rc.1` (Oct 5): `drafts/make-it-lie-local.md`. Re-run it on each rc.
3. **Local tier (b), real Kafka:** `npm run dev:lab` in the lontra-creek repo (Docker and Docker Compose 2.24.4 or later; three Lab benches at `https://localhost:8443/lab/`). lontra-creek is public (Oct 7). The source-failure exercises are on its main since #42 merged. All 8 new ones passed real-Kafka tests locally on `0.2.0-rc.1` with ACLs.
4. **Hosted Lab (a launch gate since Oct 7):** with the hosting configuration change in place, S01–S06 run there, plus the three Connections exercises; S07–S09 are local and CI only by design. Benches are scarce (contract defaults: 3 benches, 5-minute leases, a queue of 50), so copy offers a bench without promising one, and "Drop my connection" stays first. Until the Lab is on, `/lab` reads "The Lab is unavailable".

What each exercise shows: **Fouled sensor (S01)** is a mapper error under the `retry` profile. The source holds at that record, the view goes `stale`, nothing is skipped, and once the calibration is restored the same record is retried and the view is `live` again. **Garbled reading (S02)** is the quarantine case (the `quarantine` profile, with a `quarantine-hold` policy; the default `pause` copies nothing). The original bytes are copied byte for byte to the quarantine topic, and the source stays held until an operator retries it (`retry-current`); the recovery guard and `reassess` apply only under `quarantine-resync`. No single run shows both.

Optional, not promised: a small script that prints `LIED` or `HONEST` from the acceptance suite's live-versus-latest-revision check, only if it can be lifted without a runtime change.

### The pinned Discussion (GitHub text; you rewrite it)
Discussions turn on, as Sept decided. Draft:

> **Can you make it lie?** StreamOtter promises that a view never says `live` while it's showing something other than the newest state, and that a bad record is never skipped silently. If you turn on quarantine, the copy must be byte for byte. If you can break any of that, I want to know.
> - **Try:** "Drop my connection" on streamotter.dev; a Failure Lab bench on streamotter.dev/lab (you may wait in a queue); the no-Kafka fixture recipe [link]; the local Lab with real Kafka [link]; your own Kafka.
> - **Out of scope:** load or attacks against streamotter.dev or its server, anything that affects other visitors, and the documented limits (one gateway per project, no replay of missed updates). Security problems go privately through `SECURITY.md`, never here.
> - **What you get:** a "found by" credit in `CHANGELOG.md` and the release notes, if you want one. No money, no swag.
> - I'll reproduce each report and reply here.
> - **Found before 1.0** (the list starts here): [the eight defects below].

Internal notes (not for the Discussion):
- Your cost: about 15 minutes a day of triage in launch week.
- The invitation scope is agreed for the hosting setup at T-7.
- **The first eight entries** (all real): from `CHANGELOG.md` [0.2.0-rc.1] Fixed, defects present in the published `0.1.0-rc` releases: a client that stopped reading could grow gateway memory without limit; a record slower than the session timeout could be reprocessed forever; with `startFrom: "latest"`, a restart before the first record could skip records; `stop()` could hang on a handler module that never loaded; generated code didn't escape U+2028/U+2029. From the V1.1 review (`docs/releases/v1.1/REVIEW.md` §2, caught before release): R1, a record with two problems labeled with the milder one and skipped past an integrity failure; J2, a restarted container reading its own leftover lock as live; J1, the journal filling after about 2,700 automatic advances. Label them "found in pre-1.0 review". D6 decides the wording GitHub text uses for the reviews. The V1.1 review was six fresh AI agent sessions plus a seventh on the fixes, with no line-by-line human review. Who ran V1.2 is unconfirmed (its plan mentions "a second agent").

### Content: two articles, one origin post

| When | Piece | Home | Travels to |
| --- | --- | --- | --- |
| T-0 | **The 1.0 article** (`drafts/launch-article.md`; title per that file): problem → code → break it yourself, within the first third → short lineage → alternatives named, with a pointer to when to use them → limits | `/blog`, with the Medium story updated in place and canonical to it (§4.6) | Show HN comment, LinkedIn, README |
| T+3 | **Origin story** as a LinkedIn post (`drafts/origin-story.md`; two required slots are yours) | LinkedIn | OSLabs alumni; the KafkaSocks co-authors (ask before tagging) |
| T+7 | **"Making it lie"**, short and **written by you** (`drafts/making-it-lie.md` holds talking points): what strangers found, or, as the fallback, the pre-1.0 defects above | `/blog`, linked from the Medium story (no second Medium story); dev.to copy canonical to the blog | LinkedIn, the Discussion |

The bad-records and history material lives in the 1.0 article and `drafts/hn-faq.md`. b/kafka-websocket is a "how is this different" FAQ answer, not a demand signal. Lineage wording: KafkaSocks co-author (OSLabs, 2021; its last commit was June 2021), and V1.1's strategies inspired by kafka-penguin. No "ten-year thread", no "on and off for years". Alternatives exist (Centrifugo, Zilla, Ably, Lightstreamer; `docs/promotion/briefs/product-marketing.md` §3); never say nobody has solved this.

### Recording: one plan (`drafts/hero-demo-script.md`)
- **(a) GIF, 10–15 s:** "Drop my connection" on the home page, `live` → `stale` → `live`. Recordable now; re-record on `1.0.0` at T-4. For the README first screen, the Medium fix and social posts.
- **(b) Recording, 60–90 s:** S01 `fouled-sensor`, then S02 `garbled-reading`, both on the hosted Lab and labeled "hosted" (a local Lab stack, labeled "local stack", is the fallback if no bench is free while recording). Each segment carries where it was recorded: "Recording · <date> · streamotter@<exact version> · <hosted | local stack> · Lontra Creek is fictional; the Kafka pipeline is real."
- You record both with the OS screen recorder from the shot list (about 30 minutes). No Playwright recording of the hosted Lab is planned.
- Where it goes: the README (GitHub renders an uploaded mp4), the site's "demo is full" state, the 1.0 article, LinkedIn. No YouTube channel or brand account.

### What the Sept plan excluded, revisited

| Item | 1.0 answer | Why |
| --- | --- | --- |
| Video | **A GIF and one labeled recording, nothing more** | The demo caps visitors (Sept launch-comms brief, from Lontra's PLAN.md: 300 connections, three 5-minute benches), and the failure story is visual |
| Product Hunt, podcasts | **Still no** in launch week | Wrong audience; cold outreach with no users |
| Talks / CFPs | **Not in this plan**; revisit after T+14 | Acceptance is months away |
| Lobsters | **Unchanged** (invite-only per the Sept reading; not re-verified Oct 5) | If someone else posts it, ask for an author invite |
| dev.to | **Yes, per article**, canonical set, AI-Assisted tier | No extra writing |
| Console.dev Betas | **Submit at `1.0.0-rc.1`** (hello@console.dev), the one exception to the quiet rc | Its criteria: "pre 1.0 and/or have an appropriate label in the version number"; "Any GA or stable releases are not eligible" |
| Press kit, social thread | **Optional.** Keep the press kit's boilerplates; post the thread only if you already use the account | Nobody asks a new solo project for a press kit |

---

## 3. Gates and timing

```
Now (undated)                          Quiet pre-launch                                   Launch
G1 rc.1 checks ─┐
G2 front door ──┼─> 1.0.0-rc.1 (T-14) ─> soak ─> G4 (T-7) ─> 1.0.0 (T-5) ─> go/no-go (T-1) ─> T-0
G3 site ────────┘   (Console.dev only)                        site on 1.0.0
```

**G1, the `1.0.0-rc.1` gate** (roadmap §8; acceptance packet §10, steps 2 and 4 open as of Oct 5):
1. A run against a Kafka broker with ACLs enabled.
2. Firefox and WebKit browser tests. After this, say "tested automatically in Chromium, Firefox and WebKit (Playwright)". Never "Safari" unless it was tested.
3. The proxy deployment test with `failureHandling` on.
4. One integrator walks the source-failure runbook end to end: someone outside the build loop (a KafkaSocks co-author or a colleague who runs Kafka), with notes in the public gate issue, never quoted without their written OK. **Deadline per D3.**

**G2, the front door (before rc.1), one branch you approve:**
- README first screen: the one-liner, the GIF, a "Break it" block (drop your connection; the tier (a) recipe; the Discussion), "Try it without Kafka" in place of "Try it in five minutes", and the 1.0 status line. No AI line (D5 no, Oct 7).
- The local "make it lie" path documented: tier (a) run in a clean folder; tier (b) linked (#42 is on lontra-creek main).
- The repo follow-ups in §10, so the 1.0 npm pages carry the corrected wording.
- Community files, Discussions on, social preview. The homepage field changes to streamotter.dev at T-0.

**G3, the site** (the Lontra Creek project and its hosting setup):
- **Gate:** backend re-pinned to `1.0.0` (staging on `1.0.0-rc.1` first); the home page live panel and "Drop my connection" / "Restore it" work on `1.0.0` under the 300-connection cap; the `OVERLOADED` "demo is full" state shows the recording; copy fixes (the "streamotter.app" leftovers, "Five minutes, no Kafka needed", the "Planned for V1.1" blocks, the `/releases` versioning note); the five "why this matters" demo annotations in [site-annotations.md](site-annotations.md) (Jason, 2026-10-06: ship before launch).
- **Gate for tier (b) and the S02 recording:** #42 is merged on lontra-creek main (`6cb47e9`); re-pinning and deploying it to the host are pending.
- **Gate (D2 no):** `lab.enabled`, after your approval and its own acceptance. Contract defaults, not measured capacity (lontra `docs/contracts/lab-api.md` §2): 3 benches, 300 s max lease, 30 s claim, 30 s idle, a queue of 50, 2 per IP, 20 concurrent and 3/s per IP. Real values get recorded on the host before launch.
- **Gate (D2 no):** the hosting configuration change, so S02–S05 run alongside S01 and S06. Sequenced after the site's current release: Lab on first, then the change.
- **Gate (D2 no):** `/blog` with RSS and the 1.0 article, one Lontra Creek site change ([briefs/blog.md](briefs/blog.md)).

**G4, the rehearsal (T-7, staging, `1.0.0-rc.1`):** over-limit visitors see "full"; static pages survive the demo host stopping; "Drop my connection" works. The Lab queue shows the wait, and S01–S06 pass on the hosted Lab with the hosting configuration change in place. `/blog` and its RSS feed render on the preview. All 8 new exercises pass on the local Lab and in CI. The invitation scope and a T-0 morning on-call for the hosting setup are agreed.

**Considerations, not commitments yet** (Jason, 2026-10-06; details and open questions in [ideas-public-architecture-and-landing.md](ideas-public-architecture-and-landing.md)):
- Public architecture docs: the internal "How it works" page (part 1 of Under the Hood) as `docs/ARCHITECTURE.md` with its two diagrams as SVGs, after a trim and one accuracy review. Would sit with G2.
- A purely fun landing page (the otter, brand kit, general features, no demo or tech), most likely as the streamotter.dev front door with Lontra Creek one click behind. Would sit with G3.
- "StreamOtter Under the Hood" linked from streamotter.dev, most likely from the existing Docs page, with its own menu item as the alternative (Jason, 2026-10-07): an introduction page linking the five subpages (how it works, how it's built, why it's built this way, guarantees and limits, using and running it), now in StreamOtter PR #69 as `docs/under-the-hood/`, alongside the TypeDoc API reference already proposed for `/docs/api/`. Doubles as the contributor welcome kit. "Under the Hood" is a working title. Parked for now. Would sit with G2 and G3; details in [ideas-public-architecture-and-landing.md](ideas-public-architecture-and-landing.md) §3.

**Release rule:** `1.0.0` is `1.0.0-rc.N` republished with no runtime change (version and changelog only), after at least 7 days on that rc with no blocking bug. A runtime fix means `rc.N+1`, and T-0 moves out by at least 7 days. Leave rc.1 on `latest` until `1.0.0`; never mention `@next` (still on `0.1.0-rc.1`). npm trusted publishing waits until after launch.

**Why `1.0.0` at T-5 (Thu):** the passkey publish takes 30–60 minutes, and the site has to re-pin and rerun its checks; launch morning is the worst time for that. The launch is the announcement, not the registry timestamp.

### Go/no-go (T-1, and again 30 minutes before T-0's first post)
All must be true. If any fails, move the day; a week costs nothing.
1. The home page live panel and "Drop my connection" work on `1.0.0`, and the "full" state worked in rehearsal. The hosted Lab is on and you leased a bench and ran S01 and S02 yourself; `/blog` has the 1.0 article and a valid RSS feed.
2. Every public link returns 200. No placeholder or unresolved **[update at 1.0]** marker is visible anywhere.
3. The registry install test passes for `1.0.0`, and the no-Kafka commands and the tier (a) recipe work in a clean folder.
4. The README, `IMPLEMENTATION_STATUS.md`, `/releases`, the article and every draft name `1.0.0` and use the same limits sentence.
5. Medium has its fixes, CI is green on `main`, and no open bug contradicts a claim.
6. You wrote the HN comment and title yourself, and you're free for 3–4 hours plus the next morning.
7. T-0 on-call for the hosting setup is confirmed; the GIF and recording are uploaded and labeled.
8. Your HN account can submit Show HN, or Plan B (§4.5) is the plan.

### When T-0 can fall
- **The first Tuesday at least 14 days after `1.0.0-rc.1`**, 8:00 a.m. ET. (Sept allowed Tuesday or Wednesday; this calendar assumes Tuesday.)
- **Avoid** Nov 23–27 (US Thanksgiving week) and Dec 21–Jan 1. If T-0 can't land by Wed Dec 16, the next window opens Tue Jan 5, 2027.
- **The date is set by the slowest gate:** G1 (the integrator walk), the hosted Lab and the hosting configuration change, and the blog.
- **Check-in on Tue Nov 10:** if G1 or the Lab steps aren't done, choose December or January. No date is set, and nothing here commits one.

---

## 4. Runbook, T-14 to T+14 (T-0 is a Tuesday; no owner tasks on weekends)

"Prepared" means done in advance for you; nothing is posted, submitted or emailed on your behalf. The site rows belong to the Lontra Creek project and its hosting setup.

### 4.1 Now (until the gates are met)

| Item | Jason | Prepared |
| --- | --- | --- |
| The five things (top of page) | 75 min | Medium replacement sentences; GIF shot list |
| Answer D1–D9 (done Oct 7, except D4, D6, D7) | 15 min | Drafts updated to match |
| Ask an integrator for G1.4 (by Oct 16) | 10 min | The runbook walk-through checklist |
| G1 engineering | Review in the release work (not counted in §5) | The work, status-doc updates, the public gate issue |
| G2 front door and §10 follow-ups (one branch) | 45 min review, plus GitHub settings | README, make-it-lie docs, wording fixes, community files, social preview |
| Blog: byline and one-line bio; review the blog PR | 15 min | The blog PR (`briefs/blog.md`) |
| G3 hand-offs | — | Checklist for the Lontra Creek project and its hosting setup |

### 4.2 Quiet pre-launch, T-14 to T-1

| Day | Jason (time) | Prepared | Site / hosting |
| --- | --- | --- | --- |
| **T-14 Tue** | **Publish `1.0.0-rc.1`** (release work). Send the Console.dev Betas email (5 min) | Registry and provenance check; gate issue; drafts moved to rc.1 | Staging re-pinned to rc.1 |
| T-13 Wed | — | Link check of every draft; recording shot list | #42 on staging with rc.1 |
| T-12 Thu | 10 min: rc.1 link to the KafkaSocks co-authors (and the integrator if not already) | — | — |
| T-11 Fri | — | 1.0 article and Discussion text updated to rc.1 | — |
| T-10 Sat, T-9 Sun | — | — | — |
| T-8 Mon | 45 min: read the 1.0 article, write your own paragraphs, approve | `hn-faq.md` refreshed (talking points) | — |
| **T-7 Tue** | 30 min: **lock T-0** (or move it); approve the invitation scope; confirm the hosted Lab and the hosting configuration change are in place (D2: gates); last HN account check, else Plan B | Bench numbers confirmed on the host, not guessed | **G4 rehearsal**; scope sign-off; on-call agreed |
| T-6 Wed | 45 min: **write your Show HN comment and title yourself** (title inputs in `drafts/show-hn.md`); save them locally | rc soak report | — |
| **T-5 Thu** | **Publish `1.0.0`** (release work) | Registry check; README, `IMPLEMENTATION_STATUS.md` and drafts moved to `1.0.0` | Production re-pinned to `1.0.0`; checks rerun |
| T-4 Fri | 30 min: record the 60–90 s recording and re-record the GIF on `1.0.0` | Captions and labels; launch-day card (title, URL, comment note, six hardest questions, the "demo is full" reply) | — |
| T-3 Sat, T-2 Sun | — | — | — |
| **T-1 Mon** | 30 min: review LinkedIn and the Medium 1.0 text; sign in to HN, Reddit and LinkedIn; **go/no-go**. Then, about 20 min: merge the 1.0 article's post PR and run the site deploy (preview, then production) so it's on `/blog`. Evening, 25 min: update the Medium story in place (§4.6); finalize the `1.0.0` GitHub release notes; pin the Discussion | A report on each go/no-go item; final link and install checks | Confirms on-call |

### 4.3 Launch week, T-0 to T+7

| Day | Jason (time) | Prepared |
| --- | --- | --- |
| **T-0 Tue** | 7:30: on your phone, press "Drop my connection" and open the README. 7:45: repo homepage → streamotter.dev. **8:00: submit Show HN** (your title, `https://github.com/jfricano/StreamOtter`, text empty) and post your comment within a minute. Reply until about 11:30. 12:00: LinkedIn (link the site or GitHub, never HN). Check-ins at about 14:00, 17:00 and 21:00. **About 4.5 h** | 7:30 link, install and demo check. All day: a log of questions, bugs and doc gaps. Evening: draft issues, FAQ entries, doc fixes |
| T+1 Wed | Morning HN pass. **Newsletters:** one email to Cooperpress (editor@cooperpress.com, for Node Weekly and JavaScript Weekly); Data Engineering Weekly via a PR to its repo (it wants vendor-neutral articles, and the PR route is unverified); Changelog News only if it's still publishing (its News editor left in March 2026). No Confluent newsletter email and no Get Kafka-Nated (no route found). 15 min triage. **About 1 h** | Submissions ready to paste (`drafts/newsletter-blurb.md`) |
| T+2 Thu | **r/apachekafka** in your own words (read the sidebar first), then replies. 15 min triage. **About 1 h** | Talking points (`drafts/reddit.md`) |
| T+3 Fri | **LinkedIn origin post** (fill the two required slots). The KafkaSocks banner, if the co-authors agreed. 15 min triage. **About 45 min** | Banner PR; dev.to import check |
| T+4 Sat, T+5 Sun | — | — |
| T+6 Mon | 30 min: triage; file issues (label `from-launch`); ship doc fixes | Issue drafts, doc-fix PRs, a `1.0.1` candidate if a real bug was confirmed (the release rule applies) |
| **T+7 Tue** | **Publish "Making it lie"**, written by you, with credits; share it on LinkedIn. **About 1.5 h** | Talking points with the real findings, or the pre-1.0 fallback |

### 4.4 Week two, T+8 to T+14 (optional, except the retrospective)

| Day | Jason (time) |
| --- | --- |
| T+8 Wed | r/node, different text, your own words (45 min) |
| T+9 Thu | Confluent Community Forum, Tools category (20 min). If anything shipped from feedback, a short "thanks, here's what changed" reply on the Show HN thread (10 min) |
| T+10 Fri | One awesome-Kafka list PR (infoslack, dharmeshkakadia or monksy: no star floor; disclose authorship) (10 min) |
| **T+14 Tue** | 30 min retrospective; keep or close the invitation; back to the Sept steady state (1–2 h a week) |

### 4.5 HN Plan B
If your account can't submit Show HN by T-7 (or you're unsure and hn@ycombinator.com hasn't answered):
- **T-0 Tue, 8:00 ET:** r/apachekafka in your own words, leading with the bad-record question and the break-it recipes; reply through the morning. LinkedIn at noon as planned.
- **T+1:** newsletters as planned (editors pick from links, not from HN).
- **T+2:** r/node, moved up from T+8.
- **Later:** Show HN once the account qualifies, as the project's first and only Show HN, with whatever "Making it lie" turned up. Never have a friend submit, and never repost.
- If a Show HN sinks: no repost. One polite email to hn@ycombinator.com after 2–3 days is acceptable.

### 4.6 Medium: one plan
- **Now:** fix the story in place (five-things #2).
- **T-1:** publish the 1.0 article on `/blog`; in the evening, update the existing Medium story in place to that text, with its canonical link set to the blog (Edit story → ⋯ → More settings → Advanced Settings → "This story was originally published elsewhere" → Save canonical link → Publish; [Medium help](https://help.medium.com/hc/en-us/articles/360033930293-Set-a-canonical-link)).
- The updated story's first line reads: "Updated for 1.0.0 on <date>; first published September 26, 2026 for 0.1.0-rc.3." Keep the AI sentence. **Never a second, duplicate Medium story.** Check that the old URL still resolves after a title change (Medium URLs end in a story ID, so it should; unverified).

---

## 5. Your time, honestly

| Block | Items (minutes) | Hours |
| --- | --- | --- |
| Now | Five things (75), decisions (15), front-door review and settings (45), integrator ask (10), blog byline and PR review (15) | ~2.7 |
| T-14 to T-1 | Console.dev (5), rc.1 note (10), article paragraphs (45), T-7 calls (30), HN comment (45), recording (30), T-1 (75) | ~4.0 |
| T-0 | Submit, comment, replies, LinkedIn, check-ins | ~4.5 |
| T+1 to T+7 | Newsletters (60), r/apachekafka (60), origin post (45), triage (30), "Making it lie" (90) | ~4.75 |
| T+14 | Retrospective | 0.5 |
| **Core** | About 30 separate sittings, most of them 10–45 min | **~16.5** |
| **Lean** | "Making it lie" as a short Discussion and LinkedIn update instead of an article (saves ~1 h); the origin post after T+14 (saves ~45 min) | **~14.5** |
| Optional, week two | r/node, Confluent forum, HN thanks, awesome list | +1.5 |

Not counted: publishing `1.0.0-rc.1` and `1.0.0` (30–60 min each), the G1 engineering reviews, and the site release, `lab.enabled` and hosting configuration sessions, tracked separately. For comparison, the Sept plan was about 3 h before launch, about 4 h on launch day, then about 1.5 h a week.

---

## 6. Success signals (never quoted publicly)

| Signal | Source | What "working" looks like |
| --- | --- | --- |
| **People you don't know who say they run it** | Issues, Show and tell, dependents | The one that matters. Sept goal kept: 3 by day 90 |
| **Reports from strangers who ran the make-it-lie recipes**, especially ones that reproduce | The Discussion; issues labeled `make-it-lie` | Even one is strong. Zero is fine: the list already has eight real entries |
| An issue naming a real broker or managed service | GitHub | A fit signal |
| Newsletter pickups | Inbox | At least one |
| Referrers and popular paths | GitHub traffic (kept 14 days: snapshot at T-1, T+3, T+7, T+14) | Getting started and the recipes show up |
| Stars, npm downloads | `gh api`, api.npmjs.org | Visibility only; no goal |
| Show HN | The thread | Similar Kafka/WebSocket Show HNs got 10–14 points (Sept research). Plan for modest |

**Never say:** star or download counts as proof; "used by"; any capacity figure beyond the documented single-process loopback measurement; "Safari" or managed Kafka unless verified.

**Limits sentence for 1.0** (every long-form piece): one gateway per project; no replay of missed updates (a fresh snapshot instead); managed Kafka services unverified; KafkaJS 2.2.4 pinned behind an internal adapter; tested automatically in Chromium, Firefox and WebKit *(only once G1.2 passes; until then, "Chromium only")*.

---

## 7. Decisions: what each answer changes
- **D1, no:** fall back to a plain 1.0 announcement; the Discussion and the T+7 piece go.
- **D2, answered no (Oct 7):** T-0 waits for the hosted Lab, the hosting configuration change and `/blog`. January is possible if the Lab steps slip past the Nov 10 check-in.
- **D3:** change the dates freely. If nobody is named by Oct 16, you choose between walking the runbook yourself (and saying so) and waiting.
- **D4 and D5:** the sentence lives in `drafts/ai-disclosure.md`, and every draft points to it. D5 is no (Oct 7), so the README, release notes, issues and the Discussion carry no AI line.
- **D6:** one small docs PR (§10) before rc.1.
- **D7, no:** the Medium story stays as it is, and the 1.0 article goes only on `/blog`.
- **D8, no:** T-0 waits until HN works.

**Old numbers some drafts still use:** "decision 15" (switch the hosted Lab on) and "decision 16" (the hosting configuration change for S02–S05) are both D2 now, answered no: both are launch gates. "Decision 17" (how to describe the reviews) is D4–D6.

**Sept decisions that stand:** the Show HN URL is the GitHub repo, with the demo in your first comment; the Show HN comment and replies are in your words; Reddit is rewritten by you; no Stack Overflow drafts; "I" everywhere; the Orca Solutions answer; no brand accounts; Discussions with Q&A, Ideas, and Show and tell; the response aims; the KafkaSocks plan and wording; listings by star threshold; a steady state of 1–2 h a week; npm trusted publishing after launch; all Sept guardrails.

---

## 8. Where this differs from the Sept 27 plan

| Sept | Now | Why |
| --- | --- | --- |
| Launch on `0.1.0` or the rc | **`1.0.0`, via a quiet `1.0.0-rc.1`** | Your Oct 5 version decision (roadmap §8) |
| streamotter.app (and `conduct@streamotter.app`) | **streamotter.dev** (`conduct@streamotter.dev`) | The site's `astro.config`; the preview `/releases` page still says .app |
| Firefox/WebKit if ready by T-7, otherwise a starter issue | **A hard gate before rc.1** | Roadmap §8; acceptance packet §10 |
| Trigger: the site and Failure Lab live | **Same trigger, with the hosting configuration change** so the Lab runs S01–S06 (D2 no, Oct 7) | You chose to hold the launch for the hosted Lab (S07–S09 stay local by design) |
| Nov 10: launch on GitHub alone, or wait | **A check-in on Nov 10** (December or January) | Launching without the Lab is off the table (D2 no) |
| Medium stays put; `/blog` after launch | **`/blog` before launch; one Medium story, updated in place to 1.0**, canonical to `/blog` | One URL, no duplicate |
| No video | **A GIF and one labeled 60–90 s recording** | §2 |
| No talks | **Not in this plan; revisit after T+14** | It doesn't affect the launch |
| Show HN title decided | **The Sept title is an input; you write the final one** | HN's rules cover generated text in posts, and "Kafka state in the browser" sits one word from a banned phrase |
| "Did you build this with AI?": a sentence of your own | **One identical approved sentence everywhere, never optional** (D4 open); review wording per D6 (open; proposal: "a separate review pass" on GitHub) | Consistency is what makes it credible (D4–D6) |
| Four newsletter submissions the next day | **Console.dev at rc.1; at T+1, Cooperpress (one email), Data Engineering Weekly, and Changelog News only if it's publishing** | Console.dev takes pre-1.0 only; no Confluent or Get Kafka-Nated route found |
| Limits sentence ends with "pre-1.0" | **The compatibility promise instead** | 1.0.0 |
| About 3 h before launch, 4 h on the day, 1.5 h a week | **About 15 h from today to T+14 (lean: about 13)** | The invitation and your own writing |

---

## 9. Launch visuals
The final files are in StreamOtter PR #65 (launch visuals: `docs/assets/social/`, `docs/assets/articles/`), which is not part of this kit.

| File | Use | Note |
| --- | --- | --- |
| `github-social-preview.png` | Repo social preview (G2) | |
| `og-card.png`, `og-card-light.png` | Link cards for the site and README | |
| `make-it-lie.png` | The Discussion, the README "Break it" block, posts about the invitation | |
| `linkedin-post.png`, `linkedin-banner.png`, `avatar.png` | LinkedIn launch post, profile banner, avatar | |
| `article-1-0-launch.png`, `article-1-0-launch-og.png` | Header and link card for the 1.0 article | Shows "1.0": use only once `1.0.0` is out |
| `article-making-it-lie.png`, `article-making-it-lie-og.png` | Header and link card for the T+7 piece | |
| `lineage-strip.png`, `-dark.png`, `-square.png` | The article's lineage paragraph; the LinkedIn origin post | |
| `recording-title.png`, `recording-end.png` | Title and end cards for the 60–90 s recording | Placeholders (`2026-10-XX`, `X.Y.Z`) must be re-rendered with the real date and version |
| `gif-caption.png` | Caption card for the "Drop my connection" GIF | |
| `kafkasocks-banner-draft.png` | KafkaSocks "successor project" banner | Only with the co-authors' OK |
| `illustrations/diagram-bad-record-flow`, `diagram-core-model`, `live-vs-stale` (`.svg`, each with a `-dark` variant) | The 1.0 article, the README, the press page | |

The GIF and the recording themselves are yours to capture (§2).

## 10. Repo follow-ups for Jason (one small docs PR when you say go)
Not done in this kit. Each was checked in the repo clone on Oct 5.
- `docs/guides/source-failures.md:3` says the V1.1 features are "not yet in a published release" (they shipped in `0.2.0-rc.1`). Every draft links this runbook.
- `docs/IMPLEMENTATION_STATUS.md:155` still lists "No production health endpoint"; V1.1 added `/health/live` and `/health/ready`.
- `README.md:32`: the heading "Try it in five minutes" → "Try it without Kafka".
- "Independent review" without saying who did it (D6): `CHANGELOG.md:16` and `:53`; `docs/IMPLEMENTATION_STATUS.md:199`, `:236` and `:252`; the title and line 3 of `docs/releases/v1.1/REVIEW.md`; `docs/API_AND_FEATURE_ROADMAP.md:9` ("V1.2 is an independent quality review…"). The same wording appears in about a dozen more release docs (among them `docs/releases/README.md:6`, `v1.1/README.md`, `v1.1/ACCEPTANCE_PACKET.md`, `v1.1/EVIDENCE.md`, `v1.2/README.md:3`, `v1.2/PHASE_A_FINDINGS.md:3` "Four independent reviewers", and the `v1.2.1/REVIEW.md` title). A grep for "independent" finds them.
- Optional: the README's "verifiably `live`" (the kit drops "verifiably" from short copy).

## 11. Open items (couldn't verify)
- **Your HN username, karma and account age:** not recorded; check them privately (five-things #1) and don't record them in this repo.
- **Whether the live demo answers:** the static HTML is only the no-JavaScript fallback. The GIF (five-things #5) settles it.
- **Measured bench and connection capacity on the host** (only the contract defaults are known), and whether phase one is deployed: to confirm on the host.
- **Who ran the V1.2 review:** unconfirmed; assume AI agent sessions until checked.
- **Medium:** whether a title change keeps the old URL; whether Medium actually limited this story (the policy is verified, but the story's classification isn't visible).
- **Changelog News** still publishing; the Data Engineering Weekly PR route; r/apachekafka's rules (unverified).
- b/kafka-websocket's last commit date (the Sept brief recorded a last push in Dec 2023; never say "since 2015" or "abandoned"). Star counts (353, 113, 73) were read on Oct 5.

---

## Appendix A: the two notes

Contact the KafkaSocks co-authors and the kafka-penguin team before launch (notes kept privately). Write them in your own words.
