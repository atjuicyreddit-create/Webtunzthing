"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withParams } from "@/lib/studio/url";
import { afterAssetChange, assetFingerprint, loadAssets, loadGate, loadTakes, syncAssets, usedIn } from "@/lib/studio/assets/assets";
import { startExploration } from "@/lib/studio/assets/jobs";
import { lintPrompt, templatePrompt } from "@/lib/studio/assets/prompts";
import { revisePrompt } from "@/lib/studio/assets/revise";
import { removeStudioFiles, uploadStudioFile } from "@/lib/studio/assets/storage";
import { ASPECTS, DEFAULT_ASPECT, type Asset, type AssetKind } from "@/lib/studio/assets/types";
import { requireStudio } from "@/lib/studio/auth";
import { morningBrewRefsAvailable, readMorningBrewRefs } from "@/lib/studio/seed/morningBrew";
import { loadStructure } from "@/lib/studio/structure/structure";
import { loadStory } from "@/lib/studio/story/story";

// One server action per button. Every action re-checks access, and that this episode's
// script is Script final (the Assets page is blocked until then). Database rules apply too.

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clip = (s: string, n: number) => s.slice(0, n);

const page = (id: string, ep: string, extra = "") => `/studio/projects/${id}/assets?ep=${ep}${extra}`;
function go(path: string, params: Record<string, string>): never {
  redirect(withParams(path, params));
}

async function ctx(form: FormData, opts: { needFinal?: boolean } = { needFinal: true }) {
  const id = t(form, "project_id");
  const ep = t(form, "episode_id");
  const c = await requireStudio(`/studio/projects/${id}/assets`);
  const { data: e } = await c.supabase.from("studio_episodes").select("id,number").eq("id", ep).eq("project_id", id).maybeSingle();
  if (!e) go(`/studio/projects/${id}/assets`, { error: "That episode doesn't exist." });
  if (opts.needFinal !== false) {
    const gate = await loadGate(c.supabase, id, ep, "script_final");
    if (gate?.state !== "approved") go(page(id, ep), { error: "This episode's script isn't Script final, so its assets are locked." });
  }
  return { ...c, id, ep, epNumber: e.number as number };
}

async function loadAsset(c: Awaited<ReturnType<typeof ctx>>, form: FormData): Promise<Asset> {
  const { data } = await c.supabase
    .from("studio_assets")
    .select("id,project_id,kind,scope,act_id,character_id,name,description,prompt,aspect,status,picked_take_id,reference_path,uses,updated_at")
    .eq("id", t(form, "asset_id"))
    .eq("project_id", c.id)
    .maybeSingle();
  if (!data) go(page(c.id, c.ep), { error: "That asset doesn't exist." });
  return data as Asset;
}

const refresh = (id: string) => revalidatePath(`/studio/projects/${id}/assets`);
const at = (asset: Asset) => `&asset=${asset.id}#asset`;

// ---------------------------------------------------------------- find and add

export async function findAssets(form: FormData) {
  const c = await ctx(form);
  const s = await loadStory(c.supabase, c.id);
  if (!s) go("/studio", { error: "That project doesn't exist." });
  const episodes = await loadStructure(c.supabase, c.id);
  const r = await syncAssets(c.supabase, c.id, s.characters, episodes);
  refresh(c.id);
  go(page(c.id, c.ep), {
    ok: `Read ${r.scripts} final script${r.scripts === 1 ? "" : "s"}: found ${r.total} asset${r.total === 1 ? "" : "s"}, ${r.added} new. Free (no AI used).`,
  });
}

export async function addAsset(form: FormData) {
  const c = await ctx(form);
  const kind = t(form, "kind") as AssetKind;
  const name = clip(t(form, "name"), 80);
  if (!["character", "location", "prop"].includes(kind) || !name) go(page(c.id, c.ep, "#add"), { error: "Pick a kind and type a name." });
  const description = clip(t(form, "description"), 600);
  const { data, error } = await c.supabase
    .from("studio_assets")
    .insert({
      project_id: c.id,
      kind,
      name,
      description: description || null,
      prompt: templatePrompt(kind, name, description),
      aspect: DEFAULT_ASPECT[kind],
      uses: { [c.ep]: [] },
    })
    .select("id")
    .single();
  if (error || !data) go(page(c.id, c.ep, "#add"), { error: "Couldn't add it. Is there already an asset with that name?" });
  refresh(c.id);
  go(page(c.id, c.ep, `&asset=${data.id}#asset`), { ok: `${name} added to episode ${c.epNumber}.` });
}

// ---------------------------------------------------------------- edit

export async function saveAsset(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const aspect = t(form, "aspect");
  const scope = t(form, "scope") === "act" ? "act" : "series";
  const actId = t(form, "act_id");
  const prompt = clip(t(form, "prompt"), 3000);
  if (!prompt) go(page(c.id, c.ep, at(a)), { error: "The prompt can't be empty." });
  const { error } = await c.supabase
    .from("studio_assets")
    .update({
      description: clip(t(form, "description"), 600) || null,
      prompt,
      aspect: (ASPECTS as string[]).includes(aspect) ? aspect : a.aspect,
      scope,
      act_id: scope === "act" && actId ? actId : null,
    })
    .eq("id", a.id);
  if (error) go(page(c.id, c.ep, at(a)), { error: "Couldn't save the asset." });
  const changed = prompt !== a.prompt || aspect !== a.aspect;
  if (changed) await afterAssetChange(c.supabase, a, "Prompt or shape edited", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Asset saved." });
}

export async function resetPrompt(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const s = await loadStory(c.supabase, c.id);
  const sheet = a.character_id ? s?.characters.find((x) => x.id === a.character_id)?.sheet : null;
  await c.supabase.from("studio_assets").update({ prompt: templatePrompt(a.kind, a.name, a.description ?? "", sheet) }).eq("id", a.id);
  await afterAssetChange(c.supabase, a, "Prompt reset to the starter template", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Prompt rebuilt from the character sheet / description." });
}

export async function markNotNeeded(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  await c.supabase.from("studio_assets").update({ status: "not_needed", picked_take_id: null }).eq("id", a.id);
  await afterAssetChange(c.supabase, a, "Marked as no design needed", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: `${a.name}: no design needed.` });
}

export async function markNeedsDesign(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  await c.supabase.from("studio_assets").update({ status: "needs_design", picked_take_id: null }).eq("id", a.id);
  await afterAssetChange(c.supabase, a, "Design reopened", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: `${a.name} needs a design again.` });
}

export async function deleteAsset(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  if (t(form, "confirm") !== "delete") go(page(c.id, c.ep, at(a)), { error: "Type delete to confirm." });
  const takes = await loadTakes(c.supabase, [a.id]);
  const files = [...takes.map((x) => x.storage_path), a.reference_path].filter((x): x is string => Boolean(x));
  await afterAssetChange(c.supabase, a, "Asset deleted", c.user.id);
  await c.supabase.from("studio_assets").delete().eq("id", a.id);
  if (files.length) await removeStudioFiles(c.supabase, files);
  refresh(c.id);
  go(page(c.id, c.ep), { ok: `${a.name} deleted, with its images.` });
}

// ---------------------------------------------------------------- reference image

export async function uploadReference(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go(page(c.id, c.ep, at(a)), { error: "Choose an image first." });
  const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  if (!types[file.type]) go(page(c.id, c.ep, at(a)), { error: "Use a PNG, JPG or WebP image." });
  if (file.size > 4 * 1024 * 1024) go(page(c.id, c.ep, at(a)), { error: "The image is over 4 MB. Make it smaller first." });
  const path = `projects/${c.id}/assets/${a.id}/reference-${Date.now()}.${types[file.type]}`;
  const ok = await uploadStudioFile(c.supabase, path, new Uint8Array(await file.arrayBuffer()), file.type);
  if (!ok) go(page(c.id, c.ep, at(a)), { error: "Couldn't upload the image." });
  if (a.reference_path) await removeStudioFiles(c.supabase, [a.reference_path]);
  await c.supabase.from("studio_assets").update({ reference_path: path }).eq("id", a.id);
  await afterAssetChange(c.supabase, a, "Reference image added", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Reference added. New options will use it." });
}

export async function removeReference(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  if (a.reference_path) await removeStudioFiles(c.supabase, [a.reference_path]);
  await c.supabase.from("studio_assets").update({ reference_path: null }).eq("id", a.id);
  await afterAssetChange(c.supabase, a, "Reference image removed", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Reference removed." });
}

// ---------------------------------------------------------------- options (images)

export async function makeOptions(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const count = Math.min(4, Math.max(2, Number(t(form, "count")) || 2));
  const s = await loadStory(c.supabase, c.id);
  const lint = lintPrompt(a.kind, a.name, a.prompt, s?.characters.map((x) => x.name) ?? []);
  if (lint.errors.length) go(page(c.id, c.ep, at(a)), { error: `Fix the prompt first: ${lint.errors[0]}` });
  const { data: running } = await c.supabase.from("studio_takes").select("id").eq("asset_id", a.id).eq("status", "pending");
  if ((running ?? []).length) go(page(c.id, c.ep, at(a)), { error: "Options for this asset are still generating. Wait for them first." });

  const r = await startExploration(c.supabase, a, c.ep, count);
  refresh(c.id);
  if (!r.started) go(page(c.id, c.ep, at(a)), { error: r.reason ?? "Nothing was started." });
  const what = r.dryRun
    ? `Dry run: ${r.started} placeholder option${r.started === 1 ? "" : "s"} logged, $0 spent (about $${(r.estimateEach * r.started).toFixed(2)} if real).`
    : `Started ${r.started} option${r.started === 1 ? "" : "s"} (about $${(r.estimateEach * r.started).toFixed(2)}). They appear here in a minute or so.`;
  const extra = r.reason ? ` Stopped early: ${r.reason}` : "";
  go(page(c.id, c.ep, at(a)), {
    ok: what + extra,
    ...(r.warn ? { warn: `You've used ${r.percent}% of a limit.` } : {}),
  });
}

export async function pickTake(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const takeId = t(form, "take_id");
  const { error } = await c.supabase.from("studio_assets").update({ picked_take_id: takeId, status: "picked" }).eq("id", a.id);
  if (error) go(page(c.id, c.ep, at(a)), { error: "Only a finished image of this asset can be picked." });
  await afterAssetChange(c.supabase, a, "Design picked", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: `Picked as ${a.name}'s design. It's a reference for drawing panels, never panel art itself.` });
}

export async function removeTake(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const takeId = t(form, "take_id");
  if (a.picked_take_id === takeId) go(page(c.id, c.ep, at(a)), { error: "That's the picked design. Pick another first." });
  const { data: take } = await c.supabase.from("studio_takes").select("id,status,storage_path").eq("id", takeId).eq("asset_id", a.id).maybeSingle();
  if (!take) go(page(c.id, c.ep, at(a)), { error: "That option doesn't exist." });
  if (take.status === "pending") go(page(c.id, c.ep, at(a)), { error: "It's still generating." });
  await c.supabase.from("studio_takes").delete().eq("id", take.id);
  if (take.storage_path) await removeStudioFiles(c.supabase, [take.storage_path]);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Option removed. Its cost stays in the ledger." });
}

export async function saveComment(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  await c.supabase
    .from("studio_takes")
    .update({ comment: clip(t(form, "comment"), 600) || null })
    .eq("id", t(form, "take_id"))
    .eq("asset_id", a.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Comment saved." });
}

/** Saves the comment, then asks Claude to turn it into a revised prompt (shown as a suggestion). */
export async function reviseFromComment(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const comment = clip(t(form, "comment"), 600);
  if (!comment) go(page(c.id, c.ep, at(a)), { error: "Write a comment first, e.g. “make the hat smaller”." });
  await c.supabase.from("studio_takes").update({ comment }).eq("id", t(form, "take_id")).eq("asset_id", a.id);
  const r = await revisePrompt(c.supabase, a, c.ep, comment);
  if (!r.ok) go(page(c.id, c.ep, at(a)), { error: r.reason });
  await c.supabase.from("studio_suggestions").update({ status: "rejected" }).eq("project_id", c.id).eq("kind", "asset_prompt").eq("status", "pending").contains("payload", { asset_id: a.id });
  await c.supabase.from("studio_suggestions").insert({
    project_id: c.id,
    kind: "asset_prompt",
    text: r.prompt,
    why: r.changes.join(" · ") || null,
    payload: { asset_id: a.id, take_id: t(form, "take_id"), from_prompt: a.prompt, comment },
  });
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: `Claude suggested a revised prompt. Nothing changed until you accept it (${r.note})` });
}

async function loadRevision(c: Awaited<ReturnType<typeof ctx>>, form: FormData, a: Asset) {
  const { data } = await c.supabase
    .from("studio_suggestions")
    .select("id,text,status,payload")
    .eq("id", t(form, "suggestion_id"))
    .eq("project_id", c.id)
    .eq("kind", "asset_prompt")
    .maybeSingle();
  if (!data || data.status !== "pending" || (data.payload as { asset_id?: string })?.asset_id !== a.id) {
    go(page(c.id, c.ep, at(a)), { error: "That suggestion is no longer open." });
  }
  return data as { id: string; text: string };
}

export async function acceptRevision(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const sug = await loadRevision(c, form, a);
  await c.supabase.from("studio_assets").update({ prompt: sug.text.slice(0, 3000) }).eq("id", a.id);
  await c.supabase.from("studio_suggestions").update({ status: "accepted" }).eq("id", sug.id);
  await afterAssetChange(c.supabase, a, "Accepted Claude's revised prompt", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Revised prompt accepted. Make new options to see it. (Undo: “Restore previous prompt”.)" });
}

export async function rejectRevision(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const sug = await loadRevision(c, form, a);
  await c.supabase.from("studio_suggestions").update({ status: "rejected" }).eq("id", sug.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Suggestion rejected. The prompt is unchanged." });
}

/** Undo: put back the prompt from the asset's previous saved version. */
export async function restorePreviousPrompt(form: FormData) {
  const c = await ctx(form);
  const a = await loadAsset(c, form);
  const { data } = await c.supabase
    .from("studio_versions")
    .select("version,snapshot")
    .eq("item_type", "asset")
    .eq("item_id", a.id)
    .order("version", { ascending: false })
    .limit(20);
  const prev = (data ?? []).map((v) => (v.snapshot as { prompt?: string }).prompt).find((p) => p && p !== a.prompt);
  if (!prev) go(page(c.id, c.ep, at(a)), { error: "There's no earlier prompt to go back to." });
  await c.supabase.from("studio_assets").update({ prompt: prev }).eq("id", a.id);
  await afterAssetChange(c.supabase, a, "Restored the previous prompt", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(a)), { ok: "Previous prompt restored." });
}

// ---------------------------------------------------------------- Morning Brew reference sheets (test project, local only)

export async function importMorningBrewRefs(form: FormData) {
  const c = await ctx(form);
  const { data: project } = await c.supabase.from("studio_projects").select("is_test").eq("id", c.id).maybeSingle();
  if (!project?.is_test) go(page(c.id, c.ep), { error: "Reference sheets can only be imported into a test project." });
  if (!morningBrewRefsAvailable()) go(page(c.id, c.ep), { error: "The test pack isn't on this computer (local only)." });
  const s = await loadStory(c.supabase, c.id);
  const assets = await loadAssets(c.supabase, c.id);
  let n = 0;
  for (const ref of readMorningBrewRefs()) {
    let a = assets.find((x) => x.kind === ref.kind && x.name.toLowerCase() === ref.name.toLowerCase());
    if (!a) {
      const sheet = s?.characters.find((x) => x.name.toLowerCase() === ref.name.toLowerCase());
      const { data } = await c.supabase
        .from("studio_assets")
        .insert({
          project_id: c.id,
          kind: ref.kind,
          name: ref.name,
          character_id: sheet?.id ?? null,
          prompt: templatePrompt(ref.kind, ref.name, "", sheet?.sheet),
          aspect: DEFAULT_ASPECT[ref.kind],
          uses: { [c.ep]: [] },
        })
        .select("id,project_id,kind,scope,act_id,character_id,name,description,prompt,aspect,status,picked_take_id,reference_path,uses,updated_at")
        .single();
      if (!data) continue;
      a = data as Asset;
    }
    const { data: take } = await c.supabase
      .from("studio_takes")
      .insert({
        project_id: c.id,
        episode_id: c.ep,
        asset_id: a.id,
        kind: "imported",
        status: "pending",
        prompt: "Imported from the Morning Brew test pack (made before the gates).",
        comment: "Imported, made before the gate.",
        aspect: a.aspect,
      })
      .select("id")
      .single();
    if (!take) continue;
    const path = `projects/${c.id}/assets/${a.id}/${take.id}.jpg`;
    if (await uploadStudioFile(c.supabase, path, ref.bytes, "image/jpeg")) {
      await c.supabase.from("studio_takes").update({ status: "ready", storage_path: path }).eq("id", take.id);
      n++;
    } else {
      await c.supabase.from("studio_takes").update({ status: "failed", error: "Upload failed" }).eq("id", take.id);
    }
  }
  refresh(c.id);
  go(page(c.id, c.ep), { ok: `Imported ${n} reference sheet${n === 1 ? "" : "s"} as options (labelled “imported, made before the gate”). Nothing is picked: you pick.` });
}

// ---------------------------------------------------------------- Gate: Asset designs approved

export async function approveAssets(form: FormData) {
  const c = await ctx(form);
  const all = await loadAssets(c.supabase, c.id);
  const mine = all.filter((a) => usedIn(a, c.ep));
  const note = clip(t(form, "note"), 500);
  const undecided = mine.filter((a) => !(a.status === "not_needed" || (a.status === "picked" && a.picked_take_id)));
  if (undecided.length) {
    go(page(c.id, c.ep, "#gate"), { error: `Still to decide: ${undecided.map((a) => a.name).join(", ")}. Pick a design or mark “no design needed”.` });
  }
  if (!mine.length && !note) go(page(c.id, c.ep, "#gate"), { error: "No assets for this episode. If that's right, write a note saying why." });
  const takes = await loadTakes(c.supabase, mine.map((a) => a.id));
  const fp = assetFingerprint(mine, takes);
  const now = new Date().toISOString();
  const row = { state: "approved", fingerprint: fp, approved_by: c.user.id, approved_at: now, note: note || `${mine.length} asset${mine.length === 1 ? "" : "s"}`, updated_at: now };
  const gate = await loadGate(c.supabase, c.id, c.ep, "assets_approved");
  let gateId = gate?.id;
  if (gateId) {
    const { error } = await c.supabase.from("studio_gates").update(row).eq("id", gateId);
    if (error) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval. Gates go in order: is the script still Script final?" });
  } else {
    const { data, error } = await c.supabase.from("studio_gates").insert({ project_id: c.id, episode_id: c.ep, gate: "assets_approved", ...row }).select("id").single();
    if (error) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval. Gates go in order: is the script still Script final?" });
    gateId = data?.id;
  }
  if (!gateId) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval." });
  await c.supabase.from("studio_gate_events").insert({ gate_id: gateId, action: "approved", actor: c.user.id, note: row.note, fingerprint: fp });
  refresh(c.id);
  go(page(c.id, c.ep, "#gate"), { ok: `Asset designs approved for episode ${c.epNumber}.` });
}

export async function reopenAssets(form: FormData) {
  const c = await ctx(form, { needFinal: false });
  const gate = await loadGate(c.supabase, c.id, c.ep, "assets_approved");
  if (!gate) go(page(c.id, c.ep, "#gate"), {});
  await c.supabase.from("studio_gates").update({ state: "open", updated_at: new Date().toISOString() }).eq("id", gate.id);
  await c.supabase.from("studio_gate_events").insert({ gate_id: gate.id, action: "reopened", actor: c.user.id, note: clip(t(form, "note"), 500) || null });
  refresh(c.id);
  go(page(c.id, c.ep, "#gate"), { ok: "Asset designs reopened for changes." });
}
