> **Where and when:** your reference for launch day on HN, also useful on Reddit. **Rules:**
> - HN's guidelines say "Don't post generated text or AI-edited text," so these are facts to reply from in your own words. Never paste them.
> - Agree with what's true first, give one specific link, never disparage alternatives, and use no numbers beyond the docs.
> - Decisions referenced here are in [PLAN.md](../PLAN.md).

# Hard questions: prepared honest answers

Each entry has the likely question, the honest core, and where to point. Links are relative to https://github.com/jfricano/StreamOtter/blob/main/. The version is `0.1.0-rc.3` unless `0.1.0` ships first.

## Why not X?

**"Why not Centrifugo / Ably's Kafka connector / Lightstreamer / Zilla?"**
- Those are mature and cover real parts of this problem. Say so first.
- StreamOtter is narrower. It handles state views (a snapshot plus full-state updates, with an explicit live/stale contract), and the snapshot and authorize logic are your own TypeScript handlers, in the codebase your app already has. It also comes with a local workbench for defining, previewing, and tracing channels.
- If you need multiple nodes, retained history or replay, or a managed service today, those are a better fit. StreamOtter V1 doesn't do those.
- Point to: `docs/guides/when-to-use.md` once it's merged (Phase 1); until then, `docs/RESEARCH.md` §4, which compares approaches using each vendor's own docs.

**"Why not KafkaJS plus Socket.IO directly? That's 50 lines."**
- True for the happy path; that's what KafkaSocks was. The rest is the part StreamOtter handles:
  - the snapshot-versus-update race (updates captured before the snapshot, compared by revision);
  - explicit `stale` after a disconnect, restart, or overflow;
  - per-record commits with poison records that pause instead of being skipped;
  - bounded queues and slow-client disconnects;
  - revocation while handlers are pending;
  - traces of each record's path.
- Point to: README "What V1 does," and the acceptance-scenarios table in `docs/IMPLEMENTATION_STATUS.md`.

**"Why not just poll an API, or use SSE?"**
- If polling meets your freshness needs, poll. It's simpler.
- StreamOtter makes sense when the events already exist in Kafka and many browsers need a current view with per-user access checks.
- SSE is a fine one-way transport, and the founding plan lists plain WebSocket and SSE adapters as possible later additions (not scheduled).
- My reasoning for starting with a bidirectional socket: the SDK sends subscribe and unsubscribe requests and delivery receipts back on the same connection. The receipts are what keep one frame in flight per subscription.
- Point to: `docs/FOUNDING.md`, "The first product boundary."

**"How is this different from ElectricSQL / Supabase Realtime / Firebase / a sync engine?"**
- Keep it general and non-comparative: those start from a database; StreamOtter starts from Kafka topics you already have, plus your app's own snapshot for the current state.
- It's read-only and server-to-browser: no client writes and no local-first store.
- Don't characterize their features beyond that.

**"'Never silently wrong'? What if my snapshot or database is wrong?"**
- Fair point. The claim is scoped: after a disconnect, a restart, or a slow client, the view either resynchronizes or says `stale`. It is only as correct as your `snapshot` handler and the revisions your data carries.
- If a change is committed to your database but never published to Kafka, the gateway can't know. The docs say so and recommend an outbox topic.
- `live` means synchronized up to the gateway's drain boundary. It isn't a wall-clock freshness guarantee.
- Point to: `docs/guides/kafka.md`, "Every change reaches the topic" (the outbox), and the "Render the delivery state" table in the client README.

## One gateway

**"One gateway per project? That's a single point of failure and doesn't scale."**
- Yes, that's the V1 boundary, on purpose.
- If the gateway restarts, clients go `stale`, reconnect, and resynchronize from your snapshots. In the deployment test behind a proxy, a restarted gateway brought the page back to live in about 2.5 seconds, measured on one machine.
- After a crash, Kafka keeps the dead member in the consumer group for its 30-second session, so the replacement may need one retry. `docs/DEPLOYMENT.md` says to restart after a short delay.
- Two gateways on one consumer group would each deliver only part of the data, so the docs say not to scale horizontally.
- Multiple gateways need shared history and routing. That's the V2 direction: a plan, not a date.
- Point to: `docs/DEPLOYMENT.md`, "Deployment boundary" and "Keep it running."

**"How many clients can one gateway handle?"**
- I haven't measured capacity, and I won't guess.
- The load test checks bounded behavior: 200 SDK clients and 10 stalled clients on one machine, where the source never waits for the stalled ones and every counter returns to zero. It's documented as a single-process loopback measurement, not a capacity claim.
- Offsets are committed one per record, which favors precise progress over throughput. It isn't measured against high-rate topics.
- Point to: `docs/IMPLEMENTATION_STATUS.md`, "Declared workload" and "Decisions and deviations."

## Release status

**"It's a release candidate / pre-1.0. Is it production-ready?"**
- Honest version:
  - It's pre-1.0, and the API may change (the CHANGELOG will list breaking changes).
  - What's verified is listed with the commands and results.
  - What isn't verified is listed too: other Kafka versions, managed Kafka, system-trust TLS, Firefox and Safari, and hosting beyond one machine with Caddy (plus the demo's host, once it's live).
- Evaluate it against that list. I'd rather you know the limits than find them.
- Point to: `docs/IMPLEMENTATION_STATUS.md`, "Limitations and open items."

**"Why should I depend on a solo maintainer's project?"**
- Fair. It's MIT, the behavior is specified (`docs/V1_API.md`), and the tests are in the repository, but the bus factor is one.
- Starting with a non-critical view is reasonable.
- Once `SUPPORT.md` is merged, point to its response aims. Don't promise more than those.

## Technology choices

**"Why Node?"**
- The first audience is JavaScript and TypeScript app teams. The gateway runs your `authenticate`, `authorize`, `map`, and `snapshot` handlers, so they're written in the same language as your app and can reuse its session and data code.
- It also continues KafkaSocks.
- Node 24 is the target; CI also runs Node 26.

**"KafkaJS? Isn't it barely maintained?"**
- It's a known question: the last release, 2.2.4, was in February 2023, and there's an open "KafkaJS status" issue (#1753).
- 2.2.4 is pinned behind an internal adapter, so the client can be replaced without changing the public API. The spec calls it a deliberate initial choice, not a claim about maintenance health.
- Per PLAN.md, don't announce a plan or a date for switching clients unless you've decided on one. "Feedback on this is welcome" is enough.
- I found two issues with that version and contained them in the adapter:
  - a 1 ms timer spin per connection, which took idle CPU from 2.6% to 0.3% of a core on my machine once fixed;
  - a connection left open after `disconnect()` following a broker restart.
- Point to: `docs/IMPLEMENTATION_STATUS.md`, "Decisions and deviations"; `docs/V1_API.md` §1.

**"Why Socket.IO instead of plain WebSocket?"**
- Continuity with KafkaSocks, and its connection primitives.
- StreamOtter runs it WebSocket-only: no long-polling (so no sticky sessions), with Socket.IO's own recovery and reconnection turned off. StreamOtter's SDK owns reconnection (full jitter), resynchronization, and receipts.
- The trade-off, stated plainly: browsers need the StreamOtter SDK (which uses the Socket.IO client); a bare WebSocket client can't connect.
- Point to: `docs/FOUNDING.md`, "The first product boundary"; `docs/DEPLOYMENT.md`.

**"Why full-state updates instead of deltas?"**
- Correctness and simplicity: each update replaces the whole state and carries a revision, so a client can always tell whether it's current. There's nothing to merge.
- Deltas aren't in V1.

## Delivery semantics

**"Exactly-once? Does the browser see every update?"**
- No, and it doesn't claim to.
- V1 is for state views. A live view converges on the latest state in revision order.
- After a gap (a disconnect, an overflow, or a source outage), it resynchronizes from a fresh snapshot, and intermediate revisions aren't replayed.
- If you need every event, like an activity feed, V1 isn't the right fit. Retained, resumable event feeds are the V2 direction: planned, not built.
- Point to: "Be precise about delivery" in `docs/FOUNDING.md` (Our philosophy).

**"What happens with a bad record?"**
- The source pauses at that record without skipping it, and views go `stale`. The trace shows which stage failed.
- After the handler or data is fixed and the source is resumed, the same record is processed.
- Tested against real Kafka with invalid JSON, a handler failure, and a tombstone.
- Point to: Failure Lab "Fouled sensor"; `docs/guides/kafka.md`.

## Compatibility

**"Does it work with Confluent Cloud / MSK / Aiven / Redpanda?"**
- Unverified. The verified matrix is Apache Kafka 4.1.2 with TLS and a supplied CA, and SASL PLAIN or SCRAM-SHA-256/512.
- TLS with the system trust store, which most managed services would use, is implemented but not verified.
- No OAuth or IAM auth, and no mutual TLS.
- If someone tries it, ask them to open an issue with the result. That's genuinely useful.
- Point to: the Kafka support matrix in `docs/IMPLEMENTATION_STATUS.md`.

**"Firefox / Safari?"**
- Automated and manual checks use Chromium only; Firefox and Safari are untested.
- The SDK targets current evergreen browsers, but untested is untested. Bug reports are welcome.

**"Can I use it without Kafka?"**
- For development, yes: deterministic fixture sources (the four-command quickstart).
- In production, V1 sources are Kafka only.

**"Avro / Schema Registry / Protobuf?"**
- JSON only in V1, with a bounded JSON Schema subset.
- Schema Registry and Avro decoding are V2 direction, not scheduled.

## About the project

**"Did you build this with AI?" / "How long did this take?"**
- The PLAN.md decision is yes, said plainly. Ideally you've already said it in the first comment.
- In your own words:
  - you built it with Claude Code;
  - you set the direction and the specification (`docs/FOUNDING.md`, `docs/V1_API.md`), made the decisions, and reviewed the work;
  - the test suites are how you checked the behavior: acceptance scenarios, real Kafka, browsers, and a proxied deployment.
- Don't overstate or understate either side.
- Facts people can see:
  - the founding document is dated September 14, 2026;
  - the public history starts with one commit adding all of V1 on September 24;
  - the first release candidate was published September 25.
- Don't invent a longer timeline.
- If someone calls it a quick one-off, answer with the verification and its stated limits, not with adjectives.

**"Is this a company? Will it become paid?"**
- The recommended answer: "Orca Solutions is the name I do business under. It's MIT, there's no paid product, and nothing to announce."
- Don't hint at plans that don't exist.

**"Why otters? Is Lontra Creek real?"**
- The study is fictional, and the site labels it as fiction. *Lontra* is the river-otter genus.
- The pipeline is real: Kafka 4.1.2, a production-mode gateway from npm, and the browser SDK.
- The den-site privacy rule in the story demonstrates access control: the public otter channel withholds den locations, and only the researchers' channel has them.

**"What's the relationship to KafkaSocks?"**
- It's the successor, from one of its original authors.
- Verified: you're one of KafkaSocks' four GitHub contributors (2021, `oslabs-beta/Kafkasocks`) and one of the three npm maintainers of `kafka-socks`.
- StreamOtter continues its goal of simpler Kafka-to-frontend integration, in a new codebase. It's not a fork, and the API is different.

## Launch-day operations

**The demo is down or full.**
- Reply once, in your own words, near the top of the thread. The facts:
  - The live demo runs on [HOSTING, once confirmed; proposed: one small free-tier VM] with a connection limit on purpose, since one gateway is V1's supported topology.
  - When it's full, the page says so, and the gateway reports `OVERLOADED`, which is StreamOtter enforcing its limits.
  - The walkthrough recording on the page is labeled as a recording.
  - The same thing runs locally with four commands and no Kafka.
- Don't change the submission URL, and don't apologize at length.

**Someone finds a real bug.**
- Thank them, confirm what you can reproduce, and open an issue (or say you will). Link it in the thread.
- If the docs were wrong, fix them and say so.

**Someone is hostile.**
- Answer the substantive part once, maybe twice, then stop. Don't flag them, and don't edit your post to dodge the point.
