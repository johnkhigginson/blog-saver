// Full live import of a Blogger blog (ALL posts) into the smoke admin's blog,
// then an image-rescue pass over every post. Long-running; meant to run in the
// background. Idempotent. Live images self-host fast; dead ones fall back to the
// Wayback Machine (and report as "throttled" if archive.org is rate-limiting).
//   npx tsx scripts/import-blog.ts tawniesue.blogspot.com
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { fetchAllBloggerPosts, normalizeBlogUrl } from "@/lib/blogger";
import { importBloggerData } from "@/lib/import-posts";

const blogUrl = process.argv[2];
const OWNER_EMAIL = "smoke@blog-saver.local";

async function main() {
  if (!blogUrl) throw new Error("usage: import-blog.ts <blogUrl>");
  const user = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!user) throw new Error(`owner ${OWNER_EMAIL} not found`);

  const sourceUrl = normalizeBlogUrl(blogUrl);
  let blog = await prisma.blog.findFirst({ where: { ownerId: user.id, sourceUrl } });
  if (!blog) {
    blog = await prisma.blog.create({ data: { ownerId: user.id, title: "Imported blog", sourceUrl } });
  }

  console.log(`[import] fetching feed for ${blogUrl} ...`);
  const data = await fetchAllBloggerPosts(blogUrl);
  console.log(`[import] feed has ${data.posts.length} posts, ${data.comments.length} comments`);
  const sum = await importBloggerData(blog.id, data);
  console.log(`[done] imported ${sum.imported} new, ${sum.updated} updated, ${sum.importedComments} comments into blog ${blog.id}. Run scripts/rescue-blog.ts to self-host images.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("[FAILED]", e); process.exit(1); });
