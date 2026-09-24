# Order dashboard — StreamOtter V1 reference example

A small application that adds live order status to a web page with StreamOtter. The
application owns identity, access rules, and authoritative order state; StreamOtter
owns subscriptions, synchronization, delivery, and diagnostics.

| Piece | File | Owned by |
| --- | --- | --- |
| Channel contract | `streamotter.json`, `streamotter.kafka.json` | Shared configuration |
| Generated types | `src/generated/streamotter.generated.ts` (`streamotter generate`) | Generator |
| Identity, ownership rules, order state machine | `src/server/domain.ts` | Application |
| Gateway handlers (fixture mode) | `src/server/fixture-handlers.ts` | Application |
| Gateway handlers (Kafka mode) | `src/server/kafka-handlers.ts` | Application |
| Application server (UI, demo sign-in, store, publisher) | `src/server/app.ts` | Application |
| Vanilla TypeScript view | `src/web/main.ts` | Application |
| React usage | `src/web/react.tsx` | Application |
| Reproducible scenarios | `scripts/scenarios.ts` | Example |

Demo identities (`alice`, `carol`, `bob`, and development principal `mallory`) and the
signing secret default are development-only. The app server refuses to run with
`NODE_ENV=production`.

## Run it (fixture mode, no Kafka)

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm example
```

- Application: <http://localhost:3000> (sign in as Alice; React version at `/react`)
- Workbench: <http://127.0.0.1:7401> — paste the token printed in the terminal

Fixture records advance only when you ask: in the workbench **Connect** tab, advance the
`orders` source. The fixture timeline moves every order one step per round (Acme
`ord_1001`, `ord_1002`, `ord_1003`, then Globex `ord_1001`).

## Scenarios

`pnpm --filter order-dashboard scenarios` runs these headlessly against the real gateway,
SDK, and this example's handlers, and prints the observed timelines. The same function
runs in `pnpm test`.

1. **Update while the snapshot loads.** With `ORDER_SNAPSHOT_DELAY_MS`, the snapshot is
   read, then held. An update committed meanwhile is buffered and released after the
   snapshot: `synchronizing → snapshot r1 → update r2 → live`. To see it in the browser, run
   `ORDER_SNAPSHOT_DELAY_MS=4000 pnpm example`, open an order, and advance the fixture in
   the workbench while the view says *Loading*.
2. **Disconnect and resynchronize.** The view goes *stale*; changes while disconnected are
   not replayed; recovery delivers a fresh snapshot with the current state. In the browser,
   use **Reconnect**, or disconnect a workbench preview session.
3. **Rejected access.** A non-owner in the same tenant, a user from another tenant with the
   same order ID, and a forged token all fail closed (`FORBIDDEN`, `FORBIDDEN`,
   `UNAUTHENTICATED`) without receiving data. In the browser, choose *Try order … (not yours)*.

## Kafka mode

Requires the local broker (`pnpm kafka:setup && pnpm kafka:start` at the root).

```bash
pnpm example:kafka
```

The application server creates `orders.status` (3 partitions), keeps its authoritative
store in `.data/orders.json`, and — for **Advance order** — writes the store first, then
publishes the full new state keyed by order ID. The gateway's Kafka handlers read
snapshots and ownership from the application's internal API. To start over, stop both,
delete `.data/`, and delete the topic (or reset the broker with
`./scripts/kafka/start.sh --reset`).

This mode uses the plaintext development listener. Production gateways require TLS
(`streamotter start` rejects plaintext Kafka and fixture sources).
