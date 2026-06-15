import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-4">
        <h1 className="font-display text-5xl font-semibold tracking-tight">Blog Saver</h1>
        <p className="text-lg text-muted-foreground">
          Import a Blogger site, rescue images Google deleted from the Wayback Machine,
          recover blogs that were taken down entirely, and keep them all up to date.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {user ? (
          <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }))}>
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
              Sign in
            </Link>
            <Link href="/register" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
              Create an account
            </Link>
          </>
        )}
        <Link href="/blog" className={cn(buttonVariants({ size: "lg", variant: "ghost" }))}>
          Browse published blogs
        </Link>
      </div>
    </main>
  );
}
