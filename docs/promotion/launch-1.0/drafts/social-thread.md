> **Changed since Sept 27:** announces `1.0.0`; adds a post on 1.0's opt-in bad-record handling with credit to kafka-penguin; uses Jason's pitch with the accuracy qualifier; links `https://streamotter.dev`.
>
> **Changed in the Oct 5 fix pass:** the AI sentence from `ai-disclosure.md` is now **post 2**, word for word, part of the thread (it was an optional reply, and the header wrongly said posts 1 and 6 carried the disclosure). Post 1 leads with the drop-connection moment; the "Can you make it lie?" invitation has its own post. "Verifiably" is gone. The Failure Lab post is replaced by the home page and the local paths; the hosted Lab is a swap-in only if it's on (accuracy S11, S12, N11) (superseded Oct 7: D2 is no). Bad-record handling is labeled opt-in, so nothing implies every bad record is quarantined by default. Seven posts now.
>
> **Changed Oct 7 (D2 answered no):** hosted Lab with S01–S06 and blog.streamotter.dev are launch gates; conditionals removed.
>
> **Placeholders in this file:** `{{MAKE_IT_LIE_LINK}}` (the pinned Discussion's URL; recount post 5 once it's filled). Resolve the **[update at 1.0]** marker before posting.

> **Where and when:** post only on a platform where you already have an active account (Bluesky, Mastodon or X; don't create one for this), on launch day around noon. If you don't post there already, skip this file.
>
> **Rules:**
> - Keep each post under 280 characters, so it fits X, Bluesky (300) and Mastodon (500).
> - Link the site or GitHub, never the HN thread, and don't ask for votes.
> - Post 2 (the AI sentence) and post 7 (the limits) must stay, word for word for post 2.
> - Edit the rest so it sounds like you.

# Short thread (7 posts)

**1/**
I built StreamOtter: open source (MIT), Kafka-backed live views for web apps. 1.0.0 is out today. Try it: press "Drop my connection" on https://streamotter.dev. Every view says stale, then comes back live from a fresh snapshot. A short thread:

**2/**
I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

**3/**
The problem: after a dropped connection, a restart, or one bad record, a live page can keep showing old numbers with nothing to say so. StreamOtter makes the state explicit: authorizing → synchronizing → live, or stale until it has resynchronized.

**4/**
How: you define the state shape and a mapping function, plus your app's snapshot and access checks. Each view starts from that snapshot, then gets full-state updates in revision order. A slow client is resynced or disconnected instead of holding up Kafka.

**5/**
Can you make it lie? Get a view to say live while it's wrong, or get a bad record skipped silently, and I'll credit you in the changelog: {{MAKE_IT_LIE_LINK}}

**6/**
New in 1.0, opt-in: a bad Kafka record can be copied byte for byte to a quarantine topic, logged as a durable incident, and held until someone decides. Without it, the source still pauses at the record. Never a silent skip. Inspired by kafka-penguin.

**7/**
Locally, no Kafka needed: npm install streamotter, then npx streamotter init . Limits, up front: one gateway per project, no replay of missed updates, Chromium-only automated tests. Code: https://github.com/jfricano/StreamOtter

---

**Notes**

- Character counts (URLs in full; X shortens links to 23 characters): 1: 243 · 2: 267 · 3: 247 · 4: 255 · 5: 138 plus the link · 6: 250 · 7: 227. Recount after any edit.
- **Post 1 [update at 1.0]:** on launch morning, check in a browser that the home page's live panel answers and shows 1.0.0. On October 5 it showed `v0.1.0-rc.3`, and whether its live demo answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering). If it isn't answering, replace the "Try it" sentence with "Every view is either live or says it's stale."
- **Post 2** must match `ai-disclosure.md` word for word.
- **Post 6 accuracy:** quarantine is opt-in and applies to invalid JSON and payload-schema failures; the default `pause` policy copies nothing (with `failureHandling` on it still records an incident; without `failureHandling` there's no journal at all). Other failure classes always pause. "Held until someone decides" is `quarantine-hold`. If someone asks, the runbook is https://github.com/jfricano/StreamOtter/blob/main/docs/guides/source-failures.md. On Mastodon or Bluesky you can link kafka-penguin (`github.com/oslabs-beta/kafka-penguin`).
- **Hosted Lab [confirm at launch]:** on at launch (D2), but benches are few and queued, so the thread leads with the home page. Post 1 has no room for it. If you leased a bench yourself that day, you can add an optional reply: "Or borrow a Failure Lab bench and break it on purpose (you may wait for one): https://streamotter.dev/lab/".
- **Post 7 [update at 1.0]:** if Firefox and WebKit pass the 1.0 gate, change "Chromium-only automated tests" to match. Managed Kafka being unverified is left out for length; say it if anyone asks about Confluent Cloud, MSK or similar.
- Mastodon: optionally add `#TypeScript #NodeJS #ApacheKafka #OpenSource` to post 1. On X and Bluesky, one or two hashtags at most.
- **Images:** attach the live → stale → live GIF (`hero-demo-script.md`, part A) to post 1, with alt text "Screen recording of streamotter.dev: after Drop my connection, every view's badge changes from live to stale, then back to live after Restore it." For post 5, use `make-it-lie.png` from the launch visuals in PR #65 (it points to `github.com/jfricano/StreamOtter/issues`; if the invitation lives in a Discussion, check the two agree).
