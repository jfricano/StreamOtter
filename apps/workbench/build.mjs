import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { scopeStylesheet } from "./scope-css.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = new URL("./dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: [new URL("./src/main.ts", import.meta.url).pathname],
  outfile: new URL("./app.js", dist).pathname,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  conditions: ["streamotter-source"],
  define: { __STREAMOTTER_WORKBENCH_VERSION__: JSON.stringify(manifest.version) },
  sourcemap: true,
  minify: true,
  legalComments: "linked",
  metafile: true,
  logLevel: "warning"
});
for (const file of ["index.html", "styles.css", "favicon.svg"]) {
  await copyFile(new URL(`./src/${file}`, import.meta.url), new URL(file, dist));
}
// WHC-1 §2.1: hosts link this instead of styles.css. Generated, never hand-maintained; a selector
// the transformer cannot scope safely fails the build here.
const hostStyles = scopeStylesheet(await readFile(new URL("./src/styles.css", import.meta.url), "utf8"));
await writeFile(new URL("workbench-host.css", dist),
  `/* Generated from styles.css by build.mjs: every rule is scoped under [data-streamotter-workbench], the workbench's mount element in hosted mode. */\n${hostStyles}`);
await writeFile(new URL("THIRD_PARTY_LICENSES.txt", dist), await thirdPartyNotices(Object.keys(result.metafile.inputs)));
await writeFile(new URL("workbench-host.json", dist), `${JSON.stringify(await hostManifest(), null, 2)}\n`);
console.log("workbench built → apps/workbench/dist");

/**
 * dist/workbench-host.json, the WHC-1 asset manifest (docs/releases/v1.1/WORKBENCH_HOST_CONTRACT.md §2).
 * Integrity values are computed from the final files, after every other build step.
 */
async function hostManifest() {
  const integrity = {};
  for (const file of ["app.js", "styles.css", "workbench-host.css"]) {
    integrity[file] = `sha384-${createHash("sha384").update(await readFile(new URL(file, dist))).digest("base64")}`;
  }
  return {
    hostContract: 1,
    package: manifest.name,
    version: manifest.version,
    entry: { script: "app.js", style: "styles.css", hostStyle: "workbench-host.css", icon: "favicon.svg" },
    integrity,
    bootElementId: "streamotter-workbench-host",
    mountElementId: "app",
    csp: {
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'", "<api origin>", "<gateway origin>", "<gateway websocket origin>"],
      "frame-ancestors": ["'none'"]
    }
  };
}

/** License texts of the npm packages bundled into app.js, which their licenses require to accompany it. */
async function thirdPartyNotices(inputs) {
  const directories = new Set();
  for (const input of inputs) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match !== null) directories.add(resolve(root, match[1]));
  }
  const sections = [];
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const licenseFile = (await readdir(directory)).find(name => /^(licen[cs]e|copying)(\.|$)/i.test(name));
    if (licenseFile === undefined) throw new Error(`${manifest.name} is bundled into the workbench but has no license file to reproduce.`);
    const text = (await readFile(join(directory, licenseFile), "utf8")).trim();
    sections.push(`${manifest.name}@${manifest.version} (${manifest.license})\n\n${text}\n`);
  }
  sections.sort();
  return `The StreamOtter workbench bundle (app.js) includes the following third-party packages.\n\n${sections.join(`\n${"-".repeat(72)}\n\n`)}`;
}
