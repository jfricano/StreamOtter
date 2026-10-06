# V1.3 prototype handoff

For whoever builds V1.3. Written October 6, 2026, when the owner paused the build to plan first.

## What exists

A working prototype of the whole surface in [the plan](./README.md) was written and tested the same day, then taken off the branch so that this PR carries planning only. It is saved as a git patch in the project's shared files, `release-v1.3/react-hooks-prototype.patch` (665 insertions, 10 files, against `main` at `1c75aaa`). Apply it with `git apply` on a fresh branch from `main`; expect the lockfile hunk to need `pnpm install` if `main` has moved.

What the patch contains, and what was verified:

| File | Content | Verified |
| --- | --- | --- |
| `packages/client/src/react.ts` | `StreamOtterProvider` (`client` or `options`), `useSubscription`, `useConnectionState`, `useStreamOtterClient`, `createStreamOtterHooks`, `SubscriptionResult` | `pnpm typecheck` clean |
| `packages/client/test/react.test.ts`, `test/dom.ts` | 12 unit tests on a fake client (happy-dom document, `act`): all the cases the plan lists | 12 of 12 pass on Node 24.21 |
| `tests/integration/react.test.ts` | StrictMode tree against the fixture gateway: snapshot, update, `FORBIDDEN`, `subscriptionCount()` 1 then 0 on unmount | passes |
| `examples/order-dashboard/src/web/react.tsx` | Rewritten on the hooks; `useOrderStatus` and the hand-written provider removed | `pnpm build` clean; the Playwright `/react` check was **not** run |
| `packages/client/package.json`, `packages/streamotter/package.json`, `packages/streamotter/src/react.ts` | `./react` exports (both maps), optional `react >= 18` peer, dev deps | `pnpm build` clean; `pnpm test:install` was **not** run |
| `tests/package.json`, `pnpm-lock.yaml` | react, react-dom, @types/react(-dom) 19.3.0, happy-dom | |

## Things learned

- **happy-dom 20.9.0, not latest.** 20.10 and later ship a `BrowserWindow.d.ts` that references `UnderlyingDefaultSource` from `node:stream/web`, which `tsc -p tsconfig.check.json` (`skipLibCheck: false`, `@types/node` 24.13.6) rejects. 20.9.0 type-checks. Alternatives: jsdom, or `react-dom/server`-free tests through `react-test-renderer`.
- **Node's type stripping** (`--conditions=streamotter-source` runs `.ts` directly) rejects TypeScript parameter properties (`constructor(readonly x)`), so test fakes use explicit fields, as the rest of the repo does.
- **`act` and the gateway.** Waiting for a real gateway inside a single `act(async …)` callback stalls React's commits; the integration test instead loops `await act(() => sleep(10))` until the rendered result satisfies a predicate.
- **`getToken` is read through a ref** updated in an effect, so an inline `getToken` doesn't recreate the client; only `origin`/`path` do. Identity changes use `key` on the provider.
- **Params identity** is a canonical key (sorted names, `typeof`, `String(value)`) so `{ a, b }` and `{ b, a }` are one subscription; the effect depends on `[client, key]`.
- `StreamOtterProvider` renders with `createElement`, not JSX, so `packages/client` needs no `jsx` compiler option.
- Node 24 was not on the image; it was downloaded from nodejs.org into the scratchpad (see the `streamotter-repo` memory).

## Still to do when the build opens

1. Apply the patch, rebase on `main`, `pnpm verify`.
2. Run `pnpm test:browser` (the `/react` order-dashboard check) and `pnpm test:install`; add the React consumer to the install test per the plan's deliverables table.
3. Documentation pass per the plan: client README, guides, V1_API §13, IMPLEMENTATION_STATUS, README, CHANGELOG.
4. Settle the plan's open decisions with the owner; they are small and the prototype takes the recommended answer to each.
5. Version: nothing until release; the hooks ship as `1.1.0` after the `1.0.0` launch.
6. The owner reviews before the PR opens (the usual independent review was skipped during planning at his request).
