import Link from "next/link";
import { notFound } from "next/navigation";
import { draftScript, runScriptCheck } from "../script-actions";
import { ChecksSection, DiffView, EndCardEditor, GateSection, PanelEditor, PanelList, PropTable, VersionBar } from "./parts";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell, costLabel } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { getStudioSettings } from "@/lib/studio/settings";
import { freeChecks } from "@/lib/studio/script/checks";
import { diffScripts } from "@/lib/studio/script/diff";
import { estimateScriptAction } from "@/lib/studio/script/prompts";
import { ensureCurrent, listVersions, loadFork, loadPanels, loadProps, loadScriptGate } from "@/lib/studio/script/script";
import { loadStructure } from "@/lib/studio/structure/structure";
import { loadStory } from "@/lib/studio/story/story";

export const metadata = { title: "Script" };

export default async function ScriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ep?: string; panel?: string; compare?: string; error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/script`);
  const [s, settings, episodes] = await Promise.all([loadStory(supabase, id), getStudioSettings(supabase), loadStructure(supabase, id)]);
  if (!s) notFound();
  const serial = s.project.format === "serial";

  if (episodes.length === 0) {
    return (
      <ProjectShell projectId={id} current="script" storyGate={s.gate?.state ?? null}>
        <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 4</p>
        <h1 className="s-head text-3xl">Script</h1>
        <div className="s-card mt-4 p-6 text-center">
          <p className="s-head text-lg">No episodes yet</p>
          <p className="s-muted mt-1">Create episodes on the structure board first; each episode gets its own script.</p>
          <Link href={`/studio/projects/${id}/structure`} className="s-btn s-btn-primary mt-3">Go to the structure board</Link>
        </div>
      </ProjectShell>
    );
  }

  const episode = episodes.find((e) => e.id === sp.ep) ?? episodes[0];
  const ids = { projectId: id, episodeId: episode.id };
  const ensured = await ensureCurrent(supabase, id, episode.id);
  const listed = await listVersions(supabase, episode.id);
  const versions = listed.length ? listed : [ensured];
  const current = versions[0];
  const [panels, fork, props, gate] = await Promise.all([
    loadPanels(supabase, current.id),
    loadFork(supabase, episode.id),
    loadProps(supabase, id),
    loadScriptGate(supabase, id, episode.id),
  ]);
  const issues = freeChecks(panels, { props, characters: s.characters.map((c) => c.name), fork, serial });
  const compareTo = versions.find((v) => v.id === sp.compare && v.id !== current.id);
  const diffs = compareTo ? diffScripts(await loadPanels(supabase, compareTo.id), panels) : null;
  const selIndex = panels.findIndex((p) => p.panel_key === sp.panel);
  const fails = current.check_result?.items.filter((x) => x.status === "fail").length ?? 0;
  const cur = { panels, fork, props };
  const est = {
    draft: estimateScriptAction(settings, s, episode, { kind: "draft" }, cur),
    check: estimateScriptAction(settings, s, episode, { kind: "check" }, cur),
  };

  return (
    <ProjectShell
      projectId={id}
      current="script"
      storyGate={s.gate?.state ?? null}
      side={
        <>
          {panels.length === 0 && (
            <form>
              <input type="hidden" name="project_id" value={id} />
              <input type="hidden" name="episode_id" value={episode.id} />
              <p>Claude can draft this episode&rsquo;s script from the story and the structure board.</p>
              <SubmitButton formAction={draftScript} variant="info" pendingText="Drafting…" className="mt-2 w-full">
                Draft episode {episode.number} · {costLabel(est.draft)}
              </SubmitButton>
            </form>
          )}
          {panels.length > 0 && (
            <form>
              <input type="hidden" name="project_id" value={id} />
              <input type="hidden" name="episode_id" value={episode.id} />
              <p>Claude runs the full guidelines checklist on v{current.version}, with a panel number for every problem. It never changes the script.</p>
              <SubmitButton formAction={runScriptCheck} variant="info" pendingText="Checking…" className="mt-2 w-full">
                {current.check_result ? "Run the check again" : "Run the script check"} · {costLabel(est.check)}
              </SubmitButton>
            </form>
          )}
          <p className="s-muted">
            Gate: <strong>{gate?.state === "approved" ? "Script final" : gate?.state === "stale" ? "Changed since approval" : "Open"}</strong>
          </p>
          <p className="s-muted">These calls count towards episode {episode.number}&rsquo;s Claude budget.</p>
          {settings?.dry_run && <p className="font-bold">Dry-run is on: Claude replies are placeholders and cost nothing.</p>}
        </>
      }
    >
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 4</p>
      <h1 className="s-head text-3xl">Script</h1>

      <nav aria-label="Episodes" className="mt-3 flex flex-wrap gap-2">
        {episodes.map((e) => (
          <Link
            key={e.id}
            href={`/studio/projects/${id}/script?ep=${e.id}`}
            aria-current={e.id === episode.id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${e.id === episode.id ? "bg-[var(--s-ink)] text-white" : "border-2 border-[var(--s-line)] bg-white"}`}
          >
            Episode {e.number}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        <Notice error={sp.error} ok={sp.ok} />
        {s.gate?.state !== "approved" && <Notice warn="The story isn't approved (or changed since). You can write here, but Script final needs an approved story." />}
        {episode.reader_route?.route && (
          <p className="s-card mb-4 p-3 text-sm">
            <strong>Readers chose</strong> (vote after episode {episode.reader_route.from_episode}): {episode.reader_route.route}{" "}
            <span className="font-bold">“{episode.reader_route.you_chose}”</span>
            {episode.reader_route.credit ? ` · credit ${episode.reader_route.credit}` : ""}. Claude&rsquo;s draft and check follow this route.
          </p>
        )}
      </div>

      <VersionBar ids={ids} versions={versions} compareId={compareTo?.id} />
      {diffs && compareTo && <DiffView ids={ids} diffs={diffs} from={compareTo.version} to={current.version} />}
      {selIndex !== -1 && <PanelEditor ids={ids} panel={panels[selIndex]} index={selIndex} panels={panels} characters={s.characters.map((c) => c.name)} />}
      <PanelList ids={ids} panels={panels} selected={sp.panel} issues={issues} />
      {serial && <EndCardEditor ids={ids} fork={fork} />}
      <ChecksSection issues={issues} check={current.check_result} stale={!current.check_result && panels.length > 0} />
      <PropTable ids={ids} props={props} />
      <GateSection
        ids={ids}
        gate={gate}
        storyApproved={s.gate?.state === "approved"}
        currentVersion={current.version}
        checked={Boolean(current.check_result)}
        openProblems={issues.length + fails}
      />
    </ProjectShell>
  );
}
