"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withParams } from "@/lib/studio/url";
import { requireStudio } from "@/lib/studio/auth";
import { freeChecks } from "@/lib/studio/script/checks";
import { runScriptAction, type DraftScript } from "@/lib/studio/script/prompts";
import {
  afterScriptChange,
  copyToNewVersion,
  ensureCurrent,
  listVersions,
  loadFork,
  loadPanels,
  loadProps,
  loadScriptGate,
  newPanelKey,
  scriptFingerprint,
} from "@/lib/studio/script/script";
import type { CheckResult, Dialogue, PanelProp, TextItem } from "@/lib/studio/script/types";
import { loadStructure } from "@/lib/studio/structure/structure";
import { loadStory } from "@/lib/studio/story/story";

// One server action per button. Every action re-checks access; the database rules apply too.

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clip = (s: string, n: number) => s.slice(0, n);
const lines = (s: string, n: number) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, n);

const page = (id: string, ep: string, extra = "") => `/studio/projects/${id}/script?ep=${ep}${extra}`;
function go(path: string, params: Record<string, string>): never {
  redirect(withParams(path, params));
}

async function ctx(form: FormData) {
  const id = t(form, "project_id");
  const ep = t(form, "episode_id");
  const c = await requireStudio(`/studio/projects/${id}/script`);
  const { data: e } = await c.supabase.from("studio_episodes").select("id,number").eq("id", ep).eq("project_id", id).maybeSingle();
  if (!e) go(`/studio/projects/${id}/script`, { error: "That episode doesn't exist." });
  const current = await ensureCurrent(c.supabase, id, ep);
  return { ...c, id, ep, current };
}
const refresh = (id: string) => revalidatePath(`/studio/projects/${id}/script`);

// ---------------------------------------------------------------- panels

function parseDialogue(s: string): Dialogue[] {
  return lines(s, 6).map((l) => {
    const i = l.indexOf(":");
    return i > 0 ? { speaker: clip(l.slice(0, i).trim(), 40), line: clip(l.slice(i + 1).trim(), 200) } : { speaker: "", line: clip(l, 200) };
  });
}
function parseProps(s: string): PanelProp[] {
  return lines(s, 12).map((l) => {
    const [name, location, state] = l.split("/").map((x) => x.trim());
    return { name: clip(name ?? "", 60), location: clip(location ?? "", 80), state: clip(state ?? "", 80) };
  });
}
function parseTextItems(s: string): TextItem[] {
  return lines(s, 10).map((l) => {
    const m = l.match(/^(.*?)\s*[|(]\s*(lettered|model)\s*\)?\s*$/i);
    return m ? { text: clip(m[1], 120), how: m[2].toLowerCase() as TextItem["how"] } : { text: clip(l, 120), how: "lettered" };
  });
}

export async function savePanel(form: FormData) {
  const c = await ctx(form);
  const key = t(form, "panel_key");
  const size = t(form, "size");
  const gap = Number(t(form, "gap_after"));
  const { error } = await c.supabase
    .from("studio_script_panels")
    .update({
      title: clip(t(form, "title"), 120),
      shot: clip(t(form, "shot"), 120) || null,
      camera: clip(t(form, "camera"), 120) || null,
      characters: t(form, "characters").split(",").map((x) => clip(x.trim(), 60)).filter(Boolean).slice(0, 8),
      action: clip(t(form, "action"), 2000) || null,
      caption: clip(t(form, "caption"), 200) || null,
      dialogue: parseDialogue(t(form, "dialogue")),
      size: ["small", "mid", "tall"].includes(size) ? size : "mid",
      gap_after: Number.isInteger(gap) && gap >= 0 && gap <= 5000 ? gap : 250,
      props: parseProps(t(form, "props")),
      clock: clip(t(form, "clock"), 20) || null,
      matches_key: t(form, "matches_key") || null,
      text_items: parseTextItems(t(form, "text_items")),
      notes: clip(t(form, "notes"), 1000) || null,
    })
    .eq("script_id", c.current.id)
    .eq("panel_key", key);
  if (error) go(page(c.id, c.ep, `&panel=${key}`), { error: "Couldn't save the panel." });
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "Panel edited", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, `&panel=${key}`), { ok: "Panel saved." });
}

async function renumber(c: Awaited<ReturnType<typeof ctx>>, keys: string[]) {
  for (let i = 0; i < keys.length; i++) {
    await c.supabase.from("studio_script_panels").update({ position: i + 1 }).eq("script_id", c.current.id).eq("panel_key", keys[i]);
  }
}

export async function addPanel(form: FormData) {
  const c = await ctx(form);
  const panels = await loadPanels(c.supabase, c.current.id);
  const after = t(form, "after_key");
  const key = newPanelKey();
  await c.supabase.from("studio_script_panels").insert({ script_id: c.current.id, panel_key: key, position: panels.length + 1, title: "New panel" });
  const keys = panels.map((p) => p.panel_key);
  const i = after ? keys.indexOf(after) : keys.length - 1;
  keys.splice(i + 1, 0, key);
  await renumber(c, keys);
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "Panel added", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, `&panel=${key}`), { ok: "Panel added." });
}

async function move(form: FormData, dir: -1 | 1) {
  const c = await ctx(form);
  const panels = await loadPanels(c.supabase, c.current.id);
  const keys = panels.map((p) => p.panel_key);
  const key = t(form, "panel_key");
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= keys.length) go(page(c.id, c.ep, `&panel=${key}`), {});
  [keys[i], keys[j]] = [keys[j], keys[i]];
  await renumber(c, keys);
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "Panels reordered", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, `&panel=${key}`), { ok: "Panel moved." });
}
export async function movePanelUp(form: FormData) {
  return move(form, -1);
}
export async function movePanelDown(form: FormData) {
  return move(form, 1);
}

export async function deletePanel(form: FormData) {
  const c = await ctx(form);
  const key = t(form, "panel_key");
  if (t(form, "confirm") !== "delete") go(page(c.id, c.ep, `&panel=${key}`), { error: "Type delete to confirm." });
  await c.supabase.from("studio_script_panels").delete().eq("script_id", c.current.id).eq("panel_key", key);
  await c.supabase.from("studio_script_panels").update({ matches_key: null }).eq("script_id", c.current.id).eq("matches_key", key);
  const panels = await loadPanels(c.supabase, c.current.id);
  await renumber(c, panels.map((p) => p.panel_key));
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "Panel deleted", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep), { ok: "Panel deleted." });
}

// ---------------------------------------------------------------- versions

export async function startNewVersion(form: FormData) {
  const c = await ctx(form);
  const changelog = clip(t(form, "changelog"), 300);
  if (!changelog) go(page(c.id, c.ep), { error: "Write a one-line changelog for the new version." });
  const v = await copyToNewVersion(c.supabase, c.id, c.ep, c.current.id, changelog);
  if (!v) go(page(c.id, c.ep), { error: "Couldn't start a new version." });
  await afterScriptChange(c.supabase, c.id, c.ep, v.id, `New version v${v.version}`, c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep), { ok: `Started v${v.version}. v${c.current.version} is now frozen.` });
}

export async function restoreVersion(form: FormData) {
  const c = await ctx(form);
  const versions = await listVersions(c.supabase, c.ep);
  const from = versions.find((v) => v.id === t(form, "script_id"));
  if (!from) go(page(c.id, c.ep), { error: "That version doesn't exist." });
  const v = await copyToNewVersion(c.supabase, c.id, c.ep, from.id, `Restored from v${from.version}`);
  if (!v) go(page(c.id, c.ep), { error: "Couldn't restore." });
  await afterScriptChange(c.supabase, c.id, c.ep, v.id, `Restored v${from.version} as v${v.version}`, c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep), { ok: `v${from.version} restored as v${v.version}. Nothing was deleted.` });
}

// ---------------------------------------------------------------- vote card and prop table

export async function saveFork(form: FormData) {
  const c = await ctx(form);
  const branches = lines(t(form, "branches"), 3).map((l) => {
    const [title, summary, rejoins] = l.split("|").map((x) => x.trim());
    return { title: clip(title ?? "", 80), summary: clip(summary ?? "", 300), rejoins: clip(rejoins ?? "", 120) };
  });
  const row = {
    project_id: c.id,
    episode_id: c.ep,
    question: clip(t(form, "question"), 300) || null,
    in_bounds: clip(t(form, "in_bounds"), 500) || null,
    locked: clip(t(form, "locked"), 500) || null,
    backup_pick: clip(t(form, "backup_pick"), 500) || null,
    branches,
    updated_at: new Date().toISOString(),
  };
  const { error } = await c.supabase.from("studio_forks").upsert(row, { onConflict: "episode_id" });
  if (error) go(page(c.id, c.ep), { error: "Couldn't save the end card." });
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "End card edited", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, "#endcard"), { ok: "End card saved." });
}

export async function saveProps(form: FormData) {
  const c = await ctx(form);
  const rows = lines(t(form, "prop_table"), 60).map((l) => {
    const [name, owner, rule] = l.split("|").map((x) => x.trim());
    return { project_id: c.id, name: clip(name ?? "", 60), owner: clip(owner ?? "", 80) || null, rule: clip(rule ?? "", 300) || null };
  });
  const unique = rows.filter((r, i) => r.name && rows.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i);
  await c.supabase.from("studio_props").delete().eq("project_id", c.id);
  if (unique.length) await c.supabase.from("studio_props").insert(unique);
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "Prop table edited", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep, "#props"), { ok: `Prop table saved (${unique.length} props).` });
}

// ---------------------------------------------------------------- Claude

export async function draftScript(form: FormData) {
  const c = await ctx(form);
  const existing = await loadPanels(c.supabase, c.current.id);
  if (existing.length) go(page(c.id, c.ep), { error: "This version already has panels. Claude only drafts an empty script." });
  const s = await loadStory(c.supabase, c.id);
  const eps = await loadStructure(c.supabase, c.id);
  const episode = eps.find((e) => e.id === c.ep);
  if (!s || !episode) go(page(c.id, c.ep), { error: "Couldn't load the story." });
  const props = await loadProps(c.supabase, c.id);
  const r = await runScriptAction<DraftScript>(c.supabase, s, episode, { kind: "draft" }, { panels: [], fork: null, props });
  if (!r.ok) go(page(c.id, c.ep), { error: r.reason });

  const panels = (r.data.panels ?? []).slice(0, 40);
  const keys = panels.map(() => newPanelKey());
  const rows = panels.map((p, i) => ({
    script_id: c.current.id,
    panel_key: keys[i],
    position: i + 1,
    title: clip(p.title ?? "", 120),
    shot: clip(p.shot ?? "", 120) || null,
    camera: clip(p.camera ?? "", 120) || null,
    characters: (p.characters ?? []).slice(0, 8).map((x) => clip(x, 60)),
    action: clip(p.action ?? "", 2000) || null,
    caption: clip(p.caption ?? "", 200) || null,
    dialogue: (p.dialogue ?? []).slice(0, 6).map((d) => ({ speaker: clip(d.speaker ?? "", 40), line: clip(d.line ?? "", 200) })),
    size: ["small", "mid", "tall"].includes(p.size) ? p.size : "mid",
    gap_after: Number.isInteger(p.gap_after) && p.gap_after >= 0 && p.gap_after <= 5000 ? p.gap_after : 250,
    props: (p.props ?? []).slice(0, 12).map((x) => ({ name: clip(x.name ?? "", 60), location: clip(x.location ?? "", 80), state: clip(x.state ?? "", 80) })),
    clock: clip(p.clock ?? "", 20) || null,
    matches_key: p.matches_panel > 0 && p.matches_panel <= i ? keys[p.matches_panel - 1] : null,
    text_items: (p.text_items ?? []).slice(0, 10).map((x) => ({ text: clip(x.text ?? "", 120), how: x.how === "model" ? "model" : "lettered" })),
  }));
  if (rows.length) await c.supabase.from("studio_script_panels").insert(rows);

  const known = new Set(props.map((p) => p.name.toLowerCase()));
  const newProps = (r.data.prop_table ?? [])
    .filter((p) => p.name?.trim() && !known.has(p.name.trim().toLowerCase()))
    .slice(0, 40)
    .map((p) => ({ project_id: c.id, name: clip(p.name.trim(), 60), owner: clip(p.owner ?? "", 80) || null, rule: clip(p.rule ?? "", 300) || null }));
  if (newProps.length) await c.supabase.from("studio_props").insert(newProps);

  if (s.project.format === "serial" && r.data.fork) {
    const existingFork = await loadFork(c.supabase, c.ep);
    if (!existingFork) {
      const f = r.data.fork;
      await c.supabase.from("studio_forks").insert({
        project_id: c.id,
        episode_id: c.ep,
        question: clip(f.question ?? "", 300) || null,
        in_bounds: clip(f.in_bounds ?? "", 500) || null,
        locked: clip(f.locked ?? "", 500) || null,
        backup_pick: clip(f.backup_pick ?? "", 500) || null,
        branches: (f.branches ?? []).slice(0, 3).map((b) => ({ title: clip(b.title ?? "", 80), summary: clip(b.summary ?? "", 300), rejoins: clip(b.rejoins ?? "", 120) })),
      });
    }
  }
  await afterScriptChange(c.supabase, c.id, c.ep, c.current.id, "Claude drafted the script", c.user.id);
  refresh(c.id);
  go(page(c.id, c.ep), { ok: `Script drafted: ${rows.length} panels. Run the check before you approve (${r.note})` });
}

export async function runScriptCheck(form: FormData) {
  const c = await ctx(form);
  const s = await loadStory(c.supabase, c.id);
  const eps = await loadStructure(c.supabase, c.id);
  const episode = eps.find((e) => e.id === c.ep);
  if (!s || !episode) go(page(c.id, c.ep), { error: "Couldn't load the story." });
  const [panels, fork, props] = await Promise.all([loadPanels(c.supabase, c.current.id), loadFork(c.supabase, c.ep), loadProps(c.supabase, c.id)]);
  if (!panels.length) go(page(c.id, c.ep), { error: "Add panels before running the check." });
  const r = await runScriptAction<CheckResult>(c.supabase, s, episode, { kind: "check" }, { panels, fork, props });
  if (!r.ok) go(page(c.id, c.ep), { error: r.reason });
  const items = (r.data.items ?? []).map((x) => ({ ...x, note: clip(x.note ?? "", 400), panels: (x.panels ?? []).filter((n) => n >= 1 && n <= panels.length).slice(0, 20) }));
  await c.supabase
    .from("studio_scripts")
    .update({ check_result: { summary: clip(r.data.summary ?? "", 600), items }, checked_at: new Date().toISOString() })
    .eq("id", c.current.id);
  const fails = items.filter((x) => x.status === "fail").length;
  refresh(c.id);
  go(page(c.id, c.ep, "#check"), { ok: `Check done: ${fails ? `${fails} item${fails === 1 ? "" : "s"} failed` : "everything passed"}. Nothing was changed (${r.note})` });
}

// ---------------------------------------------------------------- Gate: Script final

export async function approveScript(form: FormData) {
  const c = await ctx(form);
  const s = await loadStory(c.supabase, c.id);
  if (!s) go("/studio", { error: "That project doesn't exist." });
  if (s.gate?.state !== "approved") go(page(c.id, c.ep, "#gate"), { error: "Approve the story first. Gates go in order: Story approved, then Script final." });
  const [panels, fork, props] = await Promise.all([loadPanels(c.supabase, c.current.id), loadFork(c.supabase, c.ep), loadProps(c.supabase, c.id)]);
  if (!panels.length) go(page(c.id, c.ep, "#gate"), { error: "The script has no panels." });
  const versions = await listVersions(c.supabase, c.ep);
  const cur = versions[0];
  if (!cur?.check_result) go(page(c.id, c.ep, "#gate"), { error: "Run Claude's script check on this version first." });
  const issues = freeChecks(panels, { props, characters: s.characters.map((x) => x.name), fork, serial: s.project.format === "serial" });
  const fails = cur.check_result.items.filter((x) => x.status === "fail").length;
  const note = clip(t(form, "note"), 500);
  if ((issues.length || fails) && !note) {
    go(page(c.id, c.ep, "#gate"), { error: "There are open problems. Approve only if you're happy, and write a note saying why." });
  }
  const fp = scriptFingerprint(cur.version, panels, fork);
  const now = new Date().toISOString();
  const gate = await loadScriptGate(c.supabase, c.id, c.ep);
  let gateId = gate?.id;
  const row = { state: "approved", fingerprint: fp, approved_by: c.user.id, approved_at: now, note: note ? `v${cur.version}: ${note}` : `v${cur.version}`, updated_at: now };
  if (gateId) await c.supabase.from("studio_gates").update(row).eq("id", gateId);
  else {
    const { data } = await c.supabase.from("studio_gates").insert({ project_id: c.id, episode_id: c.ep, gate: "script_final", ...row }).select("id").single();
    gateId = data?.id;
  }
  if (!gateId) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval." });
  await c.supabase.from("studio_gate_events").insert({ gate_id: gateId, action: "approved", actor: c.user.id, note: row.note, fingerprint: fp });
  refresh(c.id);
  go(page(c.id, c.ep, "#gate"), { ok: `Script final: v${cur.version} approved. This episode's Assets page is now unlocked.` });
}

export async function reopenScript(form: FormData) {
  const c = await ctx(form);
  const gate = await loadScriptGate(c.supabase, c.id, c.ep);
  if (!gate) go(page(c.id, c.ep, "#gate"), {});
  await c.supabase.from("studio_gates").update({ state: "open", updated_at: new Date().toISOString() }).eq("id", gate.id);
  await c.supabase.from("studio_gate_events").insert({ gate_id: gate.id, action: "reopened", actor: c.user.id, note: clip(t(form, "note"), 500) || null });
  refresh(c.id);
  go(page(c.id, c.ep, "#gate"), { ok: "Script reopened for changes." });
}
