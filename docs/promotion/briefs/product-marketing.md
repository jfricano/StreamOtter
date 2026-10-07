# Product marketing brief: StreamOtter

September 27, 2026 · Research brief for the promotion plan · Draft for synthesis

> **Note (September 27):** the decisions in [PLAN.md](../PLAN.md) supersede this brief's recommendations where they differ. Corrections are marked **[Correction]** in place.

Scope: audience, positioning, alternatives, objections, discoverability metadata, and metrics. Proof points come only from `docs/IMPLEMENTATION_STATUS.md`, `README.md`, `CHANGELOG.md`, and `docs/guides/`. External facts were checked on 2026-09-27 and are linked. "Unverified" means I couldn't confirm it.

## Recommendations ranked by impact per owner-hour

| # | What | Why | Owner time | Prepared in advance | Timing |
| --- | --- | --- | --- | --- | --- |
| 1 | Fix the live Medium article: the `zsession.accountId` typo, and replace "[DEMO URL, added at launch]" with the getting-started link until the demo is live. **[Correction]** Also add a one-sentence AI-assistance disclosure in the first two paragraphs: Medium's AI policy asks for one and limits distribution of undisclosed AI-assisted stories (per 2024 reports; the help page blocked fetching). | It's the only published launch asset. A sample that doesn't run undercuts a product whose whole promise is trust. | 10 min | Corrected code block and replacement sentence (hand-off: PR/Content own the article) | Now |
| 2 | Fix the GitHub front door: description, homepage URL, topics, social preview image (§5) | Traffic API shows 0 views in the last 14 days, and every future link lands here. There's no custom social card yet (`usesCustomOpenGraphImage: false`). | 15 min in repo settings (owner-only) | Exact text, a topic list, and a 1280×640 PNG made from the existing logo | Now, before launch |
| 3 | Adopt one message kit (the one-liner, pitches, and vocabulary in §2) in the README intro, npm descriptions, site hero, and launch posts | The README currently opens with the mission line, which names neither Kafka nor the browser. That's the text Google and link cards show. | 30 min review | Diffs for the README intro and package descriptions (package metadata ships with the next release) | Before launch |
| 4 | "Is StreamOtter right for you?" page: fit checklist plus the §3 comparison table, linked from the README and the site's `/docs` | Qualifies visitors, answers the predictable "how is this different from X?" comment, and states where StreamOtter is the wrong choice | 30–45 min review | Full draft (hand-off: the content and SEO brief owns placement) | Before launch |
| 5 | Objection answer bank (§4) for launch-week replies | The owner will have a few hours. Fast, accurate, consistent replies matter most in the first day. | 15 min review | Reply-ready answers with links (hand-off: the community and launch communications briefs) | Launch week |
| 6 | Weekly metrics snapshot (§6) | GitHub traffic data disappears after 14 days, so without snapshots there's no record of what the launch did | 5 min/week | A read-only script plus a local, untracked CSV in `docs/promotion/` | Start before launch |
| 7 | Optional: remove two stated limits before the main push. Add Firefox and WebKit to the Playwright suite, and verify one managed Kafka service (system-trust TLS). | These are the most likely technical objections from segments A and C (§4). Each turns an "untested" into a verified line. | Review only for browsers. The managed-Kafka check needs an account the owner creates. | The engineering and the status-doc updates | Before launch if possible; otherwise ongoing |
| 8 | Align npm keywords and descriptions (§5) | Low impact, because npm search ranking is dominated by popularity, but free | 0 extra (rides the next release) | Manifest edits | Next release |

## 1. Who needs it most

**Fit filter (V1).** Kafka is already in production. The UI shows the *current state* of entities (status, progress, dashboard tiles), not a feed. The team can publish full JSON state per entity, keyed by entity, with a revision that only increases (or can add an outbox topic that does). A Node 24 process and one gateway are acceptable. ([Kafka guide: what your topic needs to look like](../../guides/kafka.md))

Search queries below are my inference, not keyword-volume data. Stack Overflow tag counts were retrieved from the Stack Exchange API on 2026-09-27: [apache-kafka] 33,198, [socket.io] 20,510, [kafkajs] 213.

| Rank | Segment | Acuity / reach | Trigger moment | What they search or ask | Where they spend time | What convinces them |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | TypeScript/JS app developer at a company already on Kafka | High / high | A ticket: "make the order page update live," or "replace the 5-second polling on the ops dashboard." The events are already in Kafka. | "stream kafka to react," "kafkajs socket.io," "consume kafka in browser," "kafka websocket node" | Stack Overflow ([apache-kafka], [kafkajs], [socket.io]); r/node, r/reactjs, r/typescript, r/apachekafka; dev.to; Google | Four commands to a live preview with no Kafka (fixture source). The [existing-app guide](../../guides/existing-app.md) maps directly onto their sessions, database, and topics. Typed channels. The Failure Lab once it's live. |
| **B** | A team that already built the DIY bridge (KafkaJS or Confluent's client plus Socket.IO, ws, or SSE) and is now seeing symptoms | Highest / low: they search symptoms, not tools | A bug report: "dashboard showed old status after the laptop woke." Updates lost between fetch and subscribe. Memory climbing with slow clients. A security review asks what happens when access is revoked mid-session. | "socket.io missed messages after reconnect," "connection state recovery not working," "snapshot then subscribe race condition," "kafka websocket multiple servers" | Socket.IO GitHub discussions (for example [#5423](https://github.com/socketio/socket.io/discussions/5423)), Stack Overflow, r/node, r/apachekafka, HN threads about realtime | An explainer on the snapshot/update race. The state model (`authorizing → synchronizing → live`, `stale`, `resync-required`). The acceptance-scenario table. A migration story: keep the topic, replace the bridge. Honest cost: a full-state topic with revisions. |
| **C** | Platform/streaming engineer who owns Kafka and fields "can the frontend read this topic?" | Medium / medium | The second or third app team asks for browser access, or security rejects exposing REST Proxy or broker credentials | "expose kafka to frontend securely," "kafka browser access control" | [Confluent Community forum](https://forum.confluent.io/) (its Slack was [at capacity](https://developer.confluent.io/community/ask-the-community/)), r/apachekafka, LinkedIn data-streaming circles | Credentials stay server-side. Channels are approved, not raw topics. One consumer group per source, never one per browser. Config is reviewable in git. TLS plus SASL PLAIN/SCRAM verified. Staged diagnostics. Payload-free logs. ([production guide](../../DEPLOYMENT.md)) |
| **D** | KafkaSocks users and the OSLabs/Codesmith network; learners building Kafka + React portfolio projects | Low / high | Starting a Kafka + React project | "kafkasocks," "kafka react project" | [KafkaSocks repo](https://github.com/oslabs-beta/Kafkasocks) (113 stars, last push 2022-01-05), bootcamp alumni networks | Continuity with KafkaSocks and a friendly first run. Likely a source of stars and first contributors more than production users. |

**Not the target now:** teams without Kafka, chat or presence or collaborative editing, activity feeds that need replay, mobile push, and teams that need multi-node HA today.

## 2. Positioning

**Positioning statement.** For TypeScript teams that already run Kafka and need live views in a web app, StreamOtter is an open-source Node.js gateway, browser SDK, and CLI that turns Kafka records into *state channels*. Each view starts from the application's authoritative snapshot, receives full-state updates in revision order, and is always either verifiably `live` or visibly `stale`. Compared with a hand-built KafkaJS + Socket.IO bridge, it ships the snapshot race handling, access checks, slow-client bounds, and diagnostics as tested behavior, with its limits stated up front.

**One-liners**
1. **Kafka state in the browser that's either live or visibly stale, never silently wrong.** ← pick
2. Live views from Kafka you can still trust after the first disconnect.
3. The Kafka-to-browser bridge, with the failure cases built in.
4. State channels for Kafka: a snapshot, ordered updates, and an honest live/stale flag.

Why #1: it names the source and the destination (search terms), states the differentiator, and matches the README and npm copy that already exist. When "never silently wrong" stands alone, scope it as the README does: after a disconnect, a restart, or a slow client. The view is only as correct as the application's snapshot and revisions.

**25 words.** StreamOtter is an open-source Node.js gateway and TypeScript SDK that brings Kafka state to the browser. Every view is verifiably live or visibly stale, never silently wrong.

**50 words.** Getting Kafka events onto a web page is easy to demo and hard to trust. StreamOtter is an MIT-licensed Node.js gateway, browser SDK, and CLI with a local workbench. Browsers subscribe to state channels: an authoritative snapshot, then full-state updates in revision order. Every view is verifiably live or visibly stale.

**100 words.** Getting Kafka events onto a web page is easy to demo and hard to trust. After a disconnect, a restart, or a slow client, is the screen still right? StreamOtter is an MIT-licensed Node.js gateway, TypeScript browser SDK, and CLI with a local workbench. Browsers subscribe to state channels, not topics. Each view gets your app's authoritative snapshot, then full-state updates in revision order, and is always verifiably `live` or visibly `stale`. Your own handlers decide who sees what, including revocation. Try it without Kafka using a fixture source. It's a release candidate: one gateway per project, no replay.

**Message pillars and proof points** (all from `docs/IMPLEMENTATION_STATUS.md` unless noted)

| Pillar | Proof |
| --- | --- |
| **1. Honest state, not just a connection.** Snapshot plus revision ordering. `live` only after synchronization; `stale` or `resync-required` otherwise. | Acceptance scenarios 1–3: exact timeline `snapshot:1, update:2, update:3, live`; an update that arrives during the snapshot load is handled; overflow invalidates the epoch. Browser test: an update committed during the snapshot load appears after the snapshot and before `live`. Reconnect goes stale → fresh snapshot → live. Proxied deployment: after `SIGTERM` the page shows *Reconnecting*, and a restarted gateway returns it to live (about 2.5 s, measured locally). Real Kafka: broker stopped → `stale` after 13.0 s; live within 4.2 s of the broker restart (one machine). |
| **2. Your app stays in charge of access.** `authenticate`, `authorize`, `map`, and `snapshot` are your code, and Kafka credentials never reach the browser. | Scenario 4 (12 access tests): cross-tenant routing, expired tokens, and revocation while authorize, snapshot, or authenticate is pending all fail closed. Browser: a same-ID order in another tenant never appears, and a denial carries no data. Deployment: a wrong `Origin` gets `FORBIDDEN`, and the public origin has no management routes. Traces omit credentials and payloads (scenario 8). |
| **3. Bounded, and understandable when it breaks.** | Staged connection checks (resolve → connect → TLS → authenticate → metadata). Per-record trace (validate → map → queue → send → receipt → commit). Poison records pause without skipping (real Kafka `02-poison`). A stalled client is disconnected without blocking others or the source (scenario 5). The declared workload committed 600 records in 22–26 ms without waiting for stalled clients (a single-process loopback measurement, not a capacity claim). Workbench: Connect, Define, Preview, Inspect, Export. |

**Vocabulary to use consistently:** state channel · channel instance (chosen by its parameters, scoped by tenant) · authoritative snapshot · revision · full-state update · delivery states `authorizing`, `synchronizing`, `live`, `stale`, `resync-required`, `failed` (in code font) · handlers (`authenticate`, `authorize`, `map`, `snapshot`) · principal · gateway · workbench · fixture source · release candidate.

**Avoid:** "Kafka in the browser" (the browser never speaks Kafka); "real-time" as the headline (fine as a keyword); "exactly-once," "guaranteed delivery," "never miss an update" (intermediate revisions are intentionally not replayed); "scalable," "production-proven," "battle-tested," "enterprise-grade," "blazing fast"; "sync engine" (it signals local-first Postgres tools); "event streaming to the browser" (it implies feeds and replay); "replaces Socket.IO" (it runs on Socket.IO); "in 5 minutes" as a promise until a timed walkthrough is recorded ("four commands, no Kafka" is verifiable).

## 3. Alternatives landscape

| Option (verified today) | What it is | Choose it when | Choose StreamOtter when |
| --- | --- | --- | --- |
| **DIY bridge**: [KafkaJS](https://www.npmjs.com/package/kafkajs) (latest 2.2.4, released 2023-02-27; about 4.09M downloads/week), [Confluent's JS client](https://www.confluent.io/blog/introducing-confluent-kafka-javascript/) (GA; 1.10.1 on 2026-09-10), or [@platformatic/kafka](https://github.com/platformatic/kafka), plus Socket.IO, ws, or SSE | Full control. Socket.IO's default delivery is [at most once](https://socket.io/docs/v4/delivery-guarantees/), and [connection state recovery](https://socket.io/docs/v4/connection-state-recovery) must be enabled, can fail, and isn't supported by the Redis Pub/Sub adapter | Tiny scope, a feed where dropped messages are acceptable, a non-Node stack, or a need for bidirectional messaging | You need snapshot/update race handling, per-user access with revocation, slow-client bounds, and diagnostics without writing them |
| **[Confluent REST Proxy](https://docs.confluent.io/platform/current/kafka-rest/index.html)** | An HTTP interface for producing and consuming. Consumers are stateful and tied to a proxy instance. | A server-side service that can't use a native client needs HTTP access | End-user browsers need per-user access and a state view |
| **[Zilla](https://github.com/aklivity/zilla)** (Aklivity) | A JVM gateway configured with `zilla.yaml`. Exposes Kafka over HTTP, SSE, gRPC, MQTT, and WebSocket. Aklivity Community License. Zilla 2.0 adds MCP. | Multi-protocol or IoT needs, declarative config, no Node, a stateless edge | You want access and snapshot logic as TypeScript handlers in your app, a typed SDK, and a local workbench |
| **[ksqlDB push queries](https://docs.confluent.io/platform/current/ksqldb/developer-guide/ksqldb-reference/select-push-query.html)** | Chunked HTTP subscriptions. Not shared: each client's query runs separately. Confluent Cloud limits push queries to 100. Not listed on Confluent's [deprecations page](https://docs.confluent.io/platform/current/deprecations.html); Confluent's stream-SQL emphasis is now Flink ([CP 8.2](https://www.confluent.io/blog/introducing-confluent-platform-8-2/)). | You already run ksqlDB and have a handful of internal clients | Many end users with per-user access |
| **[Ably](https://ably.com/docs/platform/integrations/inbound/kafka-connector)** plus its Kafka Connect sink | Managed pub/sub. The connector maps topics or keys to channels. Missed messages are recovered for disconnections under 2 minutes; [history and rewind](https://ably.com/docs/storage-history/history) cover longer gaps. | You need managed global operations, mobile SDKs, presence, or message history now, and have budget | You want self-hosting, MIT licensing, and your own database snapshot as the source of truth |
| **[Pusher Channels](https://pusher.com/channels/)** | Managed pub/sub. I found no official Kafka connector (unverified that none exists). | You're already on Pusher and volumes are low | As with Ably |
| **[Centrifugo](https://centrifugal.dev/docs/server/consumers)** | Go, Apache-2.0, 10.8k stars. A built-in Kafka consumer (API-command or publication-data mode), channel history and recovery, multi-node. | You need multiple nodes, history or recovery, presence, or a language-agnostic backend | You're a TypeScript team that wants snapshot handlers, typed channels, and the workbench in one Node process |
| **[Lightstreamer Kafka Connector](https://github.com/Lightstreamer/Lightstreamer-kafka-connector)** | Java, Apache-2.0, last-mile streaming to web and mobile | Large fan-out, mobile, enterprise support | A small TypeScript-first integration |
| **[Redpanda Connect](https://docs.redpanda.com/connect/components/outputs/http_server.md) `http_server` output** | Streams messages over `stream_path` or `ws_path` | An internal debug stream | You need end-user access and state semantics |
| **[Supabase Realtime](https://supabase.com/docs/guides/realtime)**, **[Electric](https://github.com/electric-sql/electric)** | Postgres-centric: Broadcast, Presence, Postgres Changes; Electric syncs Postgres "shapes" over HTTP. Neither mentions Kafka. | Your data is in Postgres and there's no Kafka | Kafka already carries the changes |
| **Polling, or SSE from your API** | The simplest path | Seconds of staleness are fine | Kafka already has the changes and the UI must say when it's stale |

Not alternatives, but they compete for the same searches: Kafka admin UIs such as [Kafbat UI](https://github.com/kafbat/kafka-ui) and [Redpanda Console](https://github.com/redpanda-data/console). They're for operators browsing topics, not for app users. Say so in the copy.

**StreamOtter is the wrong choice when:** there's no Kafka in production (V1's `start` refuses a fixture source); you need event replay or history; you need multi-node or HA now; you're building chat, presence, or collaborative editing; you need native mobile SDKs; topics are Avro or Protobuf behind Schema Registry, or deltas, or CDC with tombstones (V1 is JSON only, and a tombstone pauses the source); auth is OAuth, mTLS, or MSK IAM (V1 supports only TLS with optional SASL PLAIN or SCRAM, per `V1_API.md`); or the browser needs to send commands to Kafka.

## 4. Objections and honest answers

| Objection | Answer |
| --- | --- |
| "It's a release candidate." | True. It's pre-1.0, and the API may change before 0.1.0; breaking changes will be listed in the changelog. What exists is verified and published: 114 unit and integration tests, 20 real-Kafka, 13 browser, 4 deployment, and 20 install checks, with CI on Node 24 and 26. Pin an exact version. |
| "One gateway is a single point of failure." | By design for V1. Run one process under supervision. After a restart, clients reconnect and resynchronize from your snapshots (verified behind a proxy). If you need multiple nodes today, Centrifugo, Ably, or Lightstreamer fit better. Multiple gateways are V2 direction, not a promise. |
| "Our backend isn't Node." | The gateway is a separate Node 24 process. Its handlers can call your service over HTTP, as the [reference example's Kafka handlers](https://github.com/jfricano/StreamOtter/blob/main/examples/order-dashboard/src/server/kafka-handlers.ts) do. You still operate a Node process. |
| "Why not just Socket.IO?" | StreamOtter runs on Socket.IO. Socket.IO's own docs say default delivery is at most once and that recovery can fail, so the app must resynchronize ([docs](https://socket.io/docs/v4/delivery-guarantees/)). StreamOtter is that resynchronization, plus access checks, backpressure budgets, and Kafka commit handling. |
| "Do I need Kafka to try it?" | No. `init` scaffolds a fixture source, and the workbench advances it. You do need Kafka for production in V1. |
| "KafkaJS hasn't released since February 2023." | Correct ([npm](https://www.npmjs.com/package/kafkajs)). V1 pins 2.2.4 behind an internal adapter, and two KafkaJS defects are worked around there (documented in the status doc). Confluent's GA JS client exists. Only say a client switch is planned if the owner decides to plan one. |
| "Does it work with Confluent Cloud, MSK, Aiven, or Redpanda?" | Unverified. Verified: Apache Kafka 4.1.2 with TLS (supplied CA) and SASL PLAIN or SCRAM. System-trust TLS, which managed services typically need, is implemented but unverified. MSK IAM and OAuth aren't supported. |
| "Our topics carry deltas, Avro, or CDC events." | V1 needs JSON with the full state and a revision per change, and no tombstones. The usual answer is an outbox topic ([guide](../../guides/existing-app.md)). |
| "Firefox or Safari?" | Only Chromium is tested automatically; others are untested, not known to be broken. See recommendation 7. |
| "Benchmarks?" | There's one declared workload, measured on a single machine over loopback. It isn't a capacity claim, and we won't make one. |
| "Solo maintainer?" | Yes, and said openly. MIT license, public CI, documented limits, and a changelog. |
| "Does it replay what I missed?" | No. It resynchronizes to the current state. For status views that's the point; for feeds, choose something with history. |

## 5. Discoverability metadata (recommendations; nothing edited)

**Current (verified with `gh` and the npm registry on 2026-09-27).** The description is "Kafka-to-browser state channels: authoritative snapshots, revision-ordered updates, explicit live/stale states, and application-owned access." There are 8 topics: kafka, live-data, nodejs, realtime, socket-io, state-synchronization, typescript, websocket. The homepage is the npm *org* page. There's no custom social image. Discussions are off, and the community profile is at 71% (no code of conduct, no issue templates). In npm search, StreamOtter isn't in the top 20 for "kafka websocket," "kafka realtime," or "kafka frontend"; ranking is popularity-weighted, so keywords are a weak lever and the GitHub and Google text matters more.

- **Description:** "Kafka state in the browser that's verifiably live or visibly stale. Node.js gateway, TypeScript SDK, and CLI with a local workbench: authoritative snapshots, revision-ordered updates, and your own access handlers. MIT."
- **Homepage:** `https://www.npmjs.com/package/streamotter` now, then `https://streamotter.app` at launch.
- **Topics (18 of 20):** keep the 8, and add apache-kafka, kafkajs, real-time, websockets, live-updates, realtime-dashboard, react (the client README has a React hook pattern), developer-tools, sdk, event-driven. Skip kafka-websocket (0 repositories use it).
- **Social preview:** 1280×640, logo plus one-liner #1.
- **README intro (owner's call; not edited here):** make the first sentence the Kafka-to-browser line and move the mission line below it.
- **npm keywords (next release):** give all six packages a shared core (`streamotter, kafka, apache-kafka, websocket, socket.io, realtime, real-time, live-data, live-updates, state-sync, typescript`), then per-package extras: client `browser, react, sdk`; gateway `kafkajs, nodejs, gateway`; cli `cli, codegen, workbench`; workbench `developer-tools`; contracts `json-schema`. Don't add `sse` or `server-sent-events`, because V1 doesn't use them.

## 6. Honest success metrics

Free sources: `gh api` for stars, forks, watchers, issues, 14-day traffic, referrers, and popular paths; `api.npmjs.org` for weekly downloads of `streamotter` and `@streamotter/client` (the client alone suggests a separately deployed frontend); GitHub "Used by"/dependents; and, if the site team agrees, [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/about/) (free, cookieless) on streamotter.app. The site plan doesn't include analytics yet.

**Baseline caveat:** npm recorded 108 downloads of `streamotter` and 351 of `@streamotter/client`, all on the publish day (2026-09-25) and none on the 24th or 26th. That's the owner's registry tests and mirrors, not users. Downloads also spike on every release, so compare weeks without a release. Never quote counts as adoption.

**Goals, not predictions (no baseline exists):**
- The signal that matters most: people the owner doesn't know report running it (issues, discussions, dependents). Goal: 3 by day 90.
- The first issue that mentions a real broker or managed service (a fit signal). Goal: by day 60.
- Stars: 25 by day 30 and 75 by day 90. This is a visibility signal only.
- A rising `streamotter` download trend over four weeks without a release, by day 90.
- A getting-started guide view in GitHub's popular paths every week after launch.

## 7. What to avoid, and open questions

**Avoid:** the claims listed in §2; unqualified timings (always say "measured locally"); "works with any Kafka" or "any browser"; `@next`; placeholder links; promoting in KafkaJS #1753 or Socket.IO #5423 (answer only when directly helpful, and disclose authorship); "V2 is coming"; leading with the otter fiction before the problem; chasing non-Kafka audiences, who bring support load for a poor fit.

**Hand-offs:** the community brief gets the answer bank, community rules, Discussions and issue templates, awesome-list PRs ([conduktor/awesome-kafka](https://github.com/conduktor/awesome-kafka), active; [awesome-websockets](https://github.com/facundofarias/awesome-websockets)), and KafkaSocks outreach. The content and SEO brief gets the fit/comparison page and segment B symptom articles ("the snapshot-then-subscribe race," "why a reconnect isn't a resync"). The launch communications brief gets the Medium fix, the Show HN title from one-liner #1, and the pitches. The Lontra Creek project gets the same hero line, a limits box on `/releases`, and analytics.

**Open questions**
1. Should the main push wait for streamotter.app and the Failure Lab, the strongest proof? My view: yes. Do items 1–4 now.
2. Will the owner spend review time on recommendation 7 before launch? It turns the two likeliest "untested" objections into verified lines.
3. Is the owner a KafkaSocks contributor, and would they ask OSLabs for a "successor" link? That's an owner-only action. *(Answered: yes. The owner is one of its four GitHub contributors and one of three `kafka-socks` npm maintainers; see PLAN.md.)*
4. Should `0.1.0` final ship before the push? Dropping "rc" doesn't change the pre-1.0 status or the stated limits.
5. Is there a public stance on the KafkaJS dependency (an adapter change) that the owner is willing to commit to? If not, say nothing about plans.
