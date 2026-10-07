import { z } from "astro/zod";

/**
 * A post's frontmatter. src/content.config.ts gives it to the collection; it lives here, outside
 * astro:content, so the tests can check posts and fixtures against it.
 */
export const postSchema = z.object({
  title: z.string().min(1),
  /** One sentence: the index, the feed, and link cards show it. */
  description: z.string().min(1),
  published: z.coerce.date(),
  updated: z.coerce.date().optional(),
  /** Where the post first appeared, when that isn't here. Defaults to the post's own URL. */
  canonical: z.url().optional(),
  /** The link-card image: a path under public/ (`/cards/launch.png`) or an absolute URL. */
  image: z.string().min(1).optional(),
  draft: z.boolean().default(false)
});

export type PostData = z.infer<typeof postSchema>;

/** The part of a collection entry the blog reads; `id` is the file name, and the post's slug. */
export interface PostEntry {
  id: string;
  data: PostData;
}

/**
 * The posts to publish, newest first. Drafts are left out unless `drafts` is set (BLOG_DRAFTS=1).
 * Posts published the same day keep a stable order, by slug.
 */
export function selectPosts<T extends PostEntry>(entries: readonly T[], { drafts = false }: { drafts?: boolean } = {}): T[] {
  return entries
    .filter(entry => drafts || !entry.data.draft)
    .sort((a, b) => b.data.published.getTime() - a.data.published.getTime() || a.id.localeCompare(b.id));
}

/** A post's path on the site. */
export const postPath = (post: PostEntry): string => `/${post.id}/`;

/** When a post last changed: its update date, or else its publish date. */
export const lastModified = (post: PostEntry): Date => post.data.updated ?? post.data.published;

/**
 * A date as readers see it ("October 7, 2026"). Frontmatter dates are midnight UTC, so they're
 * formatted in UTC and never slip a day.
 */
export const displayDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);

/** A date for `<time datetime>` and the sitemap (2026-10-07). */
export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
