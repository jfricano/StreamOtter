# V2.3 event journey verification (proposal)

**Status:** proposal, revision 0.2 · September 29, 2026. Not approved and not scheduled. It proposes a V2 increment after V2.2 and does not change the V2.0 delivery-store commitment. Until the owner decisions below are made and the design gate passes, the [roadmap](../API_AND_FEATURE_ROADMAP.md) remains authoritative.

## Revision 0.2 (fit review)

Revision 0.1 was the submitted planning supplement. Revision 0.2 keeps its product job, concepts, and kill criteria, and changes these points to fit the project:

- **Mission and audience fit.** The [founding document](../FOUNDING.md) centers Kafka-to-live-application developers and keeps arbitrary stream processing out of the product. Observing warehouses such as BigQuery reaches a different audience. The first increment now verifies boundaries StreamOtter can already observe (Kafka topics and its own delivery leg). A non-Kafka sink is an explicit owner decision, not a default (see [Fit with the product boundary](#fit-with-the-product-boundary)).
- **Dependencies split.** V2.0 is the only hard dependency. V2.1 and V2.2 constrain or improve the design but don't block a single-gateway, JSON-only first increment.
- **V1.5 relationship corrected.** V1.5 quarantine covers state channels only. For event channels, V2 holds on a bad record and records a visible history gap. Both are now named as reasons an event may not reach the first boundary.
- **Authority and security.** Journey evidence is management-plane data under the existing management authorization, never delivered on application channels. Destinations are named connection profiles, never arbitrary URLs, matching `POST /source-checks` in the [V1 API](../V1_API.md).
- **Observation must be read-only.** Watching a topic or sink must not change the progress of the application's own consumers or StreamOtter's delivery sources.
- **Numeric comparison.** The example's `scale` by `0.01` would produce floating-point mismatches (for example `1999 * 0.01` is `19.990000000000002`). Numeric conversions now declare exact decimal semantics.
- **Gate language.** The research and prototype gate is now the roadmap's design gate for this increment, and the roadmap carries a short V2.3 row marked as proposed.
- **Prior art.** The kill criteria now name the tools to compare against before committing.

## Placement

Event journey verification belongs in **V2**, provisionally as **V2.3**, after the existing V2.0 to V2.2 increments.

The capability asks a different question from V1 and V1.5:

> Given an accepted source event and declared expectations for downstream boundaries, can StreamOtter show whether the corresponding event arrived where expected, within the expected window, with only the transformations the developer declared?

It needs:

- **V2.0 (hard dependency):** durable, retained evidence and stable event identity. A `pending` result must survive a gateway restart, so process-local traces aren't enough.
- **V2.1 (constraint):** under multiple gateways, one observation must produce one journey conclusion. If V2.3 ships before a deployment uses V2.1, it is single-gateway only, like V1.
- **V2.2 (improvement):** Schema Registry and Avro decoding make real Kafka pipelines comparable, and contract references are reused in expectations. A JSON-only first increment doesn't need them.

It does **not** depend on V3 commands, team workspaces, deployment promotion, or the plain WebSocket adapter. Putting it in V3 would couple a read-only verification workflow to unrelated write and governance features.

It does not belong in V1.5 either. V1.5 is deliberately about source-failure containment and controlled recovery for state channels. Journey verification follows accepted events across several independently observed boundaries and must not grow the V1.5 incident journal into a general event store.

## Product job

StreamOtter already answers, or is moving toward answering:

1. **What should this application-facing event or state look like?**
2. **Did StreamOtter accept and deliver it correctly?**
3. **Can a client recover it after an interruption?**
4. **Did the same logical event survive the downstream journey we declared?** (V2.3)

The progression becomes **define → observe → recover → verify**.

This is not a general stream processor, ETL platform, or data-quality warehouse. StreamOtter verifies declared event journeys; it does not own the business pipeline being verified.

## Fit with the product boundary

The founding audience is a JavaScript or TypeScript developer on a team that already uses Kafka and needs live information in a web application. The founding document also separates the facts an event passes through (read from Kafka, accepted, sent, acknowledged), and V1.5 INV-07 keeps each observation a distinct fact. Journey verification extends that same discipline upstream: each declared boundary is its own observation.

So the proposal is staged:

- **In scope for the first increment:** Kafka topics reached through configured connection profiles, and StreamOtter's own retained event channels. A typical journey is `orders.created → enrichment → orders.enriched → StreamOtter channel`, which answers the question that audience actually has: "why does my live view show something different from what the producer sent?"
- **Owner decision:** one non-Kafka observation adapter (BigQuery or PostgreSQL). It widens the audience toward data engineering and adds connector maintenance. The roadmap's rule for Beyond V3 candidates applies: it becomes part of an increment only with a decision naming the job, the dependency and support cost, and what it excludes.

## Motivating scenario

A service emits an `OrderCreated` event:

```text
orders-service
  -> Kafka: orders.created
  -> enrichment service
  -> Kafka: orders.enriched
  -> StreamOtter channel: orderActivity         (first increment)
  -> warehouse loader
  -> BigQuery: analytics.orders                 (only if the sink decision is made)
```

The developer declares that:

- `eventId` remains the correlation identity;
- `customerId` becomes `customer_id`;
- `totalCents` becomes `total` by exact division by 100;
- `createdAt` is normalized to UTC;
- `discountCode` must survive unchanged;
- each downstream representation should appear within a bounded window.

For a sampled event, StreamOtter can then report:

```text
OrderCreated evt_abc123

Kafka / orders.created        observed
Kafka / orders.enriched       observed
Channel / orderActivity       observed
BigQuery / analytics.orders   observed    (only with a sink adapter)

customerId -> customer_id     expected transformation: pass
totalCents -> total           expected transformation: pass
createdAt -> UTC              expected transformation: pass
discountCode                  required preservation: fail
arrival window                pass
```

The report establishes only what StreamOtter actually observed under the configured correlation and comparison rules. It does not prove that every event in the pipeline is correct.

## Core concepts

### Journey

A `Journey` is a developer-declared sequence or graph of observation boundaries for one logical event family. It references existing StreamOtter sources, connection profiles, and channel contracts where possible, and adds observation-only boundaries where necessary.

### Observation boundary

A boundary is a place StreamOtter can inspect without becoming the owner of the pipeline:

- a Kafka topic, through a configured connection profile;
- a retained StreamOtter event channel;
- one downstream sink adapter, only after the owner decision above.

Observation is read-only. A Kafka boundary uses its own consumer identity and never commits offsets for the application's consumers or for StreamOtter's delivery sources. A sink boundary reads through a named connection profile with read-only credentials. Additional databases, brokers, HTTP services, or arbitrary application instrumentation wait until one end-to-end path proves the abstraction, consistent with the roadmap's rule not to publish an adapter API before a second adapter establishes the common interface.

### Correlation identity

A journey must declare how observations are correlated. V2.3 must **not** compare "the latest source record" with "the latest sink row." A result is valid only when StreamOtter has a defensible rule connecting observations to the same logical event.

Preferred order:

1. a preserved, stable application event ID;
2. an explicitly declared mapping to a destination correlation field;
3. a bounded composite key, if the application can guarantee its uniqueness for the journey.

Timestamp proximity alone is not sufficient correlation.

The application's correlation ID is separate from StreamOtter's own identities. Stable source record identity (source or cluster incarnation plus record coordinates, roadmap §9) anchors the origin observation. V2.0 cursors stay opaque and must never be, or encode, the correlation ID.

### Transformation contract

A transformation contract describes the allowed semantic differences between two boundaries. The first operations are intentionally small and deterministic:

- preserve;
- rename;
- omit, when explicitly allowed;
- add or default, when explicitly declared;
- deterministic scalar conversion, with exact semantics declared (decimal arithmetic and precision for numbers, time zone and precision for timestamps);
- a deterministic expression over declared source fields, only if it can be evaluated safely and reproducibly.

Arbitrary JavaScript functions, remote calls, joins, aggregations, and inferred business transformations are outside the first increment. This keeps the founding exclusion of arbitrary stream processing, and keeps "stream transformations and joins" a separate Beyond V3 candidate.

### Verification result

A result is evidence, not a claim of universal pipeline correctness. Proposed statuses:

| Status | Meaning |
| --- | --- |
| `verified` | All required observations were found and the declared checks passed. |
| `mismatch` | Correlated observations exist, but one or more declared checks failed. |
| `missing` | A required downstream observation wasn't found within the configured window. |
| `inconclusive` | StreamOtter couldn't establish sufficient correlation or observation coverage. |
| `pending` | The journey window hasn't expired. |

`inconclusive` is a first-class result. The product prefers uncertainty over false certainty.

A result for an event that never reached the first boundary should say why when StreamOtter knows: a V1.5 quarantine record (state-channel sources) or a V2 history gap (event-channel sources). Neither record becomes journey history.

## Configuration direction

Illustrative only:

```ts
defineJourney({
  name: "order-created-to-activity",
  version: 1,
  event: {
    source: "orders",
    topic: "orders.created",
    correlation: { field: "eventId" }
  },
  boundaries: [
    {
      id: "enriched",
      kind: "kafka",
      source: "orders",
      topic: "orders.enriched",
      correlation: { field: "eventId" },
      arrivalWithin: "1m"
    },
    {
      id: "activity",
      kind: "channel",
      channel: "orderActivity",
      channelVersion: 1,
      correlation: { field: "eventId" },
      arrivalWithin: "1m"
    }
    // Only after the sink decision:
    // { id: "warehouse", kind: "bigquery", connectionRef: "analytics-warehouse",
    //   table: "analytics.orders", correlation: { field: "event_id" }, arrivalWithin: "5m" }
  ],
  expectations: [
    { from: "event.customerId", to: "enriched.customer_id", rule: "rename" },
    { from: "event.discountCode", to: "activity.discountCode", rule: "preserve" },
    { from: "event.totalCents", to: "activity.total", rule: "divide", by: 100, numeric: "decimal" }
  ]
});
```

The final model reuses StreamOtter's schema references, connection profiles and secret references, capability negotiation, redaction rules, and stable source identity rather than creating a parallel configuration system. A journey version binds to the channel and schema versions it names, so an old expectation is never silently applied to a new shape.

## Workbench experience

V2.3 extends the workbench rather than creating a separate product. It sits beside the V2 replay and topology views.

### Journey view

Shows:

- the declared boundaries;
- whether each boundary has been observed;
- the correlation identity and what the match is based on;
- elapsed time between observations;
- expected transformations;
- field-level mismatches;
- links back to retained event and source evidence, where the operator is authorized.

### Event journey inspector

For one selected event:

```text
source record -> observation A -> observation B -> destination
```

Each edge states what is known:

- correlated by `eventId`;
- expected rename;
- expected conversion;
- elapsed time;
- mismatch or missing observation.

It must not imply that an uninstrumented intermediate service was observed merely because the event appears before and after it.

### Verification runs

A verification run is bounded, against:

- one selected event;
- a small explicit sample;
- a deterministic fixture scenario (extending the local fixtures, as V1.5 did for quarantine).

Continuous production-wide auditing is not part of the first increment.

## Architecture boundaries

### What V2.3 owns

- journey declarations;
- correlation rules;
- read-only observation adapters;
- deterministic transformation expectations;
- bounded verification execution;
- evidence and mismatch reporting;
- redaction and authorization of verification evidence.

### What V2.3 does not own

- modifying or repairing business events;
- replaying records into business topics;
- ETL execution;
- arbitrary stream transformations or joins;
- warehouse data modeling;
- exactly-once business processing;
- proving end-to-end correctness for events it did not observe;
- production-wide data-quality monitoring.

The Beyond V3 candidate "stream transformations and joins" stays separate. V2.3 may **describe** expected transformations for verification without executing them in the business pipeline.

### Authority and evidence

Journey configuration and evidence are management-plane data. They use the existing management authorization (and V1.5 operator authority where it applies) and are never exposed on application channels to browser clients. V3.1 workspaces and roles would later scope who can configure journeys and inspect evidence.

Evidence retention follows the roadmap's rule that payload capture is separate from metadata retention. By default a result keeps metadata and per-field outcomes. Retaining payload values for comparison is an explicit option, with hashing or redaction per field, as with V1.5 full evidence capture.

## Relationship to existing increments

### V1 and V1.5

No dependency changes for state-only users. Journey verification is capability-gated and absent unless configured. A V1 user never picks up a database or sink connector by upgrading.

V1.5 quarantine evidence may explain why an event never became eligible for a journey, but the failure journal is not journey history.

### V2.0

V2.0 supplies stable event identity and the durable evidence model that anchors a journey. The V2.0 delivery store must not be redesigned around V2.3 before V2.3 is approved.

One compatibility seam is worth recording in the [V2.0 store outline](../releases/v2.0/STORE_DESIGN_OUTLINE.md) when that decision is written: retained-event metadata should be able to carry or reference an application correlation ID without making it the StreamOtter cursor.

### V2.1

Persistent diagnostics and topology are natural foundations for cross-boundary evidence. Distributed ownership must not create duplicate journey conclusions for the same observation.

### V2.2

Schema Registry and Avro support make comparison against real Kafka ecosystems more useful. Contract and schema references are reused in journey expectations.

### V3

V3.0 commands may later create useful journey starting points: a command receipt could correlate to a resulting event. That is an optional future integration, not a V2.3 dependency.

## Design questions to settle before implementation

1. **First sink:** whether to add a non-Kafka adapter at all in the first increment, and if so whether BigQuery or PostgreSQL (materially easier to run locally) better proves the product job.
2. **Observation strategy:** poll destination systems, subscribe where possible, or support both behind explicit semantics.
3. **Correlation:** the minimum evidence required before StreamOtter labels two records the same logical event.
4. **Sampling:** how events are selected without turning StreamOtter into a high-volume duplicate ingestion system.
5. **Retention:** which journey evidence belongs in the V2 delivery store, and which needs a separate bounded verification record.
6. **PII and secrets:** which payload fields may be retained for comparison, and how users hash or redact fields while still verifying them.
7. **Schema evolution:** how journey versions bind to source, channel, and schema versions.
8. **Timing:** how `missing` is distinguished from merely late, especially for eventually consistent downstream systems.
9. **Transformations:** what tiny rule language covers useful mappings without becoming a stream-processing DSL.
10. **Cost:** what read amplification verification adds to Kafka and, if chosen, to the sink.

## Design gate

This is the short design decision the roadmap requires before a dependency-heavy increment. It is local only, uses no paid infrastructure, and does not implement the full feature. A spike must show, with one realistic pipeline:

1. StreamOtter correlates a Kafka event to its downstream representation without "latest record" heuristics.
2. A deliberately introduced field loss or type or value mismatch is detected.
3. A legitimate declared transformation passes, including an exact decimal conversion.
4. A delayed but valid downstream record moves from `pending` to `verified`, while a truly absent record becomes `missing`, across a gateway restart.
5. Ambiguous correlation returns `inconclusive`.
6. Observing the pipeline doesn't change any application consumer's offsets and doesn't require StreamOtter to act as the application's ETL processor.
7. The setup is materially easier to understand than hand-written, one-off reconciliation code.

Suggested prototype pipeline:

```text
fixture producer -> Kafka -> small transformer -> Kafka -> StreamOtter event channel
                                                        (-> first sink, if chosen)
```

Deterministic cases to inject: unchanged event; allowed rename; allowed scalar conversion; dropped required field; wrong type or value; duplicate delivery; delayed delivery; missing downstream record; ambiguous correlation.

## Acceptance direction

If approved after the gate, V2.3 should not ship until it demonstrates:

- stable event-to-observation correlation;
- explicit, versioned journey configuration;
- bounded observation and storage costs;
- deterministic comparison semantics;
- truthful `verified`, `mismatch`, `missing`, `inconclusive`, and `pending` outcomes;
- redacted evidence suitable for operator inspection;
- no regression or added service requirement for V1 and V2 users who don't enable journeys.

## Reasons to kill or defer

Move V2.3 back to Beyond V3 if research shows any of these:

- useful verification requires arbitrary user code or a general transformation engine;
- reliable correlation normally requires invasive instrumentation StreamOtter can't justify;
- destination adapters create a large connector-maintenance burden before there is demonstrated demand;
- existing tools already provide the same cross-boundary correlation workflow with comparable setup. Candidates to compare before committing (not yet researched): OpenLineage, Datadog Data Streams Monitoring, and contract or data-quality tools such as Great Expectations and Soda;
- destination query cost or retained evidence makes bounded verification impractical;
- the useful product is actually continuous enterprise data observability rather than developer-focused event debugging.

## Roadmap change

The roadmap now carries a V2.3 row marked **proposed**, pointing here. It becomes a committed increment only after the owner decisions below and a passing design gate. If the gate fails, the row moves to the Beyond V3 table.

## Decisions for the owner

| Decision | Status |
| --- | --- |
| Adopt V2.3 as a proposed V2 increment after V2.2 | Open |
| Whether the first increment includes a non-Kafka sink, and which one (BigQuery or PostgreSQL) | Open |
| Whether payload values may be retained for comparison by default, or only metadata and per-field outcomes | Open |
