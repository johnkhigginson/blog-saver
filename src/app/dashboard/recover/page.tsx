"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LifeBuoy, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";

interface RecoverResult {
  blogId: number;
  total: number;
  imported: number;
}

interface RecoverApiResponse {
  blogId: number;
  total: number;
  imported: number;
  nextOffset: number;
  done: boolean;
  message?: string;
  error?: string;
}

export default function RecoverPage() {
  const [blogUrl, setBlogUrl] = useState("");
  const [blogTitle, setBlogTitle] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecoverResult | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    setProgress(null);
    if (!blogUrl.trim()) {
      setError("Enter the blog's old address.");
      return;
    }
    setRunning(true);

    let offset = 0;
    let blogId: number | null = null;
    let total = 0;
    let importedTotal = 0;
    try {
      for (let i = 0; i < 5000; i++) {
        const res = await fetch("/api/blogs/recover/wayback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blogUrl,
            blogTitle: blogTitle.trim() || undefined,
            blogId: blogId ?? undefined,
            offset,
            limit: 12,
          }),
        });
        const d: RecoverApiResponse = await res.json();
        if (!res.ok) {
          setError(d.error || "Recovery failed");
          break;
        }
        blogId = d.blogId;
        total = d.total;
        importedTotal += d.imported ?? 0;
        offset = d.nextOffset;

        if (d.total === 0) {
          setError(d.message || "No archived posts found for that URL.");
          break;
        }
        setProgress(`Recovered ${Math.min(offset, total)} of ${total} archived posts…`);

        if (d.done) {
          setResult({ blogId: d.blogId, total, imported: importedTotal });
          break;
        }
      }
    } catch {
      setError("Something went wrong during recovery.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Recover a deleted blog</h1>
        <p className="text-sm text-muted-foreground">
          If a Blogger blog was taken down, we can often rebuild it from the Wayback Machine using
          only its old address. Posts are scraped from archived snapshots; afterwards, run Rescue
          images to bring the photos back too.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="h-4 w-4 text-primary" /> Old blog address
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="blogUrl">URL</Label>
            <Input
              id="blogUrl"
              value={blogUrl}
              onChange={(e) => setBlogUrl(e.target.value)}
              placeholder="thatdeletedblog.blogspot.com"
            />
            <p className="text-xs text-muted-foreground">
              The exact address it used to live at. The closer the better.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="blogTitle">Blog name (optional)</Label>
            <Input
              id="blogTitle"
              value={blogTitle}
              onChange={(e) => setBlogTitle(e.target.value)}
              placeholder="Defaults to the domain"
            />
          </div>

          <Button onClick={run} disabled={running || !blogUrl.trim()}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LifeBuoy className="mr-2 h-4 w-4" />}
            {running ? "Recovering…" : "Start recovery"}
          </Button>

          {progress && running && <p className="text-xs text-muted-foreground">{progress}</p>}

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
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Recovery complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Reconstructed <span className="font-medium text-foreground">{result.imported}</span> post(s)
              from {result.total} archived page(s).
            </p>
            <p className="text-muted-foreground">
              Next: open the blog and run <span className="font-medium text-foreground">Rescue images</span> to
              recover the photos, then review and publish.
            </p>
            <Link href={`/dashboard/blogs/${result.blogId}`} className="inline-flex">
              <Button size="sm" variant="outline">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open blog
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
