import { NextResponse } from "next/server";
import { getPublishedBlogBySlug } from "@/lib/blog";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ slug: string }> };

function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// RSS 2.0 feed for a published blog so readers can follow new posts.
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const blog = await getPublishedBlogBySlug(slug);
  if (!blog) return new NextResponse("Not found", { status: 404 });

  const site = getSiteUrl();
  const feedUrl = `${site}/blog/${slug}`;

  const items = blog.posts
    .map((p) => {
      const link = `${feedUrl}/${p.slug ?? p.id}`;
      const date = (p.publishedAt ?? new Date()).toUTCString();
      const desc = p.excerpt ?? "";
      return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${date}</pubDate>
      <description>${xml(desc)}</description>
    </item>`;
    })
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xml(blog.title)}</title>
    <link>${xml(feedUrl)}</link>
    <description>${xml(blog.description ?? `Posts from ${blog.title}`)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new NextResponse(rss, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
