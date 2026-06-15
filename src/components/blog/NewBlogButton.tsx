"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function NewBlogButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function create() {
    const title = window.prompt("Name your blog");
    if (!title?.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not create the blog");
        return;
      }
      router.push(`/dashboard/blogs/${data.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={create} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
      New blog
    </Button>
  );
}
