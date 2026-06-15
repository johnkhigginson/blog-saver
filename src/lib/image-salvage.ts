// Image salvage: pull externally-hosted images (Blogger/Google, etc.) into the
// app's own store so a post stops depending on URLs that are dying. For each
// image we try the live URL first, then fall back to the Wayback Machine — this
// is what recovers photos Google has already deleted.

import * as cheerio from "cheerio";
import { prisma } from "@/lib/prisma";
import { safeFetch } from "@/lib/ssrf";
import { storeImageBuffer } from "@/lib/image-store";
import { findArchivedImage } from "@/lib/wayback";

const MAX_BYTES = 25 * 1024 * 1024;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function extractImageUrls(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) urls.add(src);
  });
  return [...urls];
}

function isExternalHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
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

  const existing = await prisma.uploadedImage.findFirst({
    where: { sourceUrl: originalUrl },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (existing) return { url: `/api/images/${existing.id}`, from: "EXISTING" };

  // 1) Try the live URL — many images still resolve.
  let buf = await fetchImageBytes(originalUrl);
  let from: "LIVE" | "WAYBACK" = "LIVE";

  // 2) Dead? Recover from the Wayback Machine.
  if (!buf) {
    const snap = await findArchivedImage(originalUrl);
    if (snap) {
      buf = await fetchImageBytes(snap.snapshotUrl);
      from = "WAYBACK";
    }
  }

  if (!buf) return { error: "dead live URL and no archived copy" };

  try {
    const id = await storeImageBuffer(buf, {
      uploadedBy: userId,
      sourceUrl: originalUrl,
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

// Salvage the hero image and every external <img> in the post body, rewriting
// references to the locally-stored copies. Returns the new values; the caller
// persists them.
export async function salvagePost(
  post: { heroImageUrl: string | null; bodyHtml: string },
  userId: number
): Promise<PostSalvageResult> {
  let bodyHtml = post.bodyHtml;
  let heroImageUrl = post.heroImageUrl;
  let converted = 0;
  let failed = 0;
  let heroFailed = false;
  let changed = false;
  const errors: string[] = [];

  const urls = new Set<string>();
  if (heroImageUrl && isExternalHttp(heroImageUrl)) urls.add(heroImageUrl);
  for (const u of extractImageUrls(bodyHtml)) if (isExternalHttp(u)) urls.add(u);

  // Replace longer URLs first so one URL that is a substring of another (query
  // variants) can't corrupt the rewrite.
  const urlList = [...urls].sort((a, b) => b.length - a.length);

  for (const original of urlList) {
    const outcome = await salvageImageUrl(original, userId);
    if ("error" in outcome) {
      failed++;
      if (heroImageUrl === original) heroFailed = true;
      errors.push(`${original}: ${outcome.error}`);
      continue;
    }
    if (outcome.from !== "EXISTING") converted++;
    if (heroImageUrl === original) heroImageUrl = outcome.url;
    if (bodyHtml.includes(original)) bodyHtml = bodyHtml.split(original).join(outcome.url);
    changed = true;
  }

  return { heroImageUrl, bodyHtml, changed, converted, failed, heroFailed, errors };
}
