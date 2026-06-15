import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

type RouteParams = { params: Promise<{ id: string }> };

// Delete a comment. Allowed for an admin, the blog owner or a collaborator
// (moderating their own posts), or the comment's own author.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const commentId = parseInt(id, 10);
  if (!commentId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      userId: true,
      post: {
        select: {
          blog: {
            select: {
              ownerId: true,
              collaborators: { select: { userId: true } },
            },
          },
        },
      },
    },
  });
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const blog = comment.post.blog;
  const isAuthor = comment.userId != null && comment.userId === user.userId;
  const isOwnerOrCollab =
    blog.ownerId === user.userId || blog.collaborators.some((c) => c.userId === user.userId);

  if (!user.isAdmin && !isOwnerOrCollab && !isAuthor) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await prisma.comment.delete({ where: { id: commentId } });

  await audit({
    category: "COMMENT",
    action: "COMMENT_DELETED",
    summary: `${user.name} deleted a comment`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "COMMENT",
    targetId: commentId,
  });

  return NextResponse.json({ success: true });
}
