# StreamOtter V1.1 — API specification (draft)

**Status:** Draft revision 0.1, October 3, 2026. This is the interface contract the V1.1 slices build against. It turns the approved [specification](./V1_1_SOURCE_FAILURE_SPEC.md) and [ADR-15A/B/C](./adr/) into concrete declarations. Each section is marked with the slice that ships it; a section becomes normative when its slice merges, and the declarations in `@streamotter/contracts` then govern over this text. Nothing here is implemented yet.

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

Slice A note: until slices B and C merge, gateway construction also refuses `quarantine-hold`, `quarantine-resync` and transient retries as "not supported by this gateway build yet", so a configuration is never accepted and silently run as `pause`.

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
- A quarantine policy on Node older than 24.15 (pending the journal-engine decision in §11, row D1).

Development mode without `stateDirectory` uses an in-memory incident store, labeled `"memory"` in status. It is never durable and says so.

## 5. Incidents (slices A, B)

### 5.1 Failure classes (ADR-15B §1; normative in slice A)

```ts
export type FailureClass =
  | "invalid-json" | "payload-schema" | "mapper-transient" | "mapper-error" | "mapper-timeout"
  | "routing-invalid" | "revision-conflict" | "tombstone" | "oversize";
```

Where each class is raised, as implemented: `invalid-json` for UTF-8 decode, JSON parse or nesting failures (and a fixture value that isn't JSON); `tombstone` and `oversize` at validation; `mapper-error`, `mapper-timeout` and `mapper-transient` (a `TransientMappingError`, matched by brand) from `map`; `routing-invalid` for a non-array result, too many outputs, a non-object output, an unexpected field, an invalid tenant, parameters or revision, data that isn't JSON, and a frame above `maxDataFrameBytes`; `payload-schema` only when routing passed and the data fails the channel's payload schema; `revision-conflict` for an equal revision with different data.

Only `invalid-json` and `payload-schema` can take a quarantine policy. Infrastructure failures (broker outage, rebalance, shutdown, journal or quarantine failure) are not failure classes; they keep V1's outage handling and never create a skippable incident (spec §4).

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

`RawEvidence` is `{ keyBase64: string | null; valueBase64: string | null; headers: { name: string; valueBase64: string }[]; complete: boolean }`. It is only available in-process and over the local socket, never over WHC-1 (see [WORKBENCH_HOST_CONTRACT.md](./WORKBENCH_HOST_CONTRACT.md) §5).

`ReproductionBundle` is versioned JSON (`bundleVersion: 1`) with fingerprints, the sanitized incident, the relevant traces, the configured policy, the expected behavior, the supported remedy, and `raw` only when requested. The CLI writes it with mode 0600 and refuses to overwrite (F40).

## 7. Local IPC protocol (slice D)

ADR-15C §3 fixes the socket location and permissions. The wire format:

- One request per connection. The client writes one UTF-8 JSON line of at most 64 KiB, terminated by `\n`. The server writes one JSON line and closes.
- Request: `{ "v": 1, "id": string, "token": string, "op": string, "args": object }`. `op` is a method name from §6 (`status`, `listFailures`, …).
- Response: `{ "v": 1, "id": string, "ok": true, "data": … }` or `{ "v": 1, "id": string, "ok": false, "error": StreamError }`.
- The token is compared in constant time. Ten requests per second per gateway, burst twenty; excess gets `OVERLOADED`. Connections idle for 5 seconds are closed.
- The CLI reads the token from `<stateDirectory>/run/operator.token` and refuses to read it if the file or directory is group- or world-accessible or not owned by the current user.

## 8. Health listener (slice E)

As ADR-15C §4. Response body `{ "status": "ok" | "unavailable", "reasons": ("starting" | "source-held" | "source-unavailable" | "journal" | "quarantine")[] }`, `Cache-Control: no-store`, no CORS headers, any other path or method 404. `streamotter start --health 127.0.0.1:7402`.

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

## 10. CLI (slices B, D, E)

| Command | Behavior |
| --- | --- |
| `streamotter init --failures --config <path> --state-dir <dir>` | Creates the journal for an existing project; refuses if one exists (ADR-15A §2). |
| `streamotter start ... [--state-dir <dir>] [--operator-socket] [--handler-build-id <id>] [--health <host:port>]` | New flags (ADR-15C §2). |
| `streamotter status --state-dir <dir> [--json]` | `status()` over IPC. |
| `streamotter failures list\|show\|export\|evaluate\|redrive --state-dir <dir> ...` | §6 over IPC. `show --raw` and `export --include-raw --out <file>` are explicit. |
| `streamotter sources retry-current\|reassess\|reopen-circuit\|retire-boundary --state-dir <dir> ...` | §6 over IPC. `retire-boundary` prints the ADR-15B §4 warning and requires `--confirm <boundaryId>`. |

Exit codes extend the existing `0` ok, `1` runtime, `2` invalid: `3` refused (the operation was understood and declined), `4` unknown outcome. `--json` prints the `OperationResult` or data verbatim.

## 11. Decisions this draft adds

| ID | Decision | Why | Status |
| --- | --- | --- | --- |
| D1 | Journal engine: `node:sqlite` with a Node ≥ 24.15 floor for quarantine, else `better-sqlite3` | `node:sqlite` warns as experimental on Node 24.0–24.14 (measured October 3, 2026: 24.0.0, 24.4.0, 24.8.0, 24.12.0, 24.13.0, 24.14.0 warn; 24.15.0, 24.16.0, 24.21.0 and 26.10.0 don't). ADR-15A §2's literal rule picks `better-sqlite3`. | **Asked the owner** |
| D2 | The guard returns `context`, not a whole boundary; the gateway assigns the ID | Removes a way for application code to forge or reuse an ID | Proposed |
| D3 | Fixture sources may use quarantine policies, with local evidence clearly labeled | Spec §10's guided fixture needs hold, evaluate and redrive without Kafka | Proposed |
| D4 | Development without `stateDirectory` uses a memory store, labeled non-durable | Lets the workbench Failures view work under `streamotter dev` without disk setup | Proposed |
| D5 | Incidents are recorded for every failure class once failure handling is configured, even `pause` | The Failures view and status need them; recording does not change progress | Proposed |
| D6 | `capture` accepts only `"full-record"` | Metadata-only capture can never advance (spec §13) and adds a mode without a use in V1.1 | Proposed |
| D7 | CLI exit codes 3 (refused) and 4 (unknown) | Spec §9 asks for exit status that distinguishes refusal from failure from an unresolved outcome | Proposed |
| D8 | `streamotter init --failures` creates only the journal, in an existing project | ADR-15A §2 names the command; `init` without `--failures` keeps scaffolding | Proposed |
| D9 | One IPC request per connection, newline-delimited JSON | Smallest correct framing; nothing in V1.1 needs streaming | Proposed |
