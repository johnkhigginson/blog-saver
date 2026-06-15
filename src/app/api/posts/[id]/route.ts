import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBlogAccess } from "@/lib/auth";
import { sanitizeBlogHtml } from "@/lib/sanitize";
import { uniquePostSlug } from "@/lib/slug-db";
import { setPostTags } from "@/lib/tags";
import { audit } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!postId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, blogId: true, status: true, publishedAt: true, title: true },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let user;
  try {
    user = await requireBlogAccess(post.blogId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 500);
  if (typeof body.bodyHtml === "string") data.bodyHtml = sanitizeBlogHtml(body.bodyHtml);
  if (typeof body.excerpt === "string") data.excerpt = body.excerpt.slice(0, 4000) || null;
  if (typeof body.heroImageUrl === "string") data.heroImageUrl = body.heroImageUrl.slice(0, 2000) || null;

  if (typeof body.slug === "string" && body.slug.trim()) {
    data.slug = await uniquePostSlug(post.blogId, body.slug, postId);
  }

  if (body.status === "PUBLISHED" || body.status === "DRAFT") {
    data.status = body.status;
    if (body.status === "PUBLISHED" && !post.publishedAt) data.publishedAt = new Date();
  }

  // Allow setting an explicit publish date (e.g. preserving the original date).
  if (typeof body.publishedAt === "string") {
    const d = new Date(body.publishedAt);
    if (!Number.isNaN(d.getTime())) data.publishedAt = d;
  }

  const updated = await prisma.post.update({
    where: { id: postId },
    data,
    select: { id: true, slug: true, title: true },
  });

  if (Array.isArray(body.tags)) await setPostTags(postId, body.tags, true);

  await audit({
    category: "POST",
    action: "POST_UPDATED",
    summary: `${user.name} updated post “${updated.title}”`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "POST",
    targetId: postId,
  });

  return NextResponse.json({ id: updated.id, slug: updated.slug });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!postId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { blogId: true, title: true },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let user;
  try {
    user = await requireBlogAccess(post.blogId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await prisma.post.delete({ where: { id: postId } });

  await audit({
    category: "POST",
    action: "POST_DELETED",
    summary: `${user.name} deleted post “${post.title}”`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "POST",
    targetId: postId,
  });

  return NextResponse.json({ success: true });
}
