import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoBanner } from "@/components/DemoBanner";
import { EndCard } from "@/components/EndCard";
import { Reader } from "@/components/Reader";
import { getCurrentUser, getEpisodePage } from "@/lib/data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; number: string }> };

function parseNumber(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && String(n) === value ? n : null;
}

// The Open Graph image (the picture shown when the link is shared) comes from
// ./opengraph-image.tsx in this same folder — Next.js wires it up automatically.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, number } = await params;
  const n = parseNumber(number);
  const page = n ? await getEpisodePage(slug, n) : null;
  if (!page) return { title: "Episode not found" };

  const title = `${page.series.title} · Episode ${page.episode.number}: ${page.episode.title}`;
  const description = page.isLatest
    ? "What happens next? Read it, then comment and vote."
    : (page.episode.synopsis ?? page.series.tagline ?? undefined);

  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EpisodePage({ params }: Props) {
  const { slug, number } = await params;
  const n = parseNumber(number);
  if (!n) notFound();

  const [page, user] = await Promise.all([getEpisodePage(slug, n), getCurrentUser()]);
  if (!page) notFound();

  const { series, episode, previous, next, isLatest } = page;

  return (
    <>
      <DemoBanner />
      <div className="mx-auto max-w-panel px-4 pb-4 pt-5 text-center">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">
          {series.title} · Episode {episode.number}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight">{episode.title}</h1>
        <p className="mt-2 text-sm text-muted">Scroll down to read ↓</p>
      </div>

      <Reader panels={episode.panels} />

      <EndCard
        seriesTitle={series.title}
        seriesSlug={series.slug}
        episodeNumber={episode.number}
        episodeTitle={episode.title}
        isLatest={isLatest}
        signedIn={Boolean(user)}
        next={next}
        previous={previous}
      />
    </>
  );
}
