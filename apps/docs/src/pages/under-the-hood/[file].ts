/**
 * Under the Hood, served from docs/under-the-hood/ in the repository: each part is a
 * self-contained HTML page whose links to the other parts are relative. The only change is a thin
 * bar at the top linking back to the docs and to streamotter.dev. A preview build also adds the
 * unreleased-preview banner to that bar and a robots `noindex` to the head. Nothing is served when
 * the folder doesn't exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { APIRoute, GetStaticPaths } from "astro";
import { HAS_UNDER_THE_HOOD, LINKS, PREVIEW, PREVIEW_BANNER, UNDER_THE_HOOD_DIR } from "../../site.ts";

// The parts' sticky letterhead pulls itself 40px up (margin-top: -40px) into the page's top
// space; the bottom margin keeps that space below the bar, so the letterhead doesn't cover it.
const BACK_BAR = `<div style="margin-bottom:40px"><nav aria-label="StreamOtter Docs" style="display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 16px;font:600 14px/1.4 system-ui,sans-serif;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent)"><a href="/" style="color:inherit">← StreamOtter Docs</a><a href="${LINKS.home}" style="color:inherit">streamotter.dev ↗</a></nav>${PREVIEW ? `<div role="note" style="padding:10px 16px;font:400 14px/1.4 system-ui,sans-serif;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent)"><strong>${PREVIEW_BANNER.title}</strong> ${PREVIEW_BANNER.detail}</div>` : ""}</div>`;
const NOINDEX = PREVIEW ? `<meta name="robots" content="noindex">` : "";

export const getStaticPaths = (() => (HAS_UNDER_THE_HOOD
  ? readdirSync(UNDER_THE_HOOD_DIR).filter(file => file.endsWith(".html")).map(file => ({ params: { file } }))
  : [])) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const html = readFileSync(`${UNDER_THE_HOOD_DIR}${params.file}`, "utf8");
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  const body = /<body(?:\s[^>]*)?>/i.exec(html);
  if (head === null || body === null) throw new Error(`Under the Hood: ${params.file} needs a <head> and a <body>.`);
  const inHead = head.index + head[0].length;
  const inBody = body.index + body[0].length;
  return new Response(`${html.slice(0, inHead)}${NOINDEX}${html.slice(inHead, inBody)}${BACK_BAR}${html.slice(inBody)}`, { headers: { "content-type": "text/html; charset=utf-8" } });
};
