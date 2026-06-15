"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { BookMarked, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DashboardHeader({ userName }: { userName: string }) {
  return (
    <header className="border-b border-border bg-card/50">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-display text-lg font-semibold">
          <BookMarked className="h-5 w-5 text-primary" /> Blog Saver
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/dashboard" className="rounded-md px-3 py-1.5 hover:bg-muted">Blogs</Link>
          <Link href="/dashboard/import" className="rounded-md px-3 py-1.5 hover:bg-muted">Import</Link>
          <Link href="/dashboard/recover" className="rounded-md px-3 py-1.5 hover:bg-muted">Recover</Link>
          <span className="mx-2 hidden text-muted-foreground sm:inline">{userName}</span>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </nav>
      </div>
    </header>
  );
}
