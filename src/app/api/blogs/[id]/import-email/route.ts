import { NextRequest, NextResponse } from "next/server";
import { requireBlogAccess } from "@/lib/auth";
import { splitMbox, importEmails } from "@/lib/email-import";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

// Import posts from uploaded emails (.mbox from Gmail/Takeout, or .eml files)
// into a blog the user owns/collaborates on.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blogId = parseInt(id, 10);
  if (!blogId) return NextResponse.json({ error: "Invalid blog id" }, { status: 400 });

  let user;
  try {
    user = await requireBlogAccess(blogId);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

  const senderFilter = ((form.get("senderFilter") as string | null) ?? "").trim() || undefined;

  const messages: string[] = [];
  for (const f of files) {
    const text = await f.text();
    // .mbox holds many messages (separated by "From " lines); .eml is one.
    if (f.name.toLowerCase().endsWith(".mbox") || /^From .+\n/.test(text.slice(0, 4000))) {
      messages.push(...splitMbox(text));
    } else {
      messages.push(text);
    }
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "No email messages found in the upload." }, { status: 400 });
  }

  const summary = await importEmails(blogId, messages, user.userId, { senderFilter });

  await audit({
    category: "IMPORT",
    action: "EMAIL_IMPORTED",
    summary: `${user.name} imported ${summary.imported} post(s) from email`,
    actorUserId: user.userId,
    actorName: user.name,
    targetType: "BLOG",
    targetId: blogId,
    metadata: { messages: messages.length, ...summary },
  });

  return NextResponse.json({ messages: messages.length, ...summary });
}
