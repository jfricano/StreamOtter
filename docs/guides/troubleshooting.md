# Troubleshooting

Start from what you see. Every SDK failure is a `StreamError` with a `code`. Log it from `subscription.on("error", …)` and `client.on("error", …)`, and watch `client.state` and `subscription.state`.

## The view never becomes `live`

| What you see | Why | What to do |
| --- | --- | --- |
| Client state `auth-required`, error `FORBIDDEN` "This origin is not allowed." | The page's origin isn't in `gateway.allowedOrigins`. | Add the exact origin (scheme, host, and port, such as `http://localhost:5173`) and restart the gateway. There are no wildcards. |
| Client state `auth-required`, error `UNAUTHENTICATED` | `authenticate` returned `null`, the principal's `expiresAt` has passed, `getToken` failed or took over 10 s, or the token is empty or over 8 KiB. | Fix the token or the session check. After the user signs in again, call `client.reconnect()`; the SDK doesn't retry a rejected token by itself. |
| `ready()` rejects with `FORBIDDEN` after connecting | `authorize` returned something other than `true`, **or** the channel name or `channelVersion` doesn't exist, **or** (in production) the parameters don't match the channel's `paramsSchema`. The browser can't tell which, by design. | Compare the channel and version with `streamotter.json` (use the generated `channelVersions`) and check `authorize`. In development, the workbench's Inspect tab shows the rejected `authorize` step. |
| `INVALID_PARAMS` | The parameters don't match the channel's `paramsSchema` (a missing or extra field, a wrong type), or they're over `maxParamsBytes`. A production gateway reports a schema mismatch as `FORBIDDEN` instead, and records `INVALID_PARAMS` in its traces. | Send exactly the parameter object the schema describes. |
| `HANDLER_FAILED` | `authenticate`, `authorize`, or `snapshot` threw, or took longer than `handlerTimeoutMs` (2 s by default). | See the gateway's log. `snapshot` has its own `snapshotTimeoutMs` (10 s by default). |
| `INVALID_PAYLOAD` | `snapshot` returned data that doesn't match the `payloadSchema`, or an invalid revision. | Revisions are decimal strings such as `"7"`, not numbers. |
| `ready()` rejects with `TIMEOUT` | Nothing failed, but the view didn't become `live` within the wait (30 s by default), for example because the source is unavailable. | See the next section. |

## The view is `stale` or `resync-required`

`stale` means the view shows the last good state, and the SDK is recovering or waiting for the gateway.

- **The gateway is down or unreachable:** the client state is `reconnecting`. It retries with backoff (up to 30 s between attempts) while subscriptions are open, and resynchronizes once connected.
- **The source is paused:** a record couldn't be processed (invalid JSON, a tombstone, a `map` error, an invalid mapped state, a revision conflict). The gateway logs a diagnostic, and in development the workbench's Connect tab shows the source as `paused` with a reason. Fix the cause, then resume. See [Connect to Kafka: when a record is bad](./kafka.md#when-a-record-is-bad). With V1.1 failure handling configured, the record is also an incident: `streamotter failures list` (or the workbench's Failures tab) shows it, and the [runbook](./source-failures.md#65-repair-a-poison-record) says how to repair and retry it.
- **The source moved past a quarantined record** (V1.1 `quarantine-resync`): every snapshot on that source must return the recovery boundary's ID. A snapshot that omits it keeps the view `stale` and is retried; the gateway logs "Snapshot did not acknowledge the source's recovery boundary". See [Acknowledge the boundary in every snapshot](./source-failures.md#42-acknowledge-the-boundary-in-every-snapshot).
- **Kafka is rebalancing, or the broker is unreachable:** views resynchronize once the source is healthy again. A broker outage is detected after about 12 s without fetch or heartbeat activity. A slow `map` handler alone doesn't trigger it: the gateway keeps heartbeating while a record is processed. If it fires during a record, the log line says heartbeats are not being acknowledged (an unreachable broker or a rebalance) and names the record's position and how long it has been processing.

`resync-required` means automatic recovery gave up after its attempts (three per incident, 1 s and then 2 s apart), for example because of repeated snapshot timeouts or overflows. Call `subscription.resync()`, from a retry button for example. In development, a page left open across a `streamotter dev` restart also ends here: the fixture source starts over at revision 1, and the SDK never accepts an older revision than it has shown. Reload the page.

## `OVERLOADED`

| Message | Default limit |
| --- | --- |
| "This connection has reached its subscription limit." | `maxSubscriptionsPerConnection`: 50 |
| "Too many control requests; slow down." | `controlRequestsPerSecond`: 20 per connection (bursts of 40) |
| "The gateway has reached its connection limit." | `maxConnections`: 1,000 |

The SDK retries a refused subscription after 1 s and 2 s, then enters `resync-required`. A client that stops acknowledging frames is disconnected once `receiptTimeoutMs` (5 s by default) passes; it reconnects and resynchronizes. Limits are set in `streamotter.json` under `limits`; see the [V1 specification](../V1_API.md#proposed-default-limits).

## The CLI refuses to start

Exit code `2` means invalid input or configuration; `1` means startup or runtime failure.

| Message | Fix |
| --- | --- |
| `… is TypeScript. StreamOtter loads compiled JavaScript modules; …` | Compile your handlers and pass the `.js` output, or write them as `.mjs`. |
| `` … must export `handlers` (a HandlerRegistry). `` | Export a `handlers` object from the module. |
| `Invalid production configuration: source … is a fixture; fixture sources are development-only.` | `streamotter start` uses Kafka sources only. Keep fixtures in a development configuration. |
| `… uses plaintext Kafka; plaintext connections are development-only.` | Set `tls` on the connection: `{ "caFile": "…" }` or `{}`. |
| `Gateway startup failed: Sources did not become ready within the 30-second startup deadline.` | Read the source diagnostics printed below it ([what each stage means](./kafka.md#diagnose-connection-problems)). Right after a crash, starting again usually succeeds; see [restarts and crashes](./kafka.md#restarts-and-crashes). |
| `Gateway startup failed: Port 7400 is already in use.` | Stop the other process, or change `gateway.port`. |
| `The management server could not start: …` (`dev` only) | Something else uses port 7401. Pass `--management-port <port>`. |
| `Refusing to overwrite existing files: …` (`init`) or `… not created by the generator: …` (`generate`) | Choose another directory, or move those files away. |
| `Could not create the project in …, and removed the files it had written: …` (`init`) | A write failed partway through, for example for permissions or a full disk. Nothing is left behind; fix the cause and run `init` again. |
| `… is invalid (N issues):` followed by paths and codes | Fix the configuration. Deferred V2 fields such as `history` or `recovery` are reported by name. |
| `/failureHandling  UNKNOWN_KEY: Unknown key "failureHandling".` from an older release | `failureHandling` needs a gateway with V1.1 failure handling. An older gateway refuses it rather than ignoring the policies. |
| `Invalid failure handling: source … uses a quarantine policy, which requires stateDirectory in production …` | Pass `--state-dir`. See [Turn it on](./source-failures.md#2-turn-it-on). |
| `Invalid failure handling: source … uses quarantine-resync, which requires a recovery guard at handlers.sources.….recover` | Add the guard, or use `quarantine-hold`. See [Write an honest recovery guard](./source-failures.md#4-write-an-honest-recovery-guard). |
| `--operator-socket requires --state-dir <directory>` | The socket lives in `<directory>/run/`. The configuration also needs a `failureHandling` section. |
| `No failure journal at …/journal.sqlite. Run \`streamotter init --failures\` …` or `State directory … does not exist` | Create the journal once with `streamotter init --failures --config <path> --state-dir <dir>`, as the gateway's user. If a journal existed before, don't create a new one: see [lost or damaged local state](./source-failures.md#68-lost-or-damaged-local-state). |
| `… is group- or world-writable (mode …); run chmod go-w on it.`, or `… is owned by uid …` | Make the state directory and journal owned by the gateway's user, and not writable by others. `run/` must have no group or world access at all (`chmod 700`). |
| `The failure journal needs Node 24.15.0 or later; this is Node …` (from the gateway, or after `Invalid failure handling:` from `validate`) | Upgrade Node. |
| `Another gateway owns this journal (pid …)` | Stop the other gateway. A lock left by a dead process on the same host is replaced by itself, even one naming the new gateway's own pid after a container restart. A lock naming another host must be removed by hand once you've checked that gateway is stopped. |
| `…/journal.sqlite-wal exists: files of an earlier journal are still here …` (or `-shm`), from `init --failures` | A `-wal` or `-shm` file from an earlier journal is still in the state directory, and it can hold that journal's last commits. Don't delete it. Move `journal.sqlite`, `journal.sqlite-wal` and `journal.sqlite-shm` aside together, or recover the old journal; see [lost or damaged local state](./source-failures.md#68-lost-or-damaged-local-state). |
| `… is not a readable SQLite database or is corrupt …` / `… failed its integrity check …` | Restore the journal from a backup. See [lost or damaged local state](./source-failures.md#68-lost-or-damaged-local-state). |
| `Source "…" has an open incident (…) from generation "…"` | You changed a source's `generation` while it has open incidents. If you didn't mean to rebaseline, restore the previous generation and resolve them first. If you did (a re-created topic, a record that can never be processed), run `streamotter sources rebaseline` with the gateway stopped. See [Rebaseline a source](./source-failures.md#610-rebaseline-a-source). |
| `The quarantine topic is missing; provision it …` | Create the topic, and check the principal can Describe it. See [the quarantine topic](./kafka.md#the-quarantine-topic-v11). |
| `The quarantine topic's max.message.bytes (…) is below the … bytes needed …` | Raise the topic's `max.message.bytes` to at least `maxSourceRecordBytes` plus 80 KiB. |
| `Gateway startup failed: Health port 127.0.0.1:7402 is already in use.` | Something else listens on the `--health` port. Stop it, or choose another port. |
| `failureHandling was removed, but the failure journal still has open incidents on … / recovery boundaries in force on …` | `--state-dir` points at a journal with outstanding obligations, and the configuration no longer has `failureHandling`. Put the section back, resolve the incidents and retire the boundaries, then remove it. See [upgrade and downgrade](./source-failures.md#8-upgrade-and-downgrade). |

## Operator commands (V1.1)

`streamotter status`, `failures …` and `sources …` talk to a running gateway over its local socket. Exit codes: `0` completed, `1` runtime failure or a `failed` operation, `2` invalid request, `3` refused, `4` unknown outcome. With `--json`, every error is one line `{"error": StreamError}` on stderr and stdout stays empty.

| What you see | Why | What to do |
| --- | --- | --- |
| `No gateway is serving the operator socket for …` (exit 1) | The gateway isn't running, wasn't started with `--operator-socket`, or `--state-dir` points elsewhere | Start it with `--state-dir <dir> --operator-socket` and use the same `<dir>`. |
| `Operator token file … is accessible to group or others …`, or `… is owned by uid …` | You're not the gateway's user, or the permissions changed | Run the command as the gateway's user (for example with `sudo -u`). |
| `UNAUTHENTICATED: The operator token is missing or stale` | The gateway restarted between reading the token and the request | Run the command again; each start writes a new token. |
| `refused: stale-revision` (exit 3) | The incident or circuit changed since you read it. A `retry-current` or `reassess` waits for a quarantine write or recovery guard already running on the source, and that can change the incident. | Read the current revision with `failures show` or `status`, check what changed, and decide again. |
| `refused: not-found` (exit 3) | No incident, source or boundary with that ID | Check the ID, and that `--state-dir` names the right gateway. |
| `refused: advance-unresolved` | An advance on that source is `advance-pending` or `uncertain`; the whole source holds until a restart reconciles it | Restart the gateway once the broker is reachable. See [crash and restart](./source-failures.md#67-crash-and-restart). |
| `refused: integrity-fault-open` (`evaluate`, `redrive`) | The source has an unresolved source-integrity fault: an integrity-class incident, an unconfirmed advance, an evidence conflict, a moved position, or an incident captured on another Kafka cluster | Resolve that incident first. For a changed cluster, see [another cluster](./source-failures.md#64-topic-retention-and-expired-evidence). |
| `refused: circuit-open` | Automatic continuation stopped on that source; retries are refused too | Fix the cause, then `sources reopen-circuit`. |
| `refused: plan-expired`, `plan-unknown` or `fingerprint-changed` | Redrive plans last five minutes, are single use, and end on restart | Run `failures evaluate` again. |
| `refused: nothing-to-rebaseline` (exit 3) | `sources rebaseline` found no incident or boundary from an earlier generation | Change the source's `generation` first; incidents of the current generation are retried or repaired, never rebaselined. |
| `completed: held` (exit 0) | The retry ran, and the record failed again | Read the reason in the message or `failures show`; repair and retry. |
| `unknown` (exit 4) | The gateway stopped between recording the operation and its result | Check `failures show`; never assume it ran. See [crash and restart](./source-failures.md#67-crash-and-restart). |
| `The outcome of … is unknown: the gateway may have applied it, but its answer was lost` (exit 4) | A `retry-current`, `reassess`, `reopen-circuit`, `retire-boundary` or `redrive` reached the gateway, but no answer came back: the gateway stopped with the answer still pending for more than 5 seconds, the connection dropped, or 30 seconds passed (`TIMEOUT`) | Check `status` and `failures show` before sending it again. For a redrive, sending it again with the same `--operation-id` returns the recorded result. A read command (`status`, `failures list`, `show`, `export`, `evaluate`) that loses its answer exits 1 instead; just run it again. |
| `OVERLOADED` | More than 10 requests per second, or 16 connections, on the socket | Slow down; don't poll in a tight loop. |

Every refusal outcome is listed in the [runbook](./source-failures.md#53-exit-codes-and-refusals).

## Health checks (V1.1)

| What you see | Why | What to do |
| --- | --- | --- |
| `/health/ready` is 503 with `starting` | `start()` hasn't finished, for example while sources join their groups | Wait; startup has a 30-second deadline. |
| `source-held` | A source is paused at a record | `streamotter failures list`, then the [runbook](./source-failures.md#65-repair-a-poison-record). |
| `source-unavailable` | A broker outage, a rebalance, or a source still starting | As in V1: views recover by themselves once Kafka is back. |
| `journal` | A journal write failed, or the journal is full | [Full disk or full journal](./source-failures.md#63-full-disk-or-full-journal). |
| `quarantine` | A quarantine write failed or its outcome is unknown | [Credentials and ACLs](./source-failures.md#61-credentials-and-acls) and [quarantine topic outage](./source-failures.md#62-quarantine-topic-outage). |
| 404 | Only exactly `/health/live` and `/health/ready` answer: no query string, no trailing slash, `GET` or `HEAD` only | Fix the probe's path. |

## Module not found

| What you see | Why | What to do |
| --- | --- | --- |
| `Cannot find module '@streamotter/client'` (or `@streamotter/gateway`), usually with pnpm | You installed `streamotter`, but the code imports an individual package. pnpm makes only the packages you installed directly importable. | Import from `streamotter/client` or `streamotter/gateway`. For generated files, run `streamotter generate` again: it picks the import style from your `package.json`. |
| An error about `"exports"` in `node_modules/streamotter/package.json` | The code imports the bare `streamotter`. | Import a subpath: `streamotter/client` in the browser, `streamotter/gateway` on the server. |

## The workbench

- It asks for the token again after a reload. That's by design: the token lives only in the page's memory.
- The token stops working after `dev` restarts, because each run prints a new one.
- Edits in the Define tab don't change the running gateway. Export the configuration, save it, and restart `dev`.
- The workbench exists only under `streamotter dev`, on loopback. `streamotter start` never serves it.

## Still stuck?

Search or open an issue at <https://github.com/jfricano/StreamOtter/issues>. Include the package versions, the error `code` and `message`, and the relevant gateway log lines; they contain no payloads or credentials. For security problems, follow the [security policy](../../SECURITY.md) instead.
