import { prisma } from "@/lib/prisma";

// Records an important action to the audit log. Fail-safe by design — logging
// must never break the operation it's recording, so all errors are swallowed.

export type AuditCategory = "AUTH" | "BLOG" | "POST" | "COMMENT" | "IMPORT" | "USER" | "ADMIN";

export interface AuditInput {
  category: AuditCategory;
  action: string;
  summary: string;
  actorUserId?: number | null;
  actorName?: string | null;
  targetType?: string | null;
  targetId?: number | null;
  metadata?: unknown;
  ip?: string | null;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        category: input.category,
        action: input.action.slice(0, 80),
        summary: input.summary.slice(0, 500),
        userId: input.actorUserId ?? null,
        actorName: input.actorName ? input.actorName.slice(0, 200) : null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata != null ? JSON.stringify(input.metadata).slice(0, 4000) : null,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record", input.action, err);
  }
}

// Best-effort client IP from common proxy headers.
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
