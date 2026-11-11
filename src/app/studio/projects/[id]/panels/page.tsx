import Link from "next/link";
import { notFound } from "next/navigation";
import { importMasters } from "../panels-actions";
import { LetterSection, PanelGrid, PanelsGate, PromptSection, QaSection, TakesSection } from "./parts";
import { JobPoller } from "@/components/studio/JobPoller";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { imagePrice } from "@/lib/studio/ai/aiCall";
import { signedUrls } from "@/lib/studio/assets/storage";
import { requireStudio } from "@/lib/studio/auth";
import { activeLessons } from "@/lib/studio/lessons/lessons";
import { estimatePrecheck, estimateVision } from "@/lib/studio/panels/ai";
import { panelState, panelsFingerprint, type PanelState } from "@/lib/studio/panels/gate";
import { buildFor, loadPanelContext } from "@/lib/studio/panels/panels";
import { lintPanelPrompt, scriptHash } from "@/lib/studio/panels/prompt";
import { morningBrewMastersAvailable } from "@/lib/studio/seed/morningBrew";
import { formatUsd } from "@/lib/studio/settings";
import { loadStructure } from "@/lib/studio/structure/structure";

export const metadata = { title: "Panels" };
// Lettering a 1600px master and starting image tasks with references can take a few seconds.
export const maxDuration = 60;

export default async function PanelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ep?: string; panel?: string; error?: string; ok?: string; warn?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/panels`);
  const episodes = await loadStructure(supabase, id);
  const { data: project } = await supabase.from("studio_projects").select("id,is_test").eq("id", id).maybeSingle();
  if (!project) notFound();
  const { data: storyGate } = await supabase.from("studio_gates").select("state").eq("project_id", id).eq("gate", "story_approved").is("episode_id", null).maybeSingle();

  const shell = (children: React.ReactNode, side?: React.ReactNode) => (
    <ProjectShell projectId={id} current="panels" storyGate={(storyGate?.state as "open" | "approved" | "stale" | undefined) ?? null} side={side}>
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 6</p>
      <h1 className="s-head text-3xl">Panels</h1>
      {children}
    </ProjectShell>
  );
  if (!episodes.length) {
    return shell(
      <div className="s-card mt-4 p-6 text-center">
        <p className="s-head text-lg">No episodes yet</p>
        <Link href={`/studio/projects/${id}/structure`} className="s-btn s-btn-primary mt-3">Go to the structure board</Link>
      </div>,
    );
  }
  const episode = episodes.find((e) => e.id === sp.ep) ?? episodes[0];
  const ids = { projectId: id, episodeId: episode.id };
  const tabs = (
    <nav aria-label="Episodes" className="mt-3 flex flex-wrap gap-2">
      {episodes.map((e) => (
        <Link
          key={e.id}
          href={`/studio/projects/${id}/panels?ep=${e.id}`}
          aria-current={e.id === episode.id ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${e.id === episode.id ? "bg-[var(--s-ink)] text-white" : "border-2 border-[var(--s-line)] bg-white"}`}
        >
          Episode {e.number}
        </Link>
      ))}
    </nav>
  );

  const pc = await loadPanelContext(supabase, id, episode.id);
  if (pc.scriptGate?.state !== "approved" || pc.assetsGate?.state !== "approved") {
    const needScript = pc.scriptGate?.state !== "approved";
    return shell(
      <>
        {tabs}
        <div className="mt-4"><Notice error={sp.error} ok={sp.ok} /></div>
        <div className="s-card mt-4 p-6 text-center">
          <p className="s-head text-lg">Locked until {needScript ? "Script final" : "Asset designs approved"}</p>
          <p className="s-muted mx-auto mt-1 max-w-md">No panel art is made before the script is final and the asset designs are approved. Gates go in order.</p>
          <Link href={`/studio/projects/${id}/${needScript ? "script" : "assets"}?ep=${episode.id}#gate`} className="s-btn s-btn-primary mt-3">
            Go to {needScript ? "the script" : "the assets"}
          </Link>
        </div>
      </>,
      <p className="s-muted">Nothing to do here yet.</p>,
    );
  }

  const settings = pc.settings!;
  const states: Record<string, PanelState> = {};
  const counts: Record<string, { takes: number; findings: number }> = {};
  for (const p of pc.panels) {
    states[p.panel_key] = panelState(pc, p.panel_key);
    const row = pc.rows.get(p.panel_key);
    counts[p.panel_key] = {
      takes: pc.takes.filter((x) => x.panel_key === p.panel_key && x.status !== "failed").length,
      findings: row?.qa && row.qa_lettered_path === row.lettered_path ? row.qa.findings.length : 0,
    };
  }
  const thumbPaths: Record<string, string | null> = {};
  for (const p of pc.panels) {
    const row = pc.rows.get(p.panel_key);
    const chosen = row?.chosen_take_id ? pc.takes.find((x) => x.id === row.chosen_take_id) : null;
    thumbPaths[p.panel_key] = row?.lettered_path ?? chosen?.storage_path ?? null;
  }

  const selIndex = pc.panels.findIndex((p) => p.panel_key === sp.panel);
  const sel = selIndex === -1 ? null : pc.panels[selIndex];
  const selRow = sel ? pc.rows.get(sel.panel_key) ?? null : null;
  const selTakes = sel ? pc.takes.filter((x) => x.panel_key === sel.panel_key) : [];
  const built = sel ? await buildFor(supabase, pc, sel.panel_key) : null;
  const lint = built && pc.story ? lintPanelPrompt(built.built, built.panel, pc.story.characters) : { errors: [], warnings: [] };
  const urls = await signedUrls(supabase, [
    ...Object.values(thumbPaths),
    ...selTakes.map((x) => x.storage_path),
    ...(built?.built.refs.map((r) => r.path) ?? []),
    selRow?.lettered_path,
    selRow?.compare_path,
  ]);
  const thumbs = Object.fromEntries(Object.entries(thumbPaths).map(([k, p]) => [k, p ? urls[p] : undefined]));
  const pendingJobs = pc.takes.filter((x) => x.status === "pending" && x.job_id).map((x) => x.job_id as string);

  const { fp, problems } = panelsFingerprint(pc);
  const { data: gate } = await supabase.from("studio_gates").select("state,approved_at,note,fingerprint").eq("project_id", id).eq("episode_id", episode.id).eq("gate", "panels_approved").maybeSingle();
  const imported = pc.panels.filter((p) => pc.takes.find((x) => x.id === pc.rows.get(p.panel_key)?.chosen_take_id)?.kind === "imported").length;

  const { data: spendRows } = await supabase.from("studio_ai_calls").select("actual_usd,estimated_usd").eq("episode_id", episode.id).eq("kind", "image").in("status", ["done", "reserved"]);
  const spent = (spendRows ?? []).reduce((n, r) => n + Number(r.actual_usd ?? r.estimated_usd ?? 0), 0);
  const lessonsForQa = sel ? await activeLessons(supabase, "art", id, sel.characters) : [];
  const canImport = project.is_test && morningBrewMastersAvailable() && pc.panels.some((p) => !pc.takes.some((x) => x.panel_key === p.panel_key && x.kind === "imported" && !x.rejected));

  return shell(
    <>
      {tabs}
      <div className="mt-4"><Notice error={sp.error} ok={sp.ok} warn={sp.warn} /></div>
      <JobPoller key={pendingJobs.join(",") || "none"} jobIds={pendingJobs} />
      <div className="s-card mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm">
          Episode {episode.number}: {pc.panels.length} panels · images {formatUsd(spent)} of {formatUsd(settings.episode_image_cap_usd)} · up to {settings.max_takes_per_panel} takes a panel
        </p>
        {canImport && (
          <form>
            <input type="hidden" name="project_id" value={id} />
            <input type="hidden" name="episode_id" value={episode.id} />
            <SubmitButton formAction={importMasters} variant="quiet" pendingText="Importing…">Import Morning Brew masters (test)</SubmitButton>
          </form>
        )}
      </div>

      <PanelGrid ids={ids} panels={pc.panels} states={states} thumbs={thumbs} selected={sel?.panel_key} counts={counts} />

      {sel && selRow && built && (
        <section id="panel" aria-labelledby="panel-title" className="s-card mt-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="panel-title" className="s-head text-2xl">Panel {selIndex + 1}: {sel.title}</h2>
            <div className="flex gap-2">
              {selIndex > 0 && <Link href={`/studio/projects/${id}/panels?ep=${episode.id}&panel=${pc.panels[selIndex - 1].panel_key}#panel`} className="s-btn s-btn-quiet">← {selIndex}</Link>}
              {selIndex < pc.panels.length - 1 && <Link href={`/studio/projects/${id}/panels?ep=${episode.id}&panel=${pc.panels[selIndex + 1].panel_key}#panel`} className="s-btn s-btn-quiet">{selIndex + 2} →</Link>}
              <Link href={`/studio/projects/${id}/panels?ep=${episode.id}`} className="s-link inline-flex min-h-11 items-center text-sm">Close</Link>
            </div>
          </div>
          <PromptSection
            ids={ids}
            panelKey={sel.panel_key}
            number={selIndex + 1}
            panel={sel}
            row={selRow}
            blocks={built.built.blocks}
            refs={built.built.refs}
            refUrls={urls}
            lessons={built.built.lessons}
            lint={lint}
            precheckCurrent={selRow.precheck_hash === built.built.hash}
            precheckEstimate={estimatePrecheck(settings, built.built, sel, selIndex + 1)}
            takesUsed={selTakes.filter((x) => x.kind === "final" && (x.status === "ready" || x.status === "pending")).length}
            maxTakes={settings.max_takes_per_panel}
            price={imagePrice(settings, "2K")}
            pending={selTakes.some((x) => x.status === "pending")}
            dryRun={settings.dry_run}
          />
          <TakesSection ids={ids} panelKey={sel.panel_key} takes={selTakes} urls={urls} chosenId={selRow.chosen_take_id} currentScriptHash={scriptHash(sel)} />
          <LetterSection
            ids={ids}
            panelKey={sel.panel_key}
            layout={selRow.letter_layout ?? []}
            state={states[sel.panel_key]}
            letteredUrl={selRow.lettered_path ? urls[selRow.lettered_path] : undefined}
            compareUrl={selRow.compare_path ? urls[selRow.compare_path] : undefined}
            canLetter={states[sel.panel_key].chosen}
          />
          <QaSection
            ids={ids}
            panelKey={sel.panel_key}
            row={selRow}
            estimate={pc.story ? estimateVision(settings, sel, selIndex + 1, pc.story.characters, lessonsForQa) : null}
            canRun={Boolean(selRow.lettered_path)}
          />
        </section>
      )}

      <PanelsGate ids={ids} gate={gate} changed={gate?.state === "approved" && gate.fingerprint !== fp} problems={problems} imported={imported} />
    </>,
    <>
      <p>Each prompt is built from fixed blocks: style, expression, action, character locks (only for characters in the panel), setting, props, clock, &ldquo;must not appear&rdquo; and the active lessons.</p>
      <p>A free check runs first, then Claude&rsquo;s pre-check (under 1¢), and only then can you spend on an image. One click makes one take for one panel.</p>
      <p>Lettering is drawn in code and is free. Claude&rsquo;s QA looks at the lettered panel and lists problems; it never fixes anything.</p>
      {settings.dry_run && <p className="font-bold">Dry-run is on: no images are made and Claude replies are placeholders.</p>}
    </>,
  );
}
