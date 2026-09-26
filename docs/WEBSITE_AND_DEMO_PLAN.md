# StreamOtter home site and live demo

September 25, 2026 · A separate project, in progress; not part of this repository

## Decision

The home site and live demo are their own project, **Lontra Creek**, to be published at `streamotter.app`. It is a fictional river-otter study: a simulated watershed with gauge stations, tagged otters, camera traps, and protected den sites, whose data moves through real Kafka, a StreamOtter gateway in production mode, and the browser SDK. Its pages cover the product, a guided walkthrough, a Failure Lab where each visitor breaks an isolated setup on purpose, an in-browser configuration playground, the workbench, and failure handling.

This replaces the earlier plan to host the order-dashboard example as an integrated `/demo`. The order dashboard stays in this repository as the reference example, with its tests.

Lontra Creek uses StreamOtter only as the published `streamotter` package from npm, at an exact version, the way any application does. It has no source, build, test, or documentation-build connection to this repository, and this repository doesn't depend on it. Its scope, operating rules, hosting, and launch criteria are maintained with that project.

## What this repository owes the site

- **Releases whose behavior matches these docs.** The site pins one published version and describes only that version.
- **Accurate public documentation.** The site links to the guides, the package READMEs, the changelog, and the [implementation status](./IMPLEMENTATION_STATUS.md) (support matrix and limits) instead of copying them.
- **Fixes through releases.** A problem the demo finds arrives as an issue, like any user's report, and the site uses the fix only after it ships in a release (a release candidate counts).
- **One requested library change:** `streamotter generate` keeps file writing separate from generation, so the site's playground can generate types in the browser. Not started.

The rules for public claims stay the same: no invented adoption, performance, or capacity numbers; recordings labeled as recordings; and nothing presented as shipped before it is.

## Gate A: ready to implement the public experience

All of the following must be recorded in `docs/IMPLEMENTATION_STATUS.md` when the runtime exists:

- The full [V1 acceptance scenarios](./V1_API.md#12-acceptance-scenarios-and-current-verification) pass, including real Kafka checks for progress, rebalance, and failure behavior.
- Gateway, SDK, workbench, CLI, and generation complete their declared workflow; a clean checkout and exported example are verified.
- Production build/deployment works within the single-gateway boundary and exposes no management or development actions.
- Auth, revocation, synchronization, cleanup, overload/resource limits, and supported broker authentication paths have results and explicit limitations.
- No unresolved failure contradicts a promised V1 behavior. Deferred capabilities are documented rather than presented as implemented.

A happy-path demo, screenshots, or passing type declarations do not pass this gate. It establishes a working, tested V1 release candidate; it does not require a prior broad public launch.

## Gate B: ready for the public launch

Gate B now belongs to the site project. In summary: every route and call to action works; the hosted walkthrough and Failure Lab pass against the pinned release on the real deployment, including session isolation, expiry, denial, reconnect, and the busy and unavailable states; accessibility, social previews, and measured load times are in place; and HTTPS, WebSockets through the proxy, secrets, quotas, monitoring, rollback, and the fallback recording are verified on staging. When the site launches, [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) records the release it runs.
