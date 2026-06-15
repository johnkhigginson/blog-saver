import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

// Match /api/images/<id> only at a digit boundary so image 12's reference can't
// be mistaken for image 1 (substring collision).
function bodyBoundary(id: number): RegExp {
  return new RegExp(`/api/images/${id}(?![0-9])`);
}

// Public if referenced by published content: a published post's hero, a
// published blog cover, any author avatar, or embedded in a published post body.
async function isPublicImage(url: string, id: number): Promise<boolean> {
  const [hero, cover, avatar] = await Promise.all([
    prisma.post.findFirst({
      where: { heroImageUrl: url, status: "PUBLISHED", blog: { isPublished: true } },
      select: { id: true },
    }),
    prisma.blog.findFirst({ where: { coverImageUrl: url, isPublished: true }, select: { id: true } }),
    prisma.user.findFirst({ where: { avatarUrl: url }, select: { id: true } }),
  ]);
  if (hero || cover || avatar) return true;

  const bodyHits = await prisma.post.findMany({
    where: { status: "PUBLISHED", blog: { isPublished: true }, bodyHtml: { contains: url } },
    select: { bodyHtml: true },
    take: 10,
  });
  return bodyHits.some((p) => bodyBoundary(id).test(p.bodyHtml));
}

// Referenced by content the viewer owns/collaborates on (covers private drafts).
async function canAccessPrivate(url: string, id: number, userId: number): Promise<boolean> {
  const accessibleBlog = {
    OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }],
  };

  const [hero, cover, avatar] = await Promise.all([
    prisma.post.findFirst({ where: { heroImageUrl: url, blog: accessibleBlog }, select: { id: true } }),
    prisma.blog.findFirst({ where: { coverImageUrl: url, ...accessibleBlog }, select: { id: true } }),
    prisma.user.findFirst({ where: { avatarUrl: url, id: userId }, select: { id: true } }),
  ]);
  if (hero || cover || avatar) return true;

  const bodyHits = await prisma.post.findMany({
    where: { blog: accessibleBlog, bodyHtml: { contains: url } },
    select: { bodyHtml: true },
    take: 10,
  });
  return bodyHits.some((p) => bodyBoundary(id).test(p.bodyHtml));
}

// Serves a stored image. Published/avatar images are public; otherwise only the
// uploader, an admin, or someone who owns/collaborates on referencing content
// may view it (prevents id-enumeration of private images).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const imageId = parseInt(id, 10);
  if (!imageId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const image = await prisma.uploadedImage.findUnique({
    where: { id: imageId },
    select: { data: true, contentType: true, uploadedBy: true },
  });
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = `/api/images/${imageId}`;
  let cache = "public, max-age=31536000, immutable";

  if (!(await isPublicImage(url, imageId))) {
    const user = await getCurrentUser();
    const ownUpload = !!user && image.uploadedBy === user.userId;
    const allowed =
      !!user && (ownUpload || user.isAdmin || (await canAccessPrivate(url, imageId, user.userId)));
    if (!allowed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    cache = "private, max-age=300";
  }

  const body = new Uint8Array(image.data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": cache,
      "Content-Length": String(body.byteLength),
    },
  });
}
