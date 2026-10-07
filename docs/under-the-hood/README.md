# Under the Hood

October 7, 2026 · Written from `main` at 1c75aaa (packages at `0.2.0-rc.1`) · Reviewed for publication

Five guides that explain StreamOtter without reading every line of code, for engineers deciding whether to adopt it, would-be contributors, and curious readers. Start with the [introduction](./index.html), which says what each part covers and suggests a reading order for each kind of reader. Each page is a self-contained HTML file: open it in a browser. The pages link to each other.

| Part | Page | What it covers |
| --- | --- | --- |
| 1 | [How it works](./1-how-it-works.html) | The mental model, the architecture map, and one Kafka record's path to the browser |
| 2 | [How it's built](./2-how-its-built.html) | Packages and build, the public surface, the core-and-adapters design, the classes, conventions, concurrency and tests |
| 3 | [Why it's built this way](./3-why-its-built-this-way.html) | The major design decisions, the alternatives, the reasoning and the costs, with links to where each is recorded |
| 4 | [Guarantees and limits](./4-guarantees-and-limits.html) | What StreamOtter promises and doesn't, each failure, the security model, every limit, and what's verified |
| 5 | [Using and running it](./5-using-and-running-it.html) | The developer's first run and integration, the CLI, the production setup, operations and troubleshooting |

**Reading order for contributors:** 1, then the first-run section of 5, then 2, 3, 4, and the rest of 5 as reference. Then [CONTRIBUTING](../../CONTRIBUTING.md).

**Status.** Written from the code and docs at 1c75aaa, then checked claim by claim against `main` by independent reviewers, and corrected. File references name files, not line numbers, so they stay valid as the code moves; re-check the pages when the packages change behavior. [REVIEW.md](./REVIEW.md) records the review. Each part ends with the points that are interpretation rather than something read in the code. The [specification](../V1_API.md), the [guides](../guides/) and the code win wherever they disagree with these pages. They are meant to be linked from the streamotter.dev Docs page. "Under the Hood" is a working title.
