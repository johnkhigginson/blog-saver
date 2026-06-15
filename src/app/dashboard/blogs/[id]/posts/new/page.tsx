import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireBlogAccess } from "@/lib/auth";
import { PostEditorForm } from "@/components/editor/PostEditorForm";

export const dynamic = "force-dynamic";

export default async function NewPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blogId = parseInt(id, 10);
  if (!blogId) notFound();
  try {
    await requireBlogAccess(blogId);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Link
        href={`/dashboard/blogs/${blogId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to blog
      </Link>
      <h1 className="font-display text-2xl font-semibold tracking-tight">New post</h1>
      <PostEditorForm blogId={blogId} />
    </div>
  );
}
