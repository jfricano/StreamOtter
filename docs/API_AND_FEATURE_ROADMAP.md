# StreamOtter: product versions and API roadmap

**Plan the whole experience. Build it in useful increments.**

September 24, 2026 · Planning revision 0.2 · No implementation released

## Purpose and authority

This document translates the [founding direction](./FOUNDING.md) and [research](./RESEARCH.md) into a phased feature set and a forecast of the APIs that support it. It is the working scope for product and API design. The founding document owns the mission; this document owns feature sequencing; implementation specifications will own exact signatures and algorithms.

V1 is our committed starting scope. V2 and V3 define the direction we are designing toward, with bounded increments inside each. Later possibilities are intentionally outside those commitments. Code, package names, and routes below are illustrative API proposals, not installable software or final specifications.

We are making these decisions from public research and product judgment. Interviews and competing prototypes are not prerequisites. Release readiness means the promised behavior works in its declared operating conditions.

## 1. The three-version vision

| Version | Developer outcome | Product identity | Main operating boundary |
| --- | --- | --- | --- |
| **V1 — Connect and understand** | Add live state to an existing web application and understand why an update did or did not arrive. | Local workbench, TypeScript integration, and a single Node.js gateway using Socket.IO. | JSON state channels; authoritative snapshots; bounded live delivery; one gateway. |
| **V2 — Recover and scale** | Keep event feeds recoverable across interruptions and distribute delivery across gateways. | A delivery runtime with retained history, durable checkpoints, and deployment visibility. | Explicit retention windows, replay budgets, ordering scope, and a supported shared-storage topology. |
| **V3 — Act and operate together** | Send authorized application commands and manage integrations across teams and environments. | A governed application event interface with shared operational workflows. | Named commands, scoped access, versioned configuration, and controlled deployment. |
| **Beyond V3 — Extend the reach** | Apply the same model to more ecosystems and operating environments. | Additional adapters, SDKs, and optional managed services. | Added only as separately scoped increments. |

The progression is cumulative. V1 state channels continue working in V2 and V3. A developer should not need durable history, multiple servers, or team administration merely to receive an order-status update.

These are product milestones, not a promise of three breaking API releases. A product release called V2 may still use protocol version 1 and the same compatible SDK major version.

## 2. The feature model

Every feature should serve one of these developer jobs:

| Job | What StreamOtter owns | What the application continues to own |
| --- | --- | --- |
| Connect a source | Connection profiles, health checks, decoding, source lifecycle. | Broker provisioning, credentials, and ownership of source data. |
| Define a useful channel | Parameter validation, routing, public payload shape, delivery policy. | Business meaning, allowed audiences, and domain identifiers. |
| Receive updates | Subscription lifecycle, connection handling, SDK types, cleanup. | Rendering and application state changes. |
| Recover state or events | Explicit synchronization/replay contracts and recovery outcomes. | Authoritative state and business processing semantics. |
| Diagnose delivery | Stage-level traces, health, queues, errors, and replay status. | Operational response and application-specific logging. |
| Send a command, from V3 | Validation, authorization, idempotency handling, and broker acceptance reporting. | Business execution and its eventual success or failure. |
| Operate as a team, from V3 | Scoped workspaces, configuration history, access and deployment controls. | Infrastructure policy and identity-provider administration. |

## 3. Feature allocation

**Core** means required for that version. **Extend** means retain the earlier behavior and add the named capability. **Deferred** means the API should leave room for it without implementing it now.

| Feature | V1 | V2 | V3 | Beyond |
| --- | --- | --- | --- | --- |
| Local web workbench | Core: connect, define, integrate, inspect | Extend: replay and topology | Extend: shared environment operations | Optional hosted workbench |
| Kafka connectivity | Core: configured profiles; documented TLS/SASL support | Extend: multiple independently configured clusters | Extend: environment-scoped profiles | Additional messaging systems |
| Local fixtures | Core: deterministic data and failure scenarios | Extend: recovery/rebalance scenarios | Extend: command scenarios | Shared fixture packs |
| Payload contracts | Core: JSON validation and TypeScript generation | Extend: Schema Registry, then Avro decoding | Extend: compatibility checks in deployment | Protobuf and additional codecs |
| Application channels | Core: named, parameterized, authorized state channels | Extend: retained event channels | Extend: governed channel catalog | More specialized channel types |
| Mapping and filtering | Core: server-side mapping and exact parameter matching | Extend: declared, bounded filtering | Extend: shared reusable policies | Advanced transformations |
| Browser SDK | Core: subscribe, state, events, unsubscribe | Extend: resume, checkpoint, paged history | Extend: named commands | Other language SDKs |
| Framework integration | Core: vanilla TypeScript and React example | Extend: supported React hooks | Maintain | Other framework bindings |
| Socket.IO | Core | Maintain | Maintain | Maintain |
| Plain WebSocket / SSE | Deferred | Deferred | Extend: plain WebSocket adapter | SSE and other adapters |
| Recovery | Core: snapshot and explicit resynchronization | Extend: retained replay and durable checkpoints | Maintain | Long-term archival recovery |
| Flow control | Core: bounded queues and explicit overload | Extend: replay quotas and shared budgets | Extend: per-workspace quotas | Adaptive policies |
| Gateway deployment | Core: one gateway | Extend: multiple gateways and coordinated delivery | Extend: environment operations | Multi-region deployment |
| Access control | Core: application identity and subscription policy | Extend: history authorization and cross-node revocation | Extend: workbench roles and workspace isolation | Enterprise identity options |
| Observability | Core: health, structured errors, local event trace | Extend: persistent metadata, metrics export, topology | Extend: audit history and shared diagnostics | Broader integrations |
| Configuration | Core: file-based, validate and export | Extend: migration tooling and deployment checks | Extend: revisions, promotion, rollback | Fleet management |
| Browser-to-backend commands | Use existing application API | Use existing application API | Core: named command API | Specialized workflows |
| Documentation generation | Core: types and examples | Extend: AsyncAPI export | Extend: catalog and change reports | Broader generators |
| Public home site and integrated demo | Launch milestone after tested V1: home site, docs, live order-status demo | Extend only for shipped recovery/scale increments | Extend only for shipped command/team increments | Additional examples as needed |

Multiple brokers within one Kafka cluster are part of ordinary connectivity in V1. Multiple independently configured clusters are the later feature; we do not equate a cluster with one broker.

## 4. API surfaces and shared concepts

There are four interfaces to design together:

1. **Server configuration API:** describes sources, channels, handlers, access rules, and delivery policies. The gateway executes it.
2. **Application SDK:** lets browser applications subscribe and handle events and state changes. Later versions add recovery and commands.
3. **Management API:** powers the workbench and CLI. It validates configuration and reports operational state; later it manages environments and deployments.
4. **Transport protocol:** carries the SDK’s logical messages. Socket.IO is the first adapter; application concepts must not expose Socket.IO rooms or connection IDs as durable identities.

| Concept | Meaning | Stability rule |
| --- | --- | --- |
| `Source` | A configured stream connection and its decoding policy. | Referenced by an application-defined ID, never by embedded credentials in client code. |
| `Channel` | An application-facing contract such as `orderStatus`. | Independent of topic names, gateway nodes, and transport rooms. |
| `ChannelVersion` | The version of a channel’s payload and behavior contract. | Breaking payload or semantic changes get a new channel version. |
| `Subscription` | One authorized request for a channel and validated parameters. | Has its own lifecycle; can survive transport reconnection logically. |
| `Event` | An envelope containing application data and delivery metadata. | Event identity, domain revision, and recovery cursor are separate fields. |
| `Principal` | Identity established by server-side authentication. | Tenant and user claims are verified; client parameters cannot grant access. |
| `Cursor` | An opaque position within a recoverable channel stream, from V2. | Scoped to stream identity and definition; never assumed to be one Kafka offset. |
| `Command` | A named, authorized request for backend action, from V3. | Distinct from publishing to arbitrary topics or confirming business completion. |

The workbench saves serializable configuration. Application functions are supplied through named handler references in a server-side module. Exported configuration must not contain function source, credentials, or browser-authoritative policy logic.

### A common event and error vocabulary

Forecast envelope:

```ts
type StreamEvent<T> = {
  id: string;
  channel: string;
  channelVersion: number;
  kind: "snapshot" | "update"; // V2 adds "event"
  data: T;
  revision?: string;          // required on V1 state snapshots/updates
  cursor?: string;            // available for V2 retained event channels
  receivedAt: string;         // gateway receipt time, not domain event time
};

type StreamError = {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
  details?: Record<string, unknown>; // public, redacted details only
};
```

Use a discriminated union in the final types so invalid combinations cannot be expressed. The abbreviated shape above shows the fields across versions. Clients must handle unfamiliar optional metadata without failing. New message kinds are capability-gated, so older clients never receive kinds they did not negotiate.

Initial error codes include `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_PARAMS`, `CHANNEL_NOT_FOUND`, `SOURCE_UNAVAILABLE`, `INVALID_PAYLOAD`, `OVERLOADED`, `RESYNC_REQUIRED`, and `UNSUPPORTED_CAPABILITY`. V2 adds cursor/history errors; V3 adds command and configuration-conflict errors. Errors explain the stage without revealing protected channel existence or payloads to unauthorized callers.

Connection state and subscription state are distinct. A socket can be connected while a subscription is synchronizing or its source is unhealthy. The SDK exposes both.

## 5. V1 — Connect and understand

### Outcome and scope

A developer connects Kafka, defines a channel for one order’s current state, subscribes from a TypeScript application, and sees the delivery path in the workbench. A disconnect produces a defined state and recovery action.

Required capabilities:

- Fixture source plus Kafka profiles with a declared broker/client compatibility matrix and tested authentication paths.
- JSON payload validation, parameter validation, server-side mapping, and generated TypeScript types.
- Application authentication, per-subscription authorization, expiration handling, and an explicit server-side revocation hook.
- State channels with authoritative snapshots and full replacement updates carrying monotonic domain revisions.
- Reconnection with backoff, bounded buffering, and explicit stale/resynchronization-required outcomes.
- A local workbench with source status, channel editor, authorized subscription preview, event inspector, and configuration export.
- CLI commands for initialization, validation, development, generation, and starting the gateway without the workbench.

### Forecast server configuration

Illustrative configuration shape; named handlers are application code registered separately:

```ts
defineProject({
  configVersion: 1,
  sources: {
    orders: {
      kind: "kafka",
      connectionRef: "orders-cluster",
      topics: ["orders.status"],
      consumerGroup: "streamotter-orders",
      codec: "json"
    }
  },
  channels: {
    orderStatus: {
      version: 1,
      source: "orders",
      paramsSchema: "OrderStatusParams",
      payloadSchema: "OrderState",
      authorize: "canReadOrder",
      map: "toOrderState",
      delivery: {
        kind: "state",
        snapshot: "loadOrderSnapshot",
        revisionField: "revision",
        overflow: "resync"
      }
    }
  }
});
```

The mapping handler returns a channel instance’s validated parameters and public data, rather than a raw socket room. The application’s snapshot and mapping handlers must use the same domain revision system. Connection profiles reference secrets outside this document. Gateway-level limits supply finite queue, message-size, subscription, and synchronization budgets.

### Forecast browser SDK

```ts
const client = createClient<AppChannels>({
  url: "/streamotter",
  getToken: () => session.getAccessToken()
});

const order = client.subscribe("orderStatus", {
  channelVersion: 1,
  params: { orderId: "ord_123" }
});

order.on("data", event => renderOrder(event.data));
order.on("state", state => showDeliveryState(state));
order.on("error", error => showStreamError(error));

await order.ready();
// When the view closes:
await order.unsubscribe();
// When the application closes:
await client.close();
```

Subscription creation is lazy until the next task turn so callers can attach handlers before delivery begins; the final implementation must make this lifecycle explicit. `ready()` resolves after the initial authorized snapshot is accepted, and rejects on terminal setup failure. Recoverable interruptions update state and follow policy. Repeated cleanup is safe. Concurrent subscriptions cannot overwrite one another’s callbacks.

### V1 state contract

V1 delivers current state, not a durable history of every intermediate event. Each channel instance has one ordered domain revision space, represented as a decimal string to avoid JavaScript integer precision loss. A full update replaces the previous state; deltas and arbitrary reducers are outside V1.

On initial subscribe or reconnect, the gateway authorizes the request, establishes live capture into a bounded buffer, then requests the snapshot. It sends the snapshot and discards buffered updates whose domain revision is older than or equal to the snapshot revision. Newer full states follow in revision order. Domain revisions must be comparable for that channel instance; a timestamp or unrelated partition offset is not an acceptable substitute.

The application must provide a snapshot/event consistency contract: both reflect the same domain state progression, and updates after the snapshot boundary become available to the source. Without that contract, StreamOtter cannot infer correctness. Reject a state-channel configuration that lacks the required handlers; report synchronization failure when the contract cannot be honored at runtime.

Buffer overflow, source discontinuity, or failed synchronization marks the subscription stale and triggers a bounded resynchronization attempt. Retry exhaustion produces `RESYNC_REQUIRED`. A fresh socket handshake alone never establishes that the displayed data is current. Healthy source connectivity also does not prove there are no upstream application omissions.

Kafka consumer progress is independent of browser receipt. V1 commits only under the declared source-processing policy; invalid payloads and admission failures have visible outcomes. It has no persistent per-client checkpoint. After a gateway restart, clients resynchronize from the authoritative state.

### Workbench and management API

V1 management is local to the development environment, on a separate interface from client delivery. Bind locally by default and require a local session credential and origin checks for workbench operations. Browser application credentials do not grant management access.

| Proposed route | Purpose |
| --- | --- |
| `GET /management/v1/capabilities` | Report config, protocol, transport, and delivery capabilities. |
| `GET /management/v1/health` | Report source and gateway status with structured reasons. |
| `GET /management/v1/sources` | List configured sources with redacted connection information. |
| `POST /management/v1/source-checks` | Test a supplied profile reference and return staged diagnostics. |
| `GET /management/v1/channels` | List channel contracts available to the operator. |
| `POST /management/v1/config/validate` | Validate a candidate configuration without applying it. |
| `POST /management/v1/config/export` | Return the validated, portable configuration artifact. |
| `GET /management/v1/traces` | Query bounded recent diagnostic metadata using pagination. |

V1 exports files; configuration changes take effect through a documented restart. Live production editing is not implied. Preview uses an explicit test principal and the same channel policy path as the application. Fixture injection and forced disconnect controls operate only in the development environment.

### Definition of done

A sample application works with fixtures and real Kafka. It can receive authorized state, deny unauthorized access, recover after disconnect/restart, expose source failure, and respect configured queue limits. Exported assets run without the workbench. Trace stages distinguish source read, validation, authorization/routing, queue admission, and send; they do not claim that a human saw an event.

## 6. V2 — Recover and scale

### Outcome and scope

An application can consume a retained event feed, resume after interruption within a configured window, and continue through a gateway replacement. Operators can understand replay backlog and cross-node delivery.

V2 adds a second channel mode, `events`, while preserving V1’s `state` mode. Retained history requires a supported durable delivery store. That dependency is optional for V1 deployments and mandatory for V2 replay deployments.

### Forecast API additions

```ts
// Additional server-side delivery configuration:
delivery: {
  kind: "events",
  history: { storeRef: "delivery-history", retention: "24h" },
  resume: { onUnavailable: "error" },
  acknowledgement: "after-handler"
}

// Browser-side use; all values are illustrative:
const activity = client.subscribe("orderActivity", {
  channelVersion: 1,
  params: { orderId: "ord_123" },
  recovery: {
    checkpointStore: durableCheckpoints,
    checkpointKey: "orderActivity:ord_123",
    onUnavailable: "error"
  }
});

activity.handle(async event => {
  await applyIdempotently(event.id, event.data);
});

const page = await client.history("orderActivity", {
  channelVersion: 1,
  params: { orderId: "ord_123" },
  after: savedCursor,
  limit: 100
});
```

`handle()` and `on("data")` are alternative delivery-consumption styles, not two independent acknowledgement paths on the same subscription. For `after-handler`, the SDK advances its checkpoint only after the handler succeeds and checkpoint persistence completes. Failure can cause duplicate delivery; handlers must tolerate it. The full checkpoint key is namespaced by gateway/project, verified principal, channel version, and canonical parameters to prevent accidental reuse across users.

History reads are authorized, paginated, and bounded. They do not alter a live subscription’s checkpoint. Explicit manual acknowledgement can be a later V2 increment if needed; it is not necessary to expose every acknowledgement strategy immediately.

### Delivery semantics and architecture

V2’s target is resumable, at-least-once application delivery while history remains available and the client retains a valid checkpoint. It is not unconditional delivery to indefinitely offline clients. Event identity survives redelivery. Automatic client checkpoint persistence is not atomic with arbitrary application side effects, so exactly-once application processing is not promised.

Append accepted records to durable delivery history before committing their source progress. Make append retries idempotent using stable source identity plus the relevant channel mapping/version. The source-to-store handoff must survive a crash between append and source commit. A notification or fanout message only wakes delivery workers; retained history is the authority for replay.

A cursor identifies the channel stream and its generation/position, including enough context to invalidate it when the channel definition or history changes. Multi-partition input requires an explicit sequencing strategy; a scalar cursor must not pretend that unrelated Kafka offsets share one order. Authorize recovery again, and reject reuse against incompatible parameters or channel versions. Ordering is per declared channel instance, not global across all channels.

Replay must transition into live delivery at a defined boundary, without silently skipping intervening records. Expired or invalid cursors return `CURSOR_EXPIRED` or `CURSOR_INVALID`. Unavailable retained history returns `HISTORY_UNAVAILABLE`. A state-channel fallback can request a fresh snapshot; an event channel defaults to an explicit error rather than silently skipping to the newest event.

Use shared history and coordinated ownership before enabling multiple gateways. Kafka ingestion ownership and socket connection ownership remain separate. Define fencing for stale ingestion owners, stable event identity during rebalances, shared revocation, and bounded notifications. Reconnecting to a different gateway must not depend on the original process’s memory.

The chosen storage engine and ownership algorithm need a focused architecture decision before V2 implementation. This does not delay the V1 API; its channel, identity, and cursor boundaries are designed for this extension.

### Other V2 additions

Add replay progress and cursor inspection to the workbench; node/source topology; queue and source-lag metrics; bounded diagnostic history; and metrics export. Payload capture remains separate from metadata retention.

Add Schema Registry references and JSON Schema integration first, then Avro decoding into the public JSON application contract. Upstream compatibility and public channel compatibility are separate checks. Registry formats and compatibility behavior differ, so each supported codec needs its own declared path. [Confluent Schema Registry concepts](https://docs.confluent.io/cloud/current/sr/fundamentals/index.html)

Generate AsyncAPI documentation for channel messages and operations, alongside TypeScript output. AsyncAPI models those concepts explicitly; export must describe the actual direction and transport used by StreamOtter. [AsyncAPI messages](https://www.asyncapi.com/docs/concepts/asyncapi-document/adding-messages)

Management adds paged history inspection, replay-job creation/status/cancellation, and node/topology reads. A replay job used for diagnosis is scoped to a preview consumer; it must not republish historical messages into every live client subscription.

### Definition of done

Demonstrate recovery with duplicate-tolerant handlers across client and gateway restarts, cursor expiration, revoked access, and interrupted source-to-store handoff. Bound concurrent replay work. For the distributed increment, reconnect a client to another node and verify routing and recovery under a declared workload. V1 configuration continues to work without enabling the history store.

## 7. V3 — Act and operate together

### Outcome and scope

Applications can submit approved commands through StreamOtter, and teams can manage the same integration across development, staging, and production with clear access and configuration history.

### Forecast command API

```ts
// A named server definition, with application-owned handlers:
defineCommand({
  name: "requestOrderRefresh",
  version: 1,
  inputSchema: "OrderRefreshRequest",
  authorize: "canRequestOrderRefresh",
  destination: "order-refresh-commands",
  idempotency: { required: true, window: "24h" }
});

const receipt = await client.command("requestOrderRefresh", {
  commandVersion: 1,
  params: { orderId: "ord_123" },
  idempotencyKey: "application-generated-stable-key"
});
// receipt: { commandId, status: "accepted", acceptedAt }
```

Commands target allowlisted server-side destinations. Validate and authorize each request. Enforce message-size, rate, and per-principal limits. The idempotency record is durable and scoped to principal, command version, and key; reuse with a different payload is a conflict. Retries with an unknown outcome reuse the original key.

`accepted` means the configured durable command handoff has completed. It does not mean the backend performed the requested business action. The backend can later publish an outcome event carrying `commandId`; the application subscribes through a normal channel. Command timeout can mean the outcome is unknown, so the API provides receipt lookup and an explicit status model.

The command handoff must account for crashes between idempotency storage and broker publication. Design an outbox or equivalent coordinated mechanism before shipping it. Backend handlers still need idempotent processing. StreamOtter does not own the application’s business transaction.

### Team and environment management

Introduce workspaces, environment-scoped profiles, operator/viewer/deployer roles, shared revocation, and auditable configuration revisions. Versioned deployments refer to immutable artifacts and secret references. Reject concurrent writes using revision preconditions. Rollback creates a deployment of a previous compatible artifact; it does not undo Kafka records or reverse application side effects.

The management API gains resources for workspaces, environments, configuration revisions, deployments, command receipts, and audit events. Long-running operations return job IDs with status and cancellation where safe. Workbench actions and CLI actions use the same API and authorization rules.

### Transport extension

Add a plain WebSocket adapter with an explicit StreamOtter subprotocol and the same logical subscription, event, and error envelopes. Socket.IO remains supported. The SDK selects among supported, negotiated capabilities; transport fallback must not silently weaken delivery semantics.

SSE remains beyond V3’s core scope. It may later carry server-to-client subscriptions while commands and acknowledgements use HTTP, but only with an explicit capability and authentication model. Adding a transport is a contract-mapping task, not a find-and-replace of socket calls.

### Definition of done

Verify command authorization, retry/idempotency behavior, ambiguous outcomes, and the distinction between acceptance and business completion. Prove workspace/environment isolation and auditable deployment changes. Run the same declared subscription behavior through Socket.IO and the plain WebSocket adapter. Existing V1 and V2 applications retain their configured semantics.

## 8. Incremental delivery inside each version

These are ordered increments, not calendar estimates. Each adds working behavior to the same product; no competing prototypes or interview stage is required.

| Increment | Deliverable | Depends on |
| --- | --- | --- |
| V1.0-a | Channel/envelope/configuration contract; fixture source; SDK lifecycle; minimal event inspector. | This roadmap translated into an API specification. |
| V1.0-b | Kafka adapter, application authentication, JSON mapping and parameter validation. | Stable source and channel interfaces. |
| V1.0-c | Snapshot synchronization, overload behavior, revocation, and staged diagnostics. | V1.0-b plus the application snapshot contract. |
| V1.0 | Usable workbench, generated TypeScript example, CLI/export, deployment recipe, engineering checks. | The complete V1 workflow. |
| V1 public launch | First-class home site, public docs, integrated live demo, reproducible local example, and verified demo operations. | Tested V1.0 release candidate; website/demo launch gate. |
| V1.x | KafkaSocks migration guide, configuration polish, fixture improvements, compatibility fixes. | V1 API; no durable replay required. |
| V2.0 | Retained event channels, delivery store, cursors, paged history, SDK checkpoints. | Stable event identity and a storage handoff design. |
| V2.1 | Multiple gateways, ownership/fanout, shared revocation, topology and metrics. | Durable recovery independent of process memory. |
| V2.2 | Schema Registry/Avro integration, React hooks, AsyncAPI export. | Public channel contracts and compatible generation tooling. |
| V3.0 | Named commands, durable idempotency, receipt lookup and outcome correlation. | Durable storage primitives and scoped application identity. |
| V3.1 | Team workspaces, environments, configuration revisions, promotion/rollback, audits. | Management authorization and immutable deployment artifacts. |
| V3.2 | Plain WebSocket adapter with SDK capability negotiation. | Stable logical protocol and a shared behavior test suite. |

The V2 and V3 visions are complete across their listed increments. Documentation must state which increment actually contains a feature; the broader version label cannot imply that all planned features already shipped.

### Public experience sequencing

The home site and integrated `/demo` are first-class launch deliverables, specified in the [home site and demo plan](./WEBSITE_AND_DEMO_PLAN.md). Build the reusable order-status application and scenario checks during V1. Begin the polished site and hosted demo after V1 passes its engineering acceptance gate, then finish them before the broad public launch and before V1.x/V2 feature expansion unless explicitly reprioritized. This launch milestone is separate from runtime completion and does not introduce a new API version.

The hosted demo uses the real V1 SDK and production gateway with isolated Kafka and synthetic application data. Public demo controls belong to the example application's API; management/development endpoints remain private. Hosting an example does not add a managed StreamOtter service or V3 team workspaces to V1. Timing is gate-based; no calendar estimate is committed before the runtime is verified.

## 9. Compatibility decisions to make in V1

- **Keep channel and topic names separate.** Routing and broker changes must not force frontend renames.
- **Separate version axes.** Track product milestone, package SemVer, `configVersion`, channel/command versions, and negotiated protocol version independently.
- **Negotiate capabilities.** Clients discover supported delivery modes and operations. Unsupported requests fail clearly; V1 cannot silently accept a V2 recovery option.
- **Preserve meaning.** Changing retention, overflow, ordering, authorization scope, or acknowledgement behavior is a semantic change, even if the JSON shape stays the same.
- **Keep cursor internals private.** V1 does not emit pretend durable cursors. V2 introduces them as an optional, capability-gated field.
- **Use portable configuration and handler references.** Visual editing, CLI use, and source control share one model. Do not promise that arbitrary application code can be round-tripped through a form.
- **Separate application and management authority.** Future workspaces extend operator scope without giving browser clients configuration access.
- **Define source lifecycle and cancellation.** Internal adapters need connect, consume, health, stop, and progress boundaries. Do not publish a third-party adapter API until an additional adapter establishes the real common interface.
- **Prefer additive changes.** Do not remove a supported public operation within its package major version. Breaking releases require a migration guide and configuration conversion where possible.

Stable source record identity includes the source/cluster incarnation and record coordinates. If a topic is recreated or a mapping changes meaning, identity and recovery generation must reflect that change. Public traces may expose redacted source coordinates to operators; application cursors remain opaque.

## 10. Beyond V3

| Candidate | Value | Dependency or reason it is deferred |
| --- | --- | --- |
| SSE adapter | Simpler one-way HTTP delivery for suitable applications. | Map recovery, authentication, and acknowledgements without losing semantics. |
| Protobuf and additional formats | Fit more existing Kafka ecosystems. | Codec-specific compatibility and generation work. |
| Other brokers | Reuse the channel experience outside Kafka. | Prove a source contract that represents differing broker semantics honestly. |
| Additional SDKs | Reach mobile, backend, and other frontend environments. | Stable protocol plus lifecycle behavior suited to each environment. |
| Managed hosting | Reduce operating burden. | Tenant isolation, metering, service operations, and a separate commercial scope. |
| Multi-region delivery | Regional latency and resilience. | Explicit cross-region consistency, recovery, and cost policies. |
| Stream transformations and joins | Build derived feeds inside the product. | A distinct processing model; avoid hiding a new stream processor inside mapping hooks. |
| Long-term archive/replay | Recover beyond the hot history window. | Storage cost, indexing, privacy, and replay throughput design. |
| AI-assisted configuration and diagnosis | Help explain errors and draft configuration. | Reliable deterministic diagnostics and reviewable output first. |

These are options, not release promises. None changes V1’s dependency footprint.

## 11. What is settled and what needs a specification

**Settled:** the audience; local workbench plus SDK plus owned gateway; Kafka and Socket.IO first; state channels before retained event channels; single gateway before distributed delivery; commands and shared operations in V3; incremental compatibility.

**Before V1 implementation:** specify exact handler signatures, the state snapshot handshake, source commit/error policy, finite default limits, authentication/revocation hooks, event/error unions, management-session protection, and generated types. Select and pin a Kafka client through its internal adapter and declare the initially supported connection/authentication paths. These are bounded implementation decisions within the chosen scope.

**Before later increments:** document the V2 delivery store and ownership mechanism, schema compatibility rules, V3 command handoff/idempotency, and environment isolation. Do not implement placeholder storage, commands, or team-management systems merely to reserve their names.

The [V1 API specification](./V1_API.md) now makes the server configuration, SDK subscription, snapshot lifecycle, and errors concrete. Its detailed contracts supersede this roadmap’s illustrative sketches. The [implementation handoff](./IMPLEMENTATION_HANDOFF.md) defines the build sequence.

## Evidence behind the sequencing

The detailed developer accounts remain in the [research brief](./RESEARCH.md). The roadmap’s placement of features follows three constraints:

- Connection success and event delivery are different guarantees, making explicit state handling necessary in V1. [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- Retained recovery introduces stream identity, history availability, and resource questions, so it gets its own V2 storage and delivery boundary. Existing recovery systems also distinguish stream generation and position. [Centrifugo recovery](https://centrifugal.dev/docs/server/history_and_recovery)
- Kafka-to-WebSocket distribution needs an explicit relationship between event consumption and connection ownership, making multiple gateways a distinct increment. [Kafka Summit architectural discussion](https://www.confluent.io/events/kafka-summit-europe-2021/delivering-from-kafka-to-websockets/)

The precise version assignments and API shapes are StreamOtter’s design decisions, not claims that the sources prescribe this roadmap.
