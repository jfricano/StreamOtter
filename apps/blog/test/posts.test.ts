import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { displayDate, isoDate, postPath, postSchema, selectPosts } from "../src/posts.ts";
import { entry, samplePost } from "./fixtures/posts.ts";

describe("selectPosts", () => {
  const published = [entry("first", "2026-09-01"), entry("second", "2026-10-01")];

  test("leaves drafts out, unless a preview asks for them", () => {
    const sample = samplePost();
    assert.equal(sample.data.draft, true);
    assert.deepEqual(selectPosts([...published, sample]).map(post => post.id), ["second", "first"]);
    assert.deepEqual(selectPosts([...published, sample], { drafts: true }).map(post => post.id), ["sample-post", "second", "first"]);
    assert.deepEqual(selectPosts([sample]), []);
  });

  test("lists posts newest first, and posts from the same day by slug", () => {
    const posts = [entry("b-same-day", "2026-10-01"), ...published, entry("a-same-day", "2026-10-01"), entry("oldest", "2025-12-31")];
    assert.deepEqual(selectPosts(posts).map(post => post.id), ["a-same-day", "b-same-day", "second", "first", "oldest"]);
  });

  test("ignores the update date when ordering", () => {
    const posts = [entry("old-but-updated", "2026-01-01", { updated: "2026-12-01" }), entry("newer", "2026-06-01")];
    assert.deepEqual(selectPosts(posts).map(post => post.id), ["newer", "old-but-updated"]);
  });
});

describe("postSchema", () => {
  test("a post is published unless it says draft: true", () => {
    assert.equal(entry("plain", "2026-10-01").data.draft, false);
  });
  test("rejects a missing description and a canonical that isn't a URL", () => {
    assert.throws(() => postSchema.parse({ title: "T", published: "2026-10-01" }));
    assert.throws(() => postSchema.parse({ title: "T", description: "D", published: "2026-10-01", canonical: "/elsewhere/" }));
  });
  test("reads every field of the sample post", () => {
    const { data } = samplePost();
    assert.equal(data.title, "A sample post: escaping & <angle brackets> and \"quotes\"");
    assert.deepEqual([isoDate(data.published), data.updated && isoDate(data.updated)], ["2026-10-07", "2026-10-08"]);
    assert.equal(data.canonical, "https://blog.streamotter.dev/sample-post/");
    assert.equal(data.image, "/apple-touch-icon.png");
  });
});

test("dates show as written in the frontmatter, in any time zone", () => {
  const { published } = entry("dated", "2026-10-07").data;
  assert.equal(displayDate(published), "October 7, 2026");
  assert.equal(isoDate(published), "2026-10-07");
});

test("a post lives at /<slug>/", () => {
  assert.equal(postPath(entry("hello-world", "2026-10-07")), "/hello-world/");
});
