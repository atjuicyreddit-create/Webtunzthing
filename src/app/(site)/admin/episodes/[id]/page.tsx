import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteEpisode } from "@/app/(site)/admin/actions";
import { EpisodeForm } from "@/components/admin/EpisodeForm";
import { PanelManager } from "@/components/admin/PanelManager";
import { Banner, fieldClass } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin";
import type { Panel } from "@/lib/types";

export const metadata: Metadata = { title: "Episode" };

export default async function EditEpisode({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; created?: string; published?: string }>;
}) {
  const { id } = await params;
  const { error, saved, created, published } = await searchParams;
  const { supabase } = await requireAdmin(`/admin/episodes/${id}`);

  const { data: episode } = await supabase
    .from("episodes")
    .select("*, series(id,title,slug), panels(*)")
    .eq("id", id)
    .maybeSingle();
  if (!episode) notFound();

  const series = episode.series as { id: string; title: string; slug: string };
  const panels = ((episode.panels ?? []) as Panel[]).sort((a, b) => a.position - b.position);
  const ok = published
    ? "Published! It's live now."
    : created
      ? "Episode created as a draft. Add the panels below, then publish."
      : saved
        ? "Saved."
        : null;

  return (
    <>
      <p className="text-sm font-bold text-muted">
        <Link href={`/admin/series/${series.id}`} className="inline-flex min-h-11 items-center underline">
          ← {series.title}
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold">Episode {episode.number}</h1>
      <p className="mb-4 font-semibold">
        {episode.status === "published" ? "● Published" : "○ Draft"}
      </p>
      <Banner error={error} ok={ok} />

      <EpisodeForm
        key={`${episode.status}-${episode.access}-${episode.early_until ?? ""}`}
        seriesId={series.id}
        nextNumber={episode.number}
        episode={episode}
        panelCount={panels.length}
      />

      <PanelManager
        episodeId={episode.id}
        initialPanels={panels}
        previewHref={`/series/${series.slug}/episodes/${episode.number}`}
      />

      <form action={deleteEpisode} className="mt-10 rounded-2xl border-2 border-line p-4">
        <input type="hidden" name="id" value={episode.id} />
        <input type="hidden" name="series_id" value={series.id} />
        <p className="font-bold">Delete this episode</p>
        <p className="text-sm text-muted">
          Removes the episode and its panels. Type <strong>delete</strong> to confirm.
        </p>
        <input
          name="confirm"
          aria-label="Type delete to confirm"
          autoCapitalize="none"
          autoComplete="off"
          className={`${fieldClass} mt-2`}
        />
        <button type="submit" className="btn btn-quiet mt-3 w-full">
          Delete episode
        </button>
      </form>
    </>
  );
}
