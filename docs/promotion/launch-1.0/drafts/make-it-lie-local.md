# "Can you make it lie?": local tier (a), no Kafka

**Verified on 2026-10-05** with `streamotter@0.2.0-rc.1` and Node 24.21, in a clean folder. Re-run it on `1.0.0-rc.1` and `1.0.0` before publishing. It needs Node 24.15 or later, because failure handling requires it.

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

Then:

```bash
npx streamotter validate --config streamotter.json
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs
```

Open the workbench, preview `jobProgress`, and advance the fixture one record at a time. To script it, call the development management API with the token `dev` prints:

```bash
TOKEN=<token from dev>
curl -s -X POST http://127.0.0.1:7401/management/v1/dev/fixtures/advance -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -d '{"sourceId": "jobs", "count": 1}'
curl -s "http://127.0.0.1:7401/management/v1/failures?state=open" -H "authorization: Bearer $TOKEN"
curl -s http://127.0.0.1:7401/management/v1/operator/status -H "authorization: Bearer $TOKEN"
```

What the run showed through the management API and the gateway log (the browser view wasn't checked in this run):
- After the malformed record, the gateway logged "Source paused on an unprocessable record; it will not be committed or skipped" (`failureClass: invalid-json`). Then came the incident events `detected` → `captured` (local evidence) → `quarantined` ("stored as local fixture evidence, not Kafka").
- The advance that reached it moved nothing (`advanced: 0`), and later advances were refused with `SOURCE_UNAVAILABLE` while the source was paused, so the records after it weren't delivered.
- The incident read `policy: quarantine-hold`, `quarantine: acknowledged`, `progress: held` and `nextAction: repair-and-retry`, with a hash of the 9-byte value as evidence. The operator status showed the source as `paused`, with one held incident.

The challenge from here: make the previewed view report `live` while it's missing revision 4 or 5, or get the record skipped silently. The way back is to correct the record. A fixture's records come from `server/handlers.mjs`, which loads at startup, so a `retry-current` of the unchanged record pauses again: fix the record in the file and restart `dev`. With `--state-dir` (after `npx streamotter init --failures --config streamotter.json --state-dir <directory>`) the incident survives the restart, and when the corrected record at the same position processes it resolves as "a corrected record at the same position processed", keeping the original evidence. Re-check this against the release being published: it depends on a fix after `0.2.0-rc.1`.

The incident store is in memory here; the log warns that setting `stateDirectory` would keep it across restarts. That's fine for a two-minute rehearsal.
