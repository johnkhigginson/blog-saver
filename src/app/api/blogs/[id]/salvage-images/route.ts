import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBlogAccess } from "@/lib/auth";
import { salvagePost } from "@/lib/image-salvage";
import { syncPostImages } from "@/lib/post-images";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

// Batched image-salvage pass over a blog's posts. The client calls repeatedly,
// walking the `cursor` (last post id) until `done`. Each batch downloads the
// hero + inline images (live first, then Wayback) and rewrites the post body to
// the local copies. Idempotent: already-localized images are skipped.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blogId = parseInt(id, 10);
  if (!blogId) return NextResponse.json({ error: "Invalid blog id" }, { status: 400 });

  let user;
  try {
    user = await requireBlogAccess(blogId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const cursor = Number(body.cursor) || 0;
  const limit = Math.min(Math.max(parseInt(String(body.limit ?? 3), 10) || 3, 1), 10);

  const posts = await prisma.post.findMany({
    where: { blogId, id: { gt: cursor } },
    select: { id: true, heroImageUrl: true, bodyHtml: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  let converted = 0;
  let failed = 0;
  let throttled = 0;
  let postsProcessed = 0;
  let nextCursor = cursor;
  const errors: string[] = [];

  for (const p of posts) {
    nextCursor = p.id;
    postsProcessed++;
    const r = await salvagePost(p, user.userId);
    if (r.changed) {
      // imageLocalizeFailed is set explicitly (not undefined) so a hero that now
      // succeeds clears a previously-set flag.
      await prisma.post.update({
        where: { id: p.id },
        data: {
          heroImageUrl: r.heroImageUrl,
          bodyHtml: r.bodyHtml,
          imageLocalizeFailed: r.heroFailed,
        },
      });
      await syncPostImages(p.id, r.heroImageUrl, r.bodyHtml);
    } else if (r.heroFailed) {
      await prisma.post.update({ where: { id: p.id }, data: { imageLocalizeFailed: true } });
    }
    converted += r.converted;
    failed += r.failed;
    throttled += r.throttled;
    if (r.errors.length) errors.push(...r.errors);
  }

  const done = posts.length < limit;
  if (done) {
    await audit({
      category: "IMPORT",
      action: "IMAGES_SALVAGED",
      summary: `${user.name} ran image salvage on a blog`,
      actorUserId: user.userId,
      actorName: user.name,
      targetType: "BLOG",
      targetId: blogId,
    });
  }

  return NextResponse.json({
    nextCursor,
    postsProcessed,
    converted,
    failed,
    throttled,
    done,
    errors: errors.slice(0, 15),
  });
}
