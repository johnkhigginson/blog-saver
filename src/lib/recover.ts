// Recover a Blogger blog that has been taken down, using only its old URL.
// Strategy:
//   1. Enumerate every archived page for the domain via the Wayback CDX server.
//   2. Keep the ones whose path looks like a Blogger post permalink
//      (/YYYY/MM/slug.html).
//   3. Fetch each one's raw archived HTML (id_ capture) and scrape the title,
//      body, date, labels, and author into the same BloggerPost shape the
//      importer already understands.
// Inline images stay as their original (dead) URLs here; the image-salvage pass
// then recovers them from the Wayback Machine too.

import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/ssrf";
import { cdxSearch, closestSnapshot } from "@/lib/wayback";
import { normalizeBlogUrl, upgradeBloggerImage, type BloggerPost } from "@/lib/blogger";

const UA = "Mozilla/5.0 (compatible; BlogSaver/1.0; blog archival)";

function isBloggerPostPath(u: string): boolean {
  try {
    const { pathname } = new URL(u);
    return /^\/\d{4}\/\d{2}\/[^/]+\.html$/i.test(pathname);
  } catch {
    return false;
  }
}

// Every unique Blogger post URL the Wayback Machine has a capture for.
export async function listArchivedPostUrls(blogUrl: string): Promise<string[]> {
  const origin = normalizeBlogUrl(blogUrl);
  const host = new URL(origin).host;
  const rows = await cdxSearch(`${host}/`, {
    matchType: "prefix",
    filterStatus: "200",
    collapse: "urlkey",
    limit: 20000,
  });
  const urls = new Set<string>();
  for (const r of rows) {
    // Normalize scheme so http/https variants of the same post collapse.
    if (isBloggerPostPath(r.originalUrl)) urls.add(r.originalUrl.replace(/^http:\/\//i, "https://"));
  }
  return [...urls].sort();
}

function parseDateLoose(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Scrape one archived Blogger post page into a BloggerPost.
export function scrapeBloggerPostHtml(html: string, permalink: string): BloggerPost | null {
  const $ = cheerio.load(html);

  const title = (
    $(".post-title").first().text() ||
    $(".entry-title").first().text() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").text() ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const bodyEl = $(".post-body").first().length
    ? $(".post-body").first()
    : $(".entry-content").first();
  const contentHtml = bodyEl.length ? (bodyEl.html() ?? "") : "";

  if (!title && !contentHtml) return null;

  let published =
    parseDateLoose($("time.published").attr("datetime")) ||
    parseDateLoose($('meta[property="article:published_time"]').attr("content")) ||
    parseDateLoose($("abbr.published").attr("title")) ||
    parseDateLoose($(".date-header span").first().text());
  if (!published) {
    const m = permalink.match(/\/(\d{4})\/(\d{2})\//);
    if (m) published = parseDateLoose(`${m[1]}-${m[2]}-01T00:00:00Z`);
  }

  const labels = new Set<string>();
  $("a[rel='tag'], .post-labels a, .post-tags a").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) labels.add(t);
  });

  const imgMatch = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  const imageUrl = upgradeBloggerImage(imgMatch ? imgMatch[1] : null);

  const author =
    ($(".post-author .fn").first().text() ||
      $('meta[name="author"]').attr("content") ||
      $(".author .fn").first().text() ||
      "")
      .replace(/\s+/g, " ")
      .replace(/^posted by\s*/i, "")
      .trim() || null;

  return {
    title: title || "Untitled post",
    contentHtml,
    permalink,
    publishedAt: published,
    labels: [...labels],
    imageUrl,
    author,
  };
}

async function fetchRawHtml(snapshotUrl: string): Promise<string | null> {
  try {
    const res = await safeFetch(snapshotUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Scrape a slice of archived post URLs into BloggerPosts (sequential to stay
// gentle on archive.org's rate limits).
export async function scrapeArchivedPosts(urls: string[]): Promise<BloggerPost[]> {
  const posts: BloggerPost[] = [];
  for (const url of urls) {
    const snap = await closestSnapshot(url);
    if (!snap) continue;
    const html = await fetchRawHtml(snap.snapshotUrl);
    if (!html) continue;
    const post = scrapeBloggerPostHtml(html, url);
    if (post) posts.push(post);
  }
  return posts;
}
