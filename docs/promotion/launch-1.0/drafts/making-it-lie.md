> **New in the Oct 5 fix pass** (FIX_DECISIONS §3). Talking points, not prose, for the short piece **you write yourself** at about T+7: "Making it lie: what the pre-1.0 reviews and launch week broke". It replaces the planned reveals 2–4. Nothing here is a draft to publish as is.
>
> **Changed Oct 7 (D2 answered no):** hosted Lab with S01–S06 and /blog are launch gates; conditionals removed.
>
> **Placeholders in this file:** `{{INVITATION_RESULTS}}` (what outside people reported, filled at T+6/T+7) · `{{MAKE_IT_LIE_LINK}}` (the pinned Discussion's URL) · `{{ONE_DEFECT_IN_YOUR_WORDS}}` (the defect you found most instructive, in your own words)

> **Where and when:** about T+7 (PUBLIC_LAUNCH.md D7). On streamotter.dev/blog (canonical; /blog with RSS is a launch gate since D2), with a link to it added to the Medium story. Never a second Medium story. If you import it to dev.to, set canonical_url to the blog post (AI-Assisted tier only if the text was AI-drafted). Then LinkedIn (a short post linking it), and r/node in the following days if it's mostly about the Node-side fixes.
>
> **Rules:**
> - **Write it yourself, and keep it short** (about 600–900 words). It's the most distinctive story in the kit: concrete defects that AI review found in AI-written code, plus whatever strangers found. It only works in your voice.
> - Put the AI sentence from `ai-disclosure.md` near the top, word for word. Here it's part of the story, not a footnote.
> - Every defect you mention links its source (the CHANGELOG line or the REVIEW.md row). No severity adjectives beyond what the source says.
> - If outside reports came in, they go first. If none did, say so in one sentence and use the fallback list. Zero outside finds is a non-event, not something to hide.
> - Credit only people who said yes to credit. No invented reports, no counts you can't link.

# Making it lie: talking points

Header image: `article-making-it-lie.png` from the launch visuals in PR #65 (link card `article-making-it-lie-og.png`). Its title reads "what our reviews and launch week broke"; for a solo maintainer the kit uses "the pre-1.0 reviews", not "our" (accuracy N8), so re-render the card, or use the title on the card if you prefer it.

## 1. The claim, restated (2–3 sentences)

- The rule from the 1.0 article, word for word: make a subscribed view report `live` while it shows something other than the newest state its snapshot and the topic's revisions imply, or get a bad record skipped silently, or get a quarantine copy that isn't byte for byte.
- Why say it as a rule: "never silently wrong" is only worth something if someone can try to break it.
- The AI sentence (`ai-disclosure.md`). Then one line on why that makes this piece matter: the code and the reviews were both AI; the tests against real Kafka and real browsers, and anyone running the break-it paths, are the checks that don't come from the model.

## 2. What you (readers) found: `{{INVITATION_RESULTS}}`

Fill from the Discussion and issues labeled `make-it-lie` ({{MAKE_IT_LIE_LINK}}). For each report:

- what they did (one line), on which path: the home page's "Drop my connection", the local fixture, the local Lab (`npm run dev:lab`), their own Kafka, or a hosted Lab bench;
- whether it reproduced, and the issue link;
- whether it was a real break of the rule, a documented limit (one gateway, no replay), or a docs gap;
- the fix and its release (for example `1.0.1`), or "open";
- credit, only with the person's OK.

If nothing reproducible came in: "Nobody has made it lie yet that I know of. Here's what broke before 1.0 instead." Then section 3. Don't pad with near-misses.

## 3. Fallback, or second half: real pre-1.0 defects

All real, all fixed, all with sources in the repo. Pick three or four; don't list them all. For each: what could go wrong on screen or in Kafka, how it was found, what fixed it, what test now guards it.

**From `CHANGELOG.md` [0.2.0-rc.1] "Fixed".** These were in V1 code that shipped in the published `0.1.0-rc` releases, and were found by the V1.2 review (`docs/releases/v1.2/README.md`; findings in `PHASE_A_FINDINGS.md` and `PHASE_B_FINDINGS.md`). **[confirm V1.2]: who ran the V1.2 review. FACTS.md says "unconfirmed, assume the same (fresh AI agent sessions) until checked". Don't describe it until you've checked.**

| Defect (plain words) | Source |
| --- | --- |
| A client that stopped reading could grow gateway memory without limit. Now it's disconnected once its unsent output passes `maxPendingBytesPerConnection`. | `CHANGELOG.md`:89 |
| A record that took longer than the group session timeout could be reprocessed forever. Now it keeps heartbeating and is committed once. | `CHANGELOG.md`:97 |
| With `startFrom: "latest"`, a restart before the first record could skip records produced in between. Now the start position is committed when the gateway joins. *(The closest to "silently wrong" in the list. Fixed in V1.2.1, the fixes for minor findings the V1.2 review deferred.)* | `CHANGELOG.md`:132 |
| `stop()` could wait forever on a handler module that never loaded. | `CHANGELOG.md`:92 |
| Generated example code didn't escape U+2028/U+2029, which could inject code. | `CHANGELOG.md`:104 |

**From the V1.1 review (`docs/releases/v1.1/REVIEW.md` §2, "Major").** Caught in V1.1 code before any V1.1 release. FACTS.md: the V1.1 review was six fresh AI agent sessions that didn't write the code, plus a seventh that reviewed the fixes; no person reviewed line by line. The repo file's title still says "Independent review" (a repo follow-up for you; D6 in PUBLIC_LAUNCH.md).

| ID | Defect (plain words) | Fix and test (from the table) |
| --- | --- | --- |
| R1 | A record with a schema failure *and* a later integrity failure was labeled with the milder class, and `quarantine-resync` moved past it. That's the rule's "skipped past an integrity failure" case, found before release. | Commit `3995145`; the most severe class now wins. Test: `tests/integration/failure-classes.test.ts`, "a record with several problems is classified by the most severe one". |
| J1 | Each recovery boundary copied every earlier failure ID, so the journal grew quadratically and filled after about 2,700 automatic advances. | Commit `646aedf`. Test: `journal.test.ts`, "grows linearly with automatic advances". |
| J2 | After a crash, a restarted container read its own leftover lock (often pid 1) as live, and startup failed every time. | Commit `d4a5cc4`. Tests: `journal.test.ts`, 3 lock tests. |

Line numbers are for `main` at `1c75aaa` (Oct 5); recheck at the 1.0.0 tag.

`{{ONE_DEFECT_IN_YOUR_WORDS}}`: pick one and tell it properly. What would a user have seen? Would anyone have noticed? R1 or the `startFrom: "latest"` skip are the strongest for this audience.

## 4. What this says about the method (3–4 points, your judgment)

- What the AI review passes were good at, with one example from the tables above.
- What they can't do: they share the model's blind spots. That's why the checks that don't come from the model matter: real Kafka (including a three-broker cluster), real browsers, installs from the registry, and outside people running the break-it paths.
- Did you read every line? Answer the way you would on HN (see `hn-faq.md`): no line-by-line human review, and what you did instead.
- What you'd change for 1.1. [jason: only if you have a real answer.]

## 5. Close (2 sentences)

- The invitation stays open: {{MAKE_IT_LIE_LINK}}.
- Where findings get credited (the CHANGELOG's "found by" line, if you set one up).

## Notes for you

- **Length.** Short beats complete. Three defects told well beat eight listed.
- **Tone.** Matter-of-fact. Don't apologize for the defects and don't celebrate the reviews. "Here's what broke, here's what caught it" is the whole piece.
- **Don't** call the reviews "independent", say how many hours anything took unless you know, or present test counts as adoption.
- **If a `1.0.1` shipped** during launch week, link its release notes.
