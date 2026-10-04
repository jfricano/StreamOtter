import assert from "node:assert/strict";
import { it } from "node:test";
import { ALLOW_SKIP } from "../kafka/helpers.ts";
import { replicatedAvailable, SKIP_MESSAGE } from "./helpers.ts";

// Every other test in this tier skips without the cluster; this one fails so the run can't pass empty.
it("the replicated cluster is running (or STREAMOTTER_ALLOW_SKIP=1)", async t => {
  if (await replicatedAvailable()) return;
  if (ALLOW_SKIP) return t.skip(`${SKIP_MESSAGE}; skipping the tier because STREAMOTTER_ALLOW_SKIP=1`);
  assert.fail(`${SKIP_MESSAGE}, or set STREAMOTTER_ALLOW_SKIP=1 to let this tier skip`);
});
