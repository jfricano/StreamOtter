import assert from "node:assert/strict";
import { it } from "node:test";
import { ALLOW_SKIP, brokerAvailable } from "./helpers.ts";

// Every other test in this tier skips without a broker; this one fails so the run can't pass empty.
it("the local broker is running (or STREAMOTTER_ALLOW_SKIP=1)", async t => {
  if (await brokerAvailable()) return;
  if (ALLOW_SKIP) return t.skip("local Kafka is not running; skipping the tier because STREAMOTTER_ALLOW_SKIP=1");
  assert.fail("local Kafka is not running: run pnpm kafka:setup && pnpm kafka:start, or set STREAMOTTER_ALLOW_SKIP=1 to let this tier skip");
});
