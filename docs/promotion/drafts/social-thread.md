> **Where and when:** optional, per [PLAN.md](../PLAN.md). Post only on a platform where you already have an account (Bluesky, Mastodon, or X; don't create one for this), on launch day around noon.
>
> **Rules:**
> - Keep each post under 280 characters, so it fits X, Bluesky (300), and Mastodon (500).
> - Link the site or GitHub, never the HN thread, and don't ask for votes.
> - Posts 1 and 5 carry the authorship disclosure and the limits, so they must stay.

# Short thread (5 posts)

**1/**
I built StreamOtter, an open-source (MIT) Node.js gateway and TypeScript SDK for live, Kafka-backed views in web apps. Every view is either verifiably live or visibly stale, never silently wrong. Pre-1.0. A short thread:

**2/**
The problem: after a dropped connection, a restart, or a slow tab, a live page can keep showing old numbers with nothing to say so. StreamOtter makes the state explicit: authorizing → synchronizing → live, or stale until it has resynchronized.

**3/**
How: each view starts from your app's own snapshot, then gets full-state updates in revision order. Your server-side handlers decide who sees what. A slow client gets disconnected instead of holding up the Kafka consumer.

**4/**
Try breaking it: [SITE URL] runs a made-up river-otter study on real Kafka. Its Failure Lab lets you feed it a bad record, cut the broker link, stall a client, or restart the gateway, and watch what the page does.

**5/**
Or locally, no Kafka needed: npm install streamotter, then npx streamotter init . Limits, stated up front: one gateway per project, no replay yet, Chromium-only automated tests. Code: https://github.com/jfricano/StreamOtter

---

**Notes**

- Character counts with the placeholder: 220, 243, 221, 213, 223. With `https://streamotter.app` in place of `[SITE URL]`, post 4 is about 226.
- Mastodon: optionally add `#TypeScript #NodeJS #ApacheKafka #OpenSource` to post 1 (hashtags drive discovery there). On X and Bluesky, one or two hashtags at most.
- Attach one image to post 1 or post 4: the live/stale screenshot pair from the press kit, with alt text such as "The same live view before and after dropping the connection: the badge changes from live to stale."
- If the Failure Lab isn't live at launch, replace post 4 with the walkthrough, or drop it.
- Post 5's limits are the short form of the standard limits sentence. Managed Kafka services being unverified is left out for length. Mention it if anyone asks about Confluent Cloud, MSK, or similar services.
