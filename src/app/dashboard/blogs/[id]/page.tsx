import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { BlogManager } from "@/components/blog/BlogManager";

export const dynamic = "force-dynamic";

export default async function ManageBlogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blogId = parseInt(id, 10);
  if (!blogId) notFound();

  const user = await getCurrentUser();
  if (!user) notFound();

  const where = user.isAdmin
    ? { id: blogId }
    : {
        id: blogId,
        OR: [{ ownerId: user.userId }, { collaborators: { some: { userId: user.userId } } }],
      };

  const blog = await prisma.blog.findFirst({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      slug: true,
      coverImageUrl: true,
      isPublished: true,
      sourceUrl: true,
      ownerId: true,
      posts: {
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        select: { id: true, title: true, slug: true, status: true, publishedAt: true },
      },
    },
  });
  if (!blog) notFound();

  const canDelete = user.isAdmin || blog.ownerId === user.userId;

  return (
    <BlogManager
      canDelete={canDelete}
      blog={{
        id: blog.id,
        title: blog.title,
        description: blog.description,
        slug: blog.slug,
        coverImageUrl: blog.coverImageUrl,
        isPublished: blog.isPublished,
        sourceUrl: blog.sourceUrl,
        posts: blog.posts.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          status: p.status,
          publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
        })),
      }}
    />
  );
}
