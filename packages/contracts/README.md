# @streamotter/contracts

The public types, protocol constants, error vocabulary, and runtime validation shared by the StreamOtter gateway and browser SDK. Both are built on this package.

**Most applications don't install it directly.** [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) and [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) re-export the types you need. Install this package when you build tooling around StreamOtter: editors, linters, or deployment checks for `streamotter.json`, or anything that must agree exactly with the gateway's rules.

> **Release candidate** of StreamOtter `0.1.0`; the API may still change before `0.1.0`. Package versions follow SemVer independently of the V1 protocol (`PROTOCOL_VERSION = 1`) and `configVersion: 1`.

```bash
npm install @streamotter/contracts
```

ESM only, with TypeScript declarations included. It has no dependencies and runs in browsers and Node.js.

## Validate a configuration

```ts
import { readFile } from "node:fs/promises";
import { canonicalJson, validateProjectConfig } from "@streamotter/contracts";

const config: unknown = JSON.parse(await readFile("streamotter.json", "utf8"));
const { valid, issues } = validateProjectConfig(config);
for (const issue of issues) console.error(`${issue.path || "/"}  ${issue.code}: ${issue.message}`);

// The fingerprint `streamotter validate` and the workbench print:
const bytes = new TextEncoder().encode(canonicalJson(config));
const digest = await crypto.subtle.digest("SHA-256", bytes);
const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
```

This is the same validator `defineProject()`, the CLI, and the workbench use. Validation is structural: identifiers, references between sources, schemas, and channels, the bounded schema dialect, limits, and deferred V2/V3 fields (which fail with a clear message). It never connects to Kafka or resolves secrets. `assertValidProjectConfig()` throws a `StreamOtterError` with code `CONFIG_INVALID` instead of returning issues.

## What else is exported

| Area | Exports |
| --- | --- |
| Types | `ProjectConfig`, `Schema`, `HandlerRegistry`, `Principal`, `StreamEvent`, `StreamError`, `SubscriptionState`, `ConnectionState`, the Socket.IO wire frames, `ManagementOperations`, and more |
| Values and schemas | `validateValue(schema, value)`, `validateSchemaDefinition`, `canonicalizeParams`, `canonicalJson`, `canonicalJsonPretty` (the workbench's export format) |
| Revisions and identifiers | `isRevision`, `compareRevisions` (numeric, no `number` conversion), `isIdentifier`, `REVISION_PATTERN`, `IDENTIFIER_PATTERN` |
| Errors | `ERROR_CODES`, `StreamOtterError`, `isStreamError`, `PUBLIC_MESSAGES` |
| Protocol and limits | `PROTOCOL_VERSION`, `CAPABILITIES`, `EVENTS` (`so:subscribe`, `so:data`, …), `DEFAULT_LIMITS`, default ports and paths, and timeouts |

The types are the public contract that the [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md) describes. Where the specification and the types differ, this package is authoritative for types (see its §13).

## Documentation

- [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md): configuration and schemas (§2), the protocol (§8), errors (§9), and management (§10)
- [Getting started](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md), if you are here to build an application
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · [Security policy](https://github.com/jfricano/StreamOtter/blob/main/SECURITY.md)

## StreamOtter packages

| Package | |
| --- | --- |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | **This package.** Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | The local workbench's assets, installed by the CLI |

All five are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

MIT License © 2026 Orca Solutions
