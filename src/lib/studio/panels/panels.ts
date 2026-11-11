import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiImageStart, type ImageRef } from "../ai/aiCall";
import { loadAssets, loadGate, loadTakes, usedIn } from "../assets/assets";
import { readStudioFile } from "../assets/storage";
import { activeLessons } from "../lessons/lessons";
import { listVersions, loadPanels, loadProps } from "../script/script";
import type { ScriptPanel } from "../script/types";
import { loadStory } from "../story/story";
import { getStudioSettings } from "../settings";
import { autoQa } from "./autoqa";
import { defaultLayout } from "./letter";
import { buildPanelPrompt, scriptHash } from "./prompt";
import { ASPECT_BY_SIZE, PANEL_ROW_COLS, PANEL_TAKE_COLS, type PanelRow, type PanelSize, type PanelTake } from "./types";

export async function loadPanelContext(supabase: SupabaseClient, projectId: string, episodeId: string) {
  const [story, settings, props, assetsAll, versions, assetsGate, scriptGate] = await Promise.all([
    loadStory(supabase, projectId),
    getStudioSettings(supabase),
    loadProps(supabase, projectId),
    loadAssets(supabase, projectId),
    listVersions(supabase, episodeId),
    loadGate(supabase, projectId, episodeId, "assets_approved"),
    loadGate(supabase, projectId, episodeId, "script_final"),
  ]);
  const script = versions[0] ?? null;
  const panels: ScriptPanel[] = script ? await loadPanels(supabase, script.id) : [];
  const assets = assetsAll.filter((a) => usedIn(a, episodeId));
  const assetTakes = await loadTakes(supabase, assets.map((a) => a.id));
  const pickedPaths: Record<string, string | null> = {};
  for (const a of assets) pickedPaths[a.id] = a.picked_take_id ? assetTakes.find((t) => t.id === a.picked_take_id)?.storage_path ?? null : null;

  // One art row per script panel (by its stable key), created with a starter lettering layout.
  const { data: existing } = await supabase.from("studio_panels").select(PANEL_ROW_COLS).eq("episode_id", episodeId);
  const have = new Set((existing ?? []).map((r) => r.panel_key as string));
  const missing = panels.filter((p) => !have.has(p.panel_key));
  if (missing.length) {
    await supabase
      .from("studio_panels")
      .upsert(missing.map((p) => ({ project_id: projectId, episode_id: episodeId, panel_key: p.panel_key, letter_layout: defaultLayout(p) })), { onConflict: "episode_id,panel_key", ignoreDuplicates: true });
  }
  const { data: rowsData } = missing.length ? await supabase.from("studio_panels").select(PANEL_ROW_COLS).eq("episode_id", episodeId) : { data: existing };
  const rows = new Map(((rowsData ?? []) as PanelRow[]).map((r) => [r.panel_key, r]));
  const { data: takesData } = await supabase
    .from("studio_takes")
    .select(PANEL_TAKE_COLS)
    .eq("episode_id", episodeId)
    .not("panel_key", "is", null)
    .order("created_at", { ascending: false });
  const takes = ((takesData ?? []) as PanelTake[]).map((t) => ({ ...t, cost_usd: Number(t.cost_usd) }));
  return { story, settings, props, assets, pickedPaths, script, panels, rows, takes, assetsGate, scriptGate };
}

export type PanelContext = Awaited<ReturnType<typeof loadPanelContext>>;

export async function buildFor(supabase: SupabaseClient, ctx: PanelContext, panelKey: string, fix?: { takeId: string; change: string }) {
  const i = ctx.panels.findIndex((p) => p.panel_key === panelKey);
  const panel = ctx.panels[i];
  if (!panel || !ctx.story) return null;
  const characters = ctx.story.characters;
  const lessons = await activeLessons(supabase, "art", ctx.story.project.id, panel.characters);
  let matched: { number: number; path: string | null } | null = null;
  if (panel.matches_key) {
    const j = ctx.panels.findIndex((p) => p.panel_key === panel.matches_key);
    if (j !== -1 && j < i) {
      const row = ctx.rows.get(panel.matches_key);
      const chosen = row?.chosen_take_id ? ctx.takes.find((t) => t.id === row.chosen_take_id) : null;
      matched = { number: j + 1, path: chosen?.storage_path ?? null };
    }
  }
  const parent = fix ? ctx.takes.find((t) => t.id === fix.takeId && t.panel_key === panelKey) : null;
  const built = buildPanelPrompt({
    panel,
    characters,
    props: ctx.props,
    episodeAssets: ctx.assets,
    pickedPaths: ctx.pickedPaths,
    direction: ctx.rows.get(panelKey)?.direction ?? null,
    lessons,
    matched,
    fix: parent?.storage_path && fix ? { path: parent.storage_path, change: fix.change } : null,
  });
  return { built, panel, index: i };
}

const typeOf = (p: string) => (p.endsWith(".jpg") || p.endsWith(".jpeg") ? "image/jpeg" : p.endsWith(".webp") ? "image/webp" : "image/png");

/** Starts ONE final 2K take for ONE panel. Never loops over other panels. */
export async function startPanelTake(
  supabase: SupabaseClient,
  ctx: PanelContext,
  panelKey: string,
  fix?: { takeId: string; change: string },
): Promise<{ ok: true; dryRun: boolean; estimate: number; warn: boolean; percent: number } | { ok: false; reason: string }> {
  const b = await buildFor(supabase, ctx, panelKey, fix);
  if (!b || !ctx.story) return { ok: false, reason: "That panel isn't in the current script." };
  const { built, panel } = b;
  const references: ImageRef[] = [];
  for (const [n, r] of built.refs.entries()) {
    const bytes = await readStudioFile(supabase, r.path);
    if (!bytes) return { ok: false, reason: `Couldn't read reference ${n + 1} (${r.label}).` };
    references.push({ name: `ref-${n + 1}.${r.path.split(".").pop()}`, bytes, type: typeOf(r.path) });
  }
  const size = (panel.size as PanelSize) ?? "mid";
  const r = await aiImageStart({
    supabase,
    projectId: ctx.story.project.id,
    episodeId: panel ? ctx.rows.get(panelKey)?.episode_id ?? null : null,
    purpose: `Panel ${b.index + 1}${fix ? " fix" : ""}: ${panel.title}`.slice(0, 200),
    size: "2K",
    aspect: ASPECT_BY_SIZE[size],
    prompt: built.prompt,
    references,
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  const episodeId = ctx.rows.get(panelKey)!.episode_id;
  let jobId: string | null = null;
  if (!r.dryRun) {
    const { data: job } = await supabase
      .from("studio_jobs")
      .insert({ project_id: ctx.story.project.id, episode_id: episodeId, task_id: r.taskId, status: "running", ai_call_id: r.ledgerId, credits_before: r.creditsBefore })
      .select("id")
      .single();
    jobId = job?.id ?? null;
  }
  const { error } = await supabase.from("studio_takes").insert({
    project_id: ctx.story.project.id,
    episode_id: episodeId,
    panel_key: panelKey,
    kind: "final",
    status: r.dryRun ? "dry_run" : "pending",
    prompt: built.prompt,
    model: r.model,
    size: "2K",
    aspect: ASPECT_BY_SIZE[size],
    cost_usd: r.dryRun ? 0 : r.estimatedUsd,
    ai_call_id: r.ledgerId,
    job_id: jobId,
    lessons_applied: built.lessons,
    refs: built.refs,
    parent_take_id: fix?.takeId ?? null,
    change_note: fix?.change ?? null,
    script_hash: scriptHash(panel),
  });
  if (error) return { ok: false, reason: error.message.includes("Script final") ? "No panel art before Script final." : "Couldn't save the take." };
  return { ok: true, dryRun: r.dryRun, estimate: r.estimatedUsd, warn: r.warn, percent: r.percent };
}

/** Free checks on a finished panel image; called when a job finishes or a master is imported. */
export async function runAutoQa(supabase: SupabaseClient, takeId: string, bytes?: Uint8Array) {
  const { data: take } = await supabase.from("studio_takes").select("id,project_id,episode_id,panel_key,storage_path").eq("id", takeId).maybeSingle();
  if (!take?.panel_key || !take.episode_id || !take.storage_path) return;
  const img = bytes ?? (await readStudioFile(supabase, take.storage_path));
  if (!img) return;
  const ctx = await loadPanelContext(supabase, take.project_id, take.episode_id);
  const i = ctx.panels.findIndex((p) => p.panel_key === take.panel_key);
  const panel = ctx.panels[i];
  if (!panel) return;
  const chars = (ctx.story?.characters ?? []).filter((c) => panel.characters.some((n) => n.trim().toLowerCase() === c.name.trim().toLowerCase()));
  let pair: { number: number; bytes: Uint8Array } | null = null;
  if (panel.matches_key) {
    const j = ctx.panels.findIndex((p) => p.panel_key === panel.matches_key);
    const row = ctx.rows.get(panel.matches_key);
    const chosen = row?.chosen_take_id ? ctx.takes.find((t) => t.id === row.chosen_take_id) : null;
    const pb = chosen?.storage_path ? await readStudioFile(supabase, chosen.storage_path) : null;
    if (pb) pair = { number: j + 1, bytes: pb };
  }
  const earlier: { label: string; bytes: Uint8Array }[] = [];
  const prev = ctx.takes.filter((t) => t.panel_key === take.panel_key && t.id !== take.id && t.storage_path && t.status === "ready").slice(0, 3);
  for (const t of prev) {
    const eb = await readStudioFile(supabase, t.storage_path!);
    if (eb) earlier.push({ label: `an earlier take (${new Date(t.created_at).toLocaleDateString("en-GB")})`, bytes: eb });
  }
  for (const a of ctx.assets) {
    const p = ctx.pickedPaths[a.id];
    if (!p || !chars.some((c) => c.name.toLowerCase() === a.name.toLowerCase())) continue;
    const ab = await readStudioFile(supabase, p);
    if (ab) earlier.push({ label: `${a.name}'s reference design`, bytes: ab });
  }
  const checks = await autoQa(img, { size: (panel.size as PanelSize) ?? "mid", characters: chars, pair, earlier });
  await supabase.from("studio_takes").update({ auto_qa: checks }).eq("id", take.id);
}
