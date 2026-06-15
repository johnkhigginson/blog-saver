// Common Crawl recovery source. Common Crawl is a separate, petabyte-scale open
// web archive (distinct from the Wayback Machine) with monthly crawl indexes
// going back to 2013. For a deleted blog it often has far more captures than
// Wayback. We query the historical indexes' CDX-style API for the blog's post
// URLs, then fetch each post's original HTML via a ranged WARC GET + gunzip.

import zlib from "node:zlib";
import { safeFetch } from "@/lib/ssrf";
import { normalizeBlogUrl } from "@/lib/blogger";

const UA = "Mozilla/5.0 (compatible; BlogSaver/1.0; blog archival)";
const COLLINFO = "https://index.commoncrawl.org/collinfo.json";
const CACHE_TTL_MS = 15 * 60_000;

export interface CcRecord {
  permalink: string;
  filename: string;
  offset: number;
  length: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface CcIndex {
  id: string;
  "cdx-api": string;
}
let indexCache: CcIndex[] | null = null;

async function ccIndexes(): Promise<CcIndex[]> {
  if (indexCache) return indexCache;
  const res = await safeFetch(
    COLLINFO,
    { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) },
    { maxBytes: 8 * 1024 * 1024 }
  );
  if (!res.ok) throw new Error(`Common Crawl index list failed (${res.status})`);
  indexCache = (await res.json()) as CcIndex[];
  return indexCache;
}

function isBloggerPostPath(u: string): boolean {
  try {
    return /^\/\d{4}\/\d{2}\/[^/]+\.html$/i.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

// Query one index for the domain. Returns [] on 404 (no captures) or after
// retries (the CC index endpoint is occasionally flaky / returns an HTML error).
async function queryIndex(cdxApi: string, host: string): Promise<Record<string, string>[]> {
  const api = `${cdxApi}?url=${encodeURIComponent(host + "/*")}&output=json&limit=15000`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(3000 * attempt);
    let res: Response;
    try {
      res = await safeFetch(
        api,
        { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) },
        { maxBytes: 128 * 1024 * 1024 }
      );
    } catch {
      continue;
    }
    if (res.status === 404) return []; // this index has no captures for the host
    if (!res.ok) continue;
    const text = (await res.text()).trim();
    if (!text) return [];
    return text
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, string>;
        } catch {
          return null;
        }
      })
      .filter((x): x is Record<string, string> => !!x);
  }
  return [];
}

// Run async work over items with bounded concurrency.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const postCache = new Map<string, { at: number; records: CcRecord[] }>();

// Every unique Blogger post Common Crawl has a 200 text/html capture for, with
// the WARC coordinates needed to fetch it. Sweeps ALL monthly indexes (a deleted
// blog can appear in any crawl from when it was online, and different crawls hold
// different subsets — for one test blog the 2018 crawls had more posts than 2017).
// Queried with bounded concurrency; cached per host so the recovery route
// re-lists cheaply across batches.
export async function ccListPosts(blogUrl: string): Promise<CcRecord[]> {
  const host = new URL(normalizeBlogUrl(blogUrl)).host;
  const cached = postCache.get(host);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.records;

  const indexes = await ccIndexes();
  const perIndex = await mapLimit(indexes, 5, (idx) => queryIndex(idx["cdx-api"], host));

  const byPermalink = new Map<string, CcRecord>();
  for (const rows of perIndex) {
    for (const r of rows) {
      if (r.status !== "200") continue;
      const mime = r.mime || r["mime-detected"] || "";
      if (mime && !/html/i.test(mime)) continue;
      if (!isBloggerPostPath(r.url)) continue;
      try {
        const u = new URL(r.url);
        const permalink = `https://${u.hostname}${u.pathname}`;
        if (!byPermalink.has(permalink)) {
          byPermalink.set(permalink, {
            permalink,
            filename: r.filename,
            offset: Number(r.offset),
            length: Number(r.length),
          });
        }
      } catch {
        /* skip unparseable */
      }
    }
  }

  const records = [...byPermalink.values()].sort((a, b) => a.permalink.localeCompare(b.permalink));
  postCache.set(host, { at: Date.now(), records });
  return records;
}

// Fetch a post's original HTML from Common Crawl: ranged WARC GET → gunzip →
// strip the WARC and HTTP header blocks → HTML payload.
export async function ccFetchHtml(rec: CcRecord): Promise<string | null> {
  try {
    const start = rec.offset;
    const end = rec.offset + rec.length - 1;
    const res = await safeFetch(
      `https://data.commoncrawl.org/${rec.filename}`,
      { headers: { "User-Agent": UA, Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(60000) },
      { maxBytes: 64 * 1024 * 1024 }
    );
    if (!res.ok && res.status !== 206) return null;
    const gz = Buffer.from(await res.arrayBuffer());
    // Each CC record is an independently-gzipped WARC member, so the ranged bytes
    // gunzip on their own. Layout: WARC headers \r\n\r\n HTTP headers \r\n\r\n body.
    const record = zlib.gunzipSync(gz).toString("latin1");
    const afterWarc = record.slice(record.indexOf("\r\n\r\n") + 4);
    const body = afterWarc.slice(afterWarc.indexOf("\r\n\r\n") + 4);
    if (!body) return null;
    return Buffer.from(body, "latin1").toString("utf8");
  } catch {
    return null;
  }
}
