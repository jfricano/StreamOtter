import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { observe, orderRecord, startHarness, waitFor, type Harness } from "./harness.ts";

describe("fixture gateway and SDK smoke path", () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({
      fixtures: [
        orderRecord("acme", "ord_1", 2, "processing", 40),
        orderRecord("acme", "ord_1", 3, "done", 100)
      ]
    });
    h.app.put("acme", "alice", "ord_1", 1, "queued", 0);
  });
  after(() => h.close());

  it("delivers a snapshot, reaches live, then applies updates", async () => {
    const client = h.client();
    const sub = client.subscribe("orderStatus", { channelVersion: 1, params: { orderId: "ord_1" } });
    const seen = observe(sub);
    await sub.ready({ timeoutMs: 5_000 });
    assert.equal(sub.state, "live");
    assert.deepEqual(seen.states, ["authorizing", "synchronizing", "live"]);
    assert.equal(seen.events[0]?.kind, "snapshot");
    assert.equal(seen.events[0]?.revision, "1");

    await h.advance(2);
    await waitFor(() => seen.events.length === 3, 5_000, "two updates");
    assert.deepEqual(seen.events.map(event => [event.kind, event.revision]), [["snapshot", "1"], ["update", "2"], ["update", "3"]]);
    assert.deepEqual(seen.data().at(-1), { orderId: "ord_1", status: "done", progress: 100 });
    assert.equal(client.state, "connected");
    await sub.unsubscribe();
    assert.equal(sub.state, "closed");
  });
});
