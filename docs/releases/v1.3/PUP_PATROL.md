# Pup Patrol — the V1.3 demo, a React game on lontracreek.dev

**Status: planned, not approved for build.** Decided by the owner on October 6, 2026 (Pacific): the demo for StreamOtter's React hooks ([StreamOtter V1.3](./README.md), shipping in `streamotter@1.0.0`, the public launch) is a small React game, **Pup Patrol**, in **its own repository in the orca-solutions GitHub organization** (decided October 6, 2026, Pacific; not a monorepo), on its own domain, **lontracreek.dev**, linked from streamotter.dev. This document is the plan. It lives here until that repository exists; the owner creates the repository when the build starts, and the plan moves there. The build waits for the owner's go. Only the launch waits for `1.0.0` on npm and the Lontra Creek phase-two site: development can start earlier (see Sequencing). The concept comparison that led here is kept in [PUP_PATROL_CONCEPTS.md](PUP_PATROL_CONCEPTS.md).

## What it is

A sixty-second arcade round, replayable. You are Pebble (LO-07). Sprout and Skipper, her untagged pups, wander out of Holt A toward the Beaver Flats camera trap; you herd them back before the trap fires. Score is pups home at the bell, minus every frame the trap took of them. The high score lives in the browser.

The creek is real. The pups' wandering and the trap's timing are not scripted by the game: they come from the live `reach` camera-trap view at Beaver Flats and from a new public view of Holt A's occupancy, through the same Kafka path and gateway as the field station page. The game is a side quest: a fun thing on its own domain that happens to be the clearest possible demo of the hooks.

### What it shows off

| StreamOtter behavior | How the player feels it |
| --- | --- |
| `useSubscription` renders live data | Pups and the trap move with the channel; the under-the-hood drawer shows each subscription's state and revision. |
| `stale` | A stale `reach` freezes the trap mid-flash; stale den data hides the pups. The round pauses with "lost the receiver", and resumes on `live`. Last-known positions stay, greyed. |
| Connection drop and reconnect (`useConnectionState`) | A signal bar. On reconnect, the fresh snapshot visibly resets the pups: the game never guesses what happened while it was out. |
| `resync-required` | A "re-tune" button that calls `resync()`. |
| Audience rule | Holt A's grid reference is withheld from the public view the game reads; the den is drawn at a reach, not a point. |
| Mount and unmount | A round mounts its subscriptions and the end screen unmounts them; the drawer's count goes to zero. StrictMode in development leaves exactly one per component. |
| Hooks in an animation loop | A 60 fps canvas re-renders freely while three subscriptions stay put: params by value, no resubscribe. |

**Where React comes in.** React owns the app and the data; a canvas owns the frames. Components: the page shell, start and end screens, score, the signal bar, the under-the-hood drawer, and one `Round` component that holds the game, all under `StreamOtterProvider`. Inside `Round`, `useSubscription("reach", …)`, `useSubscription("den", …)` and `useConnectionState()` are the only way the game learns about the creek; each update re-renders `Round`, which writes the new targets into a ref. A `requestAnimationFrame` loop on a canvas, started by an effect and stopped on unmount, tweens the pups toward those targets, moves Pebble from input and detects the herd, without going through React per frame. A stale subscription pauses the round and shows the overlay; `live` resumes it. The subscriptions' lifetimes are the component's lifetime.

**Tick rate and animation.** The field station publishes one tick every 2 seconds (`FIELD_TICK_MS`, default 2000; a tick is five simulated minutes). The channel sets targets, the browser animates between them: each `reach` and `den` update gives the pups and the trap a new target, and the canvas tweens toward it at 60 fps, so motion is smooth while `useSubscription` re-renders only on real updates. Pebble and the herding nudge are local and instant. A stale channel freezes the targets, not the frame, which is the "last known" the game shows; the fresh snapshot on reconnect snaps them. The production tick is not changed for the game, since it drives the whole creek; if finer motion is ever wanted, a game-only view can emit sub-steps.

Everything is read-only: no new write anywhere, visitors send nothing to the broker, the fiction is labeled on the page, and when the demo backend is down the page shows a labeled recording of a round rather than a silent substitute, as streamotter.dev's home page does.

## Where it lives

**Its own repository, `orca-solutions/pup-patrol`** (name open), created by the owner when the build starts. Not a workspace in lontra-creek and not a monorepo. It follows Lontra Creek's ground rules as a second consumer of the published packages:

- A small React app built with Vite (not Astro: the game is one interactive screen, not a content site). At launch it pins `streamotter@1.0.0` exactly from npm. During development it may use a prerelease (`1.0.0-rc.N` from the registry) or a packed tarball of the hooks branch, since this repository is not bound by Lontra Creek's published-packages-only rule; the pin moves to the final `1.0.0` before anything goes live. It never links the StreamOtter or lontra-creek checkouts; the few creek identifiers it needs (reach and holt ids, the `den` and `reach` channel types) come from its own generated `streamotter.generated.ts`, produced by `streamotter generate` against a copy of the field station's public channel definitions, so a drift is caught by the contract check, not by a shared import.
- Its own CI: typecheck, unit tests, a Playwright round in fixture mode, and a release-pin guard copied from lontra-creek (`scripts/check-release-pins.mjs`) so the registry is the only source of `streamotter`.
- Its own deploy: a static build to **lontracreek.dev** on Cloudflare Pages, the way streamotter.dev is deployed, with the domain on Cloudflare DNS.
- A fixture mode for development and tests: a local `streamotter dev` with the `den` and `reach` fixtures, so the game runs without Kafka and without the demo host.
- In production it reads the demo gateway at demo.streamotter.dev and the field station's `/api/session` for a volunteer badge, as streamotter.dev does.

## What changes in lontra-creek (the demo backend)

| Change | Notes |
| --- | --- |
| New public view: `den` | Holt A's occupancy without the grid reference: `{ holtId, reachId, occupied, pupsAtDen: boolean, lastEntry, lastExit }`. A new `DenStatus` schema and `den` channel (params `{ holtId }`, state, overflow `resync`) in `streamotter.json`, `streamotter.fixture.json` and `streamotter.production.json`; a `den` view in `packages/creek-sim/src/views.ts`, published by the field station beside `holt`; generated types regenerated. The restricted `holt` channel is untouched. |
| Second allowed origin | Today production accepts one exact `SITE_ORIGIN` (`config.ts` refuses a list; `deploy/Caddyfile` matches one literal `Origin`), and the gateway's baked-in `allowedOrigins` lists only streamotter.dev. The game needs `https://lontracreek.dev` added in all three places: `allowedOrigins` in `streamotter.production.json`, a `SITE_ORIGINS` list accepted by `config.ts` and the CORS code, and a Caddy matcher for either origin. This is the one backend change, and it is part of the game's rollout, not a separate release. |
| Session cookie | The volunteer badge is `SameSite=Strict`, which a page on lontracreek.dev cannot send to demo.streamotter.dev. Options, decided at build time: the game calls `/api/session` and holds the token in memory for the round (simplest, no cookie), or the badge becomes `SameSite=None; Secure` for the game's origin only. The first is recommended. |
| Fixture scenario | A fixture where the pups leave the den and the trap fires on a schedule, published in `streamotter.fixture.json` so the game repository can copy it for its own fixture mode. |
| Tests | `creek-sim` unit tests for the `den` view (never carries `gridRef`); the field-station contract check includes `den`. The game's own e2e (load, one round in fixture mode, a forced stale state and the resume) lives in the game repository. |
| Docs | A short lontra-creek site release note for the `den` channel and the second origin, under its `docs/releases/`; its site plan notes the second domain. |

## The page on streamotter.dev

One page on streamotter.dev (in lontra-creek's `apps/site`), in the site's existing Docs family rather than a new navigation item (the design thread's layout for Docs applies): what Pup Patrol is, a short recording, the three hooks it uses with the real code from the game repository, what to watch for (pull your network cable; see the round pause), and the link out to lontracreek.dev. It describes the pinned version and shows the hooks only once `1.0.0` is published, per the site's "every claim matches the pinned release" rule. The site's own `streamotter` pin moves to `1.0.0` in the same release.

## Sequencing

1. Lontra Creek's phase-two site in production (its main freeze lifts). Nothing in lontra-creek from this plan merges before that.
2. The owner gives the go and creates `orca-solutions/pup-patrol`; this plan moves there and the game gets its own thread. Work can start at once, in fixture mode, against the hooks as a prerelease or a packed tarball; it does not wait for the publication.
3. StreamOtter publishes the hooks in `1.0.0-rc.1`, then `1.0.0`. The game pins the rc for a preview, then the final before launch. The explainer page on streamotter.dev and the production pin follow `1.0.0`.
4. Build order: in lontra-creek, the `den` view and channel (fixture first, then Kafka) and the second-origin change; in the game repository, the game on fixture mode, then against the demo gateway; in lontra-creek, the explainer page; then hosted acceptance on the real deployment, including the stale and reconnect states.
5. Domain and host: lontracreek.dev on Cloudflare DNS and a Pages project for the game; the origin added to the demo host's configuration through the shared-host procedure with devops.

## Open decisions

1. The repository name under orca-solutions (`pup-patrol` assumed above).
2. Session handling for the second origin: token in memory (recommended) or a cross-site cookie.
3. Whether the explainer page waits for `1.0.0` final or goes up with the rc preview, labeled as such.
4. Name and route of the explainer page on streamotter.dev.
