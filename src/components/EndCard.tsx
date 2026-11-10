import Link from "next/link";
import { ShareButton } from "./ShareButton";

type Props = {
  seriesTitle: string;
  seriesSlug: string;
  episodeNumber: number;
  episodeTitle: string;
  isLatest: boolean;
  signedIn: boolean;
  next: { number: number; title: string } | null;
  previous: { number: number; title: string } | null;
};

export function EndCard(props: Props) {
  const { isLatest, signedIn, next, previous, seriesSlug, seriesTitle } = props;
  const base = `/series/${seriesSlug}`;
  const here = `${base}/episodes/${props.episodeNumber}`;

  return (
    <section
      aria-labelledby="end-card-title"
      className="mx-auto max-w-panel px-4 pb-16 pt-6"
    >
      <div className="rounded-3xl border-2 border-line bg-surface p-6 text-center shadow-sm">
        {isLatest ? (
          <>
            <h2 id="end-card-title" className="text-3xl font-extrabold leading-tight">
              What happens next?
            </h2>
            <p className="mt-2 text-xl font-bold text-brand">Comment and vote.</p>
            <p className="mx-auto mt-3 max-w-prose text-muted">
              You steer the route, not the destination. The top-voted suggestion decides
              the next beat of {seriesTitle}.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
              {signedIn ? (
                <p className="rounded-2xl bg-brand-soft px-4 py-3 font-semibold">
                  You&rsquo;re signed in. Suggestions open very soon — watch this space.
                </p>
              ) : (
                <Link
                  href={`/login?next=${encodeURIComponent(here)}`}
                  className="btn btn-primary"
                >
                  Sign in to join in
                </Link>
              )}
              <ShareButton title={`${seriesTitle} · ${props.episodeTitle}`} path={here} />
            </div>
          </>
        ) : (
          <>
            <h2 id="end-card-title" className="text-3xl font-extrabold leading-tight">
              The end of this episode
            </h2>
            <p className="mt-2 text-muted">
              The story has moved on — catch up with the latest episode.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
              {next && (
                <Link href={`${base}/episodes/${next.number}`} className="btn btn-primary">
                  Next: Episode {next.number}
                </Link>
              )}
              <ShareButton title={`${seriesTitle} · ${props.episodeTitle}`} path={here} />
            </div>
          </>
        )}
      </div>

      <nav aria-label="Episodes" className="mt-4 flex items-center justify-between gap-3">
        {previous ? (
          <Link href={`${base}/episodes/${previous.number}`} className="btn btn-quiet">
            ← Episode {previous.number}
          </Link>
        ) : (
          <span />
        )}
        <Link href={base} className="btn btn-quiet">
          All episodes
        </Link>
      </nav>
    </section>
  );
}
