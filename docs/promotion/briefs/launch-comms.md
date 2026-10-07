# Launch communications brief

September 27, 2026 · Research brief for the promotion plan

> **Note (September 27):** the decisions in [PLAN.md](../PLAN.md) supersede this brief's recommendations where they differ. Corrections are marked **[Correction]** in place.

This brief plans the main public push for StreamOtter and ships ready-to-review drafts in [`../drafts/`](../drafts/). Everything is prepared in advance. The owner, Jason Fricano, reviews it, posts under their own name, and replies. Rules, timing, and routes were checked on the web on September 27, 2026, and every source is listed at the end. Anything marked **unverified** couldn't be confirmed from a primary source.

## Summary

- **The launch is when streamotter.app and the Failure Lab go live**, not the Medium post. Show HN, Reddit, and the newsletters all wait for that. The owner gets one real Show HN per project: HN excludes blog posts and version bumps from Show HN and buries reposts.
- **HN now bans AI-written comments:** "Don't post generated text or AI-edited text." So the Show HN first comment and every HN reply must be in the owner's own words. The HN drafts here are notes and facts to write from, not text to paste. Plan 30–45 minutes of owner writing time for this before launch day.
- **A front-page spike can hit the demo's limit.** One published front-page run peaked at 308 concurrent visitors, about the demo's starting cap of 300 connections. The Failure Lab's three 5-minute benches can serve at most 36 visitors an hour. The site currently has only an "isn't answering… may be restarting or down" state, so over-limit visitors would think the demo is broken. A distinct "demo is full" state (the gateway already reports `OVERLOADED`) and a rehearsed spike are go/no-go items.
- **Top channels by impact per owner-hour:** newsletter submissions (about 20 minutes for four submissions reaching five newsletters), then Show HN (the anchor, about 4–5 hours including replies), r/apachekafka, LinkedIn, r/node. Skip Product Hunt, r/programming (bans project demos), and Lobsters (invite-only; new accounts can't use the `show` tag for 70 days).
- **Version:** cut `0.1.0` before launch if it needs no code changes and the site can re-pin and re-verify by T-3. Otherwise launch on the release candidate without apology. Don't delay the launch for it, and don't plan a second Show HN for `0.1.0`.

## Findings that shape the plan

| # | Finding | Consequence |
| --- | --- | --- |
| 1 | HN guidelines: "Don't post generated text or AI-edited text. HN is for conversation between humans." ([guidelines](https://news.ycombinator.com/newsguidelines.html)) | The owner writes the Show HN comment and replies themselves. [show-hn.md](../drafts/show-hn.md) and [hn-faq.md](../drafts/hn-faq.md) are talking points. The same courtesy is wise on Reddit, where many communities are hostile to AI-written posts, and r/reactjs has its own AI-content guideline (details unverified). |
| 2 | Show HN is for things people can try; "blog posts, sign-up pages, newsletters, lists, and other reading material" are off-topic, and version bumps don't qualify ([Show HN rules](https://news.ycombinator.com/showhn.html)). A small number of reposts is OK only if a story "has not had significant attention" ([FAQ](https://news.ycombinator.com/newsfaq.html)). | Submit the site (or the repository), never the Medium article. Wait until the demo is live. Treat it as a single attempt. |
| 3 | Public front-page reports: a peak of 308 concurrent users, about 1,750 page views an hour, and about 15,000 visitors over 20 hours ([Broadbent, 2024](https://harrisonbroadbent.com/blog/hacker-news-traffic-spike-anatomy/)); another run saw 35–40 visitors a minute for about an hour ([marcotm, 2023](https://marcotm.com/articles/stats-of-being-on-the-hacker-news-front-page/)). Most GitHub stars from a Show HN come within 48 hours ([King, 2026](https://danfking.github.io/blog/2026/04/23/show-hn-by-the-numbers/)). | Capacity and the busy state matter, and the README, docs, and install path must be right at T-0. Nothing can be fixed "next week" for that audience. |
| 4 | Lontra Creek: 300 concurrent visitors to start, and three Failure Lab benches leased for five minutes each, with a queue (Lontra Creek's `docs/PLAN.md`). The site's only degraded state reads "The live demo isn't answering right now… may be restarting or down" (`lontra-creek/apps/site/src/components/LiveCreek.astro`). StreamOtter reports an over-limit gateway as `OVERLOADED` ("try again later"). | Hand-off to the site project: show a separate, honest "the demo is full" state for `OVERLOADED`, with the labeled recording and local-run instructions. Consider connecting the home-page hero only once it's visible. |
| 5 | Reddit couldn't be loaded directly (reddit.com couldn't be checked). The rules below come from third-party trackers dated July–September 2026. | The owner reads each sidebar before posting (2 minutes each). The drafts follow the strictest reading. |
| 6 | The owner is one of four contributors to KafkaSocks (`oslabs-beta/Kafkasocks`, created May 2021, 19 commits by `jfricano`; GitHub API, September 27, 2026). | An authentic origin story for the first comment ("I worked on KafkaSocks in 2021…"). The owner should confirm how they describe their role. |
| 7 | GitHub: 0 stars, Discussions off, and the repository's website field points to the npm organization. | At launch, set the website field to streamotter.app (owner, 1 minute). Discussions is covered in the community brief. |
| 8 | Medium still shows `[DEMO URL, added at launch]` and the `tenantId: zsession.accountId` typo (reported; not re-checked). | Fix both before T-0. The content brief owns this (item 1 there). The article becomes the long read linked from posts, never the submission. |
| 9 | Console.dev lists pre-1.0 releases in its Betas section: "the release must be pre 1.0 and/or have an appropriate label" ([criteria](https://console.dev/selection-criteria)). | Release-candidate or `0.1.0` status helps here. |
| 10 | **[Correction: missing finding]** The Show HN page also says the project should be non-trivial: don't post quickly generated one-offs, and explain how and why you made it ([Show HN](https://news.ycombinator.com/showhn.html), checked 2026-09-27). | Say how it was built, plainly, in the first comment, and point to the verification (PLAN.md, the AI decision). |

## 1. What counts as the launch

**The launch is the day streamotter.app and the Failure Lab go live and the owner posts Show HN.** Reddit, LinkedIn, the social thread, and newsletter submissions follow over the next two to three weeks. The Medium article (September 25) was a soft announcement to an audience of roughly zero. It becomes supporting material: link it as "the longer write-up."

Why tie it to the site and demo:

- Show HN requires something people can try without signing up. The demo's anonymous volunteer session and the Failure Lab are the most direct proof of the core claim: live or visibly stale, never silently wrong. `npm install` alone asks readers to trust a README.
- The demo shows what a README can't: a connection dropped on purpose, a poison record pausing without skipping, and a slow client cut off while everyone else keeps flowing.
- One coordinated moment makes every channel point at the same working links.

### Release candidate or `0.1.0`?

| | Launch on the release candidate | Cut `0.1.0` first |
| --- | --- | --- |
| For | No delay. Invites feedback that can shape `0.1.0`. Console.dev's Betas section fits either way. `npm install streamotter` already installs `0.1.0-rc.3` (`latest`). | "rc" invites "come back when it's released" comments. `0.1.0` makes the story simpler: "pre-1.0, the API may change." It gives the launch post a clean version to name. |
| Against | Every post has to explain "release candidate of 0.1.0." Readers may read "rc" as unfinished even though SemVer 0.x already signals that. | Owner time to publish (passkey 2FA, about 30–60 minutes by the release checklist). Lontra Creek must re-pin, then rerun its checks. Launch feedback lands after the "release." |
| Either way | Pre-1.0 means breaking changes can come in a minor release (CHANGELOG). The limits don't change. A later `0.1.0` doesn't qualify for a second Show HN. | |

**Recommendation:** publish `0.1.0` at about T-7 if it needs no code changes and the site can pin it and pass its launch checks by T-3. Otherwise launch on the release candidate and say "release candidate; the API may change before 0.1.0" plainly. Never write `@next` anywhere (that tag is stuck on `0.1.0-rc.1`).

### Go/no-go (checked at T-1 evening and again at T-0 minus 30 minutes)

All must be true. Items marked (C) are automated checks done in advance; the owner checks (O).

1. **Links (C):** every URL in the drafts, the README, the site, the Medium article, and the npm pages returns 200 and lands on the right page. No `[SITE URL]`-style placeholders remain anywhere public.
2. **Install (C):** the README's "four commands, no Kafka" path works in a clean folder against the registry (`STREAMOTTER_INSTALL_FROM=registry pnpm test:install`, plus the four commands by hand).
3. **Demo healthy (C):** the walkthrough and all four Failure Lab scenarios pass on production. Measured timings are on the page.
4. **Spike rehearsal passed on staging (C, site project):**
   - With the load driven past the configured connection limit, over-limit visitors see a clear "demo is full" state, not "may be down."
   - With all three benches leased, the Lab shows queue position, a realistic wait (five-minute leases), and "run it locally."
   - With the demo host stopped, the static site still serves, and the live panels show the unavailable state and a *labeled* recording.
   - Memory and health alerts fire. Rollback has been rehearsed. The budget alarm is on.
5. **Claims (C):** README, IMPLEMENTATION_STATUS, the site's `/releases`, and every draft name the same version and the same limits. IMPLEMENTATION_STATUS records the release the site runs (Gate B).
6. **Medium fixed (O):** no placeholder, typo gone.
7. **Repository (O):** website field set to streamotter.app, the README links the live demo near the top, CI is green on `main`, and no known open bug contradicts a claim.
8. **Owner availability (O):** free for 3–4 hours from submission, with notifications on for HN replies (an email alert tool or a browser tab) and GitHub issues. Also able to check at the next morning's European hours.
9. **Accounts (O):** HN account signed in (an existing account is better than a new green one). Reddit account old enough, with some karma, for AutoModerator (unverified thresholds vary by subreddit).

If item 4 fails, either fix it or submit the GitHub repository URL instead of the site (see §2). If 1–3, 5, or 8 fail, move the day. There is no penalty for launching a week later.

## 2. Channel plan

Expected value is for the core audience: TypeScript developers on teams that run Kafka, then platform engineers. "Owner time" includes replying. The ranking is by impact per owner-hour.

| Rank | Channel | Expected value | Owner time | When | Draft |
| --- | --- | --- | --- | --- | --- |
| 1 | Newsletter submissions: Cooperpress (Node Weekly and JavaScript Weekly), Console.dev, Changelog News, Confluent Developer Newsletter | Medium–high: targeted reach, editors decide | 20 min total | T+1 | [newsletter-blurb.md](../drafts/newsletter-blurb.md), §4 |
| 2 | **Show HN** | Highest single audience of infrastructure-minded developers. The content brief found similar Kafka/WebSocket Show HNs at 10–14 points, so plan for modest and hope for more. | 45 min writing at T-3, then 3–4 h on launch day | T-0 | [show-hn.md](../drafts/show-hn.md), [hn-faq.md](../drafts/hn-faq.md) |
| 3 | r/apachekafka | High fit: Kafka teams are the core audience | 45 min | T+2 | [reddit.md](../drafts/reddit.md) |
| 4 | LinkedIn post | Medium: depends on the owner's network, which includes platform engineers | 15 min | T-0, midday | [linkedin.md](../drafts/linkedin.md) |
| 5 | r/node | Medium–high: a Node gateway | 45 min | Week 2 | [reddit.md](../drafts/reddit.md) |
| 6 | r/typescript | Medium: typed channels, generated types | 45 min | Week 2–3, optional | [reddit.md](../drafts/reddit.md) |
| 7 | r/javascript | Medium: broad; self-promotion allowed in moderation | 45 min | Week 3, optional | [reddit.md](../drafts/reddit.md) |
| 8 | r/webdev Showoff Saturday | Low–medium: broad, mostly not on Kafka | 30 min | A Saturday in week 2–3, optional | [reddit.md](../drafts/reddit.md) |
| 9 | Social thread (Bluesky, Mastodon, or X) | Low without an existing following | 10 min | T-0, midday | [social-thread.md](../drafts/social-thread.md) |
| 10 | Echo JS, DevHunt, awesome-kafka pull requests | Low, long tail | 5–15 min each | T+7 to T+14, optional | §4 |
| — | Product Hunt, Lobsters, r/programming, r/selfhosted, Bytes, TLDR | Skip (see §6 and §4) | — | — | — |

The dev.to and Hashnode cross-posts belong to the content brief (its item 6). I agree with it: launch week, canonical Medium.

### Rules and timing by channel

**Hacker News (Show HN).**
- Rules ([Show HN](https://news.ycombinator.com/showhn.html), [guidelines](https://news.ycombinator.com/newsguidelines.html), [FAQ](https://news.ycombinator.com/newsfaq.html)):
  - The title starts with "Show HN" and is at most 80 characters ([limit](https://news.ycombinator.com/item?id=7091257)). No superlatives, uppercase, or exclamation points.
  - Link to something people can try, "ideally without barriers such as signups."
  - Never ask anyone to upvote or comment. This includes "it's up, go look" messages to friends, colleagues, or social followers with the HN link.
  - Don't delete and repost.
  - Comments must not be generated or AI-edited.
  - A Show HN needs "a small points threshold" before it appears on /show.
- **URL to submit** (*superseded: PLAN.md chooses the GitHub repository, with the demo in the first comment*): the site, streamotter.app, if the spike rehearsal passes. It's the thing people can try, and its static pages stay up even if the demo host is saturated. Otherwise submit `https://github.com/jfricano/StreamOtter` and put the demo link first in the first comment. GitHub links suit developer-tool launches ([Markepear](https://www.markepear.dev/blog/dev-tool-hacker-news-launch)) and naturally throttle demo load.
- **Timing (heuristics, not rules):**
  - Conventional advice is a US weekday morning, "when the US technical audience is awake and you can spend the next few hours replying" ([Syften](https://syften.com/blog/hacker-news-marketing/)). Another guide says "Post when you can sit with the thread for the next three or four hours" and notes that weekday mornings bring both the most readers and the most competition ([Favors.dev](https://favors.dev/blog/show-hn-launch-guide)).
  - An analysis of 188,000 Show HNs found the best odds of 50+ points at Monday 00:00 UTC (Sunday 7 p.m. ET), when competition is lower ([King, 2026](https://danfking.github.io/blog/2026/04/23/show-hn-by-the-numbers/)).
  - An HN thread on the same question concluded timing "hardly matters" next to the product ([thread](https://news.ycombinator.com/item?id=44625897)).
  - **Pick the window where the owner can stay 3–4 hours.** Default: Tuesday or Wednesday, 8:00–8:30 a.m. ET. Alternative: Sunday about 7 p.m. ET if evenings suit the owner better.
- **If it sinks:**
  - Don't repost within days. A "small number of reposts" is allowed only when a story got no significant attention.
  - The moderators run a second-chance pool, and an HN moderator has said emailing hn@ycombinator.com about your own post is "fine" though they prefer third-party suggestions ([HN moderator](https://news.ycombinator.com/item?id=26998309)). One short, polite email after 2–3 days is acceptable. Optional.

**Reddit (all).**
- Reddit counts "users who contribute primarily with links to businesses they own or benefit from" as spam ([Reddit Help](https://support.reddithelp.com/hc/en-us/articles/360043504051-What-constitutes-spam-Am-I-a-spammer-)).
- Use text posts in the first person that disclose authorship. Write different text for each subreddit, never cross-post, and post at most one subreddit a day (in practice, one a week to fit the time budget).
- Reply to every good-faith comment within the first few hours.
- Timing heuristic: Tuesday to Thursday, 7–11 a.m. ET ([SocialBu](https://socialbu.com/blog/best-time-to-post-on-reddit)).

| Subreddit | Rule summary | Source and date | Fit |
| --- | --- | --- | --- |
| r/apachekafka | **Unverified**: no tracker covers it. Read the sidebar and pinned posts, and check for a "tool" flair or a vendor rule. | — | Best |
| r/node | No subreddit-specific rules displayed. The community discourages treating it "as a free advertising board" and welcomes real technical problems and lessons. | [Rankhog](https://rankhog.com/subreddits/node), Sept 18, 2026 | Good |
| r/typescript | **Unverified**: read the sidebar. | — | Good |
| r/javascript | Self-promotion is OK if it's not "a majority of your contributions." "Where's the Javascript?": demos need code. No paid-product advertising. | [Rankhog](https://rankhog.com/subreddits/javascript), Sept 18, 2026 | Fair |
| r/webdev | "No self-promotion"; showing off a project or asking for feedback only on Saturday (Showoff Saturday), with the focus on technical detail; no commercial promotion | [Rankhog](https://rankhog.com/subreddits/webdev), Sept 15, 2026; [RedditGrowthDB](https://www.redditgrowthdb.com/database/subreddits/webdev), July 13, 2026 | Fair |
| r/reactjs | Promote only as "an active and positive member." Portfolio Sunday for portfolios; AI-content and commercial guidelines exist (text unverified). | [Rankhog](https://rankhog.com/subreddits/reactjs), Sept 15, 2026; [OneUp](https://oneup.today/tools/reddit-self-promotion-checker/reactjs), July 13, 2026 | Skip unless the owner already participates there |
| r/programming | "Product promotion, startup promotion, project demos, and feedback requests are prohibited." | [RedditGrowthDB](https://www.redditgrowthdb.com/database/subreddits/programming), July 13, 2026; [Soar](https://www.soar.sh/blog/self-promotion-rules-by-subreddit-database), May 2026 | Skip |
| r/opensource | "Limited self-promotion" (details unverified) | [Hive Index](https://thehiveindex.com/communities/r-opensource/) | Low fit; skip |
| r/selfhosted | Not relevant: StreamOtter is a library, not a self-hosted app. | — | Skip |

**LinkedIn.** Post on the owner's personal profile, first person. Midweek beats Monday and weekends. Sprout Social's 2026 analysis puts the peak at Tuesday to Thursday, roughly 10 a.m.–noon local ([Sprout Social](https://sproutsocial.com/insights/best-times-to-post-on-linkedin/)); a heuristic. Link the site or GitHub, not the HN thread.

**Bluesky, Mastodon, X.** Optional. Use the platform the owner already has an account on. Without followers, reach is low. Hashtags help discovery on Mastodon (#TypeScript #NodeJS #ApacheKafka #OpenSource); a heuristic. Keep each post under 280 characters so one version works everywhere.

### Order and spacing (so the owner isn't overwhelmed or spammy)

| Day | Owner action | Owner time |
| --- | --- | --- |
| T-0 (Tue or Wed) | Show HN at 8:00 ET; replies until about 11:30. LinkedIn post and social thread about 12:00. Two 15-minute HN check-ins (afternoon and evening). | 3.5–4.5 h |
| T+1 | Morning HN check (European replies). Send the newsletter submissions (ready to paste). | 45 min |
| T+2 or T+3 | r/apachekafka post and replies. | 45 min |
| Week 2 | r/node post. Thank-yous. Triage the issues drafted from feedback. | 1.5 h |
| Week 3 | Optional: r/typescript or r/javascript, or Showoff Saturday on r/webdev. The "what we learned" decision. | 1–1.5 h |
| Week 4+ | Back to about 1 hour a week: issues, replies, and one piece of content a month (content brief). | ≤ 1 h/wk |

## 3. Launch runbook

### T-7 to T-1: preparation (about 2 owner-hours in total)

| When | Who | Task |
| --- | --- | --- |
| T-7 | Owner, 10 min | Decide: launch day and time zone; `0.1.0` or release candidate; Show HN URL (site, or GitHub fallback). |
| T-7 | Prep | Replace placeholders in all drafts with real URLs and the version. Link-check everything. Capture press-kit screenshots (§5). Hand the site project the spike-rehearsal checklist (go/no-go 4). |
| T-7 | Owner, 30–60 min, only if `0.1.0` | Publish by the release checklist, then verify from the registry. |
| T-5 | Owner, 20 min | Review the drafts. Edit anything that doesn't sound like you. Pick an HN title. Confirm the KafkaSocks wording and the "built with Claude Code" line (open questions 4–5). |
| T-4 | Owner, 10 min | Fix the Medium article (typo and demo link). Set the GitHub website field. Check that the HN, Reddit, LinkedIn, and social accounts sign in. |
| T-3 | Owner, 30–45 min | **Write the Show HN first comment in your own words** from [show-hn.md](../drafts/show-hn.md), and skim [hn-faq.md](../drafts/hn-faq.md) so the answers are familiar. Save the comment in a local note, not in a chat window. |
| T-3 | Site project | Soft launch: the site on the apex domain, unannounced. The spike rehearsal on staging passes. |
| T-2 | Prep | Rerun the link check and the registry install test. Confirm the site pins the announced version. Prepare a one-page "launch-day card": the title, the URL, the first-comment note, the five hardest questions, and the busy-demo reply. |
| T-1 evening | Both, 10 min | Go/no-go. If no-go, pick a new date. Nothing else changes. |

### Launch day, hour by hour (times ET; shift to the owner's zone)

| Time | Action |
| --- | --- |
| 7:30 | Rerun the link check and install check, and report the demo host's health. The owner opens the site on a phone, runs one Lab scenario, and confirms go. |
| 8:00 | The owner submits at news.ycombinator.com/submit: the title and URL, text left empty. They post their first comment within about a minute. They don't share the HN link with anyone. |
| 8:00–11:30 | Check every 10–15 minutes and reply to every substantive comment (see "Handling criticism" below). Log bugs and requests in a scratch file; they become issue drafts later. If a real bug appears, say "confirmed, filing it" and link the issue once the owner has opened it. |
| During | If the demo reports full or down, post the prepared reply in your own words (hn-faq.md, "The demo is down or full"). Don't change the submission URL. |
| ~10:00 | If the post has almost no points and isn't on /show, keep answering whatever comments exist. Don't repost, don't ask for votes. The rest of the plan doesn't depend on HN. |
| 11:30–12:00 | Break. |
| 12:00 | Post on LinkedIn and the social thread (links to the site or GitHub, never the HN thread). |
| 12:30–17:00 | Check HN about hourly for 10 minutes. |
| 17:00, 21:00 | 15-minute check-ins. |
| End of day | Compile the launch log: questions asked, doc gaps, bug reports, and feature requests, each marked as a draft issue, a doc fix, or an FAQ entry. |

### T+1 to T+14

- **T+1 (45 min):**
  - Morning HN pass, since European readers reply overnight.
  - Newsletter submissions (§4). Include the HN link only if the thread had real discussion; editors often read HN anyway.
  - Thank people who filed issues or gave detailed feedback, by replying on the issue or comment. No DMs to strangers.
- **T+1 to T+3:**
  - The owner opens the drafted issues. Label them `from-launch` so the follow-up post can cite them.
  - Correct documentation errors people found (release work), then say so in the thread: "fixed in the docs, thanks."
- **T+2 or T+3 (45 min):** the r/apachekafka post.
- **Week 2 (1.5 h):** r/node. A short "thanks + what changed" reply on the Show HN thread if anything shipped. HN threads stay open for replies for a while; an edit to the first comment is fine within HN's edit window.
- **Week 3 (1–1.5 h, optional):** r/typescript or r/javascript, or Showoff Saturday.
- **T+14, "what we learned" post (60–90 min, drafted in advance and rewritten by the owner).** Write it only if at least one of these holds:
  - a release shipped from launch feedback;
  - several substantive issues came in;
  - a technical question came up repeatedly and deserves a full answer (for example, the snapshot-then-subscribe race).

  Publish it on Medium (canonical) and cross-post per the content brief. It is not a Show HN. It can be an ordinary HN link later only if it stands on its own technically; HN allows your own work "part of the time."
- **T+14 (optional, 15 min):** pull requests to active awesome-Kafka lists (§4). awesome-nodejs needs 100 stars and a project older than 30 days, so not yet.

### Handling criticism and hard questions (HN and Reddit)

YC's own launch guidance for HN, written for Launch HN but applicable here ([yli](https://news.ycombinator.com/yli.html)):
- Write "as a peer."
- Stay "cheerful and non-defensive."
- Treat critics as doing you a favor.
- Aim to win over the silent readers, not the objector.
- "Don't write in a marketing, sales, or PR style."

In practice:

1. **Agree with what's true first.** Most hard questions have a true premise (one gateway, no replay, pre-1.0). Say "yes, that's a real limit" and then give the reason and the workaround.
2. **Answer with specifics and one link.** Link to IMPLEMENTATION_STATUS, DEPLOYMENT.md, or a guide section, not the home page.
3. **Never disparage alternatives.** If someone recommends Centrifugo, Ably, Lightstreamer, Zilla, or a hand-rolled bridge, agree where it fits better ("if you need replay or multiple nodes today, that's a better fit"). Say what StreamOtter chose differently.
4. **No numbers beyond the docs.** If asked about throughput or capacity: "I haven't measured capacity; the load test checks bounded behavior on one machine, and it's described here."
5. **Two exchanges maximum with a hostile commenter,** then stop. Don't flag critics. Don't edit the original post to dodge a point.
6. **Turn valid criticism into an issue** and say so.
7. **If a claim turns out wrong,** correct it in the thread, fix the doc, and thank the person.
8. **The owner's own words,** always. AI can help research an answer, but the text posted to HN is the owner's.

The prepared answers are in [hn-faq.md](../drafts/hn-faq.md). The likely hard questions, in order of likelihood:
- why not X;
- one gateway;
- release-candidate or pre-1.0 status;
- why Node;
- why Socket.IO and not WebSocket or SSE;
- KafkaJS maintenance;
- exactly-once and replay;
- managed Kafka;
- browser support;
- "did you build this with AI";
- is this a company;
- the demo is down or full.

## 4. Free newsletters and roundups

All routes verified on September 27, 2026 unless marked. Send each one once. Use [newsletter-blurb.md](../drafts/newsletter-blurb.md). The owner sends everything; nothing is emailed or submitted on the owner's behalf.

| Newsletter | Fit | Route | What to send | Source |
| --- | --- | --- | --- | --- |
| **Node Weekly** and **JavaScript Weekly** (Cooperpress; weekly, Node #642 on Sept 24, JS #803 on Sept 22) | High | Email editor@cooperpress.com (contact page). Subscribers can also reply to an issue: "Got a link for us? Reply and tell us." | One email naming Node Weekly first and JavaScript Weekly second, with the 2–3 sentence blurb and the GitHub and site links. JS Weekly's "Code & Tools" section lists open-source libraries. | [Cooperpress contact](https://cooperpress.com/contact/), [Node Weekly latest](https://nodeweekly.com/latest), [JS Weekly latest](https://javascriptweekly.com/latest) |
| **Console.dev** (weekly, Thursdays) | High | Email hello@console.dev | Blurb, GitHub, site, and "pre-1.0; for your Betas section." Their criteria: developer is the primary user, self-service, documented, CLI or API, actively maintained. | [Selection criteria](https://console.dev/selection-criteria) |
| **Changelog News** | Medium–high | Form at changelog.com/news/submit: URL, title, "What's interesting about it?" **[Correction]** Submitting requires signing in to changelog.com (checked 2026-09-27). | Link the GitHub repository. For "what's interesting," use the live/stale contract and the Failure Lab. "Submitting your own work is also encouraged." Commercial products aren't accepted; this is MIT and free. | [Submit page](https://changelog.com/news/submit) |
| **Confluent Developer Newsletter** (bimonthly) | High for Kafka teams | Email devx_newsletter@confluent.io; the newsletter says readers can "submit your own resource for consideration" | Blurb, framed for Kafka developers (Kafka to live web views), with GitHub and site. | [Year-end 2025 edition](https://developer.confluent.io/newsletter/2025-the-year-gone-by/). The route is stated there; still current is **unverified**. |
| React Status (Cooperpress) | Low | Same Cooperpress address | Only if a React recipe or page exists that's worth linking | [Latest](https://react.statuscode.com/latest) |
| "Interesting links" (monthly; Kafka and streaming) | High fit, no route | No submission route found. It lists new Kafka-ecosystem open-source projects, and a link on HN, Changelog, or Reddit is how it's likely to be found. Don't cold-pitch. | — | [July 2026 edition](https://interestinglinks.substack.com/p/2026-07) |
| Echo JS | Low | Community link site; account needed; active | One link to GitHub, T+7 | [echojs.com](https://www.echojs.com/) |
| DevHunt | Low | Free listing for developer tools, via GitHub pull request or login | Optional, T+7 to T+14 | [Repository](https://github.com/MarsX-dev/devhunt) |
| awesome-Kafka lists | Low, long tail | Pull requests by the owner: [infoslack/awesome-kafka](https://github.com/infoslack/awesome-kafka) (about 590 stars, active May 2026), [dharmeshkakadia/awesome-kafka](https://github.com/dharmeshkakadia/awesome-kafka) (active Sept 2026). [conduktor/awesome-kafka](https://github.com/conduktor/awesome-kafka) needs 50+ stars (per the community brief), so later. | One line; read each CONTRIBUTING first | GitHub search, Sept 27, 2026 |
| Bytes (ui.dev), TLDR | — | No public submission route found | Skip | [bytes.dev](https://bytes.dev/), [tldr.tech](https://tldr.tech/) |

## 5. Press kit (outline; the kit is [press-kit.md](../drafts/press-kit.md))

- **One-liner** (the product marketing brief's pick): "Kafka state in the browser that's either live or visibly stale, never silently wrong."
- **Boilerplate paragraph:** what it is, who it's for, what's verified, the limits, the license, and who built it.
- **Owner bio:** a placeholder for the owner to write, 2–3 sentences, first person optional. Includes the KafkaSocks line if the owner confirms it.
- **Key links:** site, GitHub, npm, getting started, implementation status, changelog, Medium article, and security reporting.
- **Fact sheet:** version, license, runtime, packages, verified matrix, limits, and "what's next" labeled as plans.
- **Logo files:**
  - `docs/assets/streamotter-logo.png` (800×455) and `streamotter-logo-full.png` (1536×1024), both committed.
  - The site's `apps/site/public/social-preview.png` (1200×630).
  - *Update 2026-09-27:* the brand kit is final (PRs #1 and #2, merged); see `docs/assets/README.md` and the press kit draft. `logo-brand-mark.svg`, `name-brand-mark.svg`, and `streamotter-brand-mark-spread.png` are source files, not for publishing.
- **Screenshots to capture** (from production, at T-7; recordings labeled as recordings):
  1. the home-page hero with a live subscription;
  2. the same view after "Drop my connection," showing `stale`;
  3. Failure Lab "Fouled sensor," with the trace showing `map` failing with `HANDLER_FAILED` and the source paused;
  4. Failure Lab "Satellite laptop," with the slow client disconnected while the view flows;
  5. workbench Preview and Inspect;
  6. the `npx streamotter dev` terminal banner;
  7. the ~5-line `watchJob` integration code;
  8. the README's first screen.

## 6. Product Hunt, Lobsters, dev.to

- **Product Hunt: skip for launch.**
  - Its audience skews toward founders and products, not Kafka teams.
  - A launch runs 24 hours from 12:01 a.m. PT and expects the maker in the comments all day, which the time budget can't cover.
  - The editors now feature a small share of launches (a third-party report says about 10% in 2025), and unfeatured launches get little distribution ([PH featuring guidelines](https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines), [Blazon](https://blazonagency.com/post/product-hunt-launch-guide); the share is **unverified** from Product Hunt itself).
  - Revisit only if a later, more visual release (for example the workbench) warrants it.
- **Lobsters: don't pursue.**
  - It's invite-only. New users can't use the `show` tag (or `announce`) for their first 70 days, and self-promotion should be "less than a quarter of one's stories and comments" ([about](https://lobste.rs/about)).
  - If someone else posts StreamOtter there, the owner may ask for an invite as the author through the Lobsters chat, then answer questions. That's opportunistic and zero-effort until it happens.
- **dev.to: worth it as a cross-post, not a launch venue.**
  - Low cost (about 20 minutes), long-tail search value, and a developer audience. The content brief owns it: canonical Medium, launch week.
  - DEV's AI disclosure tiers are optional, but "Deception is not permitted" ([DEV](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk)). Choose the "AI-Assisted" tier if the text was AI-drafted.

## 7. What to avoid

- Asking anyone, anywhere, to upvote or comment. Posting the HN or Reddit link on LinkedIn or social. Coordinated "support" from friends. HN detects voting rings and penalizes them ([FAQ](https://news.ycombinator.com/newsfaq.html)).
- Pasting AI-written text into HN comments (a guideline breach). On Reddit, posting the same text in several subreddits or several subreddits on one day.
- Submitting the Medium article as a Show HN; running Show HN before the demo is live; a second Show HN for `0.1.0`.
- Numbers that aren't in the docs, and any load-test number without "single-process loopback, not a capacity claim." Stars, downloads, or "used by" claims of any kind.
- Implying support that isn't verified:
  - multiple gateways, replay or history, or exactly-once;
  - Firefox or Safari;
  - managed Kafka services;
  - TLS with system trust, which is implemented but unverified and is what most managed services would use;
  - Kafka versions other than 4.1.2;
  - OAuth or mTLS to Kafka.
- Comparisons in the posts themselves. Talk about alternatives only when asked, factually, and generously.
- "Kafka in the browser," "sync engine," "real-time" as a headline, "scalable," "production-proven," "in 5 minutes" as a promise. Use "four commands, no Kafka" (the product marketing brief's vocabulary list).
- `@next` in any install command.
- Blurring the fiction: Lontra Creek's otters and people are made up; the pipeline is real. Say both.
- Launching on a day the owner can't stay for 3–4 hours, on a US holiday, or during a major industry event (heuristic).

## Open questions

1. **Launch date and the owner's time zone.** The runbook assumes ET and a Tuesday or Wednesday.
2. **Version:** cut `0.1.0` at T-7, or launch on the release candidate (recommendation above)?
3. **Show HN URL:** the site (recommended if the spike rehearsal passes) or GitHub?
4. **The AI question.** HN readers in 2026 will ask whether it was built with AI. I recommend the owner say so plainly in the first comment, in one sentence of their own. Being discovered later reads worse than disclosing. It's a positioning call.
5. **KafkaSocks wording.** The owner is one of its four GitHub contributors (2021). How do they want to describe that?
6. **Company and commercial intent.** What does the owner say if asked whether Orca Solutions plans a paid offering? My suggested honest default: "MIT; no paid product; no plans to announce."
7. **Accounts.** Does the owner have an established HN account and Reddit account (age and karma)? Which of Bluesky, Mastodon, or X, if any?
8. **Voice.** "I" everywhere (a solo maintainer). The Medium draft had an open "we" or "I" choice; recommend "I."
9. **Monitoring on launch day.** The demo host's public health can be watched and reported automatically. Who restarts or rolls back if needed (the owner, via the site project's workflow)?

## Hand-offs

- **Product marketing brief:** the drafts use its one-liner #1 and its vocabulary. PLAN.md may harmonize wording; please keep the limits sentence intact in every draft.
- **Community brief:**
  - GitHub Discussions and issue templates before launch, since feedback needs a home;
  - a `CODE_OF_CONDUCT.md` decision (open in RELEASE_PLAN);
  - ongoing presence on r/apachekafka;
  - the Lobsters invite if it ever arises;
  - awesome-list pull requests.
- **Content and SEO brief:** the Medium fixes (its item 1), the dev.to and Hashnode cross-posts, the T+14 "what we learned" post, and site metadata.
- **Site project (Lontra Creek):**
  - the `OVERLOADED` → "demo is full" state;
  - the spike rehearsal;
  - the Lab queue with wait time and local-run instructions;
  - optionally, connecting the hero only once it's visible;
  - the labeled recording;
  - the pinned version on `/releases`;
  - the per-IP API budget (30 at once, then one a second) may bite visitors behind a shared office NAT; worth a look.
- **Release work:**
  - `0.1.0` if chosen;
  - README "live demo" link near the top;
  - the GitHub website field (owner);
  - fixes to documentation errors found at launch.

## Sources (accessed September 27, 2026)

- Hacker News: [Show HN rules](https://news.ycombinator.com/showhn.html) · [guidelines](https://news.ycombinator.com/newsguidelines.html) · [FAQ](https://news.ycombinator.com/newsfaq.html) · [80-character title limit](https://news.ycombinator.com/item?id=7091257) · [second-chance pool (HN moderator)](https://news.ycombinator.com/item?id=26998309) · [launch guidance](https://news.ycombinator.com/yli.html) · [timing discussion](https://news.ycombinator.com/item?id=44625897)
- HN timing and traffic: [King, "Show HN by the Numbers" (2026)](https://danfking.github.io/blog/2026/04/23/show-hn-by-the-numbers/) · [Syften](https://syften.com/blog/hacker-news-marketing/) · [Favors.dev](https://favors.dev/blog/show-hn-launch-guide) · [Markepear](https://www.markepear.dev/blog/dev-tool-hacker-news-launch) · [Broadbent](https://harrisonbroadbent.com/blog/hacker-news-traffic-spike-anatomy/) · [marcotm](https://marcotm.com/articles/stats-of-being-on-the-hacker-news-front-page/)
- Reddit: [Reddit Help on spam](https://support.reddithelp.com/hc/en-us/articles/360043504051-What-constitutes-spam-Am-I-a-spammer-) · [Rankhog r/webdev](https://rankhog.com/subreddits/webdev) · [r/javascript](https://rankhog.com/subreddits/javascript) · [r/node](https://rankhog.com/subreddits/node) · [r/reactjs](https://rankhog.com/subreddits/reactjs) · [RedditGrowthDB r/webdev](https://www.redditgrowthdb.com/database/subreddits/webdev) · [r/programming](https://www.redditgrowthdb.com/database/subreddits/programming) · [OneUp r/reactjs](https://oneup.today/tools/reddit-self-promotion-checker/reactjs) · [Soar database](https://www.soar.sh/blog/self-promotion-rules-by-subreddit-database) · [Hive Index r/opensource](https://thehiveindex.com/communities/r-opensource/) · [SocialBu timing](https://socialbu.com/blog/best-time-to-post-on-reddit)
- Lobsters: [about](https://lobste.rs/about)
- Newsletters: [Cooperpress publications](https://cooperpress.com/publications/) · [contact](https://cooperpress.com/contact/) · [Node Weekly #642](https://nodeweekly.com/latest) · [JavaScript Weekly #803](https://javascriptweekly.com/latest) · [React Status #492](https://react.statuscode.com/latest) · [Console.dev criteria](https://console.dev/selection-criteria) · [Changelog News submit](https://changelog.com/news/submit) · [Confluent Developer Newsletter](https://developer.confluent.io/newsletter/2025-the-year-gone-by/) · [Interesting links, July 2026](https://interestinglinks.substack.com/p/2026-07) · [Bytes](https://bytes.dev/) · [Echo JS](https://www.echojs.com/) · [DevHunt](https://github.com/MarsX-dev/devhunt)
- Other: [Product Hunt featuring guidelines](https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines) · [Blazon on featuring rates](https://blazonagency.com/post/product-hunt-launch-guide) · [DEV AI disclosure](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk) · [Sprout Social LinkedIn timing](https://sproutsocial.com/insights/best-times-to-post-on-linkedin/) · [awesome-nodejs contributing](https://github.com/sindresorhus/awesome-nodejs/blob/main/contributing.md)
- Project: README.md, CHANGELOG.md, docs/FOUNDING.md, docs/RESEARCH.md, docs/RELEASE_PLAN.md, docs/IMPLEMENTATION_STATUS.md, docs/WEBSITE_AND_DEMO_PLAN.md, docs/DEPLOYMENT.md, docs/guides/getting-started.md; lontra-creek docs/PLAN.md, docs/DEPLOYMENT_PLAN.md, docs/HOSTING.md; GitHub API (repository metadata; KafkaSocks contributors); `npm view` (dist-tags)
