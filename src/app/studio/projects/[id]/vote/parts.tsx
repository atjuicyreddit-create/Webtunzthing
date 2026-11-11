import Link from "next/link";
import { chooseBackup, chooseComment, linkSource, reopenDecision, saveRowEdit, unlinkSource } from "../vote-actions";
import { SubmitButton } from "@/components/studio/ui";
import type { LiveEpisode } from "@/lib/studio/vote/load";
import { BREAK_LABEL, NONE_FITS, type ForkSnapshot, type Prepared, type ReaderRoute, type Round, type VoteComment } from "@/lib/studio/vote/types";

type Ids = { projectId: string; episodeId: string };

const Hidden = ({ ids }: { ids: Ids }) => (
  <>
    <input type="hidden" name="project_id" value={ids.projectId} />
    <input type="hidden" name="episode_id" value={ids.episodeId} />
  </>
);

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—";

const VERDICT: Record<string, { label: string; cls: string }> = {
  pass: { label: "Passes", cls: "s-active" },
  near: { label: "Nearly passes", cls: "bg-[#FFF3C4]" },
  veto: { label: "Vetoed", cls: "bg-[var(--s-magenta)] text-white" },
};
const SKIP: Record<string, string> = { empty: "Empty", duplicate: "Duplicate of an earlier comment", over_cap: "Over the screening cap" };
const FLAG: Record<string, string> = { short: "Very short", link: "Has a link" };

// ------------------------------------------------------------------ source (read-only link)

export function SourceSection({ ids, live, choices, voteOpen }: { ids: Ids; live: LiveEpisode | null; choices: LiveEpisode[]; voteOpen: boolean }) {
  return (
    <section aria-labelledby="source-title" className="s-card mt-4 p-4">
      <h2 id="source-title" className="s-head text-lg">Comments from</h2>
      <p className="s-muted text-sm">Read-only. Nothing on the live site is changed: comments, episodes and series are only read.</p>
      {live ? (
        <form className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <Hidden ids={ids} />
          <p>
            <strong>{live.series?.title ?? "Unknown series"}</strong>, episode {live.number}: {live.title}{" "}
            <span className="s-muted text-sm">({live.status})</span>
            {live.vote_closes_at && <span className="block text-sm">Vote closes {when(live.vote_closes_at)}</span>}
          </p>
          <SubmitButton formAction={unlinkSource} variant="quiet" pendingText="…">Unlink</SubmitButton>
          {voteOpen && <p className="w-full rounded-lg bg-[#FFF3C4] p-2 text-sm font-semibold">⚠ The vote is still open: more comments may come in.</p>}
        </form>
      ) : (
        <form className="mt-2 flex flex-wrap items-end gap-2">
          <Hidden ids={ids} />
          <label className="block min-w-0 flex-1 text-sm font-bold">
            Live episode
            <select name="source_episode_id" required className="s-input mt-1" defaultValue="">
              <option value="" disabled>Pick an episode…</option>
              {choices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.series?.title ?? "?"}: episode {e.number}, {e.title} ({e.status})
                </option>
              ))}
            </select>
          </label>
          <SubmitButton formAction={linkSource} variant="quiet" pendingText="Linking…">Read its comments</SubmitButton>
        </form>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ vote card

export function ForkCard({ projectId, episodeId, fork }: { projectId: string; episodeId: string; fork: ForkSnapshot | null }) {
  return (
    <section aria-labelledby="fork-title" className="s-card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fork-title" className="s-head text-lg">The vote card</h2>
        <Link href={`/studio/projects/${projectId}/script?ep=${episodeId}#endcard`} className="s-link text-sm">Edit on the Script page</Link>
      </div>
      {!fork ? (
        <p className="s-muted mt-1">No end card yet.</p>
      ) : (
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="font-bold">Question</dt><dd>{fork.question || "—"}</dd>
          <dt className="font-bold">In bounds</dt><dd>{fork.in_bounds || "—"}</dd>
          <dt className="font-bold">Locked</dt><dd>{fork.locked || "—"}</dd>
          <dt className="font-bold">Backup pick</dt><dd>{fork.backup_pick || "—"}</dd>
          <dt className="font-bold">Branches</dt>
          <dd>
            {fork.branches.length ? (
              <ul className="list-disc pl-5">{fork.branches.map((b) => <li key={b.title}><strong>{b.title}</strong>: {b.summary} <span className="s-muted">(rejoins {b.rejoins || "?"})</span></li>)}</ul>
            ) : "—"}
          </dd>
        </dl>
      )}
      <p className="mt-2 text-sm font-bold">Comments steer the route, not the destination.</p>
    </section>
  );
}

// ------------------------------------------------------------------ live comments (free checks)

export function LiveComments({ prepared, min, max }: { prepared: Prepared[]; min: number; max: number }) {
  const valid = prepared.filter((p) => p.skipped === null || p.skipped === "over_cap").length;
  return (
    <section aria-labelledby="live-title" className="s-card mt-4 p-4">
      <h2 id="live-title" className="s-head text-lg">Live comments ({prepared.length})</h2>
      <p className="s-muted text-sm">
        Free checks, no AI: empty comments and duplicates are skipped, and at most {max} go to Claude. {valid} valid
        {valid < min ? `, fewer than ${min}: the backup pick is offered below.` : "."}
      </p>
      {prepared.length === 0 && <p className="mt-2">No comments yet.</p>}
      <ul className="mt-2 space-y-2">
        {prepared.map((p) => (
          <li key={p.id} className={`rounded-lg border-2 border-[var(--s-line)] p-2 text-sm ${p.skipped && p.skipped !== "over_cap" ? "opacity-60" : ""}`}>
            <p className="s-muted text-xs">{p.author_name ?? "Reader"} · {when(p.created_at)}{p.n ? ` · #${p.n}` : ""}</p>
            <p className="break-words">{p.body}</p>
            {(p.skipped || p.flags.length > 0) && (
              <p className="mt-1 text-xs font-bold">{[p.skipped ? SKIP[p.skipped] : null, ...p.flags.map((f) => FLAG[f])].filter(Boolean).join(" · ")}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ verdicts and choosing

function BranchSelect({ fork, value }: { fork: ForkSnapshot; value: string | null }) {
  return (
    <label className="block text-sm font-bold">
      Branch
      <select name="branch" defaultValue={value && fork.branches.some((b) => b.title === value) ? value : ""} className="s-input mt-1">
        <option value="">{NONE_FITS}</option>
        {fork.branches.map((b) => <option key={b.title} value={b.title}>{b.title} (rejoins {b.rejoins || "?"})</option>)}
      </select>
    </label>
  );
}

export function Verdicts({ ids, round, rows, decided }: { ids: Ids; round: Round; rows: VoteComment[]; decided: boolean }) {
  const screened = rows.filter((r) => r.verdict);
  const skipped = rows.filter((r) => !r.verdict);
  return (
    <section id="verdicts" aria-labelledby="verdicts-title" className="mt-6">
      <h2 id="verdicts-title" className="s-head text-2xl">Claude&rsquo;s verdicts</h2>
      <p className="s-muted text-sm">Screened {when(round.screened_at)}. Suggestions only: you choose. Best story fit first.</p>
      {round.summary && <p className="s-card mt-2 p-3">{round.summary}</p>}
      <ul className="mt-3 space-y-3">
        {screened.map((r) => {
          const v = VERDICT[r.verdict!];
          const chosen = round.decision?.kind === "comment" && round.decision.vote_comment_id === r.id;
          return (
            <li key={r.id} id={`c-${r.id}`} className={`s-card p-4 ${chosen ? "ring-4 ring-[var(--s-volt)]" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${v.cls}`}>{v.label}</span>
                {r.unsafe && <span className="rounded-md bg-[var(--s-ink)] px-2 py-0.5 text-xs font-bold text-white">Unsafe: can&rsquo;t be chosen</span>}
                {r.suggested_rank && <span className="s-muted text-xs font-bold">Suggested #{r.suggested_rank}</span>}
                {chosen && <span className="s-active rounded-md px-2 py-0.5 text-xs font-bold">Chosen</span>}
                <span className="s-muted text-xs">{r.author_name ?? "Reader"} · {when(r.posted_at)}</span>
              </div>
              <blockquote className="mt-2 break-words border-l-4 border-[var(--s-line)] pl-3">{r.body}</blockquote>
              <p className="mt-2 text-sm"><strong>Why:</strong> {r.reason}</p>
              {r.breaks.length > 0 && <p className="text-sm"><strong>Rules involved:</strong> {r.breaks.map((b) => BREAK_LABEL[b] ?? b).join(", ")}</p>}
              {r.adjusted && <p className="mt-1 text-sm"><strong>Adjusted to fit:</strong> {r.adjusted}</p>}
              <p className="text-sm"><strong>Nearest branch:</strong> {r.branch ?? NONE_FITS}</p>
              {!decided && !r.unsafe && (
                <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-bold">Edit and choose</summary>
                  <form className="grid gap-2">
                    <Hidden ids={ids} />
                    <input type="hidden" name="vote_comment_id" value={r.id} />
                    <label className="block text-sm font-bold">
                      The route (what happens next)
                      <textarea name="route" rows={3} maxLength={600} defaultValue={r.tom_adjusted ?? (r.verdict === "near" ? r.adjusted : r.body) ?? ""} className="s-input mt-1" />
                    </label>
                    <label className="block text-sm font-bold">
                      &ldquo;You chose…&rdquo; (5 words or fewer)
                      <input name="label" maxLength={60} defaultValue={r.tom_label ?? r.label ?? ""} className="s-input mt-1" />
                    </label>
                    <BranchSelect fork={round.fork_snapshot} value={r.tom_branch ?? r.branch} />
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input type="checkbox" name="show_credit" defaultChecked className="size-5" /> Credit {r.author_name ?? "the reader"} in the comic
                    </label>
                    {r.verdict === "veto" && (
                      <div className="rounded-lg bg-[#FFF3C4] p-2">
                        <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
                          <input type="checkbox" name="override" className="size-5" /> Override Claude&rsquo;s veto
                        </label>
                        <label className="block text-sm font-bold">
                          Why (required to override)
                          <input name="override_note" maxLength={300} className="s-input mt-1" />
                        </label>
                      </div>
                    )}
                    <label className="block text-sm font-bold">
                      Note (optional)
                      <input name="note" maxLength={500} className="s-input mt-1" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton formAction={chooseComment} pendingText="Choosing…">Choose this comment</SubmitButton>
                      <SubmitButton formAction={saveRowEdit} variant="quiet" pendingText="Saving…">Save edits only</SubmitButton>
                    </div>
                  </form>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {skipped.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-bold">Not screened ({skipped.length})</summary>
          <ul className="space-y-1 text-sm">
            {skipped.map((r) => <li key={r.id} className="break-words">{r.body} <span className="s-muted">({r.skipped_reason ? SKIP[r.skipped_reason] : r.reason ?? "not screened"})</span></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

export function BackupForm({ ids, fork, tooFew }: { ids: Ids; fork: ForkSnapshot | null; tooFew: boolean }) {
  return (
    <section id="backup" aria-labelledby="backup-title" className="s-card mt-6 p-4">
      <h2 id="backup-title" className="s-head text-lg">Use the backup pick</h2>
      <p className="s-muted text-sm">
        {tooFew ? "Too few comments to pick from. " : ""}The backup is still narrated as &ldquo;You chose…&rdquo; in the next episode.
      </p>
      <form className="mt-2 grid gap-2">
        <Hidden ids={ids} />
        <label className="block text-sm font-bold">
          The route
          <textarea name="route" rows={2} maxLength={600} defaultValue={fork?.backup_pick ?? ""} className="s-input mt-1" />
        </label>
        <label className="block text-sm font-bold">
          &ldquo;You chose…&rdquo; (5 words or fewer)
          <input name="label" maxLength={60} className="s-input mt-1" />
        </label>
        {fork && <BranchSelect fork={fork} value={null} />}
        <label className="block text-sm font-bold">
          Note (optional)
          <input name="note" maxLength={500} className="s-input mt-1" />
        </label>
        <div><SubmitButton formAction={chooseBackup} variant="quiet" pendingText="Choosing…">Use the backup pick</SubmitButton></div>
      </form>
    </section>
  );
}

export function DecisionCard({ ids, round, nextNumber, nextRoute }: { ids: Ids; round: Round; nextNumber: number; nextRoute: ReaderRoute | null }) {
  const d = round.decision!;
  return (
    <section id="decision" aria-labelledby="decision-title" className="s-card mt-6 border-4 border-[var(--s-volt)] p-4">
      <h2 id="decision-title" className="s-head text-2xl">Decided</h2>
      <p className="mt-1 text-xl font-bold">{d.you_chose}</p>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[120px_1fr]">
        <dt className="font-bold">Route</dt><dd>{d.route}</dd>
        <dt className="font-bold">From</dt><dd>{d.kind === "backup" ? "The backup pick" : "A reader's comment"}</dd>
        <dt className="font-bold">Credit</dt><dd>{d.credit ?? "None"}</dd>
        <dt className="font-bold">Branch</dt><dd>{d.branch}{d.rejoins ? ` (rejoins ${d.rejoins})` : ""}</dd>
        {d.override_note && <><dt className="font-bold">Veto overridden</dt><dd>{d.override_note}</dd></>}
        <dt className="font-bold">Decided</dt><dd>{when(round.decided_at)}{round.note ? `: ${round.note}` : ""}</dd>
      </dl>
      <p className="mt-2 text-sm">
        {nextRoute?.round_id === round.id ? (
          <>Episode {nextNumber}&rsquo;s structure and script drafts start from this route. <Link className="s-link" href={`/studio/projects/${ids.projectId}/script`}>Go to the script</Link></>
        ) : (
          <>Episode {nextNumber} doesn&rsquo;t carry this route.</>
        )}
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-2">
        <Hidden ids={ids} />
        <label className="block min-w-0 flex-1 text-sm font-bold">
          Reopen to change it (optional note)
          <input name="note" maxLength={500} className="s-input mt-1" />
        </label>
        <SubmitButton formAction={reopenDecision} variant="quiet" pendingText="Reopening…">Reopen</SubmitButton>
      </form>
    </section>
  );
}

export function History({ rounds }: { rounds: Round[] }) {
  if (rounds.length < 2) return null;
  return (
    <details className="s-card mt-6 p-4">
      <summary className="min-h-11 cursor-pointer py-2 font-bold">Earlier screenings ({rounds.length - 1})</summary>
      <ul className="space-y-1 text-sm">
        {rounds.slice(1).map((r) => <li key={r.id}>{when(r.screened_at)}: {r.summary ?? "—"}</li>)}
      </ul>
    </details>
  );
}
