import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogShell } from "@/components/blog/BlogShell";
import { Badge } from "@/components/ui/badge";
import { getPublishedBlogBySlug, formatBlogDate } from "@/lib/blog";
import { absoluteUrl, getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const blog = await getPublishedBlogBySlug(slug);
  if (!blog) return { title: "Not found" };

  const cover = absoluteUrl(blog.coverImageUrl ?? blog.posts.find((p) => p.heroImageUrl)?.heroImageUrl);
  const url = `${getSiteUrl()}/blog/${slug}`;
  return {
    title: blog.title,
    description: blog.description ?? undefined,
    alternates: {
      canonical: url,
      types: { "application/rss+xml": `${url}/rss.xml` },
    },
    openGraph: {
      type: "website",
      title: blog.title,
      description: blog.description ?? undefined,
      url,
      images: cover ? [cover] : undefined,
    },
  };
}

export default async function BlogPage({ params }: PageProps) {
  const { slug } = await params;
  const blog = await getPublishedBlogBySlug(slug);
  if (!blog) notFound();

  return (
    <BlogShell homeHref={`/blog/${blog.slug}`} homeLabel={blog.title} aboutHref={`/blog/${blog.slug}/about`} wide>
      {blog.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={blog.coverImageUrl} alt={blog.title} className="mb-6 h-56 w-full rounded-2xl object-cover" />
      )}
      <h1 className="mb-1 font-display text-4xl font-semibold tracking-tight">{blog.title}</h1>
      {blog.description && <p className="mb-8 text-muted-foreground">{blog.description}</p>}

      {blog.posts.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">No posts published yet.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {blog.posts.map((post) => (
            <article key={post.id} className="flex gap-4 py-6">
              {post.heroImageUrl && (
                <Link href={`/blog/${blog.slug}/${post.slug ?? post.id}`} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.heroImageUrl}
                    alt={post.title}
                    className="h-24 w-24 rounded-xl object-cover sm:h-28 sm:w-40"
                  />
                </Link>
              )}
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold leading-snug">
                  <Link href={`/blog/${blog.slug}/${post.slug ?? post.id}`} className="hover:text-primary">
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {post.publishedAt && formatBlogDate(post.publishedAt)}
                  {post.author?.name ? ` · by ${post.author.name}` : ""}
                </p>
                {post.excerpt && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>
                )}
                {post.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {post.tags.slice(0, 4).map(({ tag }) => (
                      <Badge key={tag.name} variant="outline">
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </BlogShell>
  );
}
