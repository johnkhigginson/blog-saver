// Image salvage: pull externally-hosted images (Blogger/Google, etc.) into the
// app's own store so a post stops depending on URLs that are dying. For each
// image we try the live URL first, then fall back to the Wayback Machine — this
// is what recovers photos Google has already deleted.
//
// The body rewrite is done at the DOM level (not string replace) so it handles
// HTML-entity-encoded URLs (e.g. ...?w=400&amp;h=300), srcset, and <source>.

import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";
import { safeFetch } from "@/lib/ssrf";
import { storeImageBuffer } from "@/lib/image-store";
import { findArchivedImage } from "@/lib/wayback";

const MAX_BYTES = 25 * 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Remote = http(s) or protocol-relative (//host/...), as Blogger often emits.
function isExternalHttp(url: string): boolean {
  return /^(https?:)?\/\//i.test(url);
}

function toAbsolute(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(",")
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function rewriteSrcset(srcset: string, map: Map<string, string>): string {
  return srcset
    .split(",")
    .map((part) => {
      const t = part.trim();
      if (!t) return part;
      const bits = t.split(/\s+/);
      const local = map.get(bits[0]);
      if (!local) return part;
      const rest = bits.slice(1).join(" ");
      return rest ? `${local} ${rest}` : local;
    })
    .join(", ");
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await safeFetch(
      url,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) },
      { maxBytes: MAX_BYTES }
    );
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

export type SalvageOutcome =
  | { url: string; from: "EXISTING" | "LIVE" | "WAYBACK" }
  | { error: string };

// Localize a single image URL. Idempotent via the UploadedImage.sourceUrl index:
// a URL salvaged once is reused, never re-downloaded.
export async function salvageImageUrl(originalUrl: string, userId: number): Promise<SalvageOutcome> {
  if (!isExternalHttp(originalUrl)) return { error: "not an external url" };

  // Normalize protocol-relative URLs so fetch + dedupe are consistent.
  const fetchUrl = toAbsolute(originalUrl);

  const existing = await prisma.uploadedImage.findFirst({
    where: { sourceUrl: fetchUrl },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (existing) return { url: `/api/images/${existing.id}`, from: "EXISTING" };

  // 1) Try the live URL — many images still resolve.
  let buf = await fetchImageBytes(fetchUrl);
  let from: "LIVE" | "WAYBACK" = "LIVE";

  // 2) Dead? Recover from the Wayback Machine.
  if (!buf) {
    const snap = await findArchivedImage(fetchUrl);
    if (snap) {
      buf = await fetchImageBytes(snap.snapshotUrl);
      from = "WAYBACK";
    }
  }

  if (!buf) return { error: "dead live URL and no archived copy" };

  try {
    const id = await storeImageBuffer(buf, {
      uploadedBy: userId,
      sourceUrl: fetchUrl,
      recoveredFrom: from,
    });
    return { url: `/api/images/${id}`, from };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 120) : "store failed" };
  }
}

export interface PostSalvageResult {
  heroImageUrl: string | null;
  bodyHtml: string;
  changed: boolean;
  converted: number;
  failed: number;
  heroFailed: boolean;
  errors: string[];
}

// Salvage the hero image and every external image in the post body (img src,
// img srcset, <source> src/srcset), rewriting references to the local copies.
export async function salvagePost(
  post: { heroImageUrl: string | null; bodyHtml: string },
  userId: number
): Promise<PostSalvageResult> {
  const $ = cheerio.load(post.bodyHtml || "", undefined, false);

  // Collect every external image URL once (hero + body, src + srcset).
  const urls = new Set<string>();
  if (post.heroImageUrl && isExternalHttp(post.heroImageUrl)) urls.add(post.heroImageUrl);
  $("img, source").each((_, el) => {
    const src = $(el).attr("src");
    if (src && isExternalHttp(src)) urls.add(src);
    const srcset = $(el).attr("srcset");
    if (srcset) for (const u of srcsetUrls(srcset)) if (isExternalHttp(u)) urls.add(u);
  });

  let converted = 0;
  let failed = 0;
  const errors: string[] = [];
  const map = new Map<string, string>(); // original URL -> local /api/images/<id>

  for (const original of urls) {
    const outcome = await salvageImageUrl(original, userId);
    if ("error" in outcome) {
      failed++;
      errors.push(`${original}: ${outcome.error}`);
      continue;
    }
    if (outcome.from !== "EXISTING") converted++;
    map.set(original, outcome.url);
  }

  // Rewrite the body DOM.
  let bodyChanged = false;
  $("img, source").each((_, el) => {
    const src = $(el).attr("src");
    if (src && map.has(src)) {
      $(el).attr("src", map.get(src)!);
      bodyChanged = true;
    }
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const next = rewriteSrcset(srcset, map);
      if (next !== srcset) {
        $(el).attr("srcset", next);
        bodyChanged = true;
      }
    }
  });

  // Rewrite the hero.
  let heroImageUrl = post.heroImageUrl;
  let heroChanged = false;
  let heroFailed = false;
  if (heroImageUrl && isExternalHttp(heroImageUrl)) {
    const local = map.get(heroImageUrl);
    if (local) {
      heroImageUrl = local;
      heroChanged = true;
    } else {
      heroFailed = true;
    }
  }

  return {
    heroImageUrl,
    bodyHtml: bodyChanged ? $.html() : post.bodyHtml,
    changed: bodyChanged || heroChanged,
    converted,
    failed,
    heroFailed,
    errors,
  };
}
