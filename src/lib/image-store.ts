import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { safeFetch } from "@/lib/ssrf";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000; // ~ guards against decompression bombs

// Resize/normalize an image buffer to webp and store it; returns the new id.
export async function storeImageBuffer(input: Buffer, uploadedBy?: number | null): Promise<number> {
  const output = await sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const image = await prisma.uploadedImage.create({
    data: { data: Uint8Array.from(output), contentType: "image/webp", uploadedBy: uploadedBy ?? null },
    select: { id: true },
  });
  return image.id;
}

// Download a remote image (SSRF-guarded) and store it locally; returns the new
// /api/images URL, or an error reason the caller can surface/record.
export async function fetchAndStoreImage(
  url: string,
  uploadedBy?: number | null
): Promise<{ url: string } | { error: string }> {
  try {
    const res = await safeFetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return { error: `not an image (${type || "unknown type"})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) return { error: "empty response" };
    if (buf.byteLength > MAX_BYTES) return { error: "image too large" };
    const id = await storeImageBuffer(buf, uploadedBy);
    return { url: `/api/images/${id}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 120) : "fetch failed" };
  }
}
