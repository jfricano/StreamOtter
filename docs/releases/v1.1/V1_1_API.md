# StreamOtter V1.1 — API specification (draft)

**Status:** Draft revision 0.1, October 3, 2026. This is the interface contract the V1.1 slices build against. It turns the approved [specification](./V1_1_SOURCE_FAILURE_SPEC.md) and [ADR-15A/B/C](./adr/) into concrete declarations. Each section is marked with the slice that ships it; a section becomes normative when its slice merges, and the declarations in `@streamotter/contracts` then govern over this text. Slices A and B are implemented on their branches; slice notes below record where the implementation refined this text.

**Rules for this document.** It adds; it does not restate. Behavior the spec or an ADR already decides is linked, not repeated. Where this draft fills a gap the spec and ADRs leave open, the row in §11 says so, so a reviewer can see every new decision in one place.

## 1. Compatibility summary

- Legacy configurations, handlers and clients compile and behave exactly as in V1 (F01). Every addition is optional.
- No browser protocol change, no new subscription state, no new public `ErrorCode` (spec §7.3, §14).
- `configVersion` stays `1`. The new `failureHandling` key is additive; an older runtime already rejects it as an unknown key (ADR-15C context), which is the refusal spec §14 asks for.
- `resumeSource` keeps "retry, never skip" (ADR-15C §6).

## 2. Project configuration: `failureHandling` (slice A — normative, implemented in `packages/contracts/src/failures.ts`)

`ProjectConfig` gains one optional top-level key. Deployment settings (state directory, operator socket, health) are gateway options, not project configuration (ADR-15C §2).

```ts
export type FailurePolicy = "pause" | "quarantine-hold" | "quarantine-resync";
export type BoundaryRetirement = "generation" | "application" | "operator";

export interface FailureHandlingConfig {
  quarantine?: {
    /** Pre-provisioned topic on the project's single Kafka cluster. Required when a Kafka source uses a quarantine policy. */
    topic: string;
    /** Only "full-record" in V1.1; required so the cost of capturing payloads is an explicit choice. */
    capture: "full-record";
  };
  /** Keyed by source ID. A source with no entry keeps V1 behavior. */
  sources: Readonly<Record<string, SourceFailurePolicy>>;
}

export interface SourceFailurePolicy {
  /** Default "pause". */
  invalidJson?: FailurePolicy;
  /** Default "pause". */
  invalidPublicPayload?: FailurePolicy;
  /** 0 (default), 1 or 2. Above 0 requires replaySafeMapping. */
  transientMapperRetries?: 0 | 1 | 2;
  /** The integrator's declaration that every map handler of this source is side-effect-free and safe to repeat. Required for transient retries and stored redrive. Default false. */
  replaySafeMapping?: boolean;
  /** Circuit breaker for automatic quarantine-resync. Default { incidents: 5, windowMs: 60000 }. incidents 1–20, windowMs 1000–3600000. */
  automaticAdvanceLimit?: { incidents: number; windowMs: number };
  /** Default "generation". Only meaningful with quarantine-resync. */
  boundaryRetirement?: BoundaryRetirement;
}
```

Validation (F02), all reported as `ConfigIssue`s with path and code:

| Rule | Code |
| --- | --- |
| Unknown key anywhere under `failureHandling` | `UNKNOWN_KEY` |
| A policy value outside the closed set. `ignore`, `discard`, `skip` and `force-skip` get a specific message saying V1.1 never skips silently | `INVALID_VALUE` |
| `sources` names a source that doesn't exist | `UNKNOWN_REFERENCE` |
| A Kafka source uses a quarantine policy and `quarantine` is absent | `REQUIRED` |
| `quarantine.topic` equals any configured source topic | `INVALID_VALUE` (topic overlap) |
| `quarantine.topic` not a valid Kafka topic name | `INVALID_VALUE` |
| `transientMapperRetries` > 0 without `replaySafeMapping: true` | `INVALID_VALUE` |
| `boundaryRetirement` set on a source with no `quarantine-resync` policy | `INVALID_VALUE` |
| `automaticAdvanceLimit` out of bounds or set without `quarantine-resync` | `INVALID_VALUE` |

Validation that needs handlers or the host happens at gateway construction (§4), not in `validateProjectConfig`, which stays pure and browser-safe.

Slice A note: until slices B and C merge, gateway construction also refuses `quarantine-hold`, `quarantine-resync` and transient retries as "not supported by this gateway build yet", so a configuration is never accepted and silently run as `pause`. Slice B note: `quarantine-hold` and transient retries are accepted; `quarantine-resync` is still refused. Slice C note: every policy is accepted.

Fixture sources may use quarantine policies in development. Their evidence goes to the local incident store, labeled "fixture evidence, not Kafka" everywhere it appears (§9). Production rejects fixture sources already.

## 3. Handler contracts (slice A)

### 3.1 Transient mapping failures (type normative in slice A; retries ship in slice B)

```ts
/** Thrown by a map handler to request a bounded retry. Recognized by brand, not by message text. */
export class TransientMappingError extends Error {
  constructor(message?: string, options?: { cause?: unknown });
  static is(value: unknown): value is TransientMappingError; // checks Symbol.for("streamotter.TransientMappingError")
}
```

Exported from `@streamotter/contracts` and re-exported by `@streamotter/gateway`, so a duplicated package copy still recognizes it. Retry waits are 250 ms then 1,000 ms, cancellable, each attempt with the normal handler timeout; exhaustion pauses as `mapper-transient` (spec §4).

### 3.2 Recovery guard (ADR-15B §2; types normative in slice A, behavior in slice C)

```ts
export interface RecoveryBoundary { id: string; context: Json } // context ≤ 16 KiB canonical JSON

export interface RecoveryIncident {
  failureId: string;
  failureClass: "invalid-json" | "payload-schema";
  position: SourceRecord["position"];
  evidenceHash: string; // "sha256:<hex>" over the canonical evidence (§5.2)
}

export interface SourceRecoveryHandlers {
  recover(input: HandlerContext & {
    sourceId: string;
    generation: string;
    incident: RecoveryIncident;
    prior: RecoveryBoundary | null;
  }): Awaitable<
    | { decision: "hold"; reason: string }
    | { decision: "recoverable"; context: Json; evidenceRef: string }
  >;
  /** Required when boundaryRetirement is "application". */
  retire?(input: HandlerContext & { sourceId: string; boundary: RecoveryBoundary }): Awaitable<boolean>;
}

export interface HandlerRegistry<C extends ChannelMap> {
  authenticate(...): ...;          // unchanged
  channels: { ... };               // unchanged
  sources?: Readonly<Record<string, SourceRecoveryHandlers>>;
}
```

The gateway assigns the boundary `id` (`rb1:` + random), so `recover` returns only `context`. `reason` and `evidenceRef` are ≤ 512 characters and stored in the journal as operator metadata. The guard runs with a 10-second timeout regardless of `handlerTimeoutMs` (spec §13).

### 3.3 Snapshot acknowledgment (ADR-15B §3; types normative in slice A, behavior in slice C)

```ts
snapshot(input: HandlerContext & {
  principal: Principal;
  params: C["params"];
  recovery?: { boundaryId: string; context: Json };
}): Awaitable<{ revision: Revision; data: C["data"]; recoveryBoundaryId?: string }>;
```

`recovery` is present exactly when the channel's source has a boundary in force. The attempt succeeds only when `recoveryBoundaryId` equals `recovery.boundaryId`. A mismatch or omission is traced as `snapshot`/`rejected`/`SOURCE_UNAVAILABLE` and goes through the existing bounded backoff; the subscription stays `stale`. A `recoveryBoundaryId` returned when no boundary is in force is a snapshot problem (`INVALID_PAYLOAD`), so stale code can't silently pass.

Slice C note (normative for §§3.2–3.3):

- The boundary a snapshot must acknowledge is the one in force when the snapshot starts. If a different boundary is in force when the snapshot would be delivered (checked again after the pre-delivery authorization), the attempt fails as above.
- An acknowledged snapshot is what triggers `retire()` under `boundaryRetirement: "application"`. The call runs one at a time per source, serialized with that source's other failure work, under the 10-second guard budget. The journal refuses retirement while any incident the boundary covers is still held.
- A guard answer is invalid, and recorded as an `error` guard result, when:
  - `decision` is neither `"hold"` with a string `reason` nor `"recoverable"`;
  - `context` is not JSON or is above 16 KiB of canonical JSON;
  - `evidenceRef` is missing or longer than 512 characters.
- A `hold` decision sets the incident's recovery state to `denied`. An error or timeout sets it to `held`.
- `retire-boundary` for operator mode is a slice D operator command. The journal operation it calls exists in this slice.

## 4. Gateway options and construction (slices A, B, E)

```ts
export interface GatewayOptions<C extends ChannelMap> {
  // ...existing fields unchanged
  /** Persistent directory for the failure journal and the operator socket. Required when any source uses a quarantine policy in production. */
  stateDirectory?: string;
  /** Opt-in local operator IPC (slice D). true uses <stateDirectory>/run/operator.sock. */
  operatorSocket?: boolean;
  /** Declared identity of the handler build, recorded in incidents and plan fingerprints. Default "unspecified". ≤ 128 characters. */
  handlerBuildId?: string;
  /** Opt-in read-only health listener (slice E). Loopback by default. */
  health?: { host?: string; port: number };
}
```

Construction-time checks, each a `CONFIG_INVALID` with an `issues` list:

- `handlers.sources` names an unknown source, or a source without `quarantine-resync`.
- A source with `quarantine-resync` has no `handlers.sources[id].recover`.
- `boundaryRetirement: "application"` with no `retire`.
- Production mode, a quarantine policy, and no `stateDirectory`.
- `operatorSocket` without `stateDirectory`.
- A quarantine policy on Node older than 24.15 (§11, row D1).

Development mode without `stateDirectory` uses an in-memory incident store, labeled `"memory"` in status. It is never durable and says so.

Slice B note (normative for `stateDirectory`, `handlerBuildId` and the checks above except `operatorSocket` and `health`):

- Quarantining Kafka sources must share one connection profile, because quarantine writes go to one cluster.
- The Node check applies whenever `stateDirectory` is set with `failureHandling`, since that opens the journal.
- `handlerBuildId` must be 1 to 128 characters.
- `DevelopmentOptions.fixtures` records may be `{ key, raw: string }`. Raw text is decoded exactly like broker bytes, so invalid JSON can be rehearsed (spec §10).
- Startup opens the journal (`openJournal`) and claims the configured sources. It refuses a missing journal (pointing at `streamotter init --failures`), a journal another gateway holds, and an open incident from another source generation.
- With a quarantining Kafka source, startup also checks that the quarantine topic exists and that its `max.message.bytes` is at least `maxSourceRecordBytes` plus 80 KiB.

Slice E note (normative, F48 and spec §14): when `failureHandling` is absent but `stateDirectory` points at an existing journal, startup opens it and refuses (`CONFIG_INVALID`, `details.reason: "failure-handling-removed"`, with `openIncidentSources` and `boundarySources`) while any configured source has an open incident or a recovery boundary in force. Removing `failureHandling` therefore needs the incidents resolved and the boundaries retired first, with it still configured. A journal with nothing outstanding is left untouched. A gateway started without `stateDirectory` cannot see the journal, and the V1 runtime (0.1.0-rc.3) does not read journals at all; it refuses a configuration that still contains `failureHandling` (`UNKNOWN_KEY`). The downgrade procedure is in the runbook.

Slice D note (normative for `operatorSocket`, as implemented in `packages/gateway/src/runtime/gateway.ts`):

- `operatorSocket` must be a boolean. `true` requires both `stateDirectory` and `failureHandling`, because the socket lives in the state directory and serves the failure operator API.
- The socket starts after every source is ready, just before `start()` resolves. If it cannot start (§7 lists the refusals), `start()` rolls back and rejects like any other startup failure.
- `stop()` closes the socket first, before sources drain, so no operation starts during shutdown. Closing removes the socket and the token file.

## 5. Incidents (slices A, B)

### 5.1 Failure classes (ADR-15B §1; normative in slice A)

```ts
export type FailureClass =
  | "invalid-json" | "payload-schema" | "mapper-transient" | "mapper-error" | "mapper-timeout"
  | "routing-invalid" | "revision-conflict" | "tombstone" | "oversize";
```

Where each class is raised, as implemented: `invalid-json` for UTF-8 decode, JSON parse or nesting failures (and a fixture value that isn't JSON); `tombstone` and `oversize` at validation; `mapper-error`, `mapper-timeout` and `mapper-transient` (a `TransientMappingError`, matched by brand) from `map`; `routing-invalid` for a non-array result, too many outputs, a non-object output, an unexpected field, an invalid tenant, parameters or revision, data that isn't JSON, and a frame above `maxDataFrameBytes`; `payload-schema` only when routing passed and the data fails the channel's payload schema; `revision-conflict` for an equal revision with different data.

Only `invalid-json` and `payload-schema` can take a quarantine policy. Infrastructure failures (broker outage, rebalance, shutdown, journal or quarantine failure) are not failure classes; they keep V1's outage handling and never create a skippable incident (spec §4).

Slice B note: the pause outcome carries the class, stage, channel and a bounded diagnosis to the failure service. A separate internal outcome holds a source whose Kafka position moved past a held record without opening a new incident (F27, F30).

### 5.2 Incident model

```ts
export interface IncidentSummary {
  failureId: string;                  // "f1:" + sourceRecordId (ADR-15A §3)
  revision: number;                   // incident revision; every state change increments it
  sourceId: string;
  generation: string;
  position: SourceRecord["position"];
  clusterId: string | null;           // Kafka clusterId at capture; null for fixtures
  failureClass: FailureClass;
  stage: "validate" | "map" | "queue";
  errorCode: ErrorCode;               // the existing public code, unchanged
  channel: string | null;             // failing channel when known
  impact: "source-wide";              // V1.1 never narrows impact (spec §7.1)
  policy: FailurePolicy;
  firstObservedAt: string;
  lastObservedAt: string;
  observations: number;
  evidence: {
    location: "kafka" | "local" | "none";
    completeness: "complete" | "incomplete" | "unavailable" | "expired";
    valueBytes: number | null;        // null for a tombstone
    keyBytes: number | null;
    headerCount: number;
    hash: string;                     // "sha256:<hex>" over key, value and headers
  };
  quarantine: "not-required" | "pending" | "unknown" | "acknowledged" | "failed";
  progress: "held" | "advance-pending" | "advanced" | "retried" | "uncertain";
  recovery: "not-applicable" | "guard-pending" | "held" | "boundary-in-force" | "denied";
  nextAction: "repair-and-retry" | "reassess" | "evaluate" | "reopen-circuit" | "none";
}

export interface IncidentDetail extends IncidentSummary {
  diagnosis: { message: string };     // sanitized; never payload text
  quarantineCoordinates: { partition: number; offset: string } | null;
  boundary: { boundaryId: string; revision: number; retirement: BoundaryRetirement } | null;
  guard: { decision: "hold" | "recoverable" | "error" | "timeout"; reason: string | null; evidenceRef: string | null; at: string } | null;
  fingerprints: { config: string; handlerBuildId: string; policyRevision: string; gatewayVersion: string };
  history: readonly IncidentEvent[];  // bounded, newest last
}

export interface IncidentEvent {
  at: string;
  event: "detected" | "retrying" | "captured" | "quarantine-unknown" | "quarantined" | "held"
    | "advance-pending" | "advance-confirmed" | "snapshot-recovery-required" | "operator";
  detail?: string;
  operationId?: string;
}
```

The `event` names are spec §11.2's structured lifecycle events. They are emitted to the gateway logger as `{ failureId, sourceId, event }` with metadata only.

Slice B note: these operator-facing shapes ship with slice D. The journal's internal record (`IncidentRecord` in `packages/gateway/src/failures/store.ts`) has the same fields. It differs in two ways: `impact` and `nextAction` are derived rather than stored, and `progress` names the retry states `"retrying"` and `"processed"` (a held record that processed on retry) instead of `"retried"`. Slice D maps the record onto `IncidentSummary`.

Slice D note (normative; the types are in `packages/contracts/src/operator.ts`): `IncidentSummary.progress` keeps the journal's vocabulary (`held`, `retrying`, `advance-pending`, `advanced`, `processed`, `uncertain`) instead of mapping onto `retried`, because a lossy mapping would hide whether a retried record processed. `IncidentSummary` also carries `state` and `resolution`, `IncidentEvent` adds `resolved`, the detail's `boundary` carries its `state`, and `IncidentDetail.explanation` holds the plain-language fields the console shows (spec §10).

Slice C note, continuation order (spec §6; ADR-15A ordering step 5). For an eligible record under `quarantine-resync`:

1. A fresh copy of the evidence is written and acknowledged. An older acknowledgment is never reused for an advance.
2. The circuit breaker is checked. When it is open, or when the window already holds `automaticAdvanceLimit.incidents` advances, the circuit opens (persisted) and the record holds.
3. The guard runs with the prior boundary. After the await, the incident must be unchanged: the same revision, open and held. Otherwise the result is ignored.
4. One journal transaction installs the new boundary (superseding the prior one), sets the incident to `advance-pending`, records the guard result and counts the advance in the circuit.
5. The boundary is applied to the runtime, so later snapshots must acknowledge it.
6. `advancePast` commits offset + 1 and reads it back.
7. The incident is then recorded as `advanced` (and resolved). If the source was no longer paused at the record, it goes back to `held`; if the result could not be confirmed, it becomes `uncertain`.

Startup restores the boundary in force before any source can be ready. It reconciles each `advance-pending` or `uncertain` incident against the group's committed offset:
- offset + 1 confirms the advance;
- at or below the record's offset means the advance never happened, and the incident returns to `held`;
- anything further on is unexplained, and the source holds.

## 6. Operator service (slices C, D)

One `OperatorService` (ADR-15C §1), reached in-process, over the local socket, and through development management routes. Every method returns a promise of the shape below or throws a `StreamOtterError`.

```ts
import { getGatewayOperator } from "@streamotter/gateway/operator";
const operator = getGatewayOperator(gateway);
```

| Method | Input | Output |
| --- | --- | --- |
| `status()` | none | `OperatorStatus` |
| `listFailures(q)` | `{ sourceId?, state?: "open" \| "resolved" \| "all", limit? (≤ 200, default 50), cursor? }` | `Page<IncidentSummary>` |
| `showFailure(q)` | `{ failureId, includeRaw?: boolean }` | `IncidentDetail & { raw?: RawEvidence }` |
| `exportFailure(q)` | `{ failureId, includeRaw?: boolean }` | `ReproductionBundle` |
| `retryCurrent(m)` | `{ sourceId, failureId, expectedRevision, reason? }` | `OperationResult` |
| `reassess(m)` | `{ sourceId, failureId, expectedRevision }` | `OperationResult` |
| `reopenCircuit(m)` | `{ sourceId, expectedCircuitRevision, reason }` | `OperationResult` |
| `retireBoundary(m)` | `{ sourceId, boundaryId, expectedRevision, reason }` | `OperationResult` (operator mode only, ADR-15B §4) |
| `evaluate(m)` | `{ failureId, expectedRevision }` | `EvaluationResult` |
| `redrive(m)` | `{ failureId, planId, planFingerprint, expectedRevision, operationId? }` | `OperationResult` |

```ts
export interface OperationResult {
  operationId: string;              // caller-supplied for idempotency, else generated
  result: "completed" | "refused" | "failed" | "unknown";
  outcome: string;                  // e.g. "retried", "held", "advanced", "reprocessed", "superseded", "circuit-reopened"
  incidentRevision: number | null;
  message: string;
}

export interface EvaluationResult {
  validation: "valid" | "invalid";
  errors: readonly { stage: string; failureClass: FailureClass | null; message: string }[];
  outputs: readonly { channel: string; channelVersion: number; routing: "privileged"; revision: string }[];
  eligible: boolean;                // for redrive
  ineligibleReason: string | null;
  plan: { planId: string; fingerprint: string; expiresAt: string } | null; // 5-minute expiry
}

export interface OperatorStatus {
  gateway: { mode: "development" | "production"; version: string; configFingerprint: string; handlerBuildId: string; state: string };
  store: { kind: "sqlite" | "memory"; path: string | null; sizeBytes: number; limitBytes: number; schemaVersion: number };
  quarantine: { topicConfigured: boolean; maxMessageBytes: number | null; minInsyncReplicas: number | null; replicationFactor: number | null } | null;
  sources: readonly {
    sourceId: string;
    status: SourceStatus["status"];
    reason?: ErrorCode;
    policy: { invalidJson: FailurePolicy; invalidPublicPayload: FailurePolicy; transientMapperRetries: number };
    heldIncident: { failureId: string; revision: number } | null;
    circuit: { state: "closed" | "open"; revision: number; recentIncidents: number; windowMs: number; limit: number };
    boundary: { boundaryId: string; revision: number; retirement: BoundaryRetirement; since: string } | null;
  }[];
}
```

Refusals are `result: "refused"` with a specific `outcome` (for example `stale-revision`, `integrity-class`, `plan-expired`, `fingerprint-changed`, `evidence-unavailable`, `circuit-open`, `not-held`), never an exception, so tooling can show them. Malformed input is an `INVALID_REQUEST` exception.

Slice D notes (normative, as implemented in `packages/gateway/src/operator/service.ts`):

- **Every mutation is an operation.** `retryCurrent`, `reassess`, `reopenCircuit`, `retireBoundary` and `redrive` each record their intent in the journal before acting and their `OperationResult` after (`IncidentStore.beginOperation`/`finishOperation`). Only `redrive` accepts a caller-supplied `operationId`; the others generate `op1:` + 32 hex. A reused ID returns the recorded result; a reused ID with a different request is refused (`operation-id-reused`); an ID still running is refused (`operation-in-progress`). At startup every operation still pending becomes `unknown` and is reported, never rerun (F35). Operations touching an incident also add an `operator` event carrying the operation ID.
- **Retry and reassess redeliver the held record.** Both resume the paused source, so the original record is processed again; neither skips it. Under `quarantine-resync`, the redelivered record goes through the slice C order again: a fresh acknowledged quarantine copy, the circuit, then the guard. `reassess` is the restricted form: only an eligible class (`integrity-class` otherwise) under `quarantine-resync` (`policy-not-resync`) whose recovery is `held` or `denied`. Both wait up to 15 s for the record to settle and report `retried` (processed), `advanced`, `held` (failed again, with the diagnosis), or `retrying` (not settled yet).
- **The circuit blocks retries too.** Following ADR-15C §6, `retryCurrent`, `reassess` and the legacy `resumeSource` are refused with `circuit-open` while the circuit of a source with a `quarantine-resync` policy is open. `reopenCircuit` closes it and clears the window; it approves no record.
- **`retireBoundary`** is refused unless the source's `boundaryRetirement` is `"operator"` (`retirement-mode`), and while any incident the boundary lists is held (`incident-held`). The retirement records the reason and operation ID; snapshots stop acknowledging the boundary at once.
- **Evaluate** runs any incident whose evidence can be read back (local fixture evidence, or the quarantine topic at the recorded coordinates, checked against the evidence hash). Reading the topic uses a throwaway consumer group `streamotter-<projectId>-quarantine-read-<uuid>` that never commits and is deleted afterwards, so the gateway's Kafka principal needs Read on the quarantine topic and Read and Delete on groups with that prefix. A copy below the partition's earliest retained offset is `evidence-expired`. It records no traces and admits nothing. A plan is issued only when a redrive would be allowed: the incident was `advanced`, its class is eligible, the source declares `replaySafeMapping`, no integrity incident is open on the source, and the mapping now succeeds. Otherwise `ineligibleReason` says why (`not-advanced`, `not-replay-safe`, `integrity-fault-open`, `still-fails`, `evidence-expired`, `evidence-unavailable`, `stale-revision`, `generation-changed`). A stale or unknown request is reported the same way, not thrown.
- **Plans** live in gateway memory: at most 64, five minutes each, single use, and gone after a restart (`plan-unknown`). The fingerprint is `sha256:` over the incident ID and revision, source generation, evidence hash, configuration fingerprint, handler build ID, channel versions and the canonical mapped-output hash (routing key, revision and data hash of each output, in order).
- **Redrive** rechecks everything at execution, reads the evidence back again, and re-evaluates under the source's processing lock, so it runs between two records. A redrive of an unknown incident is refused `not-found` before anything is journaled. If the outputs no longer hash to the plan's, nothing is admitted (`fingerprint-changed`). Otherwise the outputs go through `admit`, and the result is `reprocessed` when at least one subscription queued a frame, else `superseded`; the message gives the counts. A record that now maps to an existing revision with different data ends `failed` with outcome `revision-conflict` and admits nothing. Unlike a live conflict it does not pause the source, because the conflicting record came from the operator, not from the stream.

`RawEvidence` is `{ keyBase64: string | null; valueBase64: string | null; headers: { name: string; valueBase64: string }[]; complete: boolean }`. It is only available in-process and over the local socket, never over WHC-1 (see [WORKBENCH_HOST_CONTRACT.md](./WORKBENCH_HOST_CONTRACT.md) §5).

`ReproductionBundle` is versioned JSON (`bundleVersion: 1`) with fingerprints, the sanitized incident, the relevant traces, the configured policy, the expected behavior, the supported remedy, and `raw` only when requested. The CLI writes it with mode 0600 and refuses to overwrite (F40).

## 7. Local IPC protocol (slice D)

ADR-15C §3 fixes the socket location and permissions. The wire format:

- One request per connection. The client writes one UTF-8 JSON line of at most 64 KiB, terminated by `\n`. The server writes one JSON line and closes.
- Request: `{ "v": 1, "id": string, "token": string, "op": string, "args": object }`. `op` is a method name from §6 (`status`, `listFailures`, …).
- Response: `{ "v": 1, "id": string, "ok": true, "data": … }` or `{ "v": 1, "id": string, "ok": false, "error": StreamError }`.
- The token is compared in constant time. Ten requests per second per gateway, burst twenty; excess gets `OVERLOADED`. Connections idle for 5 seconds are closed.
- The CLI reads the token from `<stateDirectory>/run/operator.token` and refuses to read it if the file or directory is group- or world-accessible or not owned by the current user.

Slice D notes (normative, as implemented in `packages/gateway/src/operator/ipc.ts`):

- **Startup refusals** are `CONFIG_INVALID` with `details.reason`: `state-dir-missing` or `state-dir-insecure` (the journal's rule), `run-dir-missing` or `run-dir-insecure` (`run/` must have no group or world access, must not be a symlink, and must be owned by the gateway's user), `socket-path-too-long` (over 103 bytes), `socket-in-use` (another gateway answers on it), and `socket-path-occupied` (something other than a socket, including a symlink). A stale socket nobody answers is replaced.
- **The token** is 32 random bytes in base64url, fresh on every start. It is written to a new 0600 file and renamed over `operator.token`, so a symlink planted there is replaced, never written through. It is written only after the live-socket check, so a refused second gateway leaves the running one's token alone. The socket is 0600. Close removes the socket and token only if they are still the files this gateway created.
- **Request checks run in this order:** size (65,536 bytes including the newline), strict UTF-8, a JSON object, `id` (a string of at most 128 characters; otherwise the answer carries `id: ""`), the rate limit, unknown top-level fields, `v`, the token, a known `op`, `args` is an object, then the shared `validateOperatorRequest`. A request without a terminating newline is refused.
- **Errors:** a `StreamOtterError` from the operator passes through unchanged; anything else is `INTERNAL` with no details. More than 16 concurrent connections get `OVERLOADED`. The idle timer is absolute, so trickled bytes do not extend it.
- **Logs** carry the operation name and outcome only, never the token or any payload.
- **The client** (`callOperator`, `connectOperator` in `@streamotter/gateway/operator`) validates arguments before connecting, re-checks the token file after opening it, times out after 30 s (`TIMEOUT`), and caps responses at 64 MiB. When no gateway serves the directory it raises `UNSUPPORTED_CAPABILITY` with `details.reason: "operator-not-running"`.
- Windows is not supported; both sides refuse with `UNSUPPORTED_CAPABILITY`.

## 8. Health listener (slice E — normative, implemented in `packages/gateway/src/runtime/health.ts`)

As ADR-15C §4. Response body `{ "status": "ok" | "unavailable", "reasons": ("starting" | "source-held" | "source-unavailable" | "journal" | "quarantine")[] }`, `Cache-Control: no-store`, no CORS headers, any other path or method 404. `streamotter start --health 127.0.0.1:7402`.

Slice E notes (normative, as implemented in `packages/gateway/src/runtime/health.ts` and `GatewayOptions.health`):

- `health: { host?: string; port: number }`. `host` defaults to `127.0.0.1`; `port` is 0–65535 (0 picks a free port). Any other field, or a malformed value, is `CONFIG_INVALID` at construction. It works in both modes, with or without failure handling.
- Only `GET` (or `HEAD`) of exactly `/health/live` or `/health/ready` is answered. A query string, a trailing slash, any other path and any other method get 404 with no body. Request bodies are never read.
- `/health/live` is 200 `{ "status": "ok", "reasons": [] }` whenever the listener answers. A broker outage does not change it.
- `/health/ready` is 200 with no reasons when ready, otherwise 503 with the reasons in this fixed order, each at most once:
  - `starting`: `start()` has not finished;
  - `source-held`: a source is paused at a record (a V1 pause or a held incident);
  - `source-unavailable`: a source is starting, degraded or stopped while the gateway runs (for example, a broker outage);
  - `journal`: the last incident-store write failed, or the journal is at its size limit;
  - `quarantine`: an open incident's quarantine write failed or its outcome is unknown.
- The listener opens first in `start()`, so readiness reports `starting` throughout startup, and closes with a failed start. A health port already in use fails startup with `SOURCE_UNAVAILABLE` "Health port <host>:<port> is already in use." `stop()` closes it first, so readiness ends before sessions close.
- `streamotter start --health <host:port>` accepts `host:port`, `[ipv6]:port` or a bare port (bound to 127.0.0.1).

## 9. Development management routes and workbench (slice D)

Added to `ManagementOperations`, all behind the existing development token and origin checks:

| Route | Maps to |
| --- | --- |
| `GET /management/v1/workbench` | WHC-1 capability discovery |
| `GET /management/v1/operator/status` | `status()` |
| `GET /management/v1/failures?sourceId&state&limit&cursor` | `listFailures` |
| `GET /management/v1/failures/{failureId}` | `showFailure` without raw |
| `POST /management/v1/failures/export` | `exportFailure` without raw |
| `POST /management/v1/failures/evaluate` | `evaluate` |
| `POST /management/v1/failures/redrive` | `redrive` |
| `POST /management/v1/sources/retry-current` | `retryCurrent` |
| `POST /management/v1/sources/reassess` | `reassess` |
| `POST /management/v1/sources/reopen-circuit` | `reopenCircuit` |

The workbench gains a Failures tab built only on these, and runs anywhere the [workbench host contract](./WORKBENCH_HOST_CONTRACT.md) is honored.

Slice D notes (normative, as implemented in `packages/gateway/src/management/router.ts` and `apps/workbench/src/views/failures.ts`):

- The routes exist only while the gateway has an operator service, that is, when `failureHandling` is configured. Otherwise they answer 404 and discovery omits them. With an operator but an allowlist that excludes them, `createManagementHandler` answers 403.
- Every argument goes through `validateOperatorRequest`. `GET /failures` accepts only `sourceId`, `state`, `limit` and `cursor`, each at most once. The failure ID in `GET /failures/{failureId}` is URL-decoded exactly once.
- No route returns raw evidence. `showFailure` and `exportFailure` are called without `includeRaw`, an export body carrying `includeRaw` is refused, and a `raw` field is removed from any answer (F37).
- Bodies are capped at 64 KiB on these routes, whatever `maxBodyBytes` allows.
- A refused `OperationResult` is a normal 200 response.
- There is no route for `retireBoundary`; it is reachable only in-process and over the local socket.
- The Failures tab appears when discovery lists `failures.list`. Each action sends the revision shown on screen and displays the result exactly as returned. An action the host does not offer reads "Not available in this environment".

## 10. CLI (slices B, D, E)

| Command | Behavior |
| --- | --- |
| `streamotter init --failures --config <path> --state-dir <dir>` | Creates the journal for an existing project; refuses if one exists (ADR-15A §2). |
| `streamotter start ... [--state-dir <dir>] [--operator-socket] [--handler-build-id <id>] [--health <host:port>]` | New flags (ADR-15C §2). |
| `streamotter status --state-dir <dir> [--json]` | `status()` over IPC. |
| `streamotter failures list\|show\|export\|evaluate\|redrive --state-dir <dir> ...` | §6 over IPC. `show --raw` and `export --include-raw --out <file>` are explicit. |
| `streamotter sources retry-current\|reassess\|reopen-circuit\|retire-boundary --state-dir <dir> ...` | §6 over IPC. `retire-boundary` prints the ADR-15B §4 warning and requires `--confirm <boundaryId>`. |
| `streamotter sources rebaseline --config <path> --state-dir <dir> --source <id> --reason <text> --confirm <sourceId> [--json]` | Offline, with the gateway stopped (slice E note below). |

Exit codes extend the existing `0` ok, `1` runtime, `2` invalid: `3` refused (the operation was understood and declined), `4` unknown outcome. `--json` prints the `OperationResult` or data verbatim.

Slice D notes (normative, as implemented in `packages/cli/src/operator.ts`):

- `INVALID_REQUEST` from the gateway exits 2; a gateway that is not running exits 1. With `--json`, errors go to stderr as `{"error": StreamError}` and stdout stays empty.
- Each subcommand accepts only its own flags; `--force` does not exist.
- Raw bytes appear in human output only as base64 with a 64-byte hex preview. Every printed string, `--json` included, has control and bidirectional-override characters escaped as `\uXXXX` (F39).
- `failures export --out <file>` creates the file with mode 0600, refuses an existing file before contacting the gateway, and removes a partial file if the write fails. With `--json` it prints `{ path, bundleVersion, rawIncluded }` rather than the bundle.
- `sources retire-boundary` exits 2 before connecting unless `--confirm` equals `--boundary`.
- `start` and `dev` accept `--operator-socket`, which requires `--state-dir`.
- Slice E: `start` accepts `--health <host:port>` (§8). `dev` does not; the development management server already serves `GET /management/v1/health`.

Slice E note (normative, spec §14 and ADR-15B §4; implemented in `packages/gateway/src/failures/rebaseline.ts`, exported as `rebaselineSource` from `@streamotter/gateway/internals`):

- `sources rebaseline` is the only way to close an incident without processing or advancing its record. It applies after the operator changed the source's `generation` in the configuration (a re-created topic, another cluster, or a consumer group moved past a record with Kafka's own tools). It opens the journal itself, so a running gateway's lock refuses it (`SOURCE_UNAVAILABLE`, `journal-locked`, exit 1). It does not use the operator socket.
- It exits 2 before opening the journal unless `--confirm` equals `--source` and `--reason` is 1 to 512 characters. An unknown source is `INVALID_REQUEST` (exit 2).
- Each open incident whose generation differs from the configured one becomes `resolved`, with resolution `rebaselined to generation <G>` and an `operator` event carrying the reason and the operation ID (`op1:` + 32 hex). Then the configured generation is recorded (`claim`), which retires the earlier generation's boundary. The result is an `OperationResult` with outcome `rebaselined` (exit 0) plus `closed` (failure IDs), `retiredBoundary` and `generation`.
- With nothing from an earlier generation, it is refused with outcome `nothing-to-rebaseline` (exit 3) and changes nothing. Incidents of the configured generation are never touched; no consumer group moves; the quarantine topic is not read or written.
- Rebaseline operations are not recorded in the operations table: there is no gateway to report an `unknown` outcome to, and the incident history carries the operation ID.

## 11. Decisions this draft adds

| ID | Decision | Why | Status |
| --- | --- | --- | --- |
| D1 | Journal engine: `node:sqlite` with a Node ≥ 24.15 floor for quarantine | `node:sqlite` warns as experimental on Node 24.0–24.14 (measured October 3, 2026: 24.0.0, 24.4.0, 24.8.0, 24.12.0, 24.13.0, 24.14.0 warn; 24.15.0, 24.16.0, 24.21.0 and 26.10.0 don't). ADR-15A §2's literal rule picks `better-sqlite3`. | **Decided by the owner, October 4, 2026:** `node:sqlite`, Node 24.15 or later |
| D2 | The guard returns `context`, not a whole boundary; the gateway assigns the ID | Removes a way for application code to forge or reuse an ID | Proposed |
| D3 | Fixture sources may use quarantine policies, with local evidence clearly labeled | Spec §10's guided fixture needs hold, evaluate and redrive without Kafka | Proposed |
| D4 | Development without `stateDirectory` uses a memory store, labeled non-durable | Lets the workbench Failures view work under `streamotter dev` without disk setup | Proposed |
| D5 | Incidents are recorded for every failure class once failure handling is configured, even `pause` | The Failures view and status need them; recording does not change progress | Proposed |
| D6 | `capture` accepts only `"full-record"` | Metadata-only capture can never advance (spec §13) and adds a mode without a use in V1.1 | Proposed |
| D7 | CLI exit codes 3 (refused) and 4 (unknown) | Spec §9 asks for exit status that distinguishes refusal from failure from an unresolved outcome | Proposed |
| D8 | `streamotter init --failures` creates only the journal, in an existing project | ADR-15A §2 names the command; `init` without `--failures` keeps scaffolding | Proposed |
| D9 | One IPC request per connection, newline-delimited JSON | Smallest correct framing; nothing in V1.1 needs streaming | Proposed |
