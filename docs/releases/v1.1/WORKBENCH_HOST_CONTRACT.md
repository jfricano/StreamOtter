# Workbench host contract, version 1 (WHC-1)

**Status:** Interface specification, revision 0.3 (October 3, 2026). Implemented on branch `feat/v1.1-workbench-host` (PR 2 in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)); not merged or published yet. Revision 0.2 records the clarifications made while implementing it ([§9](#9-implementation-notes-revision-02)).\
**Changes:** revision 0.3 adds an optional `apiOrigin` boot field for a cross-origin API in `session` mode ([§3.4](#34-cross-origin-api-apiorigin-revision-03)), the scoped stylesheet `dist/workbench-host.css` for hosted pages ([§2.1](#21-styles-on-a-host-page-revision-03)), and a "session ended" state ([§10](#10-revision-03-notes)). All three are additive; `hostContract` stays `1`.\
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
| `dist/styles.css` | No remote fonts or imports. Styles the whole page; used by the native page. |
| `dist/workbench-host.css` | **Revision 0.3.** The same rules, every selector scoped under `[data-streamotter-workbench]` (§2.1). Hosts link this one. |
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
  "entry": { "script": "app.js", "style": "styles.css", "hostStyle": "workbench-host.css", "icon": "favicon.svg" },
  "integrity": { "app.js": "sha384-…", "styles.css": "sha384-…", "workbench-host.css": "sha384-…" },
  "bootElementId": "streamotter-workbench-host",
  "mountElementId": "app",
  "csp": {
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:"],
    "connect-src": ["'self'", "<api origin>", "<gateway origin>", "<gateway websocket origin>"],
    "frame-ancestors": ["'none'"]
  }
}
```

A host pins an exact package version (no ranges) and may check the integrity values at build time. The package also exports `@streamotter/workbench/host` (the manifest, as JSON) and `@streamotter/workbench/dist/*` (the files), so a host can resolve them with `require.resolve` instead of guessing paths.

The workbench needs no `unsafe-inline` and no `unsafe-eval`. The host must serve the assets with a CSP at least as strict as the manifest's; `connect-src` must name the gateway the preview connects to and, when the boot block sets `apiOrigin` (§3.4), that origin. `"<api origin>"`, `"<gateway origin>"` and `"<gateway websocket origin>"` are literal placeholders: the host replaces each with its value, or drops it when the boot block has no `apiOrigin` or no `gateway`.

### 2.1 Styles on a host page (revision 0.3)

`styles.css` styles the whole document (`:root` custom properties, `html`, `body`, `*`, and element selectors such as `h1`, `p` and `button`), which is right for the native page and wrong for a host page with its own header, footer and design tokens. A host links `workbench-host.css` (`entry.hostStyle`) instead:

- When a boot block is present, the workbench sets `data-streamotter-workbench` on its mount element before it renders anything (including the configuration-error screen).
- `workbench-host.css` is generated from `styles.css` at build time and holds the same rules with every selector scoped under `[data-streamotter-workbench]`. `:root` custom properties are declared on the mount instead; `html` and `body` rules become rules on the mount; `*` becomes the mount and its descendants; every other selector becomes a descendant of the mount (`h1` becomes `[data-streamotter-workbench] h1`). `@media` and `@supports` blocks are kept with their contents scoped. Nothing in the file can match outside the mount, so the host's own `h1`, `p`, `button` and custom properties such as `--radius` and `--accent` are unaffected.
- The transformer is small, dependency-free and strict: anything it cannot scope safely (`@keyframes`, `@font-face`, `@import`, `@property`, nested rules, `html`, `body` or `:root` anywhere but at the start of a selector) fails the build, so the published file is never a stale or partial copy.
- Scoping keeps the workbench's rules from leaking out. It does not stop a host's own rules from reaching into the mount: a host rule for a property the workbench does not set (for example a site-wide `h1 { color }`) still applies inside it, and a host rule more specific than one attribute plus one element wins. A host keeps its global element rules modest, or scopes them to its own regions.
- Without a boot block (the native page), the workbench does not mark the mount and `index.html` keeps linking `styles.css`, unchanged.

```html
<link rel="stylesheet" href="/workbench/assets/workbench-host.css" integrity="sha384-…">
```

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

The workbench reads the block once, when `app.js` is evaluated, so the block and the mount element must be in the document by then. Two orders work: the block in the page's HTML (a module script runs after the document is parsed, so its position relative to the `<script type="module">` tag does not matter), or a host script that inserts the block and then imports `app.js` (`document.body.append(block); await import("/workbench/assets/app.js")`). A block inserted or changed after `app.js` has run is never read. A host that imports `app.js` dynamically cannot put `integrity` on that import; it checks the file at build time against the manifest instead.

### 3.2 Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `hostContract` | `1` | Required. Any other value is refused with an "unsupported host contract" screen. |
| `apiBase` | string | Absolute path, without a trailing slash. Every operation path in §5 is appended to it. It is resolved against the page's own origin, or against `apiOrigin` when that is set; a URL or a `//host` path is refused, so `apiBase` alone can never point the workbench at another origin. Default `/management/v1`. |
| `apiOrigin` | string | **Revision 0.3.** Optional. The exact origin of the API when it is not the page's own, for example `"https://demo.streamotter.app"`. Allowed only with `auth.mode` `session`. See §3.4. |
| `auth.mode` | `"token"` or `"session"` | `token`: the native behavior. The workbench shows its token gate and sends `Authorization: Bearer <token>`, keeping the token in memory only. `session`: the host authenticates requests with its own credential (for example an `HttpOnly`, `SameSite=Strict` cookie). The workbench shows no token gate, sends `credentials: "same-origin"` (or, with `apiOrigin`, `mode: "cors"` and `credentials: "include"`), never sends an `Authorization` header, and adds `X-StreamOtter-Workbench: 1` to every request so the host can reject cross-site form posts. A `401` or `UNAUTHENTICATED` answer shows a "Session ended" screen with a Reload button and stops all requests (§10). |
| `gateway.origin`, `gateway.path` | string | The gateway the Preview tab connects to with the browser SDK. Optional; when absent, Preview is unavailable. |
| `environment.kind` | `"development"` or `"sandbox"` | Shown in the top bar. `sandbox` also shows a persistent banner with `label` and `detail`. |
| `environment.label` | string ≤ 64 | Required for `sandbox`, for example "Synthetic fixture" or "Real-Kafka synthetic demo". |
| `environment.detail` | string ≤ 280 | Optional explanatory line. Rendered as text, never markup. |
| `environment.packageVersion` | string | Optional. When present and different from the bundled version, the workbench shows a version-mismatch warning. |

Unknown fields are refused, so a host learns at once when it relies on a field this version does not support.

### 3.3 Native default

When the boot element is absent, the workbench behaves exactly as it does today: `apiBase` `/management/v1`, `auth.mode` `token`, gateway origin and path from the `streamotter-gateway-origin` and `streamotter-gateway-path` meta tags, and `environment.kind` `development`. `streamotter dev` keeps working with no change.

### 3.4 Cross-origin API (`apiOrigin`, revision 0.3)

Some hosts serve the page from one origin and the API from another: a static site on `https://streamotter.app` whose API and session cookie live on `https://demo.streamotter.app`. `apiOrigin` names that second origin explicitly:

```html
<script type="application/json" id="streamotter-workbench-host">
{
  "hostContract": 1,
  "apiOrigin": "https://demo.streamotter.app",
  "apiBase": "/workbench/api/v1",
  "auth": { "mode": "session" },
  "environment": { "kind": "sandbox", "label": "Synthetic fixture" }
}
</script>
```

Rules:

- **Shape.** An exact origin in canonical form, the way a browser reports `URL.origin`: scheme, lowercase host, and a port only when it is not the scheme's default; no user information, path, query, fragment or trailing slash. It must be `https:`; `http:` is accepted only for `localhost`, `127.0.0.1` and `[::1]`, so tests can run without TLS.
- **Mode.** Allowed only with `auth: { "mode": "session" }`. With `token` mode, or with `auth` absent (which means `token`), validation refuses the block at `/apiOrigin`.
- **Requests.** Every request goes to `apiOrigin + apiBase + path`, with `mode: "cors"`, `credentials: "include"`, `redirect: "error"` and `cache: "no-store"`. No `Authorization` header is ever sent; `X-StreamOtter-Workbench: 1` always is. Without `apiOrigin`, session mode is unchanged: same-origin credentials and `redirect: "error"`.
- **Fixed target.** The origin comes only from the validated boot block, read once at start-up. The request code resolves every URL and refuses, without sending it, any request whose origin is not that one; no response, URL parameter, storage or later DOM change can steer it elsewhere.
- **CSP.** The host's `connect-src` must list the `apiOrigin` (the manifest's `"<api origin>"` placeholder, §2).

What the host must do on the API origin (CORS):

- Answer the preflight (`OPTIONS`) for **exactly the page's origin**: `Access-Control-Allow-Origin: https://streamotter.app` (echoed only after comparing the request's `Origin` with that allowlisted value), `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: GET, POST`, and `Access-Control-Allow-Headers: Content-Type, X-StreamOtter-Workbench`. Every request carries the custom header, so every request, GET included, is preflighted.
- Send `Access-Control-Allow-Origin` (the same exact origin) and `Access-Control-Allow-Credentials: true` on every actual response, errors included, and `Vary: Origin`. A `401` without them reaches the workbench as a network failure, which shows as "unavailable" instead of "Session ended".
- Never use `*`, never reflect an arbitrary `Origin`, and refuse the preflight for any other origin. Browsers reject `*` with credentials anyway; reflecting any origin would let every site on the web drive the visitor's session.
- Keep requiring `X-StreamOtter-Workbench: 1` on mutations. `createManagementHandler` adds no CORS headers and answers `OPTIONS` with 404 (§9), so a host that uses it answers the preflight and adds the response headers itself, before delegating.
- Never answer with a redirect. The workbench refuses redirects, so one shows as "unavailable".

Cookies: a `SameSite=Strict` cookie set by the API origin is sent with these requests only when the page and the API are the same site (the same scheme and registrable domain, as `streamotter.app` and `demo.streamotter.app` are). A host whose API is on a different site would need `SameSite=None` and is subject to third-party-cookie blocking; WHC-1 does not recommend that topology.

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
| No request from `session` mode carries an `Authorization` header or a token, and none goes to an origin other than the page's or the boot block's `apiOrigin` | F37, F44 |
| With `apiOrigin` (revision 0.3): requests go only to that origin, carry its cookie and `X-StreamOtter-Workbench`, never `Authorization`; a redirect is refused; an origin that does not answer CORS shows as unavailable; `apiOrigin` with `token` mode or without `auth` is refused | F37, F44 |
| With `workbench-host.css` (revision 0.3): a host page's own element styles and custom properties are unchanged, the workbench inside the mount is styled, and no rule matches outside the mount | F44 |
| In `session` mode, a `401` or `UNAUTHENTICATED` answer shows "Session ended" with Reload, and no further request is made | F44 |
| `createManagementHandler` refuses production gateways, ignores bearer tokens, rejects unlisted operations with 403, and never serves raw evidence | F37 |
| The packed `@streamotter/workbench` tarball contains `workbench-host.json` and `workbench-host.css`, its integrity values match the files, and the exports resolve after `npm install` outside the workspace | F46 |

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

## 10. Revision 0.3 notes

Revision 0.3 adds what a host needs when its page and its API are on different origins of one site, and when the page keeps its own header, footer and styles around the mount. It adds one optional boot field, one manifest entry and one asset. No existing field, path or name changes meaning, and `hostContract` stays `1` (§7).

| Section | Clarification |
| --- | --- |
| §2 | `entry.hostStyle` is `"workbench-host.css"`, `integrity` covers `workbench-host.css` as well as `app.js` and `styles.css`, and `connect-src` gains the `"<api origin>"` placeholder. `WorkbenchHostManifest.entry` gains `hostStyle`. `entry.style` and `styles.css` are unchanged for native use. |
| §2.1 | The transformer is `apps/workbench/scope-css.ts`, run by `apps/workbench/build.mjs`. Every scoped selector gains the same one-attribute prefix, so the workbench's own cascade order is unchanged. The mount is marked whenever the boot element exists, valid or not, so the configuration-error and unsupported-contract screens are styled too. |
| §3.1 | A boot block written by the host's own script before it imports `app.js` is read; a browser test covers that order. |
| §3.2, §3.4 | `validateWorkbenchHostConfig` checks `apiOrigin` with `isWorkbenchApiOrigin` (exported from `@streamotter/contracts`). A malformed `apiOrigin` is reported once, as malformed, whatever the mode; a well-formed one with `token` mode or without `auth` is reported at `/apiOrigin`. `WorkbenchHostConfig` keeps optional fields, so the type does not express the coupling; validation enforces it. |
| §3.2 | "Session ended": in `session` mode, any `401` or `UNAUTHENTICATED` answer (including a `401` whose body is not JSON) replaces the workbench with a "Session ended" screen whose Reload button reloads the page. Inspect's polling stops, and any later call fails locally without a request. Other failures keep the "unavailable" screen with Retry. `token` mode is unchanged: a `401` returns to the token gate. |
| §6 | `createManagementHandler` is unchanged and still adds no CORS headers: a host that sets `apiOrigin` answers the preflight and adds the response headers itself (§3.4). The `X-StreamOtter-Workbench` check keeps its CSRF value, because the host grants the preflight to its own page origin only. |

### 10.1 Security reasoning for `apiOrigin`

- **Why an explicit field.** Until revision 0.3 the API's origin was always the page's own, because `apiBase` is a path. Accepting a URL in `apiBase` would make every `apiBase` a possible cross-origin target. A separate field keeps `apiBase` path-only, so a block without `apiOrigin` still cannot reach another origin, makes the cross-origin decision visible on its own line in review, and lets validation apply origin rules: `https:` only, canonical form, no path.
- **Why `session` mode only.** `token` mode sends a native per-run management token in `Authorization`. Sending it to another origin would hand a native credential to a server that WHC-1 does not govern, while the native server stays loopback-only (§1). In `session` mode the workbench handles no credential at all: the browser attaches the API origin's own cookie under the attributes that origin chose.
- **Why no registrable-domain check.** A browser page cannot compute eTLD+1 reliably. The Public Suffix List is not exposed to scripts, a copy bundled into `app.js` would go stale, and a wrong answer would allow or refuse the wrong hosts. The boot block is written by the host, which already controls the page, its CSP and the API, so `apiOrigin` is the host's own declaration of where its API is. The enforcement that matters sits with the host: CORS on the API origin allows exactly the page origin, and the page's `connect-src` names exactly the API origin. The workbench adds the checks it can make reliably (`https:` and exact-origin shape), and documents that `SameSite=Strict` cookies only work same-site (§3.4).
- **Why `credentials: "include"` is acceptable.** The browser sends only the API origin's cookies, and withholds the response unless that origin's CORS answer allows credentials for this exact page origin. `redirect: "error"` keeps a redirect from carrying the request to another origin.
- **Host CORS obligations.** As listed in §3.4: answer the preflight for exactly the page origin, with `Access-Control-Allow-Credentials: true` and `X-StreamOtter-Workbench` (and `Content-Type`) in `Access-Control-Allow-Headers`; send the same `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` on every response, errors included; never use `*` and never reflect an arbitrary `Origin`.
