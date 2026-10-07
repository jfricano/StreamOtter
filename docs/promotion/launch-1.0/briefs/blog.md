# The StreamOtter blog: plan

October 7, 2026 · Prepared for Jason Fricano · **Status: built, in StreamOtter PR #75 (stacked on #72); nothing deployed.** The blog is a launch gate since you answered D2 "no" (Oct 7). On Oct 7 you chose a subdomain: **blog.streamotter.dev**.

## Where it lives
**`blog.streamotter.dev`**, a small Astro app in the StreamOtter repo (`apps/blog`), beside the docs site (`apps/docs`, docs.streamotter.dev, PR #72), with an RSS feed at `/rss.xml`.

- **Independent of the demo site's releases.** It ships from the StreamOtter repo and deploys on its own, so publishing a post never touches the demo or its release-bound deploys.
- **It looks like the docs site.** It shares that site's styles (fonts, colours, dark mode), so docs and blog read as one family.
- **Posts are Markdown** files in `apps/blog/src/content/blog/`. A `draft: true` post stays out of every page, the feed and the sitemap.
- **No new dependencies** beyond what the docs site already pins. The feed and sitemap are small hand-written endpoints.
- **The demo site links to it later.** A "Blog" link on streamotter.dev follows in a later site release. Until then, the blog links to the demo, the docs and GitHub.
- **The cost of a subdomain is small.** The blog and the main site build search ranking separately, which hardly matters for a project this size.

## What it needs
| # | Piece | Who | Notes |
| --- | --- | --- | --- |
| 1 | The blog app: index, post page, RSS, sitemap, link cards, tests, a "Blog site" CI check | One StreamOtter PR stacked on #72 | Retargeted to `main` once #72 merges |
| 2 | Merge the PR | You | After #72 |
| 3 | Hosting: a Pages project for the blog and a `blog.streamotter.dev` DNS record, plus a deploy step like the docs site's | You | No deploy or DNS change without you |
| 4 | Publishing a post | You | Merge the post's PR, then run the blog deploy. About 20 minutes each time |
| 5 | Your byline | You | Name as it should appear, plus a one-line bio |

## The first posts
| When | Post | Writer | Status |
| --- | --- | --- | --- |
| **T-1, after the go/no-go** | **"StreamOtter 1.0: can you make it lie?"** The 1.0 article | The draft (`drafts/launch-article.md`) plus your own paragraphs (T-8, already in the plan) | Drafted. The AI sentence sits under the byline (D4, approved Oct 7) |
| T-1 evening | The Medium story is edited in place to the 1.0 text, with its canonical link set to the blog post | You (15 min, `drafts/medium-audit.md`) | Planned |
| T+3 | **The origin story, full length** (about 890 words: KafkaSocks to StreamOtter). The LinkedIn post (about 435 words) links to it | The draft (`drafts/origin-story.md`) plus your two required slots | Drafted as LinkedIn; the long version is the earlier cut |
| T+7 | **"Making it lie"**: what strangers found, or the pre-1.0 defects as the fallback | **You** (talking points in `drafts/making-it-lie.md`) | Planned |
| Later | Release posts (a `1.0.1` if a real bug turns up; `1.1.0` React hooks) and occasional deep-dives from "Under the Hood" | Either | Gives the blog a reason to exist after launch |

One post at launch is enough for a project blog. Not recommended: republishing the Sept 26 "Introducing StreamOtter" text as an archive post. It describes `0.1.0-rc.3`, and the Medium story already carries "first published September 26" in its update line.

dev.to copies import from the RSS feed with the blog as canonical.

## What we need from you
1. **Your byline** (5 min): your name as it should appear, and a one-line bio. Optional: links (GitHub, LinkedIn).
2. **Merge the blog PR** after #72 (10 min review).
3. **Set up hosting** before T-7: the Pages project and DNS record (the PR's README lists the steps).
4. **On T-1:** merge the 1.0 article's post PR and run the blog deploy (about 20 min).

Your writing doesn't grow. The 1.0 paragraphs, the origin-story slots and "Making it lie" were already in the plan.

## Timing
The blog isn't the slow gate. The hosted Lab and the hosting configuration change are. They need changes to the hosting setup and sessions with you, and together with the G1 integrator walk they set the earliest T-0.
