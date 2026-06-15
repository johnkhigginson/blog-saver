// Recover a Blogger blog that has been taken down, using only its old URL.
// Strategy:
//   1. Enumerate every archived page for the domain via the Wayback CDX server.
//   2. Keep the ones whose path looks like a Blogger post permalink
//      (/YYYY/MM/slug.html), deduped by canonical path.
//   3. Fetch each one's raw archived HTML (id_ capture, built straight from the
//      CDX row's timestamp + original URL — NOT the availability API, which is
//      flaky and scheme-sensitive) and scrape it into a BloggerPost.
// Inline images stay as their original (dead) URLs here; the image-salvage pass
// then recovers them from the Wayback Machine too.

import * as cheerio from "cheerio";
import { safeFetch } from "@/lib/ssrf";
import { cdxSearch, rawSnapshotUrl } from "@/lib/wayback";
import { normalizeBlogUrl, upgradeBloggerImage, type BloggerPost } from "@/lib/blogger";

const UA = "Mozilla/5.0 (compatible; BlogSaver/1.0; blog archival)";

export interface ArchivedPost {
  permalink: string; // canonical https URL (hostname + path; no port/query)
  original: string; // exact CDX original (scheme/port/query as captured) — used to build the snapshot URL
  timestamp: string;
}

function isBloggerPostPath(u: string): boolean {
  try {
    const { pathname } = new URL(u);
    return /^\/\d{4}\/\d{2}\/[^/]+\.html$/i.test(pathname);
  } catch {
    return false;
  }
}

// Every unique Blogger post the Wayback Machine has a capture for, with the
// capture coordinates needed to fetch it.
export async function listArchivedPosts(blogUrl: string): Promise<ArchivedPost[]> {
  const origin = normalizeBlogUrl(blogUrl);
  const host = new URL(origin).host;
  const rows = await cdxSearch(`${host}/`, {
    matchType: "prefix",
    filterStatus: "200",
    collapse: "urlkey",
    limit: 20000,
  });

  const byPermalink = new Map<string, ArchivedPost>();
  for (const r of rows) {
    if (!isBloggerPostPath(r.originalUrl)) continue;
    let u: URL;
    try {
      u = new URL(r.originalUrl);
    } catch {
      continue;
    }
    // Canonical permalink: https + hostname (drop :80) + path, no query — so
    // http/https, :80, and ?m=0/?m=1 mobile variants collapse to one post.
    const permalink = `https://${u.hostname}${u.pathname}`;
    const existing = byPermalink.get(permalink);
    const isClean = !u.search;
    // Prefer a capture of the clean (query-less) URL when we have one.
    if (!existing || (isClean && existing.original.includes("?"))) {
      byPermalink.set(permalink, { permalink, original: r.originalUrl, timestamp: r.timestamp });
    }
  }
  return [...byPermalink.values()].sort((a, b) => a.permalink.localeCompare(b.permalink));
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
    parseDateLoose($(".date-header span").first().text()) ||
    parseDateLoose($(".date-header").first().text());
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
    sourceId: null, // recovered posts are matched by permalink (the archived URL)
    publishedAt: published,
    labels: [...labels],
    imageUrl,
    author,
  };
}

async function fetchRawHtml(snapshotUrl: string): Promise<string | null> {
  try {
    const res = await safeFetch(
      snapshotUrl,
      { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(25000) },
      { maxBytes: 15 * 1024 * 1024 }
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Scrape a slice of archived posts into BloggerPosts (sequential to stay gentle
// on archive.org's rate limits). Builds the snapshot URL directly from each
// capture's timestamp + original.
export async function scrapeArchivedPosts(items: ArchivedPost[]): Promise<BloggerPost[]> {
  const posts: BloggerPost[] = [];
  for (const it of items) {
    const html = await fetchRawHtml(rawSnapshotUrl(it.timestamp, it.original));
    if (!html) continue;
    const post = scrapeBloggerPostHtml(html, it.permalink);
    if (post) posts.push(post);
  }
  return posts;
}
