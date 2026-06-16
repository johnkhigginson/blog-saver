"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface Result {
  messages: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export function EmailImportForm({ blogId }: { blogId: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [senderFilter, setSenderFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (files.length === 0) {
      setError("Choose a .mbox or .eml file first.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      if (senderFilter.trim()) fd.append("senderFilter", senderFilter.trim());
      const res = await fetch(`/api/blogs/${blogId}/import-email`, { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Import failed");
      else {
        setResult(d);
        router.refresh();
      }
    } catch {
      setError("Something went wrong importing the emails.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary" /> Email file
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Upload .mbox or .eml</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".mbox,.eml,message/rfc822"
              multiple
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                {files.length ? "Change files" : "Choose file(s)"}
              </Button>
              {files.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {files.length === 1 ? files[0].name : `${files.length} files`}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sender">Only import emails from (optional)</Label>
            <Input
              id="sender"
              value={senderFilter}
              onChange={(e) => setSenderFilter(e.target.value)}
              placeholder="e.g. a name or email address"
            />
            <p className="text-xs text-muted-foreground">
              If the file is a whole inbox, enter the sender (name or address) so only their letters
              are imported. Leave blank to import every message in the file.
            </p>
          </div>

          <Button onClick={run} disabled={running || files.length === 0}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            {running ? "Importing…" : "Import emails"}
          </Button>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="flex items-start gap-2 rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              <span>
                Imported <span className="font-medium">{result.imported}</span> post(s) from {result.messages}{" "}
                message(s){result.skipped > 0 ? `, skipped ${result.skipped} (duplicates/filtered)` : ""}. Photos
                attached to the emails were saved with each post.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to get the emails out of Gmail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>The cleanest way to export a batch of emails (e.g. the weekly mission letters):</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In Gmail, find the emails and apply a label to them (e.g. &quot;mission&quot;).</li>
            <li>
              Go to <span className="font-medium text-foreground">Google Takeout</span> → Deselect all →
              choose <span className="font-medium text-foreground">Mail</span> → &quot;All Mail data
              included&quot; → select just that label → export. You&apos;ll get a <code>.mbox</code> file.
            </li>
            <li>Upload that .mbox here. (Or, for a few emails, open each and &quot;Download message&quot; to get .eml files.)</li>
          </ol>
          <p>Re-importing is safe — duplicates (same title + date) are skipped.</p>
        </CardContent>
      </Card>
    </div>
  );
}
