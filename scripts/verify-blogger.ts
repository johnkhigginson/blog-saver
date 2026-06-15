// Offline checks for the Blogger import parsers (src/lib/blogger.ts, src/lib/slug.ts).
// No DB or network needed. Run: npm run verify

import {
  parseBloggerJsonFeed,
  parseBloggerXmlExport,
  upgradeBloggerImage,
  htmlToText,
  excerpt,
} from "../src/lib/blogger";
import { slugify, uniqueSlug } from "../src/lib/slug";

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    failures++;
    console.log(`  ✗ ${label}`, extra ?? "");
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// ── JSON feed fixture (Blogger ?alt=json shape) ──
console.log("JSON feed:");
const jsonFeed = {
  feed: {
    title: { $t: "Travels & Tangents" },
    "openSearch$totalResults": { $t: "2" },
    entry: [
      {
        published: { $t: "2019-03-04T10:00:00.000-08:00" },
        title: { $t: "A Week in Lisbon" },
        content: {
          $t: `<div><img src="https://1.bp.blogspot.com/-x/AAA/s72-c/lisbon.jpg"/><p>What a city.</p></div>`,
        },
        link: [
          { rel: "self", href: "https://x/feeds/123" },
          { rel: "alternate", href: "https://travels.blogspot.com/2019/03/lisbon.html" },
        ],
        category: [{ term: "Travel" }, { term: "Portugal" }],
        "media$thumbnail": { url: "https://1.bp.blogspot.com/-x/AAA/s72-c/lisbon.jpg" },
        author: [{ name: { $t: "Jane" } }],
      },
      {
        published: { $t: "2020-01-01T10:00:00.000-08:00" },
        title: { $t: "No Photo Here" },
        content: { $t: `<p>Just words.</p>` },
        link: [{ rel: "alternate", href: "https://travels.blogspot.com/2020/01/words.html" }],
        category: [{ term: "Notes" }],
      },
    ],
  },
};
const j = parseBloggerJsonFeed(jsonFeed);
check("blog title parsed", j.blogTitle === "Travels & Tangents", j.blogTitle);
check("total parsed", j.total === 2, j.total);
check("2 posts", j.posts.length === 2, j.posts.length);
check("title", j.posts[0].title === "A Week in Lisbon");
check(
  "permalink (alternate link)",
  j.posts[0].permalink === "https://travels.blogspot.com/2019/03/lisbon.html",
  j.posts[0].permalink
);
check("publishedAt is Date", j.posts[0].publishedAt instanceof Date);
check("labels", JSON.stringify(j.posts[0].labels) === JSON.stringify(["Travel", "Portugal"]));
check(
  "thumbnail upgraded to s1600",
  j.posts[0].imageUrl === "https://1.bp.blogspot.com/-x/AAA/s1600/lisbon.jpg",
  j.posts[0].imageUrl
);
check("post 2 image = null (no img)", j.posts[1].imageUrl === null, j.posts[1].imageUrl);
check("json author parsed", j.posts[0].author === "Jane", j.posts[0].author);
check("json missing author = null", j.posts[1].author === null, j.posts[1].author);

// ── XML export fixture (Atom) ──
console.log("XML export:");
const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Travels &amp; Tangents</title>
  <entry>
    <category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/blogger/2008/kind#post"/>
    <category scheme="http://www.blogger.com/atom/ns#" term="Travel"/>
    <title type="text">Roaming Rome</title>
    <content type="html">&lt;p&gt;&lt;img src="https://2.bp.blogspot.com/-y/BBB/s400/rome.jpg"/&gt;Ciao.&lt;/p&gt;</content>
    <published>2018-05-05T09:00:00.000-07:00</published>
    <author><name>Jane</name></author>
    <link rel="alternate" type="text/html" href="https://travels.blogspot.com/2018/05/rome.html"/>
  </entry>
  <entry>
    <category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/blogger/2008/kind#post"/>
    <app:control xmlns:app="http://purl.org/atom/app#"><app:draft>yes</app:draft></app:control>
    <title>Unfinished Draft</title>
    <content type="html">draft body</content>
  </entry>
  <entry>
    <category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/blogger/2008/kind#page"/>
    <title>About Page</title>
    <content type="html">about</content>
  </entry>
  <entry xmlns:thr="http://purl.org/syndication/thread/1.0">
    <category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/blogger/2008/kind#comment"/>
    <title>Comment on Roaming Rome</title>
    <content type="html">&lt;p&gt;So &lt;b&gt;jealous&lt;/b&gt;!&lt;/p&gt;</content>
    <published>2018-05-06T12:00:00.000-07:00</published>
    <author><name>Bob</name></author>
    <thr:in-reply-to ref="tag:blogger.com,1999:blog-1.post-2" href="https://travels.blogspot.com/2018/05/rome.html" type="text/html"/>
  </entry>
</feed>`;
const x = parseBloggerXmlExport(xml);
check("xml blog title", x.blogTitle === "Travels & Tangents", x.blogTitle);
check("only the 1 published post (draft + page + comment skipped)", x.posts.length === 1, x.posts.length);
check("xml comment parsed", x.comments.length === 1, x.comments.length);
check("xml comment author", x.comments[0]?.author === "Bob", x.comments[0]?.author);
check("xml comment body is plain text", x.comments[0]?.body === "So jealous!", JSON.stringify(x.comments[0]?.body));
check(
  "xml comment linked to post permalink",
  x.comments[0]?.postPermalink === "https://travels.blogspot.com/2018/05/rome.html",
  x.comments[0]?.postPermalink
);
check("xml title", x.posts[0]?.title === "Roaming Rome", x.posts[0]?.title);
check("xml image upgraded", x.posts[0]?.imageUrl === "https://2.bp.blogspot.com/-y/BBB/s1600/rome.jpg", x.posts[0]?.imageUrl);
check("xml author parsed", x.posts[0]?.author === "Jane", x.posts[0]?.author);

// ── helpers ──
console.log("Helpers:");
check("htmlToText strips tags", !htmlToText(j.posts[0].contentHtml).includes("<"));
check("excerpt truncates", excerpt("a".repeat(400)).length <= 281);
check("upgradeBloggerImage null-safe", upgradeBloggerImage(null) === null);
check(
  "non-Blogger URL with =s### token is left untouched",
  upgradeBloggerImage("https://example.com/pic.jpg?x=s320") === "https://example.com/pic.jpg?x=s320",
  upgradeBloggerImage("https://example.com/pic.jpg?x=s320")
);
check(
  "googleusercontent thumbnail upgraded",
  upgradeBloggerImage("https://lh3.googleusercontent.com/abc=s220") === "https://lh3.googleusercontent.com/abc=s1600",
  upgradeBloggerImage("https://lh3.googleusercontent.com/abc=s220")
);

// ── slug ──
console.log("Slugs:");
check("slugify basic", slugify("A Week in Lisbon!") === "a-week-in-lisbon", slugify("A Week in Lisbon!"));
const taken = new Set<string>();
const s1 = uniqueSlug("My Post", taken);
const s2 = uniqueSlug("My Post", taken);
const s3 = uniqueSlug("My Post", taken);
check("unique slug collision suffixes", s1 === "my-post" && s2 === "my-post-2" && s3 === "my-post-3", [s1, s2, s3]);
check("empty title falls back", uniqueSlug("！！！", new Set(), "post-1") === "post-1", uniqueSlug("！！！", new Set(), "post-1"));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
