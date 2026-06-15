import { prisma } from "@/lib/prisma";

// Attach tags (by name) to a post, creating tags as needed, in a small constant
// number of queries. When `replace` is true, the post's existing tags are
// cleared first.
export async function setPostTags(postId: number, names: string[], replace: boolean): Promise<void> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 50).map((n) => n.slice(0, 120));

  if (replace) await prisma.postTag.deleteMany({ where: { postId } });
  if (clean.length === 0) return;

  const existing = await prisma.tag.findMany({ where: { name: { in: clean } }, select: { id: true, name: true } });
  const map = new Map(existing.map((t) => [t.name, t.id]));

  const missing = clean.filter((n) => !map.has(n));
  if (missing.length) {
    // SQL Server createMany has no skipDuplicates; tolerate a concurrent insert
    // of the same name, then re-read to get every id.
    try {
      await prisma.tag.createMany({ data: missing.map((name) => ({ name })) });
    } catch {
      /* a concurrent create raced us; the re-read below still finds them */
    }
    const created = await prisma.tag.findMany({ where: { name: { in: missing } }, select: { id: true, name: true } });
    for (const t of created) map.set(t.name, t.id);
  }

  const tagIds = clean.map((n) => map.get(n)).filter((id): id is number => id != null);
  if (tagIds.length) {
    // For replace=true the join rows were cleared above; for a new post there are
    // none. Either way these inserts are collision-free.
    await prisma.postTag.createMany({ data: tagIds.map((tagId) => ({ postId, tagId })) });
  }
}
