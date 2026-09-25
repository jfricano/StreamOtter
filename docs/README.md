# StreamOtter documentation

## Using StreamOtter

| Guide | |
| --- | --- |
| [Getting started](./guides/getting-started.md) | Install from npm, scaffold, use the workbench, and build a live page |
| [Add live state to an existing app](./guides/existing-app.md) | Channels, schemas, revisions, handlers, the browser SDK, access changes, and local development |
| [Connect to Kafka](./guides/kafka.md) | Topic requirements, TLS and SASL, progress, bad records, crashes, diagnostics, and what is verified |
| [Run in production](./DEPLOYMENT.md) | `streamotter start`, supervision, reverse proxies, limits, and programmatic use |
| [Troubleshooting](./guides/troubleshooting.md) | Symptoms, causes, and fixes |

Package guides, also shown on npm: [`@streamotter/cli`](../packages/cli/README.md), [`@streamotter/client`](../packages/client/README.md), [`@streamotter/gateway`](../packages/gateway/README.md), [`@streamotter/contracts`](../packages/contracts/README.md), and [`@streamotter/workbench`](../apps/workbench/README.md).

## Reference

- [V1 API specification](./V1_API.md): configuration, handlers, SDK, states and synchronization, source progress and limits, access, protocol, errors, management, CLI, and the refinements made during implementation (§13).
- [Implementation status](./IMPLEMENTATION_STATUS.md): what is implemented, the commands that verify it, the results, the Kafka support matrix, and the limitations.
- [Changelog](../CHANGELOG.md).

## Project

- [Founding document](./FOUNDING.md): purpose, developer problems, philosophy, and the first product boundary.
- [Research brief](./RESEARCH.md): developer reports, technical constraints, alternatives, and assumptions.
- [API and feature roadmap](./API_AND_FEATURE_ROADMAP.md): V1, V2, V3, and the compatibility rules.
- [Release plan](./RELEASE_PLAN.md) and [release checklist](./RELEASE_CHECKLIST.md): how releases are prepared, verified, and published.
- [Home site and demo plan](./WEBSITE_AND_DEMO_PLAN.md): the public site and integrated demo (not started).
- [Implementation handoff](./IMPLEMENTATION_HANDOFF.md): the original build sequence and acceptance checks.
- [Contributing](../CONTRIBUTING.md) and the [security policy](../SECURITY.md).
