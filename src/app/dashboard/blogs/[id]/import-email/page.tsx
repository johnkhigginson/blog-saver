import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireBlogAccess } from "@/lib/auth";
import { EmailImportForm } from "@/components/blog/EmailImportForm";

export const dynamic = "force-dynamic";

export default async function ImportEmailPage({ params }: { params: Promise<{ id: string }> }) {
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
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Import from email</h1>
        <p className="text-sm text-muted-foreground">
          Turn weekly emails (e.g. mission letters) into posts. Subject becomes the title, the email
          date becomes the post date, and photo attachments are saved with the post.
        </p>
      </div>
      <EmailImportForm blogId={blogId} />
    </div>
  );
}
