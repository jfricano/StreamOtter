import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { createClient, type Client } from "@streamotter/client";
import type { HandlerRegistry, ProjectConfig } from "@streamotter/contracts";
import { silentLogger, type Gateway } from "@streamotter/gateway";
import { createGatewayRuntime, getGatewayInternals, type GatewayInternals, type IncidentRecord, type IncidentStore } from "@streamotter/gateway/internals";
import { getGatewayOperator } from "@streamotter/gateway/operator";
import type { AppChannels } from "../../examples/order-dashboard/src/generated/streamotter.generated.ts";
import { issueToken } from "../../examples/order-dashboard/src/server/domain.ts";
import { observe, sleep, waitFor } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, createTopic, PLAINTEXT, produceRaw, ROOT, uniqueName } from "./helpers.ts";

/**
 * ADR-15B §5 against a real broker: the order-dashboard application server in
 * Kafka mode (its compiled app.js) owns the store and the outbox and records
 * where the broker stored each row; the gateway runs the example's
 * kafka-resync-handlers with streamotter.kafka-resync.json. A rehearsed broken
 * publish is held until the application re-publishes the order, then an
 * operator reassess advances it under a boundary at the re-publish's outbox
 * row. Expected outbox rows come from the test's own model of the application:
 * the first run publishes the seeded orders as rows 1–4, and every advance or
 * re-publish adds one row.
 */

const EXAMPLE = resolve(ROOT, "examples/order-dashboard");
const APP = resolve(EXAMPLE, "dist/server/app.js");
const available = await brokerAvailable();
const skip = !available ? "local Kafka is not running" : !existsSync(APP) ? "run pnpm build first" : false;
const SEEDED_ROWS = 4;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

interface Running {
  app: ChildProcess;
  appOrigin: string;
  gateway: Gateway;
  origin: string;
  internals: GatewayInternals;
  topic: string;
  clients: Client<AppChannels>[];
}

async function start(): Promise<Running> {
  const topic = await createTopic(3);
  const quarantine = await createTopic(1, [{ name: "max.message.bytes", value: String(2 * 1024 * 1024) }]);
  const data = await mkdtemp(join(tmpdir(), "so-reference-guard-"));
  const port = await freePort();
  const appOrigin = `http://127.0.0.1:${port}`;
  const app = spawn(process.execPath, ["--disable-warning=TimeoutNegativeWarning", APP, "--kafka"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ORDER_TOPIC: topic, ORDER_DATA_FILE: join(data, "orders.json"), ORDER_KAFKA_BROKERS: PLAINTEXT.join(",") },
    stdio: "pipe"
  });
  let output = "";
  app.stdout?.on("data", chunk => { output += chunk; });
  app.stderr?.on("data", chunk => { output += chunk; });
  await waitFor(() => output.includes("Order dashboard (Kafka mode)") || app.exitCode !== null, 60_000, "application server");
  assert.equal(app.exitCode, null, output);

  // The handlers read the application's internal origin when they load.
  process.env["ORDER_APP_INTERNAL_ORIGIN"] = appOrigin;
  const { handlers } = await import("../../examples/order-dashboard/src/server/kafka-resync-handlers.ts") as { handlers: HandlerRegistry<AppChannels> };
  const base = JSON.parse(await readFile(resolve(EXAMPLE, "streamotter.kafka-resync.json"), "utf8")) as ProjectConfig<AppChannels>;
  const orders = base.sources["orders"];
  assert.ok(orders?.kind === "kafka" && base.failureHandling?.quarantine !== undefined);
  const config: ProjectConfig<AppChannels> = {
    ...base,
    gateway: { ...base.gateway, port: 0 },
    connections: { local: { brokers: PLAINTEXT, tls: false } },
    sources: { orders: { ...orders, topics: [topic], consumerGroup: uniqueName("so-reference-guard") } },
    failureHandling: { ...base.failureHandling, quarantine: { ...base.failureHandling.quarantine, topic: quarantine } }
  };
  const gateway = createGatewayRuntime<AppChannels>({ config, handlers, mode: "development", development: { principals: {}, fixtures: {} }, logger: silentLogger }).gateway;
  const { origin } = await gateway.start();
  return { app, appOrigin, gateway, origin, internals: getGatewayInternals(gateway), topic, clients: [] };
}

async function api(run: Running, user: string, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${run.appOrigin}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${issueToken(user)!.token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function incident(run: Running, done: (incident: IncidentRecord) => boolean, timeoutMs = 20_000): Promise<IncidentRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await run.internals.failuresSettled();
    const found = (run.internals.incidentStore() as IncidentStore).list({ state: "all" }).items.find(done);
    if (found !== undefined) return found;
    if (Date.now() > deadline) assert.fail("no incident reached the expected state");
    await sleep(100);
  }
}

describe("order-dashboard reference recovery guard against Kafka (ADR-15B §5)", { skip }, () => {
  let run: Running | undefined;
  afterEach(async () => {
    if (run === undefined) return;
    await Promise.all(run.clients.map(client => client.close()));
    await run.gateway.stop({ timeoutMs: 5_000 });
    run.app.kill("SIGTERM");
    run = undefined;
  });
  after(() => closeKafkaHelpers());

  it("holds a broken publish until the application re-publishes the order, then advances on reassess at the re-publish's watermark", async () => {
    run = await start();
    await waitFor(() => run!.internals.sources()[0]?.status === "healthy", 30_000, "source healthy");
    const client = createClient<AppChannels>({ origin: run.origin, getToken: () => issueToken("alice")!.token });
    run.clients.push(client);
    const seen = observe(client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1001" } }));
    await waitFor(() => seen.states.includes("live"), 15_000, "live");
    let nextRow = SEEDED_ROWS + 1;

    // A broken serializer, rehearsed: the change is committed as an outbox row, the bytes on the topic are truncated.
    const rehearsed = await api(run, "alice", "/api/orders/ord_1001/advance", { rehearse: "invalid-json" });
    assert.equal(rehearsed.status, 200);
    assert.equal(rehearsed.body["outboxSeq"], nextRow);
    const failedRow = nextRow++;
    const held = await incident(run, item => item.guard !== null);
    assert.equal(held.failureClass, "invalid-json");
    assert.equal(held.quarantine, "acknowledged");
    assert.equal(held.guard?.decision, "hold");
    assert.equal(held.recovery, "denied");
    assert.equal(held.progress, "held");
    const where = held.position.kind === "kafka" ? `${held.position.topic}[${held.position.partition}]@${held.position.offset}` : "";
    assert.equal(held.position.kind === "kafka" && held.position.topic, run.topic);
    assert.equal(held.guard?.reason, `Order acme/ord_1001 has not been re-published after the record at ${where} (outbox row ${failedRow}). Re-publish it, then reassess.`);
    await waitFor(() => seen.states.at(-1) === "stale", 10_000, "stale while the source is held");

    // The application re-publishes the order; an operator reassesses the held record.
    const republished = await api(run, "alice", "/api/orders/ord_1001/republish");
    assert.equal(republished.status, 200);
    assert.equal(republished.body["outboxSeq"], nextRow);
    const republishRow = nextRow++;
    const current = (run.internals.incidentStore() as IncidentStore).list({ state: "all" }).items.find(item => item.failureId === held.failureId)!;
    const result = await getGatewayOperator(run.gateway).reassess({ sourceId: "orders", failureId: held.failureId, expectedRevision: current.revision });
    assert.equal(result.result, "completed", result.message);
    assert.equal(result.outcome, "advanced", result.message);
    const advanced = await incident(run, item => item.failureId === held.failureId && item.progress === "advanced");
    assert.equal(advanced.guard?.decision, "recoverable");
    assert.equal(advanced.guard?.evidenceRef, `outbox: row ${failedRow} failed at ${where}; acme/ord_1001 re-published as outbox row ${republishRow}`);
    const boundary = (run.internals.incidentStore() as IncidentStore).boundary("orders");
    assert.equal(boundary?.boundaryId, advanced.boundaryId);
    assert.deepEqual(boundary?.context, { watermark: republishRow });

    // The application's store already holds the change, so the resynchronizing snapshot acknowledges and goes live on it.
    await waitFor(() => seen.states.at(-1) === "live", 15_000, "live after the advance");
    const last = seen.events.at(-1);
    assert.equal(last?.revision, "2");
    assert.equal((last?.data as { status: string }).status, "picking");
    assert.ok(run.internals.traces({ limit: 500 }).items.some(trace => trace.stage === "snapshot" && trace.outcome === "ok"));

    // A record the application never published: Kafka mode does not read keys back, so the guard holds it.
    await produceRaw(run.topic, [{ key: Buffer.from("ord_1002"), value: Buffer.from("{oops") }]);
    const foreign = await incident(run, item => item.failureId !== held.failureId && item.guard !== null);
    assert.equal(foreign.guard?.decision, "hold");
    assert.equal(foreign.recovery, "denied");
    assert.match(foreign.guard?.reason ?? "", /^No outbox row was published at .+, and this deployment cannot read the record's key, so the affected order is unknown\.$/);
    assert.equal((run.internals.incidentStore() as IncidentStore).boundary("orders")?.boundaryId, boundary?.boundaryId, "a hold installs nothing");
  });
});
