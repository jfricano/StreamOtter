> **New in the Oct 5 fix pass** (FIX_DECISIONS §7; PUBLIC_LAUNCH.md D4–D6). This file holds the one AI-disclosure sentence used on every outward-facing surface, and says where it goes on each. Nothing in it has been posted.
>
> **Placeholders in this file:** none. One open check: **[confirm V1.2]** below. The sentence was approved on Oct 7, with Codex added.

# AI disclosure: one sentence, everywhere

## The sentence (approved Oct 7)

> I built StreamOtter with Codex and Claude Code. Codex designed almost all of the spec and built much of 1.0; I set the direction, made the decisions and reviewed the work. Real-Kafka test suites are how I checked it, and fresh AI agent sessions did the pre-1.0 code reviews.

- **Identical everywhere.** Same words on every surface below, so nobody can compare two posts and find a softer version. If you change the wording, change it here first, then everywhere at once.
- **Never optional.** It goes in every outward-facing piece. No surface has an "if you want it" version.
- **[confirm V1.2]** FACTS.md confirms that the V1.1 review was six fresh AI agent sessions that hadn't written the code, plus a seventh reviewing the fixes, with no person reviewing line by line. It says the V1.2 review is "unconfirmed, assume the same until checked". The second sentence says "the pre-1.0 code reviews", which covers V1.2 too. Check who ran V1.2 before the first post. If it was something else, narrow the sentence to "The V1.1 code reviews were …" and update every surface.
- **Why it is worded this way.** It names both tools and what Codex did (almost all of the spec and much of 1.0, per Jason, Oct 7). It says what you did (direction, decisions, review), what checked the behavior (the test suites, including real Kafka), and who did the reviews (AI agent sessions, not people). It doesn't say "independent". The repo docs still say "independent review" (`CHANGELOG.md`, `docs/IMPLEMENTATION_STATUS.md`, the `docs/releases/v1.1/REVIEW.md` title). Rewording those is D6 and a repo follow-up for you (PUBLIC_LAUNCH.md §10), not part of this kit.

## A second line for articles only

Articles drafted with AI assistance also need a line about the *text*, because Medium asks for an AI-assistance disclosure "within the first two paragraphs" and dev.to has an AI-Assisted tier:

> This article was drafted with AI assistance and edited by me.

Use it on the 1.0 article (blog, Medium, dev.to) and on the Medium story's rewritten intro. Leave it off posts you wrote yourself: the Show HN comment, Reddit posts in your own words, and your "Making it lie" piece if you write it yourself. If you post an AI-assisted draft mostly as it is anywhere else (LinkedIn, for example), add it there too.

## Where it goes, surface by surface

| Surface | Draft | Where the sentence goes | Notes |
| --- | --- | --- | --- |
| Show HN first comment | `show-hn.md` | A **must-say** in your talking points (point 4) | HN bans generated or AI-edited comments. Type the sentence yourself; it's your sentence once you've approved it. |
| HN replies | `hn-faq.md` | Repeat it word for word when asked "Did you build this with AI?" | The FAQ also has "Did you read every line?" and "Your tests and reviewers are AI too". |
| 1.0 article (blog, Medium, dev.to) | `launch-article.md` | Italic lines directly under the byline, then the drafting line | Within the first two paragraphs, as Medium asks. On dev.to, pick the AI-Assisted tier as well. |
| Medium story (interim fix now, then the 1.0 text) | `medium-audit.md` | In the rewritten second paragraph, then the drafting line | — |
| Reddit, every post | `reddit.md` | The last paragraph before the links, in each of the five variants | Reddit posts are rewritten in your own words, but this sentence stays as is. |
| LinkedIn launch post | `linkedin.md` | Its own paragraph before the links | — |
| LinkedIn origin post (T+3) | `origin-story.md` | Its own paragraph near the end | — |
| Social thread | `social-thread.md` | Post 2, on its own, directly under post 1 | The sentence is 274 characters, so it fits one post but can't share post 1. It's part of the thread, not an optional reply. |
| Newsletters and Console.dev | `newsletter-blurb.md` | In each email to an editor, after the blurb | One-line forms (awesome lists, Echo JS titles) are too short to carry it; the link they point to carries it. |
| Press page | `press-kit.md` | The fact sheet's "Maintainer" row and the bio prompt | The press kit goes on streamotter.dev or to people who ask, not into the README or release notes. |
| "Making it lie" (T+7) | `making-it-lie.md` | Near the top | The piece is about what AI review found in AI-written code, so the sentence is part of the story. |
| Recording and GIF | `hero-demo-script.md` | Not in the captions | The video shows the demo, not the code. The page or post it's embedded in carries the sentence. |

## GitHub-bound text (D5)

For text published on GitHub (the README, the pinned "Can you make it lie?" Discussion, release notes), this sentence does not appear. D5 is no (Oct 7): no AI line in the README, release notes, issues or the Discussion; the HN comment carries it. No draft here is meant to be published on GitHub as written.

- The Discussion says "I'll reproduce each report".
