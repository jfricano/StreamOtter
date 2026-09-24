# StreamOtter

## Founding document

**Make live data straightforward to build with—and understandable when it breaks.**

September 14, 2026 · Founding direction 0.2

This document establishes StreamOtter’s direction. We are committing to build from public developer accounts, technical documentation, and our own product judgment. The scope below describes what we will build; it does not describe software already shipped. The accompanying [research brief](./RESEARCH.md) records the evidence and the assumptions behind our decisions.

## Why we exist

A developer sets out to build a live dashboard, an order-status view, or a progress indicator. The underlying events already exist. Making them useful in an application should be a manageable integration task.

Instead, that developer can inherit another system to design and operate: connections, subscriptions, routing, permissions, retries, buffering, deployment behavior, and the uncomfortable question of whether the screen still reflects reality after a connection fails.

StreamOtter exists to reduce that burden. We want developers to spend their time building useful experiences with live data, with a clear understanding of how those experiences behave in production.

KafkaSocks began with a practical insight: developers repeatedly assemble the same bridge from Kafka to the frontend. Its original implementation wrapped KafkaJS consumers and Socket.IO namespaces in a small API. StreamOtter carries that intent forward and expands the ambition from convenient setup to a coherent integration experience. [KafkaSocks repository](https://github.com/oslabs-beta/Kafkasocks)

**Our mission is to make connecting Kafka events to live applications intuitive, observable, and dependable within clearly stated limits.**

Our founding belief is that simplicity must survive the first disconnect, deployment, and debugging session. A short example is valuable. A system the developer can understand and maintain is the real outcome.

## The problem we choose to own

The gap between an event stream and a usable application is both technical and experiential. KafkaJS cannot run directly in a browser, so teams need a server-side boundary. That boundary also has to translate infrastructure events into an application’s subscriptions and behavior. [KafkaJS FAQ](https://kafka.js.org/docs/faq)

The research supports six connected problems:

| Developer problem | Consequence | StreamOtter’s intended response |
| --- | --- | --- |
| A working bridge leaves many operational decisions to the application team. | Each feature accumulates setup and lifecycle code that must be maintained. | One guided path from source to browser, with reusable configuration and a supported integration package. |
| A successful send or reconnect is easy to mistake for complete delivery. | A screen can look connected while missing updates. | Explicit delivery modes, recovery outcomes, and a visible resynchronization path. |
| Kafka consumers and connected browsers are distributed differently. | A second server can expose routing assumptions hidden by a single-server demo. | Documented deployment patterns and tests that exercise clients on different nodes. |
| Fast streams meet slow or disconnected clients. | Buffers grow, clients fall behind, and recovery can become a resource spike. | Bounded queues, explicit overload behavior, and recovery budgets. |
| Permissions must follow the user and the data. | A topic or channel mapping can expose information to the wrong subscriber. | Server-enforced authorization and payload selection throughout subscription and recovery. |
| The integration crosses several independent components. | Developers struggle to locate the stage at which an update stopped. | A traceable event path and diagnostics that explain the next useful action. |

Routing and recovery have direct developer reports behind them; Socket.IO documentation confirms delivery limitations; browser-platform guidance explains backpressure; OWASP describes authorization responsibilities. Our response is a unified workbench and integration runtime that make those responsibilities manageable. That product choice is our judgment, informed by the evidence. [Routing report](https://stackoverflow.com/questions/58385826/routing-messages-from-kafka-to-web-socket-clients-connected-to-application-serve), [recovery report](https://github.com/socketio/socket.io/discussions/5423), [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [browser backpressure](https://developer.chrome.com/docs/capabilities/web-apis/websocketstream), [WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

## The narrative behind the product

The developer begins with a feature and gradually acquires an infrastructure project. First comes the connection, then deployment configuration, then the question of which server holds which user’s socket. Once the happy path works, disconnects and slow clients expose behavior the example never specified.

Public accounts describe different parts of this progression. A React developer reports repeated deployment attempts while untangling networking, Docker, domains, and client settings. A Python toolkit author describes repeatedly writing dispatch branches, validation, and documentation by hand. These are accounts from adjacent WebSocket workflows, rather than Kafka-specific measurements, but they reinforce the integration burden around the transport. [Deployment account](https://www.reddit.com/r/react/comments/1ptzfkv/does_anyone_else_struggle_so_much_with_setting_up/), [Toolkit author’s account](https://www.reddit.com/r/Python/comments/1o0m9yt/tired_of_messy_websockets_i_built_chanx_to_end/)

Our conclusion is that much of the frustration comes from having to assemble one understandable application behavior out of separately configured parts. StreamOtter will give that work a home: connect the source, define the audience and behavior, generate the integration, and see where each update goes.

The interface earns its place by answering practical questions: Why is nothing arriving? Who can see this event? Is this screen current? What happens when the connection returns? We will build around those questions from the first release.

## Who we serve first

Our initial user is a JavaScript or TypeScript application developer on a team that already uses Kafka and needs live information in a web application. They understand their product and can work with backend services, but do not want every live feature to become a bespoke messaging project.

The first use cases are operational dashboards, job progress, and order or workflow status. These give us concrete ways to implement routing, freshness, reconnection, and recovery. An existing application API can remain the source of authoritative state.

Platform engineers are an important second audience: they need an integration that application teams can adopt consistently, review in source control, and operate within infrastructure policies.

We will initially avoid making chat infrastructure, financial transaction processing, mobile background notifications, and arbitrary stream processing the center of the product. These introduce requirements beyond the first integration problem. We also should not require teams to adopt Kafka solely to use StreamOtter.

We choose this audience because it continues KafkaSocks’ original focus and gives the product a concrete integration boundary. Market size and willingness to pay remain unknown; neither prevents us from building the first release.

## Our philosophy

### 1. Optimize for time to a trustworthy feature

We will measure the path from first connection to a feature that can recover, explain its state, and be handed to another developer. Saving setup time matters, but so does reducing the work needed to diagnose tomorrow’s missing update.

A first-run experience should connect a source, show a sample, define the intended audience, and place an event in a browser. The next step should deliberately interrupt that connection and explain what happened.

### 2. Make important decisions understandable

We will ask questions in application terms: Who should receive this? Does every update matter? How stale can the screen become? What should happen after an outage?

Those choices must map to explicit configuration. Advanced settings remain available, with enough context to explain their effects. An intuitive interface helps developers make sound decisions and inspect the result.

### 3. Be precise about delivery

We will distinguish an event read from Kafka, accepted by the delivery layer, sent over a connection, and acknowledged by application code. Acknowledgement does not establish that a human saw the update.

Kafka’s transaction guarantees do not automatically extend to a browser. Ordering also has a scope: Kafka partitions provide an ordering boundary, not a universal ordering across every event. StreamOtter must document the guarantees its complete path actually provides. [Apache Kafka design](https://kafka.apache.org/41/design/design/)

We will not promise universal exactly-once browser delivery. Each supported mode must name its persistence boundary, duplicate behavior, recovery window, and fallback when recovery is impossible.

### 4. Treat failure behavior as part of the interface

Disconnected, catching up, stale, unauthorized, and resynchronization required should be usable application states. They should have both programmatic representations and clear explanations in the workbench.

Recovery must be bounded. The developer should be able to see when a cursor has expired or a history window is unavailable and use an explicit fallback. Socket.IO itself documents that recovery can fail and applications still need synchronization behavior. [Connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)

### 5. Match delivery to the meaning of the data

A temperature display may only need the newest reading. An activity feed may require every retained event. The product must make that distinction explicit.

For state-oriented views, support refreshing an authoritative snapshot and applying subsequent changes. For replayable feeds, require a defined history window and resume behavior. Dropping intermediate values or combining updates is allowed only when the application’s selected policy permits it.

The first release should implement one coherent mode well. Other modes become supported only when their behavior is tested.

### 6. Keep data access under the application’s control

Kafka credentials remain on the server. Applications expose approved channels and payloads rather than allowing a browser to request arbitrary internal topics.

Authorization applies when subscriptions are created and recovered, and when permissions change. Replaying history must respect current access. Inspection tools should redact sensitive values and make payload capture deliberate. These are concrete integration requirements, consistent with OWASP’s guidance on WebSocket access control. [WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

### 7. Leave developers with understandable assets

The interface combines a guided workbench with ordinary, versioned configuration and code. A developer should be able to review changes, reproduce them in CI, and operate the integration without keeping the workbench open.

The workbench and runtime must share one configuration model. Secrets are referenced rather than exported into generated source. Compatibility, upgrade paths, and limitations belong in the product, alongside the quickstart.

### 8. Build on existing strengths

Centrifugo, Zilla, Ably, and Lightstreamer already address meaningful portions of Kafka-to-client delivery. Their existence strengthens the case that this is a real category, while raising the bar for a new product. [Centrifugo consumers](https://centrifugal.dev/docs/server/consumers), [Zilla gateway](https://www.aklivity.io/zilla-gateway), [Ably Kafka connector](https://ably.com/docs/platform/integrations/inbound/kafka-connector), [Lightstreamer Kafka connector](https://lightstreamer.com/products/kafka-connector/)

We will build a StreamOtter-owned gateway on established Kafka and socket libraries, alongside the workbench and client integration. Existing products inform our feature choices and documentation. Our differentiation will be the quality of the complete developer workflow: configuration, integration, failure rehearsal, and diagnosis. We accept that this overlaps an existing category and take responsibility for making the experience useful.

## What the experience should feel like

A developer is adding live order status to an existing application.

1. **Connect.** Choose a local fixture or supply a server-side connection profile. Connection diagnostics explain the failing stage without revealing credentials.
2. **Define.** Select an approved source, preview its payload, and expose an application channel such as an individual order’s status. Define which users may subscribe.
3. **Choose behavior.** Decide whether the view needs the latest state or a retained event sequence. See the consequences for gaps, duplicates, ordering, and recovery.
4. **Integrate.** Export reviewable configuration and a small TypeScript client example that includes cleanup, error handling, and connection states.
5. **Inspect.** Follow a sample event from source through routing and delivery. See filtered, rejected, delayed, and acknowledged outcomes separately.
6. **Rehearse.** Disconnect a client, slow it down, revoke access, and restart the gateway. Verify the expected result before deployment.

The first workbench will be a locally served web interface. It will operate the same configuration used by the gateway, and the gateway will run independently when the workbench is closed. This gives us a concrete starting point without requiring a managed cloud or a desktop distribution.

## The first product boundary

The first release is a narrow Kafka-to-browser integration for state-oriented web interfaces, with a TypeScript client, a locally served workbench, and a StreamOtter gateway running on Node.js.

It will include a fixture-driven quickstart, one supported Kafka connection path, JSON payloads, explicit channel mapping, authorization hooks, bounded buffering, connection diagnostics, and a snapshot/resynchronization example. The gateway will continue working independently of the workbench. Broker access will sit behind an internal adapter so the selected Kafka client can change without changing the public application API.

Socket.IO will be the first client transport, preserving continuity with KafkaSocks and giving us existing connection and subscription primitives to build on. It uses a protocol distinct from plain WebSocket, so our SDK and documentation will state that dependency explicitly. StreamOtter will own the channel, recovery, and diagnostic contracts above it. Plain WebSocket and SSE adapters are later additions; SSE remains a valid alternative for one-way updates. [Socket.IO introduction](https://socket.io/docs/v4/), [HTML standard: server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

The first implementation will use one gateway, with consumers managed per configured source rather than per browser connection. We will document that deployment boundary. Multi-node support will be added with explicit fanout and cross-node routing; capacity and reliability claims will reflect the behavior actually verified in that topology.

Durable per-client replay, a managed cloud, support for additional messaging systems, a visual stream-processing canvas, broad language SDKs, and general browser-to-Kafka command publishing are later decisions. The initial command path can remain in the application’s existing API, where business validation already lives.

## Our standard for the first release

We will use concrete engineering acceptance criteria as we build. These describe intended behavior, not results already achieved.

| Area | Standard |
| --- | --- |
| First run | A documented path from local fixture to browser, targeting 15 minutes on a machine with the stated prerequisites. Record our own walkthrough time; treat external time savings as unmeasured. |
| Integration | Exported configuration and the TypeScript example work independently of the workbench, including cleanup and failure handling. |
| Diagnosis | Seeded connection, payload, routing, and authorization failures identify the failing stage and a useful next action. |
| State recovery | Disconnect and restart produce either a correctly resynchronized view or an explicit stale/resynchronization-required state. |
| Overload | Slow clients and concurrent reconnects respect configured resource bounds and expose their outcomes. |
| Access | Unauthorized subscriptions fail; revocation and recovery do not restore access that has been removed. |
| Deployment | Verify the supported single-gateway deployment first. Exercise cross-node routing before declaring multi-node support. |

Latency and capacity measurements will name the payload size, client count, event rate, fanout, and deployment environment. A disconnected client’s catch-up time is a separate measurement from connected-client delivery latency.

## How we move forward

We have enough evidence to choose a direction and start building. Public developer reports, issue discussions, and documentation will provide the research input. We will make product decisions from that evidence and our own judgment, without making interviews, design-partner recruitment, usability studies, or competing prototypes prerequisites.

Build the complete first path: a local source, a configured application channel, a browser subscription, a visible event trace, and explicit disconnect/resynchronization behavior. Then connect that same path to Kafka and package it for an existing TypeScript application.

The [API and feature roadmap](./API_AND_FEATURE_ROADMAP.md) phases this direction into V1, V2, V3, and later increments. It defines the feature boundaries and API concepts before the V1 API specification makes the contract concrete.

Maintain the research brief as a record of evidence and decisions. New findings can sharpen the implementation as it develops. Our default is to keep building within this scope, fixing concrete problems as they appear.

**Our promise is to give developers a shorter path to live applications they can understand, verify, and maintain.**
