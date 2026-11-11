import Link from "next/link";
import { notFound } from "next/navigation";
import { findAssets, importMorningBrewRefs } from "../assets-actions";
import { AddAsset, AssetEditor, AssetGateSection, AssetList } from "./parts";
import { JobPoller } from "@/components/studio/JobPoller";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { imagePrice } from "@/lib/studio/ai/aiCall";
import { assetFingerprint, loadAssets, loadGate, loadTakes, usedIn } from "@/lib/studio/assets/assets";
import { lintPrompt } from "@/lib/studio/assets/prompts";
import { estimateRevise } from "@/lib/studio/assets/revise";
import { signedUrls } from "@/lib/studio/assets/storage";
import { requireStudio } from "@/lib/studio/auth";
import { morningBrewRefsAvailable } from "@/lib/studio/seed/morningBrew";
import { formatUsd, getStudioSettings } from "@/lib/studio/settings";
import { loadStructure } from "@/lib/studio/structure/structure";
import { loadStory } from "@/lib/studio/story/story";

export const metadata = { title: "Assets" };
// Starting up to 4 image tasks (and uploading a reference) can take a few seconds each.
export const maxDuration = 60;

export default async function AssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ep?: string; asset?: string; error?: string; ok?: string; warn?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/assets`);
  const [s, settings, episodes] = await Promise.all([loadStory(supabase, id), getStudioSettings(supabase), loadStructure(supabase, id)]);
  if (!s) notFound();

  const shell = (children: React.ReactNode, side?: React.ReactNode) => (
    <ProjectShell projectId={id} current="assets" storyGate={s.gate?.state ?? null} side={side}>
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 5</p>
      <h1 className="s-head text-3xl">Assets</h1>
      {children}
    </ProjectShell>
  );

  if (episodes.length === 0) {
    return shell(
      <div className="s-card mt-4 p-6 text-center">
        <p className="s-head text-lg">No episodes yet</p>
        <p className="s-muted mt-1">Assets come from final scripts. Create an episode and its script first.</p>
        <Link href={`/studio/projects/${id}/structure`} className="s-btn s-btn-primary mt-3">Go to the structure board</Link>
      </div>,
    );
  }

  const episode = episodes.find((e) => e.id === sp.ep) ?? episodes[0];
  const ids = { projectId: id, episodeId: episode.id };
  const [scriptGate, assetsGate] = await Promise.all([loadGate(supabase, id, episode.id, "script_final"), loadGate(supabase, id, episode.id, "assets_approved")]);
  const final = scriptGate?.state === "approved";

  const tabs = (
    <nav aria-label="Episodes" className="mt-3 flex flex-wrap gap-2">
      {episodes.map((e) => (
        <Link
          key={e.id}
          href={`/studio/projects/${id}/assets?ep=${e.id}`}
          aria-current={e.id === episode.id ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${e.id === episode.id ? "bg-[var(--s-ink)] text-white" : "border-2 border-[var(--s-line)] bg-white"}`}
        >
          Episode {e.number}
        </Link>
      ))}
    </nav>
  );

  if (!final) {
    return shell(
      <>
        {tabs}
        <div className="mt-4">
          <Notice error={sp.error} ok={sp.ok} />
        </div>
        <div className="s-card mt-4 p-6 text-center">
          <p className="s-head text-lg">Locked until Script final</p>
          <p className="s-muted mx-auto mt-1 max-w-md">
            Episode {episode.number}&rsquo;s script {scriptGate?.state === "stale" ? "changed after it was approved" : "isn't approved yet"}. Assets are found in the final
            script, and no images are made before it&rsquo;s signed off.
          </p>
          <Link href={`/studio/projects/${id}/script?ep=${episode.id}#gate`} className="s-btn s-btn-primary mt-3">Go to the script</Link>
        </div>
      </>,
      <p className="s-muted">Nothing to do here until the script is final.</p>,
    );
  }

  const assets = await loadAssets(supabase, id);
  const mine = assets.filter((a) => usedIn(a, episode.id));
  const takes = await loadTakes(supabase, mine.map((a) => a.id));
  const selected = mine.find((a) => a.id === sp.asset) ?? null;
  const selTakes = selected ? takes.filter((t) => t.asset_id === selected.id) : [];
  const pickedPath: Record<string, string | null> = {};
  for (const a of mine) pickedPath[a.id] = a.picked_take_id ? takes.find((t) => t.id === a.picked_take_id)?.storage_path ?? null : null;
  const urls = await signedUrls(supabase, [...Object.values(pickedPath), ...selTakes.map((t) => t.storage_path), selected?.reference_path]);
  const pendingJobs = takes.filter((t) => t.status === "pending" && t.job_id).map((t) => t.job_id as string);

  const fp = assetFingerprint(mine, takes);
  const changed = assetsGate?.state === "approved" && assetsGate.fingerprint !== fp;
  const undecided = mine.filter((a) => !(a.status === "not_needed" || (a.status === "picked" && a.picked_take_id))).map((a) => a.name);

  const { data: spendRows } = await supabase
    .from("studio_ai_calls")
    .select("actual_usd,estimated_usd,status")
    .eq("episode_id", episode.id)
    .eq("kind", "image")
    .in("status", ["done", "reserved"]);
  const spent = (spendRows ?? []).reduce((n, r) => n + Number(r.actual_usd ?? r.estimated_usd ?? 0), 0);
  const { data: epRow } = await supabase.from("studio_episodes").select("image_cap_usd,image_cap_gens").eq("id", episode.id).maybeSingle();
  const capUsd = Number(epRow?.image_cap_usd ?? settings?.episode_image_cap_usd ?? 0);
  const capGens = Number(epRow?.image_cap_gens ?? settings?.episode_image_cap_gens ?? 0);

  let revision = null;
  if (selected) {
    const { data: sug } = await supabase
      .from("studio_suggestions")
      .select("id,text,why,payload")
      .eq("project_id", id)
      .eq("kind", "asset_prompt")
      .eq("status", "pending")
      .contains("payload", { asset_id: selected.id })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sug) {
      const p = sug.payload as { from_prompt?: string; comment?: string };
      revision = { id: sug.id, text: sug.text, why: sug.why, from: p.from_prompt ?? "", comment: p.comment ?? "" };
    }
  }

  const acts = episodes.flatMap((e) => e.acts.map((a) => ({ id: a.id, label: `Episode ${e.number}: ${a.title || `Act ${a.position}`}` })));
  const canImportRefs = s.project.is_test && morningBrewRefsAvailable();

  return shell(
    <>
      {tabs}
      <div className="mt-4">
        <Notice error={sp.error} ok={sp.ok} warn={sp.warn} />
      </div>
      <JobPoller jobIds={pendingJobs} />

      <div className="s-card mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm">
          Episode {episode.number} images: <strong>{formatUsd(spent)}</strong> of {formatUsd(capUsd)} · {(spendRows ?? []).length} of {capGens} generations
        </p>
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="episode_id" value={episode.id} />
          <SubmitButton formAction={findAssets} variant="quiet" pendingText="Reading scripts…">Find assets in the final scripts (free)</SubmitButton>
          {canImportRefs && (
            <SubmitButton formAction={importMorningBrewRefs} variant="quiet" pendingText="Importing…">Import Morning Brew reference sheets (test)</SubmitButton>
          )}
        </form>
      </div>

      {mine.length === 0 ? (
        <div className="s-card mt-4 p-6 text-center">
          <p className="s-head text-lg">No assets yet</p>
          <p className="s-muted mt-1">Press &ldquo;Find assets in the final scripts&rdquo;, or add one by hand below.</p>
        </div>
      ) : (
        <AssetList ids={ids} assets={mine} selected={selected?.id} urls={urls} pickedPath={pickedPath} />
      )}

      {selected && settings && (
        <AssetEditor
          ids={ids}
          asset={selected}
          takes={selTakes}
          urls={urls}
          acts={acts}
          lint={lintPrompt(selected.kind, selected.name, selected.prompt, s.characters.map((c) => c.name))}
          estimateEach={imagePrice(settings, "1K")}
          reviseEstimate={estimateRevise(settings, selected, "")}
          revision={revision}
          dryRun={settings.dry_run}
        />
      )}

      <AddAsset ids={ids} />
      <AssetGateSection ids={ids} gate={assetsGate} changed={changed} total={mine.length} undecided={undecided} />
    </>,
    <>
      <p>Assets are found in the final script for free. Images are cheap 1K options you pick from; they&rsquo;re references for drawing panels later, never panel art.</p>
      <p>Claude can turn your comment on an option into a revised prompt. You see old and new side by side and decide.</p>
      <p className="s-muted">Image costs count towards episode {episode.number}&rsquo;s image budget; Claude&rsquo;s towards its Claude budget.</p>
      {settings?.dry_run && <p className="font-bold">Dry-run is on: no images are made and nothing is spent.</p>}
    </>,
  );
}
