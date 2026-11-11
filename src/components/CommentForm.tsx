"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { addComment } from "@/app/comments/actions";

const MAX = 1000;

export function CommentForm({ episodeId, path }: { episodeId: string; path: string }) {
  const [body, setBody] = useState("");
  return (
    <form action={addComment} className="space-y-2">
      <input type="hidden" name="episode_id" value={episodeId} />
      <input type="hidden" name="path" value={path} />
      <label htmlFor="comment-body" className="block font-bold">
        What should happen next?
      </label>
      <textarea
        id="comment-body"
        name="body"
        required
        rows={3}
        maxLength={MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Share your idea or reaction…"
        className="min-h-24 w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 text-base"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted" aria-live="polite">
          {body.length}/{MAX}
        </span>
        <PostButton disabled={body.trim().length === 0} />
      </div>
    </form>
  );
}

function PostButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="btn btn-primary disabled:opacity-50">
      {pending ? "Posting…" : "Post comment"}
    </button>
  );
}
