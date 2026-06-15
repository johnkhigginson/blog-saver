// Bounded end-to-end DB smoke test. Exercises the real pipeline against the
// configured SQL Server (reads .env): admin user -> live Blogger import ->
// image salvage (first few posts) -> publish -> public query -> Wayback recovery
// (first few posts). Run AFTER `npm run db:push`.
//
//   npx tsx scripts/smoke-db.ts <liveBlogUrl> <deletedBlogUrl>
//
// Both URL args are optional; pass what you have. Creates test data (a smoke
// admin user + blogs) in the target DB — point it at a dev database.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { fetchAllBloggerPosts, normalizeBlogUrl } from "@/lib/blogger";
import { importBloggerData } from "@/lib/import-posts";
import { salvagePost } from "@/lib/image-salvage";
import { listArchivedPosts, scrapeArchivedPosts } from "@/lib/recover";
import { syncPostImages } from "@/lib/post-images";
import { getPublishedBlogBySlug } from "@/lib/blog";
import { uniqueBlogSlug } from "@/lib/slug-db";

const liveUrl = process.argv[2];
const deletedUrl = process.argv[3];
const LIVE_IMPORT_LIMIT = 25; // cap the smoke import (a full blog can be hundreds of posts)
const SALVAGE_LIMIT = 5;
const RECOVER_LIMIT = 5;

async function main() {
  console.log("0) DB connectivity ...");
  await prisma.$queryRaw`SELECT 1 AS ok`;
  console.log("   -> connected");

  const email = "smoke@blog-saver.local";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: "Smoke Admin", passwordHash: await bcrypt.hash("smoketest12345", 12), systemRole: "ADMIN" },
    });
  }
  console.log(`   -> admin user id ${user.id}`);

  // Clean any data from a previous smoke run so counts are unambiguous.
  await prisma.blog.deleteMany({ where: { ownerId: user.id } });
  await prisma.uploadedImage.deleteMany({ where: { uploadedBy: user.id } });

  if (liveUrl) {
    console.log(`\n1) Live import: ${liveUrl} ...`);
    const data = await fetchAllBloggerPosts(liveUrl);
    const totalPosts = data.posts.length;
    data.posts = data.posts.slice(0, LIVE_IMPORT_LIMIT); // bound the smoke
    const blog = await prisma.blog.create({
      data: { ownerId: user.id, title: data.blogTitle || "Live import", sourceUrl: normalizeBlogUrl(liveUrl) },
    });
    console.log(`   feed has ${totalPosts} posts; importing first ${data.posts.length} for the smoke`);
    const sum = await importBloggerData(blog.id, data);
    console.log(`   -> imported ${sum.imported} posts, ${sum.importedComments} comments into blog ${blog.id} (errors: ${sum.errors.length})`);

    console.log(`\n2) Image salvage (first ${SALVAGE_LIMIT} posts) ...`);
    const posts = await prisma.post.findMany({
      where: { blogId: blog.id },
      orderBy: { id: "asc" },
      take: SALVAGE_LIMIT,
      select: { id: true, heroImageUrl: true, bodyHtml: true },
    });
    let converted = 0;
    let failed = 0;
    for (const p of posts) {
      const r = await salvagePost(p, user.id);
      if (r.changed) {
        await prisma.post.update({
          where: { id: p.id },
          data: { heroImageUrl: r.heroImageUrl, bodyHtml: r.bodyHtml, imageLocalizeFailed: r.heroFailed },
        });
        await syncPostImages(p.id, r.heroImageUrl, r.bodyHtml);
      }
      converted += r.converted;
      failed += r.failed;
    }
    const imageCount = await prisma.uploadedImage.count();
    console.log(`   -> ${converted} images localized, ${failed} unrecoverable; ${imageCount} images now stored`);

    console.log(`\n3) Publish + public read ...`);
    const slug = await uniqueBlogSlug(blog.title, blog.id);
    await prisma.blog.update({ where: { id: blog.id }, data: { isPublished: true, slug, publishedAt: new Date() } });
    const pub = await getPublishedBlogBySlug(slug);
    console.log(`   -> "${pub?.title}" published at /blog/${slug} with ${pub?.posts.length ?? 0} public posts`);
  }

  if (deletedUrl) {
    console.log(`\n4) Recovery from Wayback: ${deletedUrl} ...`);
    const { posts: urls } = await listArchivedPosts(deletedUrl);
    console.log(`   -> ${urls.length} archived post URLs found`);
    if (urls.length) {
      const scraped = await scrapeArchivedPosts(urls.slice(0, RECOVER_LIMIT));
      const blog = await prisma.blog.create({
        data: {
          ownerId: user.id,
          title: `Recovered: ${new URL(normalizeBlogUrl(deletedUrl)).host}`,
          sourceUrl: normalizeBlogUrl(deletedUrl),
        },
      });
      const sum = await importBloggerData(blog.id, { blogTitle: "", posts: scraped, comments: [] }, { sourceType: "WAYBACK" });
      console.log(`   -> recovered ${sum.imported} of first ${RECOVER_LIMIT} archived posts into blog ${blog.id}`);
      const sample = await prisma.post.findFirst({ where: { blogId: blog.id }, select: { title: true, publishedAt: true } });
      if (sample) console.log(`   sample: "${sample.title}" (${sample.publishedAt?.toISOString().slice(0, 10) ?? "no date"})`);

      console.log(`   salvaging images on recovered posts ...`);
      const rposts = await prisma.post.findMany({ where: { blogId: blog.id }, select: { id: true, heroImageUrl: true, bodyHtml: true } });
      let rc = 0;
      let rf = 0;
      for (const p of rposts) {
        const r = await salvagePost(p, user.id);
        if (r.changed) {
          await prisma.post.update({
            where: { id: p.id },
            data: { heroImageUrl: r.heroImageUrl, bodyHtml: r.bodyHtml, imageLocalizeFailed: r.heroFailed },
          });
          await syncPostImages(p.id, r.heroImageUrl, r.bodyHtml);
        }
        rc += r.converted;
        rf += r.failed;
      }
      console.log(`   -> recovery image salvage: ${rc} localized, ${rf} unrecoverable`);
    }
  }

  console.log("\nSMOKE OK");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nSMOKE FAILED:", e);
    process.exit(1);
  });
