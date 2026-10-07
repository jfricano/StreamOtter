# Content & SEO brief

September 27, 2026 · Research brief for the promotion plan · Scope: search, docs-as-marketing, evergreen content, repurposing, site SEO hand-offs

> **Note (September 27):** the decisions in [PLAN.md](../PLAN.md) supersede this brief's recommendations where they differ. Corrections are marked **[Correction]** in place.

Rankings below come from searches run on September 27, 2026 (US results, one searcher). They vary by person and place, so treat them as a snapshot. Anything not checked directly is labeled **unverified**.

## Ranked recommendations (impact per owner-hour)

| # | What | Why | Owner time | Prepared in advance | When |
| --- | --- | --- | --- | --- | --- |
| 1 | Fix the Medium article: remove the `[DEMO URL, added at launch]` placeholder and fix `zsession.accountId`. **[Correction]** Also add a one-sentence AI-assistance disclosure in the first two paragraphs, per Medium's AI policy (undisclosed AI-assisted stories get network-only distribution, per 2024 reports). | Every cross-post and community link will point at it | 10 min | The corrected lines | Now |
| 2 | Rewrite the README's first screen: one-sentence pitch, a silent GIF, a fit/limits line, a 5-line code sample | Every channel ends at the repo or the npm page. Right now the first screen has no visual and an abstract tagline | 30 min review | A PR, the GIF, and an SVG diagram; the same changes for the package READMEs in the next release | Before launch |
| 3 | GitHub repo settings: custom social preview, more topics, homepage set to `streamotter.app` at launch | The repo has no custom preview image (`usesCustomOpenGraphImage: false`), and its homepage points at the npm org | 10 min | A 1280×640 PNG and the topic list | Before launch; homepage at launch |
| 4 | New page: "When to use StreamOtter (and when not to)" | Converts evaluators and earns trust on HN and Reddit | 20 min | The full page | Before launch |
| 5 | New page: "How StreamOtter keeps a view correct" (concepts) | The page most worth linking to. Evergreen articles cite it | 20 min | The full page and diagram | Before launch or launch week |
| 6 | Cross-post the announcement to dev.to and Hashnode (canonical: Medium); a LinkedIn article | Reuses finished work in front of new audiences | 40 min | Markdown for each platform, LinkedIn text | Launch week |
| 7 | Short technical note on the KafkaJS 2.2.4 timer on Node 24, linked from KafkaJS issue #1751 | Small effort, and it reaches exactly the right people (Node + Kafka developers who hit the warning) | 45 min | Draft, re-measured on the current machine | Month 1 |
| 8 | One evergreen piece a month (plan below) | Search traffic that builds up over time, plus the pieces most likely to get HN or Reddit attention | About 2–2.5 h a piece, including distribution | Full draft, verified code, OG image, syndication copies | Ongoing |
| 9 | Recipes: sign-in with existing sessions, React, Express/Next.js | Match "how do I…" searches from people ready to adopt | 15–20 min each | Each page, run against the published package | Months 1–3 |
| 10 | Alternatives page | Answers "kafka websocket gateway" searches honestly | 30 min (a sensitive page) | Page with sources and the dates they were checked | Months 1–2 |
| 11 | Failure Lab mini-posts | Cheap once the Lab is live | 15 min each | Draft plus a labeled capture | After the Lab ships (optional) |

## 1. Search-intent map

| Query | What ranks now | Intent | Can StreamOtter rank or be cited? Which page? |
| --- | --- | --- | --- |
| kafka to browser / how to send kafka messages to frontend | Medium tutorial, a Kafka viewer repo, Confluent blog, Ably topic page; KafkaSocks for the longer phrasing | Mixed: architecture how-to vs. topic-viewer tools | Yes, over time. Tutorial (piece 2) and README. The title must say "live state in a web app" to separate it from viewer tools |
| kafka websocket node.js | Old Medium tutorials, `node-ws-kafka-connector`, YouTube, content farms | Build it | **Best opening.** Results are thin and dated. Piece 2 |
| kafkajs socket.io | `socket.io-kafkajs` (npm and GitHub), a Medium map tutorial, the `socket.io-kafka` adapter, KafkaSocks | Find a library | Yes: npm keywords and README. Those adapters scale Socket.IO nodes; they don't deliver state. The README should make that difference clear in one line |
| stream kafka to react | Medium logistics tutorial, lenses redux-streaming, Codemia, sample repos | Tutorial | Yes: piece 2 plus the React recipe |
| kafka real-time dashboard node | GitHub demo repos (Spark, Tinybird/Grafana, Socket.IO samples) | A sample project | Moderate: reference example, the Lontra Creek demo, a `dashboard` repo topic |
| kafka server-sent events | OpenLiberty, AMIS blog, Kong plugin docs, Confluent HTTP sink | An SSE bridge | **Low.** V1 is WebSocket-only. Cite it only on the alternatives page ("SSE may be enough") |
| kafka to websocket / kafka websocket gateway open source | `b/kafka-websocket` (353★, last push Dec 2023), Gravitee, WSO2, Ably, Zilla | Find a gateway | Yes: README and alternatives page, framed honestly |
| websocket reconnect missed messages | An openclaw issue, websocket.org's reconnection guide (written by an Ably founder, covers sequence-number replay, not UI state), urql discussion, OneUptime posts | Solve a bug | **Strong.** No result covers state views (snapshot plus revision plus a visible stale state). Piece 1 |
| socket.io stale data after reconnect | socket.io discussion #4610, Socket.IO's connection-state-recovery docs ("recovery… can fail"), NetworkSpy | Socket.IO users hitting the problem | **Strong for citation.** Piece 1 builds on Socket.IO's own caveat |
| snapshot then subscribe race condition | Wolt engineering blog, GitHub issues (UQuark/Quiver ×3, directus), a dev.to race-conditions post | Design | **Strong.** Nobody clearly explains comparing revisions. Piece 3 and the concepts page |
| websocket backpressure slow clients node | Medium posts, websocket.org JS guide, dev.to "backpressure to Socket.IO" | Design | Moderate: piece 5 |
| kafkajs poison pill | Lydtech, KodeKloud, DZone, OneUptime | Skip it or dead-letter it | Moderate: piece 6 (for state views, skipping means a silently wrong screen) |
| websocket subscription authorization revoke | GitHub security issues, websocket.org auth guide, a dev.to post, AWS AppSync docs | Security design | Moderate: piece 7 |
| next.js kafka websocket | Medium, dev.to, Upstash example | Integration | Moderate: Next.js recipe (the gateway runs as its own long-lived process) |
| kafkajs TimeoutNegativeWarning | KafkaJS issue #1751 (open since May 2025, PR #1768 linked), other projects' PRs | Fix a warning | Narrow but exactly the right audience: piece 4 |

Branded: "kafkasocks" already returns the StreamOtter repo fourth.

**What gets attention on HN.** Kafka-plus-WebSocket stories there get 1–3 points (vendor posts), and similar Show HNs 10–14. General essays do far better: "Backpressure is all you need" (220 points, May 2026), "Sync Engines Are the Future" (327). **Frame each deep dive around the general principle and use StreamOtter as the worked example**, not the other way round.

## 2. Docs as marketing

### README first screen (what a visitor must grasp in 10 seconds)

1. **What:** "Live Kafka state in the browser: a snapshot first, updates in revision order, and a view that is always either `live` or visibly `stale`." Move "Make live data straightforward…" below it. The product marketing brief owns the final wording.
2. **For whom:** "For Node.js and TypeScript teams that already publish state changes to Kafka."
3. **See it:** a silent GIF, 10–15 s, about 800 px wide, under 3 MB. The order-dashboard React view goes `live`, **Reconnect** is pressed, it shows `stale` with the last data kept, then a fresh snapshot and `live` again. Caption: "Recording of the reference example, 0.1.0-rc.3." The frames are recorded with Playwright. The package READMEs need absolute image URLs.
4. **Try it:** `npm install streamotter`, the 5-minute block, and a 5-line `subscribe`/`on("state")` sample.
5. **Fit and limits:** "Good for order and job status and operational dashboards. Not for chat, replayable event feeds, or horizontal scaling (V1 runs one gateway)." Link to the when-to-use page.
6. Switch the badge from `@streamotter/cli` to `streamotter`. Add "Try the live demo" once the site is up.
7. Below the fold, an **SVG** synchronization timeline (subscribe → capture → snapshot r7 → buffered r6 dropped, r8 applied → `live`). Use SVG, not Mermaid, because npm doesn't render Mermaid.

GitHub topics today: kafka, live-data, nodejs, realtime, socket-io, state-synchronization, typescript, websocket. Add `kafkajs`, `react`, `real-time`, `websockets`, `live-updates`, `dashboard`. How popular each topic is: unverified. In the next release, add the same terms to the npm `keywords` (npm's ranking weights: unverified).

### New docs pages, ranked

1. **`docs/guides/when-to-use.md`.** A fit table: the latest state of an entity (yes); an event feed that needs replay (not in V1); chat (no); multiple gateways (not in V1); no Kafka in production (V1's production sources are Kafka only); polling or SSE from your API already enough (use that).
2. **`docs/guides/how-it-works.md`.** Channels, the snapshot/update race, revisions, `live`/`stale`, epochs, bounded delivery, and access over time. It's the reference the articles link to.
3. **Recipe: sign in with existing sessions.** `authenticate` receives a token and the verified origin, not cookies. So cookie-session apps need a small endpoint that issues a short-lived token, and the recipe should show one, plus expiry and when to call `revoke`.
4. **Recipe: React.** Expand the client README's hook into a component with a stale badge and a retry button that calls `resync()`. Check how React StrictMode's double mount behaves before publishing (unverified).
5. **Recipe: Express / Next.js.** Run `createGateway` in the Express process, so routes can call `revoke`, and proxy it by path. For Next.js, run the gateway as a separate long-lived process behind the same origin. Whether Next.js rewrites proxy WebSockets: unverified, test it.
6. **`docs/guides/alternatives.md`.** DIY KafkaJS + Socket.IO, polling or SSE, Centrifugo, Zilla, the Ably and Lightstreamer connectors, `kafka-websocket`, each framed as "choose X when…", from RESEARCH.md §4. Every vendor claim gets a source and a checked date, re-checked quarterly.

Every recipe is run against the published package before it's published, as was done for the package READMEs.

## 3. Evergreen content plan (one piece a month at most)

**Home.** Publish on `streamotter.app/blog` if the site adds one (see §5). If it doesn't, the owner's Medium is the home; don't move articles later. Reference material stays in GitHub docs. Articles link to the docs, and the docs list the articles under "Further reading". Syndicate to dev.to and Hashnode with canonical URLs, and give LinkedIn a short *post* (not an article) for each piece.

**Every piece** (**[Correction]** label AI assistance: Medium requires a disclosure in the first two paragraphs, and dev.to has an "AI-assisted" tier; never reuse this text on HN or Stack Overflow, which ban AI-written posts). **Drafted in advance:** the full text, the diagrams, and code type-checked against the pinned version, with every claim checked against IMPLEMENTATION_STATUS.md. **The owner adds** 2–4 sentences of first-person experience and a final review, about 60–90 minutes a piece.

1. **"A reconnect isn't a recovery: keeping live views correct after a WebSocket drops."**
   - Angle: a transport can reconnect while the screen stays wrong (Socket.IO's own docs say recovery can fail). Show snapshot plus revisions and a visible `stale` state.
   - Queries: reconnect/missed-messages and Socket.IO stale data.
   - Format: explainer.
   - Owner adds: a dashboard they once saw quietly showing wrong data.
   - Why it can spread: a general principle; HN and r/webdev.
2. **"Stream Kafka to a React page without lying to your users."**
   - Angle: end to end with the published package: topic shape, handlers, the hook, and a deliberate disconnect.
   - Queries: kafka to browser, kafka websocket node.js, stream kafka to react, kafkajs socket.io.
   - Format: tutorial.
   - Owner adds: why they built it.
   - Why it can spread: the current results are old and thin, and the people searching are ready to adopt. Fits dev.to, r/node, r/reactjs.
3. **"The snapshot/update race: why 'fetch, then subscribe' loses updates."**
   - Angle: register the capture before the snapshot, then drop revisions at or below the snapshot's.
   - Format: deep dive with a sequence diagram (scenario 2 of the acceptance tests).
   - Why it can spread: people link to the clearest explanation of a known race; today only GitHub issues rank.
4. **"KafkaJS 2.2.4 on Node 24: the negative-timeout warning is also a 1 ms timer."**
   - Angle: the version-guarded one-method patch took an idle gateway from 2.6% to 0.3% of a core, measured on the machine listed in IMPLEMENTATION_STATUS.md.
   - Format: short technical note, about 600 words.
   - Before publishing: re-measure, read PR #1768, and credit the maintainers respectfully.
   - The owner can then comment on issue #1751 with the workaround and a link.
5. **"When a browser can't keep up: bounded delivery for live views."**
   - Angle: one frame in flight, budgets, overflow leading to resync, and slow clients disconnected while the source never waits. Describe the declared workload only as the docs do ("not a capacity claim").
   - Why it can spread: HN rewards essays on backpressure.
6. **"Poison records without skipping."**
   - Angle: for full-state views, skipping a record is a silent error, so pause and resume the same record. Treat dead-letter queues fairly: they fit other workloads.
   - Audience: r/apachekafka.
7. **"Revoking access to a live view while its snapshot is still loading."**
   - Angle: fail closed at every step: `authorize` rechecked before the snapshot, late handler results ignored, and your own records updated before `revoke`.
   - Audience: security-minded Node developers.
8. **"Live, stale, resync-required: UI states for real-time data you can trust."**
   - Audience: frontend developers; a state table and component patterns.

Suggested order: piece 1 or 2 in the month after launch, then 4, 3, 5, 6, 7, 8.

**Optional, mostly owner-written:** "What I learned rebuilding KafkaSocks." The owner contributed to KafkaSocks and is a maintainer of the `kafka-socks` npm package. It's the most personal story available, but most of its value has to come from the owner.

## 4. Repurposing what exists

- **Medium announcement.** Keep Medium as its canonical. It is already live and is a dated news piece, so moving the canonical to a site that doesn't exist yet gains little. In launch week, cross-post:
  - to dev.to with `canonical_url` in the front matter;
  - to Hashnode via "Are you republishing?" → original URL (`originalArticleURL` in the API).
  - Put "Originally published on Medium" in the first line of both.
  - Google treats a cross-domain canonical only as a hint, and since 2023 no longer recommends it for syndication (it prefers noindex, which these platforms don't appear to offer per post; unverified). So also wait 2–3 days before syndicating (common practice; Google hasn't confirmed it helps).
- **Kafka-audience cut** (about 700 words): commits, poison records, rebalances, crash redelivery, the TLS/SASL matrix. Use it as a community post's text (the community brief picks where and when), not another article, to avoid near-duplicates.
- **LinkedIn article.** LinkedIn has no canonical option. A shorter, first-person version at least a week later, with the Medium link at the top. The owner writes the "why I built it" paragraph (20 min).
- **Failure Lab.** Four 400–600-word posts, one per scenario (fouled sensor, flash flood, satellite link, relay restart). Each has a **labeled capture from the live deployment**, the state and `StreamError` the app receives, the handling code, and links to `/lab` and the guide. Or one combined "Break it on purpose" post.

## 5. Site SEO hand-offs (recommendations for the Lontra Creek project)

The site already has canonical links, OG and Twitter tags, one social image, a sitemap, robots.txt, and noindex on placeholder pages. In addition:

1. **`/blog` with an RSS feed.** dev.to can import RSS with "Mark the RSS source as canonical URL by default". Give each article its own 1200×630 OG image (title plus logo, generated at build), a published date, and an author.
2. **JSON-LD.** `SoftwareSourceCode` on the home page (repository, MIT license, TypeScript, Node.js). `TechArticle` or `BlogPosting` with the author as a `Person` on articles. No ratings or reviews.
3. **`/docs` map.** Descriptive link text, and a 1–2 sentence summary for each guide so the page has substance without copying the guides.
4. **`/when-it-breaks`.** Stable anchors for each failure mode (for example `#poison-record`) so articles and the GitHub docs can link deep.
5. **Search Console and Bing Webmaster Tools** verified through a Cloudflare DNS TXT record, with the sitemap submitted. Owner, 10 minutes, launch day.
6. **Crawlable text.** Text must render without JavaScript; live panels load after it. Redirect www to the apex, and keep trailing slashes consistent.
7. In the next release, link the README and package READMEs to `streamotter.app`.

## 6. Publish-and-distribute checklist (about 30 owner-minutes a piece)

**Done beforehand (no owner time):**
- All links resolve.
- Code runs against the pinned version.
- Claims are checked against IMPLEMENTATION_STATUS.md.
- Title at most 60 characters, description at most 155.
- The OG image and alt text.
- dev.to and Hashnode copies with canonical URLs and an "Originally published" line.
- A LinkedIn post and one community post.
- A PR adding the article to "Further reading".

**The owner:**
1. Publish on the home and check how it renders (5 min).
2. LinkedIn post with the image and link (5 min).
3. One community channel, per the community brief's rotation (HN with the canonical URL, or a single subreddit) (5 min).
4. Approve and merge the "Further reading" PR (3 min).
5. Two or three days later, paste the dev.to and Hashnode copies and confirm the canonical URL is set (10 min).

Replies to comments come out of the weekly 1–2 hours. Once a month, spend 10 minutes on GitHub's traffic referrers and Search Console queries. Don't count npm downloads as adoption: last week's 108 (`streamotter`) and 351 (`@streamotter/client`) include the owner's own registry install tests and mirrors, and can't be attributed.

## 7. What to avoid

- **Thin pages:** a "StreamOtter vs. X" page per competitor, "best Kafka WebSocket libraries" listicles, framework pages without tested code.
- **AI-sounding filler:** throat-clearing intros, "seamless", "robust", "leverage", "delve", summary conclusions. Every paragraph should say something checkable.
- **Keyword stuffing.** Write the phrase once in the title and once in the first paragraph.
- **Unsupported claims:**
  - "scalable" or anything that implies more than one gateway;
  - load-test numbers without "loopback, not a capacity claim";
  - timings without where they were measured;
  - `@next`;
  - unlabeled or out-of-version captures.
- **Competitor comparisons without sources and dates.** Never "unlike X".
- **Poor timing and duplication:** syndicating without a canonical, posting one piece to several subreddits on the same day, or linking to the demo while it's down.

## Open questions

1. Will the site have `/blog` with RSS? That decides where every evergreen piece lives.
2. Voice: "I" or "we"? I recommend "I", since the owner maintains it alone.
3. Is the owner comfortable telling the KafkaSocks story personally, and contacting the KafkaSocks co-authors before launch (notes kept privately)? A pointer from KafkaSocks would be a high-relevance link (hand-off to the community brief).
4. At launch, should the Medium announcement just be edited to add the demo link, or refreshed with a new "now live" post? (Hand-off to the launch communications brief.)
5. Should GitHub Discussions be turned on? It's off today (hand-off to the community brief).

**Hand-offs.**
- Product marketing brief: the headline sentence and the fit bullets.
- Community brief: the community rotation, the KafkaJS #1751 comment, and the KafkaSocks contact.
- Launch communications brief: the Medium fix and the LinkedIn timing.
- Lontra Creek project: §5.

## Sources

Rankings: web search results for each query above, September 27, 2026.

Pages:
- Socket.IO connection state recovery: https://socket.io/docs/v4/connection-state-recovery
- websocket.org reconnection guide: https://websocket.org/guides/reconnection/
- Ably, WebSockets and Kafka: https://ably.com/topic/websockets-kafka
- KafkaJS issue #1751: https://github.com/tulios/kafkajs/issues/1751
- HN story data: https://hn.algolia.com/api/v1/search?query=kafka%20websocket&tags=story, `…query=backpressure…`, `…query=sync%20engine…`

Platform documentation:
- dev.to canonical front matter: https://dev.to/ben/comment/93p9
- dev.to RSS import: https://dev.to/p/publishing_from_rss_guide
- Hashnode canonical link: https://docs.hashnode.com/help-center/hashnode-editor/how-to-set-a-canonical-link (returned 404 when fetched; the steps come from search excerpts)
- Hashnode API field `originalArticleURL`: https://dev.to/morinaga/how-i-implemented-the-canonical-url-chain-across-devto-hashnode-and-bluesky-50d
- Medium canonical link: https://help.medium.com/hc/en-us/articles/360033930293-Set-a-canonical-link (returned 403 when fetched; steps from search excerpts)
- LinkedIn has no canonical option (secondary sources): https://www.linkedin.com/pulse/ok-republish-my-blog-posts-linkedin-articles-karmen-kendrick
- Google on syndication and canonicals: https://searchengineland.com/google-no-longer-recommends-canonical-tags-for-syndicated-content-406491

Repository data (GitHub API and the npm registry, September 27): repo topics, homepage, social preview, and Discussions; `streamotter` and `@streamotter/client` weekly downloads; KafkaSocks (113★, last push January 2022); `kafka-socks` maintainers.

The Medium article itself returned 403 when fetched, so its state comes from the owner's September 25 check.
