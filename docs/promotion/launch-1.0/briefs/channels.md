# Channel map, October 2026 onward

2026-10-05 · Channel research · Refreshes and widens the Sept 27 research (`StreamOtter/docs/promotion/briefs/launch-comms.md` and `community.md`). Research only: nothing was posted, submitted, emailed or signed up for.

**How to read this.** Every fact names its source and the date I checked it. Everything was checked on **2026-10-05** unless a different date is given. **Unverified** means I could not confirm it from a primary source. Reddit, lobste.rs, HN's own HTML pages under load, gitnation.com CFP pages, opensourcelabs.io and changelog.com feeds couldn't be checked. Where that happened I say so and give the next-best source.

**Launch anchor used below.** FACTS.md: the official public launch is npm `1.0.0` (via `1.0.0-rc.1`), and no date is set yet. "T-0" means that launch day.

## Before anything else: what I found on the live surfaces

| What | Found (2026-10-05) | Why it matters for channels |
| --- | --- | --- |
| **streamotter.dev is publicly live** | The home page, Field station, Failure Lab (`/lab/`, 4 exercises: Fouled sensor, relay cut, slow client, gateway restart; bench "Not leased"), Playground, Workbench, When it breaks, Docs, Releases and GitHub all load. | The Sept plan's "launch when the site is live" trigger has already fired for V1. Any channel post would now land on a working demo. |
| **The site shows `v0.1.0-rc.3`** | Header: "v0.1.0-rc.3 · MIT". `/releases` lists only `0.1.0-rc.3`, "The API may change before 0.1.0". | npm `latest` is `0.2.0-rc.1` (FACTS.md). Every channel ends at a page whose version disagrees with npm. Fix this before any submission (hand-off for the site and its hosting setup). |
| `streamotter.dev/blog` | 404 | The canonical move below needs a blog page first. Since D2 (Jason, 2026-10-07), `/blog` with an RSS feed is a launch gate: the launch date waits for it. |
| **Medium article** ([link](https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81)) | Dated Sept 26, 2026. **It still contains "[DEMO URL, added at launch]".** I found **no AI-assistance sentence**. I could not detect the `zsession` typo (it may be fixed). No link to streamotter.dev. | Medium gives undisclosed AI-assisted writing "Network Only" distribution (see Medium below). This is the Sept plan's item #1, still open. |
| GitHub repo | 0 stars, homepage still points to the npm org page, last push 2026-10-05 (`gh api`). | Awesome lists that set star floors are still months away. |

## Ranked channel table

The ranking is impact per hour of Jason's time, for the core audience (TS/Node teams that already run Kafka, then platform engineers). The "When" column assumes a launch at `1.0.0` (or `1.0.0-rc.1` if that is declared the launch).

| # | Channel | Audience fit | Effort for Jason | Rules / gotchas | When | Source, checked |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Show HN** | High (infra-minded devs) | 45 min writing at T-3, then 3–4 h on the day plus the next morning | **New since Sept: Show HN has been restricted since March 2026.** An HN moderator wrote "We're going to at least restrict Show HNs for a while" (2026-03-08) and "we're restricting Show HNs for now" (2026-03-12). He declined to give criteria: "I don't want to say much specifically because it'll just end up as extra steps on some 'how to promote your project on HN' checklist". Users on new accounts report "Sorry, your account isn't able to submit this site" (2026-04-23). A June 3 thread is titled "We're temporarily restricting Show HNs because of an influx". The guidelines now cover **posts** as well as comments: "Please don't put generated text in HN posts. Write your text yourself" and "Don't post generated text or AI-edited text." Show HN: "non-trivial. Don't post quickly-generated one-offs"; version bumps don't qualify. | T-0. Before then, Jason should confirm his HN account is established. A mod suggested being "an active participant" in other threads (2026-03-09), and in his own words only. If unsure, email hn@ycombinator.com well before T-0. Not for `0.2.0-rc.1`; one shot at the 1.0 launch. | [showhn.html](https://news.ycombinator.com/showhn.html), [newsguidelines.html](https://news.ycombinator.com/newsguidelines.html), moderator posts [47300772](https://news.ycombinator.com/item?id=47300772) and [47346735](https://news.ycombinator.com/item?id=47346735) (read via the hn.algolia.com API), [47875235](https://news.ycombinator.com/item?id=47875235), [48391260](https://news.ycombinator.com/item?id=48391260); [Cybernews, Mar 12 2026](https://cybernews.com/ai-news/hacker-news-bans-ai-generated-and-edited-comments/). All checked 2026-10-05. |
| 2 | **Node Weekly + JavaScript Weekly** (Cooperpress) | High / medium | 10 min, one email | Editorial address editor@cooperpress.com. Each issue says "Got a link for us? Reply and tell us. We can't include everything but we'll look at anything you send." Both have a "Code & Tools" section. Node #642 (Sep 24) is the latest listed (no Oct 1 issue shown); JS #804 is Sep 29. | T+1 | [cooperpress.com/contact](https://cooperpress.com/contact/), [nodeweekly.com/issues](https://nodeweekly.com/issues), [javascriptweekly.com/issues](https://javascriptweekly.com/issues), 2026-10-05 |
| 3 | **Console.dev** | High (experienced devs; dev tools only) | 5 min email | Email hello@console.dev. Its "Betas and previews" section takes only releases that are "pre 1.0 and/or have an appropriate label in the version number e.g. 1.0.0-beta". **Timing gotcha:** `1.0.0-rc.1` qualifies for Betas, and plain `1.0.0` would have to clear the main-tools bar instead. Its criteria include "actively maintained" and "good documentation". "We do not do sponsored reviews." Latest issue Oct 1, 2026 (weekly, Thursdays). | At `1.0.0-rc.1` (or T+1 if the launch is on the rc) | [console.dev/selection-criteria](https://console.dev/selection-criteria), [console.dev](https://console.dev/), 2026-10-05 |
| 4 | **r/apachekafka** | Highest topical fit | 45 min, own words | **Rules unverified**: reddit.com couldn't be checked, and no tracker I found covers this subreddit. Reddit-wide: accounts that "contribute primarily with links to businesses they own" count as spam. Jason reads the sidebar first. | T+2/T+3 | Sept brief; Reddit not reachable 2026-10-05 |
| 5 | **r/node** | Medium–high | 45 min | Tracker: "No subreddit-specific rules were displayed on the public rules page" (verified by the tracker 2026-09-18). Treat it as tech discussion, not an ad board. | Week 2 | [Rankhog r/node](https://rankhog.com/subreddits/node) (fetched 2026-10-05) |
| 6 | **Confluent Community Forum** | High fit, low traffic | 30 min, one technical post | Tools category: "Commandline or graphical… here is where to ask your questions and discuss your favourite ones." Recent tool posts get ~500 views and 0 replies (e.g. "Kafma", Aug 4, 2026, 534 views). Etiquette: no cross-posting. | Week 1–2, after T-0 | [forum.confluent.io/latest](https://forum.confluent.io/latest), [/c/tools](https://forum.confluent.io/c/tools/), [etiquette](https://developer.confluent.io/community/ask-the-community/), 2026-10-05 |
| 7 | **Confluent community meetups** (talk) | High (Kafka practitioners) | 2–4 h to prepare a talk; 15 min to propose | Proposal form linked from the speaker guidelines. "First time speakers welcome!" "It's okay to mention commercial products, but only as a companion to something people can use or try for free"; vendor-neutral; "demonstrate it". MIT and the Failure Lab fit. **Remote talks: unverified** (the Meetup Pro page lists online events but showed none). | Months 1–3 after launch | [rules-of-engagement](https://developer.confluent.io/community/rules-of-engagement/), [community](https://developer.confluent.io/community/), [meetup.com/pro/confluent](https://www.meetup.com/pro/confluent) (250 groups), 2026-10-05 |
| 8 | **dev.to cross-post** | Medium (search long tail) | 20 min | Canonical URL supported. DEV added disclosure tiers on Aug 26, 2026 ("Hand Written", "AI-Assisted", "Fully Autonomous"); "Deception is not permitted". Its older AI guideline (Apr 2024) asks authors to disclose in the post. Use **AI-Assisted** if the text was AI-drafted. | Week 1, per article | [DEV AI disclosure, Aug 26 2026](https://dev.to/devteam/introducing-ai-disclosure-on-dev-tools-for-nuance-clarity-and-better-feeds-34mk), [DEV AI guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev), 2026-10-05 |
| 9 | **JSNation 2027 CFP** (Amsterdam, hybrid) | Medium–high (full-stack JS; 1,500 in person, 10,000+ remote) | 2–3 h for an abstract; a talk later | **CFP open; deadline "March 1, 2027"**. In person May 20, 2027 (Kromhouthal); remote day May 24. | Submit Dec 2026–Feb 2027 | [jsnation.com](https://jsnation.com/) 2026-10-05 (the gitnation.com CFP page couldn't be checked) |
| 10 | **Awesome-Kafka lists** (dharmeshkakadia, monksy, infoslack) | Low–medium, durable | 10 min per PR | No stated criteria. Last commits: dharmeshkakadia Sep 28, 2026; monksy Sep 28, 2026; infoslack May 5, 2026. None lists KafkaSocks or any Kafka-to-WebSocket bridge, so there is a gap to fill factually. Disclose authorship. | T+7 onward, one a week | GitHub repo and commit pages, 2026-10-05 |
| 11 | **Data Engineering Weekly** | Medium (data engineers; adjacent to our buyer) | 10 min PR | "open a pull request with the article title under the weekly folder"; vendor-neutral; "avoid overt product promotion"; picks a handful of 15+ weekly. Run by a single editor. Submit an **article** (e.g. the snapshot/update race), not the repo. Whether the PR repo is still the live route is **unverified** (GitHub API refused). | With the first technical article | [dataengineeringweekly.com/about](https://www.dataengineeringweekly.com/about), [GitHub repo](https://github.com/ananthdurai/dataengineeringweekly), 2026-10-05 |
| 12 | **Changelog News** | Medium, **status uncertain** | 5 min (needs sign-in, per Sept) | **Changed since Sept:** the editor who ran News left Changelog in March 2026 ("I shipped my final News episode"). The latest News episode I could confirm is "Bitwarden CLI compromised (News)", Apr 29, 2026 (Apple Podcasts). Interviews continue (Sep 3, 2026). The submit page still says "Submitting your own work is also encouraged"; no commercial products. | Optional, T+1, only if the submit page still works when Jason signs in | [the former editor's post, Mar 2026](https://jerodsanto.net/2026/03/so-long-changelog/), [Apple Podcasts](https://podcasts.apple.com/us/podcast/the-changelog-software-development-open-source/id341623264), [podcastrex](https://podcastrex.com/publishers/changelog-media/fresh), [changelog.com/news/submit](https://changelog.com/news/submit), 2026-10-05 |
| 13 | **facundofarias/awesome-websockets** | Medium (realtime devs) | 10 min PR | "at least 30 GitHub stars"; "actively maintained"; "if you are the author, please disclose it in the pull request." Last commit Aug 17, 2026. | At 30 stars | [CONTRIBUTING](https://github.com/facundofarias/awesome-websockets/blob/master/CONTRIBUTING.md), 2026-10-05 |
| 14 | **Kafka podcasts**: Confluent Developer podcast; Get Kafka-Nated | High fit, low odds | 15 min for a pitch; an hour to record | Confluent Developer (hosted by Confluent's developer-relations team): active, S2 Ep 27 on Apr 13, 2026; interviews "our community of software developers"; **no pitch route found**. Get Kafka-Nated: newsletter plus video podcast, latest Jul 23, 2026; contact route not reachable (robots). | Months 2–6, only after real users or a talk exists | [Buzzsprout ep 27](https://www.buzzsprout.com/186154/episodes/18996221-the-ai-impact-on-the-developer-future-with-joseph-morais-ep-27), [getkafkanated archive](https://getkafkanated.substack.com/archive), 2026-10-05 |
| 15 | **Dev podcasts**: SE Daily, devtools.fm | Medium | 15 min pitch | SE Daily: "suggest a topic for us to cover? Get in touch!", editor@softwareengineeringdaily.com; latest episode Oct 1, 2026. devtools.fm: #178 on Sep 27, 2026; no guest route on its site. | Months 2–6 | [SE Daily contact](https://softwareengineeringdaily.com/contact/), [podengine](https://www.podengine.ai/podcasts/software-engineering-daily), [devtools.fm](https://www.devtools.fm/), 2026-10-05 |
| 16 | **Medium publications** (ITNEXT, Towards Data Engineering) | Medium | 15 min per submission | ITNEXT: email submit@itnext.io; "If you are only doing a sales pitch… we are not going to publish it"; "Inform us if the story was submitted elsewhere." Data Engineer Things **bans AI-generated** writing (assistance OK) and previously published stories. Conflicts with moving the article's home (see Medium). | For article 2 or 3, not the announcement | Pages below, 2026-10-05 |
| 17 | conduktor/awesome-kafka | Medium, durable | 10 min | "50+ GitHub stars OR significant industry use"; "No promotional language"; updated Sep 24, 2026. Its "Proxies & Gateways" section lists Aklivity Zilla (Kafka as "HTTP/SSE/gRPC/MQTT/WebSocket"). | At 50 stars | [CONTRIBUTING](https://github.com/conduktor/awesome-kafka/blob/main/CONTRIBUTING.md), 2026-10-05 |
| 18 | r/typescript, r/javascript, r/webdev | Medium / fair / low | 45 min each | r/javascript (tracker verified 2026-09-18): self-promotion OK if it is not "a majority of your contributions"; "Where's the Javascript?"; no paid-product ads. **r/webdev (tracker verified 2026-09-29): projects only on Showoff Saturday, and "LLM generated posts or comments" are removed.** r/typescript: **unverified**. | Weeks 2–4, optional | [Rankhog r/javascript](https://rankhog.com/subreddits/javascript), [r/webdev](https://rankhog.com/subreddits/webdev), 2026-10-05 |
| 19 | Hashnode | Low | 20 min | Canonical supported ("Are you republishing?" → "Add Original URL"). **New since Sept** (per a third-party report): since June 2026 the API, webhooks, bulk import and custom domains need Pro ($5/mo); manual posting stays free. | Optional | [Hashnode docs](https://docs.hashnode.com/help-center/hashnode-editor/how-to-set-a-canonical-link), [DEV report, Jul 8 2026](https://dev.to/thefreetier/hashnodes-free-blog-platform-quietly-paywalled-its-entire-api-4f92), 2026-10-05 |
| 20 | sindresorhus/awesome-nodejs | Low odds | 10 min | "more than 30 days old and the repo should have at least 100 stars". **Not accepted: "Boilerplates, SDKs, or SaaS deploy tools."** A gateway plus browser SDK may be read as an SDK. | At 100 stars; low odds | [contributing.md](https://github.com/sindresorhus/awesome-nodejs/blob/main/contributing.md), 2026-10-05 |
| — | **Skip:** TLDR, Bytes, Product Hunt, Lobsters, Kafka users@ list, Confluent Slack, Echo JS, Frontend Focus, Syntax, PodRocket | — | — | See the group sections. | — | — |

## Hacker News

- **The AI rule now covers posts.** Under "In Submissions": "Please don't put generated text in HN posts. Write your text yourself—HN is for sharing between humans." Under "In Comments": "Don't post generated text or AI-edited text. HN is for conversation between humans." ([guidelines](https://news.ycombinator.com/newsguidelines.html), 2026-10-05). The comment rule was formalized around Mar 9–12, 2026 ([Cybernews](https://cybernews.com/ai-news/hacker-news-bans-ai-generated-and-edited-comments/)). The Sept plan already makes the HN text Jason's own. Keep the submission text field empty, and keep the title in Jason's own words.
- **Show HN is throttled.** See row 1. The moderators will not publish the criteria, so this brief cannot say what qualifies. What I can say:
  - users with week-old accounts got "Sorry, your account isn't able to submit this site";
  - a moderator (2026-03-09) advised to "Be an active participant. Engage in other discussions threads with curiosity and generosity", and said anyone can email the mods, though volume is high.

  Action for Jason: check that his HN account is not new or idle. If it is thin, take genuine part in HN for a few weeks first, in his own words. Ask hn@ycombinator.com ahead of launch if unsure.
- **Context: Show HN is flooded with AI-built projects.** A front-page post from Apr 22, 2026 says submissions "tripled and now mostly have the same vibe-coded look" ([HN 47864393](https://news.ycombinator.com/item?id=47864393)). One commenter there gave this signal: "whether the thing is actively and continually developed for more than a few weeks". That is a comment, not a rule. The repo was created 2026-09-25. A launch after several weeks of visible, steady commits (V1.1, V1.2, the 1.0 gate work) plus the plain Claude Code disclosure is the honest defence against the "quickly-generated one-off" reading.
- Show HN rules otherwise unchanged ([showhn.html](https://news.ycombinator.com/showhn.html), 2026-10-05): something people can try, "ideally without barriers such as signups"; "New features and upgrades ('Foo 1.3.1 is out') generally aren't substantive enough"; "Please don't ask friends to upvote or comment." **One Show HN, at 1.0. Not now on `0.2.0-rc.1`.**

## Reddit

reddit.com couldn't be checked. Tracker-reported rules are in rows 5 and 18. **r/apachekafka and r/typescript remain unverified.** Jason reads both sidebars before posting. New since Sept: the r/webdev tracker (Sep 29, 2026) lists "LLM generated posts or comments" as removable. This reinforces the plan's rule that every Reddit post is rewritten in Jason's words.

## Lobsters, Product Hunt, dev.to, Hashnode

- **Lobsters:** not re-verified; lobste.rs/about couldn't be checked. The Sept 27 reading stands: invite-only, no `show` tag for new users for 70 days, self-promo under a quarter of activity. Skip. If someone else posts StreamOtter there, Jason can ask for an invite as the author.
- **Product Hunt:** the featuring guidelines (updated Mar 10, 2026) judge "Useful", "Novel", "High Craft", "Creative"; they don't name dev libraries as a category ([PH help](https://help.producthunt.com/en/articles/9883485-product-hunt-featuring-guidelines)). The audience and the all-day comment load are unchanged. **Skip**, as in Sept.
- **dev.to:** see row 8.
- **Hashnode:** see row 19.

## Newsletters

| Newsletter | Status (2026-10-05) | Route | Verdict |
| --- | --- | --- | --- |
| Node Weekly, JavaScript Weekly | Active (Node #642 Sep 24; JS #804 Sep 29) | editor@cooperpress.com, or reply to an issue | **Send.** One email naming Node Weekly first. |
| Frontend Focus | Active (#760, Sep 30). Its coverage is mainly CSS, HTML and browsers. | Same address | Skip; poor fit. |
| React Status | Active (Cooperpress publications page) | Same address | Only once a React recipe exists. |
| Console.dev | Active (Oct 1) | hello@console.dev | **Send** while the version carries a pre-release label. |
| Changelog News | Uncertain: editor left in March 2026; last confirmed News episode Apr 29, 2026 | changelog.com/news/submit (sign-in) | Optional. |
| **TLDR Web Dev** | **Folded into TLDR Dev**: the page says TLDR Dev "now includes the web development coverage that used to be a separate edition"; 470,000 subscribers | No public submission route found | Skip. |
| Bytes (Fireship) | "Delivered twice a week, for free" | No submission route on the site | Skip. |
| Data Engineering Weekly | Active, weekly | GitHub PR under `weekly/`; op-eds by email to the editor | With a vendor-neutral article. |
| Confluent Developer Newsletter | Active, bimonthly (Jun 9, Jul 16, Aug 27, 2026). **The Sept route (devx_newsletter@confluent.io, "submit your own resource") is not in the Aug 27 edition.** | **Unverified** | Low priority. If Jason emails, one short note after T-0. |
| "Interesting Links" | Active, monthly (latest Aug 21, 2026); has a "Kafka and Event Streaming" section | No route | Don't pitch; HN, Reddit or the forum is how it gets found. |
| Get Kafka-Nated | Newsletter "Espresso" (latest Jul 23, 2026) plus podcast | Not found | Read-only for now; possible podcast pitch later. |

Sources: [Cooperpress publications](https://cooperpress.com/publications/), [frontendfoc.us/issues](https://frontendfoc.us/issues), [tldr.tech/webdev](https://tldr.tech/webdev), [bytes.dev](https://bytes.dev/), [Confluent newsletter](https://developer.confluent.io/newsletter/), [Aug 27 edition](https://developer.confluent.io/newsletter/whats-new-in-confluent-cloud-and-warpstream/), [interestinglinks archive](https://interestinglinks.substack.com/archive), all checked 2026-10-05.

## Kafka community

- **Confluent is now an IBM company.** IBM finalized the acquisition on Mar 17, 2026 ([Boursorama/Zonebourse](https://www.boursorama.com/bourse/actualites-amp/ibm-finalise-l-acquisition-de-confluent-9ff2320b42c01a50d107757c23256abe); IBM 10-Q for the period ending Jun 30, 2026 on [sec.gov](https://www.sec.gov/Archives/edgar/data/0000051143/000005114326000078/ibm-20260630.htm)). Community programs still run under the Confluent name.
- **Forum:** see row 6. Low volume. A tool post that leads with a demo (the Failure Lab) and limits is on-topic.
- **Slack:** still "currently at full capacity but will reopen soon" ([LaunchPass](https://www.launchpass.com/confluentcommunity), 2026-10-05). Skip.
- **users@kafka.apache.org:** "A list for general user questions about Kafka"; plain-text email only ([kafka.apache.org/community/contact](https://kafka.apache.org/community/contact/)). The last 20 messages (Sep 22–Oct 2, 2026) are almost all Apache Kafka release threads (4.2.2 announced Sep 25; a **4.4.0 RC3 vote** opened Sep 30), plus a snappy-java CVE thread and one KRaft question ([lists.apache.org](https://lists.apache.org/list.html?users@kafka.apache.org)). There are no third-party tool announcements. **Don't post a launch there.** Note that Kafka 4.4.0 looks close; StreamOtter is verified on 4.1.2 only.
- **Conferences:**
  - **Current London 2026** was May 19–20 (ExCeL).
  - **Current San Francisco 2026 is Nov 4–5**, Moscone West. "Current passes are available at no cost this year" (limited capacity). This is for attending, not speaking: I found no open CFP.
  - Current Bengaluru was replaced by a free one-day Data Streaming World Tour ([Confluent blog, Jan 13 2026](https://confluent.io/blog/future-of-current-data-streaming-community/)).
  - For reference, the Bengaluru 2026 CFP ran Nov 10–Dec 22, 2025 ([FAQ](https://current.confluent.io/faq)).
  - **Current London 2027 and its CFP: not announced; unverified.** Watch current.confluent.io from November.
  - Sources: [current.confluent.io](https://current.confluent.io/), [/london](https://current.confluent.io/london), [/san-francisco](https://current.confluent.io/san-francisco).
- **Kafka Summit:** no 2026 or 2027 Kafka Summit found. Confluent's events are branded Current, "the next generation of Kafka Summit". Treat Kafka Summit as gone; **unverified** beyond Confluent's own event pages.
- **Meetups:** see row 7.

## JS and Node conferences (next 6 months)

| Event | Dates | CFP | Source |
| --- | --- | --- | --- |
| NodeConf EU 2026 | **Already held** Sep 29–30, 2026, Bologna (it moved from Ireland) | Closed | [nodeconf.eu](https://www.nodeconf.eu/) |
| CityJS Athens 2026 | Oct 21–23, 2026 | Not shown; almost certainly closed. **Unverified.** | [cityjsconf.org](https://cityjsconf.org/) |
| Current SF | Nov 4–5, 2026 | None found | above |
| Node Congress | The 2026 edition was online, Mar 26–27, 2026. **A 2027 edition is not announced.** | Unknown | [nodecongress.com](https://nodecongress.com/) |
| **JSNation 2027** | May 20 (Amsterdam), May 24 (remote) | **Open until Mar 1, 2027** | [jsnation.com](https://jsnation.com/) |
| "CityAI London 2027" | Apr 21–23, 2027 | Not shown. The listing reads as AI-focused, so check the fit. | [cityjsconf.org](https://cityjsconf.org/) |

Only JSNation has a confirmed open CFP inside the window. A remote-friendly path is a Confluent meetup talk (form) or Node Congress if a 2027 edition is announced (watch nodecongress.com).

## Podcasts

| Show | Status | How guests come on | Verdict |
| --- | --- | --- | --- |
| The Changelog (Interviews) | Active (Sep 3, 2026); a co-host left March 2026 | No public pitch page found (changelog.com couldn't be checked) | Later, only with a story (KafkaSocks lineage, AI-built with tests) |
| JS Party | **Ended**: "One last party", Feb 13, 2025. Changelog said it would spin off as dysfunctional.fm (Dec 10, 2024); that show's status is **unverified**. | — | Remove from lists. |
| Software Engineering Daily | Active (Oct 1, 2026) | editor@softwareengineeringdaily.com | Pitch a topic (live-or-stale browser state) in months 2–6. |
| devtools.fm | Active (#178, Sep 27, 2026) | No route on site | Later; possibly via their Discord (unverified). |
| PodRocket (LogRocket) | Its site's latest episodes are Jul 16 and Jul 9, then a Jul 2 **repeat**. Looks paused. | — | Skip for now. |
| Syntax | Active (#1043); three hosts | No guest pitches found; audience "Potluck" questions only ([syntax.fm/potluck](https://syntax.fm/potluck)) | Skip. |
| Confluent Developer | Active (S2 Ep 27, Apr 13, 2026) | Not published | After a meetup talk. |

Sources: [Changelog new-era post](https://changelog.com/posts/a-new-era-for-the-changelog-podcast-universe), [Apple: One last party](https://podcasts.apple.com/by/podcast/one-last-party/id1209616598?i=1000691982545), [Apple: Changelog & Friends](https://podcasts.apple.com/gb/podcast/changelog-friends/id1689835993) (last episode May 13), [podrocket.logrocket.com](https://podrocket.logrocket.com/), [syntax.fm](https://syntax.fm/), all checked 2026-10-05.

## OS Labs and the lineage projects

- **What OS Labs is today:** "a nonprofit tech accelerator devoted to furthering high-impact open source software". Programs: hackathons, a paid 6-month engineering fellowship, and a 3-month Beta program. The live site, opensourcelabs.io, didn't load on Oct 5, so whether it has a product showcase, an alumni section or a blog is unverified. Sources: [Open Collective](https://opencollective.com/oslabs), [theorg](https://theorg.com/org/oslabs), 2026-10-05.
- **Orgs:** `open-source-labs` holds 36 curated flagship repos (Reactime, Svelvet, Spearmint…), updated as recently as Sep 27, 2026. Neither KafkaSocks nor kafka-penguin is there. `oslabs-beta` has 811 repos; its 10 most recently updated date from Jun–Oct 2026 (e.g. PennyWyze Oct 4, kaptn Sep 23). The cohorts are still running. Sources: [github.com/open-source-labs](https://github.com/open-source-labs), [oslabs-beta repos](https://github.com/orgs/oslabs-beta/repositories).
- **Alumni network:** none public that I could find. A LinkedIn company page exists ([linkedin.com/company/oslabs](https://www.linkedin.com/company/oslabs)). Naming OSLabs in Jason's own LinkedIn launch post is the only zero-friction route I found. **Unverified:** whether OSLabs reshares alumni work.
- **KafkaSocks** ([repo](https://github.com/oslabs-beta/Kafkasocks)): 113 stars, **12 forks** (the Sept brief said 14), 4 contributors (Jason Fricano and the three co-authors), not archived. The latest default-branch commit is **Jun 3, 2021**. The Sept brief's "last push 2022-01-05" was an API `pushed_at` value, which can reflect a branch push. Description: "An easy-to-use, lightweight KafkaJS-to-Socket.io library…".
- **kafka-penguin** ([repo](https://github.com/oslabs-beta/kafka-penguin)): **73 stars, 24 forks**, 4 contributors, not archived. Latest commit **Jun 5, 2021**. Strategies: FailFast, Ignore, Dead Letter Queue. **Its website, kafka-penguin.io, no longer resolves** (DNS failure, 2026-10-05).
- **Route:** no OS Labs showcase to be featured in could be found (unverified). The Sept plan's KafkaSocks successor banner (with co-author agreement) remains the best lineage channel. A courteous "thank you, inspired by" credit in StreamOtter's README for kafka-penguin is honest and costs nothing. Any pointer on kafka-penguin's README needs its authors' agreement; Jason knew the team.

## Awesome lists and directories

Details are in rows 10, 13, 17 and 20. Summary of the order:
1. dharmeshkakadia/awesome-kafka (209★) and monksy/awesome-kafka: active Sep 28, 2026; no stated criteria.
2. infoslack/awesome-kafka (593★): active May 2026; no stated criteria.
3. awesome-websockets: at 30 stars.
4. conduktor/awesome-kafka: at 50 stars; it lists Zilla, so describe StreamOtter factually, without comparisons.
5. awesome-nodejs: at 100 stars, and it may reject SDKs.

None of the Kafka lists includes a Kafka-to-browser-state tool today. Unmet-demand context (FACTS.md): b/kafka-websocket now shows **353 stars, 89 forks, 49 commits** ([repo](https://github.com/b/kafka-websocket), 2026-10-05).

## Medium

- **AI policy** ([Medium help](https://help.medium.com/hc/en-us/articles/22576852947223-Artificial-Intelligence-AI-content-policy), 2026-10-05):
  - "If you have used AI-generated written content in your story, you can just include a simple sentence within the first two paragraphs."
  - Undisclosed AI writing gets "Network Only" distribution.
  - "AI-generated writing (disclosed as such or not) is not allowed to be paywalled as part of our Partner Program."
  - The live article has no such sentence today, so it is likely capped at followers.
- **Moving the article's home (canonical link)** ([Medium help](https://help.medium.com/hc/en-us/articles/360033930293-Set-a-canonical-link)):
  1. Publish the 1.0 article first on the site, e.g. `streamotter.dev/blog/introducing-streamotter`, on T-1, after the go/no-go. `/blog` is a 404 today. Since D2 (2026-10-07) it is a launch gate.
  2. Then edit the September Medium story in place to the 1.0 text. Never post a second Medium story.
  3. On Medium: story → ⋯ → **Edit story** → ⋯ → **More settings** → **Advanced Settings** → "**This story was originally published elsewhere**" → enter the URL → **Save canonical link** → **Publish**.

  Only the author can set it. Gotcha: the setting is worded for content "originally published elsewhere". Here the Medium copy came first, so the site version should keep its Sept 26, 2026 original date. Search engines treat canonical as a hint. dev.to and Hashnode then point their canonical at the same site URL.
- **Publications** (for later articles, not the announcement):

| Publication | Fit | Submission route | Key rules | Verdict |
| --- | --- | --- | --- | --- |
| ITNEXT | Backend, DevOps, data | submit@itnext.io | No pure sales pitches; disclose company relationships and prior submission elsewhere; AI not addressed | Best Medium fit |
| Towards Data Engineering | Data engineering | Form at tde.arverma.dev | No AI or promo rules stated | Possible |
| Data Engineer Things | Data engineering | Apply via form, then submit via Medium | "use AI in your writing, but as an assistance"; no previously published work; no superlatives | Only for an article Jason substantially writes himself |
| In Plain English | JS and general dev | Now its own platform (account, dashboard; hello@plainenglish.io) | Open-source CTAs allowed; AI not addressed | Low |
| Better Programming | — | — | No new activity visible; a reader asked in Feb 2024 whether the form still works | Don't rely on it |

  Sources: [ITNEXT](https://itnext.io/share-your-expertise-ignite-discussions-with-thousands-of-people-around-several-dev-and-it-a69dbdc55cf), [TDE about](https://medium.com/towards-data-engineering/about), [Data Engineer Things](https://blog.dataengineerthings.org/write-for-data-engineer-things-32dc9294c5db), [plainenglish.io/write-for-us](https://plainenglish.io/write-for-us), [Better Programming](https://medium.com/better-programming/write-for-us-5c4bcba59397), all checked 2026-10-05.

  Publication submission and canonical-to-site pull in opposite directions; pick one per article.

## Timeline view

| Phase | Channels |
| --- | --- |
| **Now, before `1.0.0-rc.1`** | Fix the site's version (rc.3 vs `0.2.0-rc.1`) and the Medium placeholder and AI sentence. Jason checks his HN account and takes part on HN in his own words. KafkaSocks co-author note (Sept plan). `/blog` with RSS is a launch gate (D2, 2026-10-07), so the canonical move happens at launch. |
| `1.0.0-rc.1` | Console.dev Betas (the label qualifies). No Show HN yet, unless the rc *is* the launch. |
| **T-0 (1.0 launch)** | Show HN; LinkedIn (mention the OSLabs lineage). |
| T+1 | Cooperpress email; Changelog News if the submit page works. |
| T+2 to week 2 | r/apachekafka, Confluent forum, r/node. |
| Weeks 2–4 | dev.to cross-post; awesome-Kafka PRs (one a week); optional r/javascript, r/webdev (Saturday). |
| Months 1–3 | Confluent meetup talk proposal; first technical article (Data Engineering Weekly, ITNEXT); JSNation abstract before Mar 1, 2027. |
| Months 2–6 | Podcast pitches (SE Daily first); awesome-websockets at 30★, conduktor at 50★; Current London 2027 CFP if announced. |

## New since the Sept plan

1. **HN restricted Show HN** (since March 2026; criteria undisclosed; new or idle accounts blocked). Jason's account standing is now a go/no-go item.
2. **HN's AI rule now also covers posts**, not only comments.
3. **streamotter.dev is live** (not streamotter.app), with the V1 Failure Lab. **It still shows `0.1.0-rc.3`** while npm `latest` is `0.2.0-rc.1`.
4. **Medium article is still unfixed**: placeholder present, no AI sentence. Medium caps undisclosed AI writing at "Network Only".
5. **Console.dev timing:** the Betas section needs a pre-1.0 version or a pre-release label, so submit at `1.0.0-rc.1`, not after `1.0.0`.
6. **Changelog News is uncertain**: its editor left in March 2026; last confirmed News episode Apr 29, 2026.
7. **JS Party ended** (Feb 2025); **PodRocket looks paused** (no new episode since Jul 16, 2026).
8. **TLDR Web Dev merged into TLDR Dev** (no submission route).
9. **Confluent is part of IBM** (closed Mar 17, 2026). The Confluent Developer Newsletter's submission line has disappeared from the latest edition.
10. **Current SF 2026 (Nov 4–5) passes are free** (limited). Current Bengaluru became a free one-day World Tour. Current London 2027 is unannounced.
11. **NodeConf EU 2026 already happened** (Bologna, Sep 29–30). **JSNation 2027 CFP is open to Mar 1, 2027.** Node Congress 2027 is unannounced.
12. **Get Kafka-Nated** is a newsletter and podcast the Sept research didn't list.
13. **Data Engineering Weekly** has an open PR-based submission route.
14. **Hashnode moved its API, webhooks and custom domains to Pro** (June 2026, third-party report).
15. **DEV's AI disclosure tiers** (Aug 26, 2026).
16. **r/webdev's tracked rules remove "LLM generated posts or comments"** (tracker, Sep 29, 2026).
17. **No OS Labs showcase or alumni channel could be found** (unverified). kafka-penguin.io no longer resolves. kafka-penguin has 73★ (last commit Jun 2021). KafkaSocks has 12 forks, not 14.
18. **The awesome-nodejs rules exclude "SDKs"**, which could rule StreamOtter out even at 100★.
19. **Apache Kafka 4.4.0 is in RC vote** (RC3, Sep 30). Expect "does it work on 4.4?" questions at launch; StreamOtter is verified on 4.1.2.
20. **Hacktoberfest 2026 runs as community "Fests" plus an online event, focused on open-source AI.** The plan's "don't tag hacktoberfest" still stands ([hacktoberfest.com/llms.txt](https://hacktoberfest.com/llms.txt)).

## Could not verify (re-check before acting)

- r/apachekafka and r/typescript rules (Reddit couldn't be checked).
- Lobsters rules (not re-verified).
- Show HN eligibility criteria (undisclosed by HN).
- Changelog News current status and submit form.
- The Confluent newsletter submission route.
- Remote-talk policy for Confluent meetups.
- CityJS CFPs.
- Current London 2027 and Node Congress 2027.
- dysfunctional.fm status.
- Whether the Data Engineering Weekly GitHub route is still used.
- The live opensourcelabs.io site (didn't load).
- The Get Kafka-Nated contact route.
