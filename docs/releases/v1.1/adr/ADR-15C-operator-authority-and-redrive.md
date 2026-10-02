# ADR-15C: Local operator authority and what redrive means

**Status:** Accepted · September 29, 2026 · Decides spec §8, §9, §11.1 and §12. The redrive simplification (§5) was accepted by the owner on September 29, 2026.
**Baseline read:** `packages/gateway/src/management/index.ts`, `runtime/gateway.ts` (`GatewayInternals`, `resumeSource`, `validateProduction`), `packages/cli/src/cli.ts`, `packages/contracts/src/config.ts` at `7b40678`.

## Context

V1 has one privileged surface, the development management server (`/management/v1/*`, including `GET /health`). `validateProduction` keeps it out of production. The only production-safe operation is `gateway.resumeSource(sourceId)`, which retries the same record. The project config rejects unknown top-level keys (`c.keys(... ["limits"])`), so an older gateway given a V1.1 config already fails validation instead of silently ignoring the policy, which is what spec §14 requires.

## Decision

### 1. One operator service, three callers

A single `OperatorService` in the gateway implements every operation in spec §9 (`failures list/show/export/evaluate/redrive`, `sources retry-current/reassess/reopen-circuit`, `status`). It's reached three ways:

- **in-process:** `getGatewayOperator(gateway)` from `streamotter/gateway/operator`;
- **local IPC:** a Unix-domain socket, for the CLI (`streamotter failures …` against a running `start`);
- **development:** new `/management/v1/failures/*` routes on the existing dev management server, behind its existing token.

Every mutation takes the incident ID and expected incident revision. Redrive also takes the plan fingerprint. There's no `--force` and no wildcards.

### 2. Deployment settings are options, not project config

The draft puts `operations.socketPath` and `health` at the top level of `streamotter.json`. They're host and deployment settings, not part of the project contract that the workbench exports and teams review. Proposed placement:

- `failureHandling` (policies, quarantine topic, capture mode) goes in the project config. It changes behavior, so it belongs in the reviewed contract.
- `stateDirectory`, the operator socket, and the health listener go in `GatewayOptions` and as `streamotter start` flags (`--state-dir`, `--operator-socket`, `--health host:port`).

### 3. Socket protection, and what it can't do

The socket lives in `<stateDirectory>/run/`: directory mode 0700, socket 0600, owned by the gateway user. Each start writes a random token to `<stateDirectory>/run/operator.token` (0600). The CLI reads it from there and never passes it on the command line. Startup refuses to run if the directory is group- or world-writable.

**Limitation:** Node has no portable API for the peer's credentials (`SO_PEERCRED`), so the boundary is filesystem permissions plus the token. Anyone who can read the state directory is an operator. The audit record logs "local caller with token", not a verified uid. That matches spec §12 ("local machine administrators remain trusted") and is stated here so it's never described as more.

### 4. Health listener

It's a separate `node:http` server bound to loopback by default and serves only `GET /health/live` and `GET /health/ready`. The body is `{ "status": "ok" | "unavailable", "reasons": [...] }`, where the reason categories are `starting`, `source-held`, `source-unavailable`, `journal`, `quarantine`. It never returns topic names or incident IDs, and sends no CORS headers. Liveness stays 200 through a broker outage. It's available with or without failure handling. This is the report's P01 production health item, and it can ship in the first slice.

### 5. Redrive re-evaluates a record; it doesn't resynchronize subscribers

The draft (§8.3) has redrive invalidate the affected live epochs and run a fresh synchronization. **Proposed simplification:** run the stored original bytes through the same decode, map, and validate path as `#process`, with the same all-outputs-before-any-admission rule and the same revision-conflict check, then admit through `subscription.admit`. It runs at a record boundary, serialized with the source by a per-source lock around `#process`.

This is safe for full-state channels because `admit` already filters a revision at or below the subscriber's tail (`subscription.ts:194`), and an equal revision with different data is already a conflict that stops everything. An old record is superseded and recorded as such. A newer one updates exactly as if it had arrived normally. Forcing every affected subscriber through a resync would add load and a visible `synchronizing` flicker without making the result more correct. No consumer offset moves, nothing is published to a business topic, and nothing reaches a client except through `admit`.

The recorded outcome is `reprocessed` (at least one output admitted), `superseded` (every output at or below current state), `failed` (the mapping still fails), or `unknown` (a crash between intent and result, which then needs new approval). `evaluate` runs the same pipeline without admitting and issues a plan that expires after 5 minutes, fingerprinted by config, handler build ID, evidence hash, and mapped-output hash.

This replaces the 0.1 text of spec §8.3, as accepted by the owner.

### 6. Legacy `resumeSource` respects holds

When failure handling is enabled for a source, `gateway.resumeSource` routes through `retry-current` and is refused while the journal shows an unresolved advance or an open circuit. Without failure handling, it behaves exactly as it does in V1.

## Consequences

- The CLI gains `failures` and `sources` command groups plus `start` flags, and the workbench gains a Failures view on the dev routes.
- With no failure handling and no `--health` flag, production behavior is unchanged.
- Tests F31–F40 apply. Add tests for: the socket refusing to start in an insecure directory; the health listener never leaking topic names; a redrive of an older record ending `superseded` with no client frame; and `resumeSource` being refused during an advance.
