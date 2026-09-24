import { copyFile, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const dist = new URL("./dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
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
  logLevel: "warning"
});
for (const file of ["index.html", "styles.css"]) {
  await copyFile(new URL(`./src/${file}`, import.meta.url), new URL(file, dist));
}
console.log("workbench built → apps/workbench/dist");
