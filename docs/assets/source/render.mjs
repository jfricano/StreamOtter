// Renders every templates/*.html to the PNG named by its <meta name="output">,
// at the size in <meta name="size" content="WxH">. Needs Playwright with Chromium, either
// resolvable as "playwright" or at PLAYWRIGHT_MODULE (the path to its index.mjs):
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node docs/assets/source/render.mjs [name-filter]
import { readdir, readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const filter = process.argv[2] ?? "";
const dir = join(here, "templates");
const files = (await readdir(dir)).filter((f) => f.endsWith(".html") && f.includes(filter)).sort();
const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
for (const file of files) {
  const html = await readFile(join(dir, file), "utf8");
  const meta = (name) => html.match(new RegExp(`<meta name="${name}" content="([^"]+)"`))?.[1];
  const outputs = meta("output");
  const [width, height] = (meta("size") ?? "").split("x").map(Number);
  if (!outputs || !width || !height) { console.warn(`skip ${file}: needs output and size meta`); continue; }
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(meta("scale") ?? 1) });
  await page.goto(pathToFileURL(join(dir, file)).href);
  await page.evaluate(() => document.fonts.ready);
  for (const out of outputs.split(",")) {
    const target = resolve(dir, out.trim());
    await mkdir(dirname(target), { recursive: true });
    await page.screenshot({ path: target, omitBackground: meta("transparent") === "true" });
    console.log(`${file} -> ${out.trim()} (${width}x${height})`);
  }
  await page.close();
}
await browser.close();
