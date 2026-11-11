import Link from "next/link";
import { notFound } from "next/navigation";
import { chooseLogline, readIdea, saveIdea, suggestLoglines } from "../story-actions";
import { Notice } from "@/components/studio/Notice";
import { ProjectShell, costLabel } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { getStudioSettings } from "@/lib/studio/settings";
import { estimateStoryAction } from "@/lib/studio/story/run";
import { loadStory } from "@/lib/studio/story/story";

export const metadata = { title: "Idea" };

const TONES = ["Cosy", "Funny", "Spooky", "Dramatic", "Adventurous", "Heartwarming"];
const AUDIENCES = ["All ages", "Teens", "Adults"];

export default async function IdeaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const { supabase } = await requireStudio(`/studio/projects/${id}/idea`);
  const [s, settings] = await Promise.all([loadStory(supabase, id), getStudioSettings(supabase)]);
  if (!s) notFound();
  const p = s.project;
  const est = {
    loglines: estimateStoryAction(settings, s, { kind: "loglines" }),
    read: estimateStoryAction(settings, s, { kind: "read_idea" }),
  };
  const pickIndex = p.loglines.findIndex((l) => l.text === p.logline);

  return (
    <ProjectShell
      projectId={id}
      current="idea"
      storyGate={s.gate?.state ?? null}
      side={
        <>
          <p className="s-muted">
            Model: <span className="font-mono text-xs">{settings?.models.story}</span>
            {settings?.dry_run && <strong className="block">Dry-run is on: replies are placeholders and cost nothing.</strong>}
          </p>
          <p className="s-muted">
            Estimates are the most a request could cost. Real costs are usually much lower, and every call is in the{" "}
            <Link href="/studio/settings" className="s-link">
              cost ledger
            </Link>
            .
          </p>
        </>
      }
    >
      <p className="s-muted text-sm font-bold uppercase tracking-wide">Step 1</p>
      <h1 className="s-head text-3xl">What&rsquo;s the idea?</h1>
      <div className="mt-4">
        <Notice error={q.error} ok={q.ok} />
      </div>

      <form action={saveIdea} className="s-card mt-4 space-y-4 p-5" key={`${p.idea}|${p.tone}|${p.audience}|${p.episodes_planned}|${p.format}`}>
        <input type="hidden" name="project_id" value={id} />
        <div>
          <label htmlFor="idea" className="block font-bold">
            The idea, in a line or two
          </label>
          <textarea
            id="idea"
            name="idea"
            rows={3}
            maxLength={4000}
            defaultValue={p.idea ?? ""}
            placeholder="e.g. A lazy duck has to make his coffee before the witch who owns his cottage inspects it at 7 a.m."
            className="s-input mt-1"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tone" className="block font-bold">
              Tone
            </label>
            <input id="tone" name="tone" list="tones" defaultValue={p.tone ?? ""} className="s-input mt-1" placeholder="Pick or type" />
            <datalist id="tones">
              {TONES.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="audience" className="block font-bold">
              Audience
            </label>
            <input id="audience" name="audience" list="audiences" defaultValue={p.audience ?? ""} className="s-input mt-1" placeholder="Pick or type" />
            <datalist id="audiences">
              {AUDIENCES.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="episodes_planned" className="block font-bold">
              Length (episodes)
            </label>
            <input
              id="episodes_planned"
              name="episodes_planned"
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              defaultValue={p.episodes_planned ?? ""}
              className="s-input mt-1"
            />
          </div>
          <fieldset>
            <legend className="font-bold">Format</legend>
            <p className="s-muted text-xs">Decides whether each episode ends on a reader vote.</p>
            <label className="mt-1 flex min-h-11 items-center gap-2">
              <input type="radio" name="format" value="serial" defaultChecked={p.format === "serial"} className="size-5" /> Serial
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="format" value="one_off" defaultChecked={p.format === "one_off"} className="size-5" /> One-off
            </label>
          </fieldset>
        </div>
        <p className="s-muted text-sm">Vertical scroll is the only format for now.</p>
        <SubmitButton pendingText="Saving…">Save idea</SubmitButton>
      </form>

      <section className="s-card mt-6 p-5" aria-labelledby="loglines-title">
        <h2 id="loglines-title" className="s-head text-lg">
          Loglines
        </h2>
        <p className="s-muted text-sm">Claude writes three takes on the idea. Pick one, or write your own.</p>
        <form className="mt-3">
          <input type="hidden" name="project_id" value={id} />
          <SubmitButton formAction={suggestLoglines} variant="info" pendingText="Asking Claude…" disabled={!p.idea}>
            {p.loglines.length ? "Suggest three new loglines" : "Suggest three loglines"} · {costLabel(est.loglines)}
          </SubmitButton>
          {!p.idea && <p className="s-muted mt-2 text-sm">Save the idea first.</p>}
        </form>

        <form action={chooseLogline} className="mt-4 space-y-3" key={`${p.logline}|${p.loglines.map((l) => l.text).join("|")}`}>
          <input type="hidden" name="project_id" value={id} />
          {p.loglines.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="sr-only">Pick a logline</legend>
              {p.loglines.map((l, i) => (
                <label key={i} className="flex cursor-pointer gap-3 rounded-xl border-2 border-[var(--s-line)] p-3 has-[:checked]:border-[var(--s-ink)] has-[:checked]:bg-[var(--s-paper)]">
                  <input type="radio" name="pick" value={i} defaultChecked={i === pickIndex} className="mt-1 size-5 shrink-0" />
                  <span>
                    <span className="block font-medium">{l.text}</span>
                    <span className="s-muted block text-sm">Why it works: {l.why}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <label htmlFor="own_logline" className="block font-bold">
              Or write my own
            </label>
            <textarea
              id="own_logline"
              name="own_logline"
              rows={2}
              maxLength={500}
              defaultValue={pickIndex === -1 ? p.logline ?? "" : ""}
              className="s-input mt-1"
            />
            <p className="s-muted text-xs">If you write one here, it&rsquo;s used instead of the picked one.</p>
          </div>
          <SubmitButton pendingText="Saving…">Use this logline</SubmitButton>
        </form>
        {p.logline && (
          <p className="mt-4 rounded-xl bg-[var(--s-paper)] p-3 text-sm">
            <strong>Current logline:</strong> {p.logline}
          </p>
        )}
      </section>

      {p.logline && (
        <section className="s-card mt-6 p-5">
          <h2 className="s-head text-lg">Next: the story questions</h2>
          <p className="s-muted text-sm">
            Claude can read your idea and logline and fill in any questions they already answer, so you skip them. You can change
            every answer afterwards.
          </p>
          <form className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="project_id" value={id} />
            <SubmitButton formAction={readIdea} variant="info" pendingText="Reading…">
              Read my idea for answers · {costLabel(est.read)}
            </SubmitButton>
            <Link href={`/studio/projects/${id}/story`} className="s-btn s-btn-quiet">
              Skip to the questions
            </Link>
          </form>
        </section>
      )}
    </ProjectShell>
  );
}
