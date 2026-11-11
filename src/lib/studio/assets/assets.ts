import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listVersions, loadPanels, loadProps } from "../script/script";
import type { Character } from "../story/story";
import type { Episode } from "../structure/types";
import { detectAssets } from "./detect";
import { templatePrompt } from "./prompts";
import { ASSET_COLS, DEFAULT_ASPECT, TAKE_COLS, type Asset, type Take } from "./types";

export type AssetGate = {
  id: string;
  state: "open" | "approved" | "stale";
  fingerprint: string | null;
  approved_at: string | null;
  note: string | null;
};

export async function loadAssets(supabase: SupabaseClient, projectId: string): Promise<Asset[]> {
  const { data } = await supabase.from("studio_assets").select(ASSET_COLS).eq("project_id", projectId).order("kind").order("name");
  return (data ?? []) as Asset[];
}

export async function loadTakes(supabase: SupabaseClient, assetIds: string[]): Promise<Take[]> {
  if (!assetIds.length) return [];
  const { data } = await supabase.from("studio_takes").select(TAKE_COLS).in("asset_id", assetIds).order("created_at", { ascending: false });
  return ((data ?? []) as Take[]).map((t) => ({ ...t, cost_usd: Number(t.cost_usd) }));
}

export async function loadGate(
  supabase: SupabaseClient,
  projectId: string,
  episodeId: string,
  gate: "script_final" | "assets_approved",
): Promise<AssetGate | null> {
  const { data } = await supabase
    .from("studio_gates")
    .select("id,state,fingerprint,approved_at,note")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("gate", gate)
    .maybeSingle();
  return (data as AssetGate) ?? null;
}

/** Episodes whose Script final gate is approved, with the approved (current) version's panels. */
export async function finalScripts(supabase: SupabaseClient, projectId: string) {
  const { data: gates } = await supabase
    .from("studio_gates")
    .select("episode_id")
    .eq("project_id", projectId)
    .eq("gate", "script_final")
    .eq("state", "approved");
  const out = [];
  for (const g of gates ?? []) {
    if (!g.episode_id) continue;
    const [current] = await listVersions(supabase, g.episode_id);
    if (current) out.push({ episodeId: g.episode_id as string, panels: await loadPanels(supabase, current.id) });
  }
  return out;
}

/** Finds the assets the final scripts need. Adds new ones (with a starter prompt) and refreshes where each is used. */
export async function syncAssets(supabase: SupabaseClient, projectId: string, characters: Character[], episodes: Episode[]) {
  const scripts = await finalScripts(supabase, projectId);
  const props = await loadProps(supabase, projectId);
  const scenes = episodes.flatMap((e) => e.acts.flatMap((a) => a.scenes));
  const found = detectAssets({ scripts, characters, props, scenes });
  const existing = await loadAssets(supabase, projectId);
  const byKey = new Map(existing.map((a) => [`${a.kind}:${a.name.trim().toLowerCase()}`, a]));
  const sheets = new Map(characters.map((c) => [c.id, c.sheet]));

  let added = 0;
  const seen = new Set<string>();
  for (const f of found) {
    const k = `${f.kind}:${f.name.trim().toLowerCase()}`;
    seen.add(k);
    const a = byKey.get(k);
    if (!a) {
      const { error } = await supabase.from("studio_assets").insert({
        project_id: projectId,
        kind: f.kind,
        scope: f.scope,
        act_id: f.act_id,
        character_id: f.character_id,
        name: f.name,
        description: f.description || null,
        prompt: templatePrompt(f.kind, f.name, f.description, f.character_id ? sheets.get(f.character_id) : null),
        aspect: DEFAULT_ASPECT[f.kind],
        uses: f.uses,
      });
      if (!error) added++;
    } else {
      // Keep any manual (unscripted) uses Tom added for episodes without detections.
      const manual = Object.fromEntries(Object.entries(a.uses).filter(([ep, panels]) => panels.length === 0 && !(ep in f.uses)));
      await supabase
        .from("studio_assets")
        .update({ uses: { ...manual, ...f.uses }, character_id: a.character_id ?? f.character_id })
        .eq("id", a.id);
    }
  }
  // Assets no longer in any final script keep their designs but lose their scripted uses.
  for (const a of existing) {
    if (seen.has(`${a.kind}:${a.name.trim().toLowerCase()}`)) continue;
    const manual = Object.fromEntries(Object.entries(a.uses).filter(([, panels]) => panels.length === 0));
    if (JSON.stringify(manual) !== JSON.stringify(a.uses)) await supabase.from("studio_assets").update({ uses: manual }).eq("id", a.id);
  }
  return { added, total: found.length, scripts: scripts.length };
}

export const usedIn = (a: Asset, episodeId: string) => Object.prototype.hasOwnProperty.call(a.uses ?? {}, episodeId);

/** What the Asset designs approved gate signs off for one episode. */
export function assetFingerprint(assets: Asset[], takes: Take[]): string {
  const picked = new Map(takes.map((t) => [t.id, t.storage_path]));
  const body = assets
    .map((a) => ({ id: a.id, s: a.status, t: a.picked_take_id, f: a.picked_take_id ? picked.get(a.picked_take_id) ?? null : null, p: a.prompt }))
    .sort((x, y) => x.id.localeCompare(y.id));
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

/** After an asset changes: snapshot it, and turn approved asset gates stale where it's used. */
export async function afterAssetChange(supabase: SupabaseClient, asset: Asset, reason: string, userId: string) {
  const { data: fresh } = await supabase.from("studio_assets").select(ASSET_COLS).eq("id", asset.id).maybeSingle();
  const a = (fresh as Asset) ?? asset;
  const { data: last } = await supabase
    .from("studio_versions")
    .select("version")
    .eq("item_type", "asset")
    .eq("item_id", a.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const snap = (x: Asset) => ({ name: x.name, kind: x.kind, prompt: x.prompt, status: x.status, picked_take_id: x.picked_take_id, aspect: x.aspect, scope: x.scope });
  let version = last?.version ?? 0;
  if (!last) {
    // First change: keep the "before" state too, so Undo can go back to it.
    version++;
    await supabase.from("studio_versions").insert({
      project_id: a.project_id, item_type: "asset", item_id: a.id, version, snapshot: snap(asset), reason: "Before the first change", created_by: userId,
    });
  }
  await supabase.from("studio_versions").insert({
    project_id: a.project_id,
    item_type: "asset",
    item_id: a.id,
    version: version + 1,
    snapshot: snap(a),
    reason,
    created_by: userId,
  });
  const eps = Object.keys(a.uses ?? {});
  if (!eps.length) return;
  const { data: gates } = await supabase
    .from("studio_gates")
    .select("id")
    .eq("project_id", a.project_id)
    .eq("gate", "assets_approved")
    .eq("state", "approved")
    .in("episode_id", eps);
  for (const g of gates ?? []) {
    await supabase.from("studio_gates").update({ state: "stale", updated_at: new Date().toISOString() }).eq("id", g.id);
    await supabase.from("studio_gate_events").insert({ gate_id: g.id, action: "stale", actor: userId, note: `${a.name} changed: ${reason}` });
  }
}
