import Link from "next/link";
import { formatDate } from "@/lib/access";

type Props = {
  seriesSlug: string;
  earlyUntil: string | null;
  signedIn: boolean;
  here: string;
  previous: { number: number; title: string } | null;
};

// Shown instead of the panels while an episode is "paid early".
export function LockCard({ seriesSlug, earlyUntil, signedIn, here, previous }: Props) {
  const base = `/series/${seriesSlug}`;
  return (
    <section className="mx-auto max-w-panel px-4 pb-16 pt-4">
      <div className="rounded-3xl border-2 border-line bg-surface p-6 text-center shadow-sm">
        <p aria-hidden="true" className="text-4xl">
          🔒
        </p>
        <h2 className="mt-2 text-2xl font-extrabold leading-tight">Early access</h2>
        <p className="mt-2 text-muted">
          This episode is open to supporters first.{" "}
          {earlyUntil ? (
            <>
              It&rsquo;s free for everyone on <strong>{formatDate(earlyUntil)}</strong>.
            </>
          ) : (
            <>It will be free for everyone soon.</>
          )}
        </p>
        <p className="mt-2 text-sm text-muted">Supporter plans are coming soon.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {!signedIn && (
            <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn btn-primary">
              Sign in
            </Link>
          )}
          {previous && (
            <Link href={`${base}/episodes/${previous.number}`} className="btn btn-quiet">
              ← Read Episode {previous.number}
            </Link>
          )}
          <Link href={base} className="btn btn-quiet">
            All episodes
          </Link>
        </div>
      </div>
    </section>
  );
}
