import Link from "next/link";
import { redirect } from "next/navigation";
import { BlogShell } from "@/components/blog/BlogShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookMarked } from "lucide-react";
import { getPublishedBlogs } from "@/lib/blog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Blogs",
  description: "Browse published blogs.",
};

export default async function BlogIndexPage() {
  const blogs = await getPublishedBlogs();

  // With a single published blog, skip the index and go straight to it.
  if (blogs.length === 1 && blogs[0].slug) {
    redirect(`/blog/${blogs[0].slug}`);
  }

  return (
    <BlogShell>
      <h1 className="mb-1 font-display text-4xl font-semibold tracking-tight">Blogs</h1>
      <p className="mb-8 text-muted-foreground">Browse published blogs.</p>

      {blogs.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">No published blogs yet. Check back soon.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {blogs.map((blog) => (
            <Link key={blog.id} href={`/blog/${blog.slug}`}>
              <Card className="group h-full overflow-hidden p-0 transition-all hover:shadow-md">
                {blog.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blog.coverImageUrl} alt={blog.title} className="h-40 w-full object-cover" />
                )}
                <CardContent className="p-5">
                  <div className="flex items-center gap-2">
                    <BookMarked className="h-4 w-4 text-primary" />
                    <h2 className="font-display text-lg font-semibold group-hover:text-primary">{blog.title}</h2>
                  </div>
                  {blog.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{blog.description}</p>
                  )}
                  <Badge variant="secondary" className="mt-3">
                    {blog._count.posts} {blog._count.posts === 1 ? "post" : "posts"}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </BlogShell>
  );
}
