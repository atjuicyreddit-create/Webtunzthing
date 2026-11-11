import { addLesson, approveLesson, importEditLog, rejectLesson, saveLesson, toggleLesson } from "./actions";
import { Notice } from "@/components/studio/Notice";
import { SubmitButton } from "@/components/studio/ui";
import { requireStudio } from "@/lib/studio/auth";
import { LESSON_COLS, editLogAvailable, type Lesson } from "@/lib/studio/lessons/lessons";

export const metadata = { title: "Lessons" };

const SOURCE: Record<string, string> = { brief: "Key lesson", "EDIT-LOG.md": "Edit log", qa: "Claude's QA", reject: "Rejected take", tom: "You" };

export default async function LessonsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; show?: string }> }) {
  const { supabase } = await requireStudio("/studio/lessons");
  const sp = await searchParams;
  const { data, error } = await supabase.from("studio_lessons").select(LESSON_COLS).order("is_key", { ascending: false }).order("created_at");
  const lessons = (data ?? []) as Lesson[];
  const show = sp.show ?? "proposed";
  const groups = {
    proposed: lessons.filter((l) => l.status === "proposed"),
    active: lessons.filter((l) => l.status === "approved" && l.active),
    off: lessons.filter((l) => l.status === "approved" && !l.active),
    rejected: lessons.filter((l) => l.status === "rejected"),
  };
  const list = groups[show as keyof typeof groups] ?? groups.proposed;
  const tabs: [keyof typeof groups, string][] = [["proposed", "To approve"], ["active", "On"], ["off", "Approved, off"], ["rejected", "Rejected"]];

  return (
    <div className="max-w-4xl">
      <h1 className="s-head text-3xl">Lessons</h1>
      <p className="s-muted mt-1">
        What went wrong before, so it doesn&rsquo;t happen again. Only lessons you approve and switch on are used: art lessons go into panel prompts and
        Claude&rsquo;s QA, writing lessons into the script check. Each prompt shows which lessons it used.
      </p>
      <div className="mt-4">
        <Notice error={sp.error ?? (error ? "Lessons couldn't be loaded. Has the Stage 5 database update been run?" : null)} ok={sp.ok} />
      </div>

      {editLogAvailable() && (
        <form className="s-card mt-2 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">Import the Morning Brew edit log (studio-reference/EDIT-LOG.md on this computer). Entries start switched off.</p>
          <SubmitButton formAction={importEditLog} variant="quiet" pendingText="Importing…">Import EDIT-LOG.md</SubmitButton>
        </form>
      )}

      <nav aria-label="Lesson lists" className="mt-4 flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <a
            key={k}
            href={`/studio/lessons?show=${k}`}
            aria-current={show === k ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold ${show === k ? "bg-[var(--s-ink)] text-white" : "border-2 border-[var(--s-line)] bg-white"}`}
          >
            {label} ({groups[k].length})
          </a>
        ))}
      </nav>

      {list.length === 0 && <p className="s-card mt-4 p-6 text-center">Nothing here.</p>}
      <ul className="mt-4 space-y-3">
        {list.map((l) => (
          <li key={l.id} id={`l-${l.id}`} className="s-card p-4">
            <p className="s-muted text-xs font-bold uppercase tracking-wide">
              {SOURCE[l.source ?? ""] ?? l.source ?? "—"} · {l.tag} · {l.theme ?? "general"} · {l.scope}{l.scope_ref ? `: ${l.scope_ref}` : ""}
              {l.entry_ref && !l.is_key ? ` · ${l.entry_ref}` : ""}
            </p>
            <p className="mt-1 font-bold">{l.lesson}</p>
            {l.problem && l.problem !== l.lesson && <p className="s-muted mt-1 text-sm">Problem: {l.problem}{l.fix ? ` · Fix: ${l.fix}` : ""}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <form className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={l.id} />
                {l.status !== "approved" && <SubmitButton formAction={approveLesson} pendingText="…">Approve and switch on</SubmitButton>}
                {l.status === "approved" && <SubmitButton formAction={toggleLesson} variant="quiet" pendingText="…">{l.active ? "Switch off" : "Switch on"}</SubmitButton>}
                {l.status !== "rejected" && !l.is_key && <SubmitButton formAction={rejectLesson} variant="quiet" pendingText="…">Reject</SubmitButton>}
              </form>
            </div>
            <details className="mt-2">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Edit</summary>
              <form className="grid gap-2 sm:grid-cols-3">
                <input type="hidden" name="id" value={l.id} />
                <label className="block text-sm font-bold sm:col-span-3">
                  Lesson (one sentence)
                  <input name="lesson" defaultValue={l.lesson} maxLength={500} className="s-input mt-1" />
                </label>
                <label className="block text-sm font-bold">
                  For
                  <select name="tag" defaultValue={l.tag} className="s-input mt-1">
                    <option value="art">Art (panel prompts, QA)</option>
                    <option value="writing">Writing (script check)</option>
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  Scope
                  <select name="scope" defaultValue={l.scope} className="s-input mt-1">
                    <option value="global">Every comic</option>
                    <option value="series">This series</option>
                    <option value="character">One character</option>
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  Character (if one character)
                  <input name="scope_ref" defaultValue={l.scope_ref ?? ""} maxLength={80} className="s-input mt-1" />
                </label>
                <div className="sm:col-span-3">
                  <SubmitButton formAction={saveLesson} variant="quiet" pendingText="Saving…">Save</SubmitButton>
                </div>
              </form>
            </details>
          </li>
        ))}
      </ul>

      <details className="s-card mt-6 p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-bold">Add a lesson by hand</summary>
        <form action={addLesson} className="mt-2 grid gap-2">
          <label className="block text-sm font-bold">
            Lesson (one sentence)
            <input name="lesson" required maxLength={500} className="s-input mt-1" />
          </label>
          <label className="block text-sm font-bold">
            What went wrong (optional)
            <input name="problem" maxLength={1000} className="s-input mt-1" />
          </label>
          <label className="block max-w-xs text-sm font-bold">
            For
            <select name="tag" className="s-input mt-1">
              <option value="art">Art</option>
              <option value="writing">Writing</option>
            </select>
          </label>
          <div>
            <SubmitButton pendingText="Adding…">Add as proposed</SubmitButton>
          </div>
        </form>
      </details>
    </div>
  );
}
