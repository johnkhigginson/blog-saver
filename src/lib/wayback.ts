// Wayback Machine (web.archive.org) client. Used to recover images and posts
// that the original Blogger/Google host has deleted.
//
// Two endpoints are used:
//   1. Availability API  (archive.org/wayback/available) — closest snapshot of
//      one URL. Fast, good for a single image.
//   2. CDX server        (web.archive.org/cdx/search/cdx) — enumerate every
//      capture matching a URL/pattern. Used to list a deleted blog's pages and
//      to find an archived image when the availability API misses.
//
// All requests go through the SSRF-guarded fetch (archive.org is public, but the
// guard still blocks any redirect to a private address).

import { safeFetch } from "@/lib/ssrf";

const UA = "Mozilla/5.0 (compatible; BlogSaver/1.0; blog archival)";

export interface WaybackSnapshot {
  originalUrl: string;
  timestamp: string; // YYYYMMDDhhmmss
  statusCode: string;
  mimeType: string;
  snapshotUrl: string; // raw (id_) capture URL — original bytes, no toolbar
}

// The `id_` modifier returns the archived resource's ORIGINAL bytes, without the
// Wayback navigation toolbar/banner that a normal /web/<ts>/ URL injects. This
// is essential for both clean image bytes and parseable post HTML.
export function rawSnapshotUrl(timestamp: string, originalUrl: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${originalUrl}`;
}

// Closest capture of a single URL via the availability API.
export async function closestSnapshot(
  url: string,
  timestamp?: string
): Promise<WaybackSnapshot | null> {
  const params = new URLSearchParams({ url });
  if (timestamp) params.set("timestamp", timestamp);
  const api = `https://archive.org/wayback/available?${params.toString()}`;
  try {
    const res = await safeFetch(api, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const closest = json?.archived_snapshots?.closest;
    if (!closest?.available || !closest.timestamp) return null;
    return {
      originalUrl: url,
      timestamp: String(closest.timestamp),
      statusCode: String(closest.status ?? "200"),
      mimeType: "",
      snapshotUrl: rawSnapshotUrl(String(closest.timestamp), url),
    };
  } catch {
    return null;
  }
}

export interface CdxOptions {
  matchType?: "exact" | "prefix" | "host" | "domain";
  limit?: number;
  filterStatus?: string; // e.g. "200"
  mimePrefix?: string; // e.g. "image/" → regex filter mimetype:image/.*
  collapse?: string; // e.g. "urlkey" to dedupe by URL
}

// Query the CDX server. Returns one row per capture (deduped/filtered per opts).
export async function cdxSearch(urlPattern: string, opts: CdxOptions = {}): Promise<WaybackSnapshot[]> {
  const params = new URLSearchParams({
    url: urlPattern,
    output: "json",
    fl: "original,timestamp,statuscode,mimetype",
  });
  if (opts.matchType) params.set("matchType", opts.matchType);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.collapse) params.set("collapse", opts.collapse);
  if (opts.filterStatus) params.append("filter", `statuscode:${opts.filterStatus}`);
  if (opts.mimePrefix) params.append("filter", `mimetype:${opts.mimePrefix}.*`);

  const api = `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
  try {
    const res = await safeFetch(api, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as string[][];
    if (!Array.isArray(rows) || rows.length <= 1) return [];
    // Row 0 is the column header.
    return rows.slice(1).map(([original, timestamp, statuscode, mimetype]) => ({
      originalUrl: original,
      timestamp,
      statusCode: statuscode,
      mimeType: mimetype,
      snapshotUrl: rawSnapshotUrl(timestamp, original),
    }));
  } catch {
    return [];
  }
}

// Find the best archived capture of a single image: try the availability API,
// then fall back to a CDX lookup constrained to successful image captures.
export async function findArchivedImage(originalUrl: string): Promise<WaybackSnapshot | null> {
  const closest = await closestSnapshot(originalUrl);
  if (closest) return closest;
  const hits = await cdxSearch(originalUrl, {
    matchType: "exact",
    filterStatus: "200",
    mimePrefix: "image/",
    limit: 1,
  });
  return hits[0] ?? null;
}
