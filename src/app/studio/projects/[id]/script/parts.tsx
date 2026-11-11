import Link from "next/link";
import {
  addPanel,
  approveScript,
  deletePanel,
  movePanelDown,
  movePanelUp,
  reopenScript,
  restoreVersion,
  saveFork,
  savePanel,
  saveProps,
  startNewVersion,
} from "../script-actions";
import { SubmitButton } from "@/components/studio/ui";
import { wordCount, MAX_CAPTION_WORDS } from "@/lib/studio/script/checks";
import type { PanelDiff } from "@/lib/studio/script/diff";
import type { ScriptGate } from "@/lib/studio/script/script";
import { CHECKS, type CheckResult, type Fork, type FreeIssue, type Prop, type ScriptPanel, type ScriptVersion } from "@/lib/studio/script/types";

const input = "s-input mt-1";
type Ids = { projectId: string; episodeId: string };
const Hidden = ({ projectId, episodeId }: Ids) => (
  <>
    <input type="hidden" name="project_id" value={projectId} />
    <input type="hidden" name="episode_id" value={episodeId} />
  </>
);
const base = (ids: Ids) => `/studio/projects/${ids.projectId}/script?ep=${ids.episodeId}`;

// ------------------------------------------------------------------ versions

export function VersionBar({ ids, versions, compareId }: { ids: Ids; versions: ScriptVersion[]; compareId?: string }) {
  const cur = versions[0];
  return (
    <div className="s-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="s-head text-lg">v{cur?.version ?? 1}</span> <span className="s-muted text-sm">working copy · {cur?.changelog}</span>
        </p>
        <form className="flex flex-wrap items-center gap-2">
          <Hidden {...ids} />
          <label htmlFor="changelog" className="sr-only">Changelog for the new version</label>
          <input id="changelog" name="changelog" maxLength={300} placeholder="What changes in the new version?" className="s-input w-64" />
          <SubmitButton formAction={startNewVersion} variant="quiet" pendingText="…">Start v{(cur?.version ?? 1) + 1}</SubmitButton>
        </form>
      </div>
      {versions.length > 1 && (
        <details className="mt-2" open={Boolean(compareId)}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">History ({versions.length} versions)</summary>
          <ul className="space-y-2 text-sm">
            {versions.slice(1).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-bold">v{v.version}</span>
                <span className="s-muted">{v.changelog}</span>
                <Link href={`${base(ids)}&compare=${v.id}#diff`} className="s-link inline-flex min-h-11 items-center">
                  {compareId === v.id ? "Comparing" : `Compare with v${cur.version}`}
                </Link>
                <form>
                  <Hidden {...ids} />
                  <input type="hidden" name="script_id" value={v.id} />
                  <SubmitButton formAction={restoreVersion} variant="quiet" pendingText="…">Restore as v{cur.version + 1}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function DiffView({ ids, diffs, from, to }: { ids: Ids; diffs: PanelDiff[]; from: number; to: number }) {
  return (
    <section id="diff" className="s-card mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="s-head text-lg">Changes from v{from} to v{to}</h2>
        <Link href={base(ids)} className="s-link inline-flex min-h-11 items-center text-sm">Close</Link>
      </div>
      {diffs.length === 0 ? (
        <p className="s-muted mt-2">No differences in the panels.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {diffs.map((d) => (
            <li key={d.key} className="rounded-lg border-2 border-[var(--s-line)] p-2">
              {d.kind === "added" && <p><span className="s-active rounded px-1 font-bold">Added</span> panel {d.to}: {d.title}</p>}
              {d.kind === "removed" && <p><span className="rounded bg-[var(--s-magenta)] px-1 font-bold text-white">Removed</span> panel {d.from}: {d.title}</p>}
              {d.kind === "changed" && (
                <>
                  <p className="font-bold">
                    Panel {d.to}: {d.title} {d.from !== d.to && <span className="s-muted font-normal">(was panel {d.from})</span>}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {d.fields.map((f) => (
                      <li key={f.field}>
                        <span className="font-bold">{f.field}:</span> <del className="s-muted">{f.before}</del> → <ins className="no-underline">{f.after}</ins>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ panel list and editor

export function PanelList({ ids, panels, selected, issues }: { ids: Ids; panels: ScriptPanel[]; selected?: string; issues: FreeIssue[] }) {
  return (
    <section aria-labelledby="panels-title" className="s-card mt-4 p-4">
      <h2 id="panels-title" className="s-head text-lg">Panels ({panels.length})</h2>
      {panels.length === 0 ? (
        <p className="s-muted mt-1">No panels yet. Let Claude draft the script (right) or add one.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {panels.map((p, i) => {
            const words = wordCount(p.caption);
            const n = issues.filter((x) => x.panel === i + 1).length;
            return (
              <li key={p.panel_key}>
                <Link
                  href={`${base(ids)}&panel=${p.panel_key}`}
                  aria-current={p.panel_key === selected ? "true" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-1 ${p.panel_key === selected ? "bg-[var(--s-ink)] text-white" : "hover:bg-[var(--s-paper)]"}`}
                >
                  <span className="w-6 shrink-0 text-right font-bold">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
                  <span className="shrink-0 text-xs opacity-75">{p.size}</span>
                  {p.caption && <span className={`shrink-0 text-xs ${words > MAX_CAPTION_WORDS ? "font-bold text-[var(--s-magenta)]" : "opacity-75"}`}>{words}w</span>}
                  {n > 0 && <span className="shrink-0 rounded bg-[#FFF3C4] px-1.5 text-xs font-bold text-[var(--s-ink)]">⚠ {n}</span>}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <form className="mt-3">
        <Hidden {...ids} />
        <SubmitButton formAction={addPanel} variant="quiet" pendingText="…">＋ Add panel at the end</SubmitButton>
      </form>
    </section>
  );
}

export function PanelEditor({ ids, panel, index, panels, characters }: { ids: Ids; panel: ScriptPanel; index: number; panels: ScriptPanel[]; characters: string[] }) {
  const words = wordCount(panel.caption);
  return (
    <section aria-labelledby="panel-edit" className="s-card mt-4 border-[var(--s-ink)] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="panel-edit" className="s-head text-xl">Panel {index + 1}: {panel.title || "Untitled"}</h2>
        <Link href={base(ids)} className="s-link inline-flex min-h-11 items-center text-sm">Close</Link>
      </div>
      <form action={savePanel} className="mt-3 space-y-3" key={JSON.stringify(panel)}>
        <Hidden {...ids} />
        <input type="hidden" name="panel_key" value={panel.panel_key} />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <label htmlFor="p-title" className="block font-bold">Title</label>
            <input id="p-title" name="title" defaultValue={panel.title} maxLength={120} className={input} />
          </div>
          <div>
            <label htmlFor="p-shot" className="block font-bold">Shot</label>
            <input id="p-shot" name="shot" defaultValue={panel.shot ?? ""} maxLength={120} className={input} placeholder="exterior, establishing" />
          </div>
          <div>
            <label htmlFor="p-camera" className="block font-bold">Camera</label>
            <input id="p-camera" name="camera" defaultValue={panel.camera ?? ""} maxLength={120} className={input} placeholder="wide, low angle…" />
          </div>
        </div>
        <div>
          <label htmlFor="p-action" className="block font-bold">Visual (what's drawn)</label>
          <textarea id="p-action" name="action" rows={4} defaultValue={panel.action ?? ""} maxLength={2000} className={input} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="p-caption" className="block font-bold">
              Caption <span className={`text-sm ${words > MAX_CAPTION_WORDS ? "text-[var(--s-magenta-deep)]" : "s-muted"}`}>({words}/{MAX_CAPTION_WORDS} words)</span>
            </label>
            <input id="p-caption" name="caption" defaultValue={panel.caption ?? ""} maxLength={200} className={input} />
          </div>
          <div>
            <label htmlFor="p-chars" className="block font-bold">Characters</label>
            <input id="p-chars" name="characters" defaultValue={panel.characters.join(", ")} className={input} placeholder={characters.join(", ")} />
          </div>
        </div>
        <div>
          <label htmlFor="p-dialogue" className="block font-bold">Dialogue</label>
          <p className="s-muted text-xs">One line each: &ldquo;Speaker: words&rdquo;. Keep within each character&rsquo;s voice guardrails.</p>
          <textarea id="p-dialogue" name="dialogue" rows={2} defaultValue={panel.dialogue.map((d) => (d.speaker ? `${d.speaker}: ${d.line}` : d.line)).join("\n")} className={input} />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label htmlFor="p-size" className="block font-bold">Size</label>
            <select id="p-size" name="size" defaultValue={panel.size} className={input}>
              <option value="small">Small</option>
              <option value="mid">Mid</option>
              <option value="tall">Tall</option>
            </select>
          </div>
          <div>
            <label htmlFor="p-gap" className="block font-bold">Gap after (px)</label>
            <input id="p-gap" name="gap_after" type="number" min={0} max={5000} inputMode="numeric" defaultValue={panel.gap_after} className={input} />
          </div>
          <div>
            <label htmlFor="p-clock" className="block font-bold">Clock time</label>
            <input id="p-clock" name="clock" defaultValue={panel.clock ?? ""} maxLength={20} className={input} placeholder="6:43" />
          </div>
          <div>
            <label htmlFor="p-matches" className="block font-bold">Matches panel</label>
            <select id="p-matches" name="matches_key" defaultValue={panel.matches_key ?? ""} className={input}>
              <option value="">None</option>
              {panels.slice(0, index).map((p, i) => (
                <option key={p.panel_key} value={p.panel_key}>{i + 1}. {p.title}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="p-props" className="block font-bold">Props</label>
            <p className="s-muted text-xs">One per line: &ldquo;name / where / state&rdquo;.</p>
            <textarea id="p-props" name="props" rows={3} defaultValue={panel.props.map((x) => [x.name, x.location, x.state].filter((v) => v !== undefined).join(" / ")).join("\n")} className={input} />
          </div>
          <div>
            <label htmlFor="p-text" className="block font-bold">Text in the art</label>
            <p className="s-muted text-xs">One per line: &ldquo;text | lettered&rdquo; or &ldquo;text | model&rdquo; (model only for short prop labels).</p>
            <textarea id="p-text" name="text_items" rows={3} defaultValue={panel.text_items.map((x) => `${x.text} | ${x.how}`).join("\n")} className={input} />
          </div>
        </div>
        <div>
          <label htmlFor="p-notes" className="block font-bold">Notes for the artist</label>
          <textarea id="p-notes" name="notes" rows={2} defaultValue={panel.notes ?? ""} maxLength={1000} className={input} />
        </div>
        <SubmitButton pendingText="Saving…">Save panel</SubmitButton>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--s-line)] pt-4">
        <form className="flex flex-wrap gap-2">
          <Hidden {...ids} />
          <input type="hidden" name="panel_key" value={panel.panel_key} />
          <input type="hidden" name="after_key" value={panel.panel_key} />
          <SubmitButton formAction={movePanelUp} variant="quiet" pendingText="…" disabled={index === 0}>↑ Up</SubmitButton>
          <SubmitButton formAction={movePanelDown} variant="quiet" pendingText="…" disabled={index === panels.length - 1}>↓ Down</SubmitButton>
          <SubmitButton formAction={addPanel} variant="quiet" pendingText="…">＋ Add panel after</SubmitButton>
        </form>
        <form action={deletePanel} className="flex flex-wrap items-center gap-2">
          <Hidden {...ids} />
          <input type="hidden" name="panel_key" value={panel.panel_key} />
          <label htmlFor="p-del" className="sr-only">Type delete to confirm</label>
          <input id="p-del" name="confirm" placeholder="type delete" autoComplete="off" autoCapitalize="none" className="s-input w-32" />
          <SubmitButton variant="quiet" pendingText="…">Delete panel</SubmitButton>
        </form>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ end card and props

export function EndCardEditor({ ids, fork }: { ids: Ids; fork: Fork | null }) {
  return (
    <section id="endcard" aria-labelledby="endcard-title" className="s-card mt-4 p-5">
      <h2 id="endcard-title" className="s-head text-lg">End card: the vote</h2>
      <p className="s-muted text-sm">
        A scoped question, a backup pick (used if turnout is too low, still narrated as &ldquo;You chose…&rdquo;), and 2 or 3 branches that each
        rejoin the next milestone. The card always says: <strong>&ldquo;Comments steer the route, not the destination.&rdquo;</strong>
      </p>
      <form action={saveFork} className="mt-3 space-y-3" key={JSON.stringify(fork)}>
        <Hidden {...ids} />
        <div>
          <label htmlFor="f-q" className="block font-bold">Question</label>
          <input id="f-q" name="question" defaultValue={fork?.question ?? ""} maxLength={300} className={input} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="f-in" className="block font-bold">In bounds</label>
            <textarea id="f-in" name="in_bounds" rows={2} defaultValue={fork?.in_bounds ?? ""} maxLength={500} className={input} />
          </div>
          <div>
            <label htmlFor="f-lock" className="block font-bold">Locked</label>
            <textarea id="f-lock" name="locked" rows={2} defaultValue={fork?.locked ?? ""} maxLength={500} className={input} />
          </div>
        </div>
        <div>
          <label htmlFor="f-backup" className="block font-bold">Backup pick</label>
          <input id="f-backup" name="backup_pick" defaultValue={fork?.backup_pick ?? ""} maxLength={500} className={input} />
        </div>
        <div>
          <label htmlFor="f-br" className="block font-bold">Branches (2 or 3)</label>
          <p className="s-muted text-xs">One per line: &ldquo;title | what happens | milestone it rejoins&rdquo;.</p>
          <textarea id="f-br" name="branches" rows={3} defaultValue={(fork?.branches ?? []).map((b) => `${b.title} | ${b.summary} | ${b.rejoins}`).join("\n")} className={input} />
        </div>
        <SubmitButton pendingText="Saving…">Save end card</SubmitButton>
      </form>
    </section>
  );
}

export function PropTable({ ids, props }: { ids: Ids; props: Prop[] }) {
  return (
    <section id="props" aria-labelledby="props-title" className="s-card mt-4 p-5">
      <h2 id="props-title" className="s-head text-lg">Prop table ({props.length})</h2>
      <p className="s-muted text-sm">Every story prop: who owns it and its rule (where it lives, how it works, exact label text). Shared by all episodes.</p>
      <form action={saveProps} className="mt-3 space-y-3" key={JSON.stringify(props)}>
        <Hidden {...ids} />
        <label htmlFor="prop-table" className="sr-only">Prop table, one per line</label>
        <textarea
          id="prop-table"
          name="prop_table"
          rows={Math.max(4, props.length + 1)}
          defaultValue={props.map((p) => `${p.name} | ${p.owner ?? ""} | ${p.rule ?? ""}`).join("\n")}
          className="s-input font-mono text-sm"
          placeholder="name | owner | rule"
        />
        <SubmitButton pendingText="Saving…">Save prop table</SubmitButton>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ checks and gate

export function ChecksSection({ issues, check, stale }: { issues: FreeIssue[]; check: CheckResult | null; stale: boolean }) {
  const label = new Map<string, string>(CHECKS.map((c) => [c.key, c.label]));
  return (
    <section id="check" aria-labelledby="check-title" className="s-card mt-4 p-5">
      <h2 id="check-title" className="s-head text-lg">Checks</h2>
      <h3 className="mt-3 font-bold">Free checks (run in code, always up to date)</h3>
      {issues.length === 0 ? (
        <p className="s-muted text-sm">✓ No problems: captions, sound effects, clocks, matched panels, props and the end card all look fine.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {issues.map((x, i) => (
            <li key={i}>
              <span className="rounded bg-[#FFF3C4] px-1.5 text-xs font-bold">{x.panel ? `Panel ${x.panel}` : "Episode"}</span> {x.message}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 font-bold">Claude&rsquo;s script check</h3>
      {!check ? (
        <p className="s-muted text-sm">{stale ? "The script changed since the last check, so it needs running again." : "Not run on this version yet."} Use the button on the right.</p>
      ) : (
        <>
          <p className="mt-1 text-sm">{check.summary}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {check.items.map((x) => (
              <li key={x.key} className="flex gap-2">
                <span
                  className={`mt-0.5 w-12 shrink-0 rounded px-1 text-center text-xs font-bold ${
                    x.status === "pass" ? "s-active" : x.status === "fail" ? "bg-[var(--s-magenta)] text-white" : "border border-[var(--s-line)]"
                  }`}
                >
                  {x.status === "na" ? "n/a" : x.status}
                </span>
                <span>
                  <span className="font-bold">{label.get(x.key)}</span>
                  {x.panels.length > 0 && <span className="s-muted"> · panel{x.panels.length > 1 ? "s" : ""} {x.panels.join(", ")}</span>}
                  <span className="block">{x.note}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="s-muted mt-2 text-xs">Claude never changes the script. Fix what you agree with, then run the check again.</p>
        </>
      )}
    </section>
  );
}

export function GateSection({
  ids,
  gate,
  storyApproved,
  currentVersion,
  checked,
  openProblems,
}: {
  ids: Ids;
  gate: ScriptGate | null;
  storyApproved: boolean;
  currentVersion: number;
  checked: boolean;
  openProblems: number;
}) {
  return (
    <section id="gate" aria-labelledby="gate-title" className="s-card mt-4 p-5">
      <h2 id="gate-title" className="s-head text-lg">Gate: Script final</h2>
      <p className="s-muted text-sm">Only you can press this. No panel images are generated for this episode until it&rsquo;s pressed. Any later script or story change reopens it.</p>
      {gate?.state === "approved" && (
        <div className="s-active mt-3 rounded-xl p-3">
          <p className="font-bold">✓ Script final {gate.approved_at ? new Date(gate.approved_at).toLocaleString("en-GB", { timeZone: "Europe/London" }) : ""}</p>
          {gate.note && <p className="text-sm">{gate.note}</p>}
        </div>
      )}
      {gate?.state === "stale" && (
        <p role="alert" className="mt-3 rounded-xl border-2 border-[var(--s-magenta)] bg-white p-3 font-bold text-[var(--s-magenta-deep)]">
          The script or story changed after approval. Check it again and re-approve.
        </p>
      )}
      {gate?.state !== "approved" && (
        <>
          <ul className="mt-3 space-y-1 text-sm">
            <li>{storyApproved ? "✓" : "✗"} Story approved</li>
            <li>{checked ? "✓" : "✗"} Claude&rsquo;s check run on v{currentVersion}</li>
            <li>{openProblems === 0 ? "✓ No open problems" : `⚠ ${openProblems} open problem${openProblems === 1 ? "" : "s"} (you can still approve with a note)`}</li>
          </ul>
          <form action={approveScript} className="mt-3 space-y-2">
            <Hidden {...ids} />
            <label htmlFor="gate-note" className="block font-bold">Note {openProblems ? "(required: why you're approving anyway)" : "(optional)"}</label>
            <input id="gate-note" name="note" maxLength={500} className="s-input" />
            <SubmitButton pendingText="Approving…" disabled={!storyApproved || !checked}>Approve v{currentVersion} as Script final</SubmitButton>
          </form>
        </>
      )}
      {gate?.state === "approved" && (
        <form action={reopenScript} className="mt-3 space-y-2">
          <Hidden {...ids} />
          <label htmlFor="reopen-note" className="block text-sm font-bold">Reopen to make changes (optional note)</label>
          <input id="reopen-note" name="note" maxLength={500} className="s-input" />
          <SubmitButton variant="quiet" pendingText="…">Reopen</SubmitButton>
        </form>
      )}
    </section>
  );
}
