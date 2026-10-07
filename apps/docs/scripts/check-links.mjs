/**
 * Checks the built site (dist/): every same-site link, image, script and stylesheet resolves to a
 * built file, and every fragment to an id on its page. Run after `astro build`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const SITE = "https://docs.streamotter.dev";
const pages = new Map();
for (const file of walk(DIST)) {
  if (!file.endsWith(".html")) continue;
  const html = readFileSync(file, "utf8");
  pages.set(file, { html, ids: new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => decode(match[1]))) });
}

const problems = [];
let checked = 0;
for (const [file, { html }] of pages) {
  const from = `/${relative(DIST, file).split(sep).join("/")}`;
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const target = decode(url);
    if (/^(?:mailto:|data:)/.test(target)) continue;
    const resolved = new URL(target, `${SITE}${from}`);
    if (resolved.origin !== SITE) continue;
    checked++;
    const path = decodeURIComponent(resolved.pathname);
    const candidate = join(DIST, path.endsWith("/") ? `${path}index.html` : path);
    const exists = existsSync(candidate) && statSync(candidate).isFile();
    if (!exists) { problems.push(`${from}: ${target} does not exist`); continue; }
    if (resolved.hash && candidate.endsWith(".html") && !pages.get(candidate)?.ids.has(decodeURIComponent(resolved.hash.slice(1)))) {
      problems.push(`${from}: ${target} has no #${resolved.hash.slice(1)}`);
    }
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${pages.size} pages, ${checked} same-site links: all resolve.`);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
function decode(value) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
