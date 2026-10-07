> **Where and when:** submissions you send on T+1 (the day after Show HN), once each. Routes and sources are in `briefs/launch-comms.md` §4; decisions are in [PLAN.md](../PLAN.md).
>
> **Rules:**
> - Send from your own address, and disclose that you built it.
> - One link per submission, and no follow-up nagging.
> - These are never sent on your behalf.
>
> **Route checks (September 27):**
> - Cooperpress lists editor@cooperpress.com.
> - Console.dev takes submissions at hello@console.dev. Its Betas section requires a pre-1.0 or beta label, so `0.1.0` qualifies.
> - Changelog News requires signing in to changelog.com before submitting.
> - The Confluent address comes from a 2025 newsletter; that it's still current is unverified.

# Newsletter blurb

## 2–3 sentences

StreamOtter is an open-source (MIT) Node.js gateway and TypeScript browser SDK that brings Kafka state to web pages, where every view is either verifiably live or visibly stale, never silently wrong. Each subscription starts from the application's own snapshot, then receives full-state updates in revision order, and the application's own handlers decide who sees what. It's pre-1.0, with one gateway per project and no replay of missed updates, and its live demo lets visitors break the pipeline on purpose: [SITE URL].

## One sentence (for submission forms)

StreamOtter (MIT) is a Node.js gateway and TypeScript SDK that brings Kafka state to the browser, where every view is either verifiably live or visibly stale.

---

## Ready-to-send versions

Replace `[SITE URL]` and `[VERSION]` first. The GitHub link is https://github.com/jfricano/StreamOtter.

### Cooperpress: Node Weekly and JavaScript Weekly (editor@cooperpress.com)

**Subject:** Link for Node Weekly: StreamOtter, live Kafka-backed state in the browser (open source)

> Hi, I'm Jason Fricano. I built StreamOtter and wanted to suggest it for Node Weekly, or JavaScript Weekly if it fits better.
>
> [2–3 sentence blurb]
>
> GitHub: https://github.com/jfricano/StreamOtter
> Live demo: [SITE URL]
> npm: https://www.npmjs.com/package/streamotter ([VERSION], MIT)
>
> Thanks for reading,
> Jason

### Console.dev (hello@console.dev)

**Subject:** Beta suggestion: StreamOtter (pre-1.0 Kafka-to-browser state channels)

> Hi, I'm Jason Fricano, the author of StreamOtter. It's pre-1.0 ([VERSION]), so I'm suggesting it for your Betas section.
>
> [2–3 sentence blurb]
>
> It's self-service: `npm install streamotter`, then a CLI that scaffolds a project and runs a local gateway with a workbench, no Kafka needed to start. The docs are in the repository.
>
> GitHub: https://github.com/jfricano/StreamOtter · Demo: [SITE URL]
>
> Jason

### Changelog News (form at changelog.com/news/submit; sign-in required)

- **URL:** https://github.com/jfricano/StreamOtter
- **Title:** StreamOtter: Kafka state in the browser that's either live or visibly stale
- **What's interesting about it?**
  > I built this, so I'm biased. Wiring Kafka to a browser is easy; the hard part is what comes after: after a disconnect, a restart, or a slow tab, is the screen still right? StreamOtter gives each view an authoritative snapshot, then full-state updates in revision order, and an explicit `live` or `stale` state, with access decided by your own handlers. Bad Kafka records pause the source instead of being skipped, and slow clients are disconnected instead of buffering without bound. The live demo has a "Failure Lab" where you break an isolated setup on purpose and watch the page stay honest: [SITE URL]. MIT and pre-1.0; one gateway per project, and no replay yet.

### Confluent Developer Newsletter (devx_newsletter@confluent.io)

**Subject:** Community resource: StreamOtter, open-source Kafka-to-browser state channels

> Hi, I'm Jason Fricano. Your newsletter invites readers to submit resources, so here's an open-source project I built for Kafka developers who need live web views.
>
> StreamOtter (MIT) is a Node.js gateway and TypeScript SDK. It consumes Kafka with explicit per-record commits: bad records pause the source without being skipped, and rebalances or outages mark browser views stale until they resynchronize from the application's snapshot. Browsers subscribe to application-defined state channels, never to topics, and see every view as either verifiably live or visibly stale. It's verified against Apache Kafka 4.1.2 over TLS with SASL PLAIN and SCRAM (managed services not yet verified); one gateway per project; no replay of missed updates; pre-1.0.
>
> GitHub: https://github.com/jfricano/StreamOtter · Live demo on real Kafka: [SITE URL]
>
> Thanks,
> Jason

### Short forms (Echo JS, DevHunt, awesome lists)

- **Echo JS title:** `StreamOtter: Kafka state in the browser that's either live or visibly stale`
- **Awesome-list line** (check each list's CONTRIBUTING for format): `[StreamOtter](https://github.com/jfricano/StreamOtter) - Node.js gateway and TypeScript SDK that delivers Kafka-backed state to browsers with explicit live and stale states.`
