# Launch fact sheet (2026-10-05)

Shared ground truth for the launch kit. If a source contradicts this, the repo wins; flag it.

## Product state
- Repo: github.com/jfricano/StreamOtter (public, MIT). Created 2026-09-25. As of 2026-10-05: 0 stars, 0 forks, Discussions off, homepage field = npm org page. Topics: kafka, live-data, nodejs, realtime, socket-io, state-synchronization, typescript, websocket.
- npm: six packages released together (`streamotter`, `@streamotter/{contracts,client,gateway,cli,workbench}`). `0.2.0-rc.1` is on `latest` since 2026-10-04/05 with provenance. Before: `0.1.0-rc.1..rc.3` (V1).
- Version mapping (roadmap §8, decided by Jason 2026-10-05): **npm `1.0.0` = the V1 official public launch**, via `1.0.0-rc.1`. Gate before `1.0.0-rc.1`: V1.1 acceptance-packet checks (Kafka broker with ACLs, Firefox + WebKit, proxy deployment with failure handling on, one integrator walking the source-failure runbook end to end). Jason doesn't expect another 0.2.0 rc but the path is "sorted out as we go". No launch date is set.
- 0.2.0-rc.1 = V1 + V1.1 (source-failure handling: per-source policies, quarantine-hold to a quarantine topic byte-for-byte, quarantine-resync with app-owned recovery guard, circuit breaker, durable SQLite incident journal, operator CLI/API: status, failures list/show/export/evaluate/redrive, retry/reassess; workbench Failures tab; health endpoints) + V1.2 quality review + V1.2.1 fixes. Read CHANGELOG.md and docs/IMPLEMENTATION_STATUS.md for exact claims and limits.
- Known limits to keep honest: one gateway per project; no replay of missed updates (fresh snapshot instead); browser automation verified on Chromium only (Firefox/WebKit are a 1.0 gate); managed Kafka services unverified; KafkaJS 2.2.4 pinned behind an internal adapter.

## Demo site
- Lontra Creek, a fictional river-otter watershed study running real Kafka + a production StreamOtter gateway. Public domain is **streamotter.dev** (the Sept plan said streamotter.app; that is outdated). Pages: product, guided walkthrough, Failure Lab (each visitor breaks an isolated setup), config playground, workbench, "When it breaks", releases.
- State: phase one (Lontra V1.1 backend+site) merged 2026-10-05; phase two (#42, 8 source-failure exercises such as a "foul sensor" bad record that pauses then resumes) pending deployment review. The site is hosted separately from the library, on a shared server. Do not assume the site is publicly live; check it and say what you found.
- Screenshots of the V1.1 preview exist (not in this repo). Site source: the lontra-creek repo.

## Story material (Jason, 2026-10-05)
- Lineage: OSLabs (open-source tech accelerator/incubator) produced **KafkaSocks** (Kafka to WebSockets; Jason is a co-author, one of 4 GitHub contributors and 3 npm maintainers; about 113 stars per the Sept research) and **kafka-penguin** (KafkaJS error strategies: fail fast, ignore, dead-letter queue). Jason knew the kafka-penguin team; their strategies inspired V1.1: quarantine ~ DLQ, hold ~ fail-fast, plus browser notice, operator redrive, incident journal.
- Pitch in Jason's words: the developer defines the state shape and one mapping function, and StreamOtter does the heavy lifting.
- Unmet demand signal: github.com/b/kafka-websocket, about 350 stars, a bare Java WebSocket pipe to Kafka (Kafka client 0.8.2, Java 1.7, ~49 commits), little development in about ten years (Kafka 0.8-era client; the Sept brief recorded a last push in Dec 2023, so don't say 'abandoned since 2015' flatly). It exposes raw topics to clients (optional TLS with client-certificate auth, but no per-user state access, typing, ordering, or failure handling). Stars read 2026-10-05: 353. KafkaSocks 113, kafka-penguin 73.
- A typical "before" picture: Spring Boot + @KafkaListener + STOMP tutorial on Medium (July 2024) that broadcasts to everyone, with no auth, reconnect, offsets, or failure handling. Don't disparage authors; describe the pattern.
- Jason's existing launch article: https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81 — the soft launch. It reached little audience.
- Jason is a solo maintainer. He does business as Orca Solutions; MIT, no paid product. StreamOtter was built with Claude Code (Jason set direction/spec, made decisions, reviewed; real-Kafka test suites are the check). The plan says to disclose this plainly.

## Existing plan (Sept 27) and its decisions
- The September plan: docs/promotion/ (PLAN.md, briefs/, drafts/). Jason's earlier decisions there stand unless outdated by the facts above; flag any you'd change and why.
- Guardrails that stay: no invented adoption/perf/capacity numbers, quotes, users, stars; HN text must be Jason's own (HN bans AI-generated/edited comments) so HN drafts are talking points; Reddit posts rewritten in his words; Stack Overflow bans AI drafts; label AI-assisted articles; never "Kafka in the browser", "scalable", "production-proven", "exactly-once", "in 5 minutes"; no competitor disparagement; nothing shown as shipped before it is.

## Corrections found during preparation (2026-10-05)
- Redrive does NOT bring a held source back to live. A held record recovers via `retry-current` or the recovery guard approving (`reassess`); redrive applies only to a record the source has already moved past.
- streamotter.dev is publicly up but serves the 0.1.0-rc.3 site (4 Lab exercises, no Source failures track, /blog 404, some streamotter.app and "five minutes" copy). Phase two's 8 exercises need a release with quarantine on the hosted Lab, and hosted Lab benches stay off until Jason approves.
- Hosted Failure Lab is OFF in both Lontra phases (no `lab.enabled`) pending Jason's approval and its own acceptance. Even when on, it can run only profile `retry` (LC11-S01 `fouled-sensor` and S06 `calibration-blip`) until a hosting configuration change lands. S02–S05 (profile `quarantine`) need that owner-approved change; S07–S09 are local/CI only. All 8 new stories passed real-Kafka tests locally on 0.2.0-rc.1 with ACLs (`npm run dev:lab` in lontra-creek). So any recording of the Lab today must come from a local stack, labeled as such. (Lontra V1.1 work, Oct 5)
- Lab contract defaults (not measured capacity; lontra docs/contracts/lab-api.md §2): 3 benches, 300 s max lease, 30 s claim, 30 s idle, queue 50, 2 per IP, 20 concurrent and 3/s per IP.
- No /blog or RSS exists or is planned in Lontra yet.
- #42 pins exact streamotter@0.2.0-rc.1 (draft, unmerged).
- The V1.1 review was done by six fresh AI agent sessions that didn't write the code, plus a seventh reviewing the fixes; no person reviewed line by line. Don't call it "independent review" in launch copy without saying so (Jason decides wording). V1.2 review: unconfirmed, assume the same until checked.
- Citable pre-1.0 fixes: CHANGELOG [0.2.0-rc.1] Fixed (slow-reader memory growth, session-timeout reprocess loop, startFrom latest skip on early restart, stop() hanging on a never-loading handler, U+2028/2029 escaping); V1.1 REVIEW.md §2 R1, J1, J2.
