> **Changed since Sept 27:** all five drafts describe `1.0.0` and link `https://streamotter.dev`. r/apachekafka is rebuilt around 1.0's failure handling; r/node adds the `node:sqlite` journal lesson; r/typescript drops "pre-1.0, this is the moment to change names". The lineage and Jason's pitch appear where they fit.
>
> **Changed in the Oct 5 fix pass:** every variant now carries the **AI sentence** from `ai-disclosure.md`, word for word (strategy review: none did). The **"Can you make it lie?"** invitation and the break-it paths (the home page's "Drop my connection", the local fixture, `npm run dev:lab` in the public lontra-creek repo) are in r/apachekafka, r/node and the standard wording. r/apachekafka has a shorter title and is the **T-0 Plan B** if HN won't take the submission. r/typescript, r/javascript and r/webdev moved to a "later, optional" appendix. Hosted-Lab lines follow D2 (the hosted Lab only if it's on, S01 and S06 only, no hosted quarantine exercises at launch), not #42 alone (superseded Oct 7: D2 is no), and the "wasn't answering" line is corrected (accuracy B3, S11, S12, N11).
>
> **Changed Oct 7 (D2 answered no):** hosted Lab with S01–S06 and /blog are launch gates; conditionals removed.
>
> **Placeholders in this file:** `{{MAKE_IT_LIE_LINK}}` (the pinned Discussion's URL) · `{{MAKE_IT_LIE_LOCAL_LINK}}` (the published no-Kafka recipe, from `drafts/make-it-lie-local.md`). Before posting, also resolve every **[update at 1.0]** and **[confirm at launch]** marker.

> **Where and when:** separate text posts, one subreddit at a time, after launch day. Two are core (r/apachekafka, r/node). The other three are later and optional, outside the launch plan (appendix). Decisions are in PUBLIC_LAUNCH.md (D1–D8).
>
> **Plan B (D8 in PUBLIC_LAUNCH.md, decided at T-7):** if your HN account can't submit Show HN, r/apachekafka moves to **T-0 Tue, 8:00 ET** and becomes the launch post, and r/node moves up to T+2 (PUBLIC_LAUNCH.md §4.5).
>
> **Rules:**
> - **REWRITE IN YOUR OWN WORDS.** These are reference drafts, not posts. Many subreddits remove or downvote AI-written posts, and your own voice is what earns replies. Use them for facts and structure only.
> - Read each sidebar and the pinned posts first. reddit.com couldn't be loaded during research; rule notes below come from third-party trackers dated September 2026.
> - Disclose that you wrote it, and keep the **AI sentence word for word** in every post, even though you rewrite the rest (`ai-disclosure.md`). Some subreddits remove LLM-written posts, and Kafka people will connect the Reddit post to the HN thread.
> - Never post the same text twice, never ask for upvotes, and reply to comments in the first few hours.

# Reddit variants

**Order:**
1. r/apachekafka (T+2 or T+3, core; **T-0 if Plan B**)
2. r/node (week 2, core)

Later, optional, outside the launch plan (appendix):
3. r/typescript
4. r/javascript
5. r/webdev, on a Saturday only

Post Tuesday–Thursday mornings US time (a heuristic), except r/webdev.

**Standard wording (for facts; say it your way):**
- **What it is:** "an open-source (MIT) Node.js gateway and TypeScript browser SDK, version 1.0.0."
- **Limits:** "one gateway per project; no replay of missed updates (a fresh snapshot instead); Chromium is the only browser tested automatically **[update at 1.0]**; managed Kafka services are unverified; KafkaJS 2.2.4 is pinned behind an internal adapter."
- **The pitch, accurately:** "you define the state shape and one mapping function, plus the snapshot and access checks your app already has; StreamOtter does the rest."
- **The invitation:** "Can you make it lie? Get a view to say `live` while it shows something other than the newest state its snapshot and the topic's revisions imply, or get a bad record skipped silently. Reports: {{MAKE_IT_LIE_LINK}}."
- **Ways to break it:** "Drop my connection" on the streamotter.dev home page **[update at 1.0: check it answers on 1.0.0]**; locally with no Kafka, a fixture record with raw text (`{ key, raw: "{not json" }`) and a `quarantine-hold` policy: the source pauses at it and the incident is quarantine-held with local evidence (recipe: {{MAKE_IT_LIE_LOCAL_LINK}}, verified Oct 5 on 0.2.0-rc.1; it didn't check the browser view); locally on real Kafka, `npm run dev:lab` in https://github.com/jfricano/lontra-creek (Docker and Compose 2.24.4+; public, checked Oct 5); and a hosted Failure Lab bench at https://streamotter.dev/lab/ (Source failures S01–S06 and the connection exercises; there are only a few benches, so you may wait in a queue) **[confirm at launch: you leased one yourself]**.
- **AI sentence (word for word, every post):** "I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code."

Links used below:
- GitHub: https://github.com/jfricano/StreamOtter
- Demo: https://streamotter.dev (Failure Lab: https://streamotter.dev/lab/; benches are queued, so never promise one)
- Demo source and local Lab: https://github.com/jfricano/lontra-creek
- Kafka guide: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md
- Bad-records runbook: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md
- Status: https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md

---

## 1. r/apachekafka — REWRITE IN YOUR OWN WORDS

> **Rule check:** unverified. Look for a rule on tools and vendor posts, and for a flair. Question-led, from the author, not an announcement.

**Title:** Would you let a guard move a consumer past a poison record, or always hold? (open-source Kafka-to-browser gateway)

**Body (reference):**

I'm the author of StreamOtter, an open-source (MIT) Node.js gateway and TypeScript browser SDK; 1.0.0 just shipped. The gateway consumes your topics, and browsers subscribe to application-level "state channels," never to topics. I'd like people who run Kafka to poke holes in how it handles records it can't process.

The baseline (unchanged from the first version):
- One dedicated consumer group per configured source, never one per browser. Auto-commit off; one commit per record, only after it's validated, mapped and admitted to every interested subscription. A commit never waits for browsers.
- A record it can't process pauses the source at that record. Nothing at or after it is committed, nothing is skipped, and the affected browser views go `stale`.

What 1.0 adds, opt-in (`failureHandling`):
- **An incident per bad record**, in a local SQLite journal: stable ID, failure class, position, evidence summary, history. It survives restarts.
- **`quarantine-hold`:** for invalid JSON or a payload that fails the channel's schema, the original key, value and headers go byte for byte to a quarantine topic you pre-create (idempotent producer, `acks=all`, the gateway never creates topics). The source stays held.
- **`quarantine-resync`:** the source moves past the record only if your application's recovery guard says your snapshots already cover what it changed (the docs' example checks a transactional outbox). After that, every snapshot must acknowledge the recovery boundary before a view can be `live`. A circuit breaker stops automatic continuation after five incidents in 60 s by default.
- **Operator commands:** a held record comes back with `sources retry-current` after a fix, or `sources reassess` when the recovery guard approves (`reopen-circuit` first if the breaker tripped). For a record the source already moved past, `failures evaluate` dry-runs the current mapping on the stored original and `failures redrive` delivers the result through the normal revision filter, so it can't overwrite newer state; nothing is published back to Kafka. No force, no wildcard, no bulk.
- Mapping errors, routing failures, revision conflicts, tombstones and oversize records always pause. There's no ignore or skip.

Credit where it's due: the shape was inspired by kafka-penguin, a KafkaJS library from OSLabs with FailFast, Ignore and Dead Letter Queue strategies. Hold is roughly fail-fast and quarantine roughly the DLQ; I left out Ignore because a skipped record in a state view is a silently wrong screen.

Tested against Apache Kafka 4.1.2 (single-node, plus a local three-broker cluster where the quarantine leader was killed). Not tested: a broker with ACLs enabled **[update at 1.0]**, managed services, network partitions. Other limits: one gateway per project, no replay of missed updates, KafkaJS 2.2.4 pinned behind an adapter.

Questions:
1. Would you ever let a guard move a consumer past a record, or always hold for a human?
2. Is a byte-for-byte copy plus a metadata header the quarantine format you'd want, or do you expect a standard DLQ envelope?
3. Per-record commits: a problem at your topic rates? (Throughput isn't measured.)
4. Which managed Kafka should I verify first?

If you want to break it: with no Kafka, the scaffold's fixture source takes a record with raw text (`{ key, raw: "{not json" }`), so you can watch `quarantine-hold` pause the source at that record and hold the incident with local evidence, then try to get the preview to say `live` while it's missing the later revisions (recipe: {{MAKE_IT_LIE_LOCAL_LINK}}). On real Kafka, `npm run dev:lab` in the demo's public repo (https://github.com/jfricano/lontra-creek; Docker, Compose 2.24.4+) runs the whole stack with three Lab benches locally, including a "Fouled sensor" exercise where you trigger the pause yourself. **[update at 1.0: add "and the quarantine exercises, such as Garbled reading" once you've run them locally; Lontra Creek #42 is merged (6cb47e9); re-pin and deploy pending.]** If you can make a view say `live` while it's wrong, or get a bad record skipped silently, I want to know: {{MAKE_IT_LIE_LINK}}

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

Code and the runbook: https://github.com/jfricano/StreamOtter · Failure Lab: https://streamotter.dev/lab/ (the Source failures exercises S01–S06 run there, quarantine included; you may wait for a bench) **[confirm at launch: you leased a bench that day]**

---

## 2. r/node — REWRITE IN YOUR OWN WORDS

> **Rule check:** no subreddit-specific rules were displayed as of Sept 18, 2026 (Rankhog). Lead with the lesson, not the product.

**Title:** Three things I learned shipping a Kafka-to-browser gateway on Node 24: two KafkaJS 2.2.4 workarounds and node:sqlite

**Body (reference):**

I build StreamOtter, an open-source (MIT) Node.js gateway that feeds live, access-checked state from Kafka into web pages over Socket.IO (1.0.0 is out). Three things worth writing up:

1. **KafkaJS's 1 ms timer per connection.** Its request queue can schedule a negative timeout, which Node clamps to 1 ms, so every open broker connection spins a 1 ms timer; Node 24+ also prints `TimeoutNegativeWarning`. A version-guarded replacement of that one method inside my adapter took an idle gateway from 2.6% to 0.3% of a core on my machine.
2. **A connection left open after `disconnect()`.** After reconnecting through a broker restart, KafkaJS could leave a socket open. The adapter supplies its own socket factory, tracks sockets, and closes survivors on stop.
3. **`node:sqlite` for a durable journal.** The new bad-record journal uses Node's built-in SQLite, so no native dependency. Earlier Node 24 releases print an experimental warning for it, so the gateway refuses to open a journal below 24.15. The rest of the gateway still runs on any Node 24.

KafkaJS 2.2.4 (its last release, February 2023) is pinned behind that adapter so the client can change without touching the public API. I haven't picked a replacement.

The gateway briefly: an authoritative snapshot from your handler, then full-state updates in revision order; one frame in flight per subscription; an overflowing subscription re-snapshots and a client that stops acknowledging is disconnected; the source never waits for browsers.

Node 24+, tested on 24 and 26. Limits: one gateway per project, no replay of missed updates, Chromium-only browser tests **[update at 1.0]**, managed Kafka unverified.

Has anyone moved a production service off KafkaJS? What did you pick, and what bit you?

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

If you can get a view to say `live` while it's wrong, I want to know: {{MAKE_IT_LIE_LINK}}. The quickest try is "Drop my connection" on the demo's home page.

Repo: https://github.com/jfricano/StreamOtter (details under "Decisions and deviations" in the implementation status). Demo: https://streamotter.dev

---

# Appendix: later, optional (outside the launch plan)

Post these only if you have time after week 2. Each still needs the AI sentence.

## 3. r/typescript — REWRITE IN YOUR OWN WORDS

> **Rule check:** unverified; read the sidebar. Code-forward.

**Title:** Generated types for live, Kafka-backed state channels in the browser (1.0 just shipped; feedback for 1.x welcome)

**Body (reference):**

I built StreamOtter, an open-source (MIT) Node.js gateway and TypeScript browser SDK for live state from Kafka. You declare channels (name, version, parameters, JSON schema) in a config file, write one mapping function per channel on the server, and `streamotter generate` writes the TypeScript types. The browser side:

```ts
import { createClient } from "streamotter/client";
import { channelVersions, type AppChannels } from "../generated/streamotter.generated.js";

const client = createClient<AppChannels>({ origin: "http://localhost:7400", getToken: () => getToken() });
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
job.on("data", ({ data, revision }) => { element.textContent = `${data.state} — ${data.percent}% (revision ${revision})`; });
job.on("state", ({ state }) => { element.dataset["delivery"] = state; }); // "live", or something that may be stale
job.on("error", error => console.warn(`[${error.code}] ${error.message}`));
```

`params` and `data` are typed from the channel's schema. The `state` events are `authorizing`, `synchronizing`, `live`, `stale`, `resync-required` and `failed`. Published types are checked under `strict` with `exactOptionalPropertyTypes`, and `@ts-expect-error` tests confirm the generated types reach the SDK's generics.

Since this is 1.0, existing names now stay put until a new major; I'm collecting what people would want added in 1.x.

Try it without Kafka: `npm install streamotter`, `npx streamotter init .`, `npx streamotter dev --config streamotter.json --handlers server/handlers.mjs`, then `npx streamotter generate --config streamotter.json --out generated`.

Limits: one gateway per project, no replay of missed updates, Chromium-only browser tests **[update at 1.0]**, managed Kafka unverified.

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

Repo: https://github.com/jfricano/StreamOtter · Demo: https://streamotter.dev

---

## 4. r/javascript — REWRITE IN YOUR OWN WORDS

> **Rule check:** self-promotion is OK if it isn't "a majority of your contributions"; include code. No paid products (this is free, MIT). Rankhog, Sept 18, 2026.

**Title:** StreamOtter 1.0: live Kafka-backed views that say "stale" instead of silently showing old data (open source)

**Body (reference):**

I'm the author. The problem I kept hitting: a page shows live data from a backend event stream, the socket drops or the tab falls behind or one bad event arrives, and the page keeps showing numbers that are no longer true, with nothing on screen to say so.

StreamOtter is an open-source (MIT) Node.js gateway and TypeScript browser SDK. You define the state shape and a mapping function; each subscription starts from your app's snapshot, then gets full-state updates in revision order. The SDK reports a state you can render: `live` only once it has caught up, `stale` after a disconnect, restart, overflow or bad record until it has resynchronized. Your own server-side handlers decide access.

```js
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
job.on("data", ({ data, revision }) => render(data, revision));
job.on("state", ({ state }) => { badge.textContent = state; }); // live | stale | resync-required …
```

New in 1.0 for the server side, opt-in: bad Kafka records can be quarantined to a topic with a durable incident and an operator workflow, instead of only pausing (the default).

Four commands, no Kafka needed: `npm init -y`, `npm install streamotter`, `npx streamotter init .`, `npx streamotter dev --config streamotter.json --handlers server/handlers.mjs`, then open the local workbench it prints.

Limits: one gateway per project, no replay (after a gap you get a fresh snapshot), Chromium-only browser tests **[update at 1.0]**, managed Kafka unverified.

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

Live demo: press "Drop my connection" on https://streamotter.dev and watch every view say `stale` until fresh snapshots arrive · Code: https://github.com/jfricano/StreamOtter

---

## 5. r/webdev: Showoff Saturday only — REWRITE IN YOUR OWN WORDS

> **Rule check:** post **only on a Saturday**, with the Showoff Saturday flair if offered; "project, not product." Rankhog, Sept 15, 2026; RedditGrowthDB, July 13, 2026. **Before posting,** open https://streamotter.dev in a browser and confirm the site shows `1.0.0` and the home page's live panel answers. As of October 5 it showed `v0.1.0-rc.3`, and whether its live demo answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering); check in a browser.
>
> **Hosted Lab [confirm at launch]:** the hosted Lab is on at launch (D2). Lease a bench yourself the day you post, and don't promise one: benches are few and queued.

**Title:** [Showoff Saturday] A live demo where you break a Kafka-to-browser pipeline on purpose and watch the page stay honest

**Body (reference):**

I built StreamOtter, an open-source (MIT) Node.js gateway and TypeScript browser SDK for live views backed by Kafka. The part I most wanted to show is the demo, Lontra Creek: a made-up river-otter study whose data flows through real Kafka, a production-mode gateway, and the real SDK.

On the home page, press "Drop my connection": the creek keeps moving without you, and every view says `stale` until you press "Restore it" and fresh snapshots arrive.

In the Failure Lab (https://streamotter.dev/lab/) you borrow an isolated bench for five minutes. There are only a few, so you may wait in a queue for one. On a bench you can:
- **foul a sensor:** the map handler fails on a reading, the source pauses at that record, views go `stale`, and the feed shows where; restore it and the same record is retried, nothing skipped;
- **take out the relay** (the bench's Kafka path): stale, then live again after it's restored;
- **simulate a laptop on a satellite link** that stops acknowledging: that client is disconnected while your view keeps flowing;
- **restart the gateway:** reconnect, fresh snapshot, live;
- **send a garbled reading** (S02): a record that isn't JSON at all is copied byte for byte to a quarantine topic, and the source holds;
- **calibration lookup blip** (S06): a trusted, explicitly transient mapper error gets a bounded retry;
- the rest of the Source failures track (S03–S05).

The whole Lab also runs on your machine: clone the demo's public repo (https://github.com/jfricano/lontra-creek) and run `npm run dev:lab` (Docker, Compose 2.24.4+).

Technical bits: the UI state comes straight from the SDK (`authorizing → synchronizing → live`, or `stale`/`resync-required`); every update is a full state with a revision; the static pages stay up if the demo host is down.

Limits: one gateway per project, no replay of missed updates, Chromium-only browser tests **[update at 1.0]**. The creek is fiction; the pipeline is real.

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

Demo: https://streamotter.dev · Code: https://github.com/jfricano/StreamOtter

> **Note:** S07–S09 are local and CI only; don't describe them as runnable on streamotter.dev.
