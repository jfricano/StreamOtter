import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "node:test";
import { ALLOW_SKIP, brokerAvailable, ROOT } from "../kafka/helpers.ts";

// proxy.test.ts skips when something it needs is missing; this one fails so the run can't pass empty.
it("Caddy, the build and the local broker are present (or STREAMOTTER_ALLOW_SKIP=1)", async t => {
  const missing = [
    existsSync(resolve(ROOT, ".local/caddy/caddy")) ? null : "Caddy (pnpm deploy:setup)",
    existsSync(resolve(ROOT, "examples/order-dashboard/dist/server/app.js")) && existsSync(resolve(ROOT, "packages/cli/dist/main.js")) ? null : "the build (pnpm build)",
    (await brokerAvailable()) ? null : "the local broker (pnpm kafka:start)"
  ].filter(item => item !== null);
  if (missing.length === 0) return;
  if (ALLOW_SKIP) return t.skip(`missing ${missing.join(", ")}; skipping the tier because STREAMOTTER_ALLOW_SKIP=1`);
  assert.fail(`missing ${missing.join(", ")}; set STREAMOTTER_ALLOW_SKIP=1 to let this tier skip`);
});
