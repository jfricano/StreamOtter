# The StreamOtter blog: plan

October 7, 2026 · Prepared for Jason Fricano · **Status: plan.** Nothing is built, merged or deployed. The blog is a launch gate since you answered D2 "no" (Oct 7).

## Where it lives
**`streamotter.dev/blog`, inside the existing site** (lontra-creek `apps/site`, Astro), with an RSS feed at `/blog/rss.xml`.

- One URL for everything a reader finds: the demo, the Lab, the docs, and now the articles.
- The site already builds its own sitemap by hand (`src/pages/sitemap.xml.ts`); the feed is the same kind of small endpoint, so **no new dependency**.
- Posts are Markdown files in `apps/site/src/content/blog/`, rendered with the existing `ContentPage` layout, fonts and dark mode. Astro's built-in content collections do this; nothing to install.
- The blog joins the site's page list (`src/site.ts` `PAGES`) in the same PR as its first post, so no deploy ever shows an empty blog. (Before launch the site lists every page in its nav regardless of `ready`; only the sitemap filters on it.)
- Not chosen: a separate blog platform (Hashnode, Substack, a subdomain). It splits the audience, and Medium already plays the "elsewhere" role.

## What it needs
| # | Piece | Who | Notes |
| --- | --- | --- | --- |
| 1 | Blog index, post page, RSS feed, nav entry, sitemap entries, link cards (Open Graph) per post | One lontra-creek PR | Each post has: title, date, "updated" date, summary, byline, link-card image, canonical URL. Tests beside the existing `test/site-content.test.ts` |
| 2 | A design check | Design review | Uses the existing layout; the check covers type, spacing and the post header image (`article-1-0-launch.png`, from the launch visuals in StreamOtter PR #65) |
| 3 | Merge the PR | You | **Waits for the lontra-creek main freeze to lift** (after phase two reaches production). The PR can be open and reviewed before that |
| 4 | Publishing a post | You | A post goes live when its PR merges and the site is deployed ("Deploy static site": preview, then production). About 20 minutes each time |
| 5 | A rule for blog-only deploys | Hosting setup | Production site deploys are currently tied to a release's acceptance. Publishing a post changes no backend, so it needs a lighter path (preview, look, production) agreed before T-1 |

## The first posts
| When | Post | Writer | Status |
| --- | --- | --- | --- |
| **T-1, after the go/no-go** | **"StreamOtter 1.0: can you make it lie?"** The 1.0 article | The draft (`drafts/launch-article.md`) plus your own paragraphs (T-8, already in the plan) | Drafted. AI sentence under the byline, per D4 (open) |
| T-1, same deploy | The Medium story is edited in place to the 1.0 text, with its canonical link set to the blog post | You (15 min, `drafts/medium-audit.md`) | Planned |
| T+3 | **The origin story, full length** (about 890 words: KafkaSocks to StreamOtter). The LinkedIn post (about 435 words) links to it | The draft (`drafts/origin-story.md`) plus your two required slots | Drafted as LinkedIn; the long version is the earlier cut |
| T+7 | **"Making it lie"**: what strangers found, or the pre-1.0 defects as the fallback | **You** (talking points in `drafts/making-it-lie.md`) | Planned |
| Later | Release posts (a `1.0.1` if a real bug turns up; `1.1.0` React hooks) and occasional deep-dives from "Under the Hood" | Either | Gives the blog a reason to exist after launch |

One post at launch is enough for a project blog. Not recommended: republishing the Sept 26 "Introducing StreamOtter" text as an archive post. It describes `0.1.0-rc.3`, and the Medium story already carries "first published September 26" in its update line.

dev.to copies import from the RSS feed with the blog as canonical.

## What we need from you
1. **Yes or no: the blog lives at `streamotter.dev/blog` in the site** (recommended yes). If yes, the lontra-creek PR opens as a draft, without merging.
2. **Your byline, once** (5 min): your name as it should appear, and a one-line bio. Optional: a photo, and links (GitHub, LinkedIn).
3. **Merge the blog PR** when the freeze lifts (10 min review).
4. **On T-1:** merge the 1.0 article's post PR and run the site deploy (about 20 min; this replaces "publish on `/blog` if it exists").

Your writing doesn't grow: the 1.0 paragraphs, the origin-story slots and "Making it lie" were already in the plan. The new time is about 35 minutes (items 2–4), counted in `PUBLIC_LAUNCH.md` §5.

## Timing
The blog isn't the slow gate. It needs one PR plus the freeze lifting. The hosted Lab and the hosting configuration change need changes to the hosting setup and sessions with you, and they set the earliest T-0 together with the G1 integrator walk.
