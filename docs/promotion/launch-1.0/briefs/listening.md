# Listening, not bots: pointing developers to StreamOtter

October 7, 2026 · for jason · Planning only. No accounts were created, nothing was posted, and no collector is running. Rules were checked on 2026-10-07 unless a row says otherwise. Ground truth for product claims: `FACTS.md`.

## Verdict

1. **No bots that post, reply, vote or DM, anywhere.** Every platform checked bans automated promotion, either in so many words or in effect. Reddit's spam policy gives "Programming a bot that continuously promotes specific products or services within a community or across many communities" as its example of a violation. HN says "please don't automate posting." Stack Overflow bans generative AI in posts.
2. **Do this instead: listen and alert.** A read-only collector builds a weekly digest of threads where people hit the problems StreamOtter solves. You pick the few worth answering and write every reply yourself, with disclosure.
3. **Cost and timing:** about 15 minutes a week to read the digest, plus at most two replies, inside the 1–2 h steady-state budget. Collection can start now. Outside replies pause in launch week (T-0 to T+7).

---

## 1. Platform rules

"Automation allowed?" means automated posting, replying, voting or messaging. Read-only collection is covered in §2.

| Platform | Automation allowed? | Self-promotion rule | Source, date checked |
| --- | --- | --- | --- |
| **Reddit (site-wide)** | **No, for promotion.** Bots must register as apps, can't "Mask as a human", and can't use "automation for unsolicited outreach (e.g., unprompted DMs or Chat requests)". The Responsible Builder Policy says: "Apps must not engage in spamming activity through automated posts, comments, or direct messages. This includes posting identical or substantially similar content across subreddits." API access needs "explicit approval" first. Reddit's app-label page says "Automation itself isn't prohibited", but promotion bots are the spam policy's own example. | Spam policy: "If your contributions to Reddit consist primarily of links to a business that you run, own, or otherwise benefit from, please be thoughtful about the frequency of posting." Moderators decide what counts as spam in their community. | [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) (updated 2026-10-05), [Spam](https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam) (updated 2026-10-06), [Don't break the site](https://support.reddithelp.com/hc/en-us/articles/360043512931-Don-t-break-the-site) (updated 2026-10-06), [Apps on Reddit](https://support.reddithelp.com/hc/en-us/articles/45376380316052-Apps-on-Reddit-and-how-to-get-a-label-for-your-app) (updated 2026-10-05); all checked 2026-10-07. **Developer Terms and Data API Terms (redditinc.com): blocked here, unverified.** |
| r/apachekafka | No (site-wide rules apply) | **Unverified.** reddit.com is blocked here and no tracker covers this subreddit. Read the sidebar before replying. | Checked 2026-10-07: reddit.com and the gummysearch page showed no rules |
| r/node | No | The tracker found no rules on the public rules page; promotion and AI rules unknown | [Rankhog r/node](https://rankhog.com/subreddits/node) (tracker verified 2026-09-18; read 2026-10-07). Secondary source |
| r/javascript | No | "It's ok to promote your own content … but it should not constitute a majority of your contributions." Also "/r/JavaScript is not a support forum", so expect few help threads there | [Rankhog r/javascript](https://rankhog.com/subreddits/javascript) (tracker verified 2026-09-18; read 2026-10-07). Secondary source |
| r/webdev | No. "LLM generated posts or comments" are removed as low-effort | Project sharing is "limited to Showoff Saturday"; "no excessive self-promotion. Please refer to the Reddit 9:1 rule"; "We do not allow any commercial promotion or solicitation" | [Rankhog r/webdev](https://rankhog.com/subreddits/webdev) (tracker verified 2026-09-29; read 2026-10-07). Secondary source |
| **Stack Overflow** | **No.** "All use of generative AI (e.g., ChatGPT and other LLMs) is banned when posting content on Stack Overflow", and that includes using it to reword. **No separate bot policy could be read** (stackoverflow.com is blocked here). | "if you mention your product, website, etc. in your question or answer … you *must* disclose your affiliation in your post." Also: "Don't include links except to *support* what you've written." | Promotion: [help/promotion](https://stackoverflowteams.com/help/promotion) on Stack Overflow's Teams domain, the same help-center text (checked 2026-10-07). AI ban: stackoverflow.com/help/gen-ai-policy was blocked, so this is read from an archived copy, [revision 2026-07-29](https://toolongdidntread.it.com/companies/stack-overflow/guidelines/v/20260729_rev01) (checked 2026-10-07). **Check the live page before the first answer.** |
| **Hacker News** | **No.** "please don't automate posting." Comments: "Don't post generated text or AI-edited text. HN is for conversation between humans." Posts: "Please don't put generated text in HN posts." | "Please don't use HN primarily for promotion. It's ok to post your own stuff part of the time, but the primary use of the site should be for curiosity." "Don't solicit upvotes, comments, or submissions." | [newsguidelines.html](https://news.ycombinator.com/newsguidelines.html), [newsfaq.html](https://news.ycombinator.com/newsfaq.html), [showhn.html](https://news.ycombinator.com/showhn.html); checked 2026-10-07 |
| **GitHub** | **No.** The Acceptable Use Policies ban "automated excessive bulk activity and coordinated inauthentic activity, such as spamming", "bulk distribution of promotions and advertising", "inauthentic interactions, such as fake accounts and automated inauthentic activity", and "rank abuse, such as automated starring or following". The Terms add: "Accounts registered by 'bots' or other automated methods are not permitted." Nothing addresses automated issue comments specifically. | No numeric rule. Maintainers can hide, edit or delete comments, lock threads, block users and set interaction limits, and it's their repo. Data from the API can't be used "for spamming purposes, including for the purposes of sending unsolicited emails to users". | [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) (no date shown), [Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (effective 2026-04-27), [Community Guidelines](https://docs.github.com/en/site-policy/github-terms/github-community-guidelines); checked 2026-10-07 |
| **dev.to** | **No.** "we ask that you not use bots or AI to generate comments on posts, whether the post was published by you or another community member." | Terms §11: content must not be "designed primarily for the purposes of promotion or creating backlinks." AI-assisted articles must say so. | [AI guidelines](https://dev.to/guidelines-for-ai-assisted-articles-on-dev) (updated 2024-04-08), [Terms](https://dev.to/terms) (updated 2024-11-21); checked 2026-10-07 |
| **Discord** | **No.** "Do not use self-bots or user-bots. Each account must be associated with a human, not a bot." "Automating normal user accounts … is forbidden, and can result in an account termination." Bot accounts only exist where a server admin adds them. | "Do not send unsolicited bulk messages (or spam) to others." Each server sets its own promotion rules. | [Community Guidelines](https://discord.com/guidelines) (updated 2025-08-29), [Self-bots](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots) (2024-04-05); checked 2026-10-07 |
| **Slack communities** (e.g. Confluent Community Slack) | **Not in scope.** A bot would need the workspace to install it. Slack's Acceptable Use Policy text is in a linked Salesforce PDF that wasn't read: **unverified.** | Confluent: "do not post the same question in multiple channels (otherwise known as 'cross-posting')"; keep help in public channels; Slack history is kept "about 2 weeks". Its code of conduct doesn't address promotion. | [Slack AUP page](https://slack.com/acceptable-use-policy) (updated 2025-07-08), [Confluent: ask the community](https://developer.confluent.io/community/ask-the-community/), [Confluent code of conduct](https://developer.confluent.io/community-code-of-conduct/); checked 2026-10-07 |
| Confluent Community Forum | No posting automation (it isn't needed) | The forum's guidelines page is blocked by robots.txt here: **unverified** | [latest.rss](https://forum.confluent.io/latest.rss) is a working feed (checked 2026-10-07) |

**The pattern across platforms:** where automation is allowed at all, it has to be labeled, registered and harmless, and promoting your own product is always the example of what's banned. Three platforms the launch depends on (HN, Stack Overflow and r/webdev) also ban machine-written text outright, so even a human-posted, AI-drafted reply breaks the rules there.

---

## 2. The alternative: listen and alert

A read-only collector runs once a week and writes a digest. You read it, pick at most two threads, and reply by hand from your own account. Nothing is posted, voted on or sent by anything but you.

### 2.1 Sources and what the terms allow

| Source | How to read it | Auth and limits | Notes |
| --- | --- | --- | --- |
| **Reddit** | **Use manual saved searches** (five bookmarks, about 5 minutes a week) and, optionally, the free tier of [F5Bot](https://f5bot.com/), a third-party keyword email covering Reddit, HN and Lobsters. Don't build a Reddit collector. | Reddit's API needs OAuth: "Traffic not using OAuth or login credentials will be blocked"; 100 queries per minute per client ID; prior approval ([Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki), updated 2026-05-11). The Responsible Builder Policy points non-commercial developers to the Developer Platform (Devvit), which runs inside subreddits and doesn't search across them. "Scraping Reddit … without an authorized agreement" is banned. | **Reddit RSS ends November 13, 2026, and public API access ends by March 2027.** Approved apps and bots must register before January 12, 2027 ([TechCrunch, 2026-09-30](https://techcrunch.com/2026/09/30/reddit-is-killing-rss-feeds-ending-public-api-access-because-of-ai-bots/); Reddit's own announcement couldn't be reached here). Applying for API access to watch four subreddits isn't worth it. Whether F5Bot keeps covering Reddit after these changes is **unknown**. |
| **Stack Overflow** | The Stack Exchange API (`/search/advanced` with `tagged=` and `site=stackoverflow`), or the per-tag RSS feeds | Third-party summary: 300 requests a day per IP without a key, 10,000 a day with a free key from stackapps.com, and a `backoff` field that has to be respected ([apis.io](https://apis.io/rate-limits/stackexchange/stackexchange-rate-limits/), checked 2026-10-07). **The primary throttle docs were blocked here: unverified.** A weekly run needs well under 50 requests. | Tag feed URLs and exact tag names: **unverified** (stackoverflow.com is blocked here) |
| **Hacker News** | [hnrss.org](https://hnrss.github.io/) search feeds: `/newest?q=…` (titles by default) and `/newcomments?q=…`, backed by Algolia's HN Search API. Or call that API directly. | The official HN API is read-only with no auth, and "There is currently no rate limit" ([HackerNews/API](https://github.com/HackerNews/API)), but it has no search. **The Algolia HN Search API's rate limit couldn't be confirmed** (its docs page needs JavaScript). The FAQ warns that "If you request many pages quickly, your IP address might get banned", so never fetch news.ycombinator.com pages directly. | The hnrss docs were read on 2026-10-07; a live fetch of one feed failed here, so test it once before relying on it |
| **GitHub** | REST search: `GET /search/issues` (issues and PRs in public repos) | "30 requests per minute" authenticated, 10 unauthenticated; "up to 1,000 results for each search"; queries over 256 characters or with more than five AND/OR/NOT operators are rejected ([search docs](https://docs.github.com/en/rest/search/search), checked 2026-10-07) | **Run it on your own machine (cron), not on GitHub-hosted Actions runners.** The Actions terms forbid "Any other activity unrelated to the production, testing, deployment, or publication of the software project associated with the repository" ([additional product terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features), checked 2026-10-07). The script and its config can still live in a private repo for backup. |
| **dev.to** | Tag feeds, e.g. `https://dev.to/feed/tag/kafka` | None | Verified as a working RSS 2.0 feed on 2026-10-07 |
| **Confluent Community Forum** | `https://forum.confluent.io/latest.rss` | None | Verified working 2026-10-07. Kafka users ask "how do I get this to a UI" questions here. |
| **Google Alerts** | Email alerts for exact phrases and brand mentions | A Google account | Delivery frequency and source type can be set ([help](https://support.google.com/websearch/answer/4815696?hl=en), checked 2026-10-07). **Whether it can deliver to an RSS feed, and how well it covers forums, are unverified.** Treat it as a backstop. |
| Discord, Slack | **Don't collect.** Read them only as a member, by hand, in communities you already belong to | — | Automated reading would need a self-bot (banned on Discord) or an app the workspace installs. The Sept plan's "no Discord or Slack presence" stands. |

### 2.2 Queries

None of these has been test-run (GitHub search and Reddit weren't reachable from here). Tune them after the first two digests. Treat any query that turns up nothing useful three weeks running as noise and drop it.

**Brand and lineage (every source):** `StreamOtter`, `streamotter.dev`, `@streamotter`, `KafkaSocks`. Someone talking about the project is always worth reading, and replying as the author there is plainly welcome.

**GitHub issues** (add `created:>=<last run date>` to each):
```
kafka websocket is:issue
kafkajs socket.io is:issue
kafkajs websocket is:issue
kafka "server-sent events" is:issue
kafka sse browser is:issue
kafka "live dashboard" is:issue
kafka websocket reconnect is:issue
"kafka-websocket" is:issue
websocket reconnect "stale" state is:issue language:TypeScript
socket.io reconnect "missed" events is:issue
```
Also run one repository query, to know the landscape, never to comment: `kafka websocket in:name,description created:>=<last run date>`.

**Stack Overflow** (the tag names are the usual ones; confirm each exists):
```
tagged=apache-kafka;websocket
tagged=apache-kafka;socket.io
tagged=kafkajs
tagged=apache-kafka;server-sent-events
tagged=spring-kafka;websocket      (Spring + STOMP: the pattern FACTS.md describes)
tagged=websocket  q=reconnect stale state
tagged=socket.io  q=reconnect missed events
```

**Hacker News** (hnrss):
```
https://hnrss.org/newest?q=kafka+websocket
https://hnrss.org/newest?q=kafka+browser
https://hnrss.org/newest?q=kafka+SSE
https://hnrss.org/newcomments?q=kafka+websocket
https://hnrss.org/newcomments?q=kafkajs
https://hnrss.org/newcomments?q=kafka+dashboard+realtime
```

**Reddit** (manual bookmarks, sorted by new, restricted to the subreddit):
- r/apachekafka: `websocket`, `socket.io`, `SSE`, `browser`, `frontend`, `dashboard`, `UI`
- r/node: `kafka`, `kafkajs`
- r/webdev: `kafka`, `websocket stale`, `websocket reconnect`
- Site-wide: `kafka websocket`, `kafkajs socket.io`, `kafka to frontend`

**dev.to and the Confluent forum:** filter the feeds for `websocket`, `socket.io`, `SSE`, `server-sent`, `browser`, `frontend`, `dashboard`, `UI`, `reconnect`.

**Google Alerts** (exact phrases): `"kafka" "websocket"`, `"kafkajs" "socket.io"`, `"kafka to the browser"`, `"kafka" "server-sent events"`, `"StreamOtter"`.

### 2.3 Triage: when a reply helps, and when to stay out

**Reply only when all four are true:**
1. **The problem is concrete and still open:** someone is stuck now, the question hasn't been answered well, and the thread is recent enough that a reply isn't reviving it.
2. **It's StreamOtter's problem:** getting Kafka data into a browser view; a view that's wrong or stale after a reconnect; the "fetch, then subscribe" race; one user seeing another user's data; a bad record silently skipped or stalling the view; a Node/KafkaJS-to-WebSocket bridge.
3. **The answer stands on its own.** The reply explains the cause and a fix the asker could apply without StreamOtter. StreamOtter is the last line, with disclosure, offered as one option.
4. **The place allows it:** the subreddit sidebar, the tag's norms, the forum's rules. And you haven't linked StreamOtter in that community recently (a working cap: at most one StreamOtter link per community per month, and most of your contributions there aren't about it, per r/javascript's "majority" rule, r/webdev's 9:1 and HN's "part of the time").

**Stay out, or reply without any StreamOtter mention, when:**
- The stack doesn't fit: Java/Spring, Python or Go people who want an answer in their stack. Explain the cause and skip the plug.
- They're on a managed Kafka service and the answer depends on it (managed services are unverified for StreamOtter).
- They need replay of missed messages (StreamOtter sends a fresh snapshot instead), more than one gateway, or guaranteed Safari/Firefox support before G1.2 passes. Say so plainly if you reply.
- It's someone else's launch, project announcement, or issue tracker. **Never put a StreamOtter link in another project's issues** (KafkaSocks, b/kafka-websocket, KafkaJS and the rest) unless that maintainer asks for alternatives. On KafkaSocks, the agreed route is the co-authors' successor banner.
- The question is homework, a vague rant about Kafka, or already well answered.
- The thread is on HN and StreamOtter hasn't had its Show HN yet (see §4).
- You'd be the third reply recommending a tool.

**Never:** DM or email anyone found through the digest (Reddit bans "unprompted DMs"; GitHub bans using API data for "unsolicited emails"); ask anyone to upvote or to reply; reply from a second account; paste the same text twice.

### 2.4 Disclosure lines (you type them; place them where the reply mentions StreamOtter)

| Platform | Disclosure | Also |
| --- | --- | --- |
| Stack Overflow | "Disclosure: I made StreamOtter." at the start of the StreamOtter part (the Sept plan's line). Required by the promotion rule. | The answer must be complete without the link ("Don't include links except to *support* what you've written") |
| Reddit | "I'm the author of StreamOtter, so weigh this accordingly." | The AI sentence from `drafts/ai-disclosure.md` whenever the reply recommends StreamOtter (D4) |
| Hacker News | Say you're the author, in your own words, in the same comment | The AI sentence word for word when asked, as `hn-faq.md` plans |
| GitHub (your own repo's Discussions and issues; elsewhere only when asked) | "I maintain StreamOtter." | No AI line (D5 is no). |
| dev.to, Confluent forum | "Disclosure: I made StreamOtter." | The AI sentence when recommending it (D4) |
| Discord, Slack (communities you're already in) | "Disclosure: I made StreamOtter." | Only where the server's rules allow tool mentions |

D4 as written covers outward-facing posts. These lines extend it to replies that recommend StreamOtter. Said first, the AI sentence reads as confidence; found later, it reads as hiding. A reply that never mentions StreamOtter needs no disclosure.

### 2.5 Who writes what

- **Stack Overflow:** the answer is written by you, from scratch. The ban covers AI that is asked and then copied *and* AI used to reword, so nothing prepared is pasted, paraphrased or edited into an answer. Allowed: the doc links, and a checklist of the problem's causes that you read beforehand and then close.
- **Hacker News:** your own words only ("generated text or AI-edited text" is banned). Prepared talking points are fine to read; the comment is typed fresh.
- **Reddit:** your own words. r/webdev removes "LLM generated posts or comments", and other subreddits are likely to do the same.
- **Prepared material that is allowed everywhere** (it's reference, never reply text):
  - **Cause checklists**, one per recurring problem. "Stale UI after a WebSocket reconnect": updates missed while disconnected; no snapshot on resubscribe; the fetch-then-subscribe race; offsets or the consumer position reset; a client that shows `live` without checking. "Kafka to a browser dashboard": a broker isn't a browser API; fan-out and per-user filtering; access checks; reconnect and backpressure; bad records.
  - **Doc links:** getting started, the "make it lie" recipe, the limits sentence, `IMPLEMENTATION_STATUS.md` for the current version.
  - **The honest limits** for the version on `latest` (from `FACTS.md`).
  - The approved disclosure lines above.

### 2.6 The digest and the cadence

**What's automated (read-only):**
- A weekly collector on your own machine runs the queries in §2.2 against the sources in §2.1 and writes one digest.
- Each item in the digest: source, link, date, matched query, the asker's problem in one line, a triage hint (*fits* / *maybe* / *skip*, with the reason from §2.3), whether an accepted or high-voted answer already exists, and the doc link or cause checklist that applies. **No draft replies.** The digest stores no profiles and no usernames beyond what the link shows, and it keeps nothing older than about 60 days.
- A separate "mentions" section lists the brand queries.

**What's never automated:** posting, replying, voting, starring, following, flagging, DMs, email, account creation, and anything that signs in as you.

**Your time (Mondays, or the first weekday of the week):**
| Step | Time |
| --- | --- |
| Read the digest and open the Reddit bookmarks | ~10 min |
| Pick at most two threads (often zero) | ~5 min |
| Write the replies yourself | 10–20 min each, only when something fits |

That's about 15 minutes in a quiet week and under an hour in a busy one.

---

## 3. Risks

| Risk | What could happen | Mitigation |
| --- | --- | --- |
| **Reddit removals and suspensions** | Moderators remove link replies; site-wide spam enforcement acts on accounts whose activity is mostly links to their own project. The Responsible Builder Policy says Reddit can revoke tokens and suspend apps, accounts, "associated bots and domains", so a promotion bot could get the GitHub repo or streamotter.dev links flagged too. | No bot. A frequency cap, answers that stand without the link, sidebars read first |
| **HN account standing (the Show HN depends on it)** | Show HN has been restricted since March 2026 with undisclosed criteria, and new or idle accounts report "Sorry, your account isn't able to submit this site" (the channels brief, with sources, checked 2026-10-05). Flagged or [dead] promotional comments, or anything automated, put the one account the launch needs at risk. | On HN, take part as a person on any topic you know. **No StreamOtter links in HN comments before the Show HN** unless someone asks directly. This is the "active participant" advice in the channels brief, done honestly. Never fetch HN pages in bulk |
| **The honesty of the launch** | The launch asks "Can you make it lie?" and leads with a plainly stated AI sentence. A bot posing as a helpful developer is exactly the kind of quiet lie the launch says the product never tells, and Reddit bans masking "as a human". If it were found out, it would be the story, not the library. | Every reply is yours, signed with your name, with disclosure first. Prepared material stays reference. The digest only decides what you read |
| **GitHub issue brigading** | Links dropped into other projects' issues read as hijacking. Maintainers can hide them as spam or off-topic, block you or report you, and the AUP bans "bulk distribution of promotions" and "automated inauthentic activity". It would also sour the KafkaSocks and kafka-penguin relationships the launch credits. | Other projects' trackers are read-only for you, unless a maintainer asks for alternatives. Never ask others to comment anywhere |
| **Stack Overflow sanctions** | An answer drafted, reworded or edited with AI breaks the ban ("Sanctions will be imposed"); an undisclosed link is treated as spam. | §2.5: written from scratch, disclosure first, answer complete without the link |
| **Sources disappearing** | Reddit RSS ends November 13, 2026, and its public API by March 2027; third-party alert services may lose Reddit coverage. | Reddit stays a manual bookmark check, and the collector doesn't depend on Reddit |
| **Privacy** | A digest that piles up people's details turns into a lead list | Links and one-line problem summaries only; 60-day retention; never contact anyone off-thread |
| **Time creep** | Listening grows into a second job | A two-reply weekly cap. It replaces the Sept plan's optional Stack Overflow item; it doesn't add to the budget |

---

## 4. How this fits PUBLIC_LAUNCH.md

| Phase (PUBLIC_LAUNCH.md §4) | Listening |
| --- | --- |
| **§4.1 Now** | The collector and digest are prepared; you approve the query list (10 min). Digests start weekly. Replies are help-first. Mention StreamOtter only where it clearly fits, and say it's a release candidate (`0.2.0-rc.1` today). On HN, ordinary participation without links (this also serves five-things #1). |
| **§4.2 Quiet pre-launch (T-14 to T-1)** | Same. Brand mentions get priority, since rc.1 people may start talking about it. |
| **§4.3 Launch week (T-0 to T+7)** | Outside replies **pause**. The daily 15-minute triage covers your own threads (Show HN, r/apachekafka, the Discussion). The digest keeps running so nothing is lost. |
| **§4.4 Week two (T+8 to T+14)** | Restart at the normal weekly cadence. Fold what you learn into the T+14 retrospective: which queries found real people, and which replies helped. |
| **Steady state (after T+14; Sept plan, 1–2 h a week)** | Add a weekly row, "listening digest (prepared) → 15 min: read, pick at most two, reply yourself with disclosure". It takes the slot of the Sept plan's "Optional: one fitting Stack Overflow thread" (20 min), so the weekly total stays at about 60–75 minutes. The Sept decision against a *weekly* Stack Overflow cadence stands: Stack Overflow is just one source in the digest, answered only when something fits. |

**Signals (§6, never quoted publicly):** a reply that leads someone to try StreamOtter and say so is the main §6 signal ("people you don't know who say they run it"). Note the source in the weekly metrics snapshot.

**Open items (couldn't verify here):** r/apachekafka's and r/node's rules; Reddit's Developer Terms and Data API Terms text (redditinc.com blocked); Reddit's own RSS announcement (TechCrunch only); the live Stack Overflow gen-AI policy page (read from an archived copy dated 2026-07-29); any Stack Overflow bot policy; the Stack Exchange API limits (third-party summary); the Algolia HN Search rate limit; a working hnrss feed fetch; Stack Overflow tag names and feed URLs; Google Alerts RSS delivery; Slack's AUP text; the Confluent forum guidelines; F5Bot's Reddit coverage after November 13. None of the queries in §2.2 has been test-run.
