import { prisma } from "@/lib/prisma";

// Extract the UploadedImage ids a post references locally (hero + inline body).
// Entity-safe: the /api/images/<id> token contains no characters that
// sanitize-html would encode, so a plain regex over the stored HTML is reliable.
export function extractLocalImageIds(...sources: (string | null | undefined)[]): number[] {
  const ids = new Set<number>();
  const re = /\/api\/images\/(\d+)/g;
  for (const s of sources) {
    if (!s) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) ids.add(parseInt(m[1], 10));
  }
  return [...ids];
}

// Record which local images a post references. Called whenever a post's content
// is written (create, edit, import, salvage). Keeps the PostImage join table in
// sync so image visibility can be resolved with an indexed lookup.
export async function syncPostImages(
  postId: number,
  heroImageUrl: string | null | undefined,
  bodyHtml: string | null | undefined
): Promise<void> {
  const ids = extractLocalImageIds(heroImageUrl, bodyHtml);
  await prisma.postImage.deleteMany({ where: { postId } });
  if (ids.length) {
    // ids are de-duped and the rows were just cleared, so no collisions
    // (SQL Server's createMany has no skipDuplicates option).
    await prisma.postImage.createMany({ data: ids.map((imageId) => ({ postId, imageId })) });
  }
}
