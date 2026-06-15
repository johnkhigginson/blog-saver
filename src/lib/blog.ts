// Server-side data access for the PUBLIC blog. These queries are the only place
// unauthenticated visitors touch the database, so every query is hard-scoped to
// a published blog AND a published post — nothing private/draft can leak.

import { prisma } from "@/lib/prisma";

export async function getPublishedBlogs() {
  return prisma.blog.findMany({
    where: { isPublished: true, slug: { not: null } },
    select: {
      id: true,
      title: true,
      description: true,
      slug: true,
      coverImageUrl: true,
      publishedAt: true,
      _count: { select: { posts: { where: { status: "PUBLISHED" } } } },
    },
    orderBy: { publishedAt: "desc" },
  });
}

export async function getPublishedBlogBySlug(slug: string) {
  return prisma.blog.findFirst({
    where: { isPublished: true, slug },
    select: {
      id: true,
      title: true,
      description: true,
      slug: true,
      coverImageUrl: true,
      posts: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          heroImageUrl: true,
          publishedAt: true,
          author: { select: { name: true } },
          tags: { select: { tag: { select: { name: true } } } },
        },
      },
    },
  });
}

export async function getPublishedPost(blogSlug: string, identifier: string) {
  const blog = await prisma.blog.findFirst({
    where: { isPublished: true, slug: blogSlug },
    select: { id: true, title: true, slug: true },
  });
  if (!blog) return null;

  // Posts are addressed by slug; fall back to numeric id for posts that were
  // never slugged.
  const numericId = /^\d+$/.test(identifier) ? parseInt(identifier, 10) : null;
  const post = await prisma.post.findFirst({
    where: {
      blogId: blog.id,
      status: "PUBLISHED",
      ...(numericId ? { OR: [{ slug: identifier }, { id: numericId }] } : { slug: identifier }),
    },
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      bodyHtml: true,
      heroImageUrl: true,
      sourceType: true,
      sourceUrl: true,
      originalAuthor: true,
      publishedAt: true,
      author: { select: { name: true, bio: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!post) return null;

  return { blog, post };
}

// Distinct authors of the published posts in a blog, for its About page.
export async function getPublishedBlogAuthors(slug: string) {
  const blog = await prisma.blog.findFirst({
    where: { isPublished: true, slug },
    select: { id: true, title: true, slug: true, description: true },
  });
  if (!blog) return null;

  const posts = await prisma.post.findMany({
    where: { blogId: blog.id, status: "PUBLISHED" },
    select: { author: { select: { id: true, name: true, bio: true, avatarUrl: true } } },
  });

  const byId = new Map<number, { id: number; name: string; bio: string | null; avatarUrl: string | null }>();
  for (const p of posts) {
    const a = p.author;
    if (a && !byId.has(a.id)) byId.set(a.id, a);
  }
  return { blog, authors: Array.from(byId.values()) };
}

// True when the post is published and lives in a published blog — i.e. it is
// publicly viewable. Gates public comment read/write.
export async function isPostPubliclyVisible(postId: number): Promise<boolean> {
  const post = await prisma.post.findFirst({
    where: { id: postId, status: "PUBLISHED", blog: { isPublished: true } },
    select: { id: true },
  });
  return !!post;
}

export function formatBlogDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
