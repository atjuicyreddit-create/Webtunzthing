import Link from "next/link";
import { DemoBanner } from "@/components/DemoBanner";
import { getAllSeries } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const allSeries = await getAllSeries();

  return (
    <>
      <DemoBanner />
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-8">
        <section className="text-center">
          <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
            Comics <span className="text-brand">you steer.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-lg text-muted">
            Read free. Then suggest what happens next &mdash; the top-voted idea becomes the
            next episode.
          </p>
        </section>

        <section aria-labelledby="series-heading" className="mt-10">
          <h2 id="series-heading" className="sr-only">
            Comics
          </h2>

          {allSeries.length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-line p-8 text-center">
              <p className="text-xl font-bold">No comics here yet.</p>
              <p className="mt-2 text-muted">
                Run the seed file in Supabase (see the README) to add Morning Brew, or
                create a series from the admin area once it&rsquo;s built.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {allSeries.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/series/${s.slug}`}
                    className="block rounded-3xl border-2 border-line bg-surface p-6 transition hover:border-brand"
                  >
                    <p className="text-sm font-bold uppercase tracking-wide text-brand">
                      Free to read
                    </p>
                    <h3 className="mt-1 text-2xl font-extrabold">{s.title}</h3>
                    {s.tagline && <p className="mt-1 font-semibold">{s.tagline}</p>}
                    {s.description && <p className="mt-2 text-muted">{s.description}</p>}
                    <span className="btn btn-primary mt-4 w-full sm:w-auto">Start reading</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
