import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EpisodeForm } from "@/components/admin/EpisodeForm";
import { Banner } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "New episode" };

export default async function NewEpisode({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase } = await requireAdmin(`/admin/series/${id}/episodes/new`);

  const { data: series } = await supabase.from("series").select("id,title").eq("id", id).maybeSingle();
  if (!series) notFound();
  const { data: last } = await supabase
    .from("episodes")
    .select("number")
    .eq("series_id", id)
    .order("number", { ascending: false })
    .limit(1);

  return (
    <>
      <p className="text-sm font-bold text-muted">
        <Link href={`/admin/series/${id}`} className="underline">
          ← {series.title}
        </Link>
      </p>
      <h1 className="mb-4 text-3xl font-extrabold">New episode</h1>
      <p className="mb-4 text-muted">
        Create it as a draft first, then add the panels and publish.
      </p>
      <Banner error={error} />
      <EpisodeForm seriesId={id} nextNumber={(last?.[0]?.number ?? 0) + 1} />
    </>
  );
}
