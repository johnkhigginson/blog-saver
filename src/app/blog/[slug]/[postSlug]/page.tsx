import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogShell, PROSE_CLASS } from "@/components/blog/BlogShell";
import { PostComments } from "@/components/blog/PostComments";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Globe } from "lucide-react";
import { getPublishedPost, formatBlogDate } from "@/lib/blog";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeBlogHtml } from "@/lib/sanitize";
import { absoluteUrl, getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string; postSlug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug, postSlug } = await params;
  const data = await getPublishedPost(slug, postSlug);
  if (!data) return { title: "Not found" };

  const { post } = data;
  const image = absoluteUrl(post.heroImageUrl);
  const url = `${getSiteUrl()}/blog/${slug}/${post.slug ?? post.id}`;
  return {
    title: post.title,
    description: post.excerpt ?? undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt ?? undefined,
      url,
      images: image ? [image] : undefined,
      publishedTime: post.publishedAt?.toISOString(),
      authors: post.author?.name ? [post.author.name] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: post.title,
      description: post.excerpt ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug, postSlug } = await params;
  const data = await getPublishedPost(slug, postSlug);
  if (!data) notFound();

  const { blog, post } = data;

  // The blog owner / a collaborator / an admin may moderate comments.
  const user = await getCurrentUser();
  let canModerate = false;
  if (user) {
    if (user.isAdmin) {
      canModerate = true;
    } else {
      const owned = await prisma.blog.findFirst({
        where: {
          slug,
          OR: [{ ownerId: user.userId }, { collaborators: { some: { userId: user.userId } } }],
        },
        select: { id: true },
      });
      canModerate = !!owned;
    }
  }

  const byline = post.author?.name ?? post.originalAuthor ?? null;

  return (
    <BlogShell homeHref={`/blog/${blog.slug}`} homeLabel={blog.title} aboutHref={`/blog/${blog.slug}/about`}>
      <Link
        href={`/blog/${blog.slug}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All posts
      </Link>

      <article>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{post.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {post.publishedAt && formatBlogDate(post.publishedAt)}
          {byline ? (
            <>
              {" · by "}
              {post.author?.name ? (
                <Link href={`/blog/${blog.slug}/about`} className="text-primary hover:underline">
                  {byline}
                </Link>
              ) : (
                byline
              )}
            </>
          ) : null}
        </p>

        {post.heroImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.heroImageUrl} alt={post.title} className="mt-5 w-full rounded-2xl object-cover" />
        )}

        {(post.sourceUrl || post.tags.length > 0) && (
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {post.sourceUrl && (
              <a
                href={post.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Globe className="h-4 w-4" /> Original post
              </a>
            )}
            {post.tags.map(({ tag }) => (
              <Badge key={tag.name} variant="outline">
                {tag.name}
              </Badge>
            ))}
          </div>
        )}

        {/* The preserved post body, sanitized again at render as defense in depth. */}
        <div
          className={`mt-6 ${PROSE_CLASS}`}
          dangerouslySetInnerHTML={{ __html: sanitizeBlogHtml(post.bodyHtml) }}
        />

        {post.author?.bio && (
          <div className="mt-10 rounded-2xl border border-border/60 bg-card/50 p-5">
            <p className="text-sm font-semibold">About {post.author.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{post.author.bio}</p>
          </div>
        )}

        <PostComments postId={post.id} canModerate={canModerate} />
      </article>
    </BlogShell>
  );
}
