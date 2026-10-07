/**
 * Under the Hood, served from docs/under-the-hood/ in the repository: each part is a
 * self-contained HTML page whose links to the other parts are relative. The only change is a thin
 * bar at the top linking back to the docs and to streamotter.dev. Nothing is served when the
 * folder doesn't exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { APIRoute, GetStaticPaths } from "astro";
import { HAS_UNDER_THE_HOOD, LINKS, UNDER_THE_HOOD_DIR } from "../../site.ts";

const BACK_BAR = `<nav aria-label="StreamOtter Docs" style="display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 16px;font:600 14px/1.4 system-ui,sans-serif;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent)"><a href="/" style="color:inherit">← StreamOtter Docs</a><a href="${LINKS.home}" style="color:inherit">streamotter.dev ↗</a></nav>`;

export const getStaticPaths = (() => (HAS_UNDER_THE_HOOD
  ? readdirSync(UNDER_THE_HOOD_DIR).filter(file => file.endsWith(".html")).map(file => ({ params: { file } }))
  : [])) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const html = readFileSync(`${UNDER_THE_HOOD_DIR}${params.file}`, "utf8");
  const body = /<body[^>]*>/i.exec(html);
  if (body === null) throw new Error(`Under the Hood: ${params.file} has no <body>.`);
  const at = body.index + body[0].length;
  return new Response(`${html.slice(0, at)}${BACK_BAR}${html.slice(at)}`, { headers: { "content-type": "text/html; charset=utf-8" } });
};
