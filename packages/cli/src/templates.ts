import { streamotterModules, type PackageStyle } from "./generate.ts";

/** Files created by `streamotter init`. The scaffold is fixture-only and has no production credentials. */
export function scaffoldFiles(projectId: string, options: { packages?: PackageStyle } = {}): { path: string; content: string }[] {
  const modules = streamotterModules(options.packages);
  const config = {
    configVersion: 1,
    projectId,
    gateway: { host: "127.0.0.1", port: 7400, path: "/streamotter/socket.io", allowedOrigins: ["http://localhost:5173"] },
    connections: {},
    sources: { jobs: { kind: "fixture", generation: "jobs-fixture-1", fixtureRef: "jobs" } },
    schemas: {
      JobParams: {
        type: "object", additionalProperties: false, required: ["jobId"],
        properties: { jobId: { type: "string", minLength: 1, maxLength: 64 } }
      },
      JobProgress: {
        type: "object", additionalProperties: false, required: ["jobId", "state", "percent"],
        properties: {
          jobId: { type: "string", minLength: 1, maxLength: 64 },
          state: { type: "string", enum: ["queued", "running", "succeeded", "failed"] },
          percent: { type: "integer", minimum: 0, maximum: 100 }
        }
      }
    },
    channels: {
      jobProgress: {
        version: 1, source: "jobs", paramsSchema: "JobParams", payloadSchema: "JobProgress",
        handlersRef: "jobProgress", delivery: { kind: "state", overflow: "resync" }
      }
    }
  };

  const handlers = `// @ts-check
/**
 * Trusted server handlers for StreamOtter, loaded by:
 *   streamotter dev --config streamotter.json --handlers server/handlers.mjs
 *
 * StreamOtter loads compiled JavaScript. If you write handlers in TypeScript,
 * compile them first and point --handlers at the output.
 */

/**
 * Development read model. Replace it with your application's authoritative store.
 * Snapshots and mapped records must describe the same revision progression.
 * @type {Map<string, { revision: string; data: { jobId: string; state: string; percent: number } }>}
 */
const jobs = new Map([
  ["local/job_1", { revision: "1", data: { jobId: "job_1", state: "queued", percent: 0 } }]
]);

/** @type {import("${modules.gateway}").HandlerRegistry<any>} */
export const handlers = {
  async authenticate({ token }) {
    // TODO: verify your application's session token and return its Principal
    // ({ subject, tenantId, sessionId, expiresAt, claims }), or null to reject it.
    // Workbench previews use short-lived preview tokens resolved by the gateway itself,
    // so this scaffold intentionally accepts no application tokens yet.
    void token;
    return null;
  },
  channels: {
    jobProgress: {
      async authorize({ principal, params }) {
        return jobs.has(\`\${principal.tenantId}/\${params.jobId}\`);
      },
      map({ record }) {
        const value = /** @type {{ tenantId: string; revision: string; job: { jobId: string; state: string; percent: number } }} */ (record.value);
        // Development only: keep the in-memory read model in step with the fixture stream.
        const key = \`\${value.tenantId}/\${value.job.jobId}\`;
        const current = jobs.get(key);
        if (current === undefined || BigInt(value.revision) > BigInt(current.revision)) {
          jobs.set(key, { revision: value.revision, data: value.job });
        }
        return [{ tenantId: value.tenantId, params: { jobId: value.job.jobId }, revision: value.revision, data: value.job }];
      },
      async snapshot({ principal, params }) {
        const job = jobs.get(\`\${principal.tenantId}/\${params.jobId}\`);
        if (job === undefined) throw new Error("Unknown job");
        return { revision: job.revision, data: job.data };
      }
    }
  }
};

/** Development-only principals and fixture records. Never used by \`streamotter start\`. */
export const development = {
  principals: {
    developer: { subject: "developer", tenantId: "local", sessionId: "dev-session", expiresAt: "2099-01-01T00:00:00.000Z", claims: {} }
  },
  fixtures: {
    jobs: [
      { key: "job_1", value: { tenantId: "local", revision: "2", job: { jobId: "job_1", state: "running", percent: 25 } } },
      { key: "job_1", value: { tenantId: "local", revision: "3", job: { jobId: "job_1", state: "running", percent: 60 } } },
      { key: "job_1", value: { tenantId: "local", revision: "4", job: { jobId: "job_1", state: "running", percent: 90 } } },
      { key: "job_1", value: { tenantId: "local", revision: "5", job: { jobId: "job_1", state: "succeeded", percent: 100 } } }
    ]
  }
};
`;

  const example = `import { createClient } from "${modules.client}";
import { channelVersions, type AppChannels } from "../generated/streamotter.generated.js";

/**
 * Renders one job's live progress. Run \`streamotter generate --config streamotter.json --out generated\`
 * first. getToken must return your application's session token (or, during local development,
 * a preview token from the workbench).
 */
export async function watchJob(jobId: string, getToken: () => Promise<string>, element: HTMLElement): Promise<() => Promise<void>> {
  const client = createClient<AppChannels>({ origin: "http://localhost:7400", getToken: () => getToken() });
  const job = client.subscribe("jobProgress", { channelVersion: channelVersions.jobProgress, params: { jobId } });
  job.on("data", ({ data, revision }) => {
    element.textContent = \`\${data.state} — \${data.percent}% (revision \${revision})\`;
  });
  job.on("state", ({ state }) => {
    element.dataset["delivery"] = state; // "live" means synchronized; anything else may be stale.
  });
  job.on("error", error => console.warn(\`[\${error.code}] \${error.message}\`));
  await job.ready();
  return async () => {
    await job.unsubscribe();
    await client.close();
  };
}
`;

  const readme = `# ${projectId}

A StreamOtter V1 project created by \`streamotter init\`. It uses a deterministic fixture source,
so no Kafka broker is needed to start.

## Run locally

\`\`\`bash
streamotter validate --config streamotter.json
streamotter dev --config streamotter.json --handlers server/handlers.mjs
\`\`\`

\`dev\` prints the workbench URL and a one-time management token. In the workbench, create a
preview session for the \`developer\` principal, subscribe to \`jobProgress\` with \`{"jobId": "job_1"}\`,
and advance the \`jobs\` fixture to watch revisions arrive.

## Integrate

\`\`\`bash
streamotter generate --config streamotter.json --out generated
\`\`\`

\`generated/streamotter.generated.ts\` contains \`AppChannels\`; \`web/example.ts\` shows a subscription
with cleanup and error handling.

## Before production

- Implement \`authenticate\` in \`server/handlers.mjs\` with your real session verification.
- Replace the in-memory read model with your authoritative store.
- Replace the fixture source with a Kafka source using TLS; \`streamotter start\` rejects fixtures and plaintext Kafka.
`;

  return [
    { path: "streamotter.json", content: `${JSON.stringify(config, null, 2)}\n` },
    { path: "server/handlers.mjs", content: handlers },
    { path: "web/example.ts", content: example },
    { path: "README.md", content: readme }
  ];
}
