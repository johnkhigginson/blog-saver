import sharp from "sharp";
import { prisma } from "@/lib/prisma";

const MAX_PIXELS = 40_000_000; // guards against decompression bombs

export interface StoreImageOptions {
  uploadedBy?: number | null;
  sourceUrl?: string | null; // original remote URL (for dedupe + provenance)
  recoveredFrom?: string | null; // LIVE, WAYBACK, UPLOAD
}

// Resize/normalize an image buffer to webp and store it in the DB; returns the
// new id. Provenance (sourceUrl, recoveredFrom) is recorded for salvage tracking
// and dedupe.
export async function storeImageBuffer(input: Buffer, opts: StoreImageOptions = {}): Promise<number> {
  const output = await sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const image = await prisma.uploadedImage.create({
    data: {
      data: Uint8Array.from(output),
      contentType: "image/webp",
      uploadedBy: opts.uploadedBy ?? null,
      sourceUrl: opts.sourceUrl ?? null,
      recoveredFrom: opts.recoveredFrom ?? null,
    },
    select: { id: true },
  });
  return image.id;
}
