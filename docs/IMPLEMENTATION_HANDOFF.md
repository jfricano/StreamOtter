# StreamOtter V1 implementation handoff

September 24, 2026

## Objective

Implement the V1 defined in [V1_API.md](./V1_API.md), retaining the product intent in [FOUNDING.md](./FOUNDING.md). Build working software incrementally in this repository. The [roadmap](./API_AND_FEATURE_ROADMAP.md) limits V1 and explains future extensions; do not implement those extensions now.

## What is here today

V1 slices 1–4 are implemented and tested; the public home site and hosted demo (the next milestone) are not started. [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) is the current record of what exists, the commands that verify it, the actual results, and the known limitations. In brief:

- `packages/contracts`, `packages/gateway`, `packages/client`, `packages/cli`: the shared contracts, gateway (fixture and KafkaJS sources, synchronization, Socket.IO transport, development management API), browser SDK, and CLI with the TypeScript generator.
- `apps/workbench`: the local workbench served by `streamotter dev`.
- `examples/order-dashboard`: the reusable order-status application (fixture and Kafka modes, vanilla TypeScript and React views, reproducible scenarios).
- `tests/`: fixture-backed integration tests, real-Kafka tests against a pinned local Apache Kafka 4.1.2, and a declared-workload resource test.
- `contracts/v1/`: the design contract now re-exports the implementation; the example and negative type checks compile against it.

Implementation decisions that refine the specification are recorded in [V1_API.md section 13](./V1_API.md#13-implementation-refinements-contract-revision-02).

## Read in this order

1. [Founding direction](./FOUNDING.md).
2. [API and feature roadmap](./API_AND_FEATURE_ROADMAP.md), especially V1 and compatibility boundaries.
3. [V1 API specification](./V1_API.md).
4. [Typed contracts](../contracts/v1/api.ts), [example](../contracts/v1/example.ts), and [type checks](../contracts/v1/type-tests.ts).
5. [Research](./RESEARCH.md) when the reason behind a design decision matters.
6. [Home site and demo plan](./WEBSITE_AND_DEMO_PLAN.md) for example reuse, public launch scope, and the gates after V1.

The detailed V1 specification and its types take precedence over earlier roadmap sketches. If the specification and types conflict, resolve the conflict explicitly and update both. Make routine implementation decisions independently. Ask the owner only for a material product decision that cannot be resolved from this scope.

## Suggested implementation structure

```text
packages/
  contracts/       shared runtime schemas, protocol types, generated-contract support
  gateway/         lifecycle, sources, handlers, routing, synchronization, management
  client/          browser subscription lifecycle and Socket.IO adapter
  cli/             init, validate, generate, dev, start
apps/
  workbench/       local web interface using the management API
examples/
  order-dashboard/ application-owned auth, snapshots, fixture data, browser view
contracts/v1/     design baseline and compile-time compatibility checks
docs/             specifications, operator guidance, implementation notes
```

This structure is a starting recommendation. Use a pnpm workspace, strict TypeScript, and the existing root scripts. Implement and share real types rather than maintaining divergent copies of the declarations. Keep the compile-time example and negative checks working as the contracts are wired to implementation.

## Build sequence

### Slice 1: an executable fixture path

Implement configuration validation, runtime payload validation, handler registration, and the fixture source. Add a real gateway and browser client implementing authentication, authorized subscriptions, snapshots, revision-based state replacement, receipts, cleanup, and errors. Use the simplest local inspector needed to show the actual event stages; broad UI polish can follow.

Deliver a deterministic order-status example with application-owned identity, access rules, snapshot storage, and controllable fixture updates. It must demonstrate an update arriving while a snapshot is loading, a disconnect/resynchronization, and rejected access. Provide commands that start it on a clean checkout.

This example will become the public demo after V1 passes its acceptance gate. Keep scenarios reproducible and the application UI reusable; do not begin the marketing site or public hosting in this slice.

The first slice is a foundation of V1, not a substitute for the remaining features. Continue through the following slices unless instructed to stop.

### Slice 2: Kafka and operational behavior

Add the internal KafkaJS adapter, pinned local Kafka environment, source progress management, source diagnostics, and generation-based event identity. Exercise explicit offset commits, invalid-record pause/resume, crash/redelivery, source outage, and rebalance-triggered resynchronization. Verify TLS/SASL connection modes before listing them as supported; document any remaining unverified modes.

Enforce finite queues and source/map/snapshot deadlines. Add token expiration, revocation during pending handlers, account-switch handling, and stale epoch rejection. Separate SDK receipt from application processing. Keep one slow client from indefinitely blocking source progress or healthy clients.

### Slice 3: workbench and developer workflow

Implement the specified management endpoints and local session protection, then the workbench workflow: connect, define, preview, integrate, inspect, export. Use real gateway diagnostics. The UI must show when configuration is only a candidate and requires restart.

Add the CLI, schema-to-TypeScript generation, vanilla TypeScript example, and React usage example. Generated files and the gateway must work independently of the workbench. Document local setup and the single-gateway production deployment boundary.

### Slice 4: finish V1

Run the specification’s acceptance scenarios. Fix failures. Check the production build, cleanup, resource bounds, and absence of development/management endpoints in production. Record commands and actual results in `docs/IMPLEMENTATION_STATUS.md`, including limitations. Do not claim all V1 behavior works merely because the happy-path example runs.

### After tested V1: home site and integrated demo

Once [Gate A](./WEBSITE_AND_DEMO_PLAN.md#gate-a-ready-to-implement-the-public-experience) passes, build the first-class home site, public documentation, and integrated `/demo` as a dedicated public-launch milestone. Reuse the tested order-status application and released contracts. The public demo requires a production-mode gateway, isolated Kafka, synthetic data, and application-owned bounded scenario actions; do not expose the local workbench or development/management endpoints.

Complete [Gate B](./WEBSITE_AND_DEMO_PLAN.md#gate-b-ready-for-the-public-launch) before broad public launch. Prioritize this milestone before V1.x/V2 feature expansion unless explicitly reprioritized. Website completion does not redefine V1 runtime acceptance, and a runtime-only implementation request ends at slice 4 unless launch work is also requested.

## Tests that matter

Use focused unit tests for canonical parameters, schema validation, revisions, identifiers, and state transitions. Use integration tests for real gateway/client behavior, snapshot/live races, asynchronous authorization revocation, source progress, and wire epochs. Use real Kafka for offset/rebalance semantics; mocks cannot establish those properties. Use browser checks for the workbench and SDK lifecycle in the reference application.

For load/resource tests, declare client count, update rate, payload size, and limits. Assert bounded queues and defined overload behavior. This project has no benchmarked capacity claim yet.

## Scope discipline

Keep V1 focused on full state replacement and snapshot resynchronization. Do not add durable replay, client checkpoints, arbitrary browser publishing, commands, multiple gateways, hosted accounts, extra brokers, or another transport. Do not reintroduce interviews, market-validation gates, or comparisons of competing prototypes.

Maintain separate server identity, channel authorization, and management authority. Never make demo credentials the production default. Never replace the declared synchronization behavior with fetch-then-subscribe or silently mark a disconnected/stale view live.

Use the existing established libraries for Kafka and socket transport. Do not build a Kafka wire client. Keep broker-specific behavior behind the source adapter and Socket.IO-specific behavior behind the transport adapter.

## Reporting

After each meaningful slice, state what is implemented, how to run it, which checks passed, and what remains. Keep `README.md` accurate: a type-checked declaration is a contract, a runnable example is a slice, and a completed V1 must satisfy the declared scope. Update documentation as implementation decisions refine the specification.

## Starting instruction for Claude Code

> Implement StreamOtter V1 in this repository. Read CLAUDE.md and docs/IMPLEMENTATION_HANDOFF.md, then follow docs/V1_API.md and the typed contracts. Start with the executable fixture-backed gateway and browser SDK, then continue through Kafka integration, the workbench, CLI, and V1 acceptance checks. Preserve the specified recovery, authorization, and backpressure behavior. Make routine implementation decisions independently, keep the documents current, and report actual test results. Do not add V2/V3 features or stop after a scaffold.
