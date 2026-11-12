"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudio } from "@/lib/studio/auth";
import { runDraft, type DraftReply } from "@/lib/studio/draft/prompts";
import { openPlotBlanks, type Blank, type DraftRow, type Quickstart } from "@/lib/studio/draft/types";
import { QUESTIONS } from "@/lib/studio/story/questions";
import { afterStoryChange, draftGaps, loadStory, recordStoryApproval, type Story } from "@/lib/studio/story/story";
import { withParams } from "@/lib/studio/url";

// The story writer's buttons. One server action per button; each re-checks access and the
// database rules apply too. Claude calls go through the cost gateway (caps, ledger, dry-run).

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const page = (id: string, extra = "") => `/studio/projects/${id}/story${extra}`;

function go(path: string, params: Record<string, string>): never {
  redirect(withParams(path, params));
}

async function ctx(form: FormData) {
  const id = t(form, "project_id");
  const c = await requireStudio(`/studio/projects/${id}`);
  const s = await loadStory(c.supabase, id);
  if (!s) go("/studio", { error: "That project doesn't exist." });
  return { ...c, id, s };
}

async function done(c: { supabase: Awaited<ReturnType<typeof requireStudio>>["supabase"]; user: { id: string }; id: string }, reason: string) {
  await afterStoryChange(c.supabase, c.id, reason, c.user.id);
  revalidatePath(`/studio/projects/${c.id}`, "layout");
}

function readQuickstart(form: FormData, fallback?: Quickstart): Quickstart {
  const has = form.has("about");
  if (!has && fallback) return fallback;
  return {
    about: clip(t(form, "about"), 500),
    setting: clip(t(form, "setting"), 300),
    lead: clip(t(form, "lead"), 300),
    backstory: clip(t(form, "backstory"), 2000),
  };
}

/** Cleans Claude's reply and carries over any answer Tom gave to a blank Claude kept. */
function clean(reply: DraftReply, prev: DraftRow | null) {
  const prevById = new Map((prev?.draft.blanks ?? []).map((b) => [b.id, b]));
  const beats = reply.beats.slice(0, 30).map((b, i) => ({ id: clip(b.id || `s${i + 1}`, 20), heading: clip(b.heading, 120), text: clip(b.text, 2000) }));
  const blanks: Blank[] = (reply.blanks ?? []).slice(0, 20).map((b) => {
    const old = prevById.get(b.id);
    return {
      id: clip(b.id, 20),
      beat_id: clip(b.beat_id, 20),
      question: clip(b.question, 300),
      kind: b.kind === "plot" ? "plot" : "detail",
      guess: clip(b.guess, 300),
      options: (b.options ?? []).slice(0, 4).map((o) => clip(o, 200)),
      answer: old && old.question === b.question ? old.answer : null,
    };
  });
  return {
    draft: { synopsis: clip(reply.synopsis, 500), beats, blanks },
    portfolio: reply.portfolio,
    health: { ...reply.health, panels_estimate: Math.max(0, Math.min(200, Number(reply.health?.panels_estimate) || 0)) },
    changes: (reply.changes ?? []).slice(0, 20).map((x) => clip(x, 300)),
  };
}

async function nextVersion(c: Awaited<ReturnType<typeof ctx>>) {
  return (c.s.draft?.version ?? 0) + 1;
}

// ---------------------------------------------------------------- first read

export async function startDraft(form: FormData) {
  const c = await ctx(form);
  const quickstart = readQuickstart(form);
  const telling = clip(t(form, "telling"), 20000);
  if (!quickstart.about) go(page(c.id), { error: "Say what the story is about in one sentence first." });
  if (telling.length < 40) go(page(c.id), { error: "Tell the episode first: write what happens, start to finish, in your own words." });

  // Save Tom's words before calling Claude, so nothing he typed is lost if the call fails.
  const version = await nextVersion(c);
  const { data: row, error } = await c.supabase
    .from("studio_story_drafts")
    .insert({ project_id: c.id, version, quickstart, telling })
    .select("id")
    .single();
  if (error || !row) go(page(c.id), { error: "Couldn't save your story. Has the database update (0012) been run?" });

  const r = await runDraft(c.supabase, { project: c.s.project, quickstart, telling, prev: null, change: "" });
  if (!r.ok) {
    revalidatePath(page(c.id));
    go(page(c.id), { error: `Your story is saved. Claude couldn't read it yet: ${r.reason}` });
  }
  const out = clean(r.reply, null);
  await c.supabase
    .from("studio_story_drafts")
    .update({ ...out, ai_call_id: r.ledgerId, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  await done(c, "Story writer: first read");
  go(page(c.id), { ok: `Claude has read your story (${r.note}) Answer the questions in the draft, or ask for changes on the right.` });
}

/** The first read failed or was a dry run: read the saved telling again without retyping it. */
export async function rereadDraft(form: FormData) {
  const c = await ctx(form);
  const d = c.s.draft;
  if (!d) go(page(c.id), { error: "Tell your story first." });
  if (d.draft.beats.length) go(page(c.id), { error: "Use Update story on the right to change an existing draft." });
  const r = await runDraft(c.supabase, { project: c.s.project, quickstart: d.quickstart, telling: d.telling, prev: null, change: "" });
  if (!r.ok) go(page(c.id), { error: r.reason });
  await c.supabase
    .from("studio_story_drafts")
    .update({ ...clean(r.reply, null), ai_call_id: r.ledgerId, updated_at: new Date().toISOString() })
    .eq("id", d.id);
  await done(c, "Story writer: first read");
  go(page(c.id), { ok: `Claude has read your story (${r.note})` });
}

// ---------------------------------------------------------------- answers (free)

export async function saveBlankAnswers(form: FormData) {
  const c = await ctx(form);
  const d = c.s.draft;
  if (!d) go(page(c.id), { error: "There's no draft yet." });
  let n = 0;
  const blanks = d.draft.blanks.map((b) => {
    if (!form.has(`pick_${b.id}`) && !form.has(`own_${b.id}`)) return b;
    const own = clip(t(form, `own_${b.id}`), 500);
    const pick = clip(t(form, `pick_${b.id}`), 500);
    const answer = own || (pick === "__guess" ? b.guess : pick) || null;
    if ((answer ?? null) !== (b.answer ?? null)) n++;
    return { ...b, answer };
  });
  await c.supabase
    .from("studio_story_drafts")
    .update({ draft: { ...d.draft, blanks }, updated_at: new Date().toISOString() })
    .eq("id", d.id);
  await done(c, "Story writer: answers saved");
  go(page(c.id, "#update"), {
    ok: n ? `Saved ${n === 1 ? "1 answer" : `${n} answers`}. Press Update story to write ${n === 1 ? "it" : "them"} into the draft.` : "Nothing changed.",
  });
}

// ---------------------------------------------------------------- update (Claude)

export async function updateDraft(form: FormData) {
  const c = await ctx(form);
  const prev = c.s.draft;
  if (!prev || !prev.draft.beats.length) go(page(c.id), { error: "Let Claude read your story first." });
  const change = clip(t(form, "change"), 3000);
  const quickstart = readQuickstart(form, prev.quickstart);
  const telling = form.has("telling") ? clip(t(form, "telling"), 20000) : prev.telling;
  const editedTelling = telling !== prev.telling || JSON.stringify(quickstart) !== JSON.stringify(prev.quickstart);
  const answered = prev.draft.blanks.some((b) => b.answer?.trim());
  if (!change && !answered && !editedTelling) {
    go(page(c.id, "#update"), { error: "Nothing to update yet: answer a question in the draft, write a change, or edit your telling." });
  }

  const r = await runDraft(c.supabase, { project: c.s.project, quickstart, telling, prev, change });
  if (!r.ok) go(page(c.id, "#update"), { error: r.reason, ...(change ? { pending: change.slice(0, 1500) } : {}) });
  const version = prev.version + 1;
  const { error } = await c.supabase.from("studio_story_drafts").insert({
    project_id: c.id,
    version,
    quickstart,
    telling,
    ...clean(r.reply, prev),
    change_request: change || (editedTelling ? "Edited the telling" : "Wrote in answers"),
    ai_call_id: r.ledgerId,
  });
  if (error) go(page(c.id, "#update"), { error: "Couldn't save the new version." });
  await done(c, `Story writer: version ${version}`);
  go(page(c.id), { ok: `Version ${version} ready (${r.note}) Changed parts are marked.` });
}

/** Copies an older version to the top as a new version (free). */
export async function restoreVersion(form: FormData) {
  const c = await ctx(form);
  const v = Number(t(form, "version"));
  const { data: old } = await c.supabase.from("studio_story_drafts").select("*").eq("project_id", c.id).eq("version", v).maybeSingle();
  if (!old || !c.s.draft) go(page(c.id), { error: "That version doesn't exist." });
  const version = c.s.draft.version + 1;
  await c.supabase.from("studio_story_drafts").insert({
    project_id: c.id,
    version,
    quickstart: old.quickstart,
    telling: old.telling,
    draft: old.draft,
    portfolio: old.portfolio,
    health: old.health,
    change_request: `Restored version ${v}`,
    changes: [],
  });
  await done(c, `Story writer: restored version ${v}`);
  go(page(c.id), { ok: `Version ${v} restored as version ${version}.` });
}

// ---------------------------------------------------------------- lock (Story approved)

/** Fills the fields later stages read (logline, answers, characters) from the draft, then approves. */
async function syncClassicFields(c: Awaited<ReturnType<typeof ctx>>, s: Story) {
  const d = s.draft!;
  const h = d.health;
  await c.supabase
    .from("studio_projects")
    .update({
      idea: s.project.idea?.trim() ? s.project.idea : d.quickstart.about || null,
      logline: d.draft.synopsis || s.project.logline,
      ...(h?.one_line
        ? { one_line: h.one_line, one_line_check: { passes: h.one_line_passes, problems: h.notes.filter((n) => n.level === "weak").map((n) => n.text), suggested: h.one_line } }
        : {}),
    })
    .eq("id", c.id);

  if (h) {
    const rows = QUESTIONS.filter((q) => h.spine?.[q.key]?.trim()).map((q) => ({
      project_id: c.id,
      question_key: q.key,
      answer: clip(h.spine[q.key], 2000),
      source: "from_idea",
    }));
    if (rows.length) await c.supabase.from("studio_story_answers").upsert(rows, { onConflict: "project_id,question_key" });
  }

  let position = s.characters.reduce((m, x) => Math.max(m, x.position), 0);
  for (const [i, e] of d.portfolio.characters.entries()) {
    if (!e.name?.trim()) continue;
    const facts = e.facts.map((f) => f.text).join(" ");
    const backstory = clip([i === 0 && d.quickstart.backstory ? d.quickstart.backstory : "", facts].filter(Boolean).join(" "), 2000);
    const existing = s.characters.find((x) => x.name.trim().toLowerCase() === e.name.trim().toLowerCase());
    if (existing) {
      await c.supabase
        .from("studio_characters")
        .update({ role: existing.role || clip(e.role, 120), sheet: { ...existing.sheet, backstory: existing.sheet.backstory || backstory } })
        .eq("id", existing.id);
    } else {
      position += 1;
      await c.supabase.from("studio_characters").insert({ project_id: c.id, position, name: clip(e.name, 120), role: clip(e.role, 120), sheet: { backstory } });
    }
  }
}

export async function lockStory(form: FormData) {
  const c = await ctx(form);
  const gaps = draftGaps(c.s);
  if (gaps.length) go(page(c.id, "#lock"), { error: gaps[0] });
  if (openPlotBlanks(c.s.draft!.draft).length) go(page(c.id, "#lock"), { error: "Answer the open story questions first." });
  await syncClassicFields(c, c.s);
  await afterStoryChange(c.supabase, c.id, "Story writer: locked", c.user.id);
  const fresh = await loadStory(c.supabase, c.id);
  const note = clip(t(form, "note"), 500) || null;
  if (!fresh || !(await recordStoryApproval(c.supabase, fresh, c.user.id, note))) go(page(c.id, "#lock"), { error: "Couldn't record the approval." });
  revalidatePath(`/studio/projects/${c.id}`, "layout");
  go(page(c.id, "#lock"), { ok: "Story locked and approved. Next: the Structure board splits it into episodes and scenes." });
}

// ---------------------------------------------------------------- mode switch

export async function setStoryMode(form: FormData) {
  const c = await ctx(form);
  const mode = t(form, "mode") === "classic" ? "classic" : "draft";
  const { error } = await c.supabase.from("studio_projects").update({ story_mode: mode }).eq("id", c.id);
  if (error) go(page(c.id), { error: "Couldn't switch. Has the database update (0012) been run?" });
  await done(c, mode === "draft" ? "Switched to the story writer" : "Switched to question cards");
  go(page(c.id), { ok: mode === "draft" ? "Switched to the story writer." : "Switched to the question cards." });
}
