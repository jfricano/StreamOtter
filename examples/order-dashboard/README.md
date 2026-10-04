# Order dashboard — StreamOtter V1 reference example

A small application that adds live order status to a web page with StreamOtter. The
application owns identity, access rules, and authoritative order state; StreamOtter
owns subscriptions, synchronization, delivery, and diagnostics.

| Piece | File | Owned by |
| --- | --- | --- |
| Channel contract | `streamotter.json`, `streamotter.kafka.json`, `streamotter.kafka-resync.json` | Shared configuration |
| Generated types | `src/generated/streamotter.generated.ts` (`streamotter generate`) | Generator |
| Identity, ownership rules, order state machine, order store with outbox, recovery guard | `src/server/domain.ts` | Application |
| Gateway handlers (fixture mode) | `src/server/fixture-handlers.ts` | Application |
| Gateway handlers (Kafka mode) | `src/server/kafka-handlers.ts`, `src/server/kafka-resync-handlers.ts` | Application |
| Application server (UI, demo sign-in, store, outbox, publisher) | `src/server/app.ts` | Application |
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

## Source failures: quarantine-resync and the recovery guard

`streamotter.json` (fixture mode) and `streamotter.kafka-resync.json` (Kafka mode) set
the `orders` source to `quarantine-resync` for invalid JSON and for payloads that fail
the `OrderState` schema. A bad record is captured as evidence, and the gateway then
asks the application's recovery guard (`handlers.sources.orders.recover`) whether
snapshots will supersede it. Only on a yes does the source move past the record. A no,
an error or a timeout holds the source on the record until an operator acts.
`streamotter.kafka.json` keeps V1's pause-on-failure behavior. The gateway refuses a
guard for a source without a resync policy, so Kafka mode with resync uses its own
handler module, `kafka-resync-handlers.ts`.

### The outbox and the watermark

The guard can only answer honestly from data the application owns, so the store in
`domain.ts` (`OrderStore`) has an outbox:

- Every published order state, whether a change or a re-publish of the current state,
  is an outbox row with the next sequence number. Writing a change sets the order,
  appends its row and raises the store's watermark in one step (the stand-in for one
  database transaction).
- After the broker acknowledges a row, the application records its position on the row
  (topic, partition and offset in Kafka mode; the timeline index in fixture mode). A row
  whose send failed has no position and never counts as published.
- The outbox must be complete from the moment each order was created (or at least from
  the oldest position the guard may still be asked about): never prune rows the guard
  might need, and never restore the orders without their rows. An order with rows
  missing would look like an order that was never re-published, or worse, like one that
  never changed. The guard therefore decides "never changed" from the order itself
  (still at its seed revision), not from the absence of rows.
- The snapshot query reads the order and the watermark together. In Kafka mode that is
  the authoritative store behind `GET /internal/orders/…`. In fixture mode it is the
  development read model, which applies records in timeline order.
- The watermark a snapshot reports must be **contiguous**: watermark W means every
  outbox row up to W has been processed. It is never merely the highest row seen. A read model fed
  from several partitions (or several replicas) can apply row 9 before row 7, and
  reporting 9 then would acknowledge a boundary at 8 without row 7's change. Such a
  read model reports the highest W below which it has no gaps.

### What the guard checks

`decideRecovery` in `domain.ts` gets the failed record's position, its evidence hash,
and the boundary already in force. It never reads the bad record's payload.

1. **Which order?** It looks for the outbox row published at the failed record's
   position. If more than one row recorded that position (for example, the topic was
   re-created while the outbox was kept, so offsets started again): **hold**. For a
   record the application did not publish, fixture mode can read the record's key back
   from the timeline. An order ID names one order per tenant, so the
   guard considers that order in every tenant that has it. A missing key, a key that is
   not an order ID, an order that does not exist, or (in Kafka mode, which does not read
   the topic back) any record the outbox did not publish: **hold**.
2. **Will snapshots supersede it?** Only if every affected order has a published outbox
   row later in the same stream: the same partition, or later in the fixture timeline.
   That row is the **re-publish**. For a record the application did not publish, an order
   still at its seed revision **never changed state** and also qualifies. Anything else:
   **hold**, with a reason naming the order and the outbox row.
3. **Recoverable** returns `context: { watermark }`, the newest re-publish's sequence,
   at least the failed row's sequence and the prior boundary's watermark, so a
   superseding boundary carries the old obligation forward. `evidenceRef` names the outbox rows it relied on.

Every snapshot handler then calls `acknowledgeRecovery(recovery, watermark)`. It echoes
`recovery.boundaryId` only when the read it served is at or past the boundary's
watermark. Without the echo the gateway keeps the subscription stale and retries, so no
subscriber reaches live on a state older than the re-publish. That includes subscribers
who arrive after the advance and anyone reconnecting.

### Why a guard that always says "recoverable" is wrong

Moving past a record tells the gateway that every future snapshot already reflects
whatever that record carried. If that isn't true, a subscriber resynchronizes, reaches
`live`, and keeps showing an order without the skipped change. Nothing downstream flags
it, because the stream has moved on. A constant `recoverable` (or a snapshot that echoes
every boundary ID it is given) turns the barrier into a silent skip, the exact thing
`quarantine-resync` exists to prevent. The guard has to prove from the application's own
records that the change reaches snapshots another way. When it can't, holding is the
correct answer: the record waits for a re-publish and an operator's **reassess**.

### Trying it

- **Fixture mode** (`pnpm example`). The demo timeline has no bad records, and records
  can only be added in code. `tests/integration/reference-guard.test.ts` builds timelines
  with `createFixtureApplication` and runs the cases: re-published, not re-published,
  later subscribers, unusable keys, and never-changed orders. The read model only learns
  a re-publish when the gateway reads it. So after an advance, subscribers stay stale
  until you advance the fixture through the re-publish. After three failed attempts a
  subscription reports *resync required*; use **Reconnect**.
- **Kafka mode** (`pnpm --filter order-dashboard dev:kafka-resync`, with the local broker).
  The app server also creates `orders.status.quarantine`. Sign in as Alice, then rehearse
  a broken serializer: the change is committed, but truncated bytes are published.

  ```bash
  TOKEN=$(curl -s -X POST localhost:3000/api/session -H 'content-type: application/json' -d '{"user":"alice"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
  curl -s -X POST localhost:3000/api/orders/ord_1001/advance -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"rehearse":"invalid-json"}'
  ```

  The guard holds: the order has not been re-published. Re-publish it, then reassess the
  incident from the workbench's Failures tab:

  ```bash
  curl -s -X POST localhost:3000/api/orders/ord_1001/republish -H "authorization: Bearer $TOKEN"
  ```

  The guard now finds the re-publish and the source advances. The store already holds
  the change, so snapshots acknowledge at once. `tests/kafka/12-reference-guard.test.ts`
  runs this flow against the broker (it needs `pnpm build` first).

In production, a quarantine policy also needs a state directory (`--state-dir`, after
`streamotter init --failures`) and a quarantine topic that your platform provisions.
The boundary retirement mode here is the default, `generation`: once a boundary is
installed, every snapshot keeps acknowledging it until the source's generation
changes. These handlers satisfy that indefinitely, because the watermark only grows.
