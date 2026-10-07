> **Where and when:** separate text posts, one subreddit at a time, after launch day. Two are core (r/apachekafka, r/node) and three are optional (see [PLAN.md](../PLAN.md)).
>
> **Rules:**
> - Read each sidebar and the pinned posts first. reddit.com couldn't be loaded during research; the rules here come from third-party trackers (see the launch brief).
> - Disclose that you wrote it. Never post the same text twice, never ask for upvotes, and reply to comments in the first few hours.
> - **These are reference drafts. Rewrite each one in your own words before posting:** many subreddits remove or downvote AI-written posts, and your own voice is what earns replies.

# Reddit variants

**Order:**
1. r/apachekafka (T+2 or T+3, core)
2. r/node (week 2, core)
3. r/typescript (week 2–3, optional)
4. r/javascript (week 3, optional)
5. r/webdev, on a Saturday only (optional)

Post Tuesday–Thursday mornings US time (a heuristic), except r/webdev.

**Standard wording:**
- **What it is:** "an open-source (MIT) Node.js gateway and TypeScript browser SDK."
- **Limits:** "one gateway per project; no replay of missed updates (a fresh snapshot instead); Chromium is the only browser tested automatically; managed Kafka services are unverified; pre-1.0."

Links used below:
- GitHub: https://github.com/jfricano/StreamOtter
- demo: [SITE URL]
- Kafka guide: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/kafka.md
- status: https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md

---

## 1. r/apachekafka

> **Rule check:** unverified. Look for a rule on tools and vendor posts, and for a flair (for example "Tool" or "Question"). This is a question-led post from the author, not an announcement.

**Title:** I built an open-source gateway that turns Kafka topics into live browser views. I'd like critique of its consumer semantics.

**Body:**

I'm the author of StreamOtter, an open-source (MIT) Node.js gateway and TypeScript browser SDK. The gateway consumes your topics, and browsers subscribe to application-level "state channels," never to topics. Your own server-side handlers decide who can see what, and each view starts from your app's snapshot. I'd like people who run Kafka to poke holes in the consumer side before the API settles.

How it consumes:

- One dedicated consumer group per configured source, never one per browser.
- Auto-commit is off. The offset for a record is committed only after it has been validated, mapped, and admitted to (or explicitly invalidated for) every interested subscription. A commit never waits for browsers, and it's never treated as proof that a browser got the data.
- Several things pause the source at that record: invalid JSON, a tombstone, an oversized record, a map handler that throws, or a conflicting revision. Nothing at or after it is committed, and nothing is skipped. After the fix, it resumes from that same record. V1 doesn't route bad records to a dead-letter topic; it stops and waits for a fix. Because a tombstone pauses the source too, deletions have to be explicit state.
- Rebalances and broker outages don't patch over the gap. Affected browser views go `stale`, then resynchronize from a fresh snapshot. Outage detection is based on missing fetch and heartbeat activity (a 12-second window).
- Each update carries a revision from your data, so records redelivered after a crash are harmless: a view never accepts an older revision than it has shown.
- The docs are blunt about one thing: if a change is committed to your database but never published, the gateway can't know. They recommend an outbox.

Verified against Apache Kafka 4.1.2 (single-node KRaft) with KafkaJS 2.2.4: TLS with a supplied CA, and SASL PLAIN and SCRAM-SHA-256/512. Not verified: other broker versions, managed services, and TLS with the system trust store. Other limits: one gateway per project, no replay of missed updates (a fresh snapshot instead), Chromium is the only browser tested automatically, and it's pre-1.0.

Questions for people here:
1. Would per-record commits be a problem at your topic rates? (Throughput against high-rate topics isn't measured.)
2. Pause-on-bad-record instead of a dead-letter topic: acceptable, or a dealbreaker?
3. Which managed Kafka should I verify first?

Code: https://github.com/jfricano/StreamOtter. The Kafka guide covers topic shape, commits, and crash behavior. The live demo has a "fouled sensor" scenario where you trigger the poison-record pause yourself: [SITE URL]

---

## 2. r/node

> **Rule check:** no subreddit-specific rules were displayed as of Sept 18, 2026 (Rankhog). The community welcomes technical problems and lessons, not ads. Lead with the lesson.

**Title:** Two things I had to work around in KafkaJS 2.2.4 while building a Kafka-to-browser gateway in Node

**Body:**

I've been building StreamOtter, an open-source (MIT) Node.js gateway that feeds live, access-checked state from Kafka into web pages over Socket.IO. KafkaJS 2.2.4 is pinned behind an internal adapter. Two of its behaviors were worth writing up, in case they bite you too:

1. **A 1 ms timer per connection.** KafkaJS's request queue can schedule a negative timeout, which Node clamps to 1 ms, so every open broker connection spins a 1 ms timer. On Node 24+ you'll also see `TimeoutNegativeWarning`. A version-guarded replacement of that one method inside the adapter took an idle gateway from 2.6% to 0.3% of a core on my machine.
2. **A connection left open after `disconnect()`.** After reconnecting through a broker restart, KafkaJS could leave a socket open after `disconnect()`. The adapter now supplies its own socket factory, tracks sockets, and closes any survivors on stop, so KafkaJS's own error path tears the connection down.

Both workarounds are guarded to the pinned version and documented as things to revisit if the Kafka client changes.

The gateway itself, briefly:
- browsers get an authoritative snapshot from your handler, then full-state updates in revision order;
- one frame is in flight per subscription;
- slow clients are disconnected instead of buffering without bound;
- the Kafka source never waits for browsers.

Node 24+, tested on Node 24 and 26. Limits: one gateway per project, no replay of missed updates (a fresh snapshot instead), Chromium is the only browser tested automatically, managed Kafka is unverified, and it's pre-1.0.

Has anyone else run into either of these with KafkaJS, or moved off it? I'm curious what people are using for Kafka in Node now.

Repo: https://github.com/jfricano/StreamOtter (the details are under "Decisions and deviations" in the implementation status). Demo: [SITE URL]

---

## 3. r/typescript

> **Rule check:** unverified; read the sidebar. Code-forward, and ask for API feedback.

**Title:** Generated types for live, Kafka-backed state channels in the browser. Looking for feedback on the SDK's API before 1.0.

**Body:**

I built StreamOtter, an open-source (MIT) Node.js gateway and TypeScript browser SDK for showing live state from Kafka in web apps. You declare channels (name, version, parameters, JSON schema) in a config file, and `streamotter generate` writes the TypeScript types for them. The browser side then looks like this:

```ts
import { createClient } from "streamotter/client";
import { channelVersions, type AppChannels } from "../generated/streamotter.generated.js";

const client = createClient<AppChannels>({ origin: "http://localhost:7400", getToken: () => getToken() });
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
job.on("data", ({ data, revision }) => { element.textContent = `${data.state} — ${data.percent}% (revision ${revision})`; });
job.on("state", ({ state }) => { element.dataset["delivery"] = state; }); // "live", or something that may be stale
job.on("error", error => console.warn(`[${error.code}] ${error.message}`));
```

`params` and `data` are typed from the channel's schema, and the `state` events are the delivery states: `authorizing`, `synchronizing`, `live`, `stale`, `resync-required`, `failed`. The published types are checked under `strict` with `exactOptionalPropertyTypes`, and `@ts-expect-error` tests confirm that the generated channel types reach the SDK's generics.

To try it without Kafka: `npm install streamotter`, `npx streamotter init .`, `npx streamotter dev --config streamotter.json --handlers server/handlers.mjs`, then `npx streamotter generate --config streamotter.json --out generated`.

Limits: one gateway per project, no replay of missed updates, Chromium is the only browser tested automatically, and managed Kafka is unverified. It's pre-1.0, so this is the moment to change names. What would you change about the API shape: event names, how channel versions are passed, error codes, anything?

Repo: https://github.com/jfricano/StreamOtter · Live demo: [SITE URL]

---

## 4. r/javascript

> **Rule check:** self-promotion is OK if it isn't "a majority of your contributions"; "Where's the Javascript?" means include code. No paid products (this is free, MIT). Rankhog, Sept 18, 2026.

**Title:** StreamOtter: live Kafka-backed views in the browser that say "stale" instead of silently showing old data (open source)

**Body:**

I'm the author. The problem I kept hitting: a page shows live data from a backend event stream, the socket drops or the tab falls behind, and the page keeps showing numbers that are no longer true, with nothing on screen to say so.

StreamOtter is an open-source (MIT) Node.js gateway and TypeScript browser SDK. Each subscription starts from an authoritative snapshot, then gets full-state updates in revision order. The SDK reports an explicit state you can render: `live` only once it has caught up, `stale` after a disconnect, restart, or overflow until it has resynchronized. Access is decided by your own server-side handlers.

```js
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
job.on("data", ({ data, revision }) => render(data, revision));
job.on("state", ({ state }) => { badge.textContent = state; }); // live | stale | resync-required …
```

The four-command quickstart needs no Kafka (a fixture source stands in): `npm init -y`, `npm install streamotter`, `npx streamotter init .`, `npx streamotter dev --config streamotter.json --handlers server/handlers.mjs`. Then open the local workbench it prints.

Limits: one gateway per project, no replay (after a gap you get a fresh snapshot), Chromium is the only browser tested automatically, managed Kafka services are unverified, and it's pre-1.0.

There's also a live demo where you can break things on purpose (drop your connection, feed it a bad record, stall a client): [SITE URL]. Code: https://github.com/jfricano/StreamOtter

---

## 5. r/webdev: Showoff Saturday only

> **Rule check:** post **only on a Saturday**, with the Showoff Saturday flair if offered. Focus on technical details, "project, not product." Rankhog, Sept 15, 2026; RedditGrowthDB, July 13, 2026. **Before posting,** confirm that the four Failure Lab scenarios below shipped as described; the relay cut was the one mechanism not yet prototyped as of Sept 26.

**Title:** [Showoff Saturday] A live demo where you break a Kafka-to-browser pipeline on purpose and watch the page stay honest

**Body:**

I built StreamOtter, an open-source (MIT) Node.js gateway and TypeScript browser SDK for live views backed by Kafka. The part I most wanted to show is the demo, Lontra Creek: a made-up river-otter study whose data flows through real Kafka, a production-mode gateway, and the real SDK.

In its Failure Lab you get your own isolated setup for five minutes (a separate development-mode gateway, so you can read its trace) and can:
- **foul a sensor:** the map handler throws on a reading, the source pauses at that record, views go `stale`, and the trace shows where it failed; after restoring it, the same record is processed and nothing is skipped;
- **cut the relay** between the gateway and Kafka: stale, then live again after it's restored;
- **simulate a laptop on a satellite link** that stops acknowledging: that client is disconnected while your view keeps flowing;
- **restart the gateway:** reconnect, fresh snapshot, live.

Technical bits:
- The UI state comes straight from the SDK: `authorizing → synchronizing → live`, or `stale` or `resync-required`.
- Every update is a full state with a revision, so the client can always tell whether it's current.
- The site's static pages are separate from the demo host, so the pages stay up if the demo is down.

Limits: one gateway per project, no replay of missed updates, Chromium is the only browser tested automatically, and it's pre-1.0. The creek is fiction; the pipeline is real.

Demo: [SITE URL] · Code: https://github.com/jfricano/StreamOtter
