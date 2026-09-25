# Contributing to StreamOtter

Thanks for helping. This guide covers setup, the test tiers, and what a change needs before it is merged.

## Scope first

StreamOtter V1 is deliberately small: one gateway, state channels with snapshot resynchronization, application-owned access, and bounded delivery. The [V1 API specification](./docs/V1_API.md) governs behavior. Durable replay, multiple gateways, commands, and other V2/V3 items on the [roadmap](./docs/API_AND_FEATURE_ROADMAP.md) are intentionally deferred. For anything beyond a bug fix or documentation, please open an issue to discuss it before writing code.

Security problems: follow [SECURITY.md](./SECURITY.md), not the public issue tracker.

## Setup

- Node.js 24 or later (CI runs 24 and 26).
- pnpm 11.19.0, the version in `packageManager`. `npx pnpm@11.19.0 <command>` works without a global install.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm example        # the reference app at http://localhost:3000, the workbench at http://127.0.0.1:7401
```

Tests and type-checks run the TypeScript sources through the `streamotter-source` export condition. `pnpm build` emits `dist/`, which is what the packages publish. Each package's `publishConfig.exports` repeats its `exports` without that condition, so keep the two maps in step. `pnpm test:install` fails if they differ.

## Test tiers

| Command | Needs | Runs in CI |
| --- | --- | --- |
| `pnpm check:contracts`, `pnpm typecheck` | Nothing extra | Every push |
| `pnpm test` (unit and integration), `pnpm test:load` | Nothing extra | Every push |
| `pnpm test:install` (pack, install with npm outside the workspace, use as an app) | Network access to the npm registry | Every push |
| `pnpm test:kafka` | `pnpm kafka:setup` once, then `pnpm kafka:start` | Nightly |
| `pnpm test:browser` | `pnpm browsers:setup` once (Linux may also need Playwright's system libraries) | Nightly |
| `pnpm test:deploy` | `pnpm deploy:setup` once, plus the running broker | Nightly |

With the broker running, `pnpm test:install` also runs the installed `streamotter start` against TLS Kafka.

The setup scripts download pinned, checksum-verified tools into the gitignored `.local/` folder: Apache Kafka 4.1.2 (plus a JDK on Apple silicon; elsewhere they use Java 17+ from `PATH`), headless Chromium, and Caddy. Stop the broker with `pnpm kafka:stop`, and delete `.local/` to remove everything.

## Making a change

- Keep TypeScript strict. The public types live once, in `@streamotter/contracts`.
- Add or update tests with every behavior change. Failure and recovery paths matter as much as the happy path.
- Keep the documents accurate. When behavior or types change, update [V1_API.md](./docs/V1_API.md) (§13 records implementation refinements). When features or verified results change, update [README.md](./README.md) and [IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md), recording the commands you ran and the results you saw. Never add capacity or performance claims that no test measured.
- Add a line to [CHANGELOG.md](./CHANGELOG.md) for user-visible changes.

In a pull request, say what changed, why, and which test tiers you ran.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE) that covers this project.
