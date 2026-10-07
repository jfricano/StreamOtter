# The StreamOtter volume

October 7, 2026 · Written from `main` at 1c75aaa (packages at `0.2.0-rc.1`) · Internal draft

Five pages that explain StreamOtter without reading every line of code. They're a welcome kit for contributors and a reference for anyone evaluating the project. Each page is a self-contained HTML file: open it in a browser. The pages link to each other.

| Part | Page | What it covers |
| --- | --- | --- |
| 1 | [How it works](./1-how-it-works.html) | The mental model, the architecture map, and one Kafka record's path to the browser |
| 2 | [How it's built](./2-how-its-built.html) | Packages and build, the public surface, the core-and-adapters design, the classes, conventions, concurrency and tests |
| 3 | [Guarantees and limits](./3-guarantees-and-limits.html) | What StreamOtter promises and doesn't, each failure, the security model, every limit, and what's verified |
| 4 | [Why it's built this way](./4-why-its-built-this-way.html) | The major design decisions, the alternatives, the reasoning and the costs, with links to where each is recorded |
| 5 | [Using and running it](./5-using-and-running-it.html) | The developer's first run and integration, the CLI, the production setup, operations and troubleshooting |

**Reading order for contributors:** 1, then the first-run section of 5, then 2, 4, 3, and the rest of 5 as reference. Then [CONTRIBUTING](../../CONTRIBUTING.md).

**Status.** These are drafts, checked against the code and docs at 1c75aaa but not yet independently reviewed. They cite files with line numbers, which go stale as the code changes. Each page ends with a list of the points that are interpretation rather than something read in the code. The [specification](../V1_API.md), the [guides](../guides/) and the code win wherever they disagree with these pages. Turning them into public docs (trimmed, reviewed, and published on streamotter.dev) is a planned follow-up.
