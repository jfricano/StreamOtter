# StreamOtter V1.2.1: review of the fixes

At the owner's request, the V1.2.1 fixes were reviewed in a separate pass before the PR was opened. Three reviewers who had not written the code read the whole diff from the V1.2 branch (`aa3bc69`) to the merged fixes, reproduced findings where it was cheap, and checked each regression test against reverted code. Each finding was then fixed with a test where testable, and every tier was run again.

**Result:** no major findings; 19 minor, all fixed. Two flaky tests seen during the review were also fixed, one of them a V1.1 test outside this diff.

## Gateway and protocol (reviewer: gateway)

| # | Issue | Finding | Resolution |
| --- | --- | --- | --- |
| G1 | P-2 #21 | Names could still be probed through the reused-subscription-ID check (`INVALID_REQUEST`) and the per-connection limit (`OVERLOADED`), which ran only after the channel lookup and schema check passed. | Both checks now run before the channel lookup. Tests in `runtime-units.test.ts`. `V1_API.md` §7 states the order. |
| G2 | P-8 #24 | Freeing the handshake slot on disconnect let an `authenticate` that ignores its signal keep running outside `maxConnections` (50 concurrent calls against a limit of 5). | An abandoned call keeps counting against `maxConnections` until it settles or `handlerTimeoutMs` passes; the handshake still ends at once as `CANCELLED`. Two tests in `access.test.ts`. `V1_API.md` says to pass the signal on. |
| G3 | K-7 #35 | At the deadline, socket.io closed the HTTP listener a few microtasks after `stop()` resolved; the test bound with a hostname, whose DNS lookup hid it. | The listener is closed synchronously at the deadline. The test binds with `listen({ port })`. |
| G4 | P-3 #22 | The flood test's fixed bound (`<= 110`) failed under CPU load because the bucket refills at 10 per second. | The bound now scales with elapsed time. |
| G5 | P-3 #22 | The count of skipped traces was logged only when a later refusal was traced, so the last batch could go unreported. | Logged by a one-second timer and at `stop()`. Two tests. |
| G6 | J7 #54 | `IMPLEMENTATION_STATUS.md` still said fixture evidence is never deleted; `evidence-expired` for local evidence and the prune before storing had no tests. | Doc updated; tests added in `operator.test.ts` and `failure-service.test.ts`. |
| G7 | P-6 #23 | "An 8 KiB token always fits" isn't true for tokens JSON must escape. | Docs now say it holds for printable ASCII without `"` or `\` (JWT, base64url, hex). |
| G8 | W-15 #44 | The send-time expiry test was flaky: `Date` could be restored before the gateway decided delivery, and an early resync snapshot was counted as a delivery. | `Date` stays moved until delivery is decided, and only updates are counted. 20 of 20 runs under CPU load. |

## Client SDK and Kafka (reviewer: client-kafka)

| # | Issue | Finding | Resolution |
| --- | --- | --- | --- |
| K1 | C-5 #26 | Keeping a resyncing subscription `stale` meant concurrent `resync()` calls each sent a request, contradicting "concurrent resync calls join one operation". | A pending-request flag joins them. Test in `client-control.test.ts`. |
| K2 | K-9 #37 | KafkaJS returns from `commitOffsets` without committing while its consumer isn't running, so a retry could be reported as committed. | A commit counts only if KafkaJS raised its commit event; STOP and CRASH drop the assignment and its pending retry; the epoch is taken before the commit. Tests in `kafka-commits.test.ts`. |
| K3 | K-8 #36 | The start-position admin client wasn't closed by `stop()` and kept retrying after its deadline (and could hold startup for 30 s against a silent broker). | Its own bounded client, sockets closed when the read gives up or `stop()` runs, unref'd deadline. Test against a silent TCP server. |
| K4 | K-6 #34, K-8 #36 | The watchdog warning blamed broker reachability during a rebalance; the read-failure warning described `latest` behavior for `earliest` sources. | Reworded. |
| K5 | K-8 #36 | A rebalance before the first fetch dropped the start-position commit silently. | Now logs a warning. Test added. |
| — | W-19 #48 | The watchdog unit tests waited 5 s each on a real connection. | Same as T3 below. |

## CLI, scripts and tests (reviewer: tooling)

| # | Issue | Finding | Resolution |
| --- | --- | --- | --- |
| T1 | M-6 #32 | On a real full disk, `writeFile(…, { flag: "wx" })` creates the file before the write fails, so rollback left a 0-byte file and its folders. | A file whose write fails is recorded for rollback. The test's injected failure now creates the file first. |
| T2 | W-13 #42 | The pid ownership check compared a logical path, so a checkout reached through a symlink orphaned its broker and deleted the pid file; a path suffix could also match. | `pwd -P`, whole-argument match, and a warning (pid file kept) when the pid is another Kafka process. New `tests/integration/kafka-scripts.test.ts`. |
| T3 | W-19 #48 | Since K-8, each watchdog unit test waited 5 s on a real admin connection; the K-6 branch had no test. | The admin client is faked (15 s to about 10 ms) and a K-6 case checks the warning's fields. |
| T4 | W-14 #43 | The load test's budget included snapshot-to-commit time and one assertion was redundant. | Stalled clients receipt their snapshot so timers start during the advance; redundant assertion dropped. |
| T5 | W-12 #41 | The replicated tier's Kafka tools ran without the pinned JDK. | `JAVA_HOME` set when `.local/jdk` exists. |
| T6 | W-18 #47 | The release checklist still said the replicated tier skips and expected 2 tests. | Updated. |

## Also fixed

- `tests/integration/operator.test.ts` "F33 and F35: an approved redrive admits…" (V1.1) asserted `live` immediately after the redriven record, which can arrive through a resync; failed once in six runs under load. It now waits for `live`.

## Checked and found sound

P-9, M-5, K-4 (the decision to keep the behavior), R-5, C-6, C-7, C-8, the K-6 "partly fixed" decision, W-16, G-4, W-8, W-9, R-9 (the decision to document), W-11 and W-12 checksums (compared against upstream), R-7 action SHAs (each matches its tag), R-8 (packed from a clean copy), R-6, W-17 and W-18.
