import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireBlogAccess } from "@/lib/auth";
import {
  fetchAllBloggerPosts,
  parseBloggerXmlExport,
  normalizeBlogUrl,
  type BloggerImport,
} from "@/lib/blogger";
import { importBloggerData } from "@/lib/import-posts";
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

  const summary = await importBloggerData(blogId, data, { updateExisting: input.updateExisting });
  const blog = await prisma.blog.findUnique({ where: { id: blogId }, select: { title: true } });

  await audit({
    category: "IMPORT",
    action: "BLOG_IMPORTED",
    summary: `${user.name} imported “${blog?.title ?? "blog"}” — ${summary.imported} new, ${summary.updated} updated, ${summary.importedComments} comments`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "BLOG",
    targetId: blogId,
    metadata: { ...summary, totalPosts: data.posts.length },
  });

  return NextResponse.json({
    blogId,
    blogTitle: blog?.title ?? data.blogTitle,
    totalPosts: data.posts.length,
    imported: summary.imported,
    updated: summary.updated,
    skipped: summary.skipped,
    importedComments: summary.importedComments,
    errors: summary.errors.slice(0, 20),
  });
}
