# Source register

Research snapshot: **28 September 2026**. Repository: **jfricano/StreamOtter** at `7b406780dd52c921cf88a98834e81e1677fc4a8d`.

Sources support documented capabilities, not independent proof of performance. Mutable vendor documentation must be rechecked and version-pinned when a research task begins. Source IDs are stable within this report package.

## S01 — Founding direction

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/FOUNDING.md

Full document; mission, audience, owned-gateway decision, research posture.

## S02 — Product versions and API roadmap

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/API_AND_FEATURE_ROADMAP.md

Full roadmap through V3 and beyond; illustrative APIs, sequencing and compatibility.

## S03 — V1 API specification

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/V1_API.md

Sections 5–8 and 11–13 inspected; state consistency, progress, access, limits and implementation refinements.

## S04 — V1 implementation status

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/IMPLEMENTATION_STATUS.md

Implementation tables, reported verification, support matrix, limitations and Gate A. Reported results not rerun.

## S05 — Production deployment guide

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/DEPLOYMENT.md

Full document; single-gateway boundary, production surface, proxy and restart behavior.

## S06 — Existing research brief

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/RESEARCH.md

Executive assessment and sections 1–5 plus beginning of section 6 inspected; not every linked historical discussion independently rechecked.

## S07 — Home site and live demo plan

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/WEBSITE_AND_DEMO_PLAN.md

Full document; separate Lontra Creek project, dependency direction, Gate A/B, generator request.

## S08 — Synchronization acceptance-test source

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/tests/integration/sync.test.ts

Lines 1–130 inspected; snapshot/update race, revision deduplication and invalidation. Not executed.

## S09 — Documentation index

Repository document / source. Accessed 2026-09-28.

https://github.com/jfricano/StreamOtter/blob/7b406780dd52c921cf88a98834e81e1677fc4a8d/docs/README.md

Full document; document hierarchy and package/guide locations.

## S10 — Centrifugo: app-owned state with stream subscriptions

Primary external documentation. Accessed 2026-09-28.

https://centrifugal.dev/blog/2026/07/27/app-owned-state-stream-subscriptions

Vendor technical explanation; July 27, 2026. getState and Kafka example; not an independent benchmark.

## S11 — Centrifugo: stream history and recovery

Primary external documentation. Accessed 2026-09-28.

https://centrifugal.dev/docs/server/history_and_recovery

Current documentation; bounded cache, positioning, replay, fallback. Deployment/edition/version must be pinned for tests.

## S12 — Centrifugo: asynchronous consumers

Primary external documentation. Accessed 2026-09-28.

https://centrifugal.dev/docs/server/consumers

Kafka ingestion and server API command consumers; not equivalent to StreamOtter V3 application commands.

## S13 — Ably: Kafka connector

Primary external documentation. Accessed 2026-09-28.

https://ably.com/docs/platform/integrations/inbound/kafka-connector

Kafka Connect ingestion into Ably channels; not proof of complete snapshot/checkpoint composition.

## S14 — Ably LiveSync: frontend data models

Primary external documentation. Accessed 2026-09-28.

https://ably.com/docs/livesync/postgres/models

Models lifecycle, initial-state synchronization and recovery; separate surface from Kafka connector.

## S15 — Lightstreamer: Kafka connector

Primary external documentation. Accessed 2026-09-28.

https://lightstreamer.com/products/kafka-connector/

Vendor feature description; routing, adaptive delivery, schema support and auth. Promotional performance claims not adopted.

## S16 — Lightstreamer Kafka connector README

Primary external documentation. Accessed 2026-09-28.

https://github.com/Lightstreamer/Lightstreamer-kafka-connector/blob/main/README.md

Vendor-maintained technical reference; mutable branch, pin release before comparative execution.

## S17 — Aklivity documentation and edition overview

Primary external documentation. Accessed 2026-09-28.

https://docs.aklivity.io/latest/

Protocol and edition descriptions; distinguish community gateway from governed console offerings.

## S18 — Zilla: SSE proxy

Primary external documentation. Accessed 2026-09-28.

https://docs.aklivity.io/latest/concepts/proxy/sse/

Protocol mediation comparator; not assumed identical to SDK state semantics.

## S19 — Zilla: HTTP proxy

Primary external documentation. Accessed 2026-09-28.

https://docs.aklivity.io/latest/concepts/proxy/http/

HTTP/Kafka interaction comparator for later command investigation.

## S20 — Socket.IO: delivery guarantees

Primary external documentation. Accessed 2026-09-28.

https://socket.io/docs/v4/delivery-guarantees/

Ordered delivery and application work needed beyond default at-most-once delivery.

## S21 — Socket.IO: connection-state recovery

Primary external documentation. Accessed 2026-09-28.

https://socket.io/docs/v4/connection-state-recovery/

Recovery can fail and adapter support varies; use a competent, version-pinned baseline.

## S22 — Apache Kafka 4.1 design

Primary external documentation. Accessed 2026-09-28.

https://kafka.apache.org/41/design/design/

Versioned reference aligned with repository-tested broker family; ordering, commits and delivery boundaries.

## S23 — PostgreSQL: transaction isolation

Primary external documentation. Accessed 2026-09-28.

https://www.postgresql.org/docs/current/transaction-iso.html

Current documentation resolved to PostgreSQL 18; concurrency and snapshot semantics, not a chosen StreamOtter store.

## S24 — Redis: persistence

Primary external documentation. Accessed 2026-09-28.

https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/

Persistence configuration and failure tradeoffs; default settings not presumed adequate for a delivery contract.

## S25 — Debezium: outbox event router

Primary external documentation. Accessed 2026-09-28.

https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html

Reference for application-owned transactional outbox integration; not a required new dependency.

## S26 — Confluent: schema evolution and compatibility

Primary external documentation. Accessed 2026-09-28.

https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html

Format-specific and configured compatibility rules; distinguish upstream schemas from public channel compatibility.

## S27 — AsyncAPI: adding messages

Primary external documentation. Accessed 2026-09-28.

https://www.asyncapi.com/docs/concepts/asyncapi-document/adding-messages

Messages/channel documentation model; export must describe actual implementation.

## S28 — OWASP: WebSocket security

Primary external documentation. Accessed 2026-09-28.

https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html

Access, origin, lifecycle, validation and resource-control guidance; no security certification implied.

## Retrieval and execution limits

The Medium article body could not be retrieved during this pass. Its title and the earlier discussion supplied context only; technical conclusions are anchored to the inspected repository and primary vendor documentation. The hyphenated repository name returned 404; the connected repository `jfricano/StreamOtter` resolved successfully. No external interviews, benchmark runs, application deployment, independent security audit, npm verification, or examination of Lontra Creek’s separate launch evidence was performed.
