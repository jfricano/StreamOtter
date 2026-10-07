> **Where and when:** news.ycombinator.com/submit on launch day (default Tuesday or Wednesday, about 8:00 a.m. ET), only after the go/no-go in [PLAN.md](../PLAN.md) passes.
>
> **Rules:**
> - The title starts with "Show HN," is at most 80 characters, and has no superlatives.
> - Never ask anyone to upvote or comment, and never share the HN link.
> - **HN's guidelines say "Don't post generated text or AI-edited text."** So this file has no paste-ready comment, only facts to write from. Write the comment yourself (T-3, about 45 minutes) and keep it in a local note.
> - The Show HN page also asks for non-trivial work rather than quickly generated one-offs, and asks you to explain how and why you made it. Items 3 and 8 below cover that.

# Show HN

## Title (character counts include "Show HN: ")

1. `Show HN: StreamOtter – Kafka state in the browser, either live or visibly stale` (79). **Decided in PLAN.md.** It's the positioning line and names the source, the destination, and the difference.
2. `Show HN: StreamOtter – Kafka-to-browser state channels for TypeScript apps` (74). The plainest alternative.
3. `Show HN: StreamOtter – a Kafka-to-browser gateway, with a demo you can break` (76). Use this only if you switch the URL to the site.

A plain hyphen can replace the en dash. Recount after any edit.

## URL (decided in PLAN.md)

- Submit `https://github.com/jfricano/StreamOtter`. Show HN is for things people can run. Repo visitors can star and watch, and the README has no capacity limit, while the demo caps at 300 connections and three Lab benches.
- Leave the text field empty. Post your comment within about a minute, with the live demo link in its first lines.

## Your first comment: what to cover, as facts

Aim for 250–400 words in your own voice, with no marketing adjectives. Cover these in order; the questions in brackets are for you to answer.

1. **Who you are:** Jason; you built StreamOtter and maintain it alone; it's MIT.
2. **What it is, in one sentence:**
   - It's an open-source Node.js gateway and TypeScript browser SDK, with a CLI and local workbench, for showing Kafka-backed state in a web app.
   - Every view is either verifiably `live` or visibly `stale`.
   - The live demo is at `[SITE URL]` (https://streamotter.app once it's live and link-checked).
3. **Why it exists:**
   - You were one of the four original authors of KafkaSocks (2021), a small API over KafkaJS consumers and Socket.IO namespaces. StreamOtter is its successor in a new codebase, not a fork.
   - Wiring Kafka to a browser was the easy part. The hard questions came after:
     - After a disconnect, a gateway restart, or a slow client, is the screen still right?
     - Who may see which record?
     - What does one slow tab do to everyone else?
   - You wanted those answered once, with tests, instead of in every app.
   - [Your own moment: a screen you saw quietly showing old data? Why this mattered to you?]
4. **How it works:**
   - Browsers subscribe to named state channels, never to topics.
   - Each subscription starts from an authoritative snapshot that your `snapshot` handler returns, then gets full-state updates ordered by a revision carried in your data.
   - Updates that arrive during the snapshot load are captured and compared by revision. The view is `live` only after it has caught up.
   - A disconnect, source outage, rebalance, or overflow turns the view `stale` until it resynchronizes.
   - Your `authenticate` and `authorize` handlers decide access. Revocation works even while authorization or a snapshot is pending.
   - One frame is in flight per subscription. A client that stops acknowledging is disconnected, and the Kafka source never waits for browsers.
   - Offsets are committed per record. A bad record pauses the source at that record instead of being skipped.
5. **How to try it:**
   - **The demo:** a walkthrough and a Failure Lab, where you break an isolated setup on purpose (a bad record, a cut broker link, a client that stops acknowledging, a gateway restart). The creek and otters are made up; the Kafka, gateway, and SDK are real.
   - **Locally, with no Kafka** (a fixture source stands in). In an empty folder:
     - `npm init -y`
     - `npm install streamotter`
     - `npx streamotter init .`
     - `npx streamotter dev --config streamotter.json --handlers server/handlers.mjs`
6. **What's verified:** the implementation status (link below) lists every suite and what it covers, including:
   - real-Kafka tests against Apache Kafka 4.1.2 over TLS, with SASL PLAIN and SCRAM;
   - browser tests in Chromium;
   - a production-mode deployment behind a TLS proxy.
7. **The limits:**
   - one gateway per project;
   - no replay (after a gap you get a fresh snapshot, not the missed updates);
   - Chromium is the only browser tested automatically;
   - managed Kafka services are unverified;
   - it's [VERSION: "a release candidate of 0.1.0" or "0.1.0"] and pre-1.0, so the API may change.
8. **How you built it:** one or two plain sentences, per the PLAN.md decision:
   - you built it with Claude Code;
   - you set the direction and specification, made the decisions, and reviewed the work;
   - the test suites in the repository, including real Kafka, are how you checked the behavior.

   Don't overstate or understate either side. Expect a follow-up about timing: the public history starts with one commit adding all of V1 on September 24, 2026.
9. **The feedback you want** (in your words):
   - Does the live/stale model match how you'd render state?
   - If you run Kafka, what would stop you from trying this in an existing app?
   - Which Kafka setup should be verified next?

## Facts to keep straight (from the docs, as of `0.1.0-rc.3`)

- **Packages:** `npm install streamotter` installs everything: the command, `streamotter/gateway`, and `streamotter/client`. A frontend deployed separately can use `@streamotter/client`. Never write `@next`.
- **Requirements:** Node.js 24 or later for the gateway and CLI. The SDK targets current evergreen browsers, and Chromium is the only one tested automatically.
- **Delivery states:** `authorizing → synchronizing → live`, plus `stale`, `resync-required`, and `failed`.
- **Kafka:** KafkaJS 2.2.4 behind an internal adapter. Verified against Apache Kafka 4.1.2: TLS with a supplied CA, and TLS with SASL PLAIN, SCRAM-SHA-256, or SCRAM-SHA-512. TLS with the system trust store is implemented but **not verified**. Other versions and managed services are unverified. There's no OAuth, IAM, or mutual TLS. Messages are JSON only.
- **Transport:** Socket.IO 4.8.3, WebSocket only (no long-polling, so no sticky sessions). Socket.IO's own recovery and reconnection are off; StreamOtter's SDK owns reconnection and resynchronization.
- **KafkaSocks:** you're one of its four GitHub contributors and one of the three npm maintainers of `kafka-socks`. The accurate short form is "the successor to KafkaSocks, from one of its original authors."
- **Don't say:**
  - "Kafka in the browser" (the browser never speaks Kafka);
  - exactly-once, guaranteed delivery, or "never miss an update";
  - scalable, production-proven, or "in 5 minutes."
- **Load test:** don't quote its numbers without "single-process loopback, not a capacity claim."
- **Links:**
  - GitHub: https://github.com/jfricano/StreamOtter
  - npm: https://www.npmjs.com/package/streamotter
  - Status: https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md
  - Getting started: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md
  - Write-up: https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81
