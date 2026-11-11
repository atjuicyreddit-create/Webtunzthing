import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Act, Episode, Scene } from "./types";

const SCENE_COLS =
  "id,episode_id,act_id,position,title,purpose,beat,characters,location,props_introduced,props_used,plants,payoffs,chain,chain_step,reader_choice";

export async function loadStructure(supabase: SupabaseClient, projectId: string): Promise<Episode[]> {
  const [epsWithRoute, acts, scenes] = await Promise.all([
    supabase.from("studio_episodes").select("id,number,title,summary,milestone_id,reader_route").eq("project_id", projectId).order("number"),
    supabase.from("studio_acts").select("id,episode_id,position,title").eq("project_id", projectId).order("position"),
    supabase.from("studio_scenes").select(SCENE_COLS).eq("project_id", projectId).order("position"),
  ]);
  // Before the Stage 8 database update, reader_route doesn't exist yet: load without it.
  const eps = epsWithRoute.error
    ? await supabase.from("studio_episodes").select("id,number,title,summary,milestone_id").eq("project_id", projectId).order("number")
    : epsWithRoute;
  const byAct = new Map<string, Scene[]>();
  for (const s of (scenes.data ?? []) as Scene[]) {
    const list = byAct.get(s.act_id) ?? [];
    list.push(s);
    byAct.set(s.act_id, list);
  }
  const byEp = new Map<string, Act[]>();
  for (const a of (acts.data ?? []) as Omit<Act, "scenes">[]) {
    const list = byEp.get(a.episode_id) ?? [];
    list.push({ ...a, scenes: byAct.get(a.id) ?? [] });
    byEp.set(a.episode_id, list);
  }
  return ((eps.data ?? []) as Omit<Episode, "acts">[]).map((e) => ({ ...e, acts: byEp.get(e.id) ?? [] }));
}

/** Compact snapshot of the order (for undo) and of the whole structure (for history). */
export function orderSnapshot(episodes: Episode[]) {
  return episodes.map((e) => ({
    episode_id: e.id,
    acts: e.acts.map((a) => ({ act_id: a.id, scene_ids: a.scenes.map((s) => s.id) })),
  }));
}

export async function writeVersion(
  supabase: SupabaseClient,
  projectId: string,
  itemType: "structure" | "structure_order",
  snapshot: unknown,
  reason: string,
  userId: string,
) {
  const { data: last } = await supabase
    .from("studio_versions")
    .select("version")
    .eq("item_type", itemType)
    .eq("item_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from("studio_versions").insert({
    project_id: projectId,
    item_type: itemType,
    item_id: projectId,
    version: (last?.version ?? 0) + 1,
    snapshot,
    reason,
    created_by: userId,
  });
}

/** Applies an order: every act gets its scene list in this order (scenes may move between acts). */
export async function applyOrder(
  supabase: SupabaseClient,
  projectId: string,
  episodes: Episode[],
  order: { actId: string; sceneIds: string[] }[],
): Promise<string | null> {
  const actEpisode = new Map<string, string>();
  for (const e of episodes) for (const a of e.acts) actEpisode.set(a.id, e.id);
  const allScenes = new Set(episodes.flatMap((e) => e.acts.flatMap((a) => a.scenes.map((s) => s.id))));
  const seen = new Set<string>();
  for (const o of order) {
    if (!actEpisode.has(o.actId)) return "The board changed. Reload and try again.";
    for (const id of o.sceneIds) {
      if (!allScenes.has(id) || seen.has(id)) return "The board changed. Reload and try again.";
      seen.add(id);
    }
  }
  if (seen.size !== allScenes.size) return "Some scenes are missing from the new order. Reload and try again.";

  for (const o of order) {
    for (let i = 0; i < o.sceneIds.length; i++) {
      const { error } = await supabase
        .from("studio_scenes")
        .update({ act_id: o.actId, episode_id: actEpisode.get(o.actId), position: i + 1 })
        .eq("id", o.sceneIds[i])
        .eq("project_id", projectId);
      if (error) return "Couldn't save the new order.";
    }
  }
  return null;
}
