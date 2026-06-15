import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Create a new (empty) blog owned by the current user.
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });

  const blog = await prisma.blog.create({
    data: {
      ownerId: user.userId,
      title: title.slice(0, 300),
      description: typeof body?.description === "string" ? body.description.slice(0, 4000) : null,
    },
    select: { id: true, title: true },
  });

  await audit({
    category: "BLOG",
    action: "BLOG_CREATED",
    summary: `${user.name} created blog “${blog.title}”`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "BLOG",
    targetId: blog.id,
  });

  return NextResponse.json({ id: blog.id }, { status: 201 });
}
