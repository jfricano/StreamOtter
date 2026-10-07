import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { escapeXml, rfc822, rssXml, sitemapXml } from "../src/feed.ts";
import { BLOG } from "../src/site.ts";
import { entry, samplePost } from "./fixtures/posts.ts";

const site = new URL("https://blog.streamotter.dev");
const items = (xml: string) => [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map(match => match[0]);

test("escapeXml escapes &, <, >, and both quotes, ampersands first", () => {
  assert.equal(escapeXml(`Tom & "Jerry" <b>'s</b> &amp;`), "Tom &amp; &quot;Jerry&quot; &lt;b&gt;&apos;s&lt;/b&gt; &amp;amp;");
});

test("rfc822 writes RSS 2.0 dates in GMT", () => {
  assert.equal(rfc822(new Date("2026-10-07")), "Wed, 07 Oct 2026 00:00:00 GMT");
  assert.match(rfc822(new Date("2026-01-05T15:04:05Z")), /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
});

describe("rssXml", () => {
  const posts = [entry("first", "2026-09-01", { description: "Uses <Channel> & \"quotes\"." }), entry("second", "2026-10-01", { updated: "2026-10-03" })];

  test("describes the channel and links to itself", () => {
    const xml = rssXml(site, posts);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
    assert.ok(xml.includes(`<title>${BLOG.title}</title>`));
    assert.ok(xml.includes("<link>https://blog.streamotter.dev/</link>"));
    assert.ok(xml.includes(`<atom:link href="https://blog.streamotter.dev/rss.xml" rel="self" type="application/rss+xml"/>`));
    assert.ok(xml.includes("<lastBuildDate>Sat, 03 Oct 2026 00:00:00 GMT</lastBuildDate>"));
  });

  test("has one item per published post, newest first, with its link, guid, date and summary", () => {
    const listed = items(rssXml(site, [...posts, samplePost()]));
    assert.equal(listed.length, 2);
    const [second, first] = listed;
    assert.equal(second, [
      "<item>",
      "      <title>Post second</title>",
      "      <link>https://blog.streamotter.dev/second/</link>",
      "      <guid isPermaLink=\"true\">https://blog.streamotter.dev/second/</guid>",
      "      <pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>",
      "      <description>About second.</description>",
      "    </item>"
    ].join("\n"));
    assert.ok(first!.includes("<description>Uses &lt;Channel&gt; &amp; &quot;quotes&quot;.</description>"));
  });

  test("escapes titles, and lists drafts only in a preview", () => {
    const xml = rssXml(site, [samplePost()], { drafts: true });
    assert.ok(xml.includes("<title>A sample post: escaping &amp; &lt;angle brackets&gt; and &quot;quotes&quot;</title>"));
    assert.ok(!xml.includes("<angle"));
    assert.equal(items(rssXml(site, [samplePost()])).length, 0);
  });

  test("with no posts, is an empty channel with no build date", () => {
    const xml = rssXml(site, []);
    assert.equal(items(xml).length, 0);
    assert.ok(!xml.includes("lastBuildDate"));
    assert.ok(xml.endsWith("</channel>\n</rss>\n"));
  });
});

describe("sitemapXml", () => {
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(match => match[1]);

  test("lists the index and published posts only, with the date each last changed", () => {
    const xml = sitemapXml(site, [entry("live", "2026-10-01", { updated: "2026-10-05" }), samplePost(), entry("hidden", "2026-10-02", { draft: true })]);
    assert.deepEqual(locs(xml), ["https://blog.streamotter.dev/", "https://blog.streamotter.dev/live/"]);
    assert.ok(xml.includes("<lastmod>2026-10-05</lastmod>"));
  });

  test("lists drafts only in a preview", () => {
    assert.deepEqual(locs(sitemapXml(site, [samplePost()], { drafts: true })), ["https://blog.streamotter.dev/", "https://blog.streamotter.dev/sample-post/"]);
  });
});
