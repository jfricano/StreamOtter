<!--
DRAFT, not published. The 1.0 article: the only full article at T-0 (FIX_DECISIONS §3).

Changed since Sept 27: the Sept plan's announcement now describes npm 1.0.0, links streamotter.dev (not .app), adds 1.0's bad-record handling, the OSLabs lineage, and Jason's "state shape plus one mapping function" pitch.
Changed in the Oct 5 fix pass:
- Restructured: problem → a short code taste → "Can you make it lie?" (within the first third) → 1.0 failure handling → short lineage → alternatives by name → limits → try it.
- The break-it section leads with the streamotter.dev home page's "Drop my connection" button (it works today), then two local tiers (no Kafka; real Kafka via lontra-creek `npm run dev:lab`). The hosted Lab is mentioned only "when it's on", behind a marker. No exercise is promised on the hosted site (superseded Oct 7: D2 is no).
- The bad-records and "ten years of bridges" material from the planned reveals 2 and 3 is folded in here, shortened.
- Removed: "A gap that has been open for a decade" heading, b/kafka-websocket as a demand signal (it lives in hn-faq.md's "how is this different" now), "on and off since OSLabs" (KafkaSocks' last commit was June 2021), the full evaluate/redrive command block, "verifiably".
- Added: the AI sentence from ai-disclosure.md (identical, required) plus the drafting line; the alternatives paragraph naming Centrifugo, Zilla, Ably and Lightstreamer; the invitation as the closing.
- Fixed: "stop dev and watch the preview go stale" → Preview's disconnect (accuracy N14); no quarantine exercise is promised on the hosted Lab at launch (accuracy B3; superseded: D2 was answered no on Oct 7, so the hosted Lab runs S01–S06 at launch); one Medium plan (accuracy S5, FIX_DECISIONS §4).
Changed Oct 7 (D2 answered no): hosted Lab with S01–S06 and /blog are launch gates; conditionals removed.

Placeholders: {{PUBLICATION_DATE}} (the 1.0.0 date; none set) · {{MAKE_IT_LIE_LINK}} (the pinned Discussion's URL; Discussions are off today) · {{MAKE_IT_LIE_LOCAL_LINK}} (the published no-Kafka recipe; its source is drafts/make-it-lie-local.md, verified 2026-10-05 on 0.2.0-rc.1 with Node 24.21; the browser view going `stale` was not checked in that run, so this article doesn't claim it) · [jason: …] slots for your own sentences.
Markers: [update at 1.0] = recheck against the 1.0.0 tag and the live site on launch day. [confirm at launch] = check on launch day before publishing.

Where it goes (FIX_DECISIONS §4, one Medium plan; streamotter.dev/blog is a launch gate since D2):
- Publish on streamotter.dev/blog first (canonical), on T-1, after the go/no-go (PUBLIC_LAUNCH.md §4.6). Then, in the evening, edit the existing September Medium story IN PLACE to this text, with the update line "Updated for 1.0.0 on <date>; first published September 26, 2026 for 0.1.0-rc.3." and its canonical link set to the blog post.
- Never a second, duplicate Medium story. dev.to (week 1): import with canonical_url set to the blog post, AI-Assisted tier.
Release gate: describes npm 1.0.0. Don't publish before 1.0.0 is on npm `latest`. Re-check every limit against docs/IMPLEMENTATION_STATUS.md at the 1.0.0 tag.
Code blocks: copied byte for byte from the repo (main at 1c75aaa, Oct 5); the source is in the comment above each. Re-diff them against the 1.0.0 tag.
Body length (excluding comments and code, including bracketed notes): about 2,200 words.
Suggested SEO <title> (<= 60 chars; the H1 is 61): "StreamOtter 1.0: live Kafka state that admits it's stale" (56)
Suggested description (<= 155 chars): "An open-source Node.js gateway and TypeScript SDK for live Kafka state on web pages: each view is live or says it's stale. Try to make it lie." (143)
-->

# StreamOtter 1.0: live Kafka state that admits when it's stale

<!-- Header image: article-1-0-launch.png from the launch visuals in PR #65 (link card: article-1-0-launch-og.png). It shows "1.0": use only once 1.0.0 is out. -->

*{{PUBLICATION_DATE}} · Jason Fricano*

*I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.* *This article was drafted with AI assistance and edited by me.*

<!-- The two italic lines above are required (ai-disclosure.md). Keep them within the first two paragraphs: Medium asks for that. -->

A laptop wakes from sleep and the order page still says "packed" when the parcel shipped an hour ago. A deploy restarts the server, and some of the open tabs quietly stop changing. A dashboard looks connected (the socket is open, the green dot is on) and it's showing yesterday's numbers. Nothing on the page says so.

If your team runs Kafka, this usually starts with a reasonable ticket: *make the order page update live.* The events are already in a topic. You write a consumer, open a socket, add a few lines in the browser, and by the afternoon the demo works. The bug reports come later.

A page that's out of date is normal. A page that's out of date and still *looks* live is a bug your users find before you do.

Today I'm releasing StreamOtter 1.0. It's an open-source (MIT) Node.js gateway, a TypeScript browser SDK, and a CLI with a local workbench, for teams that already have Kafka and need live state in a web app. After a disconnect, a restart, a slow client or a bad record, every view it delivers either catches up and says `live`, or says `stale`. It doesn't stay silently wrong.

## One shape, one mapping function

You define the state shape and one mapping function, and StreamOtter does the heavy lifting.

<!-- Image: illustrations/diagram-core-model.svg from the launch visuals in PR #65 (-dark.svg for dark mode). -->

The state shape is a JSON schema for what a page should see: an order's status, a job's percentage, a dashboard tile. Browsers subscribe to a named, typed **state channel**, never to a raw topic. The mapping function says which channel instance a Kafka record updates, and what its state is now:

<!-- Copied verbatim from docs/guides/existing-app.md, §5 "Write the handlers" (lines 138–142: the map handler, original indentation kept). -->
```ts
      // Which instance does this Kafka record update? Return [] to ignore it.
      map({ record }) {
        const event = record.value as unknown as OrderEvent;
        return [{ tenantId: event.accountId, params: { orderId: event.order.orderId }, revision: String(event.version), data: event.order }];
      }
```

To be precise about "one": your app also answers the questions only it can answer. Who is this user (`authenticate`)? May they see this order (`authorize`)? What is this order's state right now (`snapshot`)? Those are usually short functions that call code you already have.

Each subscription starts from your snapshot, then receives full-state updates in revision order. An update that arrives while the snapshot is loading is held and applied by revision, so the "fetch, then subscribe" race doesn't lose it. A view becomes `live` only once it has caught up. In the browser, that's a subscription and two listeners:

<!-- Copied verbatim from docs/guides/getting-started.md, §7 "Build the page" (lines 118–122: the body of watchJob in web/example.ts). -->
```ts
const client = createClient<AppChannels>({ origin: "http://localhost:7400", getToken: () => getToken() });
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
job.on("data", ({ data, revision }) => { element.textContent = `${data.state} — ${data.percent}% (revision ${revision})`; });
job.on("state", ({ state }) => { element.dataset["delivery"] = state; });
job.on("error", error => console.warn(`[${error.code}] ${error.message}`));
```

The `state` listener is the one that matters. When it says `stale`, the page still has its last data and knows that data may be out of date. You decide what to show: a badge, a greyed-out panel, a "reconnecting" line.

## Can you make it lie?

<!-- Image: the "Drop my connection" GIF (hero-demo-script.md, part A), with gif-caption.png; or make-it-lie.png until the GIF exists. make-it-lie.png points to github.com/jfricano/StreamOtter/issues: if the invitation lives in a Discussion, make sure the two agree. -->

That's the claim, so here's the rule, stated so you can test it. **Make a subscribed view report `live` while it shows something other than the newest state its snapshot and the topic's revisions imply, or get a bad record skipped silently, or get a quarantine copy that isn't byte for byte.** If you manage any of those, I want to know: {{MAKE_IT_LIE_LINK}}. Found-by credit in the changelog if you want it. No bounty. (Load or attacks against the demo server are out of scope; security issues go through `SECURITY.md`.)

Ways to try, from quickest to deepest:

**1. On the home page.** [streamotter.dev](https://streamotter.dev) runs Lontra Creek, a made-up river-otter study whose data moves through real Kafka, a StreamOtter gateway and the browser SDK. Press **Drop my connection**: the creek keeps moving without you, and every view on the panel says `stale`. Press **Restore it**: each view takes a fresh snapshot and comes back `live`, and the panel's log says the revisions in between weren't replayed. [update at 1.0: confirm in a browser that the panel answers and the footer shows 1.0.0.]

**2. On your machine, no Kafka.** The scaffold in "Try it" below uses a fixture source, and a fixture record can carry raw text, decoded exactly like broker bytes:

<!-- Copied verbatim from docs/guides/source-failures.md, §2.5 "Rehearse in development first". -->
```js
export const development = {
  principals: { developer: { subject: "dev", tenantId: "acme", sessionId: "dev", claims: {} } },
  fixtures: { orders: [{ key: "ord_1", value: { /* a good record */ } }, { key: "ord_2", raw: "{not json" }] }
};
```

In the scaffold the source is called `jobs`. Add `{ key: "job_1", raw: "{not json" }` to its fixtures in `server/handlers.mjs`, give `jobs` an `"invalidJson": "quarantine-hold"` policy under `failureHandling.sources` in `streamotter.json` (a fixture source needs no quarantine topic), and advance the fixture one record at a time in the workbench. You need Node.js 24.15 or later for this. When the malformed record arrives, the source pauses ("it will not be committed or skipped"), the incident is quarantine-held with the record kept as local fixture evidence, and further advances deliver nothing. Your challenge from there: get the previewed view to report `live` while it's missing the later revisions, or get that record skipped silently. The exact steps, and what they showed when run, are here: {{MAKE_IT_LIE_LOCAL_LINK}}. [update at 1.0: re-run the recipe on 1.0.0-rc.1 and 1.0.0 before publishing.]

**3. On your machine, real Kafka.** The demo's source is public at [github.com/jfricano/lontra-creek](https://github.com/jfricano/lontra-creek). With Docker and Docker Compose 2.24.4 or later, `npm ci` and then `npm run dev:lab` build and start the whole production stack on your machine: Kafka 4.1.2 over TLS with SCRAM, the gateway, three Failure Lab benches and Caddy, at `https://localhost:8443/lab/`. Foul a gauge's sensor, cut a bench's relay to Kafka, stall a client or restart the gateway, and watch your page. [update at 1.0: the source-failure exercises (for example "Garbled reading: preserve and hold", where a malformed record is quarantined and the source holds) arrive with Lontra Creek #42, merged (6cb47e9); re-pin and deploy pending. Mention them only once you've run them locally on 1.0.0. Confirm whether the local Lab needs a setting to run the quarantine profile.]

[confirm at launch: you leased a hosted bench yourself that day, and the exercise names match the live Lab.] **4. On streamotter.dev's Failure Lab.** You borrow an isolated bench for five minutes and break it on purpose. There are only a few benches, so you may wait in a queue for one. Foul a gauge's sensor and watch the source hold and the page say `stale` until the same record is retried. Or try "Garbled reading: preserve and hold": a record that isn't JSON at all is copied to a quarantine topic, byte for byte, and the source holds. Nothing you do affects anyone else's bench.

I'll reproduce every report. In a week I'll write up what broke: what people find, and what the pre-1.0 reviews found.

## When a record is bad

The first release candidates handled *connections* going wrong. 1.0 also handles *data* going wrong.

In V1, a record the gateway couldn't process stopped its source, and that's still the default: nothing gets skipped silently. But stopping isn't enough by itself. Someone has to find out what happened, keep the evidence, and get the source moving again without guessing. 1.0 adds that, opt-in. A configuration without `failureHandling` behaves exactly as before.

You choose a policy per source, in `streamotter.json`:

<!-- Copied verbatim from docs/guides/source-failures.md, §2.1 "Add failureHandling to streamotter.json". -->
```json
{
  "failureHandling": {
    "quarantine": { "topic": "orders-app.streamotter.quarantine", "capture": "full-record" },
    "sources": {
      "orders": { "invalidJson": "quarantine-hold", "invalidPublicPayload": "quarantine-hold" }
    }
  }
}
```

When a malformed record arrives on `orders`:

<!-- Image: illustrations/diagram-bad-record-flow.svg from the launch visuals in PR #65 (-dark.svg for dark mode). Check that it shows quarantine as opt-in and the default as a plain hold. -->

- **The source holds.** It stops at the record and commits nothing past it. Views on that source turn `stale` and keep their last good data.
- **The record is quarantined.** The original key, value and headers are copied byte for byte to a quarantine topic you provide, and the copy only counts once Kafka acknowledges it. A write that gets no answer is recorded as unknown, never as saved.
- **An incident is journaled** in a local SQLite journal: a stable ID, its failure class, its Kafka position and its history, kept across restarts.
- **An operator decides**, using the CLI over a local socket:

<!-- Copied verbatim from packages/cli/README.md, "Operate a running gateway" (lines 97–102). -->
```bash
npx streamotter status --state-dir /var/lib/streamotter
npx streamotter failures list --state-dir /var/lib/streamotter --state open
npx streamotter failures show --state-dir /var/lib/streamotter --failure <failureId>
npx streamotter sources retry-current --state-dir /var/lib/streamotter --source orders --failure <failureId> --expected-revision 3
```

`failures show` explains the incident and names the next step. If the cause was in your code or schema, fix it and `retry-current`: the same record is processed again, and nothing is skipped. Every action names the revision you looked at, so a decision based on stale information is refused. There's no `--force`, no wildcard and no bulk form.

Some records can never be processed, such as bytes that aren't JSON at all. For those, `quarantine-resync` lets the source move past the record only when *your* application's recovery guard says your snapshots already cover what it would have changed. From then on, every snapshot on that source has to acknowledge that boundary before a view can be `live`. A circuit breaker stops automatic continuation if bad records pile up. For a record the source has already moved past, an operator can evaluate it against the current mapping as a dry run and then redrive it through the normal revision checks; redrive never publishes to Kafka or moves an offset. The whole procedure, including restarts, full disks and expired evidence, is in the [runbook](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md). There are also read-only `/health/live` and `/health/ready` probes and a Failures tab in the development workbench.

What's deliberately missing is *ignore*. For many consumers, skipping a bad message is the right call. For a page that shows the current state of something, a skipped record means a page that's wrong and doesn't know it.

## Where it comes from

<!-- Image: lineage-strip.png from the launch visuals in PR #65 (-dark.png for dark mode), "Kafka to the browser · open-source work along the way". -->

People have wired Kafka to browsers for more than ten years: small WebSocket bridges from the Kafka 0.8 days, and plenty of tutorials (a `@KafkaListener` or a KafkaJS consumer, a STOMP or Socket.IO broadcast, every browser receiving every message). They're good at what they set out to do. They usually stop before the questions that fill the following month: who may see this record, what the page shows after a reconnect, and what happens when one record can't be parsed.

I first worked on this problem at OSLabs in 2021 [confirm: how you'd like to describe OSLabs; its READMEs say "accelerated by OS Labs"], where I co-wrote [KafkaSocks](https://github.com/oslabs-beta/KafkaSocks) with three co-authors [name them only once each has agreed to be named]. It wrapped KafkaJS consumers and Socket.IO namespaces so you didn't have to rebuild that bridge for every project. It did that job; it didn't say what the screen should do when something went wrong. Another OSLabs team, people I knew, built [kafka-penguin](https://github.com/oslabs-beta/kafka-penguin), a KafkaJS library with three error strategies: fail fast, ignore, and a dead-letter queue. StreamOtter's failure handling borrows two of them, adapted for screens: *hold* is close to fail-fast, and *quarantine* close to a dead-letter queue. The adaptation, and any mistakes in it, are mine.

StreamOtter is a new codebase with a different API, not a fork of either. I maintain it on my own, as Orca Solutions; there's no paid product.

## Other ways to do this

Mature options already cover real parts of this problem: [Centrifugo](https://centrifugal.dev), [Zilla](https://www.aklivity.io/zilla-gateway), [Ably](https://ably.com) with its Kafka connector, and [Lightstreamer](https://lightstreamer.com) with its Kafka connector. StreamOtter is narrower: state views with an explicit `live`/`stale` contract, where the snapshot, access and recovery logic are your own TypeScript handlers, plus a local workbench. If you need several nodes, retained history or replay, or a managed service today, one of those is a better fit. [Where to look first](https://github.com/jfricano/StreamOtter/blob/main/docs/RESEARCH.md#4-existing-options-and-the-bar-for-differentiation) [update at 1.0: link `docs/guides/when-to-use.md` instead if it has merged; check the anchor].

## What it doesn't do (yet)

The limits are written down: one gateway per project; no replay of missed updates (a reconnecting view gets a fresh snapshot of the current state, which is what a status page needs and not what an activity feed needs); JSON state over Socket.IO only; managed Kafka services are unverified (verified: Apache Kafka 4.1.2 with TLS and SASL PLAIN or SCRAM); KafkaJS 2.2.4 is pinned behind an internal adapter; and browser automation covers [update at 1.0 from IMPLEMENTATION_STATUS: "Chromium only", or "Chromium, Firefox and WebKit" if the gate run passes]. 1.0 is a promise about the API (every public operation keeps working until a new major version), not a claim of maturity or adoption. What's verified, how, and what isn't is in the [implementation status](https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md).

## Try it

You don't need Kafka to start: the scaffold uses a built-in fixture source. You need Node.js 24 or later (24.15 or later for the failure-handling journal). In a new folder:

<!-- Copied verbatim from README.md, "Try it in five minutes" (lines 37–40; heading not reused, because the guardrails avoid timing promises). -->
```bash
npm init -y
npm install streamotter
npx streamotter init .
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs
```

Open the workbench URL that `dev` prints, paste its one-time token, preview the `jobProgress` channel, and advance the fixture to watch revisions arrive. Then use Preview's disconnect and watch it go `stale`, then return to `live` after a fresh snapshot. [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md) continues to a real page in your browser, and [Add live state to an existing app](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md) covers your own sessions, database and topics.

## What's next

All **planned, not shipped**:

- **V1.x:** a migration guide for KafkaSocks users, configuration polish and compatibility fixes.
- **V2, "Recover and scale"** (planned as npm 1.1 onward): a second channel mode for event feeds, with retained history and resume within a configured window; then multiple gateways; then Schema Registry and Avro, React hooks and generated AsyncAPI docs.

The order can change, and I'll only call something shipped once it's on npm with its tests.

If you can get a view to say `live` while it's wrong, I want to know: {{MAKE_IT_LIE_LINK}}. Issues are open on [GitHub](https://github.com/jfricano/StreamOtter). [jason: one closing sentence of your own.]

<!--
Editor's checklist (delete before publishing):
- Code blocks: six, copied verbatim (sources above each). Re-diff against the 1.0.0 tag.
- The AI sentence must match drafts/ai-disclosure.md word for word.
- Avoided by design: "Kafka in the browser", "scalable", "production-proven", "exactly-once", "in 5 minutes", "verifiably", hype adjectives, star or user counts.
- The hosted Lab paragraph names only exercises from S01–S06 and never promises a bench (benches are queued). Confirm on launch day that you leased one yourself. S07–S09 are local and CI only.
- lontra-creek repo checked public on 2026-10-05 (README read from raw.githubusercontent.com; `npm run dev:lab` and the Compose 2.24.4 requirement are in its README and docs/LOCAL_LAB.md). Lontra Creek #42 was a draft on Oct 5; it has since merged (6cb47e9), with the re-pin and deploy pending.
- Home-page control labels ("Drop my connection", "Restore it") are from the lontra-creek LiveCreek component and the live page, Oct 5. Whether the live panel answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering); check in a browser.
- The alternatives paragraph follows docs/RESEARCH.md §4: no feature claims about them beyond "cover real parts of this problem".
- "More than ten years" of Kafka-to-browser bridges: b/kafka-websocket's copyright line is 2014 and its build targets Kafka 0.8.2. It isn't named here (hn-faq.md uses it for "how is this different").
- Every [confirm] is also in the kit summary.
-->
