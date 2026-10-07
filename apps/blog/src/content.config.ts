import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { postSchema } from "./posts.ts";

/** The posts: src/content/blog/<slug>.md, published at /<slug>/. */
export const collections = {
  blog: defineCollection({ loader: glob({ pattern: "*.md", base: "./src/content/blog" }), schema: postSchema })
};
