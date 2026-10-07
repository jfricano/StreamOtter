# StreamOtter blog

The source of blog.streamotter.dev: posts about StreamOtter, written as Markdown in
`src/content/blog/`. It is a static Astro site beside the docs site (`apps/docs`), and it looks
the same: its pages import the docs site's `src/styles/global.css` read-only, so the type,
colours and dark mode match without a second copy.

## Develop

```sh
pnpm install
pnpm --filter @streamotter/blog dev        # http://127.0.0.1:4323
```

The blog doesn't read the packages, so it needs no `pnpm build` first.

## Write a post

Add `src/content/blog/<slug>.md`. The file name is the post's address: `launch-notes.md` is
published at `/launch-notes/`. Use lowercase words and hyphens.

```md
---
title: StreamOtter 1.0
description: One sentence that the index, the feed and link cards show.
published: 2026-10-07
updated: 2026-10-09                      # optional; shown as "Updated <date>"
canonical: https://example.com/original/ # optional; when the post first appeared elsewhere
image: /cards/streamotter-1-0.png        # optional; the link-card image, under public/ or a URL
draft: true                              # optional; false by default
---

The post, in Markdown.
```

`src/posts.ts` holds the schema, so a missing field or a malformed date or URL fails the build.
`test/fixtures/sample-post.md` uses every field.

### Preview a draft

A post with `draft: true` is left out of every page, the feed and the sitemap. To see drafts
locally:

```sh
BLOG_DRAFTS=1 pnpm --filter @streamotter/blog dev
```

With `BLOG_DRAFTS=1`, drafts appear everywhere, marked "Draft" and kept out of search engines.
Never set it for a deploy.

To check the layout without writing a post, copy `test/fixtures/sample-post.md` into
`src/content/blog/`, preview it, and delete the copy.

### Byline

The byline comes from `AUTHOR` in `src/site.ts`: the author's name, with the `bio` line under it
on every post. Without a `bio`, posts show only the name.

## Check

```sh
pnpm --filter @streamotter/blog test       # draft selection, ordering, the feed and the sitemap
pnpm --filter @streamotter/blog build
pnpm --filter @streamotter/blog exec tsc --noEmit -p .   # .ts and .mjs; .astro files aren't type-checked
pnpm --filter @streamotter/blog check:links
```

With no posts yet, the build warns that the `blog` collection is empty; that's expected.

CI runs all four in the "Blog site" job in `.github/workflows/ci.yml`.

## Pages

| Path | Source |
| --- | --- |
| `/` | `src/pages/index.astro`: every published post, newest first, or "No posts yet." |
| `/<slug>/` | `src/pages/[slug].astro`: one post, from `src/content/blog/<slug>.md` |
| `/rss.xml` | RSS 2.0, from `rssXml` in `src/feed.ts` |
| `/sitemap.xml` | From `sitemapXml` in `src/feed.ts` |
| `/404.html`, `/robots.txt` | `src/pages/404.astro`, `public/robots.txt` |

Every page links the feed and carries Open Graph and Twitter card tags. A post's canonical link
and card image come from its frontmatter.

## Styles

`src/layouts/Base.astro` imports `apps/docs/src/styles/global.css` for the tokens, type, dark
mode and shared classes, along with the same font packages the docs site uses, at the same
versions. The header and footer are the blog's own, built on the docs site's header pattern. The
lockup and the favicons are copies of the docs site's. A change to the docs site's global styles
changes the blog too, and the "Blog site" CI job builds it on every push.

## How a post goes live

1. Open a pull request that adds the post with `draft` unset or false.
2. Merge it to main.
3. The owner runs the deploy. Nothing publishes on merge.

## Publishing (not set up yet)

Nothing is deployed and no DNS exists yet. Publishing will need:

- **A Pages project for the blog**, separate from the docs site's and the demo site's (for
  example on Cloudflare Pages, like the demo site), serving `apps/blog/dist/`.
- **A DNS record** for `blog.streamotter.dev` pointing at that project.
- **A deploy step** like the one the docs site plans in `apps/docs/DESIGN.md`: build from main with
  `pnpm install --frozen-lockfile && pnpm --filter @streamotter/blog build`, then upload `dist/`.
  The blog doesn't describe a release, so it doesn't need a release tag.
