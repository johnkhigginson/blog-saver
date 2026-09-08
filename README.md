# Blog Saver

Import, rescue, and keep blogs alive. Built for general blogs (no recipe/AI
parsing). Forked from my own meal-planning blog stack, with the recipe and AI
code dropped.

## What it does

1. **Import from Blogger** — pull a Blogspot blog in via its live JSON feed or an
   offline "Back up content" XML export. Posts, labels, authorship, and comments
   are preserved; re-running is idempotent (updates in place, no duplicates).
2. **Rescue images** — Blogger/Google have been deleting hosted images. The
   salvage pass downloads every post's hero and inline images into the app's own
   store, trying the live URL first and falling back to the **Wayback Machine**
   for ones Google already removed, then rewrites the post body to the local copy.
3. **Recover a deleted blog** — if a blog was taken down entirely, rebuild it from
   the Wayback Machine using only its old URL: the CDX index is enumerated for
   archived post pages, which are scraped back into posts (then run Rescue images).
4. **Write & maintain** — a TipTap rich text editor (images, links, embeds,
   tables-of-content headings, lists, quotes, code) so anyone can keep a blog
   going. Drafts, publish/unpublish, tags, public reading site with RSS and
   comments.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Prisma 7 on **SQL Server** ·
next-auth v5 (credentials) · TipTap · sharp · cheerio · sanitize-html ·
shadcn/Tailwind v4.

## Prerequisites

- Node 20+
- A SQL Server instance (local or remote)

## Setup

```bash
npm install
cp .env.example .env      # then fill in DB_* / DATABASE_URL / AUTH_SECRET
npm run db:push           # create the schema
npm run dev
```

Open http://localhost:3000 and register an account.

To give yourself the **admin** role (access across every blog, not just your
own), add your address to `ADMIN_EMAILS` in `.env` *before* you register:

```bash
ADMIN_EMAILS=you@example.com
```

Leave it unset and no account is auto-promoted. That is deliberate: on a
reachable deployment, granting admin to whoever registers first would hand
cross-blog access to anyone who found the instance. The app is fully usable
with no admin at all, since users own and manage their own blogs.

Then: create a blog, or Import / Recover one; run **Rescue images**; write or edit
posts; publish the blog to make it public at `/blog/<slug>`.

Useful scripts:

- `npm run verify` — offline tests for the Blogger/Wayback parsers (no DB/network)
- `npm run build` — production build + type check
- `npm run db:generate` — regenerate the Prisma client

## How it's organized

- `src/lib/blogger.ts` — Blogger JSON feed + Atom XML parsers
- `src/lib/wayback.ts` — Wayback availability + CDX client (raw `id_` snapshots)
- `src/lib/image-salvage.ts` — live-then-Wayback image recovery + body rewrite
- `src/lib/recover.ts` — CDX enumeration + archived-page scraper for deleted blogs
- `src/lib/import-posts.ts` — shared, idempotent post/comment/tag import loop
- `src/lib/sanitize.ts` — sanitize-html config (applied on write **and** render)
- `src/lib/ssrf.ts` — SSRF-guarded fetch used for every outbound URL
- `src/app/blog/...` — public reading site (index, post, about, RSS)
- `src/app/dashboard/...` — authenticated workspace (manage, import, recover, edit)
- `src/app/api/...` — REST endpoints

## Notes

- **Images** are stored in the database as BLOBs and served from
  `/api/images/[id]` (one DB backup captures everything). The store is isolated in
  `src/lib/image-store.ts`, so swapping to S3 later is a single-file change.
- **Security:** all outbound fetches (import, salvage, recovery) go through the
  SSRF guard; third-party HTML is sanitized on both write and render; private and
  draft images are not publicly readable.
