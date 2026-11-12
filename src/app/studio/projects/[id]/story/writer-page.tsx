import type { SupabaseClient } from "@supabase/supabase-js";
import { ChangesPanel, DraftView, LockCard, ModeSwitch, PortfolioCard, QuestionsCard, RereadCard, TellStep, TellingEditor } from "./writer";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell } from "@/components/studio/ProjectShell";
import { estimateDraft } from "@/lib/studio/draft/prompts";
import type { Quickstart } from "@/lib/studio/draft/types";
import type { StudioSettings } from "@/lib/studio/settings";
import { storyGaps, type Story } from "@/lib/studio/story/story";

// The Story page for projects on the story writer (story_mode = "draft").

export async function WriterPage({
  s,
  settings,
  supabase,
  sp,
}: {
  s: Story;
  settings: StudioSettings | null;
  supabase: SupabaseClient;
  sp: { error?: string; ok?: string; pending?: string };
}) {
  const id = s.project.id;
  const d = s.draft;
  const hasDraft = !!d && d.draft.beats.length > 0;

  const { data: versionRows } = await supabase
    .from("studio_story_drafts")
    .select("version,change_request,created_at,draft")
    .eq("project_id", id)
    .order("version", { ascending: false })
    .limit(30);
  const versions = (versionRows ?? []).map((v) => ({ version: v.version as number, change_request: v.change_request as string | null, created_at: v.created_at as string }));
  const prevRow = (versionRows ?? []).find((v) => d && v.version === d.version - 1);
  const prevBeats = prevRow
    ? new Map(((prevRow.draft as { beats?: { id: string; text: string }[] })?.beats ?? []).map((b) => [b.id, b.text]))
    : null;

  // Before the first read, fill the boxes from anything already written on the classic steps.
  const lead = s.characters[0];
  const prefill: Quickstart & { telling: string } = {
    about: d?.quickstart.about || s.project.logline || s.project.idea || "",
    setting: d?.quickstart.setting || "",
    lead: d?.quickstart.lead || s.answers.lead?.answer || (lead ? `${lead.name}${lead.role ? `, ${lead.role}` : ""}` : ""),
    backstory: d?.quickstart.backstory || lead?.sheet.backstory || "",
    telling: d?.telling || "",
  };

  const firstEstimate = estimateDraft(settings, { project: s.project, quickstart: prefill, telling: prefill.telling || "x".repeat(3000), prev: null, change: "" });
  const updateEstimate = hasDraft ? estimateDraft(settings, { project: s.project, quickstart: d.quickstart, telling: d.telling, prev: d, change: "x".repeat(300) }) : null;
  const gaps = storyGaps(s);

  return (
    <ProjectShell
      projectId={id}
      current="story"
      storyGate={s.gate?.state ?? null}
      side={
        hasDraft ? (
          <ChangesPanel s={s} estimate={updateEstimate} versions={versions} pending={sp.pending} dryRun={!!settings?.dry_run} />
        ) : (
          <>
            <p>Tell the episode your way. Claude organises it into a draft, asks only about the gaps that matter, and keeps a portfolio of every detail you mention.</p>
            <p className="s-muted">
              Model: <span className="font-mono text-xs">{settings?.models.story}</span>
            </p>
            {settings?.dry_run && <p className="font-bold">Dry-run is on: Claude&rsquo;s read is a placeholder and costs nothing.</p>}
          </>
        )
      }
    >
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 2{d ? ` · version ${d.version}` : ""}</p>
      <h1 className="s-head text-3xl">Story writer</h1>

      <div className="mt-4">
        <Notice error={sp.error} ok={sp.ok} />
        {s.gate?.state === "stale" && <Notice warn="The story changed after you locked it. Lock it again when you're happy." />}
      </div>

      <div className="mt-2 space-y-4">
        {!d && <TellStep s={s} estimate={firstEstimate} prefill={prefill} />}
        {d && !hasDraft && (
          <>
            <RereadCard s={s} estimate={firstEstimate} />
            <div className="s-card p-5">
              <p className="font-bold">What you told:</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{d.telling}</p>
            </div>
          </>
        )}
        {hasDraft && (
          <>
            <QuestionsCard s={s} />
            <DraftView s={s} prevBeats={prevBeats} />
            <PortfolioCard s={s} />
            <TellingEditor s={s} estimate={updateEstimate} />
            <LockCard s={s} gaps={gaps} />
          </>
        )}
        <div className="pt-2">
          <ModeSwitch id={id} to="classic" />
        </div>
      </div>
    </ProjectShell>
  );
}
