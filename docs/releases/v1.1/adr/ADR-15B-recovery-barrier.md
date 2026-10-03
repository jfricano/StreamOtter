# ADR-15B: Application recovery barrier and failure classification

**Status:** Accepted · September 29, 2026 · Decides spec §4, §7 and the snapshot handler change
**Baseline read:** `packages/gateway/src/runtime/gateway.ts` (`#process`, `#buildOutput`), `runtime/subscription.ts` (`#beginAttempt`, `onSourceReady`), `packages/contracts/src/types.ts` (`ChannelHandlers`, `HandlerRegistry`) at `7b40678`.

## Context

This is the riskiest part of V1.1. Continuing past a quarantined record is only honest if the application can show that its snapshots already cover whatever that record would have changed. Two things in the current code shape the design.

**Classification is coarser than the taxonomy.** The spec's policy table distinguishes "invalid JSON" from "public payload violates its schema" from "invalid tenant/params/revision". In code, all of these come back as `INVALID_PAYLOAD`, separated only by the trace stage (`validate` or `map`). A schema violation and a bad `tenantId` both come out of `#buildOutput` as a plain string. A tombstone and an oversize record are also `INVALID_PAYLOAD` at `validate`. A policy keyed on the public error code would therefore let an integrity failure (bad revision, bad tenant) be quarantined and skipped. That is exactly what INV-03 forbids.

**Recovery already has the right shape.** When a paused source becomes ready, `#setSourceStatus` calls `onSourceReady` on every subscription, which starts a fresh attempt: authorize, capture, snapshot, drain, `live`. Subscriptions created while the source is held wait in `waiting-source`. So the barrier only needs to be enforced at one point: the snapshot result inside `#beginAttempt`.

## Decision

### 1. An internal failure class, separate from the public error code

`#process`'s `pause()` and `#buildOutput` return a closed internal `FailureClass`, alongside the unchanged public `ErrorCode`:

| FailureClass | Raised where today | Eligible for quarantine-resync |
| --- | --- | --- |
| `invalid-json` | `validate`: UTF-8 decode, parse, or nesting | yes |
| `payload-schema` | `#buildOutput`: `validateValue(payloadSchema)` fails | yes |
| `mapper-transient` | new `TransientMappingError` thrown by `map` | retry only |
| `mapper-error`, `mapper-timeout` | `map` threw or timed out | evidence only |
| `routing-invalid` | `#buildOutput`: tenantId, params, revision, extra field, not an object, output count | no |
| `revision-conflict` | equal revision with different data | no |
| `tombstone`, `oversize` | `validate` | evidence only |

`#buildOutput` already checks routing fields (object shape, tenantId, params, revision) before the payload schema, but it returns only a message string. It needs to return which check failed. That's a small refactor with no public behavior change, and it has to land first (slice A).

### 2. The guard is a source handler

`HandlerRegistry` gains an optional `sources` map. Keys must be the source IDs whose policy uses `quarantine-resync`. Startup validation fails if a resync source has no guard, or if a guard names an unknown source.

```ts
interface SourceRecoveryHandlers {
  recover(input: HandlerContext & {
    incident: { failureId: string; failureClass: "invalid-json" | "payload-schema"; position: SourceRecord["position"]; evidenceHash: string };
    generation: string;
    prior: RecoveryBoundary | null;          // the cumulative boundary still in force
  }): Awaitable<
    | { decision: "hold"; reason: string }
    | { decision: "recoverable"; boundary: RecoveryBoundary; evidenceRef: string }
  >;
}
interface RecoveryBoundary { id?: string; context: Json }  // context ≤ 16 KiB; the gateway assigns id
```

It runs with the 10 s handler timeout, one guard at a time per source. `hold`, a throw, a timeout, or a missing guard all leave the source held. The returned boundary must carry forward `prior`: the guard gets the old context and returns a new cumulative one. The gateway doesn't interpret `context`. It stores it and passes it back.

### 3. Snapshots acknowledge the boundary

The snapshot input gains an optional `recovery`, and the output gains an optional acknowledgment:

```ts
snapshot(input: HandlerContext & { principal; params; recovery?: { boundaryId: string; context: Json } })
  : Awaitable<{ revision; data; recoveryBoundaryId?: string }>
```

While a source has a boundary in force, every snapshot on every channel of that source receives it. The attempt succeeds only if the result echoes the same `recoveryBoundaryId`. That includes subscriptions created later and reconnects. A missing or different ID fails the attempt with `SOURCE_UNAVAILABLE`, which reuses the existing backoff and keeps the subscription `stale`. There's no new public state and no protocol change.

The change is additive. Existing V1 handlers compile unchanged, and handlers on sources with no boundary never see `recovery`.

### 4. Retiring a boundary

The draft never says when a boundary stops being required. Without a rule, every snapshot on the source must acknowledge it forever. Proposed: a boundary stays in force until one of these happens:

- the guard, called with `prior` on the next incident, returns a superseding boundary (it replaces the old one, it doesn't stack);
- an operator runs `sources retire-boundary` with the boundary ID and its expected revision. That's recorded in the journal and doesn't apply to held incidents;
- the source's `generation` changes, which is already V1's rebaseline mechanism.

**Accepted by the owner on September 29, 2026: the developer picks per source.**

```json
"failureHandling": { "sources": { "orders": { "boundaryRetirement": "generation" } } }
```

| Mode | How a boundary is retired | Tradeoff |
| --- | --- | --- |
| `generation` (default) | Only by changing the source `generation` | Safest: nobody can clear a boundary on a hunch. Every snapshot on the source must keep acknowledging it until a rebaseline. |
| `application` | After each acknowledged snapshot, the gateway calls an optional `retire({ boundary })` on the source's recovery handlers. `true` retires it, recorded in the journal. | Automatic and evidence-backed, for example a database watermark permanently past the boundary. The application owns the truth of that answer, as it already owns snapshot consistency. Startup fails if `retire` is missing. |
| `operator` | `sources retire-boundary <boundaryId> --expected-revision N --reason "…"` | Most convenient. The reason is required and audited. It's a human assertion, the "looks safe" override §7.2 warns about, so it's opt-in only. |

A generation change always retires every boundary, whichever mode is set. No mode ever retires a boundary while its incident is still held.

**Operator mode is the unsafe option, and the documentation must say so.** Retiring a boundary tells the gateway that every future snapshot already reflects the quarantined record. StreamOtter can't check that. If the claim is wrong, subscribers can reach `live` while showing state that's missing the change the quarantined record carried, and nothing downstream will flag it. The configuration reference, the CLI help for `sources retire-boundary`, and the runbook all carry that warning. The CLI prints it and asks for confirmation before sending the command.

Suggested uses, all where a person can actually verify the claim:

- **Development and fixtures**, where the data is synthetic and a wrong call costs nothing.
- **The record provably had no state effect**, for example a duplicate, a test message published to the wrong topic, or an entity that has since been deleted and whose snapshot handler returns the deletion.
- **A verified manual repair**: someone corrected the authoritative store by hand, confirmed that snapshots reflect the fix, and records what they checked in `--reason`.
- **A bridge before `application` mode exists**, used rarely and reviewed, while the team writes a real `retire` handler.

Not a use: clearing a boundary so snapshot handlers can drop the acknowledgment code, or to make an alert go away. When operator retirement becomes routine on a source, that source needs `application` mode.

### 5. Reference implementation

The order-dashboard example gets a guard backed by a watermark column that its snapshot query reads in the same transaction. The guard returns `{ watermark }` only when the application's own outbox shows the failed record's order ID was re-published or never changed state. A guard that just returns `recoverable` is rejected in review, as the handoff requires.

## Consequences

- Slice A grows by the `FailureClass` refactor. Without it the policy table can't be implemented safely.
- `contracts/v1/api.ts` and the generator gain additive types. `contracts/v1/type-tests.ts` needs cases for them.
- If the reference guard turns out impractical to write honestly, that's the signal to ship V1.1 as quarantine-hold plus retry only (owner decision D2 in the action plan).
- Tests F20–F26 apply, plus: an integrity failure under a resync policy stays held; a snapshot without the acknowledgment never reaches `live`; a subscription created after the incident needs the acknowledgment.
