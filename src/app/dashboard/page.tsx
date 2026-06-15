import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewBlogButton } from "@/components/blog/NewBlogButton";
import { Rss, LifeBuoy, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const blogs = await prisma.blog.findMany({
    where: { OR: [{ ownerId: user.userId }, { collaborators: { some: { userId: user.userId } } }] },
    select: {
      id: true,
      title: true,
      slug: true,
      isPublished: true,
      updatedAt: true,
      _count: { select: { posts: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Your blogs</h1>
          <p className="text-sm text-muted-foreground">Import, recover, write, and publish.</p>
        </div>
        <NewBlogButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/dashboard/import">
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-3 p-4">
              <Rss className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Import from Blogger</p>
                <p className="text-sm text-muted-foreground">From a live feed or an XML export.</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/recover">
          <Card className="transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-3 p-4">
              <LifeBuoy className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Recover a deleted blog</p>
                <p className="text-sm text-muted-foreground">Rebuild from the Wayback Machine using its old URL.</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {blogs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          No blogs yet. Create one, import from Blogger, or recover a deleted blog.
        </div>
      ) : (
        <div className="space-y-2">
          {blogs.map((blog) => (
            <Link key={blog.id} href={`/dashboard/blogs/${blog.id}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{blog.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {blog._count.posts} {blog._count.posts === 1 ? "post" : "posts"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={blog.isPublished ? "default" : "secondary"}>
                    {blog.isPublished ? "Published" : "Draft"}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
