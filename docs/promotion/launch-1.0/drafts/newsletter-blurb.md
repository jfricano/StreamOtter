> **Changed since Sept 27:** blurbs describe `1.0.0` and link `https://streamotter.dev`; 1.0's bad-record handling is in.
>
> **Changed in the Oct 5 fix pass** (FIX_DECISIONS §5; PUBLIC_LAUNCH.md D3): **Console.dev goes to Betas at `1.0.0-rc.1`** (the one exception to the quiet rc), not as a general tool at T+1 (accuracy S8). **T+1 is:** one Cooperpress email (Node Weekly + JavaScript Weekly), **Data Engineering Weekly** via a PR to its repo, and **Changelog News only if it's still publishing**. **Removed:** the Confluent newsletter email (no submission route; it's a Confluent Community Forum post in week 1–2 instead, accuracy S9) and Get Kafka-Nated (no route found, S10). The blurb now leads with the break-it moment, drops "verifiably", and labels quarantine opt-in. **Every hosted-Lab mention is conditional** (B4). Each email carries the AI sentence from `ai-disclosure.md`. "Kafka state in the browser" is out of the titles (N19).
>
> **Changed Oct 7 (D2 answered no):** hosted Lab with S01–S06 and /blog are launch gates; conditionals removed.
>
> **Placeholders in this file:** none. Resolve every **[update at 1.0]** and **[confirm at launch]** marker before sending.

> **Where and when:** Console.dev at `1.0.0-rc.1` (T-14). Everything else on T+1, the day after launch, once each. Decisions are in PUBLIC_LAUNCH.md.
>
> **Rules:**
> - Send from your own address, and disclose that you built it, with the AI sentence.
> - One link per submission, and no follow-up nagging.
> - These are never sent on your behalf. Edit so they sound like you.
>
> **Route checks (October 5, from `briefs/channels.md`):**
> - Cooperpress: editor@cooperpress.com; each issue says "Got a link for us? Reply and tell us."
> - Console.dev: hello@console.dev. Betas takes releases that are "pre 1.0 and/or have an appropriate label in the version number"; "Any GA or stable releases are not eligible."
> - Data Engineering Weekly: "open a pull request with the article title under the weekly folder"; vendor-neutral; "avoid overt product promotion". Submit an **article**, not the repo. Whether the PR route is still used is unverified.
> - Changelog News: its editor left in March 2026; the last News episode confirmed was April 29, 2026. The submit page needs a sign-in. Send only if it's still publishing when you check.
> - Confluent Developer Newsletter: no submission route found in recent editions. Not used.

# Newsletter and editor submissions

## 2–3 sentences

StreamOtter 1.0 is an open-source (MIT) Node.js gateway and TypeScript SDK for live, Kafka-backed web pages that say when they're stale: press "Drop my connection" on its demo and every view says `stale` until fresh snapshots arrive. Developers define the state shape and a mapping function; each view starts from the application's snapshot, gets full-state updates in revision order, and after a disconnect, restart, slow client or bad record either catches up and says `live`, or says `stale`. Bad records are never skipped silently: the source holds by default, and opt-in failure handling can quarantine them to a topic with a durable incident. https://streamotter.dev **[update at 1.0: confirm in a browser that the home page's live panel answers on 1.0.0; if it doesn't, end with the GitHub link and drop the "press Drop my connection" clause.]**

## One sentence (for submission forms)

StreamOtter (MIT) is a Node.js gateway and TypeScript SDK for live, Kafka-backed web pages where every view is either live or says it's stale, and bad records are held, never silently skipped.

---

## Console.dev Betas (hello@console.dev): send at `1.0.0-rc.1`, not T+1

**Subject:** Betas suggestion: StreamOtter 1.0.0-rc.1, open-source Kafka-to-browser state channels

> Hi, I'm Jason Fricano. StreamOtter `1.0.0-rc.1` is a release candidate of an open-source Kafka-to-browser state library, and I'd like to suggest it for Betas.
>
> It's an open-source (MIT) Node.js gateway and TypeScript SDK. Browsers subscribe to application state, never raw topics; each view starts from the app's snapshot, gets full-state updates in revision order, and either catches up and says `live` or says `stale`. A record the gateway can't process holds its source rather than being skipped, and opt-in failure handling can quarantine it to a topic with a durable incident and operator commands.
>
> It's self-service and free: `npm install streamotter`, then a CLI that scaffolds a project and runs a local gateway with a workbench, no Kafka needed to start. The docs, including what's verified and what isn't, are in the repository. I maintain it on my own.
>
> I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.
>
> GitHub: https://github.com/jfricano/StreamOtter · npm: https://www.npmjs.com/package/streamotter
>
> Jason

*Note:* their criteria ask about multi-browser support and active maintenance. Be ready to answer honestly: browser automation is Chromium only at rc.1 (Firefox and WebKit are part of the 1.0 gate), and it's a solo project created September 25. The demo link is left out on purpose, because at rc.1 the site may still show an older release.

## T+1: Cooperpress, Node Weekly and JavaScript Weekly (editor@cooperpress.com)

**Subject:** Link for Node Weekly: StreamOtter 1.0, live Kafka-backed web pages that say when they're stale (open source)

> Hi, I'm Jason Fricano. I built StreamOtter and wanted to suggest it for Node Weekly, or JavaScript Weekly if it fits better.
>
> [2–3 sentence blurb]
>
> I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.
>
> GitHub: https://github.com/jfricano/StreamOtter
> Live demo: https://streamotter.dev **[update at 1.0: only if the home page's live panel answers that day]**
> npm: https://www.npmjs.com/package/streamotter (1.0.0, MIT)
>
> Thanks for reading,
> Jason

## T+1: Data Engineering Weekly (a PR to its repo)

- **What to submit:** the 1.0 article's canonical URL on streamotter.dev/blog, not the repo. The newsletter is vendor-neutral and asks authors to "avoid overt product promotion", so if you'd rather wait for a more technical piece (for example the snapshot-versus-update race), that's fine too.
- **How:** open a pull request to https://github.com/ananthdurai/dataengineeringweekly adding the article title and link under the `weekly/` folder, following the latest file's format. Check the repo's README first: whether this route is still used wasn't verified.
- **PR description (your words):**
  > I wrote this. It's about keeping Kafka-backed web views honest after disconnects, restarts and bad records, with the open-source library I maintain as the worked example. I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

## T+1, only if it's still publishing: Changelog News (changelog.com/news/submit; sign-in required)

Check first: is there a News issue or episode after April 29, 2026? If not, skip it.

- **URL:** https://github.com/jfricano/StreamOtter
- **Title:** StreamOtter 1.0: live Kafka-backed web pages that say when they're stale
- **What's interesting about it?**
  > I built this, so I'm biased. Wiring Kafka to a browser is easy; the hard part comes after: after a disconnect, a restart, or one bad record, is the screen still right? StreamOtter gives each view an authoritative snapshot, then full-state updates in revision order, and an explicit `live` or `stale` state, with access decided by your own handlers. A record the gateway can't process holds its source rather than being skipped; new in 1.0, opt-in failure handling can copy it byte for byte to a quarantine topic with a durable incident, and continue past it only when the application's recovery guard proves its snapshots already cover it. Try it: "Drop my connection" on https://streamotter.dev, or run the whole demo on real Kafka with `npm run dev:lab` from github.com/jfricano/lontra-creek. The site also has a Failure Lab where you borrow an isolated bench to break on purpose, though you may wait in a queue for one. MIT; one gateway per project, and no replay yet. I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.
  >
  > **[confirm at launch]** Keep the Failure Lab sentence once you've leased a bench yourself that day. Don't promise a bench.

## Week 1–2, instead of the Confluent newsletter: Confluent Community Forum, Tools category

Post once, in your own words; the forum's etiquette asks for no cross-posting. https://forum.confluent.io/c/tools/

**Title:** Feedback wanted: holding vs. guarded continuation for poison records in a Kafka-to-browser gateway

> Hi all, I built an open-source project for Kafka developers who need live web views, and I'd like feedback on its bad-record design.
>
> StreamOtter (MIT) is a Node.js gateway and TypeScript SDK. It consumes Kafka with explicit per-record commits; rebalances and outages mark browser views stale until they resynchronize from the application's snapshot. By default, a record it can't process pauses the source at that record, and nothing is committed past it or skipped. With failure handling turned on (opt-in), each such record opens a durable incident, and for invalid JSON or schema failures under a quarantine policy it is copied byte for byte to a pre-provisioned quarantine topic (idempotent producer, acks=all). The source then holds for an operator, or continues only when the application's recovery guard approves and later snapshots acknowledge it. Operators retry or reassess a held record one at a time, and can evaluate and redrive a record the source already moved past, through the normal revision filter. It's verified against Apache Kafka 4.1.2 over TLS with SASL PLAIN and SCRAM, including a local three-broker cluster for the quarantine path; managed services and ACL-enabled brokers aren't verified yet **[update at 1.0]**. One gateway per project; no replay of missed updates.
>
> Would you ever let a guard move a consumer past a record, or always hold for a human?
>
> I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.
>
> GitHub: https://github.com/jfricano/StreamOtter · Runbook: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md

## Short forms (Echo JS, DevHunt, awesome lists)

These are too short to carry the AI sentence; the pages they link to carry it.

- **Echo JS title:** `StreamOtter 1.0: live Kafka-backed web pages that say when they're stale`
- **Awesome-list line** (check each list's CONTRIBUTING for format; no version in the line): `[StreamOtter](https://github.com/jfricano/StreamOtter) - Node.js gateway and TypeScript SDK that delivers Kafka-backed state to browsers with explicit live and stale states, and holds bad records instead of skipping them.`

## Not sent

- **Confluent Developer Newsletter** (devx_newsletter@confluent.io): no submission route in recent editions (Aug 27, Jul 16, Jun 9). The forum post above replaces it.
- **Get Kafka-Nated:** no contact route found (Oct 5). Send only if one turns up.
