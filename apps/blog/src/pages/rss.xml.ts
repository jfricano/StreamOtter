import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { rssXml } from "../feed.ts";
import { SHOW_DRAFTS } from "../site.ts";

export const GET: APIRoute = async ({ site }) =>
  new Response(rssXml(site!, await getCollection("blog"), { drafts: SHOW_DRAFTS }), {
    headers: { "content-type": "application/rss+xml; charset=utf-8" }
  });
