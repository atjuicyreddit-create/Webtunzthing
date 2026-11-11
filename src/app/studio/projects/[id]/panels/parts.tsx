import Link from "next/link";
import {
  approvePanels,
  chooseTake,
  fixTake,
  generateSelected,
  generateTake,
  letterThisPanel,
  proposeLessonFromFinding,
  rejectTake,
  reopenPanels,
  rerunAutoQa,
  resetLayout,
  runPrecheck,
  runVisionQa,
  saveDirection,
  saveLayout,
  saveTicks,
} from "../panels-actions";
import { SubmitButton } from "@/components/studio/ui";
import type { Block } from "@/lib/studio/panels/prompt";
import type { PanelState } from "@/lib/studio/panels/gate";
import { LETTER_FIELDS, LETTER_LABEL, QA_TICKS, type LetterEl, type LetterKind, type PanelRow, type PanelTake } from "@/lib/studio/panels/types";
import type { ScriptPanel } from "@/lib/studio/script/types";
import { formatUsd } from "@/lib/studio/settings";

type Ids = { projectId: string; episodeId: string };
const Hidden = ({ projectId, episodeId, panelKey }: Ids & { panelKey?: string }) => (
  <>
    <input type="hidden" name="project_id" value={projectId} />
    <input type="hidden" name="episode_id" value={episodeId} />
    {panelKey && <input type="hidden" name="panel_key" value={panelKey} />}
  </>
);
const base = (ids: Ids) => `/studio/projects/${ids.projectId}/panels?ep=${ids.episodeId}`;
const cents = (usd: number | null) => (usd === null ? "cost unknown" : usd < 0.01 ? "under 1¢" : `up to $${usd.toFixed(2)}`);
const Chip = ({ ok, children }: { ok: boolean | null; children: React.ReactNode }) => (
  <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${ok === null ? "bg-[var(--s-paper)]" : ok ? "s-active" : "bg-[var(--s-magenta)] text-white"}`}>{children}</span>
);

export function TakeBadge({ take }: { take: PanelTake }) {
  const label = take.status === "dry_run" ? "Dry run · no image" : take.kind === "imported" ? "Imported · made before the gate" : take.kind === "final" ? "Panel take" : "Exploration";
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold text-white ${take.kind === "imported" ? "bg-[var(--s-cobalt)]" : "bg-[var(--s-ink)]"}`}>{label}</span>;
}

// ------------------------------------------------------------------ list

export function PanelGrid({
  ids,
  panels,
  states,
  thumbs,
  selected,
  counts,
}: {
  ids: Ids;
  panels: ScriptPanel[];
  states: Record<string, PanelState>;
  thumbs: Record<string, string | undefined>;
  selected?: string;
  counts: Record<string, { takes: number; findings: number }>;
}) {
  return (
    <form className="mt-4">
      <Hidden {...ids} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {panels.map((p, i) => {
          const s = states[p.panel_key];
          return (
            <li key={p.panel_key} className={`s-card relative p-2 ${selected === p.panel_key ? "border-[var(--s-magenta)]" : ""}`}>
              <label className="absolute left-3 top-3 z-10 grid size-11 place-items-center rounded-lg bg-white/90">
                <input type="checkbox" name="keys" value={p.panel_key} className="size-5" aria-label={`Select panel ${i + 1}`} />
              </label>
              <Link href={`${base(ids)}&panel=${p.panel_key}#panel`} className="block">
                <span className="grid aspect-[3/4] place-items-center overflow-hidden rounded-lg bg-[var(--s-paper)]">
                  {thumbs[p.panel_key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[p.panel_key]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="s-head text-3xl text-[var(--s-line)]">{i + 1}</span>
                  )}
                </span>
                <span className="mt-1 block text-sm font-bold">{i + 1}. {p.title}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <Chip ok={s?.chosen ? true : null}>{s?.chosen ? "Chosen" : `${counts[p.panel_key]?.takes ?? 0} take${counts[p.panel_key]?.takes === 1 ? "" : "s"}`}</Chip>
                  {s?.chosen && <Chip ok={s.lettered}>{s.lettered ? "Lettered" : s.letterStale ? "Re-letter" : "Not lettered"}</Chip>}
                  {s?.oldScript && <Chip ok={false}>Old script</Chip>}
                  {(counts[p.panel_key]?.findings ?? 0) > 0 && <Chip ok={false}>QA {counts[p.panel_key].findings}</Chip>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton formAction={generateSelected} variant="quiet" pendingText="Starting…">Generate one take for each ticked panel</SubmitButton>
        <span className="s-muted text-xs">Each ticked panel needs a passed pre-check on its current prompt. Others are skipped, never changed.</span>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ prompt

export function PromptSection({
  ids,
  panelKey,
  number,
  panel,
  row,
  blocks,
  refs,
  refUrls,
  lessons,
  lint,
  precheckCurrent,
  precheckEstimate,
  takesUsed,
  maxTakes,
  price,
  pending,
  dryRun,
}: {
  ids: Ids;
  panelKey: string;
  number: number;
  panel: ScriptPanel;
  row: PanelRow;
  blocks: Block[];
  refs: { label: string; path: string }[];
  refUrls: Record<string, string>;
  lessons: { id: string; lesson: string }[];
  lint: { errors: string[]; warnings: string[] };
  precheckCurrent: boolean;
  precheckEstimate: number | null;
  takesUsed: number;
  maxTakes: number;
  price: number | null;
  pending: boolean;
  dryRun: boolean;
}) {
  const h = { ...ids, panelKey };
  return (
    <section id="prompt" aria-labelledby="prompt-title" className="mt-4">
      <h3 id="prompt-title" className="s-head text-lg">Prompt</h3>
      <div className="mt-2 rounded-xl bg-[var(--s-paper)] p-3 text-sm">
        <p><strong>Script:</strong> {panel.action || "No visual yet."}</p>
        <p className="s-muted mt-1">
          {panel.size} · {[panel.shot, panel.camera].filter(Boolean).join(", ") || "no shot noted"} · characters: {panel.characters.join(", ") || "none"}
          {panel.clock ? ` · clock ${panel.clock}` : ""}
        </p>
        <Link href={`/studio/projects/${ids.projectId}/script?ep=${ids.episodeId}&panel=${panelKey}`} className="s-link inline-flex min-h-11 items-center">Edit in the script</Link>
      </div>
      <form className="mt-3 flex flex-wrap items-end gap-2">
        <Hidden {...h} />
        <label className="block min-w-0 flex-1 font-bold">
          Expression or eye direction (goes first in the prompt)
          <input name="direction" maxLength={400} defaultValue={row.direction ?? ""} className="s-input mt-1" placeholder="e.g. eyes half-shut, staring at the kettle" key={row.direction ?? ""} />
        </label>
        <SubmitButton formAction={saveDirection} variant="quiet" pendingText="Saving…">Save</SubmitButton>
      </form>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 font-bold">The full prompt ({blocks.length} blocks, {refs.length} reference{refs.length === 1 ? "" : "s"}, {lessons.length} lesson{lessons.length === 1 ? "" : "s"})</summary>
        <ol className="space-y-2 text-sm">
          {blocks.map((b) => (
            <li key={b.name}>
              <span className="text-xs font-bold uppercase">{b.name}</span>
              <p className="whitespace-pre-wrap">{b.text}</p>
            </li>
          ))}
        </ol>
      </details>
      {refs.length > 0 && (
        <div className="mt-2">
          <p className="text-sm font-bold">References sent, in order</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {refs.map((r, i) => (
              <li key={r.path} className="w-24 text-xs">
                {refUrls[r.path] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={refUrls[r.path]} alt="" className="aspect-square w-24 rounded-lg border-2 border-[var(--s-line)] object-cover" />
                )}
                <span className="block">{i + 1}. {r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {lessons.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Lessons applied to this prompt ({lessons.length})</summary>
          <ul className="list-disc pl-5 text-sm">{lessons.map((l) => <li key={l.id}>{l.lesson}</li>)}</ul>
        </details>
      )}
      <div className="mt-3 space-y-1 text-sm">
        {lint.errors.map((e) => <p key={e} role="alert" className="font-bold text-[var(--s-magenta-deep)]">✗ {e}</p>)}
        {lint.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        {!lint.errors.length && <p>✓ Free prompt check passed.</p>}
        {row.precheck && (
          <div className={`rounded-xl border-2 p-3 ${precheckCurrent ? "border-[var(--s-cobalt)]" : "border-[var(--s-line)] opacity-70"}`}>
            <p className="font-bold">
              Claude&rsquo;s pre-check{precheckCurrent ? "" : " (for an older version of this prompt)"}:{row.precheck.ok ? "no problems found" : "issues to read"}
            </p>
            {row.precheck.issues.length > 0 && <ul className="list-disc pl-5">{row.precheck.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
            <p className="s-muted text-xs">{row.precheck.note}</p>
          </div>
        )}
      </div>
      <form className="mt-3 flex flex-wrap gap-2">
        <Hidden {...h} />
        <SubmitButton formAction={runPrecheck} variant="info" pendingText="Checking…" disabled={lint.errors.length > 0}>
          Claude pre-check · {cents(precheckEstimate)}
        </SubmitButton>
        <SubmitButton formAction={generateTake} pendingText="Starting…" disabled={!precheckCurrent || lint.errors.length > 0 || takesUsed >= maxTakes || pending}>
          Generate one take{dryRun ? " (dry run, $0)" : price !== null ? ` · $${price.toFixed(2)}` : ""}
        </SubmitButton>
      </form>
      <p className="s-muted mt-1 text-xs">
        2K panel image, {takesUsed} of {maxTakes} takes used for panel {number}. Generating only ever touches this panel.
        {!precheckCurrent && !lint.errors.length ? " Run the pre-check on this prompt first." : ""}
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ takes

export function TakesSection({
  ids,
  panelKey,
  takes,
  urls,
  chosenId,
  currentScriptHash,
}: {
  ids: Ids;
  panelKey: string;
  takes: PanelTake[];
  urls: Record<string, string>;
  chosenId: string | null;
  currentScriptHash: string;
}) {
  const h = { ...ids, panelKey };
  const chosen = takes.find((x) => x.id === chosenId);
  return (
    <section id="takes" aria-labelledby="takes-title" className="mt-6">
      <h3 id="takes-title" className="s-head text-lg">Takes</h3>
      {takes.length === 0 && <p className="s-muted text-sm">No takes yet.</p>}
      <ul className="mt-2 grid gap-3 md:grid-cols-2">
        {takes.map((t) => {
          const url = t.storage_path ? urls[t.storage_path] : undefined;
          const isChosen = t.id === chosenId;
          return (
            <li key={t.id} className={`rounded-xl border-2 p-3 ${isChosen ? "border-[var(--s-magenta)]" : "border-[var(--s-line)]"} ${t.rejected ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <TakeBadge take={t} />
                {isChosen && <Chip ok>Chosen</Chip>}
                {t.rejected && <Chip ok={false}>Rejected</Chip>}
                {t.script_hash && t.script_hash !== currentScriptHash && <Chip ok={false}>Older script</Chip>}
                {t.parent_take_id && <Chip ok={null}>Fix: {t.change_note}</Chip>}
              </div>
              <div className="mt-2 flex gap-2">
                <div className="grid min-h-40 flex-1 place-items-center overflow-hidden rounded-lg bg-[var(--s-paper)]">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={`Panel take from ${new Date(t.created_at).toLocaleString("en-GB")}`} className="max-h-[28rem] w-full object-contain" />
                  ) : (
                    <span className="s-muted p-4 text-center text-sm">
                      {t.status === "pending" ? "Generating…" : t.status === "failed" ? `Failed: ${t.error ?? "unknown"}` : "Dry run: no image was made."}
                    </span>
                  )}
                </div>
                {chosen && !isChosen && chosen.storage_path && urls[chosen.storage_path] && url && (
                  <div className="w-20 shrink-0 text-center text-xs">
                    {/* Compare each redraw with the best earlier take at thumbnail size. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urls[chosen.storage_path]} alt="The chosen take, for comparison" className="w-20 rounded border-2 border-[var(--s-magenta)]" />
                    <span>chosen</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="mt-1 w-20 rounded border-2 border-[var(--s-line)]" />
                    <span>this one</span>
                  </div>
                )}
              </div>
              <p className="s-muted mt-1 text-xs">
                {t.model ?? "imported"} {t.size ?? ""} {t.aspect ?? ""} · {t.status === "dry_run" ? "$0 (dry run)" : t.kind === "imported" ? "no cost" : `${t.status === "pending" ? "about " : ""}${formatUsd(t.cost_usd)}`} ·{" "}
                {new Date(t.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}
              </p>
              {t.rejected && <p className="text-sm">Rejected: {t.reject_reason}</p>}

              {t.auto_qa && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {t.auto_qa.map((q) => (
                    <li key={q.name}>{q.ok ? "✓" : "⚠"} <strong>{q.name}:</strong> {q.note}</li>
                  ))}
                </ul>
              )}
              {t.lessons_applied.length > 0 && (
                <details className="mt-1 text-xs">
                  <summary className="min-h-11 cursor-pointer py-2 font-bold">Lessons applied ({t.lessons_applied.length})</summary>
                  <ul className="list-disc pl-5">{t.lessons_applied.map((l) => <li key={l.id}>{l.lesson}</li>)}</ul>
                </details>
              )}
              {t.prompt && t.kind !== "imported" && (
                <details className="text-xs">
                  <summary className="min-h-11 cursor-pointer py-2 font-bold">Prompt used</summary>
                  <p className="whitespace-pre-wrap">{t.prompt}</p>
                </details>
              )}

              {t.status === "ready" && t.storage_path && !t.rejected && (
                <>
                  <form className="mt-2 space-y-1" key={JSON.stringify(t.qa_ticks)}>
                    <Hidden {...h} />
                    <input type="hidden" name="take_id" value={t.id} />
                    <p className="text-sm font-bold">Your checklist {t.qa_ticked ? "✓" : "(all must be ticked to choose)"}</p>
                    {QA_TICKS.map((q) => (
                      <label key={q.key} className="flex min-h-11 items-center gap-2 text-sm">
                        <input type="checkbox" name={`tick_${q.key}`} defaultChecked={Boolean(t.qa_ticks?.[q.key])} className="size-5 shrink-0" /> {q.label}
                      </label>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton formAction={saveTicks} variant="quiet" pendingText="Saving…">Save checklist</SubmitButton>
                      {!isChosen && <SubmitButton formAction={chooseTake} pendingText="Choosing…" disabled={!t.qa_ticked}>Choose for this panel</SubmitButton>}
                      <SubmitButton formAction={rerunAutoQa} variant="quiet" pendingText="Checking…">Run free checks</SubmitButton>
                    </div>
                  </form>
                  <form className="mt-2 flex flex-wrap items-end gap-2">
                    <Hidden {...h} />
                    <input type="hidden" name="take_id" value={t.id} />
                    <label className="block min-w-0 flex-1 text-sm font-bold">
                      Fix ONE thing (edit mode, this image as reference 1)
                      <input name="change" maxLength={300} className="s-input mt-1" placeholder="e.g. close his eyes" />
                    </label>
                    <SubmitButton formAction={fixTake} variant="quiet" pendingText="Checking, then starting…">Fix · pre-check + one take</SubmitButton>
                  </form>
                  <form className="mt-2 flex flex-wrap items-end gap-2">
                    <Hidden {...h} />
                    <input type="hidden" name="take_id" value={t.id} />
                    <label className="block min-w-0 flex-1 text-sm font-bold">
                      Reject, and why (becomes a proposed lesson)
                      <input name="reason" maxLength={400} className="s-input mt-1" placeholder="e.g. an extra Mallow appeared in the doorway" />
                    </label>
                    <SubmitButton formAction={rejectTake} variant="quiet" pendingText="…">Reject</SubmitButton>
                  </form>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ lettering

export function LetterSection({
  ids,
  panelKey,
  layout,
  state,
  letteredUrl,
  compareUrl,
  canLetter,
}: {
  ids: Ids;
  panelKey: string;
  layout: LetterEl[];
  state: PanelState;
  letteredUrl?: string;
  compareUrl?: string;
  canLetter: boolean;
}) {
  const h = { ...ids, panelKey };
  return (
    <section id="letter" aria-labelledby="letter-title" className="mt-6">
      <h3 id="letter-title" className="s-head text-lg">Lettering (in code, free)</h3>
      <p className="s-muted text-sm">Positions are at 1600px wide. Blank caption or balloon text uses the script, so wording changes re-letter in seconds. Captions in Patrick Hand, speech in Comic Relief, notes and labels in Kalam.</p>
      {state.letterStale && <p role="alert" className="mt-2 font-bold text-[var(--s-magenta-deep)]">The image, layout or script text changed since this was lettered. Letter it again.</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <figure>
          <figcaption className="text-sm font-bold">Lettered now</figcaption>
          {letteredUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={letteredUrl} alt="The lettered panel" className="mt-1 w-full rounded-lg border-2 border-[var(--s-line)]" />
          ) : (
            <p className="s-muted mt-1 text-sm">Not lettered yet.</p>
          )}
        </figure>
        {compareUrl && (
          <figure>
            <figcaption className="text-sm font-bold">Test pack (the old lettered panel)</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={compareUrl} alt="The old lettered panel from the test pack" className="mt-1 w-full rounded-lg border-2 border-[var(--s-line)]" />
          </figure>
        )}
      </div>
      <form className="mt-3 space-y-3" key={JSON.stringify(layout)}>
        <Hidden {...h} />
        <input type="hidden" name="el_count" value={layout.length} />
        {layout.map((el, i) => (
          <fieldset key={i} className="rounded-xl border-2 border-[var(--s-line)] p-3">
            <legend className="px-1 font-bold">{i + 1}. {LETTER_LABEL[el.kind]}</legend>
            <input type="hidden" name={`el_${i}_kind`} value={el.kind} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LETTER_FIELDS[el.kind].map(([name, type, label]) => {
                const v = (el as Record<string, unknown>)[name];
                const id = `el_${i}_${name}`;
                if (type === "b") {
                  return (
                    <label key={name} className="flex min-h-11 items-center gap-2 text-sm font-bold">
                      <input type="checkbox" id={id} name={id} defaultChecked={Boolean(v)} className="size-5" /> {label}
                    </label>
                  );
                }
                return (
                  <label key={name} className={`block text-xs font-bold ${type === "n" ? "" : "col-span-2 sm:col-span-4"}`}>
                    {label}
                    {type === "l" ? (
                      <textarea id={id} name={id} rows={3} defaultValue={String(v ?? "")} className="s-input mt-1" />
                    ) : (
                      <input id={id} name={id} type={type === "n" ? "number" : "text"} defaultValue={String(v ?? "")} className="s-input mt-1" />
                    )}
                  </label>
                );
              })}
            </div>
            <label className="mt-1 flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name={`el_${i}_remove`} className="size-5" /> Remove this element
            </label>
          </fieldset>
        ))}
        <label className="block max-w-xs text-sm font-bold">
          Add an element when saving
          <select name="add_kind" defaultValue="" className="s-input mt-1">
            <option value="">—</option>
            {(Object.keys(LETTER_LABEL) as LetterKind[]).map((k) => <option key={k} value={k}>{LETTER_LABEL[k]}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <SubmitButton formAction={saveLayout} variant="quiet" pendingText="Saving…">Save layout</SubmitButton>
          <SubmitButton formAction={letterThisPanel} pendingText="Lettering…" disabled={!canLetter}>Letter this panel</SubmitButton>
          <SubmitButton formAction={resetLayout} variant="quiet" pendingText="…">Rebuild from script</SubmitButton>
        </div>
        {!canLetter && <p className="s-muted text-sm">Choose an image for this panel first.</p>}
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ vision QA

export function QaSection({
  ids,
  panelKey,
  row,
  estimate,
  canRun,
}: {
  ids: Ids;
  panelKey: string;
  row: PanelRow;
  estimate: number | null;
  canRun: boolean;
}) {
  const h = { ...ids, panelKey };
  const outdated = row.qa && row.qa_lettered_path !== row.lettered_path;
  return (
    <section id="qa" aria-labelledby="qa-title" className="mt-6">
      <h3 id="qa-title" className="s-head text-lg">Claude&rsquo;s QA</h3>
      <p className="s-muted text-sm">Claude looks at the lettered panel against the script, the character locks and the active lessons. It lists problems; it never fixes them.</p>
      {row.qa && (
        <div className={`mt-2 rounded-xl border-2 p-3 ${outdated ? "border-[var(--s-line)] opacity-70" : "border-[var(--s-cobalt)]"}`}>
          <p className="font-bold">{outdated ? "(For an older lettering) " : ""}{row.qa.summary}</p>
          {row.qa.findings.length === 0 && <p className="text-sm">No problems found.</p>}
          <ul className="mt-2 space-y-2">
            {row.qa.findings.map((f, i) => (
              <li key={i} className="text-sm">
                <Chip ok={f.severity === "low" ? null : false}>{f.severity}</Chip> <strong>{f.kind.replace(/_/g, " ")}:</strong> {f.note}
                <form className="mt-1 flex flex-wrap items-center gap-2">
                  <Hidden {...h} />
                  <input type="hidden" name="finding" value={i} />
                  <span className="s-muted text-xs">Lesson: {f.lesson}</span>
                  <SubmitButton formAction={proposeLessonFromFinding} variant="quiet" pendingText="…">Propose as lesson</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
          <p className="s-muted mt-1 text-xs">{row.qa.model} · {row.qa.cost} · {row.qa_at ? new Date(row.qa_at).toLocaleString("en-GB", { timeZone: "Europe/London" }) : ""}</p>
        </div>
      )}
      <form className="mt-2">
        <Hidden {...h} />
        <SubmitButton formAction={runVisionQa} variant="info" pendingText="Claude is looking…" disabled={!canRun}>
          {row.qa ? "Run QA again" : "Run Claude's QA"} · {cents(estimate)}
        </SubmitButton>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ gate

export function PanelsGate({
  ids,
  gate,
  changed,
  problems,
  imported,
}: {
  ids: Ids;
  gate: { state: string; approved_at: string | null; note: string | null } | null;
  changed: boolean;
  problems: string[];
  imported: number;
}) {
  const approved = gate?.state === "approved" && !changed;
  return (
    <section id="gate" aria-labelledby="gate-title" className="s-card mt-6 p-5">
      <h2 id="gate-title" className="s-head text-lg">Gate: Panels approved</h2>
      <p className="s-muted text-sm">Only you can press this. Every panel needs a chosen image, drawn from the current script, lettered with the current layout.</p>
      {approved && (
        <div className="s-active mt-3 rounded-xl p-3">
          <p className="font-bold">✓ Panels approved {gate.approved_at ? new Date(gate.approved_at).toLocaleString("en-GB", { timeZone: "Europe/London" }) : ""}</p>
          {gate.note && <p className="text-sm">{gate.note}</p>}
        </div>
      )}
      {(gate?.state === "stale" || (gate?.state === "approved" && changed)) && (
        <p role="alert" className="mt-3 rounded-xl border-2 border-[var(--s-magenta)] bg-white p-3 font-bold text-[var(--s-magenta-deep)]">Something changed after approval. Check and re-approve.</p>
      )}
      {!approved && (
        <>
          <ul className="mt-3 space-y-1 text-sm">
            <li>✓ Asset designs approved</li>
            {problems.length === 0 ? <li>✓ Every panel chosen and lettered</li> : problems.slice(0, 8).map((p) => <li key={p}>✗ {p}</li>)}
            {problems.length > 8 && <li>…and {problems.length - 8} more</li>}
            {imported > 0 && <li>⚠ {imported} panel(s) use imported art made before the gates (a note is required)</li>}
          </ul>
          <form action={approvePanels} className="mt-3 space-y-2">
            <Hidden {...ids} />
            <label htmlFor="gate-note" className="block font-bold">Note {imported ? "(required)" : "(optional)"}</label>
            <input id="gate-note" name="note" maxLength={500} className="s-input" />
            <SubmitButton pendingText="Approving…" disabled={problems.length > 0}>Approve panels</SubmitButton>
          </form>
        </>
      )}
      {gate?.state === "approved" && (
        <form action={reopenPanels} className="mt-3 space-y-2">
          <Hidden {...ids} />
          <label htmlFor="reopen-note" className="block text-sm font-bold">Reopen to make changes (optional note)</label>
          <input id="reopen-note" name="note" maxLength={500} className="s-input" />
          <SubmitButton variant="quiet" pendingText="…">Reopen</SubmitButton>
        </form>
      )}
    </section>
  );
}
