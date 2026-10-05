# StreamOtter brand assets

StreamOtter has two logos. Use the **brandmark** (the flat S-otter mark, its lockups, and its icon) in the READMEs and on the npm pages, and wherever the logo is small or repeated: headers, footers, favicons, app icons, link cards, stickers, and slide corners. Use the **detailed logo** where there's room for an illustration: articles and title slides. Don't recolor, redraw, stretch, or crop any of them, and don't set "StreamOtter" in a font in place of the wordmark.

## The detailed logo

An otter swimming through a stream of code, with the wordmark below. It's raster only.

| File | Size | Use |
| --- | --- | --- |
| `streamotter-logo.png` | 800 × 455, white background | Light backgrounds. npm pages for `0.2.0-rc.1` and earlier link to this file on `main`, so it never moves or changes name. |
| `streamotter-logo-dark.png` | 1397 × 791, transparent | Dark backgrounds: "Stream" in light ink. |
| `streamotter-logo-full.png` | 1536 × 1024, white background | Large uses: article headers, title slides. |

Keep it at least 240 px wide. Below that, the code lines and whiskers turn to noise; use the brandmark instead.

## The brandmark

Flat vectors, each in a light version (for light backgrounds) and a `-dark` version (for dark backgrounds: the S body and "Stream" turn light ink `#E9F2FC`, and the whiskers `#A9BAD5`).

| File | Use | Minimum size |
| --- | --- | --- |
| `streamotter-lockup-horizontal.svg`, `-dark.svg` | The default signature: site and app headers, slide corners, and link cards that need a wide shape | 120 px wide |
| `streamotter-lockup-stacked.svg`, `-dark.svg` | Centered and formal uses: footers, title cards, and square spaces | 96 px wide |
| `streamotter-readme-lockup.svg`, `-dark.svg`, `.png` | The stacked lockup cropped tight, for the READMEs. The repository README shows the SVGs (dark in GitHub's dark mode); the package READMEs link to the PNG (720 × 516, white background) on `main`, because npm needs an absolute URL. Keep its name and location. | 240 px wide |
| `streamotter-mark.svg`, `-dark.svg` | The symbol alone, when the name is already next to it: 404 pages, avatars, stickers | 24 px tall |
| `streamotter-wordmark.svg`, `-dark.svg` | The name alone, rarely: where the mark would repeat something beside it | 80 px wide |
| `streamotter-app-icon.svg`, `streamotter-app-icon-512.png` | App and touch icons: the dark mark on an ink rounded square | 32 px |
| `streamotter-favicon.svg` | Browser tabs, 16–48 px: the S and a solid head, with the whiskers, splash, and muzzle left out so it stays legible | 16 px |

Leave clear space around every lockup equal to the height of the wordmark's "O", and a quarter of the mark's height around the mark alone.

The brandmark files were made from the owner's trace of the brand spread, `logo-brand-mark.svg` (`name-brand-mark.svg` is the same trace with a different view, and `streamotter-brand-mark-spread.png` the presentation image). Those three are sources, not files to publish.

## Colors

| Name | Hex | Where it comes from |
| --- | --- | --- |
| Ink | `#04183F` | "Stream" and the S body |
| Azure | `#048DFC` | "Otter" and the top of the S |
| Splash | `#04BDFD` | The lower waves and droplets |
| Otter brown | `#7F5447` | The head |
| Cream | `#EBE6DF` | The muzzle |
| Light ink | `#E9F2FC` | Ink's replacement on dark backgrounds |

Azure and splash are fills, not text colors, on light backgrounds (azure on white is 3.4:1, short of the 4.5:1 body text needs). For blue text on light backgrounds, use `#0369C9`.

### View states

Wherever a picture shows a view's state, use the same colors as streamotter.dev, so the site, the illustrations and the launch visuals agree.

| State | On dark | On light |
| --- | --- | --- |
| `live` | `#01E1FC` | `#00728A` |
| `stale` | `#F2B84B` | `#7F4F00` |
| `resync-required` | `#FF9C52` | `#9C4300` |
| `failed` | `#FF6F76` | `#AE1F2C` |

Large fills (pills, badges) may use the bright value on light backgrounds too, with the glyph inside in the darker value. Dark hero backgrounds use the site's navy creek gradient, `#0A3D86` → `#04173A` → `#020A1C`.

### Extended tints

For illustrations and marketing only, never in the logo: azure wash `#E6F4FF`, splash wash `#D9F5FF`, cream wash `#F5F2EF`, ink raised `#042656` (cards and code blocks on ink), and ink line `#2D4064` (hairlines on ink). The templates and generators in `source/` derive a few more tints of the same colors for water layers, panels and secondary text; each is commented where it's defined. `press/palette.png` shows every color with its contrast ratios.

## Type

Marketing visuals, slides and cards use **Figtree** for headlines and text (700–900 for headlines) and **JetBrains Mono** for code, labels and small uppercase eyebrows. These are the faces streamotter.dev uses. Both are under the SIL Open Font License; the files and licenses are in `source/fonts/`. Where the name stands in for the logo, use the wordmark or a lockup file, never "StreamOtter" typed in Figtree or any other font. In running text the name is plain text, as everywhere else. `press/typography.png` is the specimen.

## Illustrations and patterns

Flat vector spots in the brandmark's palette, for docs, articles, slides and the site. Each is a standalone SVG with no fonts or external files, so it renders on GitHub and npm, and each has a `-dark` version for ink backgrounds. They share one wave ribbon, two stroke widths, and the code-stream dashes of the detailed logo.

| File (`illustrations/`) | Shows |
| --- | --- |
| `live-vs-stale` | A live view next to a visibly stale one: never silently wrong |
| `snapshot-then-updates` | A snapshot, then updates in revision order |
| `state-channels` | One Kafka stream split into state channels, each carrying only its own state |
| `hold` | A bad record stops the source at a closed gate; the view shows `stale` |
| `quarantine` | A byte-for-byte copy of the record goes to the quarantine topic (the side pool); the source stays held at the record |
| `redrive` | The stored copy of a record the source moved past is mapped again and delivered through the revision filter, so newer state always wins. Nothing goes back to Kafka |
| `incident-journal` | The incident journal as a field notebook |
| `otter-guide` | A friendly otter peeking out of the water, for empty states and 404 pages. It's a mascot, not a logo: never put it in place of the brandmark |
| `diagram-core-model` | The model in three steps, 1600 × 600 |
| `diagram-bad-record-flow` | The source-failure flow in five steps plus redrive, 1600 × 600 |

The diagrams carry step numbers but no words, so set their captions beside them. These captions were checked against the V1.1 behavior:

**Core model.** 1. You define the state shape and the handlers that map a Kafka record to it. 2. Each view starts from an authoritative snapshot, then receives full-state updates in revision order. 3. Every view is either verifiably live or visibly stale.

**Bad-record flow.** 1. A record fails: it can't be decoded, validated or mapped. 2. The source holds at that record. Nothing past it is committed, and views go visibly stale. 3. With failure handling on, the incident is recorded in the journal. Under a quarantine policy, the original is also copied byte for byte to the quarantine topic. 4. Either the cause is fixed and the operator retries the record, or, under `quarantine-resync`, the app's recovery guard approves moving past it. Integrity failures are never moved past. 5. The source moves on. After a retry, views are live again. After a guarded move past the record, a view goes live only once the app's next snapshot confirms it covers that record. *Redrive* (the side loop) re-runs the current mapping on the stored copy of a record that was moved past and delivers the result through the normal revision order, so it never overwrites newer state. It doesn't write back to Kafka, and it never returns a held source to live.

`patterns/` holds `wave-tile` and `wave-tile-dark` (a seamless 240 × 160 background tile, already subtle), `code-stream-band` and `code-stream-band-dark` (a 1600 × 160 band that repeats sideways), `divider` (a 1200 × 48 section divider) and `droplets` (a corner scatter; flip it for other corners).

## Launch visuals

PNG cards for link previews, social posts, articles and recordings. None prints a version number unless noted. Cards that name streamotter.dev assume the demo site is public when they're used.

| File | Size | Use |
| --- | --- | --- |
| `social/github-social-preview.png` | 1280 × 640 | Repository settings → Social preview |
| `social/og-card.png`, `og-card-light.png` | 1200 × 630 | Generic link card for the repository and streamotter.dev |
| `social/linkedin-banner.png` | 1584 × 396 | Profile or page banner (content stays clear of the avatar) |
| `social/linkedin-post.png` | 1200 × 627 | Launch post image |
| `social/avatar.png` | 1024 × 1024 | Square or circle avatar |
| `social/make-it-lie.png` | 1200 × 630 | The "Can you make it lie?" invitation |
| `social/article-*-og.png` | 1200 × 630 | Link cards for the two launch articles: the 1.0 announcement and "Making it lie". `article-1-0-launch-og` shows "1.0": publish it only with that release |
| `articles/article-*.png` | 2000 × 1125 | Blog and Medium headers for the same two articles. `article-1-0-launch` shows "1.0": publish it only with that release |
| `articles/lineage-strip.png`, `-dark.png`, `-square.png` | 2000 × 840, 1200 × 1200 | Earlier open-source work on getting Kafka to the browser (b/kafka-websocket, KafkaSocks, kafka-penguin) and where StreamOtter picks up, with no dates and no other projects' logos |
| `social/recording-title.png`, `recording-end.png` | 1920 × 1080 | Title and end cards for a Failure Lab screen recording. The title card's date and version are placeholders (`2026-10-XX`, `X.Y.Z`): set `DATE`, `VERSION` and, for a local recording, `WHERE` in its template and re-render before use |
| `social/recording-label-local.png` | 744 × 72, transparent | Corner label for recording segments filmed on a local stack instead of the hosted demo; overlay it on every frame of such a segment |
| `social/gif-caption.png` | 1200 × 80 | Caption strip for the home page's "Drop my connection" GIF. Its date is a placeholder: set `DATE` in its template and re-render |
| `social/kafkasocks-banner-draft.png` | 1280 × 220 | A draft README banner for the KafkaSocks co-authors to consider. Not for use without their agreement |

Article titles live in one file, `source/templates/article-titles.js`, so a retitle is a one-line change and a re-render.

## Press kit and slides

`press/` has a logo sheet with clear space and minimum sizes drawn from the real files (`logo-sheet.png`), the palette with contrast ratios (`palette.png`), the type specimen (`typography.png`), six ways not to use the logo (`logo-dont.png`), and three stickers as print-ready SVGs with PNG previews: a die-cut mark, a circle badge, and a `live` pill. `press/slides/` has title, section, content, code and closing slides at 1920 × 1080, to use as templates.

## Regenerating

Everything outside the logo files is generated from `source/`:

- PNG cards and slides: one HTML template per image in `source/templates/`. Run `node docs/assets/source/render.mjs [name-filter]` with Playwright and Chromium available: either `playwright` resolvable from the repository, or `PLAYWRIGHT_MODULE` set to the path of an installed Playwright's `index.mjs`. The filter matches part of a template's name, so `social-`, `article-`, `lineage-`, `press-` or `slide-` re-renders one group.
- Illustrations and patterns: `node docs/assets/source/illustrations/build.mjs [name-filter]`.
- Stickers: `node docs/assets/source/press/stickers.mjs`.

None of these are part of the build or the published packages.
