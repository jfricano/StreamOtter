# StreamOtter implementation context

Start with [docs/IMPLEMENTATION_HANDOFF.md](docs/IMPLEMENTATION_HANDOFF.md). It records the current implementation status, reading order, build sequence, scope, and verification expectations.

The behavioral authority is [docs/V1_API.md](docs/V1_API.md); public type contracts and examples are in `contracts/v1/`. Roadmap snippets are forecasts and may be superseded by the V1 specification.

V1 is implemented (gateway, SDK, CLI, workbench, reference example) and tested; see `docs/IMPLEMENTATION_STATUS.md`. The public home site and hosted demo are the next milestone and are not started. Preserve the single-gateway, state-channel scope and explicit recovery/access behavior. V2/V3 features remain deferred.

Baseline: `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check:contracts`, `pnpm typecheck`, `pnpm test`. Real-Kafka tests need `pnpm kafka:setup && pnpm kafka:start`, then `pnpm test:kafka`. Browser tests need `pnpm browsers:setup` (`pnpm test:browser`); the proxied deployment check also needs `pnpm deploy:setup` and the broker (`pnpm test:deploy`). `pnpm test:install` packs the five public packages and installs them with npm outside the workspace. Releases follow `docs/RELEASE_CHECKLIST.md`; never push or publish without the owner's go-ahead. Tests and type-checks run from TypeScript sources via the `streamotter-source` export condition; `pnpm build` emits `dist/`. Keep `README.md` and `docs/IMPLEMENTATION_STATUS.md` accurate about implemented features and verified results. User guides live in `docs/guides/` and `docs/DEPLOYMENT.md`; the package READMEs are the npm pages (absolute links only; npm shows them only for a newly published version). Keep all of them accurate when behavior changes.
