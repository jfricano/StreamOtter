# @streamotter/workbench

The static assets of the StreamOtter local workbench. You don't use this package directly: [`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) depends on it, and `streamotter dev` serves it from the loopback management origin (default `http://127.0.0.1:7401/`) behind a per-run token and a restrictive Content Security Policy. In the workbench you can check source connections, edit and validate candidate configuration, preview a live subscription as a development principal, inspect payload-free delivery traces, and export the canonical `streamotter.json`. `streamotter start` (production) never serves it. See the [CLI guide](https://www.npmjs.com/package/@streamotter/cli) for the walkthrough.

> **Release candidate.** `0.1.0-rc.1` is published under the `next` tag.

`dist/THIRD_PARTY_LICENSES.txt` lists the MIT-licensed Socket.IO client packages bundled into `dist/app.js`.

[Repository](https://github.com/jfricano/StreamOtter) · [Issues](https://github.com/jfricano/StreamOtter/issues) · MIT License © 2026 Orca Solutions
