import { NextResponse } from "next/server";
import { clientIp } from "@/lib/audit";

// Simple in-memory sliding-window rate limiter. Suitable for a single-instance
// (one pm2 process) deployment. If the app is ever scaled to multiple
// instances, swap the Map for a shared store (e.g. Redis).
const store = new Map<string, number[]>();

function prune(now: number, windowMs: number) {
  for (const [k, v] of store) {
    const fresh = v.filter((t) => now - t < windowMs);
    if (fresh.length === 0) store.delete(k);
    else store.set(k, fresh);
  }
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    return { ok: false, retryAfter };
  }
  hits.push(now);
  store.set(key, hits);
  if (store.size > 10000) prune(now, windowMs);
  return { ok: true, retryAfter: 0 };
}

export function tooManyRequests(retryAfter: number) {
  return NextResponse.json(
    { error: "Too many requests — please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

// Enforce a limit for `scope:identifier`. Returns a 429 response when exceeded,
// or null to proceed.
export function enforceRateLimit(
  scope: string,
  identifier: string | number,
  limit: number,
  windowMs: number
): NextResponse | null {
  const { ok, retryAfter } = checkRateLimit(`${scope}:${identifier}`, limit, windowMs);
  return ok ? null : tooManyRequests(retryAfter);
}

export function ipKey(req: Request): string {
  return clientIp(req) ?? "unknown";
}
