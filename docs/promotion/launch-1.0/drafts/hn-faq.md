> **Changed since Sept 27:** version is `1.0.0` (after `1.0.0-rc.1`), so the "pre-1.0, is it production-ready?" entry is rewritten around 1.0's compatibility promise. Domain is `streamotter.dev`. The bad-record entry covers 1.0's failure handling; "No production health endpoint" is gone (opt-in `/health/live` and `/health/ready`). New entries then: why 1.0 so fast; how this differs; poison records; KafkaJS; why no "ignore"; disk and SQLite.
>
> **Changed in the Oct 5 fix pass:** a **launch-day card** at the top. **New entries:** "Did you read every line?", "Your tests and reviewers are AI too", "Someone made it lie", "Can you make it lie? What counts?", "Kafka 4.4?", "Is letting strangers break benches on your server a risk?". "Did you build this with AI?" now gives the one sentence from `ai-disclosure.md` and the confirmed review facts, with the "if they were AI agents" hedge removed (accuracy S14). b/kafka-websocket appears only in "how is this different", without a star count, never as a demand signal (FIX_DECISIONS §10). The hosted-Lab pointers now follow D2 in PUBLIC_LAUNCH.md (the hosted Lab only if it's on, for S01 and S06; no hosted quarantine exercises at launch) instead of depending on #42 alone (accuracy B3, S12, S13) (superseded Oct 7: D2 is no). The KafkaJS #1603 quote is completed (N12). The bad-records and history material from the dropped reveals is folded in here and in the 1.0 article.
>
> **Changed in the Oct 5 architecture check:** a new **"Architecture"** section (commit point and crash windows, whole-state frames, backpressure, tenant isolation, where state lives, throughput, one gateway and V2, the six packages), each point citing repo paths at 1c75aaa; the old deltas one-liner now points there. Fixed: "slow clients disconnected" (an overflowing subscription re-snapshots; only a missing receipt disconnects), durable incidents need a state directory, and the load-test quote is now exact. See `REVIEW.md`.
>
> **Changed Oct 7 (D2 answered no):** hosted Lab with S01–S06 and blog.streamotter.dev are launch gates; conditionals removed.
>
> **Placeholders in this file:** `{{MAKE_IT_LIE_LINK}}` (the pinned Discussion's URL) · `{{MAKE_IT_LIE_LOCAL_LINK}}` (the published no-Kafka recipe, from `drafts/make-it-lie-local.md`). Answers that depend on the 1.0 gate are marked **[update at 1.0]**; open checks are **[confirm V1.2]** and **[jason: your words]**.

> **Where and when:** your reference for launch day on HN, also useful on Reddit. **Rules:**
> - HN's guidelines say "Don't post generated text or AI-edited text," so these are **talking points to reply from in your own words. Never paste them.**
> - Agree with what's true first, give one specific link, never disparage alternatives, and use no numbers beyond the docs.
> - Links are relative to https://github.com/jfricano/StreamOtter/blob/main/. The version is `1.0.0`.

# Hard questions: prepared honest answers

## Launch-day card (read this one during the thread)

| If they ask… | One line, then the entry below |
| --- | --- |
| Did you build this with AI? | Yes. Say the one sentence from `ai-disclosure.md`, word for word. |
| Did you read every line? | No. Say what you did instead, in your words (entry below). |
| Your tests and reviewers are AI too; why trust either? | Real Kafka, real browsers, registry installs, your specs, and anyone can try to make it lie. |
| Why 1.0 already? | It's an API promise, not a maturity claim; the gate checks are public. |
| How is this different from X? | Agree first; it's narrower: state views with a `live`/`stale` contract and your own handlers. |
| One gateway? Capacity? | Yes, on purpose; capacity isn't measured. Point to the limits. |
| When does the offset commit? Can a slow browser stall Kafka? | Once a record's outputs are queued, not when a browser has them; no, overflow re-snapshots. See "Architecture". |
| Someone made it lie | Thank them, reproduce, open an issue, credit if they want. Don't argue scope in public. |

## The new ones (most likely on launch day)

**"Why is this 1.0 already? The repo was created September 25."** *(new)*
- Agree with the facts first; they're public:
  - founding document dated September 14, 2026;
  - the public history starts with one commit adding all of V1 on September 24; the repository and the first release candidate (`0.1.0-rc.1`) on September 25;
  - V1.1 (failure handling), V1.2 (a review of V1 and V1.1 together) and V1.2.1 (its minor fixes) shipped as `0.2.0-rc.1` on October 4–5;
  - `1.0.0-rc.1`, then `1.0.0`.
- What 1.0 means here, in the roadmap's words: the `1.0.0` release is the V1 public launch, and "from then on, every public operation keeps working until a new major." It's a compatibility promise. It isn't a claim that the project is mature, widely used, or battle-tested. Say that plainly.
- Why not stay at 0.x: you want people evaluating it to know the API won't move under them. New things (V2's retained feeds, multiple gateways) are planned as 1.x minors, designed to avoid breaking changes.
- What you held 1.0 back for (the gate in roadmap §8): a Kafka broker with ACLs enabled, Firefox and WebKit, the proxy deployment with failure handling on, and one integrator walking the source-failure runbook end to end. **[update at 1.0: say which passed, and how.]**
- How it was checked, without adjectives: the test tiers and their counts are in `docs/IMPLEMENTATION_STATUS.md` (for `0.2.0-rc.1`: 444 tests in `pnpm verify`, 48 real-Kafka tests, 3 on a three-broker cluster, 59 browser, 5 deployment, 22 install **[update at 1.0 with the 1.0.0-rc.1 run]**). Test counts are not adoption; don't present them as such.
- The speed comes from how it was built (next-but-one entry). Don't dodge it, and don't invent a longer timeline.
- Honest about users: nobody outside the project has reported running it yet that you know of. That's why you're posting.

**"How is this different from kafka-websocket, or KafkaSocks, or just Socket.IO + KafkaJS by hand?"** *(new)*
- Start by agreeing: the happy path is short, and people keep building it. `b/kafka-websocket` is a small Java WebSocket server whose build targets Kafka 0.8.2 and Java 1.7: a browser names topics and receives their messages (and can publish). KafkaSocks (2021), which you co-wrote at OSLabs, wrapped KafkaJS consumers and Socket.IO namespaces in a small API. A Spring Boot `@KafkaListener` plus STOMP broadcast is a common tutorial pattern. All of these do the useful first job: get records to a socket.
- Describe the patterns, never the authors. Those bridges deliver topic records to connected clients; per-user state access, typed channels, ordering and failure handling are left to the application. That's a fine design for what they set out to do. Don't say kafka-websocket has "no access control" (it supports TLS with optional client-certificate auth) or call it abandoned; "little development in about ten years" is accurate.
- What StreamOtter adds is everything after the first demo:
  - browsers subscribe to application state channels, never topics; your `authorize` decides per subscription, and revocation works mid-handshake;
  - the snapshot-versus-update race (updates captured before the snapshot, compared by revision);
  - explicit `stale` after a disconnect, restart, rebalance or overflow, and `live` only after resync;
  - per-record commits; one frame in flight per subscription; a subscription that overflows its budget re-snapshots, and a client with no receipt in 5 s is disconnected, so the source never waits;
  - bad records: pause by default, or quarantine with a durable incident and an operator workflow;
  - a typed SDK, generated channel types, a CLI and a local workbench with traces.
- Relationship to KafkaSocks: its successor, from one of its original authors; a new codebase with a different API, not a fork.
- If your by-hand bridge already handles all of that, keep it. That's a legitimate answer.
- Don't use kafka-websocket's star count as evidence of demand; "a few hundred stars over twelve years" invites the obvious reply. Describe it only to answer this question.
- Point to: README "What V1 does"; `docs/RESEARCH.md` §4 (or `docs/guides/when-to-use.md` if it has merged by launch).

**"What happens on a poison record?"** *(new; replaces "What happens with a bad record?")*
- Default (no `failureHandling`): the source pauses at that record. Nothing at or after it is committed, nothing is skipped, and every view on that source goes `stale`. Fix the handler or data, resume, and the same record is processed. Tested against real Kafka with invalid JSON, a handler failure and a tombstone.
- With `failureHandling` (opt-in, new in 1.0 from V1.1):
  - every bad record opens a **durable incident** in a local SQLite journal: stable ID, failure class, Kafka position, evidence summary, history; kept across restarts (with a state directory; `streamotter dev` without one keeps incidents in memory, `CHANGELOG.md` [0.2.0-rc.1]);
  - **`quarantine-hold`**: for invalid JSON or a payload that fails the channel's schema, the original key, value and headers are written byte for byte to a quarantine topic you pre-create (idempotent producer, `acks=all`), and the source **stays held**;
  - **`quarantine-resync`**: the source moves past the record only if your application's **recovery guard** returns `recoverable`, which means it can show its snapshots already cover what that record changed (the guide's example uses a transactional outbox). After that, every snapshot on the source must echo the recovery boundary before a view can be `live`, including after restarts. A circuit breaker (five incidents per 60 s by default) stops automatic continuation until an operator reopens it;
  - **operator workflow**: `streamotter status`, `failures list|show|export|evaluate|redrive`, `sources retry-current|reassess|reopen-circuit|retire-boundary`. How a **held** source comes back: `retry-current` processes the same record again after you fix the cause, or `reassess` re-runs the recovery guard under `quarantine-resync` (after `reopen-circuit` if the breaker tripped). **Redrive is not that path:** it applies only to a record the source already moved past. Evaluate dry-runs your current mapping on the stored original; redrive admits the result through the normal revision filter (`reprocessed`, or `superseded` if current state is newer), never publishes to Kafka and never moves an offset. Every action checks the revision you saw, with no `--force`, wildcard or bulk form;
  - a **Failures tab** in the workbench, in development only.
- Never skipped: mapper errors and timeouts, routing failures, revision conflicts, tombstones and oversize records always pause.
- Lineage, if it fits: the design was inspired by kafka-penguin (another OSLabs project; strategies FailFast, Ignore, Dead Letter Queue). Hold is the fail-fast idea, quarantine is the DLQ idea, and StreamOtter adds the browser side (views go `stale`), the recovery guard, the incident journal, operator retry and reassess for held records, and redrive for records already moved past.
- What's not tested yet: a broker with ACLs enabled, network partitions, disk loss, managed Kafka, a crash during a downgrade **[update at 1.0]**.
- Point to: `docs/guides/source-failures.md` (the runbook), and the two local ways to see it: the scaffold's fixture with a `{ key, raw }` malformed record (§2.5; recipe {{MAKE_IT_LIE_LOCAL_LINK}}, verified Oct 5 on 0.2.0-rc.1: the source pauses and the incident is quarantine-held with local evidence), or `npm run dev:lab` in the public `jfricano/lontra-creek` repo (Docker; the source-failure exercises come with Lontra Creek #42, merged (6cb47e9); re-pin and deploy pending). On streamotter.dev/lab/, the hosted Lab runs S01–S06, including the quarantine exercises such as "Garbled reading"; say a visitor may wait for a bench **[confirm at launch: you leased one yourself that day]**. S07–S09 are local and CI only, by design.

**"Why no 'ignore' or skip policy?"** *(new)*
- Deliberate. For a state view, a silently skipped record means a screen that looks `live` but is missing a change, which is the one thing the project promises not to do.
- The closest thing is `quarantine-resync`, which moves past a record only with your guard's approval and snapshot acknowledgment. If your app can't prove coverage, the honest answer is to hold.
- kafka-penguin's Ignore strategy makes sense for its general consumer use case; don't frame this as a criticism of it.

**"KafkaJS is unmaintained, isn't it?"** *(rewritten; checked October 5, 2026)*
- What was verified, and how:
  - npm registry: `kafkajs` `latest` is 2.2.4, published 2023-02-27; no newer stable release; the package isn't marked deprecated.
  - GitHub (web page): the repository isn't archived. Issue #1603, "Looking for maintainers," opened by a KafkaJS maintainer in 2023, is open; it says "what this project needs is not more contributions, but project management in terms of adding new collaborators, making releases, deciding on what features to adopt and which not to…" Issue #1753, "KafkaJS status," is open.
  - Not checked: recent commit activity, and any claims about forks or successors. Don't name a fork or alternative on HN unless you've checked it yourself.
- So agree: no release since February 2023, and the maintainers have publicly asked for help.
- StreamOtter's position, facts only (Sept decision, unchanged): 2.2.4 is pinned behind an internal adapter, so the Kafka client can change without changing StreamOtter's public API. Two defects found in that version are contained in the adapter:
  - a negative request-queue timeout that Node clamps to 1 ms, spinning a timer per connection (idle CPU 2.6% to 0.3% of a core on your machine once fixed);
  - a connection left open after `disconnect()` following a broker restart.
- No plan or date for switching clients unless you've decided one. "Feedback on which client to move to is welcome" is enough.
- Point to: `docs/IMPLEMENTATION_STATUS.md`, "Decisions and deviations."

**"Did you build this with AI?" / "How long did this take?"** *(rewritten Oct 5)*
- Yes. Say the sentence from `ai-disclosure.md`, word for word, typed yourself: "I built StreamOtter with Claude Code and Codex: I set the direction, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code."
- If they want more: your specifications are in the repo (`docs/FOUNDING.md`, `docs/V1_API.md`, the V1.1 specification and ADRs); the test suites cover acceptance scenarios, real Kafka (including a three-broker cluster), browsers, installs from the registry and a proxied deployment.
- The reviews, as facts: V1.1 was reviewed by six fresh AI agent sessions that hadn't written the code, plus a seventh that reviewed the fixes; no person reviewed it line by line. V1.2 reviewed V1 and V1.1 together (15 major and 57 minor findings; every major fixed with a regression test, the remaining minors in V1.2.1). **[confirm V1.2]** who ran V1.2 before describing it separately.
- The repo docs call these reviews "independent" (`CHANGELOG.md`, `docs/IMPLEMENTATION_STATUS.md`, the `docs/releases/v1.1/REVIEW.md` title) until you reword them (D6 in PUBLIC_LAUNCH.md). If someone quotes that, agree: it meant separate AI agent sessions that hadn't written the code, and the wording should have said so.
- Timeline facts: as in the 1.0 entry above. Don't invent a longer one.
- If someone calls it a quick one-off: answer with what's verified and what's listed as unverified, not adjectives, and point to "Can you make it lie?". The Show HN page's concern is exactly that, so take it seriously, once.

**"Did you read every line?"** *(new; it will be asked)*
- Honest answer: **no.** No person, including you, reviewed the code line by line. Say that first, plainly.
- Then what you did instead. **[jason: your words, and only what's true. A shape to fill:]** "I wrote the specs and the acceptance scenarios, made the design calls, reviewed [the designs / the diffs / the test results: say which, and at what depth], and ran the real-Kafka suites myself. Then fresh AI agent sessions reviewed the code, and what they found was fixed with a regression test for each."
- Then the part anyone can check: the rule in "Can you make it lie?" and the ways to try it. "Don't take my word for it" is the honest close.
- Don't soften it with "basically" or "most of it". If you read some parts closely, name them.

**"Your tests and your reviewers are AI too. Why trust either?"** *(new)*
- Agree with the premise: the code, the tests and the reviews all came from the same kind of model, so they can share blind spots. That's a fair reason for caution.
- What doesn't come from the model:
  - the systems the tests run against: a real Apache Kafka 4.1.2 broker (TLS, SASL PLAIN and SCRAM), a three-broker cluster where the quarantine leader is killed, real Chromium **[update at 1.0: plus Firefox and WebKit if the gate run passes]**, installs from the npm registry, and a deployment behind a TLS proxy;
  - the specs and acceptance scenarios, which you wrote and which say what "correct" means;
  - the 1.0 gate's outside integrator walking the runbook **[update at 1.0: say whether that happened, and how]**;
  - anyone running the break-it paths and reporting what they find.
- Then the invitation: if the tests missed something, the fastest way to show it is to make a view lie. {{MAKE_IT_LIE_LINK}}
- Don't claim the tests prove correctness. They show what they cover, and `docs/IMPLEMENTATION_STATUS.md` lists what they don't.

**"Can you make it lie? What counts?"** *(new)*
- The rule: make a subscribed view report `live` while it shows something other than the newest state its snapshot and the topic's revisions imply, or get a bad record skipped silently, or get a quarantine copy that isn't byte for byte.
- Where: the home page's "Drop my connection"; the scaffold's fixture locally (no Kafka; {{MAKE_IT_LIE_LOCAL_LINK}}); `npm run dev:lab` in `jfricano/lontra-creek` (real Kafka in Docker); your own Kafka; a hosted Lab bench at streamotter.dev/lab/ (S01–S06; they may wait in the queue for one).
- Out of scope: load or attacks on streamotter.dev or its server, anything affecting other visitors, and the documented limits (one gateway, no replay of missed updates). Security problems go privately through `SECURITY.md`.
- What they get: found-by credit in the changelog and release notes, if they want it. No bounty.

**"Someone made it lie."** *(new: what to do)*
- Thank them in the thread. Reproduce it before agreeing it's a break. Open an issue labeled `make-it-lie`, link it in the thread, and credit them if they want.
- If it's a documented limit (one gateway, no replay, an unverified Kafka setup), say so once, kindly, with the link. Don't argue scope beyond that in public.
- If the docs were wrong, fix them and say so. If it's a real break, say that too.

## Why not X?

**"Why not Centrifugo / Ably's Kafka connector / Lightstreamer / Zilla?"**
- Those are mature and cover real parts of this problem. Say so first.
- StreamOtter is narrower: state views (a snapshot plus full-state updates, with an explicit live/stale contract), where the snapshot, authorize and recovery-guard logic are your own TypeScript handlers in your app's codebase, plus a local workbench.
- If you need multiple nodes, retained history or replay, or a managed service today, those are a better fit. StreamOtter 1.0 doesn't do those.
- Point to: `docs/guides/when-to-use.md` if merged; otherwise `docs/RESEARCH.md` §4.

**"Why not just poll an API, or use SSE?"** *(unchanged)*
- If polling meets your freshness needs, poll; it's simpler.
- StreamOtter makes sense when the events already exist in Kafka and many browsers need a current view with per-user access checks.
- SSE is a fine one-way transport; a plain WebSocket adapter is on the roadmap (V3.2), not scheduled.
- The bidirectional socket carries subscribe and unsubscribe requests and delivery receipts, which keep one frame in flight per subscription.

**"How is this different from ElectricSQL / Supabase Realtime / Firebase / a sync engine?"** *(unchanged)*
- Keep it general: those start from a database; StreamOtter starts from Kafka topics you already have, plus your app's own snapshot.
- Read-only, server to browser: no client writes, no local-first store. Don't characterize their features beyond that.

**"'Never silently wrong'? What if my snapshot or database is wrong?"**
- Fair. The claim is scoped: after a disconnect, restart, slow client or bad record, the view either resynchronizes or says `stale`. It's only as correct as your `snapshot` handler, your revisions and, with `quarantine-resync`, your recovery guard. The gateway checks the boundary's identity and lifecycle, not that your database really holds the change; the runbook says so.
- A change committed to your database but never published to Kafka can't be seen by the gateway. The docs recommend an outbox.
- `live` means synchronized up to the gateway's drain boundary, not a wall-clock freshness guarantee.

## One gateway

**"One gateway per project? That's a single point of failure."**
- Yes, the V1 boundary, on purpose; 1.0 keeps it.
- On restart, clients go `stale`, reconnect and resync from your snapshots. In the deployment test behind a proxy, a restarted gateway brought the page back to live in about 2.5 seconds, on one machine.
- After a crash, Kafka keeps the dead member in the group for its 30-second session, so restart after a short delay (`docs/DEPLOYMENT.md`).
- With failure handling, the journal belongs to exactly one gateway process on one host; a second gateway on the same state directory is refused.
- Multiple gateways are V2.1 on the roadmap (planned as a 1.x minor): a plan, not a date.

**"How many clients can one gateway handle?"** *(unchanged)*
- Not measured, and you won't guess.
- The load test checks bounded behavior: 200 SDK clients and 10 stalled clients on one machine; the source never waits for the stalled ones, and every counter returns to zero. "A single-process, loopback measurement of bounded behavior, not a capacity claim."
- One offset commit per record: precise progress over throughput; not measured against high-rate topics.

## Release status

**"Is 1.0 production-ready?"** *(rewritten)*
- Don't say yes or no. Say what 1.0 promises (public operations keep working until a new major) and what's verified, and point to the list of what isn't:
  - Kafka: only Apache Kafka 4.1.2; managed services, other versions and system-trust TLS unverified; ACL-enabled broker **[update at 1.0]**;
  - browsers: Chromium only **[update at 1.0]**;
  - hosting: one machine with Caddy, plus the demo's own server; other proxies and cloud load balancers unverified;
  - failure handling: no network-partition, disk-loss or managed-Kafka tests; the journal stops at 256 MiB (no pruning command yet) and keeps the source held; operator socket not on Windows.
- Evaluate it against that list, starting with a non-critical view.
- Point to: `docs/IMPLEMENTATION_STATUS.md`, "Limitations and open items" and "What this does not establish."

**"Why should I depend on a solo maintainer's project?"** *(unchanged)*
- Fair. MIT, specified behavior (`docs/V1_API.md`), tests in the repo, but the bus factor is one. Point to `SUPPORT.md`'s response aims once merged; promise no more than those.

**"Do I need a disk or SQLite now?"** *(new)*
- Only if you turn on failure handling. Without `failureHandling`, nothing changes: no journal, no producer, no new permissions.
- With it: a persistent local directory, Node.js 24.15 or later (`node:sqlite`), a pre-created quarantine topic sized for your records, and the ACLs the runbook lists.

## Technology choices

**"Why Node?"** *(unchanged)*
- The first audience is JS/TS app teams; your handlers run in the gateway in the same language as your app. It also continues KafkaSocks. Node 24 target; CI also runs 26.

**"Why Socket.IO instead of plain WebSocket?"** *(unchanged)*
- Continuity with KafkaSocks and its connection primitives. Run WebSocket-only, with Socket.IO's own recovery and reconnection off; StreamOtter's SDK owns reconnection, resync and receipts.
- Trade-off: browsers need the StreamOtter SDK; a bare WebSocket client can't connect.

**"Why full-state updates instead of deltas?"**
- Moved to "Architecture" below, with the reasons and file paths.

## Delivery semantics

**"Exactly-once? Does the browser see every update?"**
- No, and it doesn't claim to. A live view converges on the latest state in revision order; after a gap it resyncs from a fresh snapshot and intermediate revisions aren't replayed.
- The Kafka offset commits once a record's outputs are queued for subscribers, not when a browser receives them ("Architecture" below). So never say "delivered" to mean "a browser has it".
- The quarantine path isn't exactly-once either: duplicate quarantine copies are possible and stated as such.
- For every-event feeds, 1.0 isn't the fit. Retained, resumable feeds are V2.0 (planned, not built).

## Architecture

> Paths are in the repo at `main` 1c75aaa, under `packages/` unless they start with `apps/`, `docs/` or `tests/`. Line numbers will drift: recheck them at the `1.0.0` tag **[update at 1.0]**. Checked against the code on Oct 5; where the architecture read-through and the code disagreed, the code wins. Talking points, not text to paste.

**"When does the Kafka offset commit? What if the gateway crashes after the commit but before a browser gets the frame?"** *(new)*
- The commit point: once the record has been decoded, mapped and validated and its outputs are queued for the subscribers of each key. Not when a browser receives or acknowledges the frame. A commit never waits for browsers. Say it plainly.
  - The pipeline admits the outputs and returns `{ kind: "commit" }` (`gateway/src/runtime/gateway.ts:701-702`); the adapter then commits offset + 1, one commit per record, auto-commit off (`gateway/src/sources/kafka.ts:312-331`, `:163`, `:263-265`).
- Crash after admission, before the commit: the record is redelivered on restart, and the revision filter drops what browsers already have. Tested on real Kafka with a SIGKILLed gateway (`tests/kafka/03-crash.test.ts`, "crash after admission but before commit"; acceptance scenario 6 in `docs/IMPLEMENTATION_STATUS.md`).
- Crash after the commit, before the browser has the frame: that record isn't redelivered, and the queued frame dies with the process. Browsers lose the connection, views go `stale`, the SDK reconnects, and every subscription starts over from a fresh snapshot from your `snapshot` handler. The view converges on current state, as long as your app's data already reflects that change (hence the outbox advice in "'Never silently wrong'?").
  - No test is named for that exact window that you know of; don't claim one. The restart path is covered by the proxy deployment test (`docs/IMPLEMENTATION_STATUS.md`, "Deployment behind a TLS-terminating proxy").
- A failed commit is retried in the background; the record may be redelivered, and the revision filter absorbs it (`gateway/src/sources/kafka.ts:319-329`).
- Why commit before the browser has it: losing a frame is harmless when every frame is a whole state and a fresh snapshot repairs anything. That's a reading of the design (the order is in the code; the reason isn't written down), so say "my reasoning is".

**"Why whole-state frames instead of deltas?"** *(expanded from the old one-liner)*
- Each frame is the entire state of one channel instance, plus a revision. The next one replaces it. No deltas or reducers in 1.0 (`docs/API_AND_FEATURE_ROADMAP.md`, "V1 state contract": "deltas and arbitrary reducers are outside V1").
- That's what makes recovery simple: any frame can be dropped, because a fresh snapshot repairs everything. A new subscription, a reconnect, an overflow, a source coming back and a resync all run the same sequence: new epoch, start capturing updates, your `snapshot`, send it as frame 1, drain the buffered newer states in revision order, then `live` (`gateway/src/runtime/subscription.ts`, `#beginAttempt`).
- Recovery is always a fresh snapshot plus whole-state frames, never replayed deltas or events. There's no history to replay: `history`, `replay`, `resume` and `recovery` keys are refused as V2 features (`contracts/src/config.ts:11-27`).
- The SDK enforces the order: per epoch, exactly the next sequence number; frame 1 must be a snapshot; later frames must have strictly higher revisions (`client/src/subscription.ts:235-273`). Revisions are decimal strings compared without precision loss (`contracts/src/primitives.ts:28`).
- Trade-offs to concede: a big state means big frames (each capped by `maxDataFrameBytes`, 64 KiB by default, `contracts/src/limits.ts:16`), and intermediate revisions can be skipped. Right for "what's the status now", wrong for an activity feed; retained event feeds are V2.0 (planned).

**"How does backpressure work? Can a slow browser stall Kafka?"** *(new)*
- No. Admitting a frame never waits (`gateway/src/runtime/subscription.ts:188-208`).
- One frame in flight per subscription; the browser's receipt releases the next (`subscription.ts:210-257`, `:486-512`).
- A three-level byte budget: subscription (1 MiB, 100 frames) inside connection (4 MiB) inside gateway (64 MiB); a frame must fit every level (`gateway/src/runtime/budget.ts`; defaults in `contracts/src/limits.ts:18-21`). Defaults you can change, not capacity claims.
- Overflow resets that subscription instead of blocking Kafka: its epoch is invalidated, the view goes `stale` and re-snapshots (at once, then after 1 s and 2 s; after 3 attempts, `resync-required`) (`subscription.ts:188-208`, `:444-460`).
- No receipt within 5 s (`receiptTimeoutMs`) closes the whole connection with `OVERLOADED`; the SDK reconnects and every subscription starts from a snapshot (`subscription.ts:507-511`, `gateway/src/runtime/session.ts:109-114`). A socket whose unread output passes the connection budget is closed too (`session.ts:268-282`).
- Evidence: `tests/integration/flow-control.test.ts` and `tests/integration/slow-reader.test.ts`; in the load test, 10 stalled clients never held up the source and were disconnected by the receipt timeout (`tests/load/load.test.ts`; single-process loopback, not a capacity claim).
- What can slow a source is your own `map()` (the throughput entry below).

**"How is per-tenant isolation enforced?"** *(new)*
- The tenant comes from the verified principal your `authenticate` returns, never from the browser's request. A subscription's routing key is channel, version, the principal's `tenantId` and canonical params (`gateway/src/runtime/subscription.ts:83`, `runtime/core.ts:62-64`).
- Each row your `map()` returns carries its own `tenantId` and is routed by the same key (`gateway/src/runtime/gateway.ts:880-911`), so a row mapped for tenant A reaches only tenant A's subscriptions with the same params.
- Inside a tenant, `authorize` runs per subscription, on every sync attempt and again just before the snapshot is sent; revocation by session, subject or channel works mid-handshake and mid-snapshot (`docs/IMPLEMENTATION_STATUS.md`, "Decisions and deviations"; `gateway/src/runtime/identity.ts`).
- Tested: `tests/integration/access.test.ts` (cross-tenant routing, expired tokens, revocation while handlers are pending; acceptance scenario 4) and the browser test where a same-ID order in another tenant never appears (`tests/browser/order-dashboard.test.ts`).
- The honest caveat: isolation is only as right as the `tenantId` your `authenticate` and `map()` return. The gateway can't tell whether a record belongs to the tenant you mapped it to.

**"Does the gateway store state? Where does the truth live?"** *(new)*
- Truth lives in your application: your `snapshot` handler reads your own database, and Kafka carries the changes. The gateway keeps no durable channel state.
- In memory only: per subscription, the frames queued but not yet sent and the latest revision with a hash of its data, for the revision filter and the conflict check (`gateway/src/runtime/subscription.ts:181-208`); a bounded, payload-free trace buffer (10,000 entries, 8 MiB: `runtime/traces.ts`, `contracts/src/limits.ts:28-29`). All of it goes when the process stops.
- With `failureHandling` and a state directory there is a SQLite journal (`gateway/src/failures/journal.ts`), but it holds incidents, evidence summaries and recovery boundaries, not channel state.
- Say "no durable channel state", not "stateless". "Stores no channel state" is an inference from reading `gateway/src/runtime/`, not a documented guarantee.
- The cost: after a restart every subscription takes a fresh snapshot, so your `snapshot` handler gets the load (at most 32 at once gateway-wide, 10 s timeout, by default: `contracts/src/limits.ts:23`, `:25`).

**"What's the throughput?"** *(new)*
- Not measured at rate; give no number of your own. Records on one source are processed strictly one at a time: every `process()` runs under one lock per source (`gateway/src/runtime/gateway.ts:65-69`, `:634`), and the adapter takes one partition at a time and awaits each record before the next (`gateway/src/sources/kafka.ts:265`, `:294`).
- So your `map()` latency bounds a source's pace: each record waits for every channel's `map()` on that source (cut off at `handlerTimeoutMs`, 2 s by default, `contracts/src/limits.ts:24`) plus one offset commit. Each source has its own consumer group and lock. The adapter heartbeats every 3 s during a slow `map()` so the consumer isn't evicted (`sources/kafka.ts:168`, `:290`).
- The only documented figure: the load test's source committed 600 fixture records in 22–26 ms, "a single-process, loopback measurement of bounded behavior, not a capacity claim" (`docs/IMPLEMENTATION_STATUS.md`, "Declared workload"). Quote it only with that label, and note it's a fixture source, not Kafka.
- Commit granularity: "one offset commit per processed record, favoring simplicity and precise progress over throughput. Not measured against high-rate topics" (same file, "Decisions and deviations").

**"Why one gateway? What does V2 change?"** *(new)*
- The facts: subscriptions, queues and revocations live in one process's memory ("No multi-gateway operation, shared revocation, or durable revocation store, by design for V1": `docs/IMPLEMENTATION_STATUS.md`, "Limitations and open items"); a config asking for `gateways` or `cluster` is refused as a V2 feature (`contracts/src/config.ts:20-21`); the failure journal belongs to one process, and a second gateway on the same state directory is refused (`docs/guides/source-failures.md` §1; `docs/IMPLEMENTATION_STATUS.md`, V1.1 row F30).
- The roadmap's reason: "Use shared history and coordinated ownership before enabling multiple gateways … Reconnecting to a different gateway must not depend on the original process's memory" (`docs/API_AND_FEATURE_ROADMAP.md`, V2 "Delivery semantics and architecture").
- V2, all **planned, not built**, each a 1.x minor (roadmap "npm versions"): V2.0 (planned `1.1.0`) retained event channels, a delivery store, cursors, paged history, SDK checkpoints; V2.1 (planned `1.2.0`) multiple gateways, ownership and fan-out, shared revocation, topology and metrics; V2.2 (planned `1.3.0`) Schema Registry and Avro, React hooks, AsyncAPI export. V1 state channels keep working.
- V2's own target is "resumable, at-least-once application delivery while history remains available", and it says exactly-once processing isn't promised. That's a plan for V2, not a 1.0 property; don't let it blur into 1.0 answers.
- Today a restart means `stale`, reconnect and a fresh snapshot; see "One gateway per project? That's a single point of failure."

**"What's in the six packages?"** *(new)*
- One pnpm workspace; all six released together at one version (`package.json`, `CHANGELOG.md` line 3):
  - `@streamotter/contracts` (`contracts/src`): the shared types, config validator, small JSON Schema dialect, default limits, protocol constants, V1.1 failure and operator contracts. No dependencies.
  - `@streamotter/gateway` (`gateway/src`): `createGateway` and `defineProject`, the Kafka and fixture sources (`sources/`), the record pipeline, subscriptions and budgets (`runtime/`), the Socket.IO transport (`transport/socketio.ts`), V1.1 failure handling (`failures/`, `operator/`), the dev-only management API (`management/`). Depends on `kafkajs` and `socket.io`.
  - `@streamotter/client` (`client/src`): the browser SDK: `createClient`, one Socket.IO connection, typed subscriptions, frame checks, receipts, reconnect, token refresh. Depends on `socket.io-client`.
  - `@streamotter/cli` (`cli/src`): the `streamotter` command: `init`, `validate`, `generate`, `dev`, `start`, and the operator commands (`status`, `failures …`, `sources …`).
  - `@streamotter/workbench` (`apps/workbench`): the local workbench that `streamotter dev` serves; publishes only a static `dist/`, with the client SDK bundled in (`apps/workbench/build.mjs`).
  - `streamotter` (`streamotter/src`, `streamotter/bin`): the all-in-one: thin re-exports under `streamotter/client`, `/gateway`, `/gateway/management`, `/gateway/operator`, `/contracts`, `/cli`, plus the same `streamotter` command.
- Most people want `npm install streamotter`; a frontend deployed on its own can take only `@streamotter/client`.

## Compatibility

**"Confluent Cloud / MSK / Aiven / Redpanda?"** *(unchanged, plus ACLs)*
- Unverified. Verified: Apache Kafka 4.1.2 with TLS and a supplied CA, SASL PLAIN or SCRAM-SHA-256/512. System-trust TLS (what most managed services need) is implemented, not verified. No OAuth, IAM or mutual TLS.
- With failure handling on, an ACL-enabled broker is untested **[update at 1.0]**.
- Ask anyone who tries it to open an issue with the result.

**"Does it work on Kafka 4.4?"** *(new)*
- Apache Kafka 4.4.0 was in its release-candidate vote (RC3 opened Sep 30, per the channel brief). StreamOtter is verified on 4.1.2 only. Say so, and invite a report: "If you try it, please open an issue with the result."

**"Firefox / Safari?"** **[update at 1.0]**
- Today: automated and manual checks are Chromium only. Firefox and WebKit are part of the 1.0 gate; if they pass, say so and link the run. If not, the answer stays "untested; bug reports welcome."

**"Can I use it without Kafka?"** / **"Avro / Schema Registry / Protobuf?"** *(unchanged)*
- Development: fixture sources (the four-command quickstart). Production: Kafka only.
- JSON only, with a bounded JSON Schema subset. Schema Registry and Avro are V2.2 on the roadmap, not scheduled.

## About the project

**"Is this a company? Will it become paid?"** *(unchanged)*
- "Orca Solutions is the name I do business under. It's MIT, there's no paid product, and nothing to announce."

**"Why otters? Is Lontra Creek real?"** *(unchanged; domain updated)*
- Fictional and labeled so; *Lontra* is the river-otter genus. The pipeline is real: Kafka, a production-mode gateway from npm, the browser SDK. The den-site privacy rule demonstrates access control.
- **[update at 1.0]** The site pins an exact `streamotter` version. As of October 5 it showed `v0.1.0-rc.3`; confirm it shows `1.0.0` before launch.

**"What's the relationship to KafkaSocks / OSLabs?"** *(expanded)*
- KafkaSocks came out of OSLabs, an open-source tech accelerator; you co-wrote it (one of four GitHub contributors, one of three npm maintainers of `kafka-socks`). StreamOtter is its successor, from one of its original authors; new codebase, different API.
- kafka-penguin, another OSLabs project, inspired the failure handling. It's not a dependency.

## Launch-day operations

**The demo is down or full.**
- Reply once, in your own words, near the top of the thread:
  - the demo runs on one demo server with deliberate limits (300 gateway connections, and three Lab benches at the contract defaults; confirm both at T-7), since one gateway is the supported topology;
  - when it's full, the gateway reports `OVERLOADED`, which is StreamOtter enforcing its limits;
  - the same thing runs locally: four commands and no Kafka for StreamOtter itself, or `npm run dev:lab` in `jfricano/lontra-creek` for the whole demo on real Kafka (Docker).
- Don't change the submission URL, and don't apologize at length.

**"Is letting strangers break benches on your server a security risk?"** *(new)*
- Each visitor gets an isolated bench with its own gateway and Kafka path; actions affect only the leased bench. The Lab's contract limits are defaults, not measured capacity: 3 benches, a 300 s maximum lease, 2 per IP, a queue of 50 (lontra-creek `docs/contracts/lab-api.md` §2).
- The demo server is hosted separately from the library; load or attacks against it are out of scope for the invitation, and security reports go through `SECURITY.md`.
- If no bench is free, visitors wait in the queue (up to 50 at the contract defaults), and the same Lab runs locally with `npm run dev:lab`.

**Someone finds a real bug.** Thank them, confirm what you can reproduce, open an issue and link it. If the docs were wrong, fix them and say so.

**Someone is hostile.** Answer the substantive part once, maybe twice, then stop. Don't flag them, and don't edit your post to dodge the point.
