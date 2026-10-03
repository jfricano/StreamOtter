<p align="center"><img src="https://raw.githubusercontent.com/jfricano/StreamOtter/main/docs/assets/streamotter-logo.png" alt="StreamOtter" width="300"></p>

# @streamotter/workbench

The static assets of the StreamOtter local workbench. You don't usually use this package directly: [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) depends on it, and `streamotter dev` serves it from the loopback management origin (default `http://127.0.0.1:7401/`) behind a per-run token and a restrictive Content Security Policy. In the workbench you can check source connections, edit and validate candidate configuration, preview a live subscription as a development principal, inspect payload-free delivery traces, and export the canonical `streamotter.json`. `streamotter start` (production) never serves it. See the [CLI guide](https://www.npmjs.com/package/@streamotter/cli) for the walkthrough.

Workbench is development tooling, not a required stage between the gateway and production frontends. Production subscriptions use the browser SDK connected to a compatible running gateway. See [runtime and package requirements](https://github.com/jfricano/StreamOtter/blob/main/docs/guides/existing-app.md#runtime-and-package-requirements).

> **Release candidate** of StreamOtter `0.1.0`.

`dist/THIRD_PARTY_LICENSES.txt` lists the MIT-licensed Socket.IO client packages bundled into `dist/app.js`.

## Hosting the workbench on your own site

The same assets can run under a route of your own site, such as `https://example.com/workbench/`, against an API you provide. The [workbench host contract (WHC-1)](https://github.com/jfricano/StreamOtter/blob/main/docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md) defines it; in short:

- **Assets.** `dist/` holds `app.js` (an ES module with no inline script or `eval`), `styles.css` (for the native page), `workbench-host.css` (for yours), `favicon.svg` and `THIRD_PARTY_LICENSES.txt`, all referenced relatively. `dist/workbench-host.json` names them with `sha384` integrity values and the Content Security Policy they need. Resolve the files instead of guessing paths: `require.resolve("@streamotter/workbench/host")` for the manifest and `@streamotter/workbench/dist/<file>` for the assets. Pin an exact version.
- **Boot block.** Put a `<script type="application/json" id="streamotter-workbench-host">` element before `<div id="app">` and the module script. It names `apiBase` (a path on your page's origin), `auth.mode` (`token`, or `session` for your own cookie, in which case no `Authorization` header is ever sent and every request carries `X-StreamOtter-Workbench: 1`), the `gateway` that Preview connects to, and an `environment` label (`sandbox` shows a persistent banner). An invalid block shows a configuration error and makes no requests. The workbench reads the block once, when `app.js` runs: put it in the page, or insert it from your own script before you import `app.js`. In `session` mode, a `401` or `UNAUTHENTICATED` answer shows "Session ended" with a Reload button. `validateWorkbenchHostConfig` in [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) checks a block before you ship it.
- **API on another origin.** When your API lives on another origin of your site (a static `https://example.com` with its API and session cookie on `https://api.example.com`), set `"apiOrigin": "https://api.example.com"` with `session` auth. Requests then use CORS with `credentials: "include"` and `redirect: "error"`. Your API must answer the preflight for exactly your page's origin, with `Access-Control-Allow-Credentials: true` and `Content-Type, X-StreamOtter-Workbench` allowed, send the same headers on every response including errors, and never use `*`. Add the origin to `connect-src` (the manifest's `"<api origin>"` placeholder). See WHC-1 §3.4.
- **Styles.** Link `workbench-host.css` (`entry.hostStyle` in the manifest), not `styles.css`. When a boot block is present the workbench marks its mount with `data-streamotter-workbench`, and every rule in `workbench-host.css` is scoped under that attribute, so your own `h1`, `p`, `button` and custom properties such as `--accent` are left alone around the mount. See WHC-1 §2.1.
- **Capabilities.** The workbench first calls `GET {apiBase}/workbench` and offers only the operations listed there. Anything else shows "Not available in this environment" and is never called.
- **Server.** Implement the operations yourself, or mount `createManagementHandler` from [`@streamotter/gateway/management`](https://www.npmjs.com/package/@streamotter/gateway) behind your own session check, with an operation allowlist, for a development-mode gateway.

```html
<script type="application/json" id="streamotter-workbench-host">
{ "hostContract": 1, "apiBase": "/workbench/api/v1", "auth": { "mode": "session" },
  "gateway": { "origin": "https://example.com", "path": "/sandbox/socket.io" },
  "environment": { "kind": "sandbox", "label": "Synthetic fixture", "packageVersion": "0.1.0-rc.3" } }
</script>
<div id="app"></div>
<link rel="stylesheet" href="/workbench/assets/workbench-host.css" integrity="sha384-…">
<script type="module" src="/workbench/assets/app.js" integrity="sha384-…"></script>
```

Without the boot block (the page `streamotter dev` serves), the workbench behaves as before: it asks for the per-run token and calls `/management/v1`.

## StreamOtter packages

| Package | |
| --- | --- |
| [`streamotter`](https://www.npmjs.com/package/streamotter) | Everything below in one install, with the `streamotter` command |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | **This package.** The local workbench's assets, installed by the CLI |

All six are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

[Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · MIT License © 2026 Orca Solutions
