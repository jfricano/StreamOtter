> **Where and when:** your personal LinkedIn profile, on launch day around noon (after the Show HN morning), ideally Tuesday–Thursday.
>
> **Rules:**
> - Link GitHub or the site, never the HN or Reddit thread, and don't ask for votes anywhere.
> - The first person makes clear that you built it.
> - Edit freely so it sounds like you.

# LinkedIn launch post

I've released StreamOtter, an open-source project for teams that run Kafka and need live views in their web apps.

Back in 2021 I was one of the authors of KafkaSocks, an earlier open-source take on this problem. Getting Kafka events onto a web page is easy to demo and hard to trust. After a dropped connection, a server restart, or a slow browser tab, is the screen still right? Usually nothing on the page tells you.

StreamOtter is a Node.js gateway and TypeScript browser SDK. Each view starts from your application's own snapshot, then receives full-state updates in order. It's always either verifiably live or visibly stale, never silently wrong. Your own server code decides who can see what, and access can be revoked even while a view is still being authorized or loading its snapshot.

Two ways to try it:
- The live demo at [SITE URL]: a made-up river-otter study running on real Kafka. Its Failure Lab lets you break things on purpose and watch what the page does.
- Locally, with no Kafka needed: npm install streamotter

It's MIT-licensed and pre-1.0, and the limits are written down: one gateway per project, no replay of missed updates, managed Kafka services not yet verified, and only Chromium tested automatically.

If your team streams Kafka data into a UI, I'd like to hear how you handle stale data today.

https://github.com/jfricano/StreamOtter

#ApacheKafka #TypeScript #OpenSource

---

**Notes**

- About 210 words.
- Some people put the link in the first comment, because LinkedIn may show posts with external links to fewer people. That's a common belief, not verified; either way is fine.
- **Revocation line:** the README says revocation works even while authorization or a snapshot is pending ("What V1 does").
- **KafkaSocks line:** verified. You're one of its four GitHub contributors and one of its three npm maintainers. Delete the line if you'd rather not lead with it.
- **Optional AI line**, per the PLAN.md decision, if you want it here too: "I built it with Claude Code; the test suites, including real Kafka, are how I checked it." Write it in your own words.
- **If the site isn't live** (the PLAN.md backstop), drop the demo bullet.
