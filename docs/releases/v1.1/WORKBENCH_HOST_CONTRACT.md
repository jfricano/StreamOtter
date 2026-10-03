# Workbench host contract, version 1 (WHC-1)

**Status:** Interface specification, revision 0.2 (October 3, 2026). Implemented on branch `feat/v1.1-workbench-host` (PR 2 in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)); not merged or published yet. Revision 0.2 records the clarifications made while implementing it ([§9](#9-implementation-notes-revision-02)).\
**Governs:** spec §10 "Published frontend integration for a synthetic demo", acceptance families F44 and F46.\
**Owner:** the StreamOtter library. Lontra Creek owns everything on the host side of the boundary described here.

## 1. Purpose and boundary

Today the workbench (`@streamotter/workbench`) runs in one place: `streamotter dev` serves it from the loopback management origin, it prompts for the per-run management token, and it calls `/management/v1/*` on the same origin. WHC-1 is the supported way to run the same published frontend somewhere else, specifically under a site route such as `https://lontracreek.example/workbench/`, against a host-provided adapter that implements a declared subset of the operations.

The contract has five parts:

1. **Assets** (§2). The published `dist/` files, a manifest naming them with integrity hashes, and the Content Security Policy they need.
2. **Boot configuration** (§3). A JSON block the host puts in the page that tells the workbench where its API is, how requests authenticate, which gateway to preview against, and how to label the environment.
3. **Capability discovery** (§4). One endpoint the workbench reads first to learn which operations this host supports. Anything absent is shown as unavailable, never emulated.
4. **Operation API** (§5). The request and response shapes for every operation, which are the existing `/management/v1` shapes plus the V1.1 failure operations, typed in `@streamotter/contracts`.
5. **Optional server helper** (§6). `createManagementHandler`, a mountable request handler for a development-mode gateway with an operation allowlist, so a host can reuse the library's validated routing instead of re-implementing it.

What WHC-1 does **not** do:

- It does not make the native management server reachable from anywhere but loopback. `startManagementServer` keeps its origin, token, frame and CSP rules unchanged.
- It does not expose production management, the operator socket (ADR-15C §3), the operator token, native management tokens, raw quarantine evidence, or any broker, offset, file or code operation to a browser.
- It does not provide visitor sessions, leases, quotas, synthetic bindings, hosting or cleanup. Those belong to the host.
- It does not change the browser SDK, the Socket.IO protocol, or the gateway's production behavior.

## 2. Assets

`@streamotter/workbench` publishes:

| File | Notes |
| --- | --- |
| `dist/index.html` | Reference page for the native server. A host may use its own page instead (§3.3). |
| `dist/app.js` | ES module, no inline script, no `eval`, no remote imports. |
| `dist/styles.css` | No remote fonts or imports. |
| `dist/favicon.svg` | Optional. |
| `dist/THIRD_PARTY_LICENSES.txt` | Must accompany `app.js` when redistributed. |
| `dist/workbench-host.json` | **New.** The asset manifest below. |

All asset references are relative, so the directory can be mounted under any path prefix.

`dist/workbench-host.json`:

```json
{
  "hostContract": 1,
  "package": "@streamotter/workbench",
  "version": "<exact published version>",
  "entry": { "script": "app.js", "style": "styles.css", "icon": "favicon.svg" },
  "integrity": { "app.js": "sha384-…", "styles.css": "sha384-…" },
  "bootElementId": "streamotter-workbench-host",
  "mountElementId": "app",
  "csp": {
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:"],
    "connect-src": ["'self'", "<gateway origin>", "<gateway websocket origin>"],
    "frame-ancestors": ["'none'"]
  }
}
```

A host pins an exact package version (no ranges) and may check the integrity values at build time. The package also exports `@streamotter/workbench/host` (the manifest, as JSON) and `@streamotter/workbench/dist/*` (the files), so a host can resolve them with `require.resolve` instead of guessing paths.

The workbench needs no `unsafe-inline` and no `unsafe-eval`. The host must serve the assets with a CSP at least as strict as the manifest's; `connect-src` must name the gateway the preview connects to.

## 3. Boot configuration

### 3.1 The boot block

The workbench reads its configuration from a non-executable JSON element in the page, before it renders anything:

```html
<script type="application/json" id="streamotter-workbench-host">
{
  "hostContract": 1,
  "apiBase": "/workbench/api/v1",
  "auth": { "mode": "session" },
  "gateway": { "origin": "https://lontracreek.example", "path": "/sandbox/socket.io" },
  "environment": {
    "kind": "sandbox",
    "label": "Synthetic fixture",
    "detail": "An isolated demo session. Nothing here touches a production system.",
    "packageVersion": "<exact pinned version>"
  }
}
</script>
<div id="app"></div>
<script type="module" src="/workbench/assets/app.js"></script>
```

`type="application/json"` is never executed, so it is allowed under a strict `script-src`. The workbench parses it with `JSON.parse` and validates it against `WorkbenchHostConfig` (exported from `@streamotter/contracts`). An invalid block shows a configuration error and makes no requests.

### 3.2 Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `hostContract` | `1` | Required. Any other value is refused with an "unsupported host contract" screen. |
| `apiBase` | string | Absolute path on the page's own origin, without a trailing slash. Every operation path in §5 is appended to it. Cross-origin API bases are refused, because the workbench never sends credentials cross-origin. Default `/management/v1`. |
| `auth.mode` | `"token"` or `"session"` | `token`: the native behavior. The workbench shows its token gate and sends `Authorization: Bearer <token>`, keeping the token in memory only. `session`: the host authenticates requests with its own same-origin credential (for example an `HttpOnly`, `SameSite=Strict` cookie). The workbench shows no token gate, sends `credentials: "same-origin"`, never sends an `Authorization` header, and adds `X-StreamOtter-Workbench: 1` to every request so the host can reject cross-site form posts. |
| `gateway.origin`, `gateway.path` | string | The gateway the Preview tab connects to with the browser SDK. Optional; when absent, Preview is unavailable. |
| `environment.kind` | `"development"` or `"sandbox"` | Shown in the top bar. `sandbox` also shows a persistent banner with `label` and `detail`. |
| `environment.label` | string ≤ 64 | Required for `sandbox`, for example "Synthetic fixture" or "Real-Kafka synthetic demo". |
| `environment.detail` | string ≤ 280 | Optional explanatory line. Rendered as text, never markup. |
| `environment.packageVersion` | string | Optional. When present and different from the bundled version, the workbench shows a version-mismatch warning. |

Unknown fields are refused, so a host learns at once when it relies on a field this version does not support.

### 3.3 Native default

When the boot element is absent, the workbench behaves exactly as it does today: `apiBase` `/management/v1`, `auth.mode` `token`, gateway origin and path from the `streamotter-gateway-origin` and `streamotter-gateway-path` meta tags, and `environment.kind` `development`. `streamotter dev` keeps working with no change.

## 4. Capability discovery

The first request is:

```text
GET {apiBase}/workbench
```

```json
{
  "hostContract": 1,
  "operations": ["capabilities", "health", "sources", "channels", "config", "config.validate", "config.export", "traces", "source-checks", "preview-sessions", "dev.principals", "dev.fixtures.advance", "dev.disconnect", "failures.list", "failures.show", "failures.export", "failures.evaluate", "failures.redrive", "sources.retry-current", "sources.reassess", "sources.reopen-circuit", "operator.status"],
  "limits": { "maxRequestBytes": 65536 }
}
```

The response is wrapped in the usual `Result<T>`. `operations` is a closed vocabulary (§5). The workbench enables a tab or a button only when every operation it needs is listed, and otherwise shows "Not available in this environment" in its place. It never falls back to a different operation.

| Workbench surface | Required operations |
| --- | --- |
| Shell (top bar, project name, readiness) | `config`, `health`, `channels`, `sources` |
| Connect | `source-checks`; `sources.resume` for the legacy resume button |
| Define | `config.validate` |
| Preview | `dev.principals`, `preview-sessions`, plus `gateway` in the boot block; `dev.fixtures.advance` and `dev.disconnect` for those controls |
| Inspect | `traces` |
| Export | `config.export` |
| Failures list and detail | `failures.list`, `failures.show`, `operator.status` |
| Failures actions | One each: `sources.retry-current`, `sources.reassess`, `sources.reopen-circuit`, `failures.evaluate`, `failures.redrive`, `failures.export` |

A host that cannot answer `GET {apiBase}/workbench` (404) is treated as a pre-WHC-1 native server: every operation the existing `streamotter dev` exposes is assumed, and no failure operation is.

`sources.retire-boundary` is deliberately not in the vocabulary. Retiring a recovery boundary by operator assertion is the unsafe mode in ADR-15B §4, so it stays a CLI-only action with a typed confirmation. No browser surface offers it.

## 5. Operation API

Every response is the existing envelope:

```ts
type Result<T> = { ok: true; requestId: string; data: T } | { ok: false; requestId: string; error: StreamError };
```

The table maps each WHC-1 operation name to its method and path (relative to `apiBase`) and to the type that defines its request and response. The existing types are in `ManagementOperations` in `@streamotter/contracts`; the V1.1 types land with slice D in the same module and are drafted in [V1_1_API.md](./V1_1_API.md) §6.

| Operation | Method and path | Defined by |
| --- | --- | --- |
| `capabilities` | `GET /capabilities` | existing |
| `health` | `GET /health` | existing |
| `sources` | `GET /sources` | existing |
| `channels` | `GET /channels` | existing |
| `config` | `GET /config` | existing |
| `config.validate` | `POST /config/validate` | existing |
| `config.export` | `POST /config/export` | existing |
| `traces` | `GET /traces` | existing |
| `source-checks` | `POST /source-checks` | existing |
| `sources.resume` | `POST /sources/resume` | existing; refused while a V1.1 hold is in force (ADR-15C §6) |
| `preview-sessions` | `POST /preview-sessions` | existing |
| `dev.principals` | `GET /dev/principals` | existing |
| `dev.fixtures.advance` | `POST /dev/fixtures/advance` | existing |
| `dev.disconnect` | `POST /dev/disconnect` | existing |
| `workbench` | `GET /workbench` | new, §4 |
| `operator.status` | `GET /operator/status` | V1.1 |
| `failures.list` | `GET /failures` | V1.1 |
| `failures.show` | `GET /failures/{failureId}` | V1.1; metadata only, never raw bytes over WHC-1 |
| `failures.export` | `POST /failures/export` | V1.1; redacted bundle only over WHC-1 |
| `failures.evaluate` | `POST /failures/evaluate` | V1.1 |
| `failures.redrive` | `POST /failures/redrive` | V1.1 |
| `sources.retry-current` | `POST /sources/retry-current` | V1.1 |
| `sources.reassess` | `POST /sources/reassess` | V1.1 |
| `sources.reopen-circuit` | `POST /sources/reopen-circuit` | V1.1 |

Request rules apply to every host, native or not:

- JSON bodies of at most `limits.maxRequestBytes` (64 KiB for failure operations, 1 MiB for `config.*`), `Content-Type: application/json`, unknown keys refused.
- Every mutation carries the identifiers and expected revisions its type requires. A host adapter must pass them through unchanged or refuse; it must not substitute its own.
- A host adapter may narrow results (for example, list only the visitor's own study), but it must not invent outcomes. When the host cannot answer, it returns an error, which the workbench shows as unavailable.
- Raw evidence is never part of WHC-1. `failures.show` and `failures.export` over WHC-1 return metadata and redacted bundles. Raw views stay in the native CLI and the in-process operator API.

Errors use the existing `ErrorCode` vocabulary and HTTP status mapping. A host that wants to report "not in this environment" returns `403 FORBIDDEN` for an operation that is not in its `operations` list.

## 6. Optional server helper

`@streamotter/gateway/management` gains:

```ts
export interface ManagementHandlerOptions {
  gateway: Gateway;                         // must be a development-mode gateway
  operations: readonly WorkbenchOperation[]; // allowlist; everything else is 403
  authorize(request: IncomingMessage): boolean | Promise<boolean>; // host session check, called first
  maxBodyBytes?: number;                     // default 64 KiB; never above 1 MiB
}
export function createManagementHandler(options: ManagementHandlerOptions):
  (request: IncomingMessage, response: ServerResponse, pathWithinApi: string) => Promise<void>;
```

The host mounts it under its own `apiBase`, after its own session, lease and rate checks. It serves only API routes, no static files, and ignores `Authorization` headers: the host's `authorize` callback is the only credential check, so no native token ever reaches the browser. It refuses production gateways. `startManagementServer` is reimplemented on top of the same router, so both paths share validation.

Using the helper is optional. A host may implement the §5 contract itself, for example by mapping operations to its own fixed scenario intents.

## 7. Versioning and compatibility

- `hostContract` changes only for an incompatible change to §§2–5. Additive operations and fields keep `1`; the workbench discovers them through §4.
- The package version, not the milestone label, is what a host pins. A seam-compatible package can ship before the rest of native V1.1 (spec §10).
- A host must reject a workbench build whose `workbench-host.json` reports a different `hostContract` than it implements.

## 8. Verification (library side)

| Check | Family |
| --- | --- |
| The workbench boots from a boot block under a non-root path prefix, with `session` auth, against `createManagementHandler` mounted behind a fake host session check, in Chromium | F44 |
| With the boot block absent, `streamotter dev` behaves exactly as before (existing browser and management tests unchanged) | F44, F01 |
| An operation missing from `operations` is shown as unavailable and never called | F44 |
| No request from `session` mode carries an `Authorization` header or a token, and none goes to another origin | F37, F44 |
| `createManagementHandler` refuses production gateways, ignores bearer tokens, rejects unlisted operations with 403, and never serves raw evidence | F37 |
| The packed `@streamotter/workbench` tarball contains `workbench-host.json`, its integrity values match the files, and the exports resolve after `npm install` outside the workspace | F46 |

Hosted LC11 results are Lontra Creek's and do not gate the library release.

## 9. Implementation notes (revision 0.2)

These clarify revision 0.1 where implementing it needed a decision. None changes a field, path or name above.

| Section | Clarification |
| --- | --- |
| §2 | `connect-src` in `workbench-host.json` holds the literal placeholders `"<gateway origin>"` and `"<gateway websocket origin>"`; the host replaces them with its gateway's `http(s)` and `ws(s)` origins. Integrity values are computed from the final `app.js` and `styles.css` after the build. `exports` is `./host`, `./dist/*` and `./package.json`. The `WorkbenchHostManifest` type in `@streamotter/contracts` describes the file. |
| §3.2 | Only `hostContract` is required. `auth` defaults to `{ "mode": "token" }`, `environment` to `{ "kind": "development" }`, and `gateway.path` to `/streamotter/socket.io`; `gateway.origin` is required when `gateway` is present. `apiBase` must be one or more non-empty path segments (no `.` or `..`, no query, fragment, backslash or `//` prefix). `label` and `detail` are counted in characters and may not contain control characters; `packageVersion` is an exact version (`[0-9A-Za-z.+-]`, at most 64 characters). `validateWorkbenchHostConfig` in `@streamotter/contracts` implements these rules and returns JSON Pointer paths. A present `hostContract` other than `1` is reported alone, and the workbench shows the "unsupported host contract" screen for it. When a boot block is present, the gateway comes only from it; the meta tags are used only without a boot block. |
| §3.2 | In `session` mode the workbench also sends `redirect: "error"`, so a host that answers an expired session with a redirect cannot lead it to another origin. |
| §4 | `workbench` is in the operation vocabulary. `createManagementHandler` always answers `GET {apiBase}/workbench`, whether or not `workbench` is in its allowlist, and reports the allowlisted operations it implements (plus `workbench`). An allowlisted operation the installed gateway does not implement yet (the V1.1 failure operations before slice D) is not reported and answers 404. The native server reports every operation it implements and `limits.maxRequestBytes` 1048576. The workbench also refuses locally, without a request, any operation discovery did not report, and any body larger than `limits.maxRequestBytes`. |
| §4 | When a shell operation (`config`, `health`, `channels`, `sources`) is missing, the whole workbench shows "Not available in this environment" with the missing names. A missing tab operation replaces that tab's content; a missing button operation replaces that button. Without `dev.principals`, the principal list is empty and Preview is unavailable. |
| §6 | `createManagementHandler` requires `X-StreamOtter-Workbench: 1` on every POST and answers 403 `FORBIDDEN` without it (a CSRF guard: a cross-site form cannot set the header, and a cross-origin `fetch` that sets it needs a CORS preflight the handler never grants). GETs change nothing and do not need it. |
| §6 | Checks run in this order: `authorize` (401), route lookup (404 for an unknown path or method), allowlist (403), query parameters (400), the POST header (403), then the body (413, 400). `authorize` must return exactly `true`; anything else is 401, and a throw is a 500. |
| §6 | `maxBodyBytes` applies to every route served by the handler: default 65536, at most 1048576. A host that allows `config.validate` or `config.export` for full project configurations sets it higher (up to 1 MiB). `pathWithinApi` is the path after `apiBase`, such as `/traces`; the query string is read from it when it has one, and otherwise from `request.url`. Rate limiting is the host's. |
| §6 | Responses carry `X-Request-Id`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The handler adds no CORS headers and answers `OPTIONS` with 404. |
| §8 | The native server and `createManagementHandler` share one router (`packages/gateway/src/management/router.ts`). One native refinement follows from it: an unknown route now answers 404 before its body is read, where it previously could answer 400 or 413 for a malformed body first. |
