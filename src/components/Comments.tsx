import Link from "next/link";
import { deleteComment } from "@/app/comments/actions";
import type { Comment } from "@/lib/data";
import { CommentForm } from "./CommentForm";
import { ScrollToHere } from "./ScrollToHere";

const ERRORS: Record<string, string> = {
  empty: "Please write something first.",
  long: "That's a bit long — please keep it under 1,000 characters.",
  failed: "Your comment couldn't be posted. Please try again.",
  delete: "That comment couldn't be deleted.",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

type Props = {
  episodeId: string;
  path: string;
  comments: Comment[];
  userId: string | null;
  isAdmin: boolean;
  canPost: boolean;
  error?: string;
  posted?: boolean;
  deleted?: boolean;
};

export function Comments({ episodeId, path, comments, userId, isAdmin, canPost, error, posted, deleted }: Props) {
  return (
    <section
      id="comments"
      aria-labelledby="comments-title"
      className="mx-auto max-w-panel scroll-mt-20 px-4 pb-20"
    >
      {(posted || deleted || error) && <ScrollToHere />}
      <h2 id="comments-title" className="text-2xl font-extrabold">
        Comments ({comments.length})
      </h2>

      {error && ERRORS[error] && (
        <p role="alert" className="mt-3 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
          {ERRORS[error]}
        </p>
      )}
      {posted && !error && (
        <p role="status" className="mt-3 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
          ✓ Thanks — your comment is up.
        </p>
      )}
      {deleted && !error && (
        <p role="status" className="mt-3 rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
          ✓ Comment deleted.
        </p>
      )}

      <div className="mt-4">
        {userId ? (
          canPost ? (
            <CommentForm episodeId={episodeId} path={path} />
          ) : (
            <p className="text-muted">Comments open when this episode is published.</p>
          )
        ) : (
          <Link href={`/login?next=${encodeURIComponent(`${path}#comments`)}`} className="btn btn-primary w-full">
            Sign in to comment
          </Link>
        )}
      </div>

      {comments.length === 0 ? (
        <p className="mt-6 text-muted">No comments yet. Be the first!</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-2xl border-2 border-line bg-surface p-4">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <strong className="text-base">{c.author_name || "Reader"}</strong>
                <time dateTime={c.created_at} className="text-muted">
                  {when(c.created_at)}
                </time>
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
              {(c.user_id === userId || isAdmin) && (
                <form action={deleteComment} className="mt-2">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="path" value={path} />
                  <button type="submit" className="min-h-11 text-sm font-bold text-muted underline">
                    Delete{c.user_id !== userId ? " (admin)" : ""}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
