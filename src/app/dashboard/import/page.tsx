"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Rss, Upload, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";

interface ImportResult {
  blogId: number;
  blogTitle?: string;
  totalPosts: number;
  imported: number;
  updated: number;
  importedComments: number;
  errors: string[];
}

function ImportInner() {
  const sp = useSearchParams();
  const blogId = sp.get("blogId");
  const intoExisting = !!blogId;

  const [blogUrl, setBlogUrl] = useState("");
  const [blogTitle, setBlogTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run() {
    setError(null);
    setResult(null);
    if (!file && !blogUrl.trim()) {
      setError("Enter a blog address (e.g. yourblog.blogspot.com) or choose an XML export.");
      return;
    }
    setRunning(true);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        if (blogTitle.trim()) fd.append("blogTitle", blogTitle.trim());
        if (blogId) fd.append("blogId", blogId);
        res = await fetch("/api/blogs/import/blogger", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/blogs/import/blogger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blogUrl,
            blogTitle: blogTitle.trim() || undefined,
            blogId: blogId ? Number(blogId) : undefined,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) setError(data.error || "Import failed");
      else setResult(data);
    } catch {
      setError("Something went wrong running the import.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Import from Blogger</h1>
        <p className="text-sm text-muted-foreground">
          {intoExisting
            ? "Add posts from a Blogger feed or XML export into this blog."
            : "Pull a Blogspot blog in. Each post is preserved with its original content, labels, and comments."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rss className="h-4 w-4 text-primary" /> Source
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="blogUrl">Blog address</Label>
            <Input
              id="blogUrl"
              value={blogUrl}
              onChange={(e) => setBlogUrl(e.target.value)}
              placeholder="yourblog.blogspot.com"
              disabled={!!file}
            />
            <p className="text-xs text-muted-foreground">
              Pulls every post from the blog&apos;s public feed.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or upload export</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Label>Blogger XML export</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,application/xml,text/xml"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                {file ? "Change file" : "Choose XML file"}
              </Button>
              {file && (
                <span className="text-xs text-muted-foreground">
                  {file.name}{" "}
                  <button
                    className="underline"
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    remove
                  </button>
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Blogger → Settings → Manage blog → Back up content. Works fully offline.
            </p>
          </div>

          {!intoExisting && (
            <div className="space-y-2">
              <Label htmlFor="blogTitle">Blog name (optional)</Label>
              <Input
                id="blogTitle"
                value={blogTitle}
                onChange={(e) => setBlogTitle(e.target.value)}
                placeholder="Defaults to the source blog's title"
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Re-running is safe: posts already imported are updated in place, not duplicated.
          </p>

          <Button onClick={run} disabled={running || (!file && !blogUrl.trim())}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rss className="mr-2 h-4 w-4" />}
            {running ? "Importing…" : "Start import"}
          </Button>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Import complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{result.imported}</span> new,{" "}
              <span className="font-medium text-foreground">{result.updated}</span> updated, out of{" "}
              {result.totalPosts} posts.
              {result.importedComments > 0 &&
                ` Imported ${result.importedComments} comment${result.importedComments === 1 ? "" : "s"}.`}
            </p>
            <p className="text-muted-foreground">
              Next: open the blog, run <span className="font-medium text-foreground">Rescue images</span> to
              self-host photos (recovering deleted ones from the Wayback Machine), then publish.
            </p>
            <Link href={`/dashboard/blogs/${result.blogId}`} className="inline-flex">
              <Button size="sm" variant="outline">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open blog
              </Button>
            </Link>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                <p className="mb-1 font-medium">Some posts had issues:</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ImportPage() {
  return (
    <Suspense>
      <ImportInner />
    </Suspense>
  );
}
