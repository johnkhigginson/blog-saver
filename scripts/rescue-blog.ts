// Paginated image-rescue over an existing blog's posts (cursor by id, small
// batches) so we never load thousands of large bodyHtml rows at once. Resilient
// + resumable. Live images self-host fast; dead ones fall back to Wayback (and
// report as "throttled" if archive.org is rate-limiting).
//   npx tsx scripts/rescue-blog.ts tawniesue.blogspot.com
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { normalizeBlogUrl } from "@/lib/blogger";
import { salvagePost } from "@/lib/image-salvage";
import { syncPostImages } from "@/lib/post-images";

const blogUrl = process.argv[2];
const OWNER_EMAIL = "smoke@blog-saver.local";
const BATCH = 25;

async function main() {
  if (!blogUrl) throw new Error("usage: rescue-blog.ts <blogUrl>");
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!user) throw new Error(`owner ${OWNER_EMAIL} not found`);
  const sourceUrl = normalizeBlogUrl(blogUrl);
  const blog = await prisma.blog.findFirst({ where: { ownerId: user.id, sourceUrl }, select: { id: true } });
  if (!blog) throw new Error(`no blog for ${sourceUrl}`);

  const total = await prisma.post.count({ where: { blogId: blog.id } });
  console.log(`[rescue] blog ${blog.id}: ${total} posts`);

  let cursor = 0;
  let processed = 0;
  let converted = 0;
  let failed = 0;
  let throttled = 0;
  for (;;) {
    const batch = await prisma.post.findMany({
      where: { blogId: blog.id, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, heroImageUrl: true, bodyHtml: true },
    });
    if (batch.length === 0) break;
    for (const p of batch) {
      cursor = p.id;
      processed++;
      const r = await salvagePost(p, user.id);
      if (r.changed) {
        await prisma.post.update({
          where: { id: p.id },
          data: { heroImageUrl: r.heroImageUrl, bodyHtml: r.bodyHtml, imageLocalizeFailed: r.heroFailed },
        });
        await syncPostImages(p.id, r.heroImageUrl, r.bodyHtml);
      } else if (r.heroFailed) {
        await prisma.post.update({ where: { id: p.id }, data: { imageLocalizeFailed: true } });
      }
      converted += r.converted;
      failed += r.failed;
      throttled += r.throttled;
    }
    console.log(`[rescue] ${processed}/${total}: ${converted} localized, ${failed} unrecoverable, ${throttled} throttled`);
  }
  console.log(`[done] images: ${converted} localized, ${failed} unrecoverable, ${throttled} throttled (re-run later for throttled).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("[FAILED]", e); process.exit(1); });
