import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireBlogAccess } from "@/lib/auth";
import { PostEditorForm } from "@/components/editor/PostEditorForm";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (!postId) notFound();

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      blogId: true,
      title: true,
      slug: true,
      excerpt: true,
      bodyHtml: true,
      heroImageUrl: true,
      status: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!post) notFound();
  try {
    await requireBlogAccess(post.blogId);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/blogs/${post.blogId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to blog
      </Link>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Edit post</h1>
      <PostEditorForm
        blogId={post.blogId}
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          bodyHtml: post.bodyHtml,
          heroImageUrl: post.heroImageUrl,
          status: post.status,
          tags: post.tags.map((t) => t.tag.name),
        }}
      />
    </div>
  );
}
