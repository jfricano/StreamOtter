import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { sitemapXml } from "../feed.ts";
import { SHOW_DRAFTS } from "../site.ts";

/** Serves /sitemap.xml from the blog collection; drafts are included only with BLOG_DRAFTS=1. */
export const GET: APIRoute = async ({ site }) =>
  new Response(sitemapXml(site!, await getCollection("blog"), { drafts: SHOW_DRAFTS }), {
    headers: { "content-type": "application/xml" }
  });
