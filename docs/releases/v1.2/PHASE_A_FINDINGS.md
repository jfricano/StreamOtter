# StreamOtter V1.2 review, phase A: V1 code that V1.1 never touched

October 4, 2026. Four independent reviewers read the V1 code that no one but its author had read before: the wire protocol and sessions, the client SDK, codegen and contracts, and the workbench views, example web client, scripts and V1 tests. The code was reviewed at `feat/v1.1-operations-release` @ `24abe81`. Nothing in the repo was changed, and fixes wait until V1.1 is finished.

**Result: 10 major and 33 minor findings in V1 code, plus one major in V1.1 code that was passed to the V1.1 thread.** I re-ran every major reproduction myself, and each one failed as described. Reproductions are under `.review-scratch/<P|C|G|W>/` in the review container.

## Major findings

| # | Finding | Where |
| --- | --- | --- |
| P-1 | **A client that stops reading makes the gateway buffer replies without limit.** Error and control replies skip the byte budget, and malformed or unknown frames aren't rate-limited. 5.2 MB sent in made the gateway's memory grow by 151 MB (the 4 MiB cap was never applied). This breaks V1_API "queued transport bytes cannot grow without bound". | `runtime/session.ts:204-225,282`, `transport/socketio.ts:44-58` |
| P-4 | **A revocation that lands while a connection is being set up is missed.** The revoked session connects anyway, subscribes and receives data until its token expires. | `runtime/gateway.ts:399,506,515-525` |
| C-1 | **Unsubscribing before the subscribe is acknowledged leaves the subscription alive on the gateway.** The client never sends the unsubscribe, the gateway's snapshot goes unreceipted, and after the receipt timeout the gateway drops the whole connection, so every other view goes stale. | `client/src/subscription.ts:128-137` |
| C-2 | **A rate-limited resync freezes the subscription in `authorizing`,** and calling `resync()` again can't recover it. 45 views resyncing at once (within the default limits) is enough to trigger it. | `subscription.ts:332-340` |
| C-3 | **A rate-limited unsubscribe is reported as success.** The gateway keeps the subscription, it counts against the 50 limit, and its next update drops the connection. | `subscription.ts:365-372` |
| C-4 | **The documented React provider breaks under StrictMode in development.** It closes the client on effect cleanup, StrictMode remounts the component, and every subscribe throws `CLIENT_CLOSED`. The example works only because its bundle uses production React. | `client/README.md:102-105`, `examples/order-dashboard/src/web/react.tsx:13-16` |
| W-1 | **The example dashboard can show one order's data under another order's header, marked Live,** after two quick clicks. It also leaks a live subscription per click burst. | `examples/order-dashboard/src/web/main.ts:141-168` |
| G-1 | **A U+2028 or U+2029 character in a params property name or enum value injects runnable code** into the generated `streamotter.client.example.ts`. The character is invisible in diffs, and importing the file runs the code. | `cli/src/generate.ts:170-173,212` |
| G-2 | **A config with 8 or more nested objects passes validation, then crashes `validate`, `generate` and gateway startup.** The documented limit is 16, but the config fingerprint caps total depth at 16, which is 7 schema levels. | `contracts/src/primitives.ts:85-90` and its callers |
| G-3 | **The generated optional fields accept `undefined` under plain `strict`, and the gateway treats it as an integrity failure.** A mapper like `{ note: row.note }` compiles, then the source pauses permanently (`routing-invalid`, which no quarantine policy can skip). | `generate.ts:122`, `runtime/gateway.ts:768`, `subscription.ts:437` |

**V1.1 code (sent to the V1.1 thread, not fixed here):** W-2. `scripts/kafka/replicated-start.sh` and `replicated-stop.sh` detect running nodes only through `/proc`, so on macOS start fails and leaves Java running, and stop kills nothing.

## Minor findings

- **Protocol and sessions:**
  - P-2: channel and parameter names can be discovered before authorize, despite the docs.
  - P-3: unauthenticated CONNECT floods evict every operator trace.
  - P-5: timeouts above 2^31−1 ms are accepted, and Node clamps them to 1 ms.
  - P-6: `maxControlFrameBytes` can be set below what an 8 KiB token needs.
  - P-7: `freezePrincipal` is shallow.
  - P-8: authenticate isn't cancelled when the client disconnects.
  - P-9: several CONNECTs on one connection create orphan sessions.
- **Client SDK:**
  - `resync()` during a pause shows `authorizing` instead of `stale`.
  - A same-tick hello-then-close leaves Node clients stuck.
  - Rejected frames are retried with no backoff (V1_API §5 says 1 s, then 2 s).
  - A `resync-required` for the old epoch is ignored mid-resync.
  - Listeners still fire after one of them unsubscribes.
- **Codegen:**
  - Type names depend on schema key order.
  - `generate` follows a dangling symlink outside `--out`.
  - A bad `--out` exits 1 instead of 2.
  - The public `generateFiles` doesn't validate.
  - An enum combined with length limits can be unsatisfiable.
- **Example and workbench:**
  - `/api/orders` isn't checked for errors.
  - A failed Advance leaves the button disabled, and the id isn't URL-encoded.
  - `useOrderStatus` shows stale state.
  - The scenario delay isn't reset on failure.
  - The Inspect view's `load()` can mix old-filter rows into results.
  - Define shows a stale "Valid" banner.
- **KafkaJS patch:**
  - It is skipped silently on other KafkaJS versions.
  - The `require("kafkajs/package.json")` call is unguarded.
  - A comment is wrong.
- **Scripts:**
  - Caddy's checksum isn't pinned.
  - The JDK is unverified off macOS.
  - `start.sh` and `stop.sh` trust stale pid files.
- **Tests that don't test what their name says:**
  - The load test's "never blocked" assert can't fail.
  - The token-expiry test never sends a record after expiry.
  - `01-progress` doesn't check commit order.
  - Several smaller name and assertion gaps.
  - `test:kafka` passes with every test skipped when no broker is running.
- **Documented V1 behaviors with no test:** 12 are listed, among them authorize running again before snapshot delivery and on resync, the `getToken` timeout, the stop deadline, the management API's 429/503/504 responses, the Kafka degraded timer, and CLI exit code 1. The four behaviors that were probed all hold.

## Checked and found sound

- Tenant isolation and routing keys.
- Handshake checks: origin, auth keys, token cap, claims depth.
- Schema validation: unknown keywords, depth, NaN and Infinity, and `__proto__`.
- Frame limits and budget accounting.
- Session teardown.
- Error frames don't leak handler details.
- Traces carry no payloads or tokens.
- Client reconnect, backoff, token refresh, ordering and snapshot checks.
- Client timers and listeners all released.
- Every V1.1 source state is handled by the client.
- Generated types compile under many strict tsconfig combinations and with awkward names (`__proto__`, reserved words, quotes, emoji).
- Codegen output is deterministic and matches the committed example.
- The `streamotter` meta-package exports.
- `contracts/v1` type tests.
- No HTML injection in the workbench views or the example.
- `set-version.mjs`.
- Pinned Kafka and JDK hashes.

## Next

The fixes wait for the V1.1 fix PR and its second review. Then phase B reviews the V1 code that V1.1 changed (the gateway core, Kafka source, CLI and management), and every fix lands on `feat/v1.2-quality-fixes` on top of V1.1, one commit per finding, each with a regression test.
