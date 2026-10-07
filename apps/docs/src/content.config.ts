import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

/** The guides, read from docs/guides/ in the repository, so the site keeps no second copy. */
export const collections = {
  guides: defineCollection({ loader: glob({ pattern: "*.md", base: "../../docs/guides" }) })
};
