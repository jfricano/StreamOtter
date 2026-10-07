> **Changed since Sept 27:** launch version is npm `1.0.0` (after a quiet `1.0.0-rc.1`), so "pre-1.0, the API may change" is gone and 1.0's compatibility promise replaces it. Domain is `streamotter.dev`. 1.0's bad-record handling, the OSLabs lineage and Jason's "state shape plus one mapping function" pitch are in.
>
> **Changed in the Oct 5 fix pass:** the comment outline is cut from 10 points to **5**, with **"Can you make it lie?" as point 2** (FIX_DECISIONS §2). Architecture, failure-class detail and test tiers moved to `hn-faq.md` for replies. The AI sentence from `ai-disclosure.md` is a **must-say** (point 3), with the "if they were AI agents" hedge removed (FACTS confirms they were). b/kafka-websocket is out of the comment (it's an `hn-faq.md` answer to "how is this different", not a demand signal). Added a **Plan B** if your HN account can't submit (D8). The demo-status, capacity and cross-reference lines are corrected (accuracy S11, S13, S14, N11). Titles are inputs; you write the final one.
>
> **Placeholders in this file:** `{{LAUNCH_DATE}}` (no date set) · `{{YOUR_MOMENT}}` (your own story; only you can write it) · `{{MAKE_IT_LIE_LINK}}` (the pinned Discussion's URL) · `{{MAKE_IT_LIE_LOCAL_LINK}}` (the published no-Kafka recipe, from `drafts/make-it-lie-local.md`)
>
> **Markers:** **[update at 1.0]** means the 1.0 gate (an ACL-enabled broker, Firefox and WebKit, the proxy deployment with failure handling on, one integrator walking the runbook) or the release itself may change the line. Recheck at T-7. **[HOSTED LAB]** means keep only if the hosted Lab is on (D2 in PUBLIC_LAUNCH.md) and you leased a bench yourself that morning.

> **Where and when:** news.ycombinator.com/submit on `{{LAUNCH_DATE}}` (a Tuesday or Wednesday, about 8:00 a.m. ET), only after the go/no-go in PUBLIC_LAUNCH.md passes **and `1.0.0` is on npm `latest`.** Never submit on `1.0.0-rc.1`: you get one real Show HN, and a version bump doesn't qualify for a second.
>
> **Rules:**
> - The title starts with "Show HN", is at most 80 characters, and has no superlatives. **You write the final title.** The ones below are inputs.
> - Never ask anyone to upvote or comment, and never share the HN link.
> - **HN's guidelines say "Don't post generated text or AI-edited text"** (In Comments) and "Please don't put generated text in HN posts" (rechecked October 5, 2026). So this file has **no paste-ready comment**, only points to write from. Write the comment yourself (about 200–300 words; T-3 or earlier, about 45 minutes) and keep it in a local note.
> - The Show HN page says "Don't post quickly-generated one-offs; anybody can do that now," "The project should be non-trivial," and "Explain how and why." Points 2 and 3 answer that with evidence, and `hn-faq.md` has the speed question.

# Show HN

## Before anything else: can your account submit? (2 minutes, do it now)

HN has been blocking Show HN submissions from some accounts, reported for new ones ("your account isn't able to submit"); the moderators don't say what qualifies. Check today, logged in, at news.ycombinator.com/submit, and note your username, karma and account age privately (PUBLIC_LAUNCH.md §11 keeps only the checklist item). If it's thin, take part in ordinary threads in your own words between now and launch.

**Plan B (D8 in PUBLIC_LAUNCH.md), decided at T-7:** if the account can't submit by T-7 (or you're unsure and hn@ycombinator.com hasn't answered); the T-1 go/no-go can still trigger it.
- **T-0 Tue, 8:00 ET becomes r/apachekafka** (`reddit.md` variant 1, rewritten in your words, leading with the bad-record question and the break-it recipes). LinkedIn at noon as planned, newsletters at T+1, r/node moved up to T+2 (PUBLIC_LAUNCH.md §4.5).
- **Show HN later**, once the account qualifies, as the project's first and only Show HN, with whatever "Making it lie" turned up. Never repost.
- You can ask hn@ycombinator.com whether your account can submit. **Never have a friend or anyone else submit it for you**, and don't post the repo as an ordinary link to get around the block.

## Title (character counts include "Show HN: ")

Inputs, not a decision:

1. `Show HN: StreamOtter – live Kafka state for web pages that says when it's stale` (79). **Suggested.** It names the source, the destination and the difference, and it can't be misread as "the browser talks to Kafka".
2. `Show HN: StreamOtter – Kafka state in the browser, either live or visibly stale` (79). The Sept plan's pick. It isn't the banned phrase "Kafka in the browser", but a truncated preview or a fast reader can see it that way. Use it only if you prefer it knowing that.
3. `Show HN: StreamOtter – Kafka-to-browser state channels for TypeScript apps` (74). The plainest.
4. `Show HN: StreamOtter – a Kafka-to-browser gateway, with a demo you can break` (76). Only if you switch the URL to the site.

No version number in the title. A plain hyphen can replace the en dash; recount after any edit.

## URL (Sept decision; unchanged)

- Submit `https://github.com/jfricano/StreamOtter`. The README has no capacity limit. The hosted demo is set to 300 gateway connections, and, if the hosted Lab is on (D2), three Lab benches at the contract defaults (confirm both at T-7).
- Leave the text field empty. Post your comment within about a minute, with `https://streamotter.dev` in its first lines.

## Your first comment: five points, as facts

About 200–300 words, your own voice, no marketing adjectives. In this order.

1. **Who you are, what it is, why.**
   - Jason; you built StreamOtter and maintain it alone; MIT; this is `1.0.0`.
   - One or two sentences: a Node.js gateway and TypeScript browser SDK that brings Kafka state to web pages. Browsers subscribe to state channels, never topics. Each view starts from your app's snapshot, gets full-state updates in revision order, and after a disconnect, restart, slow client or bad record it either catches up and says `live`, or says `stale`.
   - Your pitch, accurately: you define the state shape and one mapping function, "plus the snapshot and access checks your app already knows how to answer". (A channel also needs `snapshot` and `authorize`, and the gateway one `authenticate`; the `streamotter init` scaffold has all four.)
   - `{{YOUR_MOMENT}}`: a screen you saw quietly showing old data, a bridge you had to rebuild, or why this mattered to you. It's what Show HN asks for. One line of lineage at most: you co-wrote KafkaSocks at OSLabs in 2021, and StreamOtter is its successor in a new codebase.

2. **Can you make it lie?** (the hook; FIX_DECISIONS §2)
   - The rule, one sentence: make a subscribed view report `live` while it shows something other than the newest state its snapshot and the topic's revisions imply, or get a bad record skipped silently, or get a quarantine copy that isn't byte for byte.
   - How to try, quickest first:
     - **streamotter.dev home page:** press "Drop my connection", watch every view say `stale`, press "Restore it", watch them come back `live` from fresh snapshots. **[update at 1.0]** Check in a browser that morning that the panel answers on 1.0.0.
     - **Locally, no Kafka:** the scaffold's fixture source takes a record with raw text (`{ key, raw: "{not json" }`); give the source a `quarantine-hold` policy and advance the fixture. The source pauses at that record, the incident is quarantine-held with local evidence, and nothing after it is delivered. The challenge: get the preview to say `live` while it's missing the later revisions. Recipe: {{MAKE_IT_LIE_LOCAL_LINK}} (from `drafts/make-it-lie-local.md`, verified Oct 5 on 0.2.0-rc.1; it didn't check the browser view, so don't claim the preview turns `stale` unless you've seen it).
     - **Locally, real Kafka:** `npm run dev:lab` in the public `jfricano/lontra-creek` repo (Docker, Compose 2.24.4+) runs the whole demo stack with three Lab benches at `https://localhost:8443/lab/`. **[update at 1.0]** Mention the source-failure exercises only if Lontra Creek #42 has merged and you've run them locally on 1.0.0.
     - **[HOSTED LAB]** a Failure Lab bench on streamotter.dev ("Fouled sensor"; "Calibration lookup blip"). No quarantine exercise there at launch: the hosted Lab runs only S01 and S06 until a hosting configuration change lands (D2).
   - Reports go to {{MAKE_IT_LIE_LINK}}; found-by credit in the changelog if they want it. You'll reproduce each one.

3. **How you built it** (must-say; same words as everywhere else):
   - Type this sentence yourself, word for word from `ai-disclosure.md`: "I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code."
   - Then, briefly, the checks that don't come from the model: tests against real Apache Kafka 4.1.2 (TLS, SASL PLAIN and SCRAM, plus a three-broker cluster for the quarantine path), browser tests, installs from the registry, a deployment behind a proxy. And point 2: anyone can try to break it.
   - Expect "why 1.0 so fast?" (repo created September 25) and "did you read every line?". Both are prepared in `hn-faq.md`.

4. **Limits, and what 1.0 means.**
   - One gateway per project; no replay (after a gap you get a fresh snapshot, not the missed updates); browser automation **[update at 1.0: Chromium only, or Chromium, Firefox and WebKit if the gate run passes]**; managed Kafka unverified; KafkaJS 2.2.4 pinned behind an internal adapter.
   - 1.0 is a compatibility promise (from `1.0.0`, every public operation keeps working until a new major), not a claim of maturity or adoption.
   - New in 1.0, one line: opt-in bad-record handling (hold, or quarantine to a topic byte for byte, with a durable incident and operator commands; no silent skip). Details are for replies (`hn-faq.md`, "What happens on a poison record?").

5. **What you'd like to hear** (your words):
   - Does the live/stale model match how you'd render state?
   - Would you trust a recovery guard to move past a bad record, or always hold?
   - If you run Kafka, what would stop you trying this in an existing app? Which Kafka setup should be verified next?

## Facts to keep straight (from the repository, October 5, 2026)

- **Version:** launch on `1.0.0`. Today npm `latest` is `0.2.0-rc.1` (V1 plus V1.1, V1.2 and V1.2.1), published October 5 UTC with provenance. `1.0.0-rc.1` comes first, once the V1.1 acceptance packet's release checks pass, at T-14 (quiet apart from the Console.dev Betas email); `1.0.0` follows at T-5, a Thursday (D3). There is no final `0.2.0`. Never write `@next` (it still points at `0.1.0-rc.1` on five packages).
- **Packages:** `npm install streamotter` installs everything: the command, `streamotter/gateway` and `streamotter/client`. A frontend deployed separately can use `@streamotter/client`. All six packages share one version.
- **Requirements:** Node.js 24 or later for the gateway and CLI; 24.15 or later where the failure-handling journal runs. The SDK targets current evergreen browsers.
- **Delivery states:** `authorizing → synchronizing → live`, plus `stale`, `resync-required` and `failed`. V1.1 adds no browser states and doesn't change the protocol or SDK.
- **Failure handling is opt-in.** A configuration without `failureHandling` behaves as before: no journal, no producer, no new disk or Kafka permissions.
- **Failure classes:** only `invalid-json` and `payload-schema` can be quarantined; mapper errors, timeouts, routing and revision conflicts, tombstones and oversize records always pause.
- **Redrive vs. retry:** a held record recovers through `retry-current` (after a fix) or `reassess` (the recovery guard approving). Redrive only reprocesses a record the source already moved past. It never publishes to Kafka or moves an offset. Don't describe redrive as what brings a held source back.
- **Kafka:** KafkaJS 2.2.4 behind an internal adapter (two defects contained there). Verified against Apache Kafka 4.1.2: TLS with a supplied CA, and TLS with SASL PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512. TLS with the system trust store is implemented but not verified. No OAuth, IAM or mutual TLS. JSON only.
- **Transport:** Socket.IO 4.8.3, WebSocket only; StreamOtter's SDK owns reconnection and resynchronization.
- **The reviews:** V1.1 was reviewed by six fresh AI agent sessions that hadn't written the code, plus a seventh that reviewed the fixes; no person reviewed it line by line. **[confirm V1.2]** who ran V1.2 before describing it separately. The repo docs still say "independent review" until you reword them (D6 in PUBLIC_LAUNCH.md); if asked, say what it meant.
- **KafkaSocks:** you're one of its four GitHub contributors and one of the three npm maintainers of `kafka-socks` (rechecked October 5). Short form: "the successor to KafkaSocks, from one of its original authors."
- **kafka-penguin:** `oslabs-beta/kafka-penguin`, strategies "FailFast", "Ignore" and "Dead Letter Queue" (rechecked October 5). An inspiration, not a dependency.
- **The demo today:** streamotter.dev is up but serves the `0.1.0-rc.3` site (four Lab exercises, no Source failures track). Whether its live demo answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering); check in a browser. The hosted Lab is off until you approve `lab.enabled`.
- **Don't say:** "Kafka in the browser"; exactly-once, guaranteed delivery or "never miss an update"; scalable, production-proven, "in 5 minutes", "verifiably"; "dead-letter queue" as a description of StreamOtter (it's a quarantine topic, and the source holds by default); "skips bad records"; "independent review".
- **Load test:** quote numbers only with "single-process loopback, not a capacity claim."
- **Links:**
  - Demo and site: https://streamotter.dev
  - GitHub: https://github.com/jfricano/StreamOtter
  - Local real-Kafka Lab: https://github.com/jfricano/lontra-creek (public, checked October 5; see its README, "Develop")
  - npm: https://www.npmjs.com/package/streamotter
  - Status: https://github.com/jfricano/StreamOtter/blob/main/docs/IMPLEMENTATION_STATUS.md
  - Getting started: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md
  - Handle bad records: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md
  - Earlier write-up (the September soft launch): https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81
