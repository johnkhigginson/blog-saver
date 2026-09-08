// Canonical public base URL for absolute links in SEO output (sitemap, RSS,
// Open Graph, JSON-LD). Set NEXT_PUBLIC_SITE_URL to your own domain in any
// deployed environment; the dev-server default is only a local fallback.
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

// Make an app-relative URL (e.g. an uploaded image at /api/images/1) absolute.
export function absoluteUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getSiteUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}
