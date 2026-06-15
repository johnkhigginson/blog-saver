import dns from "node:dns/promises";
import net from "node:net";

// Guards server-side fetches of user/admin-supplied URLs against SSRF: only
// http/https, and the resolved address must not be private/loopback/link-local.
// Redirects are followed manually so each hop is re-validated.
//
// Note: this resolves DNS then fetches, so a determined DNS-rebinding attacker
// has a narrow TOCTOU window. For full protection you'd pin the connection to
// the validated IP via a custom undici dispatcher; this is a strong, simple
// mitigation appropriate for this app.

function ipIsPrivate(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n))) return true;
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local / cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (fam === 6) {
    const lower = ip.toLowerCase().replace(/%.*$/, ""); // strip zone id
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return ipIsPrivate(mapped[1]);
    return false;
  }
  return true; // not a valid IP → treat as unsafe
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error("Blocked request to a private address");
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0) throw new Error("Host did not resolve");
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("Blocked request to a private address");
  }
}

export interface SafeFetchOptions {
  maxRedirects?: number;
  maxBytes?: number; // hard cap on the final response body; guards against memory-exhaustion DoS
}

export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {}
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      throw new Error("Invalid URL");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("Only http and https URLs are allowed");
    }
    await assertPublicHost(u.hostname);

    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return opts.maxBytes != null ? await capBody(res, opts.maxBytes) : res;
    current = new URL(location, current).toString();
  }
  throw new Error("Too many redirects");
}

// Enforce a byte cap on a response body without buffering an unbounded amount:
// reject early on a too-large Content-Length, then stream and abort if exceeded.
// Returns a fresh Response (preserving headers) so callers can still use
// .json()/.text()/.arrayBuffer().
async function capBody(res: Response, maxBytes: number): Promise<Response> {
  const cl = res.headers.get("content-length");
  if (cl && Number(cl) > maxBytes) {
    throw new Error("Response exceeds size limit");
  }
  if (!res.body) return res;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeds size limit");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
}
