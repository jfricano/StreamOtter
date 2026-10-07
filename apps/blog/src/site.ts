/** The blog's name and one-line description: the index page, the feed, and link cards. */
export const BLOG = {
  title: "StreamOtter Blog",
  description: "Releases, design decisions, and notes from building StreamOtter."
} as const;

export interface Author {
  name: string;
  /** A line under the name on every post; posts show only the name when it is unset. */
  bio?: string;
}

/** Every post's byline. */
export const AUTHOR: Author = { name: "Jason Fricano", bio: "Maintainer of StreamOtter. Co-created KafkaSocks at OSLabs in 2021." };

export const LINKS = {
  home: "https://streamotter.dev",
  docs: "https://docs.streamotter.dev",
  github: "https://github.com/jfricano/StreamOtter"
} as const;

/**
 * BLOG_DRAFTS=1 shows drafts everywhere (pages, feed and sitemap) for a local preview. A deploy
 * never sets it.
 */
export const SHOW_DRAFTS: boolean = process.env.BLOG_DRAFTS === "1";
