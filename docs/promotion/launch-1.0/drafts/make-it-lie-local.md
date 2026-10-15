# "Can you make it lie?": local tier (a), no Kafka

**Verified on 2026-10-15** with `streamotter@0.2.0-rc.1` and Node 24.22 in a clean container. Incidents are kept in a local journal, so they survive the restart that the recovery needs. Re-run it on `1.0.0-rc.1` and `1.0.0` before publishing. It needs Node 24.15 or later, because failure handling requires it.

```bash
mkdir make-it-lie && cd make-it-lie
npm init -y
npm install streamotter
npx streamotter init .
```

Two edits to the scaffold:

1. `streamotter.json`: add a top-level section. A fixture source needs no quarantine topic.

```json
"failureHandling": { "sources": { "jobs": { "invalidJson": "quarantine-hold" } } }
```

2. `server/handlers.mjs`: in `development.fixtures.jobs`, add one malformed record after the revision "3" record:

```js
{ key: "job_1", raw: "{not json" },
```

Create a local failure journal, so the incident survives a restart, then start the gateway with it:

```bash
npx streamotter init --failures --config streamotter.json --state-dir ./state
npx streamotter validate --config streamotter.json
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs --state-dir ./state --operator-socket
```

Open the workbench (the address and token are in the banner), preview `jobProgress`, and advance the `jobs` fixture one record at a time in the Connect tab. Or, from a second terminal, with the token `dev` printed:

```bash
curl -X POST http://127.0.0.1:7401/management/v1/dev/fixtures/advance -H "authorization: Bearer <token>" -H "content-type: application/json" -d '{"sourceId": "jobs", "count": 1}'
```

What happens at the malformed record:
- The advance that reaches it returns `advanced: 0`, and the gateway logs "Source paused on an unprocessable record; it will not be committed or skipped" (`failureClass: invalid-json`). Further advances are refused while the source is paused, so revisions 4 and 5 are never delivered.
- The preview stays `stale`; it never reports `live` while revisions are missing.
- In a second terminal, `npx streamotter status --state-dir ./state` shows `jobs paused (INVALID_PAYLOAD), 1 open incident`, and `npx streamotter failures list --state-dir ./state` shows the incident: `invalid-json`, `held`, next `repair-and-retry`. The workbench Failures tab shows the same incident.

The challenge from here: make the previewed view report `live` while it's missing revision 4 or 5, or get the record skipped silently.

The way back: stop `dev` (Ctrl+C), delete the malformed line from `server/handlers.mjs`, and start `dev` again with the same command. Fixture records are read at startup, so the corrected file takes effect on restart, and the journal still remembers the incident. Advance again: revisions 4 and 5 arrive, and `npx streamotter failures list --state-dir ./state --state all` shows the incident `resolved`, `processed`. Reload the page after the restart (the scaffold's in-memory data starts over).

Notes:
- On `0.2.0-rc.1` the resolved incident's history says "the original record processed successfully". The next release says "a corrected record at the same position processed" and keeps the original evidence; quote whatever the published release prints.
- `retry-current` doesn't help here: it re-reads the same in-memory bytes and holds again. It's for causes outside the record, such as a mapper bug fixed in a redeploy or a guard decision.
- To start over completely, stop `dev` and delete `./state`.
