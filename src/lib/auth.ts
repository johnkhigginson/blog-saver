import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { normalizeEmail } from "./email-normalize";
import { audit } from "./audit";
import { checkRateLimit } from "./rate-limit";

interface ExtendedUser {
  systemRole?: string;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials, request) {
        const rawEmail = credentials?.email as string;
        const password = credentials?.password as string;
        if (!rawEmail || !password) return null;

        const email = normalizeEmail(rawEmail);

        // Brute-force throttle: cap attempts per IP+email window.
        const ip =
          (request as Request | undefined)?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";
        if (!checkRateLimit(`login:${ip}:${email}`, 10, 15 * 60_000).ok) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });

        await audit({
          category: "AUTH",
          action: "LOGIN",
          summary: `${user.name} signed in`,
          actorUserId: user.id,
          actorName: user.name,
        });

        return {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          systemRole: user.systemRole,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.systemRole = (user as ExtendedUser).systemRole;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        (session.user as ExtendedUser).systemRole = token.systemRole as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});

interface AuthUser {
  userId: number;
  name: string;
  systemRole: string;
  isAdmin: boolean;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const ext = session.user as ExtendedUser;
  const systemRole = ext.systemRole || "USER";
  return {
    userId: parseInt(session.user.id, 10),
    name: session.user.name ?? "",
    systemRole,
    isAdmin: systemRole === "ADMIN",
  };
}

export async function getCurrentUserId(): Promise<number | null> {
  const user = await getCurrentUser();
  return user?.userId ?? null;
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new Error("Not authorized");
  return user;
}

// Throws unless the current user owns the blog, collaborates on it, or is an
// admin. Returns the resolved user. Central authorization for blog mutations.
export async function requireBlogAccess(blogId: number): Promise<AuthUser> {
  const user = await requireUser();
  if (user.isAdmin) return user;
  const blog = await prisma.blog.findFirst({
    where: {
      id: blogId,
      OR: [{ ownerId: user.userId }, { collaborators: { some: { userId: user.userId } } }],
    },
    select: { id: true },
  });
  if (!blog) throw new Error("Not authorized");
  return user;
}
