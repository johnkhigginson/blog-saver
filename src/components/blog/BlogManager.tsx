"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Plus,
  ExternalLink,
  ImageDown,
  Trash2,
  Pencil,
  Globe,
  EyeOff,
  Rss,
  Mail,
} from "lucide-react";
import { toast } from "sonner";

export interface ManagedPost {
  id: number;
  title: string;
  slug: string | null;
  status: string;
  publishedAt: string | null;
}

export interface ManagedBlog {
  id: number;
  title: string;
  description: string | null;
  slug: string | null;
  coverImageUrl: string | null;
  isPublished: boolean;
  sourceUrl: string | null;
  posts: ManagedPost[];
}

export function BlogManager({ blog, canDelete }: { blog: ManagedBlog; canDelete: boolean }) {
  const router = useRouter();

  const [title, setTitle] = useState(blog.title);
  const [description, setDescription] = useState(blog.description ?? "");
  const [slug, setSlug] = useState(blog.slug ?? "");
  const [savingSettings, setSavingSettings] = useState(false);
  const [togglingPublish, setTogglingPublish] = useState(false);

  const [salvaging, setSalvaging] = useState(false);
  const [salvageMsg, setSalvageMsg] = useState<string | null>(null);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/blogs/${blog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, slug: slug || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success("Settings saved");
      router.refresh();
    } finally {
      setSavingSettings(false);
    }
  }

  async function togglePublish() {
    setTogglingPublish(true);
    try {
      const res = await fetch(`/api/blogs/${blog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: !blog.isPublished }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed");
        return;
      }
      toast.success(blog.isPublished ? "Unpublished" : "Published");
      router.refresh();
    } finally {
      setTogglingPublish(false);
    }
  }

  // Loop the batched salvage pass until done.
  async function runSalvage() {
    setSalvaging(true);
    setSalvageMsg("Starting…");
    let cursor = 0;
    let converted = 0;
    let failed = 0;
    let throttled = 0;
    const summarize = (done: boolean) => {
      const parts = [`recovered ${converted} image(s)`];
      if (failed) parts.push(`${failed} not recoverable`);
      if (throttled) parts.push(`${throttled} couldn't be checked (Wayback rate-limited — try again in a few minutes)`);
      return `${done ? "Done. " : ""}${parts.join("; ")}${done ? "." : "…"}`;
    };
    try {
      for (let i = 0; i < 5000; i++) {
        const res = await fetch(`/api/blogs/${blog.id}/salvage-images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor, limit: 3 }),
        });
        const d = await res.json();
        if (!res.ok) {
          setSalvageMsg(d.error || "Salvage failed");
          break;
        }
        converted += d.converted;
        failed += d.failed;
        throttled += d.throttled || 0;
        cursor = d.nextCursor;
        setSalvageMsg(summarize(false));
        if (d.done) {
          setSalvageMsg(summarize(true));
          router.refresh();
          break;
        }
      }
    } catch {
      setSalvageMsg("Something went wrong during salvage.");
    } finally {
      setSalvaging(false);
    }
  }

  async function deleteBlog() {
    if (!window.confirm(`Delete “${blog.title}” and all its posts? This cannot be undone.`)) return;
    const res = await fetch(`/api/blogs/${blog.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Blog deleted");
      router.push("/dashboard");
      router.refresh();
    } else {
      const d = await res.json();
      toast.error(d.error || "Delete failed");
    }
  }

  async function deletePost(id: number, postTitle: string) {
    if (!window.confirm(`Delete “${postTitle}”?`)) return;
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Post deleted");
      router.refresh();
    } else {
      toast.error("Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{blog.title}</h1>
          <Badge variant={blog.isPublished ? "default" : "secondary"}>
            {blog.isPublished ? "Published" : "Draft"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {blog.isPublished && blog.slug && (
            <Link href={`/blog/${blog.slug}`} target="_blank" className="inline-flex">
              <Button variant="outline" size="sm">
                <ExternalLink className="mr-1.5 h-4 w-4" /> View public
              </Button>
            </Link>
          )}
          <Link href={`/dashboard/blogs/${blog.id}/posts/new`} className="inline-flex">
            <Button size="sm">
              <Plus className="mr-1.5 h-4 w-4" /> New post
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="b-title">Title</Label>
            <Input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-desc">Description</Label>
            <Textarea id="b-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-slug">Public URL slug</Label>
            <Input id="b-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from title" />
            <p className="text-xs text-muted-foreground">
              Public address: <code>/blog/{slug || "your-slug"}</code>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveSettings} disabled={savingSettings}>
              {savingSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save settings
            </Button>
            <Button variant="outline" onClick={togglePublish} disabled={togglingPublish}>
              {togglingPublish ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : blog.isPublished ? (
                <EyeOff className="mr-2 h-4 w-4" />
              ) : (
                <Globe className="mr-2 h-4 w-4" />
              )}
              {blog.isPublished ? "Unpublish" : "Publish blog"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageDown className="h-4 w-4 text-primary" /> Rescue images
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Downloads every post&apos;s hero and inline images into the app. Dead Blogger/Google
            links are recovered from the Wayback Machine when possible. Safe to run repeatedly.
          </p>
          <Button variant="outline" onClick={runSalvage} disabled={salvaging}>
            {salvaging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}
            {salvaging ? "Rescuing…" : "Rescue images"}
          </Button>
          {salvageMsg && <p className="text-xs text-muted-foreground">{salvageMsg}</p>}
          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            <Link href={`/dashboard/import?blogId=${blog.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Rss className="h-3.5 w-3.5" /> Import more posts into this blog
            </Link>
            <Link href={`/dashboard/blogs/${blog.id}/import-email`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Mail className="h-3.5 w-3.5" /> Import from email (mission letters)
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posts ({blog.posts.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {blog.posts.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No posts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {blog.posts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="text-xs text-muted-foreground">
                      <Badge variant={p.status === "PUBLISHED" ? "outline" : "secondary"} className="mr-2">
                        {p.status === "PUBLISHED" ? "Published" : "Draft"}
                      </Badge>
                      {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : "no date"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {blog.isPublished && blog.slug && p.status === "PUBLISHED" && (
                      <Link href={`/blog/${blog.slug}/${p.slug ?? p.id}`} target="_blank" title="View" className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    )}
                    <Link href={`/dashboard/posts/${p.id}/edit`} title="Edit" className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <button onClick={() => deletePost(p.id, p.title)} title="Delete" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canDelete && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">Delete this blog</p>
              <p className="text-sm text-muted-foreground">Permanently removes the blog and all its posts.</p>
            </div>
            <Button variant="destructive" onClick={deleteBlog}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
