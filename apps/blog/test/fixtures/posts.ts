import { readFileSync } from "node:fs";
import { postSchema, type PostEntry } from "../../src/posts.ts";

/** A collection entry as Astro would give it, with only the required fields unless more are passed. */
export function entry(id: string, published: string, data: Record<string, unknown> = {}): PostEntry {
  return { id, data: postSchema.parse({ title: `Post ${id}`, description: `About ${id}.`, published, ...data }) };
}

/**
 * sample-post.md, a draft with every field, as Astro would give it. Its frontmatter is kept simple
 * (one `key: value` per line, strings plain or quoted), so it's read here without a YAML parser.
 */
export function samplePost(): PostEntry {
  const [, frontmatter = ""] = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(new URL("./sample-post.md", import.meta.url), "utf8")) ?? [];
  const fields = Object.fromEntries(frontmatter.split("\n").map(line => {
    const at = line.indexOf(": ");
    const key = line.slice(0, at), value = line.slice(at + 2);
    if (value === "true" || value === "false") return [key, value === "true"];
    if (value.startsWith("\"")) return [key, JSON.parse(value)];
    if (value.startsWith("'")) return [key, value.slice(1, -1).replaceAll("''", "'")];
    return [key, value];
  }));
  return { id: "sample-post", data: postSchema.parse(fields) };
}
