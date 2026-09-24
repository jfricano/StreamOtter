import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

const out = new URL("./dist/web/", import.meta.url);
await mkdir(out, { recursive: true });
for (const [entry, file] of [["src/web/main.ts", "app.js"], ["src/web/react.tsx", "react.js"]]) {
  await build({
    entryPoints: [new URL(`./${entry}`, import.meta.url).pathname],
    outfile: new URL(file, out).pathname,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    conditions: ["streamotter-source"],
    define: { "process.env.NODE_ENV": "\"production\"" },
    sourcemap: true,
    minify: true,
    logLevel: "warning"
  });
}
for (const file of ["index.html", "react.html", "styles.css"]) await copyFile(new URL(`./src/web/${file}`, import.meta.url), new URL(file, out));
console.log("order-dashboard web built → dist/web");
