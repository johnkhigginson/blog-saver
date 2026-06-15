import Link from "next/link";
import { notFound } from "next/navigation";
import { BlogShell } from "@/components/blog/BlogShell";
import { ArrowLeft } from "lucide-react";
import { getPublishedBlogAuthors } from "@/lib/blog";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const data = await getPublishedBlogAuthors(slug);
  if (!data) return { title: "Not found" };
  return {
    title: `About — ${data.blog.title}`,
    alternates: { canonical: `${getSiteUrl()}/blog/${slug}/about` },
  };
}

export default async function AboutPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getPublishedBlogAuthors(slug);
  if (!data) notFound();

  const { blog, authors } = data;
  const withBio = authors.filter((a) => a.bio || a.avatarUrl);
  const shown = withBio.length > 0 ? withBio : authors;

  return (
    <BlogShell homeHref={`/blog/${blog.slug}`} homeLabel={blog.title} aboutHref={`/blog/${blog.slug}/about`}>
      <Link
        href={`/blog/${blog.slug}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {blog.title}
      </Link>

      <h1 className="font-display text-4xl font-semibold tracking-tight">About</h1>
      {blog.description && <p className="mt-2 text-muted-foreground">{blog.description}</p>}

      <div className="mt-8 space-y-8">
        {shown.length === 0 && <p className="text-muted-foreground">The people behind {blog.title}.</p>}
        {shown.map((author) => (
          <div key={author.id} className="flex gap-4">
            {author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={author.avatarUrl}
                alt={author.name}
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
                {author.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="font-display text-xl font-semibold">{author.name}</h2>
              {author.bio ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{author.bio}</p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Contributor to {blog.title}.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </BlogShell>
  );
}
