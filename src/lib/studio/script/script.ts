import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fork, Prop, ScriptPanel, ScriptVersion } from "./types";

export const PANEL_COLS =
  "id,panel_key,position,title,shot,camera,characters,action,caption,dialogue,size,gap_after,props,clock,matches_key,text_items,notes";

export const newPanelKey = () => `p${randomBytes(4).toString("hex")}`;

export type ScriptGate = {
  id: string;
  state: "open" | "approved" | "stale";
  fingerprint: string | null;
  approved_at: string | null;
  note: string | null;
};

export async function listVersions(supabase: SupabaseClient, episodeId: string): Promise<ScriptVersion[]> {
  const { data } = await supabase
    .from("studio_scripts")
    .select("id,version,changelog,created_at,check_result,checked_at")
    .eq("episode_id", episodeId)
    .order("version", { ascending: false });
  return (data ?? []) as ScriptVersion[];
}

export async function loadPanels(supabase: SupabaseClient, scriptId: string): Promise<ScriptPanel[]> {
  const { data } = await supabase.from("studio_script_panels").select(PANEL_COLS).eq("script_id", scriptId).order("position");
  return (data ?? []) as ScriptPanel[];
}

export async function loadFork(supabase: SupabaseClient, episodeId: string): Promise<Fork | null> {
  const { data } = await supabase
    .from("studio_forks")
    .select("id,question,in_bounds,locked,backup_pick,branches")
    .eq("episode_id", episodeId)
    .maybeSingle();
  return (data as Fork) ?? null;
}

export async function loadProps(supabase: SupabaseClient, projectId: string): Promise<Prop[]> {
  const { data } = await supabase.from("studio_props").select("id,name,owner,rule").eq("project_id", projectId).order("name");
  return (data ?? []) as Prop[];
}

export async function loadScriptGate(supabase: SupabaseClient, projectId: string, episodeId: string): Promise<ScriptGate | null> {
  const { data } = await supabase
    .from("studio_gates")
    .select("id,state,fingerprint,approved_at,note")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("gate", "script_final")
    .maybeSingle();
  return (data as ScriptGate) ?? null;
}

/** The working copy (highest version). Creates an empty v1 the first time. */
export async function ensureCurrent(supabase: SupabaseClient, projectId: string, episodeId: string): Promise<ScriptVersion> {
  const versions = await listVersions(supabase, episodeId);
  if (versions[0]) return versions[0];
  const { data } = await supabase
    .from("studio_scripts")
    .insert({ project_id: projectId, episode_id: episodeId, version: 1, changelog: "First version" })
    .select("id,version,changelog,created_at,check_result,checked_at")
    .single();
  if (data) return data as ScriptVersion;
  // Two page loads can race to create v1; the loser's insert fails, so read the winner's row.
  for (let i = 0; i < 5; i++) {
    const again = await listVersions(supabase, episodeId);
    if (again[0]) return again[0];
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Couldn't create the first script version.");
}

/** Copies a version's panels into a new version and returns it. */
export async function copyToNewVersion(
  supabase: SupabaseClient,
  projectId: string,
  episodeId: string,
  fromScriptId: string,
  changelog: string,
): Promise<ScriptVersion | null> {
  const versions = await listVersions(supabase, episodeId);
  const next = (versions[0]?.version ?? 0) + 1;
  const { data: created } = await supabase
    .from("studio_scripts")
    .insert({ project_id: projectId, episode_id: episodeId, version: next, changelog })
    .select("id,version,changelog,created_at,check_result,checked_at")
    .single();
  if (!created) return null;
  const panels = await loadPanels(supabase, fromScriptId);
  if (panels.length) {
    await supabase.from("studio_script_panels").insert(
      panels.map((p) => {
        const { id: _drop, ...rest } = p;
        void _drop;
        return { ...rest, script_id: created.id };
      }),
    );
  }
  return created as ScriptVersion;
}

export function scriptFingerprint(version: number, panels: ScriptPanel[], fork: Fork | null): string {
  const body = {
    version,
    panels: panels.map((p) => {
      const { id: _id, ...rest } = p;
      void _id;
      return rest;
    }),
    fork: fork ? { q: fork.question, b: fork.in_bounds, l: fork.locked, k: fork.backup_pick, br: fork.branches } : null,
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

/** After any script edit: clear the version's check (it no longer matches) and mark an approved gate stale. */
export async function afterScriptChange(
  supabase: SupabaseClient,
  projectId: string,
  episodeId: string,
  scriptId: string,
  reason: string,
  userId: string,
) {
  await supabase.from("studio_scripts").update({ check_result: null, checked_at: null }).eq("id", scriptId);
  const gate = await loadScriptGate(supabase, projectId, episodeId);
  if (gate?.state === "approved") {
    await supabase.from("studio_gates").update({ state: "stale", updated_at: new Date().toISOString() }).eq("id", gate.id);
    await supabase.from("studio_gate_events").insert({ gate_id: gate.id, action: "stale", actor: userId, note: `Script changed after approval: ${reason}` });
  }
}
