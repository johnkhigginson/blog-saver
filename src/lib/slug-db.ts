import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

// DB-backed unique slugs. Uniqueness is enforced in app code (SQL Server unique
// indexes allow only one NULL, which is impractical for drafts without a slug).

export async function uniqueBlogSlug(source: string, excludeId?: number): Promise<string> {
  const base = slugify(source) || "blog";
  let candidate = base;
  let i = 2;
  for (;;) {
    const existing = await prisma.blog.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${i++}`;
  }
}

export async function uniquePostSlug(blogId: number, source: string, excludeId?: number): Promise<string> {
  const base = slugify(source) || "post";
  let candidate = base;
  let i = 2;
  for (;;) {
    const existing = await prisma.post.findFirst({
      where: { blogId, slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${i++}`;
  }
}
