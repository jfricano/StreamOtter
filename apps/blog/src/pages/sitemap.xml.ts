import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { sitemapXml } from "../feed.ts";
import { SHOW_DRAFTS } from "../site.ts";

export const GET: APIRoute = async ({ site }) =>
  new Response(sitemapXml(site!, await getCollection("blog"), { drafts: SHOW_DRAFTS }), {
    headers: { "content-type": "application/xml" }
  });
