import Link from "next/link";
import {
  acceptRevision,
  addAsset,
  approveAssets,
  deleteAsset,
  makeOptions,
  markNeedsDesign,
  markNotNeeded,
  pickTake,
  rejectRevision,
  removeReference,
  removeTake,
  reopenAssets,
  resetPrompt,
  restorePreviousPrompt,
  reviseFromComment,
  saveAsset,
  saveComment,
  uploadReference,
} from "../assets-actions";
import { SubmitButton } from "@/components/studio/ui";
import type { AssetGate } from "@/lib/studio/assets/assets";
import { ASPECTS, KIND_LABEL, type Asset, type AssetKind, type Take } from "@/lib/studio/assets/types";
import { formatUsd } from "@/lib/studio/settings";

type Ids = { projectId: string; episodeId: string };
const Hidden = ({ projectId, episodeId, assetId }: Ids & { assetId?: string }) => (
  <>
    <input type="hidden" name="project_id" value={projectId} />
    <input type="hidden" name="episode_id" value={episodeId} />
    {assetId && <input type="hidden" name="asset_id" value={assetId} />}
  </>
);
const base = (ids: Ids) => `/studio/projects/${ids.projectId}/assets?ep=${ids.episodeId}`;

const STATUS: Record<Asset["status"], string> = { needs_design: "Needs a design", picked: "Design picked", not_needed: "No design needed" };

export function TakeLabel({ take }: { take: Take }) {
  const label =
    take.status === "dry_run"
      ? "Dry run · no image"
      : take.kind === "imported"
        ? "Imported · made before the gate"
        : take.kind === "exploration"
          ? "Exploration · not for panels or publishing"
          : "Final";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${take.kind === "imported" ? "bg-[var(--s-cobalt)] text-white" : "bg-[var(--s-ink)] text-white"}`}>
      {label}
    </span>
  );
}

// ------------------------------------------------------------------ the list

export function AssetList({
  ids,
  assets,
  selected,
  urls,
  pickedPath,
}: {
  ids: Ids;
  assets: Asset[];
  selected?: string;
  urls: Record<string, string>;
  pickedPath: Record<string, string | null>;
}) {
  const groups: AssetKind[] = ["character", "location", "prop"];
  return (
    <div className="mt-4 space-y-4">
      {groups.map((g) => {
        const list = assets.filter((a) => a.kind === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-labelledby={`g-${g}`}>
            <h2 id={`g-${g}`} className="s-head text-lg">
              {KIND_LABEL[g]}s <span className="s-muted text-sm font-medium">({list.length})</span>
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {list.map((a) => {
                const path = pickedPath[a.id];
                const panels = a.uses[ids.episodeId] ?? [];
                return (
                  <li key={a.id}>
                    <Link
                      href={`${base(ids)}&asset=${a.id}#asset`}
                      aria-current={selected === a.id ? "true" : undefined}
                      className={`s-card flex min-h-16 items-center gap-3 p-3 ${selected === a.id ? "border-[var(--s-magenta)]" : "hover:border-[var(--s-magenta)]"}`}
                    >
                      {path && urls[path] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[path]} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-[var(--s-paper)] text-lg" aria-hidden="true">
                          {a.status === "not_needed" ? "–" : "?"}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block font-bold">{a.name}</span>
                        <span className="s-muted block text-xs">
                          {STATUS[a.status]} · {a.scope === "series" ? "series-wide" : "this act"}
                          {panels.length ? ` · panels ${panels.join(", ")}` : " · added by hand"}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ one asset

export function AssetEditor({
  ids,
  asset,
  takes,
  urls,
  acts,
  lint,
  estimateEach,
  reviseEstimate,
  revision,
  dryRun,
}: {
  ids: Ids;
  asset: Asset;
  takes: Take[];
  urls: Record<string, string>;
  acts: { id: string; label: string }[];
  lint: { errors: string[]; warnings: string[] };
  estimateEach: number | null;
  reviseEstimate: number | null;
  revision: { id: string; text: string; why: string | null; from: string; comment: string } | null;
  dryRun: boolean;
}) {
  const h = { ...ids, assetId: asset.id };
  const pending = takes.some((t) => t.status === "pending");
  return (
    <section id="asset" aria-labelledby="asset-title" className="s-card mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="s-muted text-xs font-bold uppercase tracking-wide">
            {KIND_LABEL[asset.kind]} · {STATUS[asset.status]}
          </p>
          <h2 id="asset-title" className="s-head text-2xl">{asset.name}</h2>
        </div>
        <Link href={base(ids)} className="s-link inline-flex min-h-11 items-center text-sm">Close</Link>
      </div>

      {/* ---------- options */}
      <h3 className="s-head mt-4 text-lg">Options</h3>
      {takes.length === 0 && <p className="s-muted text-sm">No options yet. Make 2 to 4 cheap ones below.</p>}
      <ul className="mt-2 grid gap-3 sm:grid-cols-2">
        {takes.map((t, i) => {
          const url = t.storage_path ? urls[t.storage_path] : undefined;
          const picked = asset.picked_take_id === t.id;
          return (
            <li key={t.id} className={`rounded-xl border-2 p-3 ${picked ? "border-[var(--s-magenta)]" : "border-[var(--s-line)]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <TakeLabel take={t} />
                {picked && <span className="rounded-md bg-[var(--s-magenta)] px-2 py-0.5 text-xs font-bold text-white">Picked</span>}
              </div>
              <div className="mt-2 grid aspect-square place-items-center overflow-hidden rounded-lg bg-[var(--s-paper)]">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`${asset.name}, option ${takes.length - i}`} className="h-full w-full object-contain" />
                ) : t.status === "pending" ? (
                  <span className="s-muted p-4 text-center text-sm font-bold">Generating…</span>
                ) : t.status === "failed" ? (
                  <span className="p-4 text-center text-sm font-bold text-[var(--s-magenta-deep)]">Failed: {t.error ?? "unknown error"}</span>
                ) : (
                  <span className="s-muted p-4 text-center text-sm">Dry run: no image was made. With dry-run off this would be a real option.</span>
                )}
              </div>
              <p className="s-muted mt-1 text-xs">
                {t.model ?? "imported"} {t.size ?? ""} {t.aspect ?? ""} · {t.status === "dry_run" ? "$0 (dry run)" : t.kind === "imported" ? "no cost" : `${t.status === "pending" ? "about " : ""}${formatUsd(t.cost_usd)}`} ·{" "}
                {new Date(t.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}
              </p>
              <form key={`${t.id}-${t.comment ?? ""}`} className="mt-2 space-y-2">
                <Hidden {...h} />
                <input type="hidden" name="take_id" value={t.id} />
                <label htmlFor={`c-${t.id}`} className="block text-sm font-bold">Comment</label>
                <textarea id={`c-${t.id}`} name="comment" rows={2} maxLength={600} defaultValue={t.comment ?? ""} className="s-input" placeholder="e.g. make the hat smaller, warmer colours" />
                <div className="flex flex-wrap gap-2">
                  {t.status === "ready" && t.storage_path && !picked && (
                    <SubmitButton formAction={pickTake} pendingText="Picking…">Pick this</SubmitButton>
                  )}
                  <SubmitButton formAction={saveComment} variant="quiet" pendingText="Saving…">Save comment</SubmitButton>
                  <SubmitButton formAction={reviseFromComment} variant="info" pendingText="Asking Claude…">
                    Comment → revised prompt · {reviseEstimate === null ? "cost unknown" : reviseEstimate < 0.01 ? "under 1¢" : `up to $${reviseEstimate.toFixed(2)}`}
                  </SubmitButton>
                  {!picked && t.status !== "pending" && (
                    <SubmitButton formAction={removeTake} variant="quiet" pendingText="…">Remove</SubmitButton>
                  )}
                </div>
              </form>
            </li>
          );
        })}
      </ul>

      {/* ---------- Claude's suggested prompt */}
      {revision && (
        <div className="mt-4 rounded-xl border-2 border-[var(--s-cobalt)] p-4" aria-labelledby="rev-title">
          <h3 id="rev-title" className="s-head text-lg">Claude&rsquo;s revised prompt</h3>
          <p className="s-muted text-sm">From your comment: &ldquo;{revision.comment}&rdquo;{revision.why ? ` · Changed: ${revision.why}` : ""}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase">Now</p>
              <p className="whitespace-pre-wrap rounded-lg bg-[var(--s-paper)] p-2 text-sm">{revision.from}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase">Suggested</p>
              <p className="whitespace-pre-wrap rounded-lg border-2 border-[var(--s-cobalt)] p-2 text-sm">{revision.text}</p>
            </div>
          </div>
          <form className="mt-2 flex flex-wrap gap-2">
            <Hidden {...h} />
            <input type="hidden" name="suggestion_id" value={revision.id} />
            <SubmitButton formAction={acceptRevision} pendingText="Saving…">Accept</SubmitButton>
            <SubmitButton formAction={rejectRevision} variant="quiet" pendingText="…">Reject</SubmitButton>
          </form>
        </div>
      )}

      {/* ---------- make options */}
      <form className="mt-4 rounded-xl bg-[var(--s-paper)] p-4">
        <Hidden {...h} />
        <h3 className="s-head text-lg">Make new options</h3>
        {lint.errors.length > 0 && (
          <ul role="alert" className="mt-2 space-y-1 text-sm font-bold text-[var(--s-magenta-deep)]">
            {lint.errors.map((e) => <li key={e}>✗ {e}</li>)}
          </ul>
        )}
        {lint.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">{lint.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
        )}
        {!lint.errors.length && <p className="mt-1 text-sm">✓ Prompt check passed (free).</p>}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block text-sm font-bold">
            How many
            <select name="count" defaultValue="2" className="s-input mt-1 w-28">
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {estimateEach !== null ? ` · $${(n * estimateEach).toFixed(2)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton formAction={makeOptions} pendingText="Starting…" disabled={lint.errors.length > 0 || pending}>
            {dryRun ? "Make options (dry run, $0)" : "Make options"}
          </SubmitButton>
        </div>
        <p className="s-muted mt-1 text-xs">
          1K exploration images, {estimateEach !== null ? `$${estimateEach.toFixed(2)} each` : "price not set"}, charged to this episode&rsquo;s image budget. Each is
          checked against the caps before it starts. {asset.reference_path ? "Your reference image is sent with each one." : ""}
          {pending ? " Wait for the current ones to finish first." : ""}
        </p>
      </form>

      {/* ---------- prompt and settings (keyed so the boxes refresh after a save, accept or undo) */}
      <form key={`${asset.updated_at}-${asset.prompt.length}`} className="mt-4 space-y-3">
        <Hidden {...h} />
        <h3 className="s-head text-lg">Prompt</h3>
        <div>
          <label htmlFor="a-desc" className="block font-bold">Description (notes for you and Claude)</label>
          <textarea id="a-desc" name="description" rows={2} maxLength={600} defaultValue={asset.description ?? ""} className="s-input mt-1" />
        </div>
        <div>
          <label htmlFor="a-prompt" className="block font-bold">Prompt</label>
          <textarea id="a-prompt" name="prompt" rows={6} maxLength={3000} defaultValue={asset.prompt} className="s-input mt-1" />
          <p className="s-muted mt-1 text-xs">The house style and the &ldquo;must not appear&rdquo; list (no text, no extra characters) are always added; you can&rsquo;t remove them.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block font-bold">
            Shape
            <select name="aspect" defaultValue={asset.aspect} className="s-input mt-1">
              {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="block font-bold">
            Scope
            <select name="scope" defaultValue={asset.scope} className="s-input mt-1">
              <option value="series">Series-wide (template)</option>
              <option value="act">One act</option>
            </select>
          </label>
          <label className="block font-bold">
            Act (if one act)
            <select name="act_id" defaultValue={asset.act_id ?? ""} className="s-input mt-1">
              <option value="">—</option>
              {acts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <SubmitButton formAction={saveAsset} pendingText="Saving…">Save</SubmitButton>
          <SubmitButton formAction={restorePreviousPrompt} variant="quiet" pendingText="…">Restore previous prompt</SubmitButton>
          <SubmitButton formAction={resetPrompt} variant="quiet" pendingText="…">Rebuild from {asset.kind === "character" ? "character sheet" : "description"}</SubmitButton>
        </div>
      </form>

      {/* ---------- reference image */}
      <div className="mt-4">
        <h3 className="s-head text-lg">Reference image (optional)</h3>
        {asset.reference_path && urls[asset.reference_path] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={urls[asset.reference_path]} alt={`Reference for ${asset.name}`} className="mt-2 max-h-48 rounded-lg border-2 border-[var(--s-line)]" />
        )}
        <form className="mt-2 flex flex-wrap items-end gap-2">
          <Hidden {...h} />
          <label className="block min-w-0 max-w-full text-sm font-bold">
            {asset.reference_path ? "Replace with" : "Upload"} (PNG, JPG or WebP, up to 4 MB)
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block min-h-11 w-full max-w-full text-sm" />
          </label>
          <SubmitButton formAction={uploadReference} variant="quiet" pendingText="Uploading…">Upload</SubmitButton>
          {asset.reference_path && <SubmitButton formAction={removeReference} variant="quiet" pendingText="…">Remove</SubmitButton>}
        </form>
        <p className="s-muted mt-1 text-xs">Use only your own original art. It&rsquo;s sent to KIE with each new option.</p>
      </div>

      {/* ---------- decide */}
      <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--s-line)] pt-4">
        <Hidden {...h} />
        {asset.status !== "not_needed" ? (
          <SubmitButton formAction={markNotNeeded} variant="quiet" pendingText="…">No design needed</SubmitButton>
        ) : (
          <SubmitButton formAction={markNeedsDesign} variant="quiet" pendingText="…">Needs a design after all</SubmitButton>
        )}
        {asset.status === "picked" && <SubmitButton formAction={markNeedsDesign} variant="quiet" pendingText="…">Un-pick</SubmitButton>}
      </form>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">Delete this asset</summary>
        <form className="flex flex-wrap items-end gap-2">
          <Hidden {...h} />
          <label className="block text-sm font-bold">
            Type delete
            <input name="confirm" className="s-input mt-1 w-32" />
          </label>
          <SubmitButton formAction={deleteAsset} variant="quiet" pendingText="Deleting…">Delete with its images</SubmitButton>
        </form>
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ add by hand

export function AddAsset({ ids }: { ids: Ids }) {
  return (
    <details id="add" className="s-card mt-4 p-4">
      <summary className="min-h-11 cursor-pointer py-2 font-bold">Add an asset by hand</summary>
      <form action={addAsset} className="mt-2 grid gap-3 sm:grid-cols-[150px_1fr]">
        <Hidden {...ids} />
        <label className="block font-bold">
          Kind
          <select name="kind" className="s-input mt-1">
            <option value="character">Character</option>
            <option value="location">Location</option>
            <option value="prop">Prop</option>
          </select>
        </label>
        <label className="block font-bold">
          Name
          <input name="name" required maxLength={80} className="s-input mt-1" />
        </label>
        <label className="block font-bold sm:col-span-2">
          Description (optional)
          <input name="description" maxLength={600} className="s-input mt-1" />
        </label>
        <div className="sm:col-span-2">
          <SubmitButton pendingText="Adding…">Add to this episode</SubmitButton>
        </div>
      </form>
    </details>
  );
}

// ------------------------------------------------------------------ gate

export function AssetGateSection({
  ids,
  gate,
  changed,
  total,
  undecided,
}: {
  ids: Ids;
  gate: AssetGate | null;
  changed: boolean;
  total: number;
  undecided: string[];
}) {
  const approved = gate?.state === "approved" && !changed;
  return (
    <section id="gate" aria-labelledby="gate-title" className="s-card mt-4 p-5">
      <h2 id="gate-title" className="s-head text-lg">Gate: Asset designs approved</h2>
      <p className="s-muted text-sm">Only you can press this. Every asset in this episode needs a picked design or &ldquo;no design needed&rdquo;. Any later change to a picked design or its prompt reopens it.</p>
      {approved && (
        <div className="s-active mt-3 rounded-xl p-3">
          <p className="font-bold">✓ Asset designs approved {gate.approved_at ? new Date(gate.approved_at).toLocaleString("en-GB", { timeZone: "Europe/London" }) : ""}</p>
          {gate.note && <p className="text-sm">{gate.note}</p>}
        </div>
      )}
      {(gate?.state === "stale" || (gate?.state === "approved" && changed)) && (
        <p role="alert" className="mt-3 rounded-xl border-2 border-[var(--s-magenta)] bg-white p-3 font-bold text-[var(--s-magenta-deep)]">
          Something changed after approval (a design, a prompt, or the script). Check and re-approve.
        </p>
      )}
      {!approved && (
        <>
          <ul className="mt-3 space-y-1 text-sm">
            <li>✓ Script final</li>
            <li>
              {undecided.length === 0 ? "✓" : "✗"} {total} asset{total === 1 ? "" : "s"}
              {undecided.length ? `, still to decide: ${undecided.join(", ")}` : ", all decided"}
            </li>
          </ul>
          <form action={approveAssets} className="mt-3 space-y-2">
            <Hidden {...ids} />
            <label htmlFor="gate-note" className="block font-bold">Note {total === 0 ? "(required: why there are no assets)" : "(optional)"}</label>
            <input id="gate-note" name="note" maxLength={500} className="s-input" />
            <SubmitButton pendingText="Approving…" disabled={undecided.length > 0}>Approve asset designs</SubmitButton>
          </form>
        </>
      )}
      {gate?.state === "approved" && (
        <form action={reopenAssets} className="mt-3 space-y-2">
          <Hidden {...ids} />
          <label htmlFor="reopen-note" className="block text-sm font-bold">Reopen to make changes (optional note)</label>
          <input id="reopen-note" name="note" maxLength={500} className="s-input" />
          <SubmitButton variant="quiet" pendingText="…">Reopen</SubmitButton>
        </form>
      )}
    </section>
  );
}
