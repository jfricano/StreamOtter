> **Changed since Sept 27:** announces `1.0.0`; links `https://streamotter.dev`; Jason's "state shape plus one mapping function" pitch and 1.0's bad-record handling are in.
>
> **Changed in the Oct 5 fix pass:** no longer opens with "StreamOtter 1.0 is out". It leads with the drop-connection moment and the "Can you make it lie?" challenge (FIX_DECISIONS §2). The AI sentence from `ai-disclosure.md` is **required**, word for word (it was "optional"). The OSLabs and kafka-penguin lines are cut to one clause, because the origin story is its own LinkedIn post at T+3 (`origin-story.md`). "Verifiably" is gone. The Failure Lab line is conditional on the hosted Lab being on, and the "LinkedIn has no AI-text ban" claim is replaced (accuracy S11, S12, N11, N13).
>
> **Placeholders in this file:** `{{MAKE_IT_LIE_LINK}}` (the pinned Discussion's URL). Resolve the **[update at 1.0]** marker before posting.

> **Where and when:** your personal LinkedIn profile, on launch day around noon (after the Show HN morning), ideally Tuesday–Thursday. If HN Plan B is in effect, the same day after the r/apachekafka post.
>
> **Rules:**
> - Link GitHub or the site, never the HN or Reddit thread, and don't ask for votes anywhere.
> - The first person makes clear that you built it.
> - Edit freely so it sounds like you, but keep the AI sentence word for word. (No LinkedIn AI-text rule was checked for this kit; the sentence goes in because it goes everywhere.)

# LinkedIn launch post

Go to streamotter.dev and press "Drop my connection." The creek keeps moving without you, and every view on the page says it's stale. Press "Restore it," and each view takes a fresh snapshot and comes back live.

That's the whole idea behind StreamOtter, the open-source project I'm releasing as 1.0 today. A live page fed from Kafka is easy to demo and hard to trust. After a dropped connection, a server restart, a slow client or one bad record, is the screen still right? Usually nothing on the page tells you.

With StreamOtter you define the state shape and one mapping function, plus the snapshot and access checks your app already knows how to answer, and it does the heavy lifting. Each view starts from your application's own snapshot, gets full-state updates in order, and either catches up and says live, or says stale. A Kafka record that can't be processed holds its source and is never skipped silently; new in 1.0, opt-in failure handling can also copy it byte for byte to a quarantine topic and record a durable incident.

So here's my challenge: can you make it lie? Get a view to say "live" while it's showing the wrong thing, or get a bad record skipped without a trace, and I'll credit you in the changelog: {{MAKE_IT_LIE_LINK}}

You can try on the home page, on your own machine without Kafka (npm install streamotter), or with the whole demo on real Kafka in Docker (github.com/jfricano/lontra-creek). It grew out of KafkaSocks, which I co-wrote at OSLabs in 2021. It's MIT-licensed, and the limits are written down: one gateway per project, no replay of missed updates, managed Kafka services not yet verified, and only Chromium tested automatically **[update at 1.0]**.

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

https://github.com/jfricano/StreamOtter

#ApacheKafka #TypeScript #OpenSource

---

**Notes**

- About 345 words (about 2,100 characters). Trim the "You can try" paragraph first if you want it shorter; keep the challenge and the AI sentence.
- **The opening depends on the home page.** On launch morning, check in a browser that the live panel on streamotter.dev answers and shows 1.0.0. On October 5 the site showed `v0.1.0-rc.3`, and whether its live demo answers couldn't be confirmed from the static page (the page's no-JavaScript fallback says it isn't answering). If it isn't answering, open with the problem line instead ("A live dashboard that's quietly showing yesterday's numbers looks exactly like one that's right.") and drop the home-page instructions.
- **Image:** the "Drop my connection" GIF if LinkedIn takes it, otherwise `linkedin-post.png` from the launch visuals in PR #65.
- **Button labels** ("Drop my connection", "Restore it") are the live page's, checked October 5.
- **Pitch line:** the qualifier "plus the snapshot and access checks your app already knows how to answer" keeps it accurate (a channel also needs `snapshot` and `authorize`, and the gateway one `authenticate`). Don't shorten it to "just one function".
- **Lineage:** one clause here on purpose. The full OSLabs, KafkaSocks and kafka-penguin story is the T+3 post (`origin-story.md`).
- **Failure Lab:** not mentioned, because the hosted Lab is off until you approve `lab.enabled`. If it's on (D2) and you leased a bench that day, you can add "or borrow a Failure Lab bench on the site".
- **Browser limit [update at 1.0]:** if the Firefox and WebKit gate run passes, replace "only Chromium tested automatically" with what passed.
- **The AI sentence** must match `ai-disclosure.md` word for word.
- Some people put the link in the first comment because LinkedIn may show posts with external links to fewer people; that's a common belief, not verified.
