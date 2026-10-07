import { isoDate, lastModified, postPath, selectPosts, type PostEntry } from "./posts.ts";
import { BLOG } from "./site.ts";

/** Text for XML content and attribute values. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** An RFC 822 date, as RSS 2.0 requires (Wed, 07 Oct 2026 00:00:00 GMT). */
export const rfc822 = (date: Date): string => date.toUTCString();

/**
 * /rss.xml: RSS 2.0, one item per published post, newest first. The channel's lastBuildDate is the
 * newest post's last change, so building twice gives the same file.
 */
export function rssXml(site: URL, entries: readonly PostEntry[], options: { drafts?: boolean } = {}): string {
  const posts = selectPosts(entries, options);
  const items = posts.map(post => {
    const link = escapeXml(new URL(postPath(post), site).href);
    return [
      "    <item>",
      `      <title>${escapeXml(post.data.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <pubDate>${rfc822(post.data.published)}</pubDate>`,
      `      <description>${escapeXml(post.data.description)}</description>`,
      "    </item>"
    ].join("\n");
  });
  const newest = posts.map(lastModified).sort((a, b) => b.getTime() - a.getTime())[0];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${escapeXml(BLOG.title)}</title>`,
    `    <link>${escapeXml(new URL("/", site).href)}</link>`,
    `    <description>${escapeXml(BLOG.description)}</description>`,
    "    <language>en</language>",
    `    <atom:link href="${escapeXml(new URL("/rss.xml", site).href)}" rel="self" type="application/rss+xml"/>`,
    ...(newest ? [`    <lastBuildDate>${rfc822(newest)}</lastBuildDate>`] : []),
    ...items,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n");
}

/** /sitemap.xml: the index and every published post, with the date it last changed. */
export function sitemapXml(site: URL, entries: readonly PostEntry[], options: { drafts?: boolean } = {}): string {
  const urls = [
    `  <url><loc>${escapeXml(new URL("/", site).href)}</loc></url>`,
    ...selectPosts(entries, options).map(post =>
      `  <url><loc>${escapeXml(new URL(postPath(post), site).href)}</loc><lastmod>${isoDate(lastModified(post))}</lastmod></url>`)
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
