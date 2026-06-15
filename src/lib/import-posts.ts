// Shared post-creation logic used by both the Blogger importer and the Wayback
// recovery path. Takes a normalized BloggerImport and writes Posts/Comments/Tags
// into an existing blog. Idempotent: a re-run updates posts in place, matched by
// the stable source id (Atom <id>), then permalink, then title+date.

import { prisma } from "@/lib/prisma";
import { htmlToText, excerpt, type BloggerImport } from "@/lib/blogger";
import { uniqueSlug } from "@/lib/slug";
import { sanitizeBlogHtml } from "@/lib/sanitize";
import { syncPostImages } from "@/lib/post-images";

export interface ImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  importedComments: number;
  errors: string[];
}

// Resolve every distinct label to a tag id in a few queries (not one per label).
async function resolveTagIds(labels: string[]): Promise<Map<string, number>> {
  const names = [...new Set(labels.map((l) => l.trim()).filter(Boolean))].map((n) => n.slice(0, 120));
  const map = new Map<string, number>();
  if (names.length === 0) return map;

  const existing = await prisma.tag.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  for (const t of existing) map.set(t.name, t.id);

  const missing = names.filter((n) => !map.has(n));
  if (missing.length) {
    // SQL Server createMany has no skipDuplicates; tolerate a concurrent insert.
    try {
      await prisma.tag.createMany({ data: missing.map((name) => ({ name })) });
    } catch {
      /* raced; the re-read below still resolves them */
    }
    const created = await prisma.tag.findMany({ where: { name: { in: missing } }, select: { id: true, name: true } });
    for (const t of created) map.set(t.name, t.id);
  }
  return map;
}

export async function importBloggerData(
  blogId: number,
  data: BloggerImport,
  opts: { updateExisting?: boolean; sourceType?: string } = {}
): Promise<ImportSummary> {
  const updateExisting = opts.updateExisting !== false; // default: refresh existing
  const sourceType = opts.sourceType ?? "BLOGGER_IMPORT";

  // Identity for idempotent matching. Prefer the stable Atom id, then permalink,
  // then a title+date fallback (with an in-run index to avoid collapsing two
  // distinct id-less, permalink-less entries during a single run).
  const dbKey = (sourceId: string | null, permalink: string | null, name: string, published: Date | null) =>
    sourceId || permalink || `${name}|${published?.toISOString() ?? ""}`;

  const existingPosts = await prisma.post.findMany({
    where: { blogId },
    select: { id: true, title: true, slug: true, sourceId: true, sourceUrl: true, publishedAt: true },
  });
  const existingByKey = new Map<string, number>();
  const postIdByUrl = new Map<string, number>();
  for (const p of existingPosts) {
    existingByKey.set(dbKey(p.sourceId, p.sourceUrl, p.title, p.publishedAt), p.id);
    if (p.sourceUrl) postIdByUrl.set(p.sourceUrl, p.id);
  }
  const takenSlugs = new Set(existingPosts.map((p) => p.slug).filter((s): s is string => !!s));

  // Pre-resolve all tags across the whole import in one batch.
  const tagIdByName = await resolveTagIds(data.posts.flatMap((p) => p.labels));

  async function applyTags(postId: number, labels: string[]) {
    const tagIds = [...new Set(labels.map((l) => l.trim()).filter(Boolean))]
      .map((l) => tagIdByName.get(l.slice(0, 120)))
      .filter((id): id is number => id != null);
    // Clear-then-insert so a re-import refreshes tags without PK collisions
    // (SQL Server createMany has no skipDuplicates).
    await prisma.postTag.deleteMany({ where: { postId } });
    if (tagIds.length) {
      await prisma.postTag.createMany({ data: tagIds.map((tagId) => ({ postId, tagId })) });
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

  for (let idx = 0; idx < ordered.length; idx++) {
    const post = ordered[idx];
    const title = (post.title || "Untitled post").slice(0, 500);
    const key =
      post.sourceId ||
      post.permalink ||
      `${title}|${post.publishedAt?.toISOString() ?? ""}|${idx}`;
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
            title, // refresh (slug stays stable) so corrected decoding propagates
            excerpt: summary,
            bodyHtml: safeHtml,
            heroImageUrl: post.imageUrl ?? undefined,
            originalAuthor: post.author ?? undefined,
            publishedAt: post.publishedAt ?? undefined,
          },
        });
        await applyTags(existingId, post.labels);
        await syncPostImages(existingId, post.imageUrl, safeHtml);
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
          sourceId: post.sourceId ?? null,
          originalAuthor: post.author ?? null,
          publishedAt: post.publishedAt ?? null,
        },
        select: { id: true },
      });
      existingByKey.set(key, created.id);
      if (post.permalink) postIdByUrl.set(post.permalink, created.id);
      await applyTags(created.id, post.labels);
      await syncPostImages(created.id, post.imageUrl, safeHtml);
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
