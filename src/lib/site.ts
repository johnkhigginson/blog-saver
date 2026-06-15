// Canonical public base URL for absolute links in SEO output (sitemap, RSS,
// Open Graph, JSON-LD). Override with NEXT_PUBLIC_SITE_URL if the domain
// changes.
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://mylemonkitchen.com").replace(/\/$/, "");
}

// Make an app-relative URL (e.g. an uploaded image at /api/images/1) absolute.
export function absoluteUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${getSiteUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
}
