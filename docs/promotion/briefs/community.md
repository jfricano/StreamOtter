# Community brief: home base, trust, contributors, and presence

September 27, 2026 · Research brief for the promotion plan · Research only: nothing was posted, opened, or changed

> **Note (September 27):** the decisions in [PLAN.md](../PLAN.md) supersede this brief's recommendations where they differ. Corrections are marked **[Correction]** in place.

Facts were checked on 2026-09-27 with read-only `gh`, public APIs, and web fetches, and each carries its source. **Unverified** marks what I couldn't check. Reddit's pages couldn't be checked.

## The short version

- **The best first hour is KafkaSocks.** The owner co-wrote it, has admin rights on `oslabs-beta/Kafkasocks` (113 stars), and is an npm maintainer of `kafka-socks`. A successor note agreed with the co-authors reaches the exact audience.
- **GitHub is the home base; no Discord or Slack.** The kit (Discussions, issue forms, code of conduct, `SUPPORT.md`, a roadmap issue) is drafted in advance, and the owner reviews it in about 45 minutes.
- **Stack Overflow is an archive, not a live venue.** Old threads have thousands of views, while new questions are near zero. One disclosed answer a week, only where StreamOtter fits.
- **Earn listings**: maintained lists set star floors of 30, 50, and 100.

## Ranked recommendations (impact per owner-hour)

| # | What | Why | Owner time | Prepared in advance | Timing |
| --- | --- | --- | --- | --- | --- |
| 1 | KafkaSocks successor pointer (§5) | Predecessor's audience; the owner has standing | 30 min, then replies | Note, README banner, migration guide | Before launch |
| 2 | GitHub home-base kit (§1) | Every channel lands here | 45 min review, 5 min settings | All files and seed posts | Before launch |
| 3 | Support and maturity statement (§2) | First thing a team lead checks | 15 min | `SUPPORT.md`, dependency note | Before launch |
| 4 | Five starter issues (§3) | GitHub surfaces labeled issues to newcomers | 20 min, then reviews | Issue bodies | Launch week |
| 5 | Evergreen answers (§4) | High-view threads rank in search and answer engines | 15 min/week | ~~Tailored drafts~~ Thread picks and doc links only; the owner writes the answer. **[Correction]** Stack Overflow's help center bans content drafted with generative AI tools, including rewording ([gen-ai-policy](https://stackoverflow.com/help/gen-ai-policy), checked 2026-09-27). PLAN.md makes this optional, not weekly. | Launch week, then weekly |
| 6 | LinkedIn, GitHub profile, dev.to (§6) | Warm network; team leads read LinkedIn | 10 min/week | Posts, profile README | Launch week, then weekly |
| 7 | Trusted publishing with provenance (§2) | Supply-chain signal on npm | 20 min in npm settings | Workflow (release work) | Before `0.1.0` |
| 8 | Listings as criteria are met (§7) | Durable discovery | 10 min each | Entry line and PR text | Ongoing |

## 1. Home base

**Current state** (`gh`): Discussions off, wiki on, homepage set to the npm org page, 0 stars. GitHub's community profile is at 71%, missing a code of conduct, issue templates, and a PR template ([community profile API](https://api.github.com/repos/jfricano/StreamOtter/community/profile)). The `good first issue`, `help wanted`, and `accessibility` labels already exist. All three releases are pre-releases.

**Recommendation: GitHub Issues, Discussions, and Releases. No Discord or Slack.** A chat server is a promise of presence. At 1–2 hours a week, questions would sit unanswered in public, which is worse than having no server, and a chat answer helps one person once. A Discussions Q&A answer is indexed, keeps working for the next visitor, and arrives in the GitHub notifications the owner already watches. Its "Show and tell" category is the honest route to "used by" evidence. Revisit chat only if a second maintainer joins or Discussions outgrows the weekly hour.

**The kit** (drafted in advance; the owner commits and changes settings):

- **Discussions:** Q&A, Ideas, Show and tell, and Announcements for release notes. One seed post: "What are you building with live data?"
- **Pinned issue "Roadmap: what's next":** the roadmap's V1.x items (KafkaSocks migration guide, configuration polish, fixtures, compatibility fixes) and the V2 direction, labeled as plans. Readers 👍 what they need.
- **Issue forms:** bug (versions, Node, Kafka, browser, the delivery state the view showed), compatibility report (§3), and docs. `config.yml` turns blank issues off and links to Q&A and the private advisory form ([GitHub docs](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)).
- **A PR template** mirroring CONTRIBUTING, and **`SUPPORT.md`**, which GitHub links from the new-issue page ([docs](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-support-resources-to-your-project)).
- **Releases as the following mechanism:** one README line, "Watch → Custom → Releases to hear about new versions" ([docs](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/managing-subscriptions-for-activity-on-github/viewing-your-subscriptions)). Mark `0.1.0` as the latest release.
- **Settings (owner):** turn off the empty wiki, set the homepage to `streamotter.app` once it is live, and consider adding the `apache-kafka` topic.

## 2. Adoption trust signals

| Signal | Verdict | Notes |
| --- | --- | --- |
| Support and maturity statement | **Yes, first** | `SUPPORT.md`: one maintainer (Jason Fricano, Orca Solutions), where to ask, response times, what "supported" means (Node 24+, Kafka verified against 4.1.2, Chromium-only automated tests), the pre-1.0 SemVer policy, and the security path. |
| Response-time expectations | **Yes** | The owner picks numbers they can keep. Suggested: issues and discussions answered within 7 days; security reports acknowledged within 3 business days (`SECURITY.md` gives no time today). |
| Dependency status | **Yes** | KafkaJS's last release, 2.2.4, is from 2023-02-27. Its "KafkaJS status" issue has 20 comments ([#1753](https://github.com/tulios/kafkajs/issues/1753)), and [conduktor/awesome-kafka](https://github.com/conduktor/awesome-kafka) marks it "not actively maintained". Evaluators will notice. A short note turns this into evidence of care: the pinned version, the internal adapter, the contained defects already documented, and a client change as a roadmap question. Wording goes to Product Marketing. |
| Code of conduct | **Adopt Contributor Covenant 3.0** ([site](https://www.contributor-covenant.org/)) | This resolves the release plan's open decision. It takes 10 minutes, completes the community profile, and tells newcomers they're welcome. For the contact, use a forwarding alias such as `conduct@streamotter.app` rather than a personal inbox; Cloudflare Email Routing is free on all plans ([docs](https://developers.cloudflare.com/email-routing/)). |
| Trusted publishing and provenance | **Yes, before `0.1.0`** (release work) | OIDC publishing from GitHub Actions attaches provenance automatically for public repositories. It needs npm 11.5.1+ and Node 22.14+, and npm then recommends disallowing tokens ([npm docs](https://docs.npmjs.com/trusted-publishers)). The owner configures each of the six packages. pnpm's OIDC handling was still disputed in January 2026 ([pnpm#9812](https://github.com/pnpm/pnpm/issues/9812)), so test it. |
| OpenSSF Scorecard badge | **Not yet** | "Maintained" passes only for repositories more than 90 days old, and Code-Review and Contributors are "infeasible" for a single maintainer ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)). Reconsider after 2026-12-24, and publish only a score that helps. |
| Roadmap and examples | Yes / already strong | The pinned issue; the order dashboard; Lontra Creek, labeled as the project's own demo and never as a user. |
| "Used by" | Earn it | Show-and-tell posts; GitHub's dependency graph, which lists public dependents automatically; adopters named only with written permission. Downloads are not users, since CI and mirrors inflate them. |

## 3. Contributor funnel

Keep at most five starter issues open, since each costs review time. Each body names the files, acceptance criteria, test tier, and "comment to claim". They're drafted in advance; the owner opens them.

| Title | Scope | Label |
| --- | --- | --- |
| Run the browser tests in Firefox and WebKit | Extend `scripts/browser/setup.sh` and `tests/browser/browser.ts` to all three Playwright engines, run them in `extended.yml`, and record the results. | help wanted |
| Exercise the nginx recipe | `DEPLOYMENT.md` marks nginx "not exercised"; add an nginx variant of the Caddy check in `tests/deploy`. | help wanted |
| Run the Kafka suite against 4.2.1 and 4.3.1 | Current releases are 4.1.2, 4.2.1, and 4.3.1 ([downloads.apache.org](https://downloads.apache.org/kafka/)). Make the version in `scripts/kafka` selectable and report results per version. | help wanted |
| Recipe: Vue 3 composable | A `docs/guides` page mirroring the React pattern: subscribe, render `live`/`stale`, clean up. Documentation, not a package. | good first issue |
| Recipe: Svelte store | The same for Svelte; Angular can follow. | good first issue |
| Workbench accessibility check | Add axe to `tests/browser/workbench.test.ts` and fix what it finds (a new dev dependency, so discuss first). | good first issue, accessibility |
| Exercise the Kafka Docker Compose file | The implementation status calls `scripts/kafka/docker-compose.yml` unexercised. Run the suite against it and document it. | good first issue |
| Compatibility report: managed Kafka or Redpanda | A reusable issue form: run getting-started and the staged diagnostics against a service the contributor already uses. Results go into the matrix as "community-reported", which also covers the unverified `tls: {}` path. | help wanted |

[Up For Grabs](https://github.com/up-for-grabs/up-for-grabs.net/blob/gh-pages/docs/list-a-project.md) has no star minimum and merged projects on 2026-09-21. Submit once three labeled issues are open. [goodfirstissue.dev](https://github.com/deepsourcelabs/good-first-issue) needs at least 10 contributors, so it comes later.

## 4. Being present where developers already ask

| Venue | State on 2026-09-27 | Verdict |
| --- | --- | --- |
| Stack Overflow | Tag totals: `apache-kafka` 33,198, `websocket` 28,130, `socket.io` 20,510, `kafkajs` 213. New questions in 90 days: 4, 6, 4, and 0 ([API](https://api.stackexchange.com/2.3/tags/apache-kafka/info?site=stackoverflow)). The rules require disclosing affiliation and actually answering ([help/promotion](https://stackoverflow.com/help/promotion); not fetchable, so re-read it before posting). | Evergreen threads only |
| Confluent forum | Light: about a dozen topics June–September ([latest.json](https://forum.confluent.io/latest.json)). An August tool post got 526 views and no replies. The tools category says "Technical content only—No selling!" | One technical post once the demo is live |
| Confluent Slack | "At full capacity" ([LaunchPass](https://www.launchpass.com/confluentcommunity)) | Skip |
| Kafka users@ list | 28 threads in three months, mostly operations ([archive](https://lists.apache.org/list.html?users@kafka.apache.org)) | Skip |
| KafkaJS GitHub | Discussions off; last push August 2024 | Don't pitch there |
| Socket.IO Discussions | Active (latest post 2026-09-24, and a maintainer replies); mostly chat questions | Kafka-state questions only |
| r/apachekafka | **Unverified**: Reddit couldn't be checked | The owner reads the sidebar rules first |

**Threads where a disclosed answer fits** (all open; view counts from the API):

1. [Receiving Kafka event on web browser real time](https://stackoverflow.com/questions/40253531) (23,680 views)
2. [Sending Apache Kafka data on web page](https://stackoverflow.com/questions/51696762) (an Express sensor dashboard, 5,755 views)
3. [Integrating a frontend with Kafka in an event-driven architecture](https://stackoverflow.com/questions/60241077) (3,391 views; snapshot plus updates, with commands through the app's API)
4. [Socket.IO client in Angular not receiving all messages from a Kafka consumer](https://stackoverflow.com/questions/74148686) (unanswered). Explain at-most-once delivery and backpressure first, then say plainly that StreamOtter sends the latest full state, not every event.
5. [React GUI on Kafka](https://stackoverflow.com/questions/58067734) (compute the view on the server and push full state)
6. [React micro-frontends with Kafka pub/sub](https://stackoverflow.com/questions/78344118) (2024, unanswered; subscribing fits, publishing belongs in the app's API)
7. [Subscribers when the Kafka service is down](https://stackoverflow.com/questions/69160202) (explicit `stale` and resync; StreamOtter uses Socket.IO, not SSE)
8. [Socket.IO #3836](https://github.com/socketio/socket.io/discussions/3836) (a browser choosing the consumer's topic; parameterized channels with `authorize` fit)

**Don't mention StreamOtter** in [load-balanced routing](https://stackoverflow.com/questions/58385826) (V1 is one gateway), [KafkaJS chat](https://stackoverflow.com/questions/66337792) (chat is out of scope), or [Socket.IO #5423](https://github.com/socketio/socket.io/discussions/5423) (replay; V1 has none).

**Answer pattern** (**[Correction]** on Stack Overflow the owner writes the whole answer; its policy forbids drafting with generative AI): solve the problem first in terms that help even without StreamOtter. Then add one paragraph beginning "Disclosure: I made StreamOtter…" that names its main limit. Never reuse text, and post at most one answer a week.

## 5. Lineage and warm networks

**Facts** (`gh`, `npm`): KafkaSocks has 113 stars and 14 forks, and its last push was 2022-01-05. An install issue has been open since December 2021 ([#49](https://github.com/oslabs-beta/Kafkasocks/issues/49); **[Correction]** it was opened 2021-12-13, not in 2022). The owner has **admin** permission on the repository. `kafka-socks` 0.1.10 is maintained on npm by jfricano and two of the co-authors, and had 34 downloads in the last month. OSLabs' site didn't load, but its `oslabs-beta` organization created repositories as recently as July 2026. Whether it runs alumni channels is **unverified**.

**Plan:**

1. Contact the KafkaSocks co-authors and the kafka-penguin team before launch (notes kept privately).
2. If the co-authors agree to a "Successor project" banner on the KafkaSocks README, the owner adds it and closes #49 with a courteous pointer. The owner also lets OSLabs know as a courtesy.
3. The KafkaSocks migration guide gets drafted (a V1.x roadmap item) so the banner lands somewhere useful.

Never message the KafkaSocks stargazers; the banner reaches them respectfully.

## 6. The owner's personal channels

| Channel | Verdict and cadence |
| --- | --- |
| GitHub profile | **Once, 5 min.** It has 22 followers and no bio: add a bio, pin StreamOtter, and a short profile README, drafted in advance. |
| LinkedIn | **Primary.** A launch post, then one every two weeks: a release, a lesson from a failure mode, the demo. |
| dev.to | **Per article.** Cross-post with `canonical_url` ([DEV](https://dev.to/ben/comment/93p9)); hand off to the content and SEO brief. |
| Bluesky / X | Optional; reuse the LinkedIn post. |
| Mastodon | Skip unless the owner already has an account. Fosstodon is invite-only and bans link-only posts and repetitive self-promotion; Hachyderm requires approval ([fosstodon](https://fosstodon.org/api/v2/instance), [hachyderm](https://hachyderm.io/api/v2/instance)). |

**Brand account: not now.** It would split a following that doesn't exist yet and double the posting, and developers follow people. The repository (Watch → Releases) and npm already serve as the brand's channels. Reconsider when there is a second maintainer or a steady release rhythm.

## 7. Ecosystem listings

| List | Maintained? | Criteria | Submit |
| --- | --- | --- | --- |
| [conduktor/awesome-kafka](https://github.com/conduktor/awesome-kafka) | Yes (September 2026) | 50+ stars or significant industry use; factual wording | At 50 stars ("Proxies & Gateways") |
| [infoslack/awesome-kafka](https://github.com/infoslack/awesome-kafka) (593★) | Yes (May 2026) | None stated | Once the demo is live ("Tools") |
| [dharmeshkakadia/awesome-kafka](https://github.com/dharmeshkakadia/awesome-kafka) (209★) | Yes (2026-09-26) | None stated | Once the demo is live |
| [monksy/awesome-kafka](https://github.com/monksy/awesome-kafka) (216★) | Yes (May 2026) | None stated | Once the demo is live |
| [facundofarias/awesome-websockets](https://github.com/facundofarias/awesome-websockets) (1,859★) | Yes (August 2026) | About 30+ stars, documented, author discloses | At 30 stars |
| [sindresorhus/awesome-nodejs](https://github.com/sindresorhus/awesome-nodejs) | Slow (January 2026) | More than 30 days old **and** 100+ stars | At 100 stars; low odds |
| awesome-typescript / awesome-realtime | dzharii's list is archived; semlinker's has 57 open PRs; no maintained realtime list found | — | Skip |
| [Kafka wiki: Ecosystem](https://cwiki.apache.org/confluence/display/KAFKA/Ecosystem) | Last edited May 2022 | ASF wiki account needed | Optional |

Submit one list a week, with a factual one-line description and disclosure.

## 8. Weekly routine (~1 hour)

| Prepared in advance | Owner does |
| --- | --- |
| Digest of new issues, discussions, and PRs, with draft replies | 15 min: send replies, label |
| New matches from Stack Overflow, the Confluent forum, and Socket.IO, plus the next thread from §4, with the relevant doc links (**[Correction]** no drafted answer for Stack Overflow, whose policy bans AI-drafted content) | 15 min: write and post at most one answer yourself |
| One LinkedIn post from the week's work | 10 min: edit and post |
| Star counts checked against §7, with entries ready when criteria are met | 10 min: at most one submission |
| Release notes from the changelog, and a new starter issue when fewer than five are open | 10 min: review and merge |

Nothing is posted on the owner's behalf, and Reddit couldn't be read during research. Metrics stay private and never become public claims.

## 9. What to avoid, hand-offs, and open questions

**Avoid:**

- chat servers;
- bulk or cold outreach;
- automated starring or star trading, which GitHub bans as "rank abuse" ([Acceptable Use](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies));
- reusing an answer across threads, or answering where V1 doesn't fit (multi-node, chat, replay, every-event delivery);
- pitching in KafkaJS maintenance threads;
- submitting to lists before their criteria are met;
- opening more starter issues than the owner can review;
- the `hacktoberfest` topic, which invites more PRs than one maintainer can review (whether Hacktoberfest runs in October 2026 is unverified);
- quoting downloads as adoption.

**Hand-offs:**

- **Launch communications brief:** Hacker News and launch posts.
- **Product marketing brief:** the KafkaJS wording and "when not to use StreamOtter".
- **Content and SEO brief:** the dev.to cross-post and search visibility for guides and answers.
- **The Lontra Creek project:** the site's links to Discussions and Releases.

**Open questions:**

1. The §1–§2 kit should land before the public push. When is the push, and who approves it?
2. Which response times will the owner commit to (7 days and 3 business days are suggestions)?
3. Will the co-authors agree to a KafkaSocks banner? Should OSLabs be asked first?
4. Is the code of conduct's contact a domain alias or a personal address?
5. Is trusted publishing required for `0.1.0`?
6. Which voice should answers use? I recommend first person ("I made StreamOtter"), which is credible for a solo maintainer.
