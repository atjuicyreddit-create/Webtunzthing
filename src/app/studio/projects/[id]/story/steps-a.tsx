import Link from "next/link";
import {
  checkOneLine,
  deleteWhyItem,
  runWhyPass,
  saveAnswer,
  saveOneLine,
  saveWhyReasons,
  suggestAnswers,
  useSuggestedOneLine,
} from "../story-actions";
import { costLabel } from "@/components/studio/ProjectShell";
import { SubmitButton } from "@/components/studio/ui";
import { QUESTIONS, questionByKey, type QuestionKey } from "@/lib/studio/story/questions";
import type { Story } from "@/lib/studio/story/story";

// ------------------------------------------------------------------ question cards

export function CardsStep({
  s,
  current,
  estimate,
}: {
  s: Story;
  current: QuestionKey;
  estimate: number | null;
}) {
  const id = s.project.id;
  const q = questionByKey(current)!;
  const a = s.answers[current];
  const idx = QUESTIONS.findIndex((x) => x.key === current);
  const approved = s.gate?.state === "approved";
  const pickIndex = a?.suggestions?.findIndex((x) => x.answer === a?.answer) ?? -1;

  return (
    <>
      <ol aria-label="Questions" className="flex flex-wrap gap-2">
        {QUESTIONS.map((x, i) => {
          const done = Boolean(s.answers[x.key]?.answer?.trim());
          const here = x.key === current;
          return (
            <li key={x.key}>
              <Link
                href={`/studio/projects/${id}/story?step=cards&q=${x.key}`}
                aria-current={here ? "step" : undefined}
                aria-label={`Question ${i + 1}: ${x.title}${done ? " (answered)" : ""}`}
                className={`grid size-11 place-items-center rounded-full border-2 text-sm font-bold ${
                  here ? "border-[var(--s-ink)] bg-[var(--s-ink)] text-white" : done ? "s-active border-transparent" : "border-[var(--s-line)] bg-white"
                }`}
              >
                {done && !here ? "✓" : i + 1}
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="s-card mt-4 p-5">
        <p className="s-muted text-sm font-bold">
          Question {idx + 1} of {QUESTIONS.length}
          {a?.source === "from_idea" && (
            <span className="ml-2 rounded-md bg-[var(--s-cobalt)] px-2 py-0.5 text-xs text-white">From your idea</span>
          )}
        </p>
        <h2 className="s-head mt-1 text-2xl">{q.title}</h2>
        <p className="s-muted mt-1">{q.help}</p>
        {a?.answer && (
          <p className="mt-2 text-sm">
            <span className="font-bold">Changing this affects:</span> {q.affects.join(", ")}
            {approved && " — and reopens the approved story."}
          </p>
        )}

        <form className="mt-4">
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="key" value={current} />
          <SubmitButton formAction={suggestAnswers} variant="info" pendingText="Asking Claude…">
            {a?.suggestions?.length ? "Suggest different answers" : "Suggest answers"} · {costLabel(estimate)}
          </SubmitButton>
        </form>

        <form action={saveAnswer} className="mt-4 space-y-3" key={`${current}|${a?.answer ?? ""}|${a?.suggestions?.length ?? 0}`}>
          <input type="hidden" name="project_id" value={id} />
          <input type="hidden" name="key" value={current} />
          {(a?.suggestions?.length ?? 0) > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-bold">Suggestions</legend>
              {a!.suggestions.map((sg, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer gap-3 rounded-xl border-2 border-[var(--s-line)] p-3 has-[:checked]:border-[var(--s-ink)] has-[:checked]:bg-[var(--s-paper)]"
                >
                  <input type="radio" name="pick" value={i} defaultChecked={i === pickIndex} className="mt-1 size-5 shrink-0" />
                  <span>
                    <span className="block font-medium">{sg.answer}</span>
                    <span className="s-muted block text-sm">Why this works: {sg.why}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <label htmlFor="own" className="block font-bold">
              {a?.answer ? "Your answer (edit to write your own)" : "Write my own"}
            </label>
            <textarea id="own" name="own" rows={3} maxLength={1000} defaultValue={a?.answer ?? ""} className="s-input mt-1" />
            <p className="s-muted text-xs">Pick a suggestion, or type here. If you change the text, your words are used.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingText="Saving…">Save &amp; next</SubmitButton>
            {idx > 0 && (
              <Link href={`/studio/projects/${id}/story?step=cards&q=${QUESTIONS[idx - 1].key}`} className="s-btn s-btn-quiet">
                ← Back
              </Link>
            )}
          </div>
        </form>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Why? pass

export function WhyStep({ s, estimate }: { s: Story; estimate: number | null }) {
  const id = s.project.id;
  return (
    <div className="s-card p-5">
      <h2 className="s-head text-2xl">Why? pass</h2>
      <p className="s-muted mt-1">
        Every action and object needs a reason (guideline 4b). Claude lists anything without one; you give one line each.
      </p>
      <form className="mt-4">
        <input type="hidden" name="project_id" value={id} />
        <SubmitButton formAction={runWhyPass} variant="info" pendingText="Checking…">
          {s.whys.length ? "Check again for missing reasons" : "Find things without a reason"} · {costLabel(estimate)}
        </SubmitButton>
      </form>

      {s.whys.length > 0 && (
        <form action={saveWhyReasons} className="mt-5 space-y-4" key={s.whys.map((w) => `${w.id}:${w.reason ?? ""}`).join("|")}>
          <input type="hidden" name="project_id" value={id} />
          {s.whys.map((w) => (
            <div key={w.id}>
              <label htmlFor={`reason_${w.id}`} className="block font-bold">
                {w.question}
              </label>
              <input
                id={`reason_${w.id}`}
                name={`reason_${w.id}`}
                defaultValue={w.reason ?? ""}
                maxLength={500}
                className="s-input mt-1"
                placeholder="One line"
              />
            </div>
          ))}
          <SubmitButton pendingText="Saving…">Save reasons</SubmitButton>
        </form>
      )}
      {s.whys.length > 0 && (
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Remove an item that doesn&rsquo;t need a reason</summary>
          <ul className="space-y-2">
            {s.whys.map((w) => (
              <li key={w.id}>
                <form action={deleteWhyItem} className="flex items-center justify-between gap-3">
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="why_id" value={w.id} />
                  <span className="text-sm">{w.item}</span>
                  <SubmitButton variant="quiet" pendingText="…">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ One-line test

export function OneLineStep({ s, estimate }: { s: Story; estimate: number | null }) {
  const id = s.project.id;
  const check = s.project.one_line_check as { passes: boolean; problems: string[]; suggested?: string } | null;
  return (
    <div className="s-card p-5">
      <h2 className="s-head text-2xl">One-line test</h2>
      <p className="s-muted mt-1">
        &ldquo;[Lead] wants [X] because [why today], but [flaw] leads to [ending].&rdquo; It has to read cleanly before you move on.
      </p>
      <form className="mt-4 space-y-3" key={s.project.one_line ?? ""}>
        <input type="hidden" name="project_id" value={id} />
        <label htmlFor="one_line" className="block font-bold">
          The sentence
        </label>
        <textarea id="one_line" name="one_line" rows={3} maxLength={600} defaultValue={s.project.one_line ?? ""} className="s-input" />
        <div className="flex flex-wrap gap-2">
          <SubmitButton formAction={checkOneLine} variant="info" pendingText="Checking…">
            {s.project.one_line ? "Check it" : "Draft it for me"} · {costLabel(estimate)}
          </SubmitButton>
          <SubmitButton formAction={saveOneLine} variant="quiet" pendingText="Saving…">
            Save without checking
          </SubmitButton>
        </div>
      </form>
      {check && (
        <div className={`mt-4 rounded-xl p-4 ${check.passes ? "s-active" : "border-2 border-[var(--s-magenta)] bg-white"}`}>
          <p className="font-bold">{check.passes ? "✓ Passes" : "Doesn't pass yet"}</p>
          {check.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {check.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {!check.passes && check.suggested && check.suggested !== s.project.one_line && (
            <form action={useSuggestedOneLine} className="mt-3">
              <input type="hidden" name="project_id" value={id} />
              <p className="text-sm">
                <strong>Claude suggests:</strong> {check.suggested}
              </p>
              <SubmitButton variant="quiet" pendingText="…" className="mt-2">
                Use this sentence
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
