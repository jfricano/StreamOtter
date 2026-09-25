# @streamotter/contracts

The public types, protocol constants, error vocabulary, and runtime validation shared by the StreamOtter gateway and browser SDK. Both are built on this package.

**Most applications don't install it directly.** [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) and [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) re-export the types you need. Install this package when you build tooling around StreamOtter: editors, linters, or deployment checks for `streamotter.json`, or anything that must agree exactly with the gateway's rules.

> **Release candidate.** `0.1.0-rc.1` is published under the `next` tag. Package versions follow SemVer independently of the V1 protocol (`PROTOCOL_VERSION = 1`) and `configVersion: 1`.

```bash
npm install @streamotter/contracts@next
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

## More

- [V1 API specification](https://github.com/jfricano/StreamOtter/blob/main/docs/V1_API.md): configuration and schemas (§2), protocol (§8), errors (§9), management (§10)
- [Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues)

MIT License © 2026 Orca Solutions
