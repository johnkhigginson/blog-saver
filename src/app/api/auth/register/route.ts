import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/email-normalize";
import { audit } from "@/lib/audit";
import { enforceRateLimit, ipKey } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit("register", ipKey(request), 5, 60 * 60_000);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { name, password } = body;

  // Honeypot: a hidden field real users never see. Bots that fill every input
  // trip it. Respond with a generic error so the trap isn't obvious.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ error: "Registration failed" }, { status: 400 });
  }

  if (!name || !body.email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // The very first account to register becomes the admin.
  const userCount = await prisma.user.count();
  const systemRole = userCount === 0 ? "ADMIN" : "USER";

  const user = await prisma.user.create({
    data: { name: String(name).slice(0, 200), email, passwordHash, systemRole },
  });

  await audit({
    category: "AUTH",
    action: "REGISTER",
    summary: `${user.name} created an account`,
    actorUserId: user.id,
    actorName: user.name,
  });

  return NextResponse.json({ id: user.id, name: user.name, email: user.email }, { status: 201 });
}
