"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageCircle, Trash2 } from "lucide-react";

interface Comment {
  id: number;
  authorName: string;
  body: string;
  createdAt: string;
  mine?: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function PostComments({ postId, canModerate }: { postId: number; canModerate: boolean }) {
  const { status } = useSession();
  const pathname = usePathname();
  const loggedIn = status === "authenticated";

  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/blog/comments?postId=${postId}`)
      .then((r) => r.json())
      .then((d) => setComments(d.comments ?? []))
      .catch(() => {});
  }, [postId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/blog/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not post your comment.");
        return;
      }
      if (data.comment) setComments((prev) => [...prev, data.comment]);
      setBody("");
    } catch {
      setError("Could not post your comment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: number) {
    const res = await fetch(`/api/blog/comments/${id}`, { method: "DELETE" });
    if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <section className="mt-10 border-t border-border/60 pt-6">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <MessageCircle className="h-5 w-5 text-primary" />
        Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </h2>

      <div className="space-y-4">
        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground">Be the first to comment.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="rounded-xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{c.authorName}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                {(canModerate || c.mine) && (
                  <button
                    onClick={() => remove(c.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Delete comment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
          </div>
        ))}
      </div>

      {loggedIn ? (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold">Leave a comment</h3>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="Share your thoughts…"
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !body.trim()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Post comment
          </Button>
        </form>
      ) : (
        <div className="mt-6 rounded-xl border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>{" "}
          to leave a comment.
        </div>
      )}
    </section>
  );
}
