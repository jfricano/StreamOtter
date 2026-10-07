<!--
DRAFT, not published. A LinkedIn post (not an article) for about T+3, linking the 1.0 article (FIX_DECISIONS §3).

Changed since Sept 27: new piece, the origin story (OSLabs, KafkaSocks, kafka-penguin) behind 1.0.
Changed in the Oct 5 fix pass:
- Cut from about 890 words (a blog piece) to a LinkedIn post of about 435 words (about 2,600 characters) including the slot prompts and [confirm] notes. LinkedIn posts stop at 3,000 characters: replace each prompt with a sentence or two and delete the [confirm] notes as you settle them.
- Overclaims cut: no "ten-year thread", no "on and off for years", no "most Kafka-to-WebSocket code stops at the same place", no "those three words stayed with me" (your slot carries that beat now). Lineage framing follows the brand visuals: "Kafka to the browser · open-source work along the way", with no "each built on the last" claim. Spelled "OSLabs".
- Two slots are REQUIRED (why you came back; one KafkaSocks memory). The rest are optional, so it can ship.
- Added: the AI sentence from ai-disclosure.md (word for word, required); one line for former KafkaSocks users (the migration guide is planned for 1.x, not shipped); the "Can you make it lie?" link.
- Removed the [confirm] on the oslabs-beta organization (both repos are published there; accuracy N17). Kept the other [confirm] markers.

Placeholders: {{ARTICLE_LINK}} (the 1.0 article) · {{MAKE_IT_LIE_LINK}} · [jason: …] slots.
Image: lineage-strip-square.png (or lineage-strip.png) from the launch visuals in PR #65, alt text: "Kafka to the browser, open-source work along the way: b/kafka-websocket, KafkaSocks and kafka-penguin from OSLabs, and StreamOtter."
Voice: you, first person. Rewrite freely; keep the AI sentence word for word. Nothing has been invented to fill a slot.
Rules kept: no quotes from anyone, no invented anecdotes, no star or user counts for StreamOtter. Tag co-authors only after asking them.
-->

# LinkedIn post: coming back to an old problem

In 2021 [confirm: year], at OSLabs [confirm: how you'd like to describe OSLabs and your time there; the READMEs say "accelerated by OS Labs"], I co-wrote KafkaSocks with three co-authors [confirm: name them only if each is happy to be named or tagged, and check spellings]. Developers kept rebuilding the same bridge from Kafka to the frontend, so we wrapped KafkaJS consumers and Socket.IO namespaces in a small API.

[jason, REQUIRED: one sentence, one real memory of working on KafkaSocks.]

It did what it promised. What it didn't do was say what the screen should do when something went wrong: a dropped connection, a restarted server, a record that couldn't be read.

Another OSLabs team, people I knew [confirm: how you knew them; name them only with their OK], built kafka-penguin, a KafkaJS library with three strategies for a message that fails: fail fast, ignore, or a dead-letter queue.

[jason, optional: one sentence on how you first came across kafka-penguin's strategies.]

[jason, REQUIRED: two or three sentences on why you came back to this problem this year. Please don't let a draft supply this part.]

StreamOtter, which reached 1.0 this week, starts from the question KafkaSocks skipped: is this screen still right? Every view starts from the app's own snapshot, takes updates in order, and after a disconnect, restart, slow client or bad record it either catches up and says live, or says stale. Two of kafka-penguin's ideas show up in its opt-in bad-record handling, adapted for screens: fail fast became hold, and the dead-letter queue became a quarantine topic. Ignore is the one I left out, because for a page showing the current state of an order, a skipped record means a page that's wrong and doesn't know it. That's my adaptation, not their design, and any mistakes in it are mine. [confirm: whether you've told the kafka-penguin team, and whether they'd like a mention or a tag]

If you used KafkaSocks: a migration guide is planned for StreamOtter 1.x. Tell me what you'd need from it.

I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code.

[jason, optional: a thank-you to the KafkaSocks co-authors or to OSLabs.]

The 1.0 write-up: {{ARTICLE_LINK}}. And if you can make it lie (get a view to say live while it's wrong), I'd like to hear about it: {{MAKE_IT_LIE_LINK}}

<!--
Facts this draft relies on (FACTS.md and the public READMEs, read 2026-10-05):
- KafkaSocks README: "An easy-to-use, lightweight KafkaJS-to-Socket.io library..."; authors: Jason Fricano @jfricano and the three co-authors
  (names and handles in that README); "This product is accelerated by OS Labs." Published under github.com/oslabs-beta.
- kafka-penguin README: "An easy-to-use, lightweight KafkaJS library for message re-processing."; strategies FailFast, Ignore, Dead Letter Queue;
  four contributors (the kafka-penguin team); "accelerated by OS Labs". Not named here: naming them is your call.
- "OSLabs" is the brand kit's spelling (Oct 5). The READMEs write "OS Labs"; keep their spelling only when quoting them.
- Hold ~ fail-fast and quarantine ~ DLQ are your framing (FACTS.md). StreamOtter has no ignore/discard/force-skip (source-failures guide §1).
  Failure handling is opt-in: the default `pause` holds the source but copies nothing and keeps no journal.
- KafkaSocks dates: issue #49 is from Dec 2021, last push Jan 2022 (community brief), last commit June 2021 (strategy review). "2021" is marked [confirm].
- KafkaSocks migration guide: roadmap V1.x, planned, not shipped. Don't say it exists.
-->
