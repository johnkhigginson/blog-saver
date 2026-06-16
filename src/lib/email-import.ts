// Import blog posts from emails — typically the weekly "Dear family" mission
// letters that a Blogger mission blog was built from. Accepts a Gmail/Takeout
// .mbox (many messages) or individual .eml files. Each email becomes a post:
// subject -> title, date -> publishedAt, body -> content, image attachments are
// stored locally (inline cid images embedded in place, the rest appended).

import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import { sanitizeBlogHtml } from "@/lib/sanitize";
import { uniqueSlug } from "@/lib/slug";
import { htmlToText, excerpt } from "@/lib/blogger";
import { storeImageBuffer } from "@/lib/image-store";
import { syncPostImages } from "@/lib/post-images";

// Split an mbox into individual raw RFC822 messages. mbox separates messages
// with a line beginning "From " at column 0 (Gmail escapes body "From " lines
// to ">From ", so this split is safe for Takeout exports).
export function splitMbox(text: string): string[] {
  return text
    .split(/^From .*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface ParsedPost {
  title: string;
  publishedAt: Date | null;
  author: string | null;
  bodyHtml: string;
}

async function parseOne(raw: string, userId: number): Promise<ParsedPost | null> {
  const mail = await simpleParser(raw);
  const subject = (mail.subject || "").trim();

  let html = typeof mail.html === "string" && mail.html ? mail.html : mail.textAsHtml || "";
  if (!html && mail.text) html = `<p>${escapeHtml(mail.text).replace(/\n/g, "<br>")}</p>`;
  if (!subject && !html) return null;

  // Store image attachments. Inline (cid) images are swapped in place; the rest
  // are appended so nothing is lost.
  const appended: string[] = [];
  for (const att of mail.attachments || []) {
    if (!att.contentType?.startsWith("image/")) continue;
    const buf = att.content as Buffer | undefined;
    if (!buf || !buf.length) continue;
    let id: number;
    try {
      id = await storeImageBuffer(buf, { uploadedBy: userId, recoveredFrom: "EMAIL" });
    } catch {
      continue;
    }
    const localUrl = `/api/images/${id}`;
    if (att.cid && html.includes(att.cid)) {
      html = html.split(`cid:${att.cid}`).join(localUrl);
    } else {
      appended.push(`<img src="${localUrl}" alt="${escapeHtml(att.filename || "")}" />`);
    }
  }
  if (appended.length) html += `<div>${appended.join("")}</div>`;

  const fromName = mail.from?.value?.[0]?.name || mail.from?.text || null;
  return {
    title: subject || "(untitled email)",
    publishedAt: mail.date ?? null,
    author: fromName ? fromName.trim() : null,
    bodyHtml: sanitizeBlogHtml(html),
  };
}

export interface EmailImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

// Import a set of raw email messages into a blog. `senderFilter` (optional)
// keeps only emails whose From name/address contains the given substring, so a
// whole-inbox mbox can be narrowed to just the missionary's letters.
export async function importEmails(
  blogId: number,
  messages: string[],
  userId: number,
  opts: { senderFilter?: string } = {}
): Promise<EmailImportSummary> {
  const existing = await prisma.post.findMany({
    where: { blogId },
    select: { title: true, slug: true, publishedAt: true },
  });
  const seen = new Set(existing.map((p) => `${p.title}|${p.publishedAt?.toISOString() ?? ""}`));
  const takenSlugs = new Set(existing.map((p) => p.slug).filter((s): s is string => !!s));

  const parsed: ParsedPost[] = [];
  const errors: string[] = [];
  for (const raw of messages) {
    try {
      const p = await parseOne(raw, userId);
      if (p) parsed.push(p);
    } catch (e) {
      errors.push(e instanceof Error ? e.message.slice(0, 120) : "parse failed");
    }
  }
  // Oldest first so the blog ordering reads naturally.
  parsed.sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0));

  const filter = opts.senderFilter?.trim().toLowerCase();
  let imported = 0;
  let skipped = 0;

  for (const p of parsed) {
    if (filter && !(p.author ?? "").toLowerCase().includes(filter)) {
      skipped++;
      continue;
    }
    const key = `${p.title}|${p.publishedAt?.toISOString() ?? ""}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    try {
      const slug = uniqueSlug(p.title, takenSlugs, `email-${imported + 1}`);
      const plain = htmlToText(p.bodyHtml);
      const created = await prisma.post.create({
        data: {
          blogId,
          title: p.title.slice(0, 500),
          slug,
          excerpt: plain ? excerpt(plain) : null,
          bodyHtml: p.bodyHtml,
          status: "PUBLISHED",
          sourceType: "EMAIL",
          originalAuthor: p.author,
          publishedAt: p.publishedAt,
        },
        select: { id: true },
      });
      await syncPostImages(created.id, null, p.bodyHtml);
      imported++;
    } catch (e) {
      errors.push(`${p.title}: ${e instanceof Error ? e.message : "import failed"}`);
    }
  }

  return { imported, skipped, errors: errors.slice(0, 20) };
}
