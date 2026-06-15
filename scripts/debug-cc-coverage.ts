// Probe: across ALL Common Crawl indexes from 2016 on, which ones captured the
// blog, how many post-pages each has, and the overall unique post union.
const domain = process.argv[2] || "johnkimball.blogspot.com";

function isPostPath(u: string): boolean {
  try {
    return /^\/\d{4}\/\d{2}\/[^/]+\.html$/i.test(new URL(u).pathname);
  } catch {
    return false;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryIndex(cdxApi: string): Promise<Record<string, string>[]> {
  const api = `${cdxApi}?url=${encodeURIComponent(domain + "/*")}&output=json&limit=15000`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(3000);
    let res: Response;
    try {
      res = await fetch(api, { headers: { "User-Agent": "BlogSaver/1.0" }, signal: AbortSignal.timeout(60000) });
    } catch {
      continue;
    }
    if (res.status === 404) return [];
    if (!res.ok) continue;
    const text = (await res.text()).trim();
    if (!text) return [];
    return text.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  return [];
}

async function main() {
  const info = (await (await fetch("https://index.commoncrawl.org/collinfo.json")).json()) as {
    id: string;
    "cdx-api": string;
  }[];
  const relevant = info.filter((i) => {
    const m = i.id.match(/MAIN-(\d{4})-/);
    return m && Number(m[1]) >= 2016;
  });
  console.log(`Sweeping ${relevant.length} Common Crawl indexes (2016+) for ${domain}\n`);

  const union = new Set<string>();
  const hits: { id: string; captures: number; posts: number }[] = [];
  for (const idx of relevant) {
    const rows = await queryIndex(idx["cdx-api"]);
    const paths = new Set<string>();
    for (const r of rows) {
      const mime = r.mime || r["mime-detected"] || "";
      if (r.status === "200" && /html/i.test(mime) && isPostPath(r.url)) {
        const p = new URL(r.url).pathname;
        paths.add(p);
        union.add(p);
      }
    }
    if (rows.length) hits.push({ id: idx.id, captures: rows.length, posts: paths.size });
  }

  for (const h of hits) console.log(`  ${h.id}: ${h.captures} captures, ${h.posts} post-pages`);
  const months = [...union].map((p) => p.slice(1, 8)).sort();
  console.log(`\nIndexes with captures: ${hits.length}`);
  console.log(`Unique post pages across ALL crawls: ${union.size}`);
  console.log(`Post date range: ${months[0] ?? "?"} .. ${months[months.length - 1] ?? "?"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
