import Link from "next/link";
import {
  acceptSuggestion,
  addCharacter,
  approveStory,
  deleteCharacter,
  draftCharacters,
  draftPlot,
  rejectSuggestion,
  reopenStory,
  saveCharacter,
  savePlot,
} from "../story-actions";
import { costLabel } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import type { Story } from "@/lib/studio/story/story";

// ------------------------------------------------------------------ Characters

const field = "s-input mt-1";

export function CharactersStep({ s, selected, estimate }: { s: Story; selected?: string; estimate: number | null }) {
  const id = s.project.id;
  const c = s.characters.find((x) => x.id === selected) ?? s.characters[0];
  return (
    <div className="space-y-4">
      <div className="s-card p-5">
        <h2 className="s-head text-2xl">Characters</h2>
        <p className="s-muted mt-1">Claude drafts a sheet for each character; you edit. Guardrails and costume locks are used in every later prompt.</p>
        <form className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="project_id" value={id} />
          <SubmitButton formAction={draftCharacters} variant="info" pendingText="Drafting…">
            {s.characters.length ? "Draft any missing characters" : "Draft character sheets"} · {costLabel(estimate)}
          </SubmitButton>
          <SubmitButton formAction={addCharacter} variant="quiet" pendingText="Adding…">
            Add a blank character
          </SubmitButton>
        </form>
        {s.characters.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Characters">
            {s.characters.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/studio/projects/${id}/story?step=characters&c=${x.id}`}
                  aria-current={x.id === c?.id ? "true" : undefined}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-medium ${
                    x.id === c?.id ? "border-[var(--s-ink)] bg-[var(--s-ink)] text-white" : "border-[var(--s-line)] bg-white"
                  }`}
                >
                  {x.name}
                  {x.role && <span className="text-xs opacity-75">{x.role}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {c && (
        <form action={saveCharacter} className="s-card space-y-4 p-5" key={`${c.id}|${c.name}|${c.role}|${JSON.stringify(c.sheet)}`}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="character_id" value={c.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="block font-bold">Name</label>
              <input id="name" name="name" required maxLength={80} defaultValue={c.name} className={field} />
            </div>
            <div>
              <label htmlFor="role" className="block font-bold">Role</label>
              <input id="role" name="role" maxLength={80} defaultValue={c.role} className={field} placeholder="lead, rival, mentor…" />
            </div>
          </div>
          <div>
            <label htmlFor="backstory" className="block font-bold">Backstory</label>
            <textarea id="backstory" name="backstory" rows={3} maxLength={1000} defaultValue={c.sheet.backstory ?? ""} className={field} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["want", "fear", "flaw", "voice"] as const).map((k) => (
              <div key={k}>
                <label htmlFor={k} className="block font-bold capitalize">{k}</label>
                <input id={k} name={k} maxLength={300} defaultValue={c.sheet[k] ?? ""} className={field} />
              </div>
            ))}
          </div>
          <fieldset className="space-y-3 rounded-xl border-2 border-[var(--s-line)] p-4">
            <legend className="px-1 font-bold">Look</legend>
            <div>
              <label htmlFor="silhouette" className="block font-bold">Silhouette</label>
              <input id="silhouette" name="silhouette" maxLength={300} defaultValue={c.sheet.look?.silhouette ?? ""} className={field} />
            </div>
            <div>
              <label htmlFor="colours" className="block font-bold">Colours</label>
              <p className="s-muted text-xs">One per line: name then hex, e.g. &ldquo;Feathers #F7F4EC&rdquo;.</p>
              <textarea
                id="colours"
                name="colours"
                rows={3}
                defaultValue={(c.sheet.look?.colours ?? []).map((k) => `${k.name} ${k.hex}`).join("\n")}
                className={`${field} font-mono text-sm`}
              />
              {(c.sheet.look?.colours ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2" aria-hidden="true">
                  {c.sheet.look!.colours!.map((k) => (
                    <span key={k.hex + k.name} className="inline-flex items-center gap-1 text-xs">
                      <span className="size-5 rounded border border-[var(--s-line)]" style={{ background: k.hex }} />
                      {k.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="signature" className="block font-bold">Signature details</label>
              <input id="signature" name="signature" maxLength={300} defaultValue={c.sheet.look?.signature ?? ""} className={field} />
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="costume_always" className="block font-bold">Always wears</label>
              <input id="costume_always" name="costume_always" maxLength={300} defaultValue={c.sheet.costume_always ?? ""} className={field} />
            </div>
            <div>
              <label htmlFor="costume_never" className="block font-bold">Never wears</label>
              <input id="costume_never" name="costume_never" maxLength={300} defaultValue={c.sheet.costume_never ?? ""} className={field} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="props" className="block font-bold">Signature props</label>
              <p className="s-muted text-xs">One per line.</p>
              <textarea id="props" name="props" rows={3} defaultValue={(c.sheet.props ?? []).join("\n")} className={field} />
            </div>
            <div>
              <label htmlFor="guardrails" className="block font-bold">Guardrails</label>
              <p className="s-muted text-xs">Hard rules, one per line (e.g. &ldquo;never smiles&rdquo;).</p>
              <textarea id="guardrails" name="guardrails" rows={3} defaultValue={(c.sheet.guardrails ?? []).join("\n")} className={field} />
            </div>
          </div>
          <SubmitButton pendingText="Saving…">Save {c.name}</SubmitButton>
        </form>
      )}

      {c && (
        <form action={deleteCharacter} className="s-card p-5">
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="character_id" value={c.id} />
          <p className="font-bold">Delete {c.name}</p>
          <label htmlFor="confirm" className="s-muted block text-sm">Type <strong>delete</strong> to confirm.</label>
          <input id="confirm" name="confirm" autoComplete="off" autoCapitalize="none" className={field} />
          <SubmitButton variant="quiet" pendingText="Deleting…" className="mt-3">Delete character</SubmitButton>
        </form>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Season plot

export function PlotStep({ s, estimate }: { s: Story; estimate: number | null }) {
  const id = s.project.id;
  const serial = s.project.format === "serial";
  const pending = s.suggestions.filter((x) => x.status === "pending");
  const decided = s.suggestions.filter((x) => x.status !== "pending");
  return (
    <div className="space-y-4">
      <div className="s-card p-5">
        <h2 className="s-head text-2xl">{serial ? "Season plot" : "Plot"}</h2>
        <p className="s-muted mt-1">
          {serial
            ? "A fixed destination and 3 to 5 growth milestones. Votes choose the route between milestones, never the destination, so the flaw isn't cured early."
            : "A short summary, then Claude's suggestions to strengthen the story."}
        </p>
        <form className="mt-4">
          <input type="hidden" name="project_id" value={id} />
          <SubmitButton formAction={draftPlot} variant="info" pendingText="Drafting…">
            {s.project.season_summary ? "Get more suggestions" : "Draft the plot"} · {costLabel(estimate)}
          </SubmitButton>
          <p className="s-muted mt-2 text-xs">Anything you&rsquo;ve already written is kept; Claude only fills empty parts and adds suggestions.</p>
        </form>
      </div>

      <form action={savePlot} className="s-card space-y-4 p-5" key={`${s.project.season_summary ?? ""}|${s.project.destination ?? ""}|${s.milestones.map((m) => m.title + m.description).join("|")}`}>
        <input type="hidden" name="project_id" value={id} />
        <div>
          <label htmlFor="season_summary" className="block font-bold">{serial ? "Season summary" : "Summary"}</label>
          <textarea id="season_summary" name="season_summary" rows={4} maxLength={2000} defaultValue={s.project.season_summary ?? ""} className="s-input mt-1" />
        </div>
        {serial && (
          <>
            <div>
              <label htmlFor="destination" className="block font-bold">Destination (fixed)</label>
              <input id="destination" name="destination" maxLength={500} defaultValue={s.project.destination ?? ""} className="s-input mt-1" />
            </div>
            <div>
              <label htmlFor="milestones" className="block font-bold">Growth milestones, in order (3 to 5)</label>
              <p className="s-muted text-xs">One per line: &ldquo;Title - what changes&rdquo;.</p>
              <textarea
                id="milestones"
                name="milestones"
                rows={5}
                defaultValue={s.milestones.map((m) => `${m.title}${m.description ? ` - ${m.description}` : ""}`).join("\n")}
                className="s-input mt-1"
              />
            </div>
            <p className="rounded-xl bg-[var(--s-paper)] p-3 text-sm">
              Every episode&rsquo;s end card will say: <strong>&ldquo;Comments steer the route, not the destination.&rdquo;</strong> Vote
              questions, backup picks and branches are set per episode in the script (stage 3).
            </p>
          </>
        )}
        <SubmitButton pendingText="Saving…">Save plot</SubmitButton>
      </form>

      {s.suggestions.length > 0 && (
        <div className="s-card p-5">
          <h3 className="s-head text-lg">Claude&rsquo;s suggestions</h3>
          {pending.length > 0 && (
            <ul className="mt-3 space-y-3">
              {pending.map((x) => (
                <li key={x.id} className="rounded-xl border-2 border-[var(--s-line)] p-3">
                  <p className="font-medium">{x.text}</p>
                  {x.why && <p className="s-muted text-sm">Why: {x.why}</p>}
                  <form className="mt-2 flex gap-2">
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="suggestion_id" value={x.id} />
                    <SubmitButton formAction={acceptSuggestion} pendingText="…">Accept</SubmitButton>
                    <SubmitButton formAction={rejectSuggestion} variant="quiet" pendingText="…">Reject</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {decided.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {decided.map((x) => (
                <li key={x.id} className={x.status === "rejected" ? "s-muted line-through" : ""}>
                  {x.status === "accepted" ? "✓ " : ""}
                  {x.text}
                </li>
              ))}
            </ul>
          )}
          {s.suggestions.some((x) => x.status === "accepted") && (
            <p className="s-muted mt-3 text-sm">Accepted ideas aren&rsquo;t applied automatically: fold them into your answers or characters.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Approve

export function ApproveStep({ s, gaps }: { s: Story; gaps: string[] }) {
  const id = s.project.id;
  const g = s.gate;
  return (
    <div className="s-card p-5">
      <h2 className="s-head text-2xl">Gate: Story approved</h2>
      <p className="s-muted mt-1">
        Only you can press this. It records your name, the time and your note. Any later change to the story reopens it.
      </p>

      {g?.state === "approved" && (
        <div className="s-active mt-4 rounded-xl p-4">
          <p className="font-bold">✓ Approved {g.approved_at ? new Date(g.approved_at).toLocaleString("en-GB", { timeZone: "Europe/London" }) : ""}</p>
          {g.note && <p className="text-sm">Note: {g.note}</p>}
        </div>
      )}
      {g?.state === "stale" && (
        <p role="alert" className="mt-4 rounded-xl border-2 border-[var(--s-magenta)] bg-white p-4 font-bold text-[var(--s-magenta-deep)]">
          The story changed after it was approved. Review it and approve again.
        </p>
      )}

      {gaps.length > 0 ? (
        <div className="mt-4">
          <p className="font-bold">Still to do before you can approve:</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {gaps.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : (
        g?.state !== "approved" && (
          <form action={approveStory} className="mt-4 space-y-3">
            <input type="hidden" name="project_id" value={id} />
            <label htmlFor="note" className="block font-bold">Note (optional)</label>
            <input id="note" name="note" maxLength={500} className="s-input" placeholder="e.g. Happy with the ending" />
            <SubmitButton pendingText="Approving…">Approve the story</SubmitButton>
          </form>
        )
      )}

      {g?.state === "approved" && (
        <form action={reopenStory} className="mt-4 space-y-2">
          <input type="hidden" name="project_id" value={id} />
          <label htmlFor="reopen_note" className="block text-sm font-bold">Reopen to make changes (optional note)</label>
          <input id="reopen_note" name="note" maxLength={500} className="s-input" />
          <SubmitButton variant="quiet" pendingText="…">Reopen</SubmitButton>
        </form>
      )}
    </div>
  );
}
