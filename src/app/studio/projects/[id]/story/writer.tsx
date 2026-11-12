import Link from "next/link";
import {
  lockStory,
  rereadDraft,
  restoreVersion,
  saveBlankAnswers,
  setStoryMode,
  startDraft,
  updateDraft,
} from "../draft-actions";
import { reopenStory } from "../story-actions";
import { costLabel } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { openPlotBlanks, type Blank, type DraftRow, type Entry, type Quickstart } from "@/lib/studio/draft/types";
import { QUESTIONS } from "@/lib/studio/story/questions";
import type { Story } from "@/lib/studio/story/story";

// The story writer. Left: Tom's story as Claude organised it, with blanks to fill.
// Right (the side panel): "Make changes", version history and story health.

type Version = { version: number; change_request: string | null; created_at: string };

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="project_id" value={id} />;
}

// ------------------------------------------------------------------ quick start + telling

export function TellStep({ s, estimate, prefill }: { s: Story; estimate: number | null; prefill: Quickstart & { telling: string } }) {
  const id = s.project.id;
  return (
    <form action={startDraft} className="s-card space-y-5 p-5">
      <Hidden id={id} />
      <div>
        <h2 className="s-head text-2xl">1. Quick start</h2>
        <p className="s-muted text-sm">Only the first box is needed. Keep it short; Claude adds to it as you write.</p>
      </div>
      <div>
        <label htmlFor="about" className="block font-bold">What is this story about, in one sentence?</label>
        <input id="about" name="about" required maxLength={500} defaultValue={prefill.about} className="s-input mt-1" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="setting" className="block font-bold">Where is it set?</label>
          <input id="setting" name="setting" maxLength={300} defaultValue={prefill.setting} className="s-input mt-1" placeholder="e.g. London, near future" />
        </div>
        <div>
          <label htmlFor="lead" className="block font-bold">Who is the main character?</label>
          <input id="lead" name="lead" maxLength={300} defaultValue={prefill.lead} className="s-input mt-1" placeholder="e.g. Jason, a delivery driver" />
        </div>
      </div>
      <div>
        <label htmlFor="backstory" className="block font-bold">Their backstory (brief)</label>
        <textarea id="backstory" name="backstory" rows={2} maxLength={2000} defaultValue={prefill.backstory} className="s-input mt-1" />
      </div>
      <div>
        <h2 className="s-head text-2xl">2. Tell the episode</h2>
        <p className="s-muted text-sm">
          Write what happens, start to finish, in your own words. Spelling and order don&rsquo;t matter. Claude turns it into a draft, asks only
          about the gaps that matter, and files every detail you mention.
        </p>
        <label htmlFor="telling" className="sr-only">What happens in the episode</label>
        <textarea id="telling" name="telling" required rows={14} maxLength={20000} defaultValue={prefill.telling} className="s-input mt-2" />
      </div>
      <SubmitButton pendingText="Claude is reading…">Read my story ({costLabel(estimate)})</SubmitButton>
    </form>
  );
}

// ------------------------------------------------------------------ the draft

function Marker({ blank }: { blank: Blank | undefined }) {
  if (!blank) return null;
  if (blank.answer?.trim()) return <mark className="rounded bg-[#E3F6D8] px-1 font-semibold">{blank.answer}</mark>;
  if (blank.kind === "detail")
    return (
      <span className="border-b-2 border-dotted border-[var(--s-line)]" title="Claude's guess: change it in the questions above">
        {blank.guess}
      </span>
    );
  return (
    <a href={`#blank-${blank.id}`} className="rounded bg-[#FFE3EF] px-1 font-bold text-[var(--s-magenta-deep)]">
      ___ ({blank.question})
    </a>
  );
}

function BeatText({ text, blanks }: { text: string; blanks: Blank[] }) {
  const parts = text.split(/(\[\[[a-z0-9_-]+\]\])/gi);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[\[([a-z0-9_-]+)\]\]$/i);
        return m ? <Marker key={i} blank={blanks.find((b) => b.id === m[1])} /> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function DraftView({ s, prevBeats }: { s: Story; prevBeats: Map<string, string> | null }) {
  const d = s.draft!;
  return (
    <div className="s-card p-5">
      <p className="s-muted text-xs font-bold uppercase tracking-wide">In one sentence</p>
      <p className="text-lg font-semibold">{d.draft.synopsis}</p>
      {d.health && (
        <p className="s-muted mt-1 text-sm">
          About {d.health.panels_estimate} panels.
          {d.health.episode_split && <strong className="block text-[var(--s-ink)]">Length: {d.health.episode_split}</strong>}
        </p>
      )}
      <ol className="mt-4 space-y-4">
        {d.draft.beats.map((b, i) => {
          const changed = prevBeats && prevBeats.get(b.id) !== b.text;
          return (
            <li key={b.id} id={`beat-${b.id}`} className={`rounded-xl p-3 ${changed ? "border-2 border-[var(--s-magenta)]" : "bg-[var(--s-paper)]"}`}>
              <p className="text-sm font-bold">
                {i + 1}. {b.heading}
                {changed && <span className="ml-2 rounded-full bg-[var(--s-magenta)] px-2 py-0.5 text-xs text-white">{prevBeats.has(b.id) ? "changed" : "new"}</span>}
              </p>
              <p className="mt-1 leading-relaxed">
                <BeatText text={b.text} blanks={d.draft.blanks} />
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BlankField({ b }: { b: Blank }) {
  const choices = [...new Set([b.guess, ...b.options].filter(Boolean))];
  const own = b.answer && !choices.includes(b.answer) ? b.answer : "";
  return (
    <fieldset id={`blank-${b.id}`} className="rounded-xl border-2 border-[var(--s-line)] bg-white p-3">
      <legend className="px-1 font-bold">{b.question}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {choices.map((o, i) => (
          <label key={o} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-[var(--s-line)] px-3 text-sm has-[:checked]:border-[var(--s-ink)] has-[:checked]:bg-[var(--s-paper)]">
            <input type="radio" name={`pick_${b.id}`} value={o} defaultChecked={b.answer === o} />
            {o}
            {i === 0 && o === b.guess && <span className="s-muted text-xs">(Claude&rsquo;s guess)</span>}
          </label>
        ))}
      </div>
      <label htmlFor={`own_${b.id}`} className="mt-2 block text-sm font-bold">Or your own answer</label>
      <input id={`own_${b.id}`} name={`own_${b.id}`} maxLength={500} defaultValue={own} className="s-input mt-1" />
    </fieldset>
  );
}

export function QuestionsCard({ s }: { s: Story }) {
  const d = s.draft!;
  const plot = d.draft.blanks.filter((b) => b.kind === "plot");
  const details = d.draft.blanks.filter((b) => b.kind === "detail");
  const open = openPlotBlanks(d.draft).length;
  if (!plot.length && !details.length) return null;
  return (
    <form action={saveBlankAnswers} className="s-card space-y-3 p-5">
      <Hidden id={s.project.id} />
      <h2 className="s-head text-xl">Fill the gaps</h2>
      <p className="s-muted text-sm">
        {open ? `${open} story question${open === 1 ? "" : "s"} to answer. ` : "All story questions answered. "}
        Claude never decides these for you. Saving is free; then press <strong>Update story</strong> to write them in.
      </p>
      {plot.map((b) => (
        <BlankField key={b.id} b={b} />
      ))}
      {details.length > 0 && (
        <details className="rounded-xl bg-[var(--s-paper)] p-3">
          <summary className="cursor-pointer font-bold">Small details Claude guessed ({details.length}). Change any you like.</summary>
          <div className="mt-3 space-y-3">
            {details.map((b) => (
              <BlankField key={b.id} b={b} />
            ))}
          </div>
        </details>
      )}
      <SubmitButton variant="quiet" pendingText="Saving…">Save answers (free)</SubmitButton>
    </form>
  );
}

function EntryList({ title, items }: { title: string; items: Entry[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="font-bold">{title}</h3>
      <ul className="mt-1 space-y-2">
        {items.map((e) => (
          <li key={e.name} className="rounded-xl bg-[var(--s-paper)] p-3 text-sm">
            <p className="font-bold">
              {e.name}
              {e.role && <span className="s-muted font-normal"> · {e.role}</span>}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {e.facts.map((f, i) => (
                <li key={i}>
                  {f.text}
                  {f.guessed && <span className="ml-1 rounded bg-[#FFF3C4] px-1 text-xs font-bold">guess</span>}
                  {f.from && <span className="s-muted block text-xs">from &ldquo;{f.from}&rdquo;</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PortfolioCard({ s }: { s: Story }) {
  const p = s.draft!.portfolio;
  return (
    <section className="s-card space-y-4 p-5" aria-labelledby="portfolio-h">
      <div>
        <h2 id="portfolio-h" className="s-head text-xl">Story portfolio</h2>
        <p className="s-muted text-sm">Every detail you&rsquo;ve mentioned, filed by Claude. Things marked &ldquo;guess&rdquo; are Claude&rsquo;s, not yours.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <EntryList title="Characters" items={p.characters} />
        <EntryList title="Places" items={p.places} />
        <EntryList title="Objects" items={p.objects} />
        {p.mysteries.length > 0 && (
          <div>
            <h3 className="font-bold">Open mysteries</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {p.mysteries.map((m, i) => (
                <li key={i}>{m.text}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

export function TellingEditor({ s, estimate }: { s: Story; estimate: number | null }) {
  const d = s.draft!;
  return (
    <details className="s-card p-5">
      <summary className="cursor-pointer font-bold">Edit your quick start and telling</summary>
      <form action={updateDraft} className="mt-4 space-y-4">
        <Hidden id={s.project.id} />
        <div>
          <label htmlFor="e-about" className="block font-bold">What it&rsquo;s about</label>
          <input id="e-about" name="about" maxLength={500} defaultValue={d.quickstart.about} className="s-input mt-1" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="e-setting" className="block font-bold">Setting</label>
            <input id="e-setting" name="setting" maxLength={300} defaultValue={d.quickstart.setting} className="s-input mt-1" />
          </div>
          <div>
            <label htmlFor="e-lead" className="block font-bold">Main character</label>
            <input id="e-lead" name="lead" maxLength={300} defaultValue={d.quickstart.lead} className="s-input mt-1" />
          </div>
        </div>
        <div>
          <label htmlFor="e-backstory" className="block font-bold">Backstory</label>
          <textarea id="e-backstory" name="backstory" rows={2} maxLength={2000} defaultValue={d.quickstart.backstory} className="s-input mt-1" />
        </div>
        <div>
          <label htmlFor="e-telling" className="block font-bold">Your telling</label>
          <textarea id="e-telling" name="telling" rows={10} maxLength={20000} defaultValue={d.telling} className="s-input mt-1" />
        </div>
        <SubmitButton pendingText="Updating…">Save and update story ({costLabel(estimate)})</SubmitButton>
      </form>
    </details>
  );
}

export function LockCard({ s, gaps }: { s: Story; gaps: string[] }) {
  const id = s.project.id;
  const g = s.gate;
  return (
    <section id="lock" className="s-card p-5">
      <h2 className="s-head text-xl">Gate: Story approved</h2>
      <p className="s-muted text-sm">Locking hands the story to the Structure board, which splits it into scenes and panels. Any later change reopens it.</p>
      {g?.state === "approved" && (
        <div className="s-active mt-3 rounded-xl p-4">
          <p className="font-bold">✓ Locked {g.approved_at ? new Date(g.approved_at).toLocaleString("en-GB", { timeZone: "Europe/London" }) : ""}</p>
          <Link href={`/studio/projects/${id}/structure`} className="s-link mt-1 inline-block font-bold">
            Go to the Structure board →
          </Link>
        </div>
      )}
      {g?.state === "stale" && <p className="mt-3 font-bold text-[var(--s-magenta-deep)]">The story changed after it was locked. Lock it again when you&rsquo;re happy.</p>}
      {gaps.length > 0 ? (
        <ul className="mt-3 list-disc pl-5 text-sm">
          {gaps.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        g?.state !== "approved" && (
          <form action={lockStory} className="mt-3 space-y-2">
            <Hidden id={id} />
            <label htmlFor="lock-note" className="block text-sm font-bold">Note (optional)</label>
            <input id="lock-note" name="note" maxLength={500} className="s-input" />
            <SubmitButton pendingText="Locking…">Lock the story (free)</SubmitButton>
          </form>
        )
      )}
      {g?.state === "approved" && (
        <form action={reopenStory} className="mt-3">
          <Hidden id={id} />
          <SubmitButton variant="quiet" pendingText="…">Reopen</SubmitButton>
        </form>
      )}
    </section>
  );
}

export function RereadCard({ s, estimate }: { s: Story; estimate: number | null }) {
  return (
    <form action={rereadDraft} className="s-card space-y-2 p-5">
      <Hidden id={s.project.id} />
      <p className="font-bold">Your story is saved, but Claude hasn&rsquo;t read it yet.</p>
      <SubmitButton pendingText="Claude is reading…">Read my story ({costLabel(estimate)})</SubmitButton>
    </form>
  );
}

export function ModeSwitch({ id, to }: { id: string; to: "classic" | "draft" }) {
  return (
    <form action={setStoryMode}>
      <Hidden id={id} />
      <input type="hidden" name="mode" value={to} />
      <SubmitButton variant="quiet" pendingText="Switching…">
        {to === "draft" ? "Switch to the story writer" : "Switch back to question cards"}
      </SubmitButton>
    </form>
  );
}

// ------------------------------------------------------------------ side panel

export function ChangesPanel({
  s,
  estimate,
  versions,
  pending,
  dryRun,
}: {
  s: Story;
  estimate: number | null;
  versions: Version[];
  pending?: string;
  dryRun: boolean;
}) {
  const d = s.draft as DraftRow;
  const answered = d.draft.blanks.filter((b) => b.answer?.trim()).length;
  const h = d.health;
  return (
    <>
      <form id="update" action={updateDraft} className="space-y-2">
        <Hidden id={s.project.id} />
        <label htmlFor="change" className="block font-bold">Make changes</label>
        <p className="s-muted text-xs">Say what to change in plain words, e.g. &ldquo;make the homeless man older and calmer&rdquo;.</p>
        <textarea id="change" name="change" rows={5} maxLength={3000} defaultValue={pending ?? ""} className="s-input" />
        {answered > 0 && <p className="text-xs">Also writes in {answered === 1 ? "1 saved answer" : `${answered} saved answers`}.</p>}
        <SubmitButton pendingText="Claude is updating…">Update story ({costLabel(estimate)})</SubmitButton>
        {dryRun && <p className="text-xs font-bold">Dry-run is on: updates are placeholders and cost nothing.</p>}
      </form>

      {d.changes.length > 0 && (
        <div>
          <p className="font-bold">What changed in version {d.version}</p>
          <ul className="list-disc pl-5 text-xs">
            {d.changes.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {h && (
        <div>
          <p className="font-bold">Story health</p>
          <p className="text-xs">
            <strong>One-line test{h.one_line_passes ? " ✓" : " (not there yet)"}:</strong> {h.one_line}
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {h.notes.map((n, i) => (
              <li key={i} className={n.level === "weak" ? "font-semibold text-[var(--s-magenta-deep)]" : ""}>
                {n.level === "weak" ? "⚠ " : "✓ "}
                {n.text}
              </li>
            ))}
          </ul>
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer font-bold">Story spine (worked out from your telling)</summary>
            <dl className="mt-1 space-y-1">
              {QUESTIONS.map((q) => (
                <div key={q.key}>
                  <dt className="font-bold">{q.title}</dt>
                  <dd>{h.spine?.[q.key] || <span className="s-muted">not there yet</span>}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      )}

      {versions.length > 1 && (
        <div>
          <p className="font-bold">Versions</p>
          <ul className="space-y-1 text-xs">
            {versions.map((v) => (
              <li key={v.version} className="flex items-start justify-between gap-2">
                <span>
                  <strong>v{v.version}</strong> {v.change_request ? `· ${v.change_request.slice(0, 60)}${v.change_request.length > 60 ? "…" : ""}` : "· first read"}
                </span>
                {v.version !== d.version && (
                  <form action={restoreVersion}>
                    <Hidden id={s.project.id} />
                    <input type="hidden" name="version" value={v.version} />
                    <button type="submit" className="s-link whitespace-nowrap">Restore</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
