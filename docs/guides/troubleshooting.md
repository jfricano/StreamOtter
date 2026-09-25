# Troubleshooting

Start from what you see. Every SDK failure is a `StreamError` with a `code`. Log it from `subscription.on("error", …)` and `client.on("error", …)`, and watch `client.state` and `subscription.state`.

## The view never becomes `live`

| What you see | Why | What to do |
| --- | --- | --- |
| Client state `auth-required`, error `FORBIDDEN` "This origin is not allowed." | The page's origin isn't in `gateway.allowedOrigins`. | Add the exact origin (scheme, host, and port, such as `http://localhost:5173`) and restart the gateway. There are no wildcards. |
| Client state `auth-required`, error `UNAUTHENTICATED` | `authenticate` returned `null`, the principal's `expiresAt` has passed, `getToken` failed or took over 10 s, or the token is empty or over 8 KiB. | Fix the token or the session check. After the user signs in again, call `client.reconnect()`; the SDK doesn't retry a rejected token by itself. |
| `ready()` rejects with `FORBIDDEN` after connecting | `authorize` returned something other than `true`, **or** the channel name or `channelVersion` doesn't exist. The browser can't tell which, by design. | Compare the channel and version with `streamotter.json` (use the generated `channelVersions`) and check `authorize`. In development, the workbench's Inspect tab shows the rejected `authorize` step. |
| `INVALID_PARAMS` | The parameters don't match the channel's `paramsSchema` (a missing or extra field, a wrong type, too long). | Send exactly the parameter object the schema describes. |
| `HANDLER_FAILED` | `authenticate`, `authorize`, or `snapshot` threw, or took longer than `handlerTimeoutMs` (2 s by default). | See the gateway's log. `snapshot` has its own `snapshotTimeoutMs` (10 s by default). |
| `INVALID_PAYLOAD` | `snapshot` returned data that doesn't match the `payloadSchema`, or an invalid revision. | Revisions are decimal strings such as `"7"`, not numbers. |
| `ready()` rejects with `TIMEOUT` | Nothing failed, but the view didn't become `live` within the wait (30 s by default), for example because the source is unavailable. | See the next section. |

## The view is `stale` or `resync-required`

`stale` means the view shows the last good state, and the SDK is recovering or waiting for the gateway.

- **The gateway is down or unreachable:** the client state is `reconnecting`. It retries with backoff (up to 30 s between attempts) while subscriptions are open, and resynchronizes once connected.
- **The source is paused:** a record couldn't be processed (invalid JSON, a tombstone, a `map` error, an invalid mapped state, a revision conflict). The gateway logs a diagnostic, and in development the workbench's Connect tab shows the source as `paused` with a reason. Fix the cause, then resume. See [Connect to Kafka: when a record is bad](./kafka.md#when-a-record-is-bad).
- **Kafka is rebalancing, or the broker is unreachable:** views resynchronize once the source is healthy again. A broker outage is detected after about 12 s without fetch or heartbeat activity.

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
| `… is invalid (N issues):` followed by paths and codes | Fix the configuration. Deferred V2 fields such as `history` or `recovery` are reported by name. |

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
