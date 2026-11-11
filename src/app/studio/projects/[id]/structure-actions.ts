"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudio } from "@/lib/studio/auth";
import { runStructureAction, type DraftStructure, type ReorderReply } from "@/lib/studio/structure/prompts";
import { applyOrder, loadStructure, orderSnapshot, writeVersion } from "@/lib/studio/structure/structure";
import type { BoardOrder } from "@/lib/studio/structure/types";
import { loadStory } from "@/lib/studio/story/story";

// One server action per button. Every action re-checks access; the database rules apply too.

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clip = (s: string, n: number) => s.slice(0, n);
const list = (s: string, n = 12) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, n)
    .map((x) => clip(x, 80));

const board = (id: string, extra = "") => `/studio/projects/${id}/structure${extra}`;
function go(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${path}${q ? (path.includes("?") ? "&" : "?") + q : ""}`);
}

async function ctx(projectId: string) {
  const c = await requireStudio(`/studio/projects/${projectId}/structure`);
  const { data: p } = await c.supabase.from("studio_projects").select("id").eq("id", projectId).maybeSingle();
  if (!p) go("/studio", { error: "That project doesn't exist." });
  return c;
}
const refresh = (id: string) => revalidatePath(`/studio/projects/${id}/structure`);

async function snapshotOrder(c: Awaited<ReturnType<typeof ctx>>, projectId: string, reason: string) {
  const eps = await loadStructure(c.supabase, projectId);
  await writeVersion(c.supabase, projectId, "structure_order", { order: orderSnapshot(eps), undone: false }, reason, c.user.id);
}

// ---------------------------------------------------------------- episodes

export async function addEpisode(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const { data: last } = await c.supabase.from("studio_episodes").select("number").eq("project_id", id).order("number", { ascending: false }).limit(1);
  const number = (last?.[0]?.number ?? 0) + 1;
  const { data: ep, error } = await c.supabase
    .from("studio_episodes")
    .insert({ project_id: id, number, title: `Episode ${number}` })
    .select("id")
    .single();
  if (error || !ep) go(board(id), { error: "Couldn't add the episode." });
  await c.supabase.from("studio_acts").insert({ project_id: id, episode_id: ep.id, position: 1, title: "Act 1" });
  refresh(id);
  go(board(id), { ok: `Episode ${number} added.` });
}

export async function saveEpisode(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const ms = t(form, "milestone_id");
  const { error } = await c.supabase
    .from("studio_episodes")
    .update({ title: clip(t(form, "title"), 120), summary: clip(t(form, "summary"), 1000) || null, milestone_id: ms || null })
    .eq("id", t(form, "episode_id"))
    .eq("project_id", id);
  if (error) go(board(id), { error: "Couldn't save the episode." });
  refresh(id);
  go(board(id), { ok: "Episode saved." });
}

async function renumber(c: Awaited<ReturnType<typeof ctx>>, id: string, ids: string[]) {
  const { error } = await c.supabase.rpc("studio_reorder_episodes", { p_project: id, p_ids: ids });
  return error;
}

export async function moveEpisode(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const { data: eps } = await c.supabase.from("studio_episodes").select("id").eq("project_id", id).order("number");
  const ids = (eps ?? []).map((e) => e.id);
  const i = ids.indexOf(t(form, "episode_id"));
  const j = i + (t(form, "dir") === "up" ? -1 : 1);
  if (i === -1 || j < 0 || j >= ids.length) go(board(id), {});
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await snapshotOrder(c, id, "Episode moved");
  if (await renumber(c, id, ids)) go(board(id), { error: "Couldn't move the episode." });
  refresh(id);
  go(board(id), { ok: "Episode moved." });
}
export async function moveEpisodeUp(form: FormData) {
  form.set("dir", "up");
  return moveEpisode(form);
}
export async function moveEpisodeDown(form: FormData) {
  form.set("dir", "down");
  return moveEpisode(form);
}

export async function deleteEpisode(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  if (t(form, "confirm") !== "delete") go(board(id), { error: "Type delete to confirm deleting the episode." });
  await snapshotOrder(c, id, "Before deleting an episode");
  await c.supabase.from("studio_episodes").delete().eq("id", t(form, "episode_id")).eq("project_id", id);
  const { data: eps } = await c.supabase.from("studio_episodes").select("id").eq("project_id", id).order("number");
  await renumber(c, id, (eps ?? []).map((e) => e.id));
  refresh(id);
  go(board(id), { ok: "Episode deleted." });
}

// ---------------------------------------------------------------- acts

export async function addAct(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const episodeId = t(form, "episode_id");
  const { data: last } = await c.supabase.from("studio_acts").select("position").eq("episode_id", episodeId).order("position", { ascending: false }).limit(1);
  const position = (last?.[0]?.position ?? 0) + 1;
  await c.supabase.from("studio_acts").insert({ project_id: id, episode_id: episodeId, position, title: `Act ${position}` });
  refresh(id);
  go(board(id), { ok: "Act added." });
}

export async function renameAct(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  await c.supabase.from("studio_acts").update({ title: clip(t(form, "title"), 120) }).eq("id", t(form, "act_id")).eq("project_id", id);
  refresh(id);
  go(board(id), { ok: "Act renamed." });
}

export async function deleteAct(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const actId = t(form, "act_id");
  const { count } = await c.supabase.from("studio_scenes").select("id", { count: "exact", head: true }).eq("act_id", actId);
  if ((count ?? 0) > 0) go(board(id), { error: "Move or delete this act's scenes first." });
  await c.supabase.from("studio_acts").delete().eq("id", actId).eq("project_id", id);
  refresh(id);
  go(board(id), { ok: "Act deleted." });
}

// ---------------------------------------------------------------- scenes

export async function addScene(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const actId = t(form, "act_id");
  const { data: act } = await c.supabase.from("studio_acts").select("episode_id").eq("id", actId).eq("project_id", id).maybeSingle();
  if (!act) go(board(id), { error: "That act doesn't exist." });
  const { data: last } = await c.supabase.from("studio_scenes").select("position").eq("act_id", actId).order("position", { ascending: false }).limit(1);
  const { data: sc } = await c.supabase
    .from("studio_scenes")
    .insert({ project_id: id, episode_id: act.episode_id, act_id: actId, position: (last?.[0]?.position ?? 0) + 1, title: "New scene" })
    .select("id")
    .single();
  refresh(id);
  go(board(id, sc ? `?scene=${sc.id}` : ""), { ok: "Scene added. Fill it in on the right." });
}

export async function saveScene(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const sceneId = t(form, "scene_id");
  const step = Number(t(form, "chain_step"));
  const { error } = await c.supabase
    .from("studio_scenes")
    .update({
      title: clip(t(form, "title"), 120),
      purpose: clip(t(form, "purpose"), 120) || null,
      beat: clip(t(form, "beat"), 600) || null,
      characters: list(t(form, "characters")),
      location: clip(t(form, "location"), 120) || null,
      props_introduced: list(t(form, "props_introduced")),
      props_used: list(t(form, "props_used")),
      plants: list(t(form, "plants")),
      payoffs: list(t(form, "payoffs")),
      chain: clip(t(form, "chain"), 60) || null,
      chain_step: t(form, "chain") && Number.isInteger(step) && step > 0 ? step : null,
      reader_choice: clip(t(form, "reader_choice"), 300) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sceneId)
    .eq("project_id", id);
  if (error) go(board(id, `?scene=${sceneId}`), { error: "Couldn't save the scene." });
  refresh(id);
  go(board(id, `?scene=${sceneId}`), { ok: "Scene saved." });
}

export async function deleteScene(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const sceneId = t(form, "scene_id");
  if (t(form, "confirm") !== "delete") go(board(id, `?scene=${sceneId}`), { error: "Type delete to confirm." });
  await c.supabase.from("studio_scenes").delete().eq("id", sceneId).eq("project_id", id);
  refresh(id);
  go(board(id), { ok: "Scene deleted." });
}

async function sceneAndAct(c: Awaited<ReturnType<typeof ctx>>, id: string, sceneId: string) {
  const { data: s } = await c.supabase.from("studio_scenes").select("*").eq("id", sceneId).eq("project_id", id).maybeSingle();
  if (!s) return null;
  const { data: siblings } = await c.supabase.from("studio_scenes").select("*").eq("act_id", s.act_id).order("position");
  return { s, siblings: siblings ?? [] };
}

async function renumberAct(c: Awaited<ReturnType<typeof ctx>>, ids: string[]) {
  for (let i = 0; i < ids.length; i++) await c.supabase.from("studio_scenes").update({ position: i + 1 }).eq("id", ids[i]);
}

export async function splitScene(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const sceneId = t(form, "scene_id");
  const found = await sceneAndAct(c, id, sceneId);
  if (!found) go(board(id), { error: "That scene doesn't exist." });
  const { s, siblings } = found;
  await snapshotOrder(c, id, "Before splitting a scene");
  const { data: part2 } = await c.supabase
    .from("studio_scenes")
    .insert({
      project_id: id,
      episode_id: s.episode_id,
      act_id: s.act_id,
      position: s.position + 1,
      title: clip(`${s.title} (part 2)`, 120),
      purpose: s.purpose,
      characters: s.characters,
      location: s.location,
    })
    .select("id")
    .single();
  if (part2) {
    const ids = siblings.map((x) => x.id);
    ids.splice(ids.indexOf(sceneId) + 1, 0, part2.id);
    await renumberAct(c, ids);
  }
  refresh(id);
  go(board(id, part2 ? `?scene=${part2.id}` : ""), { ok: "Scene split. Part 2 is selected: give it its own beat." });
}

export async function mergeWithNext(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const sceneId = t(form, "scene_id");
  const found = await sceneAndAct(c, id, sceneId);
  if (!found) go(board(id), { error: "That scene doesn't exist." });
  const { s, siblings } = found;
  const i = siblings.findIndex((x) => x.id === sceneId);
  const next = siblings[i + 1];
  if (!next) go(board(id, `?scene=${sceneId}`), { error: "There's no next scene in this act to merge with." });
  await snapshotOrder(c, id, "Before merging scenes");
  const u = (a: string[], b: string[]) => Array.from(new Set([...(a ?? []), ...(b ?? [])])).slice(0, 12);
  await c.supabase
    .from("studio_scenes")
    .update({
      title: clip(`${s.title} + ${next.title}`, 120),
      beat: clip([s.beat, next.beat].filter(Boolean).join(" Then: "), 600) || null,
      characters: u(s.characters, next.characters),
      props_introduced: u(s.props_introduced, next.props_introduced),
      props_used: u(s.props_used, next.props_used),
      plants: u(s.plants, next.plants),
      payoffs: u(s.payoffs, next.payoffs),
      reader_choice: s.reader_choice ?? next.reader_choice,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sceneId);
  await c.supabase.from("studio_scenes").delete().eq("id", next.id);
  await renumberAct(c, siblings.filter((x) => x.id !== next.id).map((x) => x.id));
  refresh(id);
  go(board(id, `?scene=${sceneId}`), { ok: "Scenes merged." });
}

// ---------------------------------------------------------------- drag-and-drop order (called from the board)

export async function saveBoardOrder(projectId: string, order: BoardOrder): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx(projectId);
  const eps = await loadStructure(c.supabase, projectId);
  await writeVersion(c.supabase, projectId, "structure_order", { order: orderSnapshot(eps), undone: false }, "Scene moved", c.user.id);
  const err = await applyOrder(c.supabase, projectId, eps, order);
  refresh(projectId);
  return err ? { ok: false, error: err } : { ok: true };
}

// ---------------------------------------------------------------- undo

export async function undoLastMove(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const { data: v } = await c.supabase
    .from("studio_versions")
    .select("id,snapshot,reason")
    .eq("item_type", "structure_order")
    .eq("item_id", id)
    .eq("snapshot->>undone", "false")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!v) go(board(id), { error: "There's nothing to undo." });
  const snap = v.snapshot as { order: { episode_id: string; acts: { act_id: string; scene_ids: string[] }[] }[] };
  const eps = await loadStructure(c.supabase, id);
  const known = new Set(eps.flatMap((e) => e.acts.flatMap((a) => a.scenes.map((s) => s.id))));
  const actsNow = new Set(eps.flatMap((e) => e.acts.map((a) => a.id)));
  // Rebuild the order, ignoring scenes/acts deleted since and appending scenes added since.
  const order = snap.order.flatMap((e) => e.acts.filter((a) => actsNow.has(a.act_id)).map((a) => ({ actId: a.act_id, sceneIds: a.scene_ids.filter((s) => known.has(s)) })));
  const placed = new Set(order.flatMap((o) => o.sceneIds));
  for (const e of eps)
    for (const a of e.acts)
      for (const s of a.scenes)
        if (!placed.has(s.id)) {
          let entry = order.find((o) => o.actId === a.id);
          if (!entry) order.push((entry = { actId: a.id, sceneIds: [] }));
          entry.sceneIds.push(s.id);
        }
  const epOrder = snap.order.map((e) => e.episode_id).filter((x) => eps.some((e) => e.id === x));
  for (const e of eps) if (!epOrder.includes(e.id)) epOrder.push(e.id);

  const err = await applyOrder(c.supabase, id, eps, order);
  if (err) go(board(id), { error: err });
  await renumber(c, id, epOrder);
  await c.supabase.from("studio_versions").update({ snapshot: { ...snap, undone: true } }).eq("id", v.id);
  refresh(id);
  go(board(id), { ok: `Undone: ${v.reason ?? "last change"}.` });
}

// ---------------------------------------------------------------- Claude

export async function draftStructure(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const s = await loadStory(c.supabase, id);
  const eps = await loadStructure(c.supabase, id);
  if (!s) go("/studio", { error: "That project doesn't exist." });
  if (eps.some((e) => e.acts.some((a) => a.scenes.length))) go(board(id), { error: "The board already has scenes. Claude only drafts an empty board." });
  const r = await runStructureAction<DraftStructure>(c.supabase, s, eps, { kind: "draft" });
  if (!r.ok) go(board(id), { error: r.reason });

  // Remove empty placeholder episodes, then insert the draft.
  if (eps.length) await c.supabase.from("studio_episodes").delete().eq("project_id", id);
  const milestoneByTitle = new Map(s.milestones.map((m) => [m.title.trim().toLowerCase(), m.id]));
  let n = 0;
  for (const [ei, e] of (r.data.episodes ?? []).slice(0, 20).entries()) {
    const { data: ep } = await c.supabase
      .from("studio_episodes")
      .insert({
        project_id: id,
        number: ei + 1,
        title: clip(e.title || `Episode ${ei + 1}`, 120),
        summary: clip(e.summary ?? "", 1000) || null,
        milestone_id: milestoneByTitle.get((e.milestone ?? "").trim().toLowerCase()) ?? null,
      })
      .select("id")
      .single();
    if (!ep) continue;
    for (const [ai, a] of (e.acts ?? []).slice(0, 6).entries()) {
      const { data: act } = await c.supabase
        .from("studio_acts")
        .insert({ project_id: id, episode_id: ep.id, position: ai + 1, title: clip(a.title || `Act ${ai + 1}`, 120) })
        .select("id")
        .single();
      if (!act) continue;
      const rows = (a.scenes ?? []).slice(0, 12).map((sc, si) => ({
        project_id: id,
        episode_id: ep.id,
        act_id: act.id,
        position: si + 1,
        title: clip(sc.title ?? "", 120),
        purpose: clip(sc.purpose ?? "", 120) || null,
        beat: clip(sc.beat ?? "", 600) || null,
        characters: (sc.characters ?? []).slice(0, 12).map((x) => clip(x, 80)),
        location: clip(sc.location ?? "", 120) || null,
        props_introduced: (sc.props_introduced ?? []).slice(0, 12).map((x) => clip(x, 80)),
        props_used: (sc.props_used ?? []).slice(0, 12).map((x) => clip(x, 80)),
        plants: (sc.plants ?? []).slice(0, 12).map((x) => clip(x, 80)),
        payoffs: (sc.payoffs ?? []).slice(0, 12).map((x) => clip(x, 80)),
        chain: clip(sc.chain ?? "", 60) || null,
        chain_step: sc.chain && sc.chain_step > 0 ? sc.chain_step : null,
        reader_choice: clip(sc.reader_choice ?? "", 300) || null,
      }));
      if (rows.length) await c.supabase.from("studio_scenes").insert(rows);
      n += rows.length;
    }
  }
  const after = await loadStructure(c.supabase, id);
  await writeVersion(c.supabase, id, "structure", { episodes: after }, "Claude drafted the structure", c.user.id);
  refresh(id);
  go(board(id), { ok: `Structure drafted: ${after.length} episode(s), ${n} scenes. Check the warnings (${r.note})` });
}

export async function suggestReorder(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const s = await loadStory(c.supabase, id);
  const eps = await loadStructure(c.supabase, id);
  if (!s) go("/studio", { error: "That project doesn't exist." });
  if (!eps.some((e) => e.acts.some((a) => a.scenes.length > 1))) go(board(id), { error: "Add a few scenes first." });
  const r = await runStructureAction<ReorderReply>(c.supabase, s, eps, { kind: "reorder" });
  if (!r.ok) go(board(id), { error: r.reason });

  // Validate: same episodes, same acts per episode, every scene exactly once, no cross-episode moves.
  const proposed = r.data.episodes ?? [];
  const valid =
    proposed.length === eps.length &&
    eps.every((e) => {
      const pe = proposed.find((x) => x.episode_id === e.id);
      if (!pe) return false;
      const actIds = new Set(e.acts.map((a) => a.id));
      if (pe.acts.length !== e.acts.length || !pe.acts.every((a) => actIds.has(a.act_id))) return false;
      const mine = e.acts.flatMap((a) => a.scenes.map((x) => x.id)).sort();
      const theirs = pe.acts.flatMap((a) => a.scene_ids).sort();
      return mine.length === theirs.length && mine.every((x, i) => x === theirs[i]);
    });
  if (!valid) go(board(id), { error: `Claude's suggested order didn't match the board, so it was ignored (${r.note})` });

  await c.supabase.from("studio_suggestions").update({ status: "rejected" }).eq("project_id", id).eq("kind", "reorder").eq("status", "pending");
  await c.supabase.from("studio_suggestions").insert({
    project_id: id,
    kind: "reorder",
    text: clip(r.data.summary ?? "Suggested reorder", 1000),
    payload: { episodes: proposed, reasons: (r.data.reasons ?? []).slice(0, 40) },
  });
  refresh(id);
  go(board(id), { ok: `Claude suggested a reorder. Review the changes before accepting (${r.note})` });
}

export async function acceptReorder(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  const { data: sg } = await c.supabase
    .from("studio_suggestions")
    .select("id,payload,status")
    .eq("id", t(form, "suggestion_id"))
    .eq("project_id", id)
    .maybeSingle();
  if (!sg || sg.status !== "pending") go(board(id), { error: "That suggestion is no longer pending." });
  const p = sg.payload as ReorderReply;
  const eps = await loadStructure(c.supabase, id);
  await writeVersion(c.supabase, id, "structure_order", { order: orderSnapshot(eps), undone: false }, "Claude's reorder accepted", c.user.id);
  const order: BoardOrder = p.episodes.flatMap((e) => e.acts.map((a) => ({ actId: a.act_id, sceneIds: a.scene_ids })));
  const err = await applyOrder(c.supabase, id, eps, order);
  if (err) go(board(id), { error: err });
  await c.supabase.from("studio_suggestions").update({ status: "accepted" }).eq("id", sg.id);
  refresh(id);
  go(board(id), { ok: "Reorder applied. Use “Undo last move” to put it back." });
}

export async function rejectReorder(form: FormData) {
  const id = t(form, "project_id");
  const c = await ctx(id);
  await c.supabase.from("studio_suggestions").update({ status: "rejected" }).eq("id", t(form, "suggestion_id")).eq("project_id", id);
  refresh(id);
  go(board(id), { ok: "Suggestion rejected." });
}
