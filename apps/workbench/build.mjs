import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = new URL("./dist/", import.meta.url);
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
  sourcemap: true,
  minify: true,
  legalComments: "linked",
  metafile: true,
  logLevel: "warning"
});
for (const file of ["index.html", "styles.css"]) {
  await copyFile(new URL(`./src/${file}`, import.meta.url), new URL(file, dist));
}
await writeFile(new URL("THIRD_PARTY_LICENSES.txt", dist), await thirdPartyNotices(Object.keys(result.metafile.inputs)));
console.log("workbench built → apps/workbench/dist");

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
