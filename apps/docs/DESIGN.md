# docs.streamotter.dev: design

How the docs site is put together, why, and what to do when the library changes. The README covers
the commands.

## Goals

- One place for everything a developer reads: the guides, the API reference, and Under the Hood.
- No second copy. Every page is built from files that already exist in this repository, so the
  docs change in the same pull request as the code they describe.
- Each published build describes exactly one release.
- Kept apart from the demo site (streamotter.dev, in the lontra-creek repository). The demo site
  links here once ("Docs and API"), and its old `/docs/` address redirects here.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Address | docs.streamotter.dev | A subdomain keeps the docs separate from the demo and needs no new domain. |
| Repository | StreamOtter, `apps/docs` | The guides, Under the Hood, and the doc comments already live here; a change to an export and its docs lands in one PR. |
| Framework | Astro 7, static output | It's the same framework as the demo site, so both look alike and share tokens, and it produces plain files that any static host serves. |
| API reference | TypeDoc 0.28 JSON model, rendered by our own pages | TypeDoc reads the types correctly. Rendering them ourselves keeps the pages in the site's design, with no TypeDoc theme to maintain. |
| Guides | Astro content collection over `docs/guides/*.md` | They stay ordinary Markdown that also reads well on GitHub. |
| Under the Hood | Served as is from `docs/under-the-hood/` | Its pages are self-contained HTML with their own type, which jason chose to keep. |
| Naming | "Guides" means only `docs/guides/`; the five-part series is "StreamOtter Under the Hood" ("Under the Hood" where space is tight) and its pages are "parts" | jason, so the series isn't confused with the guides in the header and footer. |

## Routes

| Path | Source |
| --- | --- |
| `/` | `src/pages/index.astro`: the three doors (Guides, API reference, Under the Hood), then the specifications and release links |
| `/guides/`, `/guides/<slug>/` | `docs/guides/<slug>.md`, in the order of `GUIDES` in `src/site.ts` |
| `/api/` | Every import path, plus a filterable list of every export |
| `/api/<path>/` | One import path's exports (`client`, `gateway`, `contracts`, `operator`, `management`, `cli`) |
| `/api/<path>/<name>/` | One export, on the page of the import path that declares it |
| `/under-the-hood/`, `/under-the-hood/<n>-<part>.html` | `docs/under-the-hood/*.html` under their own file names, so their relative links keep working; only when that folder exists |
| `/sitemap.xml`, `/404.html` | Generated |

The header follows the design thread's layout: the logo and a "Docs" tag on the left, then
Overview, Guides, API reference and Under the Hood, then the version, a "streamotter.dev ↗" button
(the way back to the demo) and GitHub. Below 1180px it collapses into a menu. The footer links
streamotter.dev, GitHub, npm and the changelog.

## How the API reference is generated

1. `pnpm build` at the root emits each package's `.d.ts` files with their doc comments, the same
   ones npm publishes.
2. `integrations/api-reference.mjs` runs TypeDoc over `streamotter`'s entry points, contracts
   first, so a type that several paths re-export is documented once, where it is declared. It
   uses `excludeInternal`, so anything tagged `@internal` stays out. A TypeDoc error fails the
   build.
3. `src/api-reference/build.ts` turns TypeDoc's JSON model into plain page data. It:
   - links every type reference and `{@link}` to its page or member anchor;
   - renders comments as Markdown with raw HTML off, and escapes everything else;
   - gives names that differ only in case different URLs (`streamError-function`);
   - points "View source" at `packages/<name>/src/` on GitHub at the release tag.
4. The pages in `src/pages/api/` place that data. They hold no logic beyond layout.

The builder is pure, so `test/api-reference.test.ts` feeds it small models. It also checks the real
package, making sure every internal link resolves and every exported path is documented.

## Guides

Guide pages render through Astro's Markdown pipeline. `integrations/repository-links.mjs`
rewrites their links:

- a link to another guide stays on the site, keeping its anchor;
- a link to any other repository file opens on GitHub at the release tag.

Heading anchors follow GitHub's rules, so anchors written for GitHub keep working.

## Keeping it complete

- **Doc comments:** `packages/streamotter/test/api-docs.test.ts` fails when a public export, or a
  member of an exported interface, class, or object type, has no doc comment.
- **Entry points:** both that test and `apps/docs/test/api-reference.test.ts` fail when the package
  exports an entry point the docs don't list.
- **Links:** `scripts/check-links.mjs` fails on any same-site link, asset, or anchor that doesn't
  resolve in the built site.
- **CI:** the "Docs site" job in `.github/workflows/ci.yml` runs all of the above on every push.

## Adding an entry point (for example `streamotter/react` in V1.3)

1. Add the export to `packages/streamotter/package.json` and its `src/<entry>.ts`.
2. Add `<entry>` to `ENTRIES` in `packages/streamotter/test/api-docs.test.ts`.
3. Add an entry to `API_MODULES` in `apps/docs/src/api-reference/modules.ts`, with its slug,
   title, and one-line description. The order there is the order on the site.
4. Doc-comment every new export and member. The tests above fail until steps 2 through 4 are
   done.

## Publishing (not set up yet)

- Build from a release tag:
  `pnpm install --frozen-lockfile && pnpm build && pnpm --filter @streamotter/docs build`.
- Serve `apps/docs/dist/` from any static host (for example Cloudflare Pages, like the demo
  site) at docs.streamotter.dev.
- On the demo site:
  - replace the Docs page with a "Docs and API" link;
  - redirect `/docs/` and `/docs/*` to `https://docs.streamotter.dev/`.
- Nothing is deployed and no DNS exists yet; jason decides when.

## Open items

- Under the Hood inside the site: the docs header around its reading column, clean URLs
  (`/under-the-hood/how-it-works/`), and links both ways between API pages and the parts that
  explain them. This waits for PR #69 and the design pass.
- Search beyond the export filter.
- Older releases: today each build is one release. A version switcher can come later, if it's
  needed.
