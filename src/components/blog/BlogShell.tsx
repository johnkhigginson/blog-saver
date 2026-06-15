import Link from "next/link";
import { BookMarked } from "lucide-react";

// Standalone chrome for the public blog. Intentionally independent of the
// authenticated app shell so outside visitors get a clean, login-free reading
// experience.
export function BlogShell({
  children,
  homeHref = "/blog",
  homeLabel = "Blog",
  aboutHref,
  wide = false,
}: {
  children: React.ReactNode;
  homeHref?: string;
  homeLabel?: string;
  aboutHref?: string;
  wide?: boolean;
}) {
  const width = wide ? "max-w-5xl" : "max-w-3xl";
  return (
    <div className="flex min-h-screen flex-col bg-[#fdfcf8] text-stone-800 dark:bg-background dark:text-foreground">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#fdfcf8]/85 backdrop-blur dark:border-border/60 dark:bg-background/85">
        <div className={`mx-auto flex ${width} items-center justify-between gap-2 px-4 py-3.5`}>
          <Link href={homeHref} className="flex items-center gap-2">
            <BookMarked className="h-6 w-6 text-primary" />
            <span className="font-display text-lg font-semibold tracking-tight">{homeLabel}</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-stone-500 dark:text-muted-foreground">
            <Link href={homeHref} className="transition-colors hover:text-stone-900 dark:hover:text-foreground">
              Posts
            </Link>
            {aboutHref && (
              <Link href={aboutHref} className="transition-colors hover:text-stone-900 dark:hover:text-foreground">
                About
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className={`mx-auto w-full ${width} flex-1 px-4 py-10`}>{children}</main>

      <footer className="mt-8 border-t border-stone-200/80 py-8 dark:border-border/60">
        <div className={`mx-auto ${width} flex items-center gap-2 px-4 text-xs text-stone-400 dark:text-muted-foreground`}>
          <BookMarked className="h-4 w-4" />
          Powered by Blog Saver
        </div>
      </footer>
    </div>
  );
}

// Tailwind-only article styling for preserved blog HTML (no typography plugin).
export const PROSE_CLASS =
  "max-w-none text-[15px] leading-7 text-foreground [&_a]:text-primary [&_a]:underline " +
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold " +
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold " +
  "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 " +
  "[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-xl [&_img]:h-auto [&_blockquote]:border-l-4 [&_blockquote]:border-border " +
  "[&_blockquote]:pl-4 [&_blockquote]:italic [&_table]:my-3 [&_iframe]:max-w-full [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3";
