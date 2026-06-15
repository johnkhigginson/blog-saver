import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB pre-resize cap

// Upload an image. Resizes/normalizes to web-friendly webp and stores it in the
// DB; returns a stable URL content can reference.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limited = enforceRateLimit("img", user.userId, 40, 60_000);
  if (limited) return limited;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 15MB)" }, { status: 400 });
  }

  const input = Buffer.from(await file.arrayBuffer());

  let output: Buffer;
  try {
    output = await sharp(input)
      .rotate() // honor EXIF orientation
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process that image" }, { status: 400 });
  }

  const image = await prisma.uploadedImage.create({
    data: {
      data: Uint8Array.from(output),
      contentType: "image/webp",
      uploadedBy: user.userId,
      recoveredFrom: "UPLOAD",
    },
    select: { id: true },
  });

  return NextResponse.json({ url: `/api/images/${image.id}` }, { status: 201 });
}
