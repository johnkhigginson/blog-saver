import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBlogAccess, getCurrentUser } from "@/lib/auth";
import { uniqueBlogSlug } from "@/lib/slug-db";
import { audit } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

// Update blog settings (title, description, cover, slug, publish state).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const blogId = parseInt(id, 10);
  if (!blogId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let user;
  try {
    user = await requireBlogAccess(blogId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const current = await prisma.blog.findUnique({
    where: { id: blogId },
    select: { ownerId: true, title: true, slug: true, isPublished: true, publishedAt: true },
  });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // Blog-level visibility and the public URL are owner/admin only — a
  // collaborator can edit content but cannot publish/unpublish or rename the
  // public address (mirrors the owner-only DELETE below).
  const wantsVisibilityChange =
    typeof body.isPublished === "boolean" || (typeof body.slug === "string" && body.slug.trim());
  if (wantsVisibilityChange && !user.isAdmin && current.ownerId !== user.userId) {
    return NextResponse.json(
      { error: "Only the blog owner can publish or change its public address." },
      { status: 403 }
    );
  }

  const data: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 300);
  if (typeof body.description === "string") data.description = body.description.slice(0, 4000) || null;
  if (typeof body.coverImageUrl === "string") data.coverImageUrl = body.coverImageUrl.slice(0, 2000) || null;

  // Explicit slug change.
  if (typeof body.slug === "string" && body.slug.trim()) {
    data.slug = await uniqueBlogSlug(body.slug, blogId);
  }

  if (typeof body.isPublished === "boolean") {
    data.isPublished = body.isPublished;
    if (body.isPublished) {
      // Publishing needs a slug; generate one from the title if absent.
      if (!current.slug && !data.slug) {
        data.slug = await uniqueBlogSlug((data.title as string) ?? current.title, blogId);
      }
      if (!current.publishedAt) data.publishedAt = new Date();
    }
  }

  const blog = await prisma.blog.update({
    where: { id: blogId },
    data,
    select: { id: true, title: true, slug: true, isPublished: true },
  });

  await audit({
    category: "BLOG",
    action: "BLOG_UPDATED",
    summary: `${user.name} updated blog “${blog.title}”`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "BLOG",
    targetId: blogId,
  });

  return NextResponse.json({ blog });
}

// Delete a blog (and, via cascade, its posts/comments/tags). Owner or admin only.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const blogId = parseInt(id, 10);
  if (!blogId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const blog = await prisma.blog.findUnique({ where: { id: blogId }, select: { ownerId: true, title: true } });
  if (!blog) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!user.isAdmin && blog.ownerId !== user.userId) {
    return NextResponse.json({ error: "Only the owner can delete this blog" }, { status: 403 });
  }

  await prisma.blog.delete({ where: { id: blogId } });

  await audit({
    category: "BLOG",
    action: "BLOG_DELETED",
    summary: `${user.name} deleted blog “${blog.title}”`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "BLOG",
    targetId: blogId,
  });

  return NextResponse.json({ success: true });
}
