# @streamotter/workbench

The static assets of the StreamOtter local workbench. You don't use this package directly: [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) depends on it, and `streamotter dev` serves it from the loopback management origin (default `http://127.0.0.1:7401/`) behind a per-run token and a restrictive Content Security Policy. In the workbench you can check source connections, edit and validate candidate configuration, preview a live subscription as a development principal, inspect payload-free delivery traces, and export the canonical `streamotter.json`. `streamotter start` (production) never serves it. See the [CLI guide](https://www.npmjs.com/package/@streamotter/cli) for the walkthrough.

> **Release candidate** of StreamOtter `0.1.0`.

`dist/THIRD_PARTY_LICENSES.txt` lists the MIT-licensed Socket.IO client packages bundled into `dist/app.js`.

## StreamOtter packages

| Package | |
| --- | --- |
| [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) | Scaffold, validate, generate types, develop with the workbench, and run the production gateway |
| [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) | The browser SDK: subscribe, render `live` and `stale`, and clean up |
| [`@streamotter/gateway`](https://www.npmjs.com/package/@streamotter/gateway) | Handler types, and running the gateway from your own Node.js code |
| [`@streamotter/contracts`](https://www.npmjs.com/package/@streamotter/contracts) | Shared types and configuration validation, for tooling authors |
| [`@streamotter/workbench`](https://www.npmjs.com/package/@streamotter/workbench) | **This package.** The local workbench's assets, installed by the CLI |

All five are released together with the same version ([changelog](https://github.com/jfricano/StreamOtter/blob/main/CHANGELOG.md)).

[Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · MIT License © 2026 Orca Solutions
