> **Where and when:** optional (see [PLAN.md](../PLAN.md)); the source for a press or media page (for example a site page or a section of the repository) and for anyone who asks for "a paragraph about it." Publish it only after launch, once every `[PLACEHOLDER]` is filled. **Rules:** every statement must match `docs/IMPLEMENTATION_STATUS.md` for the version named; no adoption, performance, or capacity numbers; plans stay labeled as plans.

# StreamOtter press kit

## One-liner

Kafka state in the browser that's either live or visibly stale, never silently wrong.

## Headline

Live state from Kafka to the browser. Never silently wrong.

## Short description (about 25 words)

StreamOtter is an open-source Node.js gateway and TypeScript SDK that brings Kafka state to the browser. Every view is verifiably live or visibly stale, never silently wrong.

## Boilerplate (about 110 words)

StreamOtter is an open-source (MIT) Node.js gateway, TypeScript browser SDK, and CLI for teams that run Kafka and need live views in web applications. Browsers subscribe to application-defined state channels rather than raw topics. Each view starts from the application's authoritative snapshot, then receives full-state updates in revision order, and is always either verifiably `live` or visibly `stale`, including after a disconnect, a restart, or a slow client. The application's own handlers decide who sees what. A local workbench previews channels and traces each record's path. StreamOtter is pre-1.0 and runs as one gateway per project. It was created and is maintained by Jason Fricano of Orca Solutions.

## About the maintainer

[OWNER: 2–3 sentences, in your words. For example:
- your role or background;
- that you were one of the original authors of KafkaSocks (2021), StreamOtter's predecessor (verified: one of its four GitHub contributors and one of the three npm maintainers of `kafka-socks`);
- that you maintain StreamOtter on your own.

Optional: a link to your GitHub profile, https://github.com/jfricano.]

## Key links

| | |
| --- | --- |
| Website and live demo | [SITE URL] |
| Source code | https://github.com/jfricano/StreamOtter |
| Install | `npm install streamotter` · https://www.npmjs.com/package/streamotter |
| Getting started | https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md |
| What's verified, and the limits | https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md |
| Changelog | https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md |
| Announcement article | https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81 |
| Security reports | GitHub private vulnerability reporting (see SECURITY.md in the repository) |
| Contact | [OWNER: preferred contact, or "open an issue on GitHub"] |

## Fact sheet

| | |
| --- | --- |
| Current version | [VERSION: `0.1.0-rc.3` or `0.1.0`], pre-1.0 (the API may change before 1.0; breaking changes are listed in the changelog) |
| License | MIT, © 2026 Orca Solutions |
| Maintainer | Jason Fricano (GitHub `jfricano`), solo |
| Packages | `streamotter` (everything in one install), `@streamotter/client`, `@streamotter/gateway`, `@streamotter/cli`, `@streamotter/contracts`, `@streamotter/workbench`, released together with one version |
| Runtime | Node.js 24 or later for the gateway and CLI; current evergreen browsers for the SDK |
| Built on | KafkaJS 2.2.4 (behind an internal adapter); Socket.IO 4.8.3, WebSocket only |
| Kafka verified | Apache Kafka 4.1.2: TLS with a supplied CA; TLS with SASL PLAIN, SCRAM-SHA-256, SCRAM-SHA-512 |
| Tested | Acceptance scenarios, real-Kafka tests, a declared-workload resource test, browser tests in Chromium, a production-mode deployment behind a TLS-terminating proxy, and an install test of the packed packages. CI runs on Node 24 and 26. Details and commands: implementation status. |
| Predecessor | KafkaSocks (2021), a small API over KafkaJS consumers and Socket.IO namespaces. StreamOtter is its successor, from one of its original authors, in a new codebase with a different API. |

## What it does (V1)

- **State channels:** named, versioned, parameterized. The browser never names a Kafka topic.
- **Explicit delivery states:** `authorizing → synchronizing → live`, with `stale`, `resync-required`, and `failed`.
- **Application-owned access:** `authenticate`, `authorize`, `map`, and `snapshot` handlers; revocation works even while authorization or a snapshot is pending.
- **Bounded delivery:** one frame in flight per subscription; per-subscription, per-connection, and gateway-wide budgets; slow clients are disconnected, and the source never waits for browsers.
- **Kafka progress:** explicit per-record commits; bad records pause the source without being skipped; rebalances and outages trigger resynchronization.
- **Diagnosis:** staged connection checks and a payload-free trace of each record's path, in a local workbench.

## Limits (state these whenever the product is described at length)

- one gateway per project (no multi-gateway operation);
- no durable replay or history, and no durable revocation store;
- no production health endpoint;
- Chromium is the only automatically tested browser;
- Kafka is verified only against Apache Kafka 4.1.2; managed Kafka services and TLS with the system trust store are unverified;
- JSON payloads only (no Schema Registry, Avro, or Protobuf), and no OAuth, IAM, or mutual TLS to Kafka.

## What's next (plans, not commitments or dates)

The roadmap's V2 direction is retained, resumable event feeds and multiple gateways; V3 is authorized commands and team workflows. See https://github.com/jfricano/StreamOtter/blob/main/docs/API_AND_FEATURE_ROADMAP.md. Nothing there is shipped.

## The live demo: Lontra Creek

A fictional river-otter study (the creek, the field station, its people, and its otters are made up) whose data moves through real Kafka, a production-mode StreamOtter gateway installed from npm, and the browser SDK.
- A guided walkthrough shows a subscription going live, a dropped connection turning views stale, a denied request, an identity switch, and a write flowing back through Kafka.
- The Failure Lab gives each visitor an isolated setup for five minutes to break on purpose: a bad record, a cut broker connection, a client that stops acknowledging, and a gateway restart.

[CONFIRM against the shipped site before publishing.]

## Logo and images

The full usage guide is [`docs/assets/README.md`](https://github.com/jfricano/StreamOtter/blob/main/docs/assets/README.md). Link to the files by absolute GitHub raw or site URLs.

**The detailed logo** (an otter swimming through a stream of code; raster only) goes where there's room for an illustration: articles, title slides, and the README and npm pages. Keep it at least 240 px wide.

| File | Size | Use |
| --- | --- | --- |
| `docs/assets/streamotter-logo.png` | 800×455, white background | Light backgrounds; the README and npm pages |
| `docs/assets/streamotter-logo-dark.png` | 1397×791, transparent | Dark backgrounds |
| `docs/assets/streamotter-logo-full.png` | 1536×1024, white background | Large uses: article headers, title slides |

**The brandmark** (flat vectors, each with a `-dark` version for dark backgrounds) goes wherever the logo is small or repeated.

| File | Use | Minimum size |
| --- | --- | --- |
| `streamotter-lockup-horizontal.svg` | The default signature: headers, slide corners, wide link cards | 120 px wide |
| `streamotter-lockup-stacked.svg` | Centered and formal uses: footers, title cards, square spaces | 96 px wide |
| `streamotter-mark.svg` | The symbol alone, when the name is already beside it: avatars, stickers | 24 px tall |
| `streamotter-wordmark.svg` | The name alone, rarely | 80 px wide |
| `streamotter-app-icon.svg`, `-512.png` | App and touch icons | 32 px |
| `streamotter-favicon.svg` | Browser tabs, 16–48 px | 16 px |
| `lontra-creek/apps/site/public/social-preview.png` | The site's 1200×630 link card (in the site project) | — |

Leave clear space around every lockup equal to the height of the wordmark's "O", and a quarter of the mark's height around the mark alone. Don't recolor, redraw, stretch, or crop any logo, and don't set "StreamOtter" in a font in place of the wordmark. `logo-brand-mark.svg`, `name-brand-mark.svg`, and `streamotter-brand-mark-spread.png` are source files, not for publishing.

**Colors:** ink `#04183F`, azure `#048DFC`, splash `#04BDFD`, otter brown `#7F5447`, cream `#EBE6DF`, and light ink `#E9F2FC` (ink's replacement on dark backgrounds). Azure and splash are fills, not text colors, on light backgrounds; for blue text there, use `#0369C9`.

## Screenshots (captured from production at T-7; the owner approves)

| # | Shot | Caption and alt text |
| --- | --- | --- |
| 1 | Home page hero with a live subscription | "A live view on real Kafka: the state badge reads live." |
| 2 | The same view after "Drop my connection" | "The connection dropped: the view keeps its last data and says stale." |
| 3 | Failure Lab, "Fouled sensor," with the trace | "A bad record pauses the source; the trace shows map failing with HANDLER_FAILED." |
| 4 | Failure Lab, "Laptop on a satellite link" | "A client that stops acknowledging is disconnected; the visitor's view keeps flowing." |
| 5 | Workbench Preview and Inspect | "The local workbench previews a channel and traces each record: validate, map, queue, send, receipt, commit." |
| 6 | Terminal: the `npx streamotter dev` banner | "The development gateway prints the gateway, workbench, and a one-time token." |
| 7 | The `watchJob` integration code | "The whole browser integration for one live job view." |
| 8 | README first screen on GitHub | "Install, try it without Kafka, and the limits, on one screen." |

Label any animation or video as a recording.
