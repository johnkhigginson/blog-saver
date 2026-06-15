import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireBlogAccess } from "@/lib/auth";
import { normalizeBlogUrl } from "@/lib/blogger";
import { listArchivedPostUrls, scrapeArchivedPosts } from "@/lib/recover";
import { importBloggerData } from "@/lib/import-posts";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

// Reconstruct a deleted Blogger blog from the Wayback Machine, given only its
// old URL. Resumable: the client calls repeatedly, advancing `offset` (and
// passing back the returned `blogId`) until `done`. Each batch scrapes a slice
// of archived post pages and imports them. Re-runs are idempotent.
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.blogUrl !== "string" || !body.blogUrl.trim()) {
    return NextResponse.json({ error: "blogUrl is required" }, { status: 400 });
  }

  const offset = Math.max(Number(body.offset) || 0, 0);
  const limit = Math.min(Math.max(parseInt(String(body.limit ?? 12), 10) || 12, 1), 40);

  const sourceUrl = normalizeBlogUrl(body.blogUrl);

  // Resolve the destination blog: an authorized existing one, or find-or-create
  // by (owner, sourceUrl) so batches after the first reuse the same blog even if
  // the client forgets to echo blogId back.
  let blogId: number;
  if (body.blogId != null) {
    try {
      await requireBlogAccess(Number(body.blogId));
    } catch {
      return NextResponse.json({ error: "Not authorized for that blog." }, { status: 403 });
    }
    blogId = Number(body.blogId);
  } else {
    let blog = await prisma.blog.findFirst({
      where: { ownerId: user.userId, sourceUrl },
      select: { id: true },
    });
    if (!blog) {
      const title = (body.blogTitle || new URL(sourceUrl).host).toString().slice(0, 300);
      blog = await prisma.blog.create({
        data: { ownerId: user.userId, title, sourceUrl, description: `Recovered from ${sourceUrl}` },
        select: { id: true },
      });
    }
    blogId = blog.id;
  }

  let urls: string[];
  try {
    urls = await listArchivedPostUrls(body.blogUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wayback lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const total = urls.length;
  if (total === 0) {
    return NextResponse.json({
      blogId,
      total: 0,
      processed: 0,
      nextOffset: 0,
      done: true,
      imported: 0,
      updated: 0,
      message: "No archived posts found for that URL. Try the blog's exact old address.",
    });
  }

  const slice = urls.slice(offset, offset + limit);
  const posts = await scrapeArchivedPosts(slice);
  const summary = await importBloggerData(
    blogId,
    { blogTitle: "", posts, comments: [] },
    { sourceType: "WAYBACK" }
  );

  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  if (done) {
    await audit({
      category: "IMPORT",
      action: "BLOG_RECOVERED",
      summary: `${user.name} recovered a blog from the Wayback Machine (${total} archived posts)`,
      actorUserId: user.userId,
      actorName: user.name,
      targetType: "BLOG",
      targetId: blogId,
      metadata: { total, sourceUrl },
    });
  }

  return NextResponse.json({
    blogId,
    total,
    processed: nextOffset,
    nextOffset,
    done,
    batchScraped: posts.length,
    imported: summary.imported,
    updated: summary.updated,
    errors: summary.errors.slice(0, 15),
  });
}
