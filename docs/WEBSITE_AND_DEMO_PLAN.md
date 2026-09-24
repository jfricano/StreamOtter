# StreamOtter home site and integrated demo

September 24, 2026 · Planned; no website or hosted demo implemented

## Decision and timing

Build a first-class public home site with an integrated `/demo` experience. Treat the site, documentation, and demo as one adoption path: understand the product, see its behavior, run it locally, and integrate it into an application.

**Implement the polished public site and hosted demo after a working, tested V1 release candidate.** Prepare the reusable example and scenario coverage during V1. Complete the public experience before the broad V1 launch, without making website work a condition for testing or completing the core runtime.

This is a dedicated launch milestone after the roadmap's V1.0 engineering gate and before V1.x/V2 feature expansion. It is not a new protocol or package version. There is no calendar commitment yet: the runtime has not been implemented, so schedule from verified gates rather than a guessed release date.

The [roadmap](./API_AND_FEATURE_ROADMAP.md) owns overall sequencing, the [implementation handoff](./IMPLEMENTATION_HANDOFF.md) owns the build order, and [V1_API.md](./V1_API.md) remains the behavioral authority. This document owns the public experience and launch criteria. It does not expand V1's delivery guarantees or introduce a hosted StreamOtter product.

## The staged work

| Stage | When | Deliverable | Exit condition |
| --- | --- | --- | --- |
| Define the experience | Now, while V1 is specified | This brief, page structure, demo scenarios, dependencies, and launch gates. | The public experience has an explicit place in the roadmap. |
| Build the reusable example | V1 slices 1–2 | Order-status application with real gateway/SDK integration, deterministic local scenarios, and a real Kafka path. | Snapshot, updates, recovery, and denial behavior have automated checks. |
| Prepare adoption assets | V1 slice 3 | Reproducible quickstart, generated TypeScript example, React usage, and instructions for supported deployment. | A clean checkout can run the example; exports work without the workbench. |
| Prove V1 | V1 slice 4 | Acceptance results, supported connection modes, resource measurements, and known limitations. | Gate A below passes. |
| Build the public experience | Immediately after Gate A | Site design and implementation, public docs, integrated demo UI, isolated demo service, and staging deployment. | Gate B below passes. |
| Launch and maintain | After Gate B | Public site, working demo, release documentation, and operating instructions. | Published smoke checks pass; update and rollback paths are documented. |

Website preparation during V1 is limited to assets needed by the working product. Full brand exploration, marketing layouts, hosting integration, and public demo operations wait until the engineering gate. Once Gate A passes, finish the public experience before starting the next product feature milestone unless the owner explicitly reprioritizes it.

## Home site scope

The first site should feel complete at launch, with clear typography, a coherent StreamOtter visual identity, responsive layouts, accessible controls, and real product imagery. Use the working product to establish the visual language; screenshots and behavior claims must correspond to the release being offered.

| Route | Visitor's question | Required content or action |
| --- | --- | --- |
| `/` | What does this do, and why would I use it? | Clear Kafka-to-browser value proposition, real product preview, three-step overview, recovery/authorization explanation, and prominent **Try the demo** and **Get started** actions. |
| `/demo` | What happens when updates arrive or the connection breaks? | Interactive order-status walkthrough, explicit freshness states, guided scenarios, relevant code, reset, and a path to run the same example locally. |
| `/docs` | How do I build with it? | Versioned quickstart, concepts, API reference, configuration, auth/snapshots, deployment, troubleshooting, and V1 limitations. |
| `/docs/architecture` | Where does StreamOtter fit? | Source → gateway → SDK → application diagram; application-owned identity and snapshots; local workbench versus deployed gateway. |
| `/releases` | What works in this version? | Released features, verified support matrix, known limitations, upgrade notes, and clearly separated future plans. |

The home page should move from a concrete working example to the integration steps, then recovery and diagnosis, then the supported operating boundary. Explain single-gateway state delivery and snapshot recovery in plain language. Link deeper technical detail instead of overwhelming the first screen.

Use a short, validated TypeScript integration excerpt with a link to the complete runnable example. Show actual UI for the workbench's inspection workflow. A recorded illustration on the home page must be labeled; it must not imply a live connection.

Repository, installation, and release links become calls to action only when their destinations exist and work. Do not invent customer logos, adoption counts, testimonials, pricing, capacity claims, or a managed-cloud offering. A future roadmap must remain visibly distinct from shipped capabilities.

## Integrated demo experience

Use the order-status example already required by V1. A visitor should be able to start without an account, see an authoritative initial state, advance an order, interrupt their own connection, and observe fresh state returning. Aim for a guided walkthrough of roughly three minutes; validate that target with a timed internal walkthrough before launch.

Use one branded `/demo` entry point rather than a separate marketing site. The backend can be deployed independently. The demo is an example application built with StreamOtter; the local workbench remains a separate developer tool, shown through real screenshots, a recording, and the local quickstart.

On desktop, arrange the customer-facing order view beside a compact explanation of subscription state and the relevant code. On small screens, preserve that reading order in a single column. Display actual SDK states and revision information with readable labels; do not manufacture delivery stages or equate socket connectivity with fresh data.

| Scenario | Visitor action | Required visible result |
| --- | --- | --- |
| Initial synchronization | Start the walkthrough. | Synchronizing → initial snapshot → live state, following the real subscription lifecycle. |
| Live state replacement | Advance the synthetic order through a predefined step. | The application publishes a newer state through Kafka; the subscribed view updates with its revision. |
| Disconnect and recover | Disconnect this demo client, advance the order, then reconnect. | A clearly stale/disconnected view followed by snapshot resynchronization to current state. Explain that V1 does not replay every intermediate update. |
| Access denied | Attempt the predefined restricted-order subscription. | Server-enforced rejection without exposing another session's data. |
| Start again | Reset or restart an expired session. | Cleanly unsubscribe/close old clients, create a fresh bounded session, and return to the initial scenario. |

Source outages, gateway restarts, and slow-client overload remain required local acceptance scenarios. They do not become public controls that disrupt other visitors. Link a reproducible local exercise or labeled recording for these scenarios. Add more public controls only when isolation and resource behavior are proven.

## Demo architecture and operating boundary

Reuse the actual V1 gateway, SDK, schemas, authorization handlers, and example UI wherever appropriate. The local example can use deterministic fixtures during development and real Kafka for integration checks. The hosted demo uses a production-mode gateway with an isolated Kafka source and synthetic application data: the V1 specification rejects fixture sources in production and keeps development/management endpoints private.

The demo application owns a small server-side service for issuing short-lived anonymous session credentials, storing authoritative order snapshots, and accepting a fixed set of scenario actions. Advancing an order uses this application's API and Kafka producer, not a new StreamOtter command API. Define a reliable snapshot/publication handoff and monotonic per-order revisions before hosting; it must satisfy the same snapshot/event consistency contract as any V1 application.

Each visitor gets server-assigned session scope and synthetic order identifiers. Authorization derives scope from the verified session, never an untrusted tenant parameter. A restricted-order scenario should deny a predefined resource without allowing arbitrary resource enumeration. Restart creates a new scenario identity rather than reusing a channel instance with decreasing revisions.

Keep the broker, credentials, snapshot store, management API, and workbench inaccessible to public visitors. Do not proxy management routes through the site. The public UI uses SDK events and its own authorized scenario results; any additional operational metadata needs a separate, explicitly redacted application endpoint, not access to the gateway's operator traces.

Before hosted implementation is considered complete, record concrete limits for concurrent sessions, scenario action rate, session lifetime, retained synthetic state, Kafka retention, subscriptions, and gateway queues. Expire idle sessions and clean up their application state. Do not create a Kafka topic or consumer group for every visitor. Verify two independent sessions cannot affect or read each other's order state.

Visitors cannot upload code, connect their broker, choose arbitrary topics, publish arbitrary payloads, or use production credentials. The demo has no persistent user accounts, billing, or general hosted workbench. Its application session isolation does not imply that StreamOtter's V3 team workspaces have shipped.

Deploy static pages/docs independently of the live demo backend so the home site stays available when the demo is down. Show clear starting, busy, expired, and unavailable states with retry and local-run links. A labeled recorded walkthrough is the fallback; never silently substitute an animation for the live runtime.

Choose domain, site framework, hosting provider, and a concrete operating budget at the start of the public-experience milestone, using the implemented runtime's requirements. Hosting must support the pinned Socket.IO deployment and declared single-gateway topology. Keep deployment and rollback instructions, health checks, quota controls, and an identified operator with the site. These choices do not block current V1 work.

## Gate A: ready to implement the public experience

All of the following must be recorded in `docs/IMPLEMENTATION_STATUS.md` when the runtime exists:

- The full [V1 acceptance scenarios](./V1_API.md#12-acceptance-scenarios-and-current-verification) pass, including real Kafka checks for progress, rebalance, and failure behavior.
- Gateway, SDK, workbench, CLI, and generation complete their declared workflow; a clean checkout and exported example are verified.
- Production build/deployment works within the single-gateway boundary and exposes no management or development actions.
- Auth, revocation, synchronization, cleanup, overload/resource limits, and supported broker authentication paths have results and explicit limitations.
- No unresolved failure contradicts a promised V1 behavior. Deferred capabilities are documented rather than presented as implemented.

A happy-path demo, screenshots, or passing type declarations do not pass this gate. It establishes a working, tested V1 release candidate; it does not require a prior broad public launch.

## Gate B: ready for the public launch

- Every route and call to action works, and installation/code examples have been checked against the pinned release candidate.
- The hosted demo passes the listed scenarios using the actual release-candidate gateway/SDK and Kafka path. Test session isolation, expiration, cleanup, denial, reconnect, and unavailable/busy behavior.
- Website and demo work with keyboard navigation, visible focus, readable contrast, screen-reader labels, reduced motion, and narrow/mobile layouts. Browser checks cover the declared supported browsers.
- Page titles, descriptions, social previews, sitemap, canonical URLs, and a useful not-found page are present. Measure page loading and demo startup on a named device/network profile and fix issues that obstruct the walkthrough; no unmeasured performance claims.
- A timed internal walkthrough reaches the promised result, including failure/recovery. No external research or recruitment gate is required.
- Release claims, screenshots, support matrix, quickstart, and limitations agree. Site content references a specific tested build and is rechecked against the final release before publication.
- HTTPS, deployed socket connectivity, secrets handling, quotas, health monitoring, rollback, and the unavailable fallback are verified in staging. Actual operating limits, budget, and operator are recorded.

The launch deliverables are the home site, integrated live demo, public documentation, and reproducible local example. A placeholder page or recording alone does not complete this milestone. After publishing, smoke-test the real URLs and demo; use the documented rollback/fallback if verification fails.

## Keeping the experience accurate

Update docs and snippets with each release. Rerun demo scenarios when gateway, SDK, auth, or snapshot behavior changes. Refresh screenshots when the workbench changes materially. Keep release history separate from planned work, and retain a visible path to the local example when the hosted demo is unavailable.

Measure our own walkthrough completion and operational health before adding conversion analytics. Analytics and persistent visitor tracking are not launch dependencies. Prioritize a maintained, trustworthy example over additional marketing pages.
