import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteSeries } from "@/app/(site)/admin/actions";
import { SeriesForm } from "@/components/admin/SeriesForm";
import { Banner, fieldClass } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin";
import type { Series } from "@/lib/types";

export const metadata: Metadata = { title: "Series" };

export default async function EditSeries({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const { supabase } = await requireAdmin(`/admin/series/${id}`);

  const { data: series } = await supabase.from("series").select("*").eq("id", id).maybeSingle();
  if (!series) notFound();
  const { data: episodes } = await supabase
    .from("episodes")
    .select("id,number,title,status,access,panels(id)")
    .eq("series_id", id)
    .order("number", { ascending: true });

  const list = episodes ?? [];
  const nextNumber = list.reduce((m, e) => Math.max(m, e.number), 0) + 1;

  return (
    <>
      <h1 className="text-3xl font-extrabold">{series.title}</h1>
      <p className="mb-2 text-sm text-muted">
        <Link href={`/series/${series.slug}`} className="inline-flex min-h-11 items-center underline">
          View on the site
        </Link>
      </p>
      <Banner error={error} ok={saved ? "Saved." : null} />

      <h2 className="text-2xl font-extrabold">Episodes</h2>
      <Link href={`/admin/series/${id}/episodes/new`} className="btn btn-primary mt-3 w-full">
        ＋ New episode (#{nextNumber})
      </Link>
      {list.length > 0 && (
        <ol className="mt-4 space-y-3">
          {list.map((e) => (
            <li key={e.id}>
              <Link
                href={`/admin/episodes/${e.id}`}
                className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-line bg-surface px-4 py-3 transition hover:border-brand"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-extrabold">
                  {e.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{e.title}</span>
                  <span className="block text-sm text-muted">
                    {e.status === "published" ? "Published" : "Draft"} ·{" "}
                    {e.access === "paid_early" ? "Paid early" : "Free"} ·{" "}
                    {(e.panels as unknown[] | null)?.length ?? 0} panels
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <h2 className="mb-3 mt-10 text-2xl font-extrabold">Series details</h2>
      <SeriesForm series={series as Series} />

      <form action={deleteSeries} className="mt-10 rounded-2xl border-2 border-line p-4">
        <input type="hidden" name="id" value={id} />
        <p className="font-bold">Delete this series</p>
        <p className="text-sm text-muted">
          Removes the series and all its episodes and panels. Type <strong>delete</strong> to
          confirm.
        </p>
        <input
          name="confirm"
          aria-label="Type delete to confirm"
          autoCapitalize="none"
          autoComplete="off"
          className={`${fieldClass} mt-2`}
        />
        <button type="submit" className="btn btn-quiet mt-3 w-full">
          Delete series
        </button>
      </form>
    </>
  );
}
