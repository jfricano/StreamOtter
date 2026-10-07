> **Changed since Sept 27:** new file (Oct 5): an audit of the September Medium story and a plan for it.
>
> **Changed in the Oct 5 fix pass:** **one Medium plan** (FIX_DECISIONS §4; PUBLIC_LAUNCH.md §4.6 and D7). The old options list (keep the story, import the 1.0 article as a new Medium story 2–3 days later, "move the canonical home: no") is gone, because it would have created the duplicate the plan avoids (accuracy S5). Medium's AI policy is now quoted from its help page, not "2024 reports" (S6). The "Hook" finding is corrected: the body already opens with the problem, and the product-definition line looks like the SEO description (S7). The interim fix now includes "I" for "we", the AI sentence from `ai-disclosure.md` word for word, and the getting-started link in place of the placeholder.
>
> **Placeholders in this file:** none. One check in the editor is marked *(check in editor)*.

# Medium story: "Introducing StreamOtter"

October 5, 2026 · Prepared for Jason Fricano · Nothing has been edited or posted.

**Story:** https://kaleidoscopesharts.medium.com/introducing-streamotter-07b26a132f81
**How it was read:** the public page as text on 2026-10-05, not raw HTML, so check anything marked *(check in editor)* in Medium's editor before acting on it.

**What the page showed:** title "Introducing StreamOtter", subtitle "Live data that tells you when it's wrong". By Jason Fricano, September 26, 2026, a 9-minute read, on your own profile (`@kaleidoscopesharts`, 72 followers shown), not in a publication. Ten sections, from "The screen that looks live" to "What's next". The body opens "You have probably built this. An order-status page…". Tags: Kafka, Typescript, Web Development, Open Source, Websocket. Written as "we". No AI-assistance sentence. `[DEMO URL, added at launch]` is still in "Try it". The `authenticate` sample reads `tenantId: session.accountId`, so the September `zsession` typo looks fixed *(check in editor)*.

## The plan (one plan, no duplicate)

| When | What | Time |
| --- | --- | --- |
| **Now** (independent of launch) | Fix the story in place: the AI sentence and drafting line in the first two paragraphs; the placeholder → the Getting started link; "we" → "I" where it describes your work; the title, subtitle and SEO description below. Optional: the live → stale → live GIF once it exists (`hero-demo-script.md`, part A). | About 20 minutes |
| **T-1 evening, if streamotter.dev/blog exists** | Publish the 1.0 article (`launch-article.md`) on the blog. Then **edit this same Medium story in place** to the 1.0 text, and set its canonical link to the blog post: Edit story → ⋯ → More settings → Advanced Settings → "This story was originally published elsewhere" → Save canonical link → Publish ([Medium help](https://help.medium.com/hc/en-us/articles/360033930293-Set-a-canonical-link)). | About 20 minutes |
| **T-1 evening, if there's no blog** | Edit this same Medium story in place to the 1.0 text. It stays canonical. | About 15 minutes |
| **Either way** | The first line of the updated story reads: *"Updated for 1.0.0 on <date>; first published September 26, 2026 for 0.1.0-rc.3."* Keep the AI sentence and the drafting line. Header image: `article-1-0-launch.png` from the launch visuals in PR #65 (it shows "1.0", so only once `1.0.0` is out). | — |
| **T+7, "Making it lie"** | On `/blog` if it exists; otherwise on dev.to, with a link to it added to this Medium story. | 5 minutes |

**Never a second, duplicate Medium story.** Not for the 1.0 article and not for "Making it lie". dev.to imports with its canonical link pointing at whichever copy is canonical (the blog, or this Medium story), on the AI-Assisted tier.

Two cautions:
- Medium's canonical setting is worded for content "originally published elsewhere", and this story came first on Medium. The blog copy can carry the September 26 date as "first published" so the history stays honest.
- After a title change, check that the old URL still resolves. Medium URLs end in a story ID, so it should; this wasn't verified.

## What works (keep it)

- **The subtitle and the central question.** "Live data that tells you when it's wrong" and "is this screen still right?" are the strongest lines in the launch material.
- **The opening.** The body starts with the problem ("You have probably built this…"), which is right.
- **Structure and honesty.** Problem, model, code, limits, next steps. It has a limits section, labels V2 and V3 as plans, and credits KafkaSocks.

## What to fix

| Area | Finding | Fix |
| --- | --- | --- |
| **AI note** | None. Medium's policy asks for a disclosure "within the first two paragraphs", and "AI-assisted text without a disclosure will similarly be restricted to distribution on the author's personal network" (Medium help, checked 2026-10-05). | Add the AI sentence and the drafting line (below) in paragraph two. |
| **Title** | "Introducing StreamOtter" is a brand name nobody searches for yet. It names neither Kafka nor web pages. | New title below. |
| **Hook / preview text** | The body opens with the problem, which is good. The product definition ("StreamOtter is an open-source gateway, browser SDK, CLI, and workbench…") appears to be the story's SEO/preview description *(check in editor: Story settings → SEO description)*. | Rewrite that description to lead with the problem (below). |
| **Voice** | "We" for a one-person project reads as inflated once someone checks the repo. | "I" where the sentence describes your work. Intro and "Try it" at minimum; the rest if you have time. |
| **CTA** | "Try it" still says `[DEMO URL, added at launch]`. | Replace with the Getting started link: https://github.com/jfricano/StreamOtter/blob/main/docs/guides/getting-started.md. Link streamotter.dev as well only after you've checked in a browser that its home-page live panel answers. |
| **Currency** | The test counts ("114 unit and integration tests", "20 real-Kafka tests", "13 browser tests"…) are from 0.1.0-rc.3. | Replace the list with one line linking `docs/IMPLEMENTATION_STATUS.md`. At 1.0, the whole text is replaced anyway. |

## Text for the in-place fix (now)

**Title (57 characters):**
> Live Kafka state on a web page that knows when it's stale

**Subtitle:**
> Introducing StreamOtter, an open-source gateway and TypeScript SDK: every view is live or says it's stale, never silently wrong.

**SEO description (Story settings; up to 156 characters on Medium; this is 139):**
> A live page fed from Kafka can keep looking live while it's wrong. StreamOtter makes every view either live or visibly stale. Open source.

**Paragraph one:** keep your current opening ("You have probably built this…").

**Paragraph two (new, directly after it):**
> StreamOtter is my answer to that: an open-source (MIT) Node.js gateway, TypeScript browser SDK and CLI. You define the state shape and one mapping function, and every view it delivers either catches up and says live, or says stale.
>
> I built StreamOtter with Claude Code: I set the direction and the spec, made the decisions and reviewed the work, and the test suites, including real Kafka, are how I checked it. The pre-1.0 code reviews were done by fresh AI agent sessions that hadn't written the code. This article was drafted with AI assistance and edited by me.

**Tags (optional):** keep Kafka, Open Source and Web Development. Swapping "Typescript" or "Websocket" is only worth it if Medium's tag pages show more followers; tag popularity is unverified.

**Profile (optional, 2 minutes):** a bio line such as "Maintainer of StreamOtter · github.com/jfricano" *(check what the bio says today)*.

## Not doing

- **Republishing into a publication.** A second copy would be the duplicate the plan rules out, and many publications only take unpublished drafts *(unverified per publication)*.
- **A separate Medium story for the 1.0 article or "Making it lie".** Covered above.
