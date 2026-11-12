"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withParams } from "@/lib/studio/url";
import { readStudioFile, removeStudioFiles, uploadStudioFile } from "@/lib/studio/assets/storage";
import { requireStudio } from "@/lib/studio/auth";
import { activeLessons } from "@/lib/studio/lessons/lessons";
import { precheckPrompt, visionQa } from "@/lib/studio/panels/ai";
import { defaultLayout, layoutHash, letterPanel } from "@/lib/studio/panels/letter";
import { panelsFingerprint } from "@/lib/studio/panels/gate";
import { buildFor, loadPanelContext, runAutoQa, startPanelTake } from "@/lib/studio/panels/panels";
import { lintPanelPrompt, scriptHash } from "@/lib/studio/panels/prompt";
import { riskTag } from "@/lib/studio/script/checks";
import { LETTER_FIELDS, QA_TICKS, defaultElement, type LetterEl, type LetterKind } from "@/lib/studio/panels/types";
import { morningBrewMastersAvailable, parseLetterReference, readMorningBrewMaster } from "@/lib/studio/seed/morningBrew";

// One server action per button. Each re-checks access and that this episode's asset designs
// are approved (the Panels page is locked until then). Database rules apply too: no final take
// before Script final, never an exploration image as panel art, QA ticked before choosing.

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clip = (s: string, n: number) => s.slice(0, n);
const page = (id: string, ep: string, extra = "") => `/studio/projects/${id}/panels?ep=${ep}${extra}`;
function go(path: string, params: Record<string, string>): never {
  redirect(withParams(path, params));
}

async function ctx(form: FormData, opts: { needAssets?: boolean } = {}) {
  const id = t(form, "project_id");
  const ep = t(form, "episode_id");
  const c = await requireStudio(`/studio/projects/${id}/panels`);
  const { data: e } = await c.supabase.from("studio_episodes").select("id,number").eq("id", ep).eq("project_id", id).maybeSingle();
  if (!e) go(`/studio/projects/${id}/panels`, { error: "That episode doesn't exist." });
  const pc = await loadPanelContext(c.supabase, id, ep);
  if (opts.needAssets !== false && pc.assetsGate?.state !== "approved") {
    go(page(id, ep), { error: "This episode's asset designs aren't approved, so its panels are locked." });
  }
  return { ...c, id, ep, pc };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

const refresh = (id: string) => revalidatePath(`/studio/projects/${id}/panels`);
const at = (key: string, anchor = "panel") => `&panel=${key}#${anchor}`;

function panelOf(c: Ctx, form: FormData) {
  const key = t(form, "panel_key");
  const i = c.pc.panels.findIndex((p) => p.panel_key === key);
  if (i === -1) go(page(c.id, c.ep), { error: "That panel isn't in the current script." });
  return { key, i, panel: c.pc.panels[i], row: c.pc.rows.get(key)! };
}

async function snapshot(c: Ctx, key: string, reason: string) {
  const { data: row } = await c.supabase.from("studio_panels").select("id,chosen_take_id,letter_layout,lettered_path,lettered_hash").eq("episode_id", c.ep).eq("panel_key", key).maybeSingle();
  if (!row) return;
  const { data: last } = await c.supabase.from("studio_versions").select("version").eq("item_type", "panel").eq("item_id", row.id).order("version", { ascending: false }).limit(1).maybeSingle();
  await c.supabase.from("studio_versions").insert({
    project_id: c.id, item_type: "panel", item_id: row.id, version: (last?.version ?? 0) + 1,
    snapshot: { panel_key: key, chosen_take_id: row.chosen_take_id, letter_layout: row.letter_layout, lettered_path: row.lettered_path, lettered_hash: row.lettered_hash },
    reason, created_by: c.user.id,
  });
}

/** Any change to a panel's art or lettering after approval turns the Panels approved gate stale. */
async function afterPanelChange(c: Ctx, reason: string) {
  const { data: g } = await c.supabase.from("studio_gates").select("id,state").eq("project_id", c.id).eq("episode_id", c.ep).eq("gate", "panels_approved").maybeSingle();
  if (g?.state === "approved") {
    await c.supabase.from("studio_gates").update({ state: "stale", updated_at: new Date().toISOString() }).eq("id", g.id);
    await c.supabase.from("studio_gate_events").insert({ gate_id: g.id, action: "stale", actor: c.user.id, note: reason });
  }
}

// ---------------------------------------------------------------- prompt

export async function saveDirection(form: FormData) {
  const c = await ctx(form);
  const { key } = panelOf(c, form);
  await c.supabase.from("studio_panels").update({ direction: clip(t(form, "direction"), 400) || null }).eq("episode_id", c.ep).eq("panel_key", key);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "prompt")), { ok: "Expression saved. The prompt changed, so run the pre-check again." });
}

async function lintOrStop(c: Ctx, key: string, fix?: { takeId: string; change: string }) {
  const b = await buildFor(c.supabase, c.pc, key, fix);
  if (!b || !c.pc.story) go(page(c.id, c.ep, at(key)), { error: "Couldn't build the prompt." });
  const lint = lintPanelPrompt(b.built, b.panel, c.pc.story.characters);
  if (lint.errors.length) go(page(c.id, c.ep, at(key, "prompt")), { error: `Fix first (free check): ${lint.errors[0]}` });
  return { ...b, lint };
}

export async function runPrecheck(form: FormData) {
  const c = await ctx(form);
  const { key, i } = panelOf(c, form);
  const b = await lintOrStop(c, key);
  const r = await precheckPrompt(c.supabase, { projectId: c.id, episodeId: c.ep }, b.built, b.panel, i + 1, b.lint.warnings);
  if (!r.ok) go(page(c.id, c.ep, at(key, "prompt")), { error: r.reason });
  await c.supabase.from("studio_panels").update({ precheck: r.result, precheck_hash: b.built.hash }).eq("episode_id", c.ep).eq("panel_key", key);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "prompt")), { ok: `Pre-check done: ${r.result.ok ? "no problems found" : `${r.result.issues.length} issue(s) to read`} (${r.result.note})` });
}

/** A panel's take limit: its own "Takes: N" budget from the script notes (guidelines rule 10), else the setting. */
function takeLimit(c: Ctx, key: string): number {
  const notes = c.pc.panels.find((p) => p.panel_key === key)?.notes;
  return riskTag(notes).takes ?? c.pc.settings?.max_takes_per_panel ?? 3;
}

async function canGenerate(c: Ctx, key: string): Promise<string | null> {
  const b = await buildFor(c.supabase, c.pc, key);
  if (!b || !c.pc.story) return "Couldn't build the prompt.";
  const lint = lintPanelPrompt(b.built, b.panel, c.pc.story.characters);
  if (lint.errors.length) return `the free check failed (${lint.errors[0]})`;
  const row = c.pc.rows.get(key);
  if (row?.precheck_hash !== b.built.hash) return "run Claude's pre-check on the current prompt first";
  const max = takeLimit(c, key);
  const used = c.pc.takes.filter((x) => x.panel_key === key && x.kind === "final" && (x.status === "ready" || x.status === "pending")).length;
  if (used >= max) return `it already has ${used} of its ${max} takes (raise its “Takes:” budget in the script notes)`;
  if (c.pc.takes.some((x) => x.panel_key === key && x.status === "pending")) return "a take is still generating";
  return null;
}

export async function generateTake(form: FormData) {
  const c = await ctx(form);
  const { key, i } = panelOf(c, form);
  const why = await canGenerate(c, key);
  if (why) go(page(c.id, c.ep, at(key, "prompt")), { error: `Panel ${i + 1} can't be generated yet: ${why}.` });
  const r = await startPanelTake(c.supabase, c.pc, key);
  if (!r.ok) go(page(c.id, c.ep, at(key, "takes")), { error: r.reason });
  await afterPanelChange(c, `Panel ${i + 1}: new take`);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "takes")), {
    ok: r.dryRun ? `Dry run: placeholder take logged for panel ${i + 1}, $0 (about $${r.estimate.toFixed(2)} if real).` : `Generating one take for panel ${i + 1} (about $${r.estimate.toFixed(2)}). Only this panel is touched.`,
    ...(r.warn ? { warn: `You've used ${r.percent}% of a limit.` } : {}),
  });
}

export async function generateSelected(form: FormData) {
  const c = await ctx(form);
  const keys = form.getAll("keys").map(String).filter((k) => c.pc.panels.some((p) => p.panel_key === k)).slice(0, 12);
  if (!keys.length) go(page(c.id, c.ep), { error: "Tick the panels to generate first." });
  const done: number[] = [];
  const skipped: string[] = [];
  let warn = "";
  for (const key of keys) {
    const n = c.pc.panels.findIndex((p) => p.panel_key === key) + 1;
    const why = await canGenerate(c, key);
    if (why) { skipped.push(`panel ${n}: ${why}`); continue; }
    const r = await startPanelTake(c.supabase, c.pc, key);
    if (!r.ok) { skipped.push(`panel ${n}: ${r.reason}`); break; }
    if (r.warn) warn = `You've used ${r.percent}% of a limit.`;
    done.push(n);
  }
  if (done.length) await afterPanelChange(c, `New takes for panels ${done.join(", ")}`);
  refresh(c.id);
  go(page(c.id, c.ep), {
    ...(done.length ? { ok: `Started one take each for panel${done.length === 1 ? "" : "s"} ${done.join(", ")}${c.pc.settings?.dry_run ? " (dry run, $0)" : ""}.` } : {}),
    ...(skipped.length ? { error: `Skipped ${skipped.join("; ")}.` } : {}),
    ...(warn ? { warn } : {}),
  });
}

/** Fix one thing: edit mode with the current take as the first reference. Pre-checked automatically. */
export async function fixTake(form: FormData) {
  const c = await ctx(form);
  const { key, i } = panelOf(c, form);
  const takeId = t(form, "take_id");
  const change = clip(t(form, "change"), 300);
  if (!change) go(page(c.id, c.ep, at(key, "takes")), { error: "Say the ONE thing to change, e.g. “close his eyes”." });
  if (/\band\b.*\band\b|;/.test(change)) go(page(c.id, c.ep, at(key, "takes")), { error: "A fix changes one thing at a time. Split it into separate fixes." });
  const take = c.pc.takes.find((x) => x.id === takeId && x.panel_key === key && x.storage_path);
  if (!take) go(page(c.id, c.ep, at(key, "takes")), { error: "Only a finished image can be fixed." });
  const max = takeLimit(c, key);
  const used = c.pc.takes.filter((x) => x.panel_key === key && x.kind === "final" && (x.status === "ready" || x.status === "pending")).length;
  if (used >= max) go(page(c.id, c.ep, at(key, "takes")), { error: `Panel ${i + 1} already has ${used} of its ${max} takes. Raise its “Takes:” budget in the script notes to go on.` });
  const fix = { takeId, change };
  const b = await lintOrStop(c, key, fix);
  const pre = await precheckPrompt(c.supabase, { projectId: c.id, episodeId: c.ep }, b.built, b.panel, i + 1, b.lint.warnings);
  if (!pre.ok) go(page(c.id, c.ep, at(key, "takes")), { error: pre.reason });
  // The pre-check advises; it doesn't block (same as a new take). It kept stopping simple fixes over house-rule
  // wording it was told to ignore (Episode 2). Its notes are saved and shown with the result.
  const r = await startPanelTake(c.supabase, c.pc, key, fix);
  if (!r.ok) go(page(c.id, c.ep, at(key, "takes")), { error: r.reason });
  await afterPanelChange(c, `Panel ${i + 1}: fix`);
  refresh(c.id);
  const notes = pre.result.ok ? "" : ` Pre-check notes: ${pre.result.issues.slice(0, 3).join(" ")}`.slice(0, 600);
  go(page(c.id, c.ep, at(key, "takes")), { ok: r.dryRun ? "Dry run: placeholder fix logged, $0." : `Fixing panel ${i + 1}: “${change}” (about $${r.estimate.toFixed(2)}).${notes}` });
}

// ---------------------------------------------------------------- takes: QA, choose, reject

export async function saveTicks(form: FormData) {
  const c = await ctx(form);
  const { key } = panelOf(c, form);
  const ticks = Object.fromEntries(QA_TICKS.map((q) => [q.key, form.get(`tick_${q.key}`) === "on"]));
  const all = QA_TICKS.every((q) => ticks[q.key]);
  await c.supabase.from("studio_takes").update({ qa_ticks: ticks, qa_ticked: all }).eq("id", t(form, "take_id")).eq("panel_key", key);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "takes")), { ok: all ? "Checklist complete. This image can be chosen." : "Checklist saved. Every item must be ticked before choosing." });
}

export async function chooseTake(form: FormData) {
  const c = await ctx(form);
  const { key, i } = panelOf(c, form);
  const { error } = await c.supabase.from("studio_panels").update({ chosen_take_id: t(form, "take_id") }).eq("episode_id", c.ep).eq("panel_key", key);
  if (error) go(page(c.id, c.ep, at(key, "takes")), { error: error.message.replace(/^.*?:\s*/, "") || "Couldn't choose that image." });
  await snapshot(c, key, "Image chosen");
  await afterPanelChange(c, `Panel ${i + 1}: different image chosen`);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "letter")), { ok: `Chosen for panel ${i + 1}. Next: letter it.` });
}

export async function rejectTake(form: FormData) {
  const c = await ctx(form);
  const { key, i, row } = panelOf(c, form);
  const takeId = t(form, "take_id");
  const reason = clip(t(form, "reason"), 400);
  if (!reason) go(page(c.id, c.ep, at(key, "takes")), { error: "Say why it's rejected. It becomes a proposed lesson." });
  await c.supabase.from("studio_takes").update({ rejected: true, reject_reason: reason }).eq("id", takeId).eq("panel_key", key);
  if (row.chosen_take_id === takeId) {
    await c.supabase.from("studio_panels").update({ chosen_take_id: null }).eq("id", row.id);
    await afterPanelChange(c, `Panel ${i + 1}: chosen image rejected`);
  }
  await c.supabase.from("studio_lessons").insert({
    stage: "panels", problem: `Panel ${i + 1} take rejected: ${reason}`, lesson: reason, tag: "art", theme: "unrequested",
    scope: "series", project_id: c.id, status: "proposed", active: false, source: "reject", origin_take_id: takeId,
  });
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "takes")), { ok: "Rejected. A lesson was proposed from your reason: approve or edit it on the Lessons page." });
}

export async function rerunAutoQa(form: FormData) {
  const c = await ctx(form);
  const { key } = panelOf(c, form);
  await runAutoQa(c.supabase, t(form, "take_id"));
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "takes")), { ok: "Free checks run again." });
}

// ---------------------------------------------------------------- lettering

function readLayout(form: FormData, current: LetterEl[]): LetterEl[] {
  const count = Math.min(40, Number(t(form, "el_count")) || 0);
  const out: LetterEl[] = [];
  for (let i = 0; i < count; i++) {
    if (form.get(`el_${i}_remove`) === "on") continue;
    const kind = t(form, `el_${i}_kind`) as LetterKind;
    if (!LETTER_FIELDS[kind]) continue;
    const el: Record<string, unknown> = { ...(current[i]?.kind === kind ? current[i] : defaultElement(kind)), kind };
    for (const [name, type] of LETTER_FIELDS[kind]) {
      const raw = String(form.get(`el_${i}_${name}`) ?? "");
      if (type === "n") { const v = Number(raw); if (Number.isFinite(v)) el[name] = Math.max(-200, Math.min(6000, Math.round(v))); }
      else if (type === "b") el[name] = raw === "on";
      else el[name] = clip(raw.replace(/\r/g, ""), 600);
    }
    out.push(el as LetterEl);
  }
  const add = t(form, "add_kind") as LetterKind;
  if (LETTER_FIELDS[add]) out.push(defaultElement(add));
  return out;
}

export async function saveLayout(form: FormData) {
  const c = await ctx(form);
  const { key, i, row } = panelOf(c, form);
  const layout = readLayout(form, row.letter_layout ?? []);
  await c.supabase.from("studio_panels").update({ letter_layout: layout }).eq("id", row.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "letter")), { ok: `Lettering layout saved for panel ${i + 1} (${layout.length} element${layout.length === 1 ? "" : "s"}). Press “Letter this panel” to see it.` });
}

export async function resetLayout(form: FormData) {
  const c = await ctx(form);
  const { key, panel, row } = panelOf(c, form);
  await c.supabase.from("studio_panels").update({ letter_layout: defaultLayout(panel) }).eq("id", row.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "letter")), { ok: "Layout rebuilt from the script (caption, balloons, clock)." });
}

export async function letterThisPanel(form: FormData) {
  const c = await ctx(form);
  const { key, i, panel, row } = panelOf(c, form);
  const take = row.chosen_take_id ? c.pc.takes.find((x) => x.id === row.chosen_take_id) : null;
  if (!take?.storage_path) go(page(c.id, c.ep, at(key, "letter")), { error: "Choose an image for this panel first." });
  const art = await readStudioFile(c.supabase, take.storage_path);
  if (!art) go(page(c.id, c.ep, at(key, "letter")), { error: "Couldn't read the chosen image." });
  // Lettering uses what's in the form, so edits don't need a separate save first.
  const layout = form.has("el_count") ? readLayout(form, row.letter_layout ?? []) : row.letter_layout ?? [];
  if (JSON.stringify(layout) !== JSON.stringify(row.letter_layout ?? [])) {
    await c.supabase.from("studio_panels").update({ letter_layout: layout }).eq("id", row.id);
    row.letter_layout = layout;
  }
  const out = await letterPanel(art, layout, panel);
  const path = `projects/${c.id}/panels/${c.ep}/${key}/lettered-${Date.now()}.png`;
  if (!(await uploadStudioFile(c.supabase, path, out.bytes, "image/png"))) go(page(c.id, c.ep, at(key, "letter")), { error: "Couldn't save the lettered panel." });
  const old = row.lettered_path;
  await c.supabase
    .from("studio_panels")
    .update({ lettered_path: path, lettered_take_id: take.id, lettered_hash: layoutHash(row.letter_layout ?? [], panel, take.id), lettered_at: new Date().toISOString() })
    .eq("id", row.id);
  if (old && old !== path) await removeStudioFiles(c.supabase, [old]);
  await snapshot(c, key, "Lettered");
  await afterPanelChange(c, `Panel ${i + 1}: re-lettered`);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "letter")), {
    ok: `Panel ${i + 1} lettered in code (${out.width}×${out.height}). Free. No other panel was touched.`,
    ...(out.warnings.length ? { warn: out.warnings.join(" ") } : {}),
  });
}

// ---------------------------------------------------------------- Claude vision QA and lessons

export async function runVisionQa(form: FormData) {
  const c = await ctx(form);
  const { key, i, panel, row } = panelOf(c, form);
  if (!row.lettered_path) go(page(c.id, c.ep, at(key, "qa")), { error: "Letter the panel first: QA looks at the lettered panel." });
  const bytes = await readStudioFile(c.supabase, row.lettered_path);
  if (!bytes || !c.pc.story) go(page(c.id, c.ep, at(key, "qa")), { error: "Couldn't read the lettered panel." });
  const lessons = await activeLessons(c.supabase, "art", c.id, panel.characters);
  const r = await visionQa(c.supabase, { projectId: c.id, episodeId: c.ep }, bytes, panel, i + 1, c.pc.story.characters, lessons);
  if (!r.ok) go(page(c.id, c.ep, at(key, "qa")), { error: r.reason });
  await c.supabase
    .from("studio_panels")
    .update({ qa: { summary: r.summary, findings: r.findings, model: r.model, cost: r.note }, qa_at: new Date().toISOString(), qa_lettered_path: row.lettered_path })
    .eq("id", row.id);
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "qa")), { ok: `Claude reviewed panel ${i + 1}: ${r.findings.length ? `${r.findings.length} finding(s)` : "no problems found"}. Nothing was changed (${r.note})` });
}

export async function proposeLessonFromFinding(form: FormData) {
  const c = await ctx(form);
  const { key, i, row } = panelOf(c, form);
  const f = row.qa?.findings?.[Number(t(form, "finding"))];
  if (!f) go(page(c.id, c.ep, at(key, "qa")), { error: "That finding is gone." });
  const theme = { costume_drift: "continuity", missing_prop: "props", wrong_clock: "props", extra_character: "unrequested", garbled_text: "text", expression: "expressions", unrequested: "unrequested", lettering: "lettering" }[f.kind] ?? "process";
  await c.supabase.from("studio_lessons").insert({
    stage: "panels", problem: `Panel ${i + 1}: ${f.note}`, lesson: f.lesson || f.note, tag: "art", theme,
    scope: "series", project_id: c.id, status: "proposed", active: false, source: "qa",
    origin_take_id: row.chosen_take_id,
  });
  refresh(c.id);
  go(page(c.id, c.ep, at(key, "qa")), { ok: "Lesson proposed. It only applies once you approve it on the Lessons page." });
}

// ---------------------------------------------------------------- Morning Brew masters (test project, local only)

export async function importMasters(form: FormData) {
  const c = await ctx(form);
  if (!c.pc.story?.project.is_test) go(page(c.id, c.ep), { error: "Masters can only be imported into a test project." });
  if (!morningBrewMastersAvailable()) go(page(c.id, c.ep), { error: "The test pack isn't on this computer (local only)." });
  const { data: epRow } = await c.supabase.from("studio_episodes").select("number").eq("id", c.ep).maybeSingle();
  if (epRow?.number !== 1) go(page(c.id, c.ep), { error: "The Morning Brew masters are Episode 1's art. They can only be imported into Episode 1." });
  const layouts = parseLetterReference();
  let n = 0;
  for (const [idx, panel] of c.pc.panels.entries()) {
    // Fill gaps only: skip panels that already have a usable imported take, and keep edited layouts.
    if (c.pc.takes.some((x) => x.panel_key === panel.panel_key && x.kind === "imported" && !x.rejected)) continue;
    const m = readMorningBrewMaster(idx + 1);
    if (!m.unlettered) continue;
    const { data: take } = await c.supabase
      .from("studio_takes")
      .insert({
        project_id: c.id, episode_id: c.ep, panel_key: panel.panel_key, kind: "imported", status: "pending",
        prompt: "Imported from the Morning Brew test pack (made before the gates).", comment: "Imported, made before the gate.",
        aspect: null, script_hash: scriptHash(panel),
      })
      .select("id")
      .single();
    if (!take) continue;
    const base = `projects/${c.id}/panels/${c.ep}/${panel.panel_key}`;
    if (!(await uploadStudioFile(c.supabase, `${base}/${take.id}.jpg`, m.unlettered, "image/jpeg"))) continue;
    await c.supabase.from("studio_takes").update({ status: "ready", storage_path: `${base}/${take.id}.jpg` }).eq("id", take.id);
    const patch: Record<string, unknown> = {};
    if (m.lettered && (await uploadStudioFile(c.supabase, `${base}/compare.jpg`, m.lettered, "image/jpeg"))) patch.compare_path = `${base}/compare.jpg`;
    const existing = c.pc.rows.get(panel.panel_key)?.letter_layout;
    if (layouts[idx + 1]?.length && !(Array.isArray(existing) && existing.length)) patch.letter_layout = layouts[idx + 1];
    if (Object.keys(patch).length) await c.supabase.from("studio_panels").update(patch).eq("episode_id", c.ep).eq("panel_key", panel.panel_key);
    n++;
  }
  refresh(c.id);
  if (!n) go(page(c.id, c.ep), { ok: "Every panel already has an imported master. Nothing was added." });
  go(page(c.id, c.ep), { ok: `Imported ${n} master${n === 1 ? "" : "s"} as “imported, made before the gate”, with the old lettering positions and the old lettered panels for comparison. Tick each checklist before choosing.` });
}

// ---------------------------------------------------------------- Gate: Panels approved

export async function approvePanels(form: FormData) {
  const c = await ctx(form);
  if (!c.pc.panels.length) go(page(c.id, c.ep, "#gate"), { error: "The script has no panels." });
  const { fp, problems } = panelsFingerprint(c.pc);
  if (problems.length) go(page(c.id, c.ep, "#gate"), { error: `Not ready: ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? "…" : ""}.` });
  const note = clip(t(form, "note"), 500);
  const imported = c.pc.panels.filter((p) => c.pc.takes.find((x) => x.id === c.pc.rows.get(p.panel_key)?.chosen_take_id)?.kind === "imported").length;
  if (imported && !note) go(page(c.id, c.ep, "#gate"), { error: `${imported} panel(s) use imported art made before the gates. Write a note to approve anyway.` });
  const now = new Date().toISOString();
  const row = { state: "approved", fingerprint: fp, approved_by: c.user.id, approved_at: now, note: note || `${c.pc.panels.length} panels`, updated_at: now };
  const { data: g } = await c.supabase.from("studio_gates").select("id").eq("project_id", c.id).eq("episode_id", c.ep).eq("gate", "panels_approved").maybeSingle();
  let gateId = g?.id as string | undefined;
  if (gateId) {
    const { error } = await c.supabase.from("studio_gates").update(row).eq("id", gateId);
    if (error) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval. Gates go in order: are the asset designs still approved?" });
  } else {
    const { data, error } = await c.supabase.from("studio_gates").insert({ project_id: c.id, episode_id: c.ep, gate: "panels_approved", ...row }).select("id").single();
    if (error) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval. Gates go in order: are the asset designs still approved?" });
    gateId = data?.id;
  }
  if (!gateId) go(page(c.id, c.ep, "#gate"), { error: "Couldn't record the approval." });
  await c.supabase.from("studio_gate_events").insert({ gate_id: gateId, action: "approved", actor: c.user.id, note: row.note, fingerprint: fp });
  refresh(c.id);
  go(page(c.id, c.ep, "#gate"), { ok: "Panels approved for this episode." });
}

export async function reopenPanels(form: FormData) {
  const c = await ctx(form, { needAssets: false });
  const { data: g } = await c.supabase.from("studio_gates").select("id").eq("project_id", c.id).eq("episode_id", c.ep).eq("gate", "panels_approved").maybeSingle();
  if (!g) go(page(c.id, c.ep, "#gate"), {});
  await c.supabase.from("studio_gates").update({ state: "open", updated_at: new Date().toISOString() }).eq("id", g.id);
  await c.supabase.from("studio_gate_events").insert({ gate_id: g.id, action: "reopened", actor: c.user.id, note: clip(t(form, "note"), 500) || null });
  refresh(c.id);
  go(page(c.id, c.ep, "#gate"), { ok: "Panels reopened for changes." });
}

