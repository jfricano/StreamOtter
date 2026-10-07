> **Changed since Sept 27:** version is `1.0.0` (after `1.0.0-rc.1`) with 1.0's compatibility promise; website `https://streamotter.dev`; 1.0's source-failure handling, an "Origins" section and the 1.x roadmap are in; logo guidance follows `docs/assets/README.md`.
>
> **Changed in the Oct 5 fix pass:** the press kit is **for the site, not the README**: it's the source for a press page on streamotter.dev and for anyone who asks (FIX_DECISIONS §12, accuracy S18). The bare "Built with Claude Code" is replaced by the AI sentence from `ai-disclosure.md`. **No hosted workbench claim** (S19). The Lab paragraph and Lab screenshots are conditional on the hosted Lab being on (D2), and quarantine is never shown as a hosted exercise (B3, S11, S12). "Kafka state in the browser" and "verifiably" are gone (N19); quarantine is labeled opt-in. The b/kafka-websocket star count is out of "Origins", which now uses the brand framing ("Kafka to the browser · open-source work along the way", "OSLabs", no "each built on the last"). The launch visuals are listed.
>
> **Changed Oct 7 (D2 answered no):** hosted Lab with S01–S06 and /blog are launch gates; conditionals removed.
>
> **Placeholders in this file:** `{{LAUNCH_DATE}}` (the 1.0.0 release and launch date; none set) · `{{RC1_DATE}}` (when `1.0.0-rc.1` is published, planned for T-14; `1.0.0` at T-5, D3) · `{{MAINTAINER_BIO}}` (2–3 sentences only you can write) · `{{CONTACT}}` (your preferred press contact, or "open an issue on GitHub")

> **Where and when:** optional (PUBLIC_LAUNCH.md); the source for a press page on streamotter.dev (not the README or release notes) and for anyone who asks for "a paragraph about it." Publish it only after `1.0.0` is on npm, once every placeholder and **[update at 1.0]** marker is resolved. During the quiet `1.0.0-rc.1` period, don't publish it. **Rules:** every statement must match `docs/IMPLEMENTATION_STATUS.md` for `1.0.0`; no adoption, performance or capacity numbers; plans stay labeled as plans.

# StreamOtter press kit

## One-liner

Live Kafka state for web pages: every view is either live or says it's stale.

## Headline

Live state from Kafka to the browser. Never silently wrong.

## In the maintainer's words

You define the state shape and one mapping function, and StreamOtter does the heavy lifting.

*(Accuracy note for anyone quoting this: a channel also has a snapshot handler and an access check, which are usually code the application already has.)*

## Short description (about 30 words)

StreamOtter is an open-source Node.js gateway and TypeScript SDK that brings Kafka-backed state to web pages. Every view is either live or visibly stale, and bad records are held, never silently skipped.

## Boilerplate (about 140 words)

StreamOtter is an open-source (MIT) Node.js gateway, TypeScript browser SDK and CLI for teams that run Kafka and need live views in web applications. Browsers subscribe to application-defined state channels rather than raw topics. Each view starts from the application's authoritative snapshot, then receives full-state updates in revision order, and after a disconnect, a restart or a slow client it either catches up and is `live`, or is visibly `stale`. The application's own handlers decide who sees what. A record the gateway can't process holds its source rather than being skipped; since 1.0, opt-in failure handling can also open a durable incident for it, copy it to a quarantine topic, and continue past it only when the application proves its data already covers it. A local workbench previews channels, traces each record's path and lists failures. StreamOtter runs as one gateway per project. It was created and is maintained by Jason Fricano of Orca Solutions.

## Origins: Kafka to the browser · open-source work along the way

Image: `lineage-strip.png` from the launch visuals in PR #65 (also `-dark`, `-square`).

- **OSLabs and KafkaSocks.** Jason co-wrote KafkaSocks (2021) at OSLabs, an open-source tech accelerator: a small KafkaJS-to-Socket.IO library (verified: one of its four GitHub contributors and one of the three npm maintainers of `kafka-socks`). StreamOtter is its successor, from one of its original authors, in a new codebase with a different API.
- **kafka-penguin.** Another OSLabs project, a KafkaJS library documenting three error strategies: FailFast, Ignore and Dead Letter Queue. Its strategies inspired StreamOtter's failure handling: quarantine follows the dead-letter idea and hold the fail-fast idea, while StreamOtter adds the browser side, a recovery guard, an incident journal and operator tools (retry, reassess, and redrive for records already moved past), and deliberately offers no silent skip. It's an inspiration, not a dependency.
- **Earlier bridges.** People have wired Kafka to browsers for more than ten years, for example `b/kafka-websocket`, a small open-source Java bridge built against Kafka 0.8.2 that sends topic messages to WebSocket clients. StreamOtter aims at what comes after the first demo: access, ordering, recovery and bad records.

## About the maintainer

`{{MAINTAINER_BIO}}` — in your words, for example: your role or background; that you co-wrote KafkaSocks at OSLabs; that you maintain StreamOtter on your own. Then the AI sentence from `ai-disclosure.md`, word for word: "I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code." Optional: https://github.com/jfricano.

## Key links

| | |
| --- | --- |
| Website and live demo | https://streamotter.dev |
| Source code | https://github.com/jfricano/StreamOtter |
| Install | `npm install streamotter` · https://www.npmjs.com/package/streamotter |
| Getting started | https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md |
| Handle bad records (runbook) | https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md |
| What's verified, and the limits | https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md |
| Changelog | https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md |
| Earlier announcement (September soft launch) | https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81 |
| Security reports | GitHub private vulnerability reporting (see SECURITY.md in the repository) |
| Contact | `{{CONTACT}}` |

## Fact sheet

| | |
| --- | --- |
| Current version | `1.0.0`, released `{{LAUNCH_DATE}}` after `1.0.0-rc.1` (`{{RC1_DATE}}`). From 1.0.0, every public operation keeps working until a new major version (roadmap §8). |
| Earlier releases | `0.1.0-rc.1` to `rc.3` (V1, September 25, 2026); `0.2.0-rc.1` (V1 plus source-failure handling and two review-and-fix milestones, October 2026) |
| License | MIT, © 2026 Orca Solutions |
| Maintainer | Jason Fricano (GitHub `jfricano`), solo. In his words: "I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code." |
| Packages | `streamotter` (everything in one install), `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli`, `@streamotter/contracts`, `@streamotter/workbench`, released together with one version, with npm provenance |
| Runtime | Node.js 24 or later for the gateway and CLI (24.15 or later where the failure-handling journal runs); current evergreen browsers for the SDK |
| Built on | KafkaJS 2.2.4 (pinned behind an internal adapter); Socket.IO 4.8.3, WebSocket only; Node's built-in SQLite for the incident journal |
| Kafka verified | Apache Kafka 4.1.2: TLS with a supplied CA; TLS with SASL PLAIN, SCRAM-SHA-256, SCRAM-SHA-512; quarantine durability on a local three-broker cluster |
| Tested | Acceptance scenarios, real-Kafka tests, a declared-workload resource test, browser tests in Chromium **[update at 1.0: Firefox and WebKit]**, a production-mode deployment behind a TLS-terminating proxy **[update at 1.0: with failure handling on]**, and install tests from packed tarballs and from the npm registry. CI runs on Node 24 and 26. Details and commands: implementation status. |
| Predecessor | KafkaSocks (2021, OSLabs) |

## What it does (1.0)

- **State channels:** named, versioned, parameterized. The browser never names a Kafka topic.
- **Explicit delivery states:** `authorizing → synchronizing → live`, with `stale`, `resync-required` and `failed`.
- **Application-owned access:** `authenticate`, `authorize`, `map` and `snapshot` handlers; revocation works even while authorization or a snapshot is pending.
- **Bounded delivery:** one frame in flight per subscription; per-subscription, per-connection and gateway-wide budgets; a subscription that overflows its budget re-snapshots, a client that stops acknowledging is disconnected, and the source never waits for browsers.
- **Kafka progress:** explicit per-record commits; a bad record pauses the source without being skipped; rebalances and outages trigger resynchronization.
- **Source-failure handling (opt-in):**
  - a durable incident for every bad record, in a local journal that survives restarts;
  - `quarantine-hold`: invalid JSON or schema-failing records are copied byte for byte to a quarantine topic, and the source holds;
  - `quarantine-resync`: the source continues only when the application's recovery guard approves, and every later snapshot must acknowledge the recovery boundary before a view is `live`; a circuit breaker stops automatic continuation;
  - operator commands (CLI and in-process API), each checked against the revision the operator saw: inspect and export incidents; retry or reassess a held record; and evaluate and redrive a record the source already moved past (redrive delivers through the normal revision filter and never publishes to Kafka);
  - a Failures tab in the local workbench (development);
  - optional `/health/live` and `/health/ready` probes.
- **Diagnosis:** staged connection checks and a payload-free trace of each record's path, in a local workbench.

## Limits (state these whenever the product is described at length)

- one gateway per project (no multi-gateway operation);
- no durable replay or history (a fresh snapshot after a gap), and no durable revocation store;
- Chromium is the only automatically tested browser **[update at 1.0]**;
- Kafka is verified only against Apache Kafka 4.1.2; managed Kafka services, other versions and TLS with the system trust store are unverified; a broker with ACLs enabled is untested **[update at 1.0]**;
- JSON payloads only (no Schema Registry, Avro or Protobuf), and no OAuth, IAM or mutual TLS to Kafka;
- failure handling: the journal is local to one host and needs Node.js 24.15 or later; it stops accepting writes at 256 MiB (no pruning command yet), keeping the source held; the operator socket isn't available on Windows; no tests yet for network partitions, disk loss or managed Kafka;
- KafkaJS 2.2.4 is pinned (its last release, February 2023).

## What's next (plans, not commitments or dates)

The roadmap maps future milestones to 1.x minor versions: V2.0 retained, resumable event feeds (planned as 1.1.0); V2.1 multiple gateways (1.2.0); V2.2 Schema Registry/Avro and React hooks (1.3.0); V3 authorized commands and team workflows later. See https://github.com/jfricano/StreamOtter/blob/main/docs/API_AND_FEATURE_ROADMAP.md. Nothing there is shipped.

## The live demo: Lontra Creek

A fictional river-otter study (the creek, the field station, its people and its otters are made up) whose data moves through real Kafka, a production-mode StreamOtter gateway installed from npm at an exact version, and the browser SDK.
- A guided walkthrough shows a subscription going live, a dropped connection turning views stale, a denied request and an identity switch.
- The home page's live panel has a "Drop my connection" button: every view says `stale` until "Restore it" brings fresh snapshots and `live` again. It works per visitor, with no bench.
- The Failure Lab lends each visitor an isolated bench for five minutes to break on purpose: a cut Kafka link, a client that stops acknowledging, a gateway restart, and six source-failure exercises, from a fouled sensor to a garbled reading copied to quarantine. Three more source-failure exercises run only locally and in CI. Benches are few, so visitors may wait in a queue for one. **[confirm at launch: you leased a bench yourself that day.]**
- The same demo runs locally on real Kafka from its public repo, https://github.com/jfricano/lontra-creek (`npm run dev:lab`, with Docker and Compose 2.24.4 or later), including three Lab benches. **[update at 1.0]** Its quarantine exercises (for example "Garbled reading: preserve and hold") arrive with Lontra Creek #42, merged (6cb47e9); re-pin and deploy pending; describe them once you've run them locally on 1.0.0.
- Also on the site: a config playground, a workbench page (the hosted sandbox is off unless Jason approves it), "When it breaks," and release notes.

[CONFIRM against the live site before publishing. On October 5, https://streamotter.dev was up but showed `v0.1.0-rc.3`, and whether its live demo answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering); check in a browser.]

## Logo and images

The usage guide is [`docs/assets/README.md`](https://github.com/jfricano/StreamOtter/blob/main/docs/assets/README.md). Link to files by absolute GitHub raw or site URLs.

**The brandmark** (flat vectors, each with a `-dark` version) goes in the READMEs and on the npm pages, and wherever the logo is small or repeated.

| File | Use | Minimum size |
| --- | --- | --- |
| `streamotter-lockup-horizontal.svg` | The default signature: headers, slide corners, wide link cards | 120 px wide |
| `streamotter-lockup-stacked.svg` | Footers, title cards, square spaces | 96 px wide |
| `streamotter-readme-lockup.svg`, `.png` | The tight stacked lockup used in the READMEs and on npm | 240 px wide |
| `streamotter-mark.svg` | The symbol alone, when the name is beside it: avatars, stickers | 24 px tall |
| `streamotter-wordmark.svg` | The name alone, rarely | 80 px wide |
| `streamotter-app-icon.svg`, `-512.png` | App and touch icons | 32 px |
| `streamotter-favicon.svg` | Browser tabs, 16–48 px | 16 px |
| `lontra-creek/apps/site/public/social-preview.png` | The site's 1200×630 link card (in the site project) | — |

**The detailed logo** (an otter swimming through a stream of code; raster only) goes where there's room for an illustration: articles and title slides. Keep it at least 240 px wide.

| File | Size | Use |
| --- | --- | --- |
| `docs/assets/streamotter-logo.png` | 800×455, white background | Light backgrounds |
| `docs/assets/streamotter-logo-dark.png` | 1397×791, transparent | Dark backgrounds |
| `docs/assets/streamotter-logo-full.png` | 1536×1024, white background | Article headers, title slides |

Leave clear space around every lockup equal to the height of the wordmark's "O", and a quarter of the mark's height around the mark alone. Don't recolor, redraw, stretch or crop any logo, and don't set "StreamOtter" in a font in place of the wordmark. `logo-brand-mark.svg`, `name-brand-mark.svg` and `streamotter-brand-mark-spread.png` are source files, not for publishing.

**Colors:** ink `#04183F`, azure `#048DFC`, splash `#04BDFD`, otter brown `#7F5447`, cream `#EBE6DF`, and light ink `#E9F2FC` (ink's replacement on dark backgrounds). Azure and splash are fills, not text colors, on light backgrounds; for blue text there, use `#0369C9`.

## Launch visuals (final)

In StreamOtter PR #65 (launch visuals): `og-card.png` / `og-card-light.png` (link cards), `article-1-0-launch.png` (shows "1.0"; only once `1.0.0` is out), `lineage-strip.png`, `make-it-lie.png`, `linkedin-post.png`, and the diagrams in `illustrations/` (`diagram-core-model`, `diagram-bad-record-flow`, `live-vs-stale`, each `.svg` with a `-dark` variant). For a press page, the core-model diagram and live-vs-stale are the most useful.

## Screenshots (captured from production at T-7, once the site runs 1.0.0; the owner approves)

| # | Shot | Caption and alt text |
| --- | --- | --- |
| 1 | Home page hero with a live subscription | "A live view on real Kafka: the state badge reads live." |
| 2 | The same view after "Drop my connection" | "The connection dropped: the view keeps its last data and says stale." |
| 3 | Failure Lab, "Fouled sensor," with the gateway feed (hosted, labeled "hosted"; if no bench is free, from a local Lab, labeled "local stack") | "A bad record pauses the source; the feed shows the map handler failing at that record." |
| 4 | Failure Lab, "Laptop on a satellite link" (same rule as 3) | "A client that stops acknowledging is disconnected; the visitor's view keeps flowing." |
| 5 | **[update at 1.0]** Failure Lab source-failures track, "Garbled reading" with its incident panel (same rule as 3); Lontra Creek #42 is merged (6cb47e9), re-pin and deploy pending | "A garbled reading is copied to quarantine and the source holds; the incident records what happened." |
| 6 | Workbench Failures tab (local `streamotter dev` with `failureHandling`) | "The local workbench lists each incident with its evidence, quarantine, position and recovery kept apart." |
| 7 | Workbench Preview and Inspect | "The local workbench previews a channel and traces each record (validate, map, queue, commit) and each frame (send, receipt)." |
| 8 | Terminal: `streamotter failures show` | "The operator CLI explains one incident and its supported next action." |
| 9 | README first screen on GitHub | "Install, try it without Kafka, and the limits, on one screen." |

Label any animation or video as a recording. The V1.1 preview screenshots (not in this repo) are previews of an undeployed build; don't publish them as screenshots of the live site.
