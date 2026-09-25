import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { createClient, type Client } from "@streamotter/client";
import type { Json } from "@streamotter/contracts";
import { compareRevisions } from "@streamotter/contracts";
import { observe, OrderApp, sleep, waitFor, type TestChannels } from "../integration/harness.ts";
import { brokerAvailable, closeKafkaHelpers, committedOffsets, createTopic, orderValue, produce, startKafkaHarness, uniqueName, waitForEmptyGroup, type KafkaHarness } from "./helpers.ts";

const available = await brokerAvailable();

describe("crash after admission but before commit", { skip: available ? false : "local Kafka is not running" }, () => {
  after(() => closeKafkaHelpers());

  it("redelivers the uncommitted record after a restart without regressing displayed state", { timeout: 150_000 }, async () => {
    const topic = await createTopic(1);
    const group = uniqueName("so-crash");
    const child = fork(resolve(import.meta.dirname, "crash-child.ts"), [], {
      execArgv: ["--conditions=streamotter-source", "--no-warnings"],
      env: { ...process.env, TOPIC: topic, GROUP: group, CRASH_REVISION: "5" },
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    });
    const messages: { type: string; origin?: string; recordId?: string }[] = [];
    child.on("message", message => messages.push(message as { type: string }));
    let client: Client<TestChannels> | undefined;
    let restarted: KafkaHarness | undefined;
    try {
      await waitFor(() => messages.some(message => message.type === "ready"), 30_000, "child gateway ready");
      const origin = messages.find(message => message.type === "ready")!.origin!;

      client = createClient<TestChannels>({ origin, getToken: () => "alice@acme" });
      const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
      const seen = observe(sub);
      await sub.ready();
      await produce(topic, [2, 3, 4, 5].map(revision => ({ key: "ord_1", value: orderValue("acme", "ord_1", revision, "processing", revision * 10) })));
      await waitFor(() => messages.some(message => message.type === "admitted-not-committed"), 20_000, "admission of revision 5");
      await waitFor(() => seen.events.at(-1)?.revision === "5", 10_000, "revision 5 displayed");
      const crashedRecordId = messages.find(message => message.type === "admitted-not-committed")!.recordId;

      child.kill("SIGKILL");
      await new Promise(resolveExit => child.once("exit", resolveExit));
      assert.equal((await committedOffsets(group, topic))[0], "3", "revisions 2–4 committed; revision 5 (offset 3) was not");
      await waitFor(() => sub.state !== "live", 5_000, "view marked stale after the crash");

      // The dead member holds its partitions until its 30-second session expires. Wait for that before
      // restarting, so the replacement's 30-second startup deadline does not race the expiry.
      await waitForEmptyGroup(group, 45_000);

      // Restart on the same port and consumer group. The application's store already has revision 5.
      const app = new OrderApp();
      app.put("acme", "alice", "ord_1", 5, "processing", 50);
      const redelivered: string[] = [];
      app.mapOverride = (value: Json) => {
        const record = value as { tenantId: string; revision: string; order: { orderId: string } };
        redelivered.push(record.revision);
        return [{ tenantId: record.tenantId, params: { orderId: record.order.orderId }, revision: record.revision, data: record.order }];
      };
      const port = Number(new URL(origin).port);
      restarted = await startKafkaHarness({ topic, group, port, app });
      await client.reconnect({ timeoutMs: 60_000 });
      await sub.ready({ timeoutMs: 60_000 });
      await waitFor(() => redelivered.length >= 1, 60_000, "redelivery of the uncommitted record");
      assert.deepEqual(redelivered, ["5"], "only the uncommitted record is redelivered");
      let offsetsAfter: Record<number, string> = {};
      for (let i = 0; i < 50 && offsetsAfter[0] !== "4"; i++) {
        offsetsAfter = await committedOffsets(group, topic);
        await sleep(100);
      }
      assert.equal(offsetsAfter[0], "4", "the redelivered record is committed by the new gateway");

      const revisions = seen.events.map(event => event.revision);
      for (let i = 1; i < revisions.length; i++) {
        assert.ok(compareRevisions(revisions[i]!, revisions[i - 1]!) >= 0, `displayed state regressed: ${revisions.join(",")}`);
      }
      assert.deepEqual(revisions, ["1", "2", "3", "4", "5", "5"], "the restart resynchronized with a snapshot; the duplicate update was filtered");
      assert.equal(seen.events.at(-1)?.kind, "snapshot");
      assert.ok(typeof crashedRecordId === "string" && crashedRecordId.length === 64, "source record IDs are stable SHA-256 identities");
    } finally {
      // Always release everything, so a failure ends the file instead of leaving reconnect timers running.
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await client?.close();
      await restarted?.close();
    }
  });
});
