// Shared post-creation logic used by both the Blogger importer and the Wayback
// recovery path. Takes a normalized BloggerImport and writes Posts/Comments/Tags
// into an existing blog. Idempotent: a re-run updates posts in place (matched by
// permalink, or title+date when no permalink exists).

import { prisma } from "@/lib/prisma";
import { htmlToText, excerpt, type BloggerImport } from "@/lib/blogger";
import { uniqueSlug } from "@/lib/slug";
import { sanitizeBlogHtml } from "@/lib/sanitize";

export interface ImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  importedComments: number;
  errors: string[];
}

export async function importBloggerData(
  blogId: number,
  data: BloggerImport,
  opts: { updateExisting?: boolean; sourceType?: string } = {}
): Promise<ImportSummary> {
  const updateExisting = opts.updateExisting !== false; // default: refresh existing
  const sourceType = opts.sourceType ?? "BLOGGER_IMPORT";

  const postKey = (name: string, permalink: string | null, published: Date | null) =>
    permalink || `${name}|${published?.toISOString() ?? ""}`;

  const existingPosts = await prisma.post.findMany({
    where: { blogId },
    select: { id: true, title: true, slug: true, sourceUrl: true, publishedAt: true },
  });
  const existingByKey = new Map<string, number>();
  const postIdByUrl = new Map<string, number>();
  for (const p of existingPosts) {
    existingByKey.set(postKey(p.title, p.sourceUrl, p.publishedAt), p.id);
    if (p.sourceUrl) postIdByUrl.set(p.sourceUrl, p.id);
  }
  const takenSlugs = new Set(existingPosts.map((p) => p.slug).filter((s): s is string => !!s));

  const tagCache = new Map<string, number>();
  async function getTagId(name: string): Promise<number> {
    const key = name.trim();
    if (tagCache.has(key)) return tagCache.get(key)!;
    const tag = await prisma.tag.upsert({ where: { name: key }, update: {}, create: { name: key } });
    tagCache.set(key, tag.id);
    return tag.id;
  }
  async function applyTags(postId: number, labels: string[]) {
    for (const label of labels) {
      if (!label.trim()) continue;
      const tagId = await getTagId(label);
      await prisma.postTag.upsert({
        where: { postId_tagId: { postId, tagId } },
        update: {},
        create: { postId, tagId },
      });
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Import oldest-first so creation order is stable and natural.
  const ordered = [...data.posts].sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    return at - bt;
  });

  for (const post of ordered) {
    const title = (post.title || "Untitled post").slice(0, 500);
    const key = postKey(title, post.permalink, post.publishedAt);
    const existingId = existingByKey.get(key);

    try {
      const safeHtml = sanitizeBlogHtml(post.contentHtml);
      const plain = htmlToText(post.contentHtml);
      const summary = plain ? excerpt(plain) : null;

      if (existingId != null) {
        if (!updateExisting) {
          skipped++;
          continue;
        }
        await prisma.post.update({
          where: { id: existingId },
          data: {
            excerpt: summary,
            bodyHtml: safeHtml,
            heroImageUrl: post.imageUrl ?? undefined,
            originalAuthor: post.author ?? undefined,
            publishedAt: post.publishedAt ?? undefined,
          },
        });
        await applyTags(existingId, post.labels);
        updated++;
        continue;
      }

      const slug = uniqueSlug(title, takenSlugs, `post-${imported + 1}`);
      const created = await prisma.post.create({
        data: {
          blogId,
          title,
          slug,
          excerpt: summary,
          bodyHtml: safeHtml,
          heroImageUrl: post.imageUrl ?? null,
          status: "PUBLISHED",
          sourceType,
          sourceUrl: post.permalink ?? null,
          originalAuthor: post.author ?? null,
          publishedAt: post.publishedAt ?? null,
        },
        select: { id: true },
      });
      existingByKey.set(key, created.id);
      if (post.permalink) postIdByUrl.set(post.permalink, created.id);
      await applyTags(created.id, post.labels);
      imported++;
    } catch (err) {
      errors.push(`${post.title}: ${err instanceof Error ? err.message : "import failed"}`);
    }
  }

  // Comments → matching posts (by permalink).
  let importedComments = 0;
  const postIds = Array.from(new Set(postIdByUrl.values()));
  if (data.comments.length > 0 && postIds.length > 0) {
    const existing = await prisma.comment.findMany({
      where: { postId: { in: postIds } },
      select: { postId: true, authorName: true, body: true },
    });
    const seen = new Set(existing.map((c) => `${c.postId}|${c.authorName}|${c.body}`));
    for (const c of data.comments) {
      if (!c.postPermalink || !c.body.trim()) continue;
      const postId = postIdByUrl.get(c.postPermalink);
      if (!postId) continue;
      const authorName = (c.author || "Anonymous").slice(0, 200);
      const dedupeKey = `${postId}|${authorName}|${c.body}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      try {
        await prisma.comment.create({
          data: {
            postId,
            authorName,
            body: c.body,
            sourceUrl: c.postPermalink,
            createdAt: c.publishedAt ?? new Date(),
          },
        });
        importedComments++;
      } catch {
        // skip a bad comment row without failing the import
      }
    }
  }

  return { imported, updated, skipped, importedComments, errors };
}
