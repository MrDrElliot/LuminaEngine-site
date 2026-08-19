import { getCollection, type CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

export const BLOG_TITLE = 'Lumina Devlog';
export const BLOG_DESCRIPTION = 'Release notes, engine deep dives, and development updates for Lumina Engine.';

export async function getPosts(): Promise<BlogPost[]> {
  const posts = await getCollection('blog', ({ data }) => import.meta.env.PROD === false || data.draft === false);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function postHref(post: BlogPost): string {
  return `/blog/${post.id}/`;
}

export function tagSlug(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function tagHref(tag: string): string {
  return `/blog/tags/${tagSlug(tag)}/`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function collectTags(posts: BlogPost[]): { name: string; slug: string; count: number }[] {
  const counts = new Map<string, { name: string; slug: string; count: number }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
      const existing = counts.get(slug);
      if (existing) existing.count += 1;
      else counts.set(slug, { name: tag, slug, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
