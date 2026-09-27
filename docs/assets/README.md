# StreamOtter brand assets

StreamOtter has two logos. Use the **detailed logo** where there's room for an illustration: the README, the npm pages, articles, and title slides. Use the **brandmark** (the flat S-otter mark, its lockups, and its icon) wherever the logo is small or repeated: headers, footers, favicons, app icons, link cards, stickers, and slide corners. Don't recolor, redraw, stretch, or crop any of them, and don't set "StreamOtter" in a font in place of the wordmark.

## The detailed logo

An otter swimming through a stream of code, with the wordmark below. It's raster only.

| File | Size | Use |
| --- | --- | --- |
| `streamotter-logo.png` | 800 × 455, white background | README and npm pages on light backgrounds. The published npm pages link to this file on `main`, so it never moves or changes name. |
| `streamotter-logo-dark.png` | 1397 × 791, transparent | Dark backgrounds: "Stream" in light ink. The README shows it in GitHub's dark mode. |
| `streamotter-logo-full.png` | 1536 × 1024, white background | Large uses: article headers, title slides. |

Keep it at least 240 px wide. Below that, the code lines and whiskers turn to noise; use the brandmark instead.

## The brandmark

Flat vectors, each in a light version (for light backgrounds) and a `-dark` version (for dark backgrounds: the S body and "Stream" turn light ink `#E9F2FC`, and the whiskers `#A9BAD5`).

| File | Use | Minimum size |
| --- | --- | --- |
| `streamotter-lockup-horizontal.svg`, `-dark.svg` | The default signature: site and app headers, slide corners, and link cards that need a wide shape | 120 px wide |
| `streamotter-lockup-stacked.svg`, `-dark.svg` | Centered and formal uses: footers, title cards, and square spaces | 96 px wide |
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
