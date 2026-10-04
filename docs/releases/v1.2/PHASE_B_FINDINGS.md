# StreamOtter V1.2 review, phase B: V1 code that V1.1 changed

Reviewed on `feat/v1.1-review-fixes` at `c6f05f1` (the finished V1.1 stack). Three reviewers: K (gateway core and Kafka source, against a real Kafka 4.1.2 broker), M (CLI, codegen entry points and management), R (workbench, docs and release). Findings already in the V1.1 review were excluded. Every major was reproduced before it was fixed.

## Major findings

| ID | Finding | Where |
| --- | --- | --- |
| K-1 | **A consumer crash and restart while a source is paused loses the KafkaJS pause.** The batch handler then busy-loops (about 730 fetches a second, 56% CPU) until the source resumes. | `sources/kafka.ts` |
| K-2 | **`stop({ timeoutMs })` during startup waits for startup to finish,** ignoring the deadline (a 500 ms stop took 24.7 s). Same root as M-1. | `runtime/gateway.ts` |
| K-3 | **No heartbeat while a record is processed.** A record slower than the Kafka session timeout gets the consumer evicted, the commit fails, and the record is reprocessed forever. | `sources/kafka.ts` |
| M-1 | **SIGINT and SIGTERM during `dev` or `start` startup are ignored until startup ends,** and a handler module that never settles means the process never exits. | `cli/src/cli.ts`, `runtime/gateway.ts` |
| R-1 | **After a tab switch, the workbench Preview keeps drawing into detached DOM.** The panel shows an old revision marked live. | `apps/workbench/src/views/preview.ts` |

## Minor findings

- **Gateway and Kafka:** K-4 a revision-conflict pause clears on a plain resume; K-5 the watchdog interval leaks when stop overlaps start; K-6 the 12 s watchdog can't tell a slow record from an outage; K-7 after the stop deadline, shutdown carries on in the background; K-8 `startFrom: latest` doesn't commit its start position, and an out-of-range reset is silent; K-9 a failed commit on the last record is never retried.
- **CLI and management:** M-2 command names like `constructor` resolve to prototype members; M-3 the deferred-feature lookup has the same problem; M-4 so do environment secret names; M-5 GET management routes accept a body; M-6 `init` file-system errors exit 1 and leave a partial scaffold; M-7 `--json=1` gets a plain-text error; M-8 `sources rebaseline` is missing from the CLI README and usage; M-9 `--management-port` accepts `""` and hex.
- **Workbench, docs and release:** R-2 a double Start leaks a preview, and a late token refresh writes into the wrong preview; R-3 export blob URLs are never revoked; R-4 concurrent Connect refreshes can draw an older status; R-5 the troubleshooting guide's journal Node message differs from the code; R-6 the getting-started trace stage order is wrong; R-7 browser, Kafka and deploy CI run only nightly on Node 24, the replicated tier never, and actions are pinned by tag; R-8 no `prepack` build; R-9 the workbench `exports` field blocks deep imports and the changelog doesn't say so.
