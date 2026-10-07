# StreamOtter promotion plan

September 27, 2026 · Prepared for Jason Fricano · **Status: ready for your decisions.** Nothing has been posted, submitted, or changed outside `docs/promotion/`.

## The plan on one screen

**Goal.** Put StreamOtter in front of the developers who need it most, turn their interest into a GitHub following (stars and release watchers), and help the first outside teams run it. The budget is $0: one launch push, then 1–2 hours a week.

**Who it's for:**
1. TypeScript and JavaScript developers at companies that already run Kafka, holding a ticket like "make the order page update live."
2. Teams that built their own KafkaJS + Socket.IO bridge and now see wrong screens after reconnects.
3. Platform engineers asked "can the frontend read this topic?"

KafkaSocks users are a small, warm bonus. It's not for teams without Kafka, chat, replayable feeds, or multi-node HA today.

**Positioning:** *Kafka state in the browser that's either live or visibly stale, never silently wrong.*

**Headline (your decision, 2026-09-27):** *Live state from Kafka to the browser. Never silently wrong.* The two lines do different jobs:
- **The headline** goes on the site's h1, the site footer, and the site's link card.
- **The positioning one-liner** opens the README intro, the npm descriptions, and the launch posts.

- **Supporting:** an open-source (MIT) Node.js gateway and TypeScript browser SDK, with a CLI and local workbench. Each view starts from your app's authoritative snapshot, then gets full-state updates in revision order, and your own handlers decide who sees what.
- **Limits sentence (every long-form post):** one gateway per project; no replay of missed updates (a fresh snapshot instead); Chromium is the only browser tested automatically; managed Kafka services are unverified; pre-1.0.

**Three phases:**
1. **Before launch:** fix the front door, reach KafkaSocks' audience, and prepare launch day. About 3 hours of your time.
2. **Launch week** (when streamotter.app and its Failure Lab are live): Show HN, LinkedIn, newsletters, r/apachekafka, r/node. About 4 hours on launch day, then about 1.5 hours a week.
3. **Steady state:** at most 1–2 hours a week, one article a month, and listings as star thresholds are met.

**Numbers to watch (privately):** people you don't know who say they run it (the one that matters); stars; npm downloads in weeks without a release; GitHub visitors and referrers.

## If you only do five things

| # | Action | Your time | Why |
| --- | --- | --- | --- |
| 1 | **Fix the Medium article:** correct `zsession.accountId`, replace `[DEMO URL, added at launch]` with the getting-started link, add one sentence saying it was written with AI assistance, and upload the ready header image | 15 min | It's the only live asset. Medium asks for an AI note in the first two paragraphs and limits distribution without one (per 2024 reports; its help page couldn't be checked). |
| 2 | **Approve the front-door change** (README first screen, a when-to-use page, community files) **and apply the GitHub settings** | 60 min | Every channel ends at the repo. Today its first line doesn't name Kafka or the browser, and it has no social card or Discussions. |
| 3 | **Ask the KafkaSocks co-authors about a "successor project" banner** | 15 min, plus replies | KafkaSocks has 113 stars and exactly our audience, and you co-wrote it. |
| 4 | **Show HN:** write your first comment yourself at T-3, then stay with the thread for 3–4 hours | 45 min, plus a morning | The largest single audience of infrastructure developers, and one real attempt. |
| 5 | **Send the four newsletter submissions** the next day | 20 min | Five targeted newsletters, and their editors pick the links. |

## Decisions for you

Say yes, no, or change each one, and the drafts get updated to match.

| Decision | Recommendation | Why |
| --- | --- | --- |
| **Launch trigger and date** | Launch when streamotter.app, the walkthrough, and the Failure Lab pass the site's launch checks. Pick the first Tuesday or Wednesday at least 7 days after the site's quiet soft launch, at 8:00 a.m. ET. Avoid Nov 23–27 and Dec 21–Jan 1. **Backstop:** if the site isn't live by Tue, Nov 10, choose between launching on GitHub alone (the four-command local try qualifies) and waiting. | The demo is the strongest proof. You get one real Show HN, and a week's delay costs nothing. |
| **`0.1.0` or release candidate** | Publish `0.1.0` about T-7 as the release that updates the npm pages (description, keywords, site link), if it needs no runtime changes and the site can pin it by T-3. Otherwise launch on `0.1.0-rc.3` and say "release candidate; the API may change before 0.1.0." | You need a release anyway, because npm shows each version's own README. It also heads off "come back when it's released." No second Show HN either way, and never `@next`. |
| **Show HN link** | `https://github.com/jfricano/StreamOtter`, with the demo in the first lines of your comment and near the top of the README | The library is what people run. Repo visitors star and watch, which is the following we want. The demo caps at 300 connections and three Lab benches. *Overrides the launch brief's default (the site).* |
| **Show HN title** | `Show HN: StreamOtter – Kafka state in the browser, either live or visibly stale` (79/80 characters) | It names the source, the destination, and the difference. |
| **KafkaSocks** | Yes. Contact the KafkaSocks co-authors before launch (notes kept privately). With their agreement, add a README banner (you have admin rights) and a pointer on its open issue #49. Wording: "the successor to KafkaSocks, from one of its original authors." | Verified: you're one of its four GitHub contributors and one of its three npm maintainers. |
| **Discussions** | On, with Q&A, Ideas, and Show and tell (delete General and Polls). No Discord or Slack. | Answers are indexed and arrive in the same inbox as issues. Show and tell is where "used by" evidence comes from. |
| **Code of conduct** | Contributor Covenant 3.0, with a forwarding contact such as `conduct@streamotter.app` (Cloudflare Email Routing is free) | It closes the release plan's open item and completes GitHub's community profile. |
| **Response aims** | Issues and discussions within 7 days; security acknowledged within 3 business days. Use numbers you'll keep. | An evaluating team lead first checks whether anyone is home. |
| **"I" or "we"** | "I" everywhere | You're a solo maintainer. |
| **"Did you build this with AI?"** | Yes, in a sentence or two of your own in the first comment: built with Claude Code; you set the direction and specification, made the decisions, and reviewed; the test suites, including real Kafka, are how you checked it. Same answer everywhere; label AI-assisted articles. | It will come up: the public history starts with one commit adding all of V1 (September 24), and Show HN's rules warn against quickly generated projects. Said first, it reads as confidence; found later, as hiding. |
| **"Company? Paid?"** | "Orca Solutions is the name I do business under. It's MIT, there's no paid product, and nothing to announce." | It's true and short. |
| **Home for articles** | After launch, the Lontra Creek project adds `/blog` with RSS, and monthly pieces go there. The Medium announcement stays put. If the blog isn't ready for piece 1, use Medium and leave it there. | Search value builds on the product's own domain. With RSS, dev.to imports with the canonical link set, so no manual cross-post. Medium limits AI-assisted writing. |
| **KafkaJS stance** | Facts only: 2.2.4 is pinned behind an internal adapter, two defects are contained there, and the adapter lets the client change without an API change. No plan or date unless you commit to one. | A certain HN comment, and a broken promise is worse than none. |
| **Brand accounts** | None | Developers follow people. |
| **Close "untested" gaps first** | Firefox and WebKit tests if the release work lands them by T-7 with no product changes; otherwise they become a starter issue. Managed Kafka: no (it needs an account); invite compatibility reports instead. | It answers the likely "Safari?" question for review time only. |
| **npm trusted publishing** | After launch | Don't change the release pipeline right before launch. |

## Phase 1: before launch

About 2.5–3 hours of your time. Everything below is prepared in advance.

### This repository (you approve; it's then made on a branch)

- [ ] **README first screen** (20 min review). The change will:
  - lead with the one-liner and "for Node.js and TypeScript teams that already run Kafka," with the mission line moved below;
  - switch the badge to `streamotter`;
  - rename "Try it in five minutes" to "Try it without Kafka" (no time promise until a walkthrough is timed);
  - add a fit-and-limits line and a "Watch → Custom → Releases" line;
  - add a "Try the live demo" link at launch;
  - optionally, a silent GIF labeled as a recording: live → stale → live.
- [ ] **`docs/guides/when-to-use.md`** (15 min): a fit checklist, where it's the wrong choice, and "choose X when…" for the DIY bridge, polling or SSE, Centrifugo, Zilla, Ably, and Lightstreamer, each with a source and date. It replaces any alternatives or "vs X" pages.
- [ ] **Community files** (15 min): `CODE_OF_CONDUCT.md`; `SUPPORT.md` (solo maintainer, where to ask, response aims, what's verified, pre-1.0 policy, the KafkaJS note); issue forms (bug, compatibility report, docs; blank issues off); a PR template; a response time in `SECURITY.md`.
- [ ] **Three starter issues** (10 min): Firefox and WebKit tests (unless done), a Vue 3 recipe, and the Docker Compose file ([community brief §3](briefs/community.md)). Keep no more than three open.
- [ ] **Package metadata** with `0.1.0`: descriptions and package README taglines use the positioning one-liner; keywords; `homepage` set to streamotter.app at launch; site links ([product marketing brief §5](briefs/product-marketing.md); release work). The workbench favicon (PR #2, CHANGELOG Unreleased) ships in the same release.
- [ ] **Keep `README.md` and `IMPLEMENTATION_STATUS.md` accurate** for whatever ships.
- [ ] **GitHub settings** (you, 15 min, or `gh repo edit`):
  - the description and topics from the product marketing brief §5;
  - a social preview: a 1280×640 PNG is made and you upload it on the web. It follows the site's link card (`lontra-creek/apps/site/public/social-preview.png`): the stacked lockup's `-dark` version on the navy creek gradient (`#0a3d86` → `#04173a` → `#020a1c`), Figtree 800 text, `npm install streamotter` in JetBrains Mono, no version number, with the positioning one-liner as its text;
  - Discussions on, wiki off;
  - at launch, the homepage set to streamotter.app.
- [ ] **Not blocking:** a `how-it-works.md` concepts page, plus React and existing-sessions recipes (months 1–3).

### Your accounts

- [ ] **Medium** (15 min): the typo, the placeholder, the AI-assistance sentence, and the header image. The image is ready: 2000×1125, the detailed logo centered on white (kept locally, not in this repo).
- [ ] **GitHub profile** (5 min): add a bio and pin StreamOtter.
- [ ] **KafkaSocks** (15 min): contact the KafkaSocks co-authors before launch (notes kept privately; plan in [community brief §5](briefs/community.md)). After they agree, merge the drafted banner change.
- [ ] **HN and Reddit** (10 min):
  - use your existing HN account;
  - check your Reddit account's age and karma;
  - read the r/apachekafka and r/node sidebars (Reddit couldn't be loaded during research).
- [ ] **Changelog News** needs a changelog.com sign-in; create one, or skip it.

### Hand-offs to the site project (Lontra Creek)

1. **A distinct "the demo is full" state** for `OVERLOADED` ("reached its connection limit"), apart from today's "may be restarting or down". It shows the labeled recording and the local run.
2. **A spike rehearsal on staging:**
   - over-limit visitors see "full";
   - with all three benches leased, the page shows the queue, the wait, and the local run;
   - with the demo host stopped, the static pages still serve.
3. **Matching claims:** the hero headline is the short line ("Live state from Kafka to the browser. Never silently wrong.") and the positioning one-liner is its descriptive sentence; `/releases` uses the same version and limits as this plan.
4. **Social cards** checked on key pages.
5. **Optional:** Cloudflare Web Analytics (free, cookieless); Search Console and Bing verified by DNS (you, 10 min at launch).
6. **After launch:** `/blog` with RSS.
7. **The per-IP API budget**, checked for visitors behind a shared office network.

## Phase 2: launch week

The full runbook is in [launch-comms brief §3](briefs/launch-comms.md).

| When | You | Prep work |
| --- | --- | --- |
| T-7 | Lock the date and version. Publish `0.1.0` if chosen (30–60 min). | Fills placeholders, link-checks, captures screenshots, verifies the registry install |
| T-5 | 20 min: review the drafts | — |
| T-3 | **45 min: write your first comment yourself** from the [talking points](drafts/show-hn.md); skim the [hard questions](drafts/hn-faq.md) | Site soft launch, unannounced |
| T-1 evening | 10 min: go/no-go | Reports each criterion |
| **T-0** | 8:00 ET: submit (title and GitHub URL, text empty), then comment within a minute. Reply until about 11:30. LinkedIn at noon (link GitHub or the site, never HN). Check in in the afternoon and evening. | Checks links, install, and demo health at 7:30. At day's end, logs draft issues, doc fixes, and FAQ entries. |
| T+1 | 45 min: a morning HN pass, then the [newsletters](drafts/newsletter-blurb.md) | Submissions ready to paste |
| T+2 or T+3 | 45 min: [r/apachekafka](drafts/reddit.md), in your own words | — |
| Week 2 | 1.5 h: r/node, thank-yous, launch issues | Drafts issues and doc fixes |
| Week 3 | Optional: one more subreddit; decide on a "what I learned" post | — |

**Go/no-go** (all must be true at T-1 and 30 minutes before submitting):
1. The site, walkthrough, and Failure Lab pass their launch checks, and the "full" state and Lab queue worked in rehearsal.
2. Every public link returns 200, and no placeholder is visible anywhere.
3. The registry install test passes, and the four commands work in a clean folder.
4. The README, `IMPLEMENTATION_STATUS.md`, `/releases`, and the drafts name the same version and limits.
5. Medium is fixed, CI is green, and no open bug contradicts a claim.
6. You wrote the comment yourself, and you're free for 3–4 hours plus the next morning.

If any fails, move the day. On launch day, never share the HN link (including on LinkedIn or with friends), ask for votes, repost, or change the URL.

## Phase 3: steady state

**Weekly (60–75 min; prepared in advance):**

| Prepared | You do |
| --- | --- |
| A digest of issues, discussions, and PRs, with suggested replies | 20 min: edit, send, label |
| A metrics snapshot into a local, untracked `docs/promotion/metrics.csv` | 2 min: glance |
| A LinkedIn post every other week | 10 min: edit and post |
| A star-threshold check, with the listing line ready | 10 min: at most one submission |
| A new starter issue when fewer than three are open; release notes | 10 min: review |
| Optional: one fitting Stack Overflow thread, with doc links | 20 min: write the answer yourself and disclose authorship |

**Monthly: one article.** About 2 hours that week, replacing the optional items. It's drafted with code checked against the pinned version and claims checked against `IMPLEMENTATION_STATUS.md`. You add a few sentences of your own experience and review it. After publishing: one LinkedIn post and one community post. The first three:
1. **"A reconnect isn't a recovery: keeping live views correct after a WebSocket drops"**, an explainer. A "what I learned" post, if you write one, takes this slot.
2. **"Stream Kafka to a React page without lying to your users"**, a tutorial on the published package.
3. **"The snapshot/update race: why 'fetch, then subscribe' loses updates"**, a deep dive.

The rest of the queue is in [content brief §3](briefs/content-seo.md).

**Listings** (you open the PR; one a week at most):

| When | Where |
| --- | --- |
| The demo is live (T+7 onward) | infoslack, dharmeshkakadia, and monksy awesome-kafka lists (no stated criteria) |
| 30 stars | facundofarias/awesome-websockets |
| 50 stars | conduktor/awesome-kafka |
| 100 stars, repo older than 30 days | sindresorhus/awesome-nodejs |
| 10 contributors | goodfirstissue.dev |

## Metrics

All free and private. Never quote any of these publicly as adoption.

| Signal | Source | Goal (not a forecast) |
| --- | --- | --- |
| **People you don't know who say they run it** (issues, Show and tell, dependents) | GitHub | 3 by day 90 |
| First issue naming a real broker or managed service | GitHub | By day 60 |
| Stars (visibility only) | `gh api` | 25 by day 30, 75 by day 90 |
| Weekly downloads of `streamotter` and `@streamotter/client`, weeks without a release only | api.npmjs.org | A rising 4-week trend by day 90 |
| Visitors, referrers, popular paths | GitHub traffic (kept 14 days; snapshot weekly) | Getting started in popular paths weekly |
| Newsletter pickups | Your inbox | At least 1 of 4 |

**Baseline:** 0 stars. The 108 `streamotter` and 351 `@streamotter/client` downloads on September 25 were your own install tests and mirrors. Start snapshots before launch.

## What we're deliberately not doing

- **Product Hunt** (founder audience, all-day comments), **Lobsters** (invite-only), **r/programming** (bans demos), **r/selfhosted**, and **r/reactjs** unless you already take part there.
- **Discord, Slack, or brand accounts:** presence you can't sustain, and a split following.
- **Video, talks, paid promotion, star trading, or cold outreach** (including DMs to KafkaSocks stargazers).
- **A second Show HN for `0.1.0`**, since version bumps don't qualify.
- **"vs X" pages or listicles.** Comparisons stay on the one sourced when-to-use page.
- **Hacktoberfest tagging, the OpenSSF badge before late December, and account-gated managed-Kafka tests.**
- **A weekly Stack Overflow cadence**, because answers can't be AI-drafted.
- **Optional if you have time:** r/typescript, r/javascript, r/webdev Showoff Saturday (drafts ready); the social thread where you already have an account; Hashnode, Echo JS, DevHunt, a Confluent forum post; Up For Grabs; a KafkaJS #1751 comment; Failure Lab mini-posts.

## Guardrails

- **Disclosure.** Always say you built it, in the first person. Be plain about Claude Code when asked, and in the Show HN comment.
- **Hacker News.** Under "In Comments," the guidelines say: "Don't post generated text or AI-edited text. HN is for conversation between humans." Everything you post there is yours. AI is used for research but never writes or edits HN text, which is why the HN drafts are talking points. Show HN also asks for non-trivial work (not quickly generated one-offs) and an explanation of how and why. Never solicit votes or comments.
- **Stack Overflow** bans content drafted with generative AI tools, including rewording. Write any answer yourself, and start the StreamOtter part with "Disclosure: I made StreamOtter."
- **Reddit.** Rewrite each draft in your own words, because many subreddits reject AI-written posts. Read the sidebar, post as text, one subreddit at a time, and never reuse text.
- **Articles.** Label AI assistance: Medium asks for it, and dev.to has an "AI-assisted" tier.
- **Claims.** Everything matches `IMPLEMENTATION_STATUS.md` for the named version:
  - no adoption, performance, or capacity numbers;
  - timings say where they were measured, and the load test is always "a single-process loopback measurement, not a capacity claim";
  - nothing shown as shipped before it is (site, demo, `0.1.0`, blog, V2);
  - the limits sentence in long-form pieces;
  - no competitor disparagement;
  - never `@next`, "Kafka in the browser," "scalable," "production-proven," "exactly-once," or "in 5 minutes";
  - fiction and recordings are labeled.

## Brand kit

The brand files are final (StreamOtter PRs #1 and #2, both merged). [`docs/assets/README.md`](../assets/README.md) is the usage guide: which logo goes where, minimum sizes, clear space, and colors. In short:
- **The detailed swimming-otter logo** goes where there's room for an illustration: the README, npm pages, Medium, and title slides. Keep it at least 240 px wide.
- **The flat brandmark** and its lockups go wherever the logo is small or repeated: headers, favicons, avatars, social cards, and slide corners.
- Don't recolor, redraw, stretch, or crop any of them, and don't set "StreamOtter" in a font in place of the wordmark.

## Files

| Topic | File |
| --- | --- |
| Plan (this file) | The reconciled decisions, draft edits, and corrections |
| Product marketing brief | [briefs/product-marketing.md](briefs/product-marketing.md): segments, positioning, alternatives, objections, metadata |
| Community brief | [briefs/community.md](briefs/community.md): home base, trust, starter issues, KafkaSocks, listings |
| Content and SEO brief | [briefs/content-seo.md](briefs/content-seo.md): search intent, docs, content plan, site SEO |
| Launch communications brief | [briefs/launch-comms.md](briefs/launch-comms.md): timing, channels, runbook, newsletters |

**Drafts** (updated to this plan):
- [show-hn.md](drafts/show-hn.md): talking points, not paste-ready, by design
- [hn-faq.md](drafts/hn-faq.md)
- [reddit.md](drafts/reddit.md)
- [linkedin.md](drafts/linkedin.md)
- [social-thread.md](drafts/social-thread.md)
- [newsletter-blurb.md](drafts/newsletter-blurb.md)
- [press-kit.md](drafts/press-kit.md)

**Corrections made to the briefs (marked in place):**
- Community: Stack Overflow answers can't be AI-drafted, because the site forbids it. KafkaSocks #49 dates from December 2021, not 2022.
- Launch comms: added Show HN's rule on quickly generated projects and Changelog News' sign-in requirement.
- Product marketing and content: the Medium fix now includes the AI-assistance note.
