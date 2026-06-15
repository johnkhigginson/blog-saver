import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireBlogAccess } from "@/lib/auth";
import {
  fetchAllBloggerPosts,
  parseBloggerXmlExport,
  normalizeBlogUrl,
  htmlToText,
  excerpt,
  type BloggerImport,
} from "@/lib/blogger";
import { uniqueSlug } from "@/lib/slug";
import { sanitizeBlogHtml } from "@/lib/sanitize";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
// A full blog can have hundreds of posts; give the import room to run.
export const maxDuration = 300;

interface ImportInput {
  blogUrl?: string;
  xml?: string;
  blogTitle?: string;
  blogId?: number; // import into an existing blog you own/collaborate on
  updateExisting?: boolean; // refresh already-imported posts (default true)
}

async function readInput(request: NextRequest): Promise<ImportInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    const xml = file ? await file.text() : ((form.get("xml") as string | null) ?? undefined);
    const blogIdRaw = form.get("blogId") as string | null;
    const updateRaw = form.get("updateExisting") as string | null;
    return {
      blogUrl: (form.get("blogUrl") as string | null) ?? undefined,
      xml: xml ?? undefined,
      blogTitle: (form.get("blogTitle") as string | null) ?? undefined,
      blogId: blogIdRaw ? parseInt(blogIdRaw, 10) : undefined,
      updateExisting: updateRaw == null ? undefined : updateRaw === "true",
    };
  }
  return (await request.json()) as ImportInput;
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let input: ImportInput;
  try {
    input = await readInput(request);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Gather posts from whichever source was provided.
  let data: BloggerImport;
  try {
    if (input.xml && input.xml.trim()) {
      data = parseBloggerXmlExport(input.xml);
    } else if (input.blogUrl && input.blogUrl.trim()) {
      data = await fetchAllBloggerPosts(input.blogUrl);
    } else {
      return NextResponse.json(
        { error: "Provide either a blog URL or a Blogger XML export." },
        { status: 400 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read blog content";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (data.posts.length === 0) {
    return NextResponse.json({ error: "No posts found in the provided source." }, { status: 404 });
  }

  // Resolve the destination blog: an existing one (authorized) or a new one
  // owned by the importing user.
  let blogId: number;
  if (input.blogId != null) {
    try {
      await requireBlogAccess(input.blogId);
    } catch {
      return NextResponse.json({ error: "Not authorized for that blog." }, { status: 403 });
    }
    blogId = input.blogId;
  } else {
    const title = (input.blogTitle || data.blogTitle || "Imported blog").trim().slice(0, 300);
    const sourceUrl = input.blogUrl ? normalizeBlogUrl(input.blogUrl) : null;
    const blog = await prisma.blog.create({
      data: {
        ownerId: user.userId,
        title,
        description: data.blogTitle ? `Imported from ${data.blogTitle}` : null,
        sourceUrl,
      },
      select: { id: true },
    });
    blogId = blog.id;
  }

  // A stable identity for a post so re-runs are idempotent. Prefer the
  // permalink; fall back to title+date for exports that omit the alternate link.
  const postKey = (name: string, permalink: string | null, published: Date | null) =>
    permalink || `${name}|${published?.toISOString() ?? ""}`;

  const updateExisting = input.updateExisting !== false; // default: refresh existing

  // Map existing posts by identity so re-runs update in place.
  const existingPosts = await prisma.post.findMany({
    where: { blogId },
    select: { id: true, title: true, slug: true, sourceUrl: true, publishedAt: true },
  });
  const existingByKey = new Map<string, number>();
  const postIdByUrl = new Map<string, number>(); // permalink → post id, for comment matching
  for (const p of existingPosts) {
    existingByKey.set(postKey(p.title, p.sourceUrl, p.publishedAt), p.id);
    if (p.sourceUrl) postIdByUrl.set(p.sourceUrl, p.id);
  }
  const takenSlugs = new Set(existingPosts.map((p) => p.slug).filter((s): s is string => !!s));

  // Cache tag ids so repeated labels don't re-query.
  const tagCache = new Map<string, number>();
  async function getTagId(name: string): Promise<number> {
    const key = name.trim();
    if (tagCache.has(key)) return tagCache.get(key)!;
    const tag = await prisma.tag.upsert({ where: { name: key }, update: {}, create: { name: key } });
    tagCache.set(key, tag.id);
    return tag.id;
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

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

  // Import oldest-first so blog ordering (newest first) falls out from the
  // publish dates while creation order stays stable.
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
          sourceType: "BLOGGER_IMPORT",
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

  // Import the original Blogger comments onto the matching posts.
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

  const blog = await prisma.blog.findUnique({ where: { id: blogId }, select: { title: true } });

  await audit({
    category: "IMPORT",
    action: "BLOG_IMPORTED",
    summary: `${user.name} imported “${blog?.title ?? "blog"}” — ${imported} new, ${updated} updated, ${importedComments} comments`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "BLOG",
    targetId: blogId,
    metadata: { imported, updated, skipped, importedComments, totalPosts: data.posts.length },
  });

  return NextResponse.json({
    blogId,
    blogTitle: blog?.title ?? data.blogTitle,
    totalPosts: data.posts.length,
    imported,
    updated,
    skipped,
    importedComments,
    errors: errors.slice(0, 20),
  });
}
