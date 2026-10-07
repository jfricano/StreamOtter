# Ideas: public architecture docs and a fun landing page

October 6, 2026 · Sketch only, from Jason's two ideas. Nothing has been changed in either repo or on any site.

## 1. Make the architecture page public

Source: the "How it works" page (part 1 of Under the Hood), written from `jfricano/StreamOtter` at 1c75aaa.

**Verdict: yes, most of it can go public.** It is already written for a developer audience and holds no secrets. It describes only shipped behavior (0.2.0-rc.1), and every claim cites a file.

**Where it would live.** It would become `docs/ARCHITECTURE.md` in the StreamOtter repo, linked from `docs/README.md` and the root README. The two diagrams would be standalone SVG files in `docs/assets/`, so GitHub and npm render them. The streamotter.dev site would link to it rather than copy it, which follows the rule in `docs/WEBSITE_AND_DEMO_PLAN.md`.

**What to trim or check first:**
- **Line numbers.** Drop the `file:line` citations and keep file paths only, because line numbers go stale with every change. Readers don't need them; the review passes did.
- **Commit and version stamps.** Replace "main @ 1c75aaa" with "as of 0.2.0-rc.1" and add a refresh step to `docs/RELEASE_CHECKLIST.md`.
- **The "What's inferred" section.** Turn those points into plain statements once someone confirms them, or cut them. In particular, the reason the Kafka offset commits before browser delivery should be stated by the project, not inferred.
- **Internal design references.** Make sure they point to public docs. Names like "ADR-15A" and "WHC-1" already link to files in the repo, so this is a check, not a rewrite.
- **Diagram styling.** The diagrams take their colors from the page's theme settings. As standalone SVGs they need either fixed brand colors or a light and a dark version, the same way the logo files are handled (`docs/assets/README.md`).
- **Accuracy pass.** Have one fresh review pass read it against the code, as with any public claim. The launch-kit fact-check already caught one error (the circuit-breaker default), which has since been fixed.
- **Tone.** Keep it plain-spoken with no marketing language. It can stay close to the current text.

**Effort:** small. It is mostly conversion and trimming, with one review pass. It fits a small docs PR.

## 2. A purely fun landing page

**The idea.** One page that is all personality: the otter, the brand kit, and the handful of things StreamOtter does, with no demo, no live data and no technical overhead.

**How it relates to current plans.** streamotter.dev is Lontra Creek's site, where the demo, the Failure Lab, the playground and the workbench live. Its planning is in the lontra-creek repo (`docs/PLAN.md`). A fun landing page could be either of these:
- **(a) The front door of streamotter.dev.** The landing page comes first, and Lontra Creek sits one click behind it as "see it run".
- **(b) A standalone one-pager** for launch posts and the npm/GitHub links, kept separate from the demo site.

My lean is (a). It avoids a second site to host, and it gives first-time visitors something light before the heavier demo. The decision is Jason's.

**Possible content:**
- **Hero:** the detailed otter illustration (`docs/assets/streamotter-logo-full.png`), the wordmark, and one line, for example "Live Kafka state in the browser, without the plumbing."
- **Features as short, friendly cards:**
  - typed channels;
  - every browser starts from a snapshot and stays current;
  - per-user access control;
  - a slow browser never holds up Kafka;
  - a bad record pauses loudly instead of vanishing (V1.1);
  - a local workbench to see inside it.
- **A simplified flow graphic:** Kafka, then the otter, then the browser. This would be a playful version of the architecture diagram, with no file names.
- **Brand texture:** the waves and splash colors from the brand kit, and maybe a little motion (the otter swimming the stream on scroll).
- **Calls to action:** "Try the live demo" (Lontra Creek), "Read the docs", and `npm i streamotter`.
- **Origin note (optional):** the KafkaSocks and kafka-penguin lineage, which Jason has said is fine for promotional copy.

**Rules that still apply:**
- Nothing presented as shipped before it is.
- No invented numbers.
- The logo used as supplied, not recolored or redrawn, per `docs/assets/README.md`.
- No external posting without Jason's go.

**Who would build it.** The brand-kit work (PR #65, launch visuals) already has the assets. The landing page belongs with it, coordinated with the Lontra Creek plan.

## 3. An "Under the Hood" section on streamotter.dev

*Added October 7, 2026, from Jason: park this for now. Updated the same day: the set is now called "Under the Hood" (working title, easy to change) and has an introduction page.*

**The idea.** "StreamOtter Under the Hood" gets linked from streamotter.dev. The existing Docs page (`apps/site` `docs.astro`) is probably where it belongs (Jason, 2026-10-07), with a separate menu item as the alternative. Either way the link opens the introduction page, which links the five subpages. The set serves engineers deciding whether to adopt StreamOtter, would-be contributors (it doubles as their welcome kit) and curious readers from the launch. Drafts for now, in the repo as `docs/under-the-hood/` (StreamOtter PR #69):
- Introduction: who it's for, what each part covers, reading orders
1. How it works
2. How it's built
3. Why it's built this way
4. Guarantees and limits
5. Using and running it

**The API reference would sit beside it,** on the same Docs page or as its own menu item. The "API reference on the website" plan already recommends a TypeDoc-generated HTML reference at `streamotter.dev/docs/api/`, after a doc-comment pass in StreamOtter, timed for 1.0. Its plan stands; this section would link it rather than redo it.

**This would supersede idea 1's repo-only placement.** The canonical text could still live in the StreamOtter repo (`docs/`) and be published to the site, following the rule in `docs/WEBSITE_AND_DEMO_PLAN.md` that the site links to repo docs rather than copying them. The same trimming applies: no line numbers, version stamps instead of commit hashes, settle the inferred points, and one accuracy review.

**Constraints.** The site part waits on the Lontra Creek main freeze. Nothing gets built until Jason picks it up.

## Open questions for Jason

1. Should the architecture page go into the repo docs as `docs/ARCHITECTURE.md`, or stay internal for now?
2. Should the landing page be (a) the streamotter.dev front door or (b) a standalone page?
3. Should it wait for the 1.0 public launch, or ship with 0.2.0-rc.1?
4. Should "Under the Hood" (introduction plus five parts) and the API reference be linked from the streamotter.dev Docs page (or get their own menu items), and should the canonical copy live in the repo or on the site? Is "Under the Hood" the final name?
