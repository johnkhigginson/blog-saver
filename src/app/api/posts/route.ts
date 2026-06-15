import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBlogAccess } from "@/lib/auth";
import { sanitizeBlogHtml } from "@/lib/sanitize";
import { uniquePostSlug } from "@/lib/slug-db";
import { setPostTags } from "@/lib/tags";
import { syncPostImages } from "@/lib/post-images";
import { htmlToText, excerpt } from "@/lib/blogger";
import { audit } from "@/lib/audit";

// Create a post in a blog the user owns/collaborates on.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const blogId = Number(body.blogId);
  if (!blogId) return NextResponse.json({ error: "blogId is required" }, { status: 400 });

  let user;
  try {
    user = await requireBlogAccess(blogId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });

  const bodyHtml = sanitizeBlogHtml(typeof body.bodyHtml === "string" ? body.bodyHtml : "");
  const status = body.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
  const slug = await uniquePostSlug(blogId, typeof body.slug === "string" && body.slug.trim() ? body.slug : title);

  const summary =
    typeof body.excerpt === "string" && body.excerpt.trim()
      ? body.excerpt.trim().slice(0, 4000)
      : (() => {
          const plain = htmlToText(bodyHtml);
          return plain ? excerpt(plain) : null;
        })();

  const post = await prisma.post.create({
    data: {
      blogId,
      authorId: user.userId,
      title: title.slice(0, 500),
      slug,
      excerpt: summary,
      bodyHtml,
      heroImageUrl: typeof body.heroImageUrl === "string" && body.heroImageUrl ? body.heroImageUrl.slice(0, 2000) : null,
      status,
      sourceType: "MANUAL",
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
    select: { id: true, slug: true },
  });

  if (Array.isArray(body.tags)) await setPostTags(post.id, body.tags, false);
  await syncPostImages(post.id, body.heroImageUrl ?? null, bodyHtml);

  await audit({
    category: "POST",
    action: "POST_CREATED",
    summary: `${user.name} created post “${title}”`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "POST",
    targetId: post.id,
  });

  return NextResponse.json({ id: post.id, slug: post.slug }, { status: 201 });
}
