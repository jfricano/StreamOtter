import { readdirSync } from "node:fs";
import type { APIRoute } from "astro";
import reference from "virtual:streamotter-docs/api-reference";
import { API_ROOT } from "../api-reference/modules.ts";
import { GUIDES, HAS_UNDER_THE_HOOD, UNDER_THE_HOOD_DIR } from "../site.ts";

export const GET: APIRoute = ({ site }) => {
  const paths = [
    "/", "/guides/", ...GUIDES.map(guide => `/guides/${guide.slug}/`),
    API_ROOT, ...reference.modules.map(module => module.href), ...reference.symbols.map(symbol => symbol.href),
    ...(HAS_UNDER_THE_HOOD ? readdirSync(UNDER_THE_HOOD_DIR).filter(file => file.endsWith(".html")).map(file => `/under-the-hood/${file === "index.html" ? "" : file}`) : [])
  ];
  const urls = paths.map(path => `  <url><loc>${new URL(path, site)}</loc></url>`).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "content-type": "application/xml" }
  });
};
