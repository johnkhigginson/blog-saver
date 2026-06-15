"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

export interface InitialPost {
  id: number;
  title: string;
  slug: string | null;
  excerpt: string | null;
  bodyHtml: string;
  heroImageUrl: string | null;
  status: string;
  tags: string[];
}

export function PostEditorForm({ blogId, post }: { blogId: number; post?: InitialPost }) {
  const router = useRouter();
  const heroRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(post?.heroImageUrl ?? "");
  const [tags, setTags] = useState((post?.tags ?? []).join(", "));
  const [bodyHtml, setBodyHtml] = useState(post?.bodyHtml ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);

  async function uploadHero(file: File) {
    setUploadingHero(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) setHeroImageUrl(data.url);
      else toast.error(data.error || "Upload failed");
    } finally {
      setUploadingHero(false);
    }
  }

  async function save(status: "DRAFT" | "PUBLISHED") {
    if (!title.trim()) {
      toast.error("A title is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        blogId,
        title,
        slug: slug || undefined,
        excerpt,
        heroImageUrl,
        bodyHtml,
        status,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      const res = post
        ? await fetch(`/api/posts/${post.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success(status === "PUBLISHED" ? "Published" : "Saved");
      router.push(`/dashboard/blogs/${blogId}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" />
      </div>

      <div className="space-y-2">
        <Label>Body</Label>
        <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="slug">Slug (optional)</Label>
          <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from title" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="travel, photography" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="excerpt">Excerpt (optional)</Label>
        <Textarea
          id="excerpt"
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          rows={2}
          placeholder="Short summary for listings and SEO. Auto-generated if left blank."
        />
      </div>

      <div className="space-y-2">
        <Label>Hero image</Label>
        <div className="flex items-center gap-3">
          {heroImageUrl ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImageUrl} alt="" className="h-20 w-32 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => setHeroImageUrl("")}
                className="absolute -right-2 -top-2 rounded-full bg-background p-0.5 shadow"
                title="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => heroRef.current?.click()} disabled={uploadingHero}>
              {uploadingHero ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              Upload hero
            </Button>
          )}
          <input
            ref={heroRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadHero(f);
              if (heroRef.current) heroRef.current.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button onClick={() => save("PUBLISHED")} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Publish
        </Button>
        <Button variant="outline" onClick={() => save("DRAFT")} disabled={saving}>
          Save draft
        </Button>
      </div>
    </div>
  );
}
