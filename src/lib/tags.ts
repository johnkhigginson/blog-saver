import { prisma } from "@/lib/prisma";

// Attach tags (by name) to a post, creating tags as needed. When `replace` is
// true, the post's existing tags are cleared first.
export async function setPostTags(postId: number, names: string[], replace: boolean): Promise<void> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 50);
  if (replace) {
    await prisma.postTag.deleteMany({ where: { postId } });
  }
  for (const name of clean) {
    const tag = await prisma.tag.upsert({ where: { name: name.slice(0, 120) }, update: {}, create: { name: name.slice(0, 120) } });
    await prisma.postTag.upsert({
      where: { postId_tagId: { postId, tagId: tag.id } },
      update: {},
      create: { postId, tagId: tag.id },
    });
  }
}
