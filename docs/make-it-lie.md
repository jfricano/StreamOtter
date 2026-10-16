# Can you make it lie?

StreamOtter makes two promises: a view never reports `live` while it shows anything other than the newest state, and a bad record is never skipped silently. This page sets up a gateway that holds at a malformed record, on your own machine, with no Kafka. Then it's your turn to break it.

It takes about two minutes and needs Node.js 24.15 or later, because failure handling requires it.

## Set it up

```bash
mkdir make-it-lie && cd make-it-lie
npm init -y
npm install streamotter
npx streamotter init .
```

Make two edits to the scaffold:

1. In `streamotter.json`, add a top-level section. A fixture source needs no quarantine topic.

   ```json
   "failureHandling": { "sources": { "jobs": { "invalidJson": "quarantine-hold" } } }
   ```

2. In `server/handlers.mjs`, add one malformed record to `development.fixtures.jobs`, after the revision "3" record:

   ```js
   { key: "job_1", raw: "{not json" },
   ```

Create a local failure journal, so the incident survives a restart, then start the gateway with it. `validate` may say the file isn't in canonical form after your edit; that's only key order and changes nothing.

```bash
npx streamotter init --failures --config streamotter.json --state-dir ./state
npx streamotter validate --config streamotter.json
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs --state-dir ./state --operator-socket
```

Open the workbench (the address and token are in the banner), preview `jobProgress`, and advance the `jobs` fixture one record at a time in the Connect tab. Or, from a second terminal, with the token `dev` printed:

```bash
curl -X POST http://127.0.0.1:7401/management/v1/dev/fixtures/advance -H "authorization: Bearer <token>" -H "content-type: application/json" -d '{"sourceId": "jobs", "count": 1}'
```

## What happens at the malformed record

- The advance that reaches it returns `advanced: 0`, and the gateway logs "Source paused on an unprocessable record; it will not be committed or skipped" (`failureClass: invalid-json`). Further advances are refused while the source is paused, so revisions 4 and 5 are never delivered.
- The preview stays `stale`. It never reports `live` while revisions are missing.
- In a second terminal, `npx streamotter status --state-dir ./state` shows the `jobs` source paused with one open incident, and `npx streamotter failures list --state-dir ./state` shows the incident: `invalid-json`, `held`, next action `repair-and-retry`. The workbench Failures tab shows the same incident.

## The challenge

Make the previewed view report `live` while it's missing revision 4 or 5, or get the record skipped without an incident. If you manage either, please [open an issue](https://github.com/jfricano/StreamOtter/issues/new) with the steps. Security problems go privately through [SECURITY.md](../SECURITY.md).

## The way back

Stop `dev` (Ctrl+C), delete the malformed line from `server/handlers.mjs`, and start `dev` again with the same command. Fixture records are read at startup, so the corrected file takes effect on restart, and the journal still remembers the incident. Reload the page, because the scaffold's in-memory data starts over.

Advance four times. Revisions 2 and 3 are delivered again (the fixture starts over), then 4 and 5 arrive, and `npx streamotter failures list --state-dir ./state --state all` shows the incident `resolved`. Its history records that a corrected record at the same position processed, and the original record's evidence is kept.

Notes:

- `sources retry-current` doesn't help here: it re-reads the same bytes and holds again. It's for causes outside the record, such as a mapper bug fixed in a redeploy, or a recovery guard's decision.
- To start over completely, stop `dev` and delete `./state`.

## Go further

- **With real Kafka:** `npm run dev:lab` in [Lontra Creek](https://github.com/jfricano/lontra-creek), the source of the streamotter.dev demo, runs the Failure Lab on your machine with Docker, including the source-failure exercises.
- **How it works:** [Handle bad records](./guides/source-failures.md) covers the failure policies, quarantine, recovery guards and the operator runbook.
