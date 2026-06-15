import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

// Public access is anchored to the image's OWN uploader: an image is public only
// when the uploader's own published content references it (a post via the
// indexed PostImage table — which covers hero + inline body — a published blog
// cover, or the uploader's avatar). This prevents another user from exposing
// someone else's private/draft image just by referencing its id.
async function isPublicImage(imageId: number, uploadedBy: number | null): Promise<boolean> {
  if (uploadedBy == null) return false;
  const url = `/api/images/${imageId}`;
  const anchored = { OR: [{ ownerId: uploadedBy }, { collaborators: { some: { userId: uploadedBy } } }] };

  const viaPost = await prisma.postImage.findFirst({
    where: { imageId, post: { status: "PUBLISHED", blog: { isPublished: true, ...anchored } } },
    select: { postId: true },
  });
  if (viaPost) return true;

  const viaCover = await prisma.blog.findFirst({
    where: { coverImageUrl: url, isPublished: true, ...anchored },
    select: { id: true },
  });
  if (viaCover) return true;

  const viaAvatar = await prisma.user.findFirst({ where: { avatarUrl: url, id: uploadedBy }, select: { id: true } });
  return !!viaAvatar;
}

// A signed-in user may view an image referenced by content they own/collaborate
// on (covers private drafts), a blog cover they manage, or their own avatar.
async function canAccessPrivate(imageId: number, userId: number): Promise<boolean> {
  const url = `/api/images/${imageId}`;
  const accessible = { OR: [{ ownerId: userId }, { collaborators: { some: { userId } } }] };

  const viaPost = await prisma.postImage.findFirst({
    where: { imageId, post: { blog: accessible } },
    select: { postId: true },
  });
  if (viaPost) return true;

  const viaCover = await prisma.blog.findFirst({ where: { coverImageUrl: url, ...accessible }, select: { id: true } });
  if (viaCover) return true;

  const viaAvatar = await prisma.user.findFirst({ where: { avatarUrl: url, id: userId }, select: { id: true } });
  return !!viaAvatar;
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

  let cache = "public, max-age=31536000, immutable";

  if (!(await isPublicImage(imageId, image.uploadedBy))) {
    const user = await getCurrentUser();
    const ownUpload = !!user && image.uploadedBy === user.userId;
    const allowed =
      !!user && (ownUpload || user.isAdmin || (await canAccessPrivate(imageId, user.userId)));
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
