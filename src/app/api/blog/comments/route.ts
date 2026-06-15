import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPostPubliclyVisible } from "@/lib/blog";
import { getCurrentUser } from "@/lib/auth";
import { audit, clientIp } from "@/lib/audit";
import { sendCommentNotificationEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site";
import { enforceRateLimit } from "@/lib/rate-limit";

// Comments on a published post. Anyone can read; posting requires being signed in.

export async function GET(request: NextRequest) {
  const postId = parseInt(new URL(request.url).searchParams.get("postId") || "", 10);
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });

  if (!(await isPostPubliclyVisible(postId))) {
    return NextResponse.json({ comments: [] });
  }

  const viewer = await getCurrentUser();
  const rows = await prisma.comment.findMany({
    where: { postId, approved: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, authorName: true, body: true, createdAt: true },
  });

  const comments = rows.map((c) => ({
    id: c.id,
    authorName: c.authorName,
    body: c.body,
    createdAt: c.createdAt,
    mine: !!viewer && c.userId === viewer.userId, // lets the author delete their own
  }));
  return NextResponse.json({ comments });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to comment." }, { status: 401 });
  }

  const limited = enforceRateLimit("comment", user.userId, 15, 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const postId = Number(body.postId);
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!postId || !text) {
    return NextResponse.json({ error: "A comment is required." }, { status: 400 });
  }
  if (text.length > 5000) {
    return NextResponse.json({ error: "Comment is too long." }, { status: 400 });
  }

  if (!(await isPostPubliclyVisible(postId))) {
    return NextResponse.json({ error: "Comments are not available for this post." }, { status: 404 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { name: true, email: true },
  });

  const comment = await prisma.comment.create({
    data: { postId, userId: user.userId, authorName: dbUser?.name ?? "Member", body: text },
    select: { id: true, authorName: true, body: true, createdAt: true },
  });

  await audit({
    category: "COMMENT",
    action: "COMMENT_CREATED",
    summary: `${comment.authorName} commented on a post`,
    actorUserId: user.userId,
    actorName: comment.authorName,
    targetType: "POST",
    targetId: postId,
    ip: clientIp(request),
  });

  // Notify the blog owner — best-effort.
  notifyOwner(postId, comment.authorName, comment.body, dbUser?.email ?? null).catch((e) =>
    console.error("[comment] notify failed", e)
  );

  return NextResponse.json({ comment: { ...comment, mine: true } }, { status: 201 });
}

async function notifyOwner(
  postId: number,
  commenterName: string,
  body: string,
  commenterEmail: string | null
) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      title: true,
      slug: true,
      blog: { select: { slug: true, owner: { select: { email: true } } } },
    },
  });
  if (!post) return;

  const recipient = post.blog.owner?.email ?? null;
  // Don't email the owner about their own comment, or if there's no recipient.
  if (!recipient || recipient === commenterEmail) return;
  if (!post.blog.slug) return;

  const postUrl = `${getSiteUrl()}/blog/${post.blog.slug}/${post.slug ?? postId}`;
  await sendCommentNotificationEmail({
    toEmail: recipient,
    commenterName,
    postTitle: post.title,
    commentBody: body,
    postUrl,
  });
}
