/**
 * Under the Hood, served as is from docs/under-the-hood/ in the repository: each part is a
 * self-contained HTML page whose links to the other parts are relative. Nothing is served when the
 * folder doesn't exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { APIRoute, GetStaticPaths } from "astro";
import { HAS_UNDER_THE_HOOD, UNDER_THE_HOOD_DIR } from "../../site.ts";

export const getStaticPaths = (() => (HAS_UNDER_THE_HOOD
  ? readdirSync(UNDER_THE_HOOD_DIR).filter(file => file.endsWith(".html")).map(file => ({ params: { file } }))
  : [])) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => new Response(readFileSync(`${UNDER_THE_HOOD_DIR}${params.file}`), {
  headers: { "content-type": "text/html; charset=utf-8" }
});
