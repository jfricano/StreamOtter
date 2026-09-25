# Getting started

Build a web page that shows a job's progress live, served by a local StreamOtter gateway. It uses built-in fixture data, so you don't need Kafka. It takes about ten minutes.

You need Node.js 24 or later, npm, and a current browser.

## 1. Create a project and install

```bash
mkdir live-jobs && cd live-jobs
npm init -y
npm install @streamotter/cli @streamotter/client
npm install --save-dev vite
```

[`@streamotter/cli`](https://www.npmjs.com/package/@streamotter/cli) brings the `streamotter` command, the gateway, and the local workbench. [`@streamotter/client`](https://www.npmjs.com/package/@streamotter/client) is the browser SDK. [Vite](https://vite.dev) serves the page; any bundler works.

## 2. Scaffold a StreamOtter project

```bash
npx streamotter init .
```

| File | What it is |
| --- | --- |
| `streamotter.json` | The configuration: a `jobs` fixture source, two JSON schemas, and a `jobProgress` channel whose parameter is `jobId` |
| `server/handlers.mjs` | Your trusted server code: `authenticate`, `authorize`, `map`, and `snapshot`. Its `development` export has a `developer` principal and four fixture records. |
| `web/example.ts` | A function that subscribes to one job and renders it |
| `README.md` | A short version of these steps |

`init` refuses to overwrite existing files, so run it in a new folder or a subfolder.

## 3. Run the development gateway

```bash
npx streamotter dev --config streamotter.json --handlers server/handlers.mjs
```

Leave it running. It prints where everything is:

```text
StreamOtter development gateway
  Gateway      http://127.0.0.1:7400  (Socket.IO path /streamotter/socket.io)
  Workbench    http://127.0.0.1:7401/
  Management   http://127.0.0.1:7401/management/v1  (local only)
  Token        <one-time token>
  …
  Sources      jobs (fixture, healthy)
  Principals   developer
```

## 4. Look around in the workbench

Open `http://127.0.0.1:7401/` and paste the token.

1. **Preview:** start a preview session as `developer`, then subscribe to `jobProgress` with `{"jobId": "job_1"}`. The subscription goes `authorizing → synchronizing → live` and shows the snapshot, `queued — 0 %` at revision 1.
2. **Connect:** advance the `jobs` fixture one record at a time. Each record is a full new state with a higher revision (25 %, 60 %, 90 %, then 100 %), and the preview shows it immediately.
3. **Inspect:** follow each record through `validate → map → queue → send → receipt → commit`.

The workbench previews as a development principal, without your own login. To see a real page, continue below.

## 5. Generate typed channels

```bash
npx streamotter generate --config streamotter.json --out generated
```

`generated/streamotter.generated.ts` now declares `AppChannels`, the `JobParams` and `JobProgress` types, and `channelVersions`. `web/example.ts` imports them.

## 6. Let your page sign in (development only)

The gateway never trusts the browser to say who it is. It passes the page's token to your `authenticate` handler, which returns a *principal* (subject, tenant, session, expiry) or `null`. The scaffold rejects every application token until you write that check. For this tutorial, accept one fixed local token. In `server/handlers.mjs`, replace the body of `authenticate`:

```js
  async authenticate({ token }) {
    // Development only: accept one fixed local token. Replace this with your real session check.
    if (token === "local-dev-token") {
      return { subject: "developer", tenantId: "local", sessionId: "local-session", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} };
    }
    return null;
  },
```

The tenant is `local` because the scaffold's data lives in that tenant. Handlers load at startup, so stop `dev` (Ctrl+C) and start it again.

## 7. Build the page

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Live jobs</title>
    <style>#job::after { content: "  · " attr(data-delivery); color: gray; }</style>
  </head>
  <body>
    <h1>Job job_1</h1>
    <p id="job">Connecting…</p>
    <script type="module" src="/web/main.ts"></script>
  </body>
</html>
```

and `web/main.ts`:

```ts
import { watchJob } from "./example.ts";

const element = document.getElementById("job")!;
void watchJob("job_1", async () => "local-dev-token", element);
```

`watchJob` in `web/example.ts` is the whole integration:

```ts
const client = createClient<AppChannels>({ origin: "http://localhost:7400", getToken: () => getToken() });
const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
job.on("data", ({ data, revision }) => { element.textContent = `${data.state} — ${data.percent}% (revision ${revision})`; });
job.on("state", ({ state }) => { element.dataset["delivery"] = state; });
job.on("error", error => console.warn(`[${error.code}] ${error.message}`));
```

Start the page:

```bash
npx vite
```

Open `http://localhost:5173`. It shows **queued — 0% (revision 1) · live**.

The gateway accepts this page because `streamotter.json` lists `http://localhost:5173` in `gateway.allowedOrigins`. A page served from any other origin is refused with `FORBIDDEN`. Add its exact origin there and restart `dev`.

## 8. Watch it change

- **Updates:** advance the `jobs` fixture in the workbench's Connect tab. The page moves to 25 %, 60 %, … right away. Each update replaces the whole state; nothing is merged.
- **Stale, never silently wrong:** stop `dev`. The page keeps the last data but its state turns `stale`, so the page can show that it may be out of date. Start `dev` again: the page reconnects and asks for a fresh snapshot.
- **After a restart, reload the page.** The fixture source and the scaffold's in-memory data start over at revision 1. The SDK never accepts an older revision than it has shown, so an open page ends in `resync-required`, and reloading it starts fresh. Real data, whose revisions keep increasing, doesn't have this problem.

To advance fixtures from a script instead of the workbench, call the development management API with the token that `dev` printed:

```bash
curl -X POST http://127.0.0.1:7401/management/v1/dev/fixtures/advance -H "authorization: Bearer <token>" -H "content-type: application/json" -d '{"sourceId": "jobs", "count": 1}'
```

## How the pieces fit

```text
 browser page ──(Socket.IO, your token)──▶ StreamOtter gateway ◀── source: fixture now, Kafka later
 @streamotter/client                        your handlers decide:
   subscribe, render data,                    authenticate: who is this?
   show live / stale                          authorize:    may they see this job?
                                              snapshot:     what is its state right now?
                                              map:          which view does a new record update?
```

A subscription always starts with an authoritative snapshot from your `snapshot` handler. Updates that arrive while the snapshot is loading are held and applied by revision, and the view is `live` only once it has caught up. Anything that could make it wrong, such as a disconnect, a source outage, or a slow client, turns it `stale` until it has resynchronized.

## Next

- [Add live state to an existing app](./existing-app.md): real sessions, your database, Kafka events, and React.
- [Connect to Kafka](./kafka.md): replace the fixture with a topic, over TLS and SASL.
- [Run in production](../DEPLOYMENT.md): `streamotter start`, one gateway, and a reverse proxy.
- [Troubleshooting](./troubleshooting.md).
- Package guides: [client](https://www.npmjs.com/package/@streamotter/client), [gateway](https://www.npmjs.com/package/@streamotter/gateway), [CLI](https://www.npmjs.com/package/@streamotter/cli).
