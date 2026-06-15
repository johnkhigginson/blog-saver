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
import { cdxSearch, rawSnapshotUrl, isThrottle } from "@/lib/wayback";
import { ccListPosts, ccFetchHtml, type CcRecord } from "@/lib/commoncrawl";
import { normalizeBlogUrl, upgradeBloggerImage, decodeEntities, type BloggerPost } from "@/lib/blogger";

const UA = "Mozilla/5.0 (compatible; BlogSaver/1.0; blog archival)";

// A recoverable post located in one of the web archives. Carries the
// source-specific coordinates needed to fetch its HTML.
export interface ArchivedPost {
  permalink: string; // canonical https URL (hostname + path; no port/query)
  source: "commoncrawl" | "wayback";
  cc?: CcRecord;
  wayback?: { original: string; timestamp: string };
}

function isBloggerPostPath(u: string): boolean {
  try {
    const { pathname } = new URL(u);
    return /^\/\d{4}\/\d{2}\/[^/]+\.html$/i.test(pathname);
  } catch {
    return false;
  }
}

export interface ArchiveListing {
  posts: ArchivedPost[];
  warnings: string[]; // e.g. an archive was unreachable, so the list may be incomplete
}

const listCache = new Map<string, { at: number; listing: ArchiveListing }>();
const LIST_TTL_MS = 15 * 60_000;

// Every unique Blogger post recoverable from the web archives, with the
// source-specific coordinates needed to fetch each. Unions Common Crawl (usually
// the richer source for a deleted blog) with the Wayback Machine (fills gaps).
// `warnings` flags when a source was unavailable, so a partial result is never
// silently presented as complete. Cached briefly so the recovery route re-lists
// cheaply across batches.
export async function listArchivedPosts(blogUrl: string): Promise<ArchiveListing> {
  const host = new URL(normalizeBlogUrl(blogUrl)).host;
  const cached = listCache.get(host);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.listing;

  const byPermalink = new Map<string, ArchivedPost>();
  const warnings: string[] = [];

  // Common Crawl first (typically the most complete archive of a deleted blog).
  try {
    for (const rec of await ccListPosts(blogUrl)) {
      if (!byPermalink.has(rec.permalink)) {
        byPermalink.set(rec.permalink, { permalink: rec.permalink, source: "commoncrawl", cc: rec });
      }
    }
  } catch {
    warnings.push(
      "Common Crawl was unreachable (its index server is intermittently down). Re-run recovery later to pull in the posts it has."
    );
  }

  // Wayback fills any posts Common Crawl didn't have.
  try {
    const rows = await cdxSearch(`${host}/`, {
      matchType: "prefix",
      filterStatus: "200",
      collapse: "urlkey",
      limit: 20000,
    });
    for (const r of rows) {
      if (!isBloggerPostPath(r.originalUrl)) continue;
      try {
        const u = new URL(r.originalUrl);
        const permalink = `https://${u.hostname}${u.pathname}`;
        if (!byPermalink.has(permalink)) {
          byPermalink.set(permalink, {
            permalink,
            source: "wayback",
            wayback: { original: r.originalUrl, timestamp: r.timestamp },
          });
        }
      } catch {
        /* skip unparseable */
      }
    }
  } catch (e) {
    // If both sources failed, surface the error; otherwise proceed with what we
    // have and warn that the list may be incomplete.
    if (byPermalink.size === 0) throw e;
    warnings.push(
      isThrottle(e)
        ? "The Wayback Machine was rate-limiting requests. Re-run later for any posts only it has."
        : "The Wayback Machine could not be reached. Re-run later for any posts only it has."
    );
  }

  const posts = [...byPermalink.values()].sort((a, b) => a.permalink.localeCompare(b.permalink));
  const listing: ArchiveListing = { posts, warnings };
  listCache.set(host, { at: Date.now(), listing });
  return listing;
}

function parseDateLoose(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Scrape one archived Blogger post page into a BloggerPost.
export function scrapeBloggerPostHtml(html: string, permalink: string): BloggerPost | null {
  const $ = cheerio.load(html);

  const title = decodeEntities(
    (
      $(".post-title").first().text() ||
      $(".entry-title").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
  );

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

  const authorRaw =
    ($(".post-author .fn").first().text() ||
      $('meta[name="author"]').attr("content") ||
      $(".author .fn").first().text() ||
      "")
      .replace(/\s+/g, " ")
      .replace(/^posted by\s*/i, "")
      .trim();
  const author = authorRaw ? decodeEntities(authorRaw) : null;

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
    let html: string | null = null;
    if (it.source === "commoncrawl" && it.cc) {
      html = await ccFetchHtml(it.cc);
    } else if (it.source === "wayback" && it.wayback) {
      html = await fetchRawHtml(rawSnapshotUrl(it.wayback.timestamp, it.wayback.original));
    }
    if (!html) continue;
    const post = scrapeBloggerPostHtml(html, it.permalink);
    if (post) posts.push(post);
  }
  return posts;
}
