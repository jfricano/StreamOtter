#!/usr/bin/env node
// Sets the same version in all six public package manifests (they are released together).
// Usage: node scripts/release/set-version.mjs <version>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGES = ["packages/contracts", "packages/client", "packages/gateway", "packages/cli", "apps/workbench", "packages/streamotter"];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const version = process.argv[2];
if (version === undefined || !SEMVER.test(version)) {
  console.error("Usage: node scripts/release/set-version.mjs <version>   (for example 0.1.0-rc.2 or 0.1.0)");
  process.exit(2);
}
const root = join(import.meta.dirname, "../..");
for (const directory of PACKAGES) {
  const path = join(root, directory, "package.json");
  const text = await readFile(path, "utf8");
  const previous = JSON.parse(text).version;
  // Replace only the top-level version line so the manifest's formatting is kept.
  const updated = text.replace(/^(  "version": )"[^"]*"/m, `$1"${version}"`);
  if (JSON.parse(updated).version !== version) throw new Error(`Could not set the version in ${path}`);
  await writeFile(path, updated);
  console.log(`${directory}: ${previous} → ${version}`);
}
console.log("Next: update CHANGELOG.md and the package README status lines, then follow docs/RELEASE_CHECKLIST.md.");
