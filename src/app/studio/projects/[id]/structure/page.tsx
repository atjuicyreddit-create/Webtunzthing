import Link from "next/link";
import { notFound } from "next/navigation";
import {
  acceptReorder,
  addAct,
  addEpisode,
  addScene,
  deleteAct,
  deleteEpisode,
  deleteScene,
  draftStructure,
  mergeWithNext,
  moveEpisodeDown,
  moveEpisodeUp,
  rejectReorder,
  renameAct,
  saveEpisode,
  saveScene,
  splitScene,
  suggestReorder,
  undoLastMove,
} from "../structure-actions";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell, costLabel } from "@/components/studio/ProjectShell";
import { StructureBoard } from "@/components/studio/StructureBoard";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { getStudioSettings } from "@/lib/studio/settings";
import { estimateStructureAction, type ReorderReply } from "@/lib/studio/structure/prompts";
import { loadStructure } from "@/lib/studio/structure/structure";
import type { Episode, Scene } from "@/lib/studio/structure/types";
import { QUESTIONS } from "@/lib/studio/story/questions";
import { loadStory } from "@/lib/studio/story/story";

export const metadata = { title: "Structure board" };

const input = "s-input mt-1";

export default async function StructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scene?: string; error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/structure`);
  const [s, settings, episodes] = await Promise.all([loadStory(supabase, id), getStudioSettings(supabase), loadStructure(supabase, id)]);
  if (!s) notFound();

  const { data: undoable } = await supabase
    .from("studio_versions")
    .select("reason,created_at")
    .eq("item_type", "structure_order")
    .eq("item_id", id)
    .eq("snapshot->>undone", "false")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: pendingRows } = await supabase
    .from("studio_suggestions")
    .select("id,text,payload")
    .eq("project_id", id)
    .eq("kind", "reorder")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  const pending = pendingRows?.[0] as { id: string; text: string; payload: ReorderReply } | undefined;

  const hasScenes = episodes.some((e) => e.acts.some((a) => a.scenes.length));
  const est = {
    draft: estimateStructureAction(settings, s, episodes, { kind: "draft" }),
    reorder: estimateStructureAction(settings, s, episodes, { kind: "reorder" }),
  };
  const allScenes = episodes.flatMap((e) => e.acts.flatMap((a) => a.scenes));
  const selected = allScenes.find((x) => x.id === sp.scene);
  const purposeOptions = [...QUESTIONS.map((q) => q.key.replace("_", " ")).map((x) => x[0].toUpperCase() + x.slice(1)), ...s.milestones.map((m, i) => `Milestone ${i + 1}: ${m.title}`), "Setup", "Gag", "Reaction", "Payoff", "Vote"];
  const storyState = s.gate?.state ?? "open";

  const actForms: Record<string, React.ReactNode> = {};
  const episodeHeaders: Record<string, React.ReactNode> = {};
  episodes.forEach((e, ei) => {
    episodeHeaders[e.id] = <EpisodeHeader key={e.id} projectId={id} e={e} first={ei === 0} last={ei === episodes.length - 1} milestones={s.milestones} />;
    for (const a of e.acts) actForms[a.id] = <ActControls projectId={id} actId={a.id} title={a.title} empty={a.scenes.length === 0} />;
  });

  return (
    <ProjectShell
      projectId={id}
      current="structure"
      storyGate={s.gate?.state ?? null}
      side={
        <>
          {!hasScenes && (
            <form>
              <input type="hidden" name="project_id" value={id} />
              <p>Claude can draft episodes, acts and scenes from your story.</p>
              <SubmitButton formAction={draftStructure} variant="info" pendingText="Drafting…" className="mt-2 w-full">
                Draft the structure · {costLabel(est.draft)}
              </SubmitButton>
            </form>
          )}
          {hasScenes && !pending && (
            <form>
              <input type="hidden" name="project_id" value={id} />
              <p>Claude can suggest a better order. You&rsquo;ll see the changes before anything moves.</p>
              <SubmitButton formAction={suggestReorder} variant="info" pendingText="Thinking…" className="mt-2 w-full">
                Suggest a reorder · {costLabel(est.reorder)}
              </SubmitButton>
            </form>
          )}
          {pending && <ReorderDiff projectId={id} episodes={episodes} pending={pending} />}
          <form className="border-t border-[var(--s-line)] pt-3">
            <input type="hidden" name="project_id" value={id} />
            <SubmitButton formAction={undoLastMove} variant="quiet" pendingText="Undoing…" disabled={!undoable} className="w-full">
              Undo last move
            </SubmitButton>
            <p className="s-muted mt-1 text-xs">{undoable ? `Last: ${undoable.reason}` : "Nothing to undo yet."}</p>
          </form>
          {settings?.dry_run && <p className="font-bold">Dry-run is on: Claude replies are placeholders and cost nothing.</p>}
        </>
      }
    >
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 3</p>
      <h1 className="s-head text-3xl">Structure board</h1>
      <p className="s-muted mt-1">Season → episodes → acts → scenes. Drag scenes to reorder; warnings update as you go.</p>
      <div className="mt-4">
        <Notice error={sp.error} ok={sp.ok} />
        {storyState !== "approved" && (
          <Notice
            warn={
              storyState === "stale"
                ? "The story changed after you approved it. Re-approve it so this structure is built on the final story."
                : "The story isn't approved yet. You can plan here, but approve the story first for a solid base."
            }
          />
        )}
      </div>

      {episodes.length === 0 ? (
        <div className="s-card p-6 text-center">
          <p className="s-head text-lg">No episodes yet</p>
          <p className="s-muted mt-1">Let Claude draft the structure (right), or start by hand.</p>
          <form className="mt-3">
            <input type="hidden" name="project_id" value={id} />
            <SubmitButton formAction={addEpisode} pendingText="Adding…">Add episode 1</SubmitButton>
          </form>
        </div>
      ) : (
        <>
          {selected && <SceneEditor projectId={id} scene={selected} purposeOptions={purposeOptions} characters={s.characters.map((c) => c.name)} />}
          <StructureBoard projectId={id} episodes={episodes} selectedId={selected?.id} actForms={actForms} episodeHeaders={episodeHeaders} />
          <form className="mt-6">
            <input type="hidden" name="project_id" value={id} />
            <SubmitButton formAction={addEpisode} variant="quiet" pendingText="Adding…">＋ Add episode</SubmitButton>
          </form>
        </>
      )}
    </ProjectShell>
  );
}

function EpisodeHeader({
  projectId,
  e,
  first,
  last,
  milestones,
}: {
  projectId: string;
  e: Episode;
  first: boolean;
  last: boolean;
  milestones: { id: string; title: string }[];
}) {
  return (
    <div className="s-card mb-3 p-4">
      <details>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2">
          <span>
            <span className="s-head text-lg">Episode {e.number}: {e.title}</span>
            {e.milestone_id && (
              <span className="s-muted block text-xs">Milestone: {milestones.find((m) => m.id === e.milestone_id)?.title}</span>
            )}
          </span>
          <span className="s-link text-sm">Edit</span>
        </summary>
        <form action={saveEpisode} className="mt-3 space-y-3" key={`${e.title}|${e.summary}|${e.milestone_id}`}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="episode_id" value={e.id} />
          <div>
            <label htmlFor={`t-${e.id}`} className="block font-bold">Title</label>
            <input id={`t-${e.id}`} name="title" defaultValue={e.title} maxLength={120} className={input} />
          </div>
          <div>
            <label htmlFor={`s-${e.id}`} className="block font-bold">Summary</label>
            <textarea id={`s-${e.id}`} name="summary" rows={2} defaultValue={e.summary ?? ""} maxLength={1000} className={input} />
          </div>
          {milestones.length > 0 && (
            <div>
              <label htmlFor={`m-${e.id}`} className="block font-bold">Milestone it reaches</label>
              <select id={`m-${e.id}`} name="milestone_id" defaultValue={e.milestone_id ?? ""} className={input}>
                <option value="">None</option>
                {milestones.map((m, i) => (
                  <option key={m.id} value={m.id}>{i + 1}. {m.title}</option>
                ))}
              </select>
            </div>
          )}
          <SubmitButton pendingText="Saving…">Save episode</SubmitButton>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--s-line)] pt-3">
          <form className="flex gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="episode_id" value={e.id} />
            <SubmitButton formAction={moveEpisodeUp} variant="quiet" pendingText="…" disabled={first}>↑ Move up</SubmitButton>
            <SubmitButton formAction={moveEpisodeDown} variant="quiet" pendingText="…" disabled={last}>↓ Move down</SubmitButton>
            <SubmitButton formAction={addAct} variant="quiet" pendingText="…">＋ Add act</SubmitButton>
          </form>
          <form action={deleteEpisode} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="episode_id" value={e.id} />
            <label htmlFor={`d-${e.id}`} className="sr-only">Type delete to confirm deleting episode {e.number}</label>
            <input id={`d-${e.id}`} name="confirm" placeholder="type delete" autoComplete="off" autoCapitalize="none" className="s-input w-32" />
            <SubmitButton variant="quiet" pendingText="…">Delete episode</SubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

function ActControls({ projectId, actId, title, empty }: { projectId: string; actId: string; title: string; empty: boolean }) {
  return (
    <div className="space-y-2">
      <form>
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="act_id" value={actId} />
        <SubmitButton formAction={addScene} variant="quiet" pendingText="Adding…" className="w-full">＋ Add scene</SubmitButton>
      </form>
      <details>
        <summary className="s-muted min-h-11 cursor-pointer py-2 text-xs font-bold">Act options</summary>
        <form action={renameAct} className="flex gap-2" key={title}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="act_id" value={actId} />
          <label htmlFor={`a-${actId}`} className="sr-only">Act title</label>
          <input id={`a-${actId}`} name="title" defaultValue={title} maxLength={120} className="s-input" />
          <SubmitButton variant="quiet" pendingText="…">Rename</SubmitButton>
        </form>
        {empty && (
          <form action={deleteAct} className="mt-2">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="act_id" value={actId} />
            <SubmitButton variant="quiet" pendingText="…">Delete empty act</SubmitButton>
          </form>
        )}
      </details>
    </div>
  );
}

function SceneEditor({
  projectId,
  scene,
  purposeOptions,
  characters,
}: {
  projectId: string;
  scene: Scene;
  purposeOptions: string[];
  characters: string[];
}) {
  const csv = (a: string[]) => a.join(", ");
  return (
    <section aria-labelledby="scene-edit" className="s-card mb-4 border-[var(--s-ink)] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="scene-edit" className="s-head text-xl">Scene: {scene.title || "Untitled"}</h2>
        <Link href={`/studio/projects/${projectId}/structure`} className="s-link inline-flex min-h-11 items-center text-sm">Close</Link>
      </div>
      <form action={saveScene} className="mt-3 space-y-3" key={JSON.stringify(scene)}>
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="scene_id" value={scene.id} />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="sc-title" className="block font-bold">Title</label>
            <input id="sc-title" name="title" defaultValue={scene.title} maxLength={120} className={input} />
          </div>
          <div>
            <label htmlFor="sc-purpose" className="block font-bold">Purpose</label>
            <input id="sc-purpose" name="purpose" list="purposes" defaultValue={scene.purpose ?? ""} maxLength={120} className={input} placeholder="Which spine point or milestone?" />
            <datalist id="purposes">{purposeOptions.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
        </div>
        <div>
          <label htmlFor="sc-beat" className="block font-bold">Beat</label>
          <textarea id="sc-beat" name="beat" rows={2} defaultValue={scene.beat ?? ""} maxLength={600} className={input} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="sc-chars" className="block font-bold">Characters</label>
            <input id="sc-chars" name="characters" defaultValue={csv(scene.characters)} className={input} placeholder={characters.join(", ") || "Comma-separated"} />
          </div>
          <div>
            <label htmlFor="sc-loc" className="block font-bold">Location</label>
            <input id="sc-loc" name="location" defaultValue={scene.location ?? ""} maxLength={120} className={input} />
          </div>
          <div>
            <label htmlFor="sc-pi" className="block font-bold">Props introduced here</label>
            <input id="sc-pi" name="props_introduced" defaultValue={csv(scene.props_introduced)} className={input} placeholder="Comma-separated" />
          </div>
          <div>
            <label htmlFor="sc-pu" className="block font-bold">Props used here</label>
            <input id="sc-pu" name="props_used" defaultValue={csv(scene.props_used)} className={input} placeholder="Must be introduced earlier or here" />
          </div>
          <div>
            <label htmlFor="sc-pl" className="block font-bold">Plants (set-ups)</label>
            <input id="sc-pl" name="plants" defaultValue={csv(scene.plants)} className={input} />
          </div>
          <div>
            <label htmlFor="sc-po" className="block font-bold">Payoffs</label>
            <input id="sc-po" name="payoffs" defaultValue={csv(scene.payoffs)} className={input} placeholder="Same words as the plant" />
          </div>
          <div>
            <label htmlFor="sc-chain" className="block font-bold">Real-world sequence</label>
            <input id="sc-chain" name="chain" defaultValue={scene.chain ?? ""} maxLength={60} className={input} placeholder="e.g. coffee" />
          </div>
          <div>
            <label htmlFor="sc-step" className="block font-bold">Step number in it</label>
            <input id="sc-step" name="chain_step" type="number" min={1} inputMode="numeric" defaultValue={scene.chain_step ?? ""} className={input} placeholder="e.g. beans 1, grind 2" />
          </div>
        </div>
        <div>
          <label htmlFor="sc-vote" className="block font-bold">Reader choice (vote question)</label>
          <input id="sc-vote" name="reader_choice" defaultValue={scene.reader_choice ?? ""} maxLength={300} className={input} placeholder="Only on a serial episode's last scene" />
        </div>
        <SubmitButton pendingText="Saving…">Save scene</SubmitButton>
      </form>
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--s-line)] pt-4">
        <form className="flex flex-wrap gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="scene_id" value={scene.id} />
          <SubmitButton formAction={splitScene} variant="quiet" pendingText="…">Split in two</SubmitButton>
          <SubmitButton formAction={mergeWithNext} variant="quiet" pendingText="…">Merge with next</SubmitButton>
        </form>
        <form action={deleteScene} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="scene_id" value={scene.id} />
          <label htmlFor="sc-del" className="sr-only">Type delete to confirm</label>
          <input id="sc-del" name="confirm" placeholder="type delete" autoComplete="off" autoCapitalize="none" className="s-input w-32" />
          <SubmitButton variant="quiet" pendingText="…">Delete scene</SubmitButton>
        </form>
      </div>
    </section>
  );
}

function ReorderDiff({ projectId, episodes, pending }: { projectId: string; episodes: Episode[]; pending: { id: string; text: string; payload: ReorderReply } }) {
  const title = new Map(episodes.flatMap((e) => e.acts.flatMap((a) => a.scenes.map((s) => [s.id, s.title || "Untitled"] as const))));
  const where = new Map<string, string>();
  for (const e of episodes) for (const a of e.acts) a.scenes.forEach((s, i) => where.set(s.id, `${a.id}:${i}`));
  const actTitle = new Map(episodes.flatMap((e) => e.acts.map((a) => [a.id, a.title || "Untitled act"] as const)));
  const why = new Map((pending.payload.reasons ?? []).map((r) => [r.scene_id, r.why]));
  return (
    <div className="space-y-3 rounded-xl border-2 border-[var(--s-cobalt)] p-3">
      <p className="font-bold">Claude&rsquo;s suggested order</p>
      <p className="s-muted">{pending.text}</p>
      {pending.payload.episodes.map((pe) => (
        <div key={pe.episode_id}>
          {pe.acts.map((a) => (
            <div key={a.act_id} className="mt-2">
              <p className="text-xs font-bold uppercase">{actTitle.get(a.act_id)}</p>
              <ol className="mt-1 space-y-1">
                {a.scene_ids.map((sid, i) => {
                  const moved = where.get(sid) !== `${a.act_id}:${i}`;
                  return (
                    <li key={sid} className={`rounded px-2 py-1 ${moved ? "s-active" : ""}`}>
                      {i + 1}. {title.get(sid)}
                      {moved && <span className="block text-xs">Moved{why.get(sid) ? `: ${why.get(sid)}` : ""}</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      ))}
      <form className="flex gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="suggestion_id" value={pending.id} />
        <SubmitButton formAction={acceptReorder} pendingText="Applying…">Accept</SubmitButton>
        <SubmitButton formAction={rejectReorder} variant="quiet" pendingText="…">Reject</SubmitButton>
      </form>
    </div>
  );
}
