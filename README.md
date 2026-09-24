# StreamOtter

Make live data straightforward to build with—and understandable when it breaks.

StreamOtter carries KafkaSocks’ original goal of simpler Kafka-to-frontend integration into a broader developer experience: connect, define delivery behavior, integrate, inspect, and test recovery.

**Status: V1 is implemented and tested in this repository** — a Node.js gateway, a TypeScript browser SDK over Socket.IO, a CLI, a local web workbench, and a reference order-status application. It is a release candidate, not a published release: packages are not on npm, and the public home site and hosted demo are the next milestone. What was verified, how, and the known limitations are recorded in [docs/IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md).

## What V1 does

- **State channels.** Browsers subscribe to named, versioned, parameterized channels (never raw topics). Each subscription receives an authoritative snapshot, then full-state updates ordered by a domain revision. A snapshot/update race is resolved by capture-before-snapshot and revision comparison.
- **Explicit delivery states.** `authorizing → synchronizing → live`, with `stale`, `resync-required`, and `failed` when something goes wrong. A disconnected or superseded view is never reported as live.
- **Application-owned access.** Your `authenticate`, `authorize`, `map`, and `snapshot` handlers decide identity, audience, public payload, and authoritative state. Revocation works while authorization or a snapshot is pending.
- **Bounded delivery.** One frame in flight per subscription, finite per-subscription/connection/gateway budgets, overflow → resynchronization, and slow receipts disconnect only the slow client. Source progress never waits for browsers.
- **Kafka source progress.** KafkaJS behind an internal adapter: explicit per-record commits, poison records pause without skipping, rebalance/outage trigger resynchronization. Deterministic fixture sources for development.
- **Diagnosis.** Staged connection checks (resolve → connect → TLS → authenticate → metadata) and a bounded, payload-free trace of each record's path through validate, map, queue, send, receipt, and commit.

## Quickstart

Prerequisites: Node.js 24+ and pnpm 11 (`npx pnpm@11.19.0` works without a global install).

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm example            # order dashboard at http://localhost:3000, workbench at http://127.0.0.1:7401
```

`pnpm example` prints a one-time management token; paste it into the workbench. See [examples/order-dashboard](./examples/order-dashboard/README.md) for the walkthrough and scenarios.

Start your own project with the CLI (from this repository, `pnpm streamotter <command>` runs it from source):

```bash
pnpm streamotter init ../my-app
cd ../my-app
<repo>/packages/cli/bin/streamotter.js dev --config streamotter.json --handlers server/handlers.mjs
```

## Checks

```bash
pnpm check:contracts    # the V1 contract, example, and negative type checks against the real packages
pnpm typecheck          # strict type-check of every package, app, example, and test
pnpm test               # unit + integration tests (fixture-backed gateway and SDK, CLI, management, example)
pnpm test:load          # declared-workload resource test
pnpm kafka:setup        # once: checksum-verified JDK 21 + Apache Kafka 4.1.2 into .local/
pnpm kafka:start        # local broker: PLAINTEXT :19092, TLS :19093, SASL_SSL :19094
pnpm test:kafka         # real-Kafka acceptance tests (builds first)
```

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/contracts` | Public types, protocol constants, schema/config validation (shared by gateway and SDK) |
| `packages/gateway` | `createGateway`, `defineProject`, sources (fixture, KafkaJS), synchronization, Socket.IO transport, development management API |
| `packages/client` | `createClient` browser SDK |
| `packages/cli` | `streamotter init | validate | generate | dev | start` and the TypeScript generator |
| `apps/workbench` | Local workbench UI (Connect, Define, Preview, Inspect, Export), served by `streamotter dev` |
| `examples/order-dashboard` | Reference application: fixture and Kafka modes, vanilla TypeScript and React views |
| `contracts/v1` | The V1 contract surface, re-exporting the implementation, with the compile-time example and negative checks |
| `tests` | Integration, Kafka, and load tests |
| `scripts/kafka` | Local broker setup/start/stop (native) and an unexercised Docker Compose alternative |

## Documents

- [Founding document](./docs/FOUNDING.md): purpose, developer problems, philosophy, first product boundary, and engineering acceptance criteria.
- [Research brief](./docs/RESEARCH.md): firsthand developer reports, technical constraints, existing alternatives, and the assumptions behind our decisions.
- [API and feature roadmap](./docs/API_AND_FEATURE_ROADMAP.md): V1, V2, V3, later possibilities, API forecasts, incremental delivery, and compatibility rules.
- [V1 API specification](./docs/V1_API.md): configuration, handlers, SDK, synchronization, protocol, management endpoints, limits, errors — and the refinements made during implementation (section 13).
- [Implementation status](./docs/IMPLEMENTATION_STATUS.md): what is implemented, commands, verified results, support matrix, and limitations.
- [Running StreamOtter](./docs/DEPLOYMENT.md): local development and the single-gateway production boundary.
- [Implementation handoff](./docs/IMPLEMENTATION_HANDOFF.md): reading order, build sequence, and acceptance checks.
- [Home site and demo plan](./docs/WEBSITE_AND_DEMO_PLAN.md): public experience, integrated demo, launch scope, and readiness gates (next milestone; not implemented).
