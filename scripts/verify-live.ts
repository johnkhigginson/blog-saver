// Live integration probe for the Wayback/CDX + Blogger-feed code. Hits the real
// network (archive.org and, if given, a live blog). Not part of CI.
//   npm run verify:live                 # wayback + CDX smoke
//   npx tsx scripts/verify-live.ts yourblog.blogspot.com   # also test live feed

import { closestSnapshot } from "../src/lib/wayback";
import { listArchivedPostUrls, scrapeArchivedPosts } from "../src/lib/recover";
import { fetchAllBloggerPosts } from "../src/lib/blogger";

const arg = process.argv[2];

async function main() {
  console.log("1) Wayback availability for http://example.com/ ...");
  const snap = await closestSnapshot("http://example.com/");
  console.log("   ->", snap ? `${snap.timestamp}  ${snap.snapshotUrl}` : "no snapshot");

  const domain = arg || "googleblog.blogspot.com";
  console.log(`\n2) CDX: archived Blogger post URLs for ${domain} ...`);
  try {
    const urls = await listArchivedPostUrls(domain);
    console.log(`   -> ${urls.length} post URL(s). first: ${urls[0] ?? "(none)"}`);
    if (urls.length) {
      console.log("\n3) Scraping the first archived post ...");
      const posts = await scrapeArchivedPosts(urls.slice(0, 1));
      const p = posts[0];
      console.log(
        p
          ? `   -> "${p.title}" | ${p.publishedAt?.toISOString().slice(0, 10) ?? "no date"} | ${p.contentHtml.length} chars | hero: ${p.imageUrl ?? "none"}`
          : "   -> could not scrape the first post"
      );
    }
  } catch (e) {
    console.log("   error:", e instanceof Error ? e.message : e);
  }

  if (arg) {
    console.log(`\n4) Live Blogger feed for ${arg} ...`);
    try {
      const data = await fetchAllBloggerPosts(arg);
      console.log(`   -> "${data.blogTitle}": ${data.posts.length} posts, ${data.comments.length} comments`);
      if (data.posts[0]) console.log(`   first post: "${data.posts[0].title}"`);
    } catch (e) {
      console.log("   error:", e instanceof Error ? e.message : e);
    }
  }

  console.log("\nDone.");
}

main();
