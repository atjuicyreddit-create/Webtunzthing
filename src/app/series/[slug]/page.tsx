import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBanner } from "@/components/DemoBanner";
import { getSeriesPage } from "@/lib/data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getSeriesPage(slug);
  if (!page) return { title: "Comic not found" };
  return {
    title: page.series.title,
    description: page.series.tagline ?? page.series.description ?? undefined,
  };
}

export default async function SeriesPage({ params }: Props) {
  const { slug } = await params;
  const page = await getSeriesPage(slug);
  if (!page) notFound();

  const { series, episodes } = page;
  const latest = episodes[episodes.length - 1];
  const first = episodes[0];

  return (
    <>
      <DemoBanner />
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-8">
        <h1 className="text-4xl font-extrabold leading-tight">{series.title}</h1>
        {series.tagline && <p className="mt-1 text-lg font-semibold">{series.tagline}</p>}
        {series.description && <p className="mt-3 text-muted">{series.description}</p>}

        {episodes.length > 0 && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {latest && (
              <Link
                href={`/series/${series.slug}/episodes/${latest.number}`}
                className="btn btn-primary"
              >
                Read the latest (Episode {latest.number})
              </Link>
            )}
            {first && latest && first.number !== latest.number && (
              <Link
                href={`/series/${series.slug}/episodes/${first.number}`}
                className="btn btn-quiet"
              >
                Start from Episode {first.number}
              </Link>
            )}
          </div>
        )}

        <h2 className="mt-10 text-2xl font-extrabold">Episodes</h2>
        {episodes.length === 0 ? (
          <div className="mt-3 rounded-3xl border-2 border-dashed border-line p-8 text-center">
            <p className="text-lg font-bold">The first episode is on its way.</p>
            <p className="mt-2 text-muted">Check back soon.</p>
          </div>
        ) : (
          <ol className="mt-3 space-y-3">
            {episodes.map((e) => (
              <li key={e.number}>
                <Link
                  href={`/series/${series.slug}/episodes/${e.number}`}
                  className="flex min-h-16 items-center gap-4 rounded-2xl border-2 border-line bg-surface px-4 py-3 transition hover:border-brand"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-extrabold">
                    {e.number}
                  </span>
                  <span>
                    <span className="block font-bold">{e.title}</span>
                    {e.synopsis && <span className="block text-sm text-muted">{e.synopsis}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
