// Full archive recovery for one blog (Common Crawl + Wayback), into the existing
// blog owned by the smoke admin. Idempotent. Then prints a status summary of all
// of that user's blogs.
//   npx tsx scripts/recover-blog.ts johnkimball.blogspot.com
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { listArchivedPosts, scrapeArchivedPosts } from "@/lib/recover";
import { importBloggerData } from "@/lib/import-posts";
import { normalizeBlogUrl } from "@/lib/blogger";

const blogUrl = process.argv[2];
const CHUNK = 10;
const OWNER_EMAIL = "smoke@blog-saver.local";

function monthRange(dates: (Date | null)[]): string {
  const ms = dates.filter((d): d is Date => !!d).map((d) => d.toISOString().slice(0, 7)).sort();
  return ms.length ? `${ms[0]} .. ${ms[ms.length - 1]}` : "(no dates)";
}

async function status() {
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!user) return;
  const blogs = await prisma.blog.findMany({ where: { ownerId: user.id }, orderBy: { id: "asc" } });
  console.log("\n=== Blog status ===");
  for (const b of blogs) {
    const posts = await prisma.post.findMany({ where: { blogId: b.id }, select: { publishedAt: true, heroImageUrl: true } });
    const localImgs = posts.filter((p) => p.heroImageUrl?.startsWith("/api/images")).length;
    const extImgs = posts.filter((p) => p.heroImageUrl && /^https?:/.test(p.heroImageUrl)).length;
    console.log(
      `  [${b.id}] "${b.title}"  ${posts.length} posts  ${b.isPublished ? `published /blog/${b.slug}` : "draft"}  | dates ${monthRange(posts.map((p) => p.publishedAt))}  | hero img: ${localImgs} local, ${extImgs} external`
    );
  }
}

async function main() {
  if (!blogUrl) {
    await status();
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!user) throw new Error(`owner ${OWNER_EMAIL} not found`);

  const sourceUrl = normalizeBlogUrl(blogUrl);
  let blog = await prisma.blog.findFirst({ where: { ownerId: user.id, sourceUrl } });
  if (!blog) {
    blog = await prisma.blog.create({
      data: { ownerId: user.id, title: `Recovered: ${new URL(sourceUrl).host}`, sourceUrl, description: `Recovered from ${sourceUrl}` },
    });
  }
  console.log(`Recovering into blog ${blog.id} "${blog.title}"`);

  console.log("Listing archived posts (Common Crawl + Wayback)...");
  const { posts: all, warnings } = await listArchivedPosts(blogUrl);
  const bySource = all.reduce<Record<string, number>>((m, p) => ((m[p.source] = (m[p.source] || 0) + 1), m), {});
  console.log(`  ${all.length} unique posts | by source: ${JSON.stringify(bySource)}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);

  let imported = 0;
  let updated = 0;
  let scraped = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const posts = await scrapeArchivedPosts(chunk);
    scraped += posts.length;
    const sum = await importBloggerData(blog.id, { blogTitle: "", posts, comments: [] }, { sourceType: "WAYBACK" });
    imported += sum.imported;
    updated += sum.updated;
    process.stdout.write(`  ${Math.min(i + CHUNK, all.length)}/${all.length} processed (scraped ${scraped}, +${imported} new)\r`);
  }
  console.log(`\nDone: ${imported} new, ${updated} updated, ${scraped} scraped of ${all.length} located.`);

  await status();
}
main().then(() => process.exit(0)).catch((e) => { console.error("\nFAILED:", e); process.exit(1); });
