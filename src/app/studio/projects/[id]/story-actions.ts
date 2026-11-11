"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudio } from "@/lib/studio/auth";
import { QUESTION_KEYS, questionByKey, type QuestionKey } from "@/lib/studio/story/questions";
import { runStoryAction } from "@/lib/studio/story/run";
import { afterStoryChange, fingerprint, loadStory, storyGaps } from "@/lib/studio/story/story";

// One server action per button. Each re-checks access; the database rules apply too.
// Claude actions go through the cost gateway (estimate, caps, ledger, dry-run).

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clip = (s: string, n: number) => s.slice(0, n);

function go(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${path}${q ? (path.includes("?") ? "&" : "?") + q : ""}`);
}

async function ctx(form: FormData) {
  const id = t(form, "project_id");
  const c = await requireStudio(`/studio/projects/${id}`);
  const s = await loadStory(c.supabase, id);
  if (!s) go("/studio", { error: "That project doesn't exist." });
  return { ...c, id, s };
}

const idea = (id: string) => `/studio/projects/${id}/idea`;
const story = (id: string, step: string, extra = "") => `/studio/projects/${id}/story?step=${step}${extra}`;

async function done(c: { supabase: Awaited<ReturnType<typeof requireStudio>>["supabase"]; user: { id: string }; id: string }, reason: string) {
  await afterStoryChange(c.supabase, c.id, reason, c.user.id);
  revalidatePath(`/studio/projects/${c.id}`, "layout");
}

// ---------------------------------------------------------------- Idea

export async function saveIdea(form: FormData) {
  const c = await ctx(form);
  const episodes = Number(t(form, "episodes_planned"));
  const { error } = await c.supabase
    .from("studio_projects")
    .update({
      idea: clip(t(form, "idea"), 4000) || null,
      tone: clip(t(form, "tone"), 200) || null,
      audience: clip(t(form, "audience"), 200) || null,
      episodes_planned: Number.isInteger(episodes) && episodes >= 1 && episodes <= 100 ? episodes : null,
      format: t(form, "format") === "one_off" ? "one_off" : "serial",
    })
    .eq("id", c.id);
  if (error) go(idea(c.id), { error: "Couldn't save the idea." });
  await done(c, "Idea edited");
  go(idea(c.id), { ok: "Idea saved." });
}

export async function suggestLoglines(form: FormData) {
  const c = await ctx(form);
  if (!c.s.project.idea?.trim()) go(idea(c.id), { error: "Write the idea and save it first." });
  const r = await runStoryAction<{ loglines: { text: string; why: string }[] }>(c.supabase, c.s, { kind: "loglines" });
  if (!r.ok) go(idea(c.id), { error: r.reason });
  const loglines = (r.data.loglines ?? []).slice(0, 3).map((l) => ({ text: clip(l.text, 500), why: clip(l.why, 300) }));
  await c.supabase.from("studio_projects").update({ loglines }).eq("id", c.id);
  revalidatePath(idea(c.id));
  go(idea(c.id), { ok: `Three loglines ready (${r.note})` });
}

export async function chooseLogline(form: FormData) {
  const c = await ctx(form);
  const own = t(form, "own_logline");
  const pick = Number(t(form, "pick"));
  const logline = own || c.s.project.loglines[pick]?.text || "";
  if (!logline) go(idea(c.id), { error: "Pick a logline or write your own." });
  await c.supabase.from("studio_projects").update({ logline: clip(logline, 500) }).eq("id", c.id);
  await done(c, "Logline chosen");
  go(idea(c.id), { ok: "Logline saved. Next: let Claude read the idea, or go straight to the questions." });
}

export async function readIdea(form: FormData) {
  const c = await ctx(form);
  if (!c.s.project.logline) go(idea(c.id), { error: "Choose a logline first." });
  const r = await runStoryAction<{ answers: { key: string; answer: string }[] }>(c.supabase, c.s, { kind: "read_idea" });
  if (!r.ok) go(idea(c.id), { error: r.reason });
  let n = 0;
  for (const a of r.data.answers ?? []) {
    if (!QUESTION_KEYS.includes(a.key as QuestionKey) || !a.answer?.trim()) continue;
    if (c.s.answers[a.key]?.answer?.trim()) continue; // never overwrite Tom's answers
    await c.supabase
      .from("studio_story_answers")
      .upsert(
        { project_id: c.id, question_key: a.key, answer: clip(a.answer, 1000), source: "from_idea", updated_at: new Date().toISOString() },
        { onConflict: "project_id,question_key" },
      );
    n++;
  }
  await done(c, "Answers read from the idea");
  go(story(c.id, "cards"), { ok: `${n} question${n === 1 ? "" : "s"} answered from your idea, marked "From your idea" (${r.note})` });
}

// ---------------------------------------------------------------- Question cards

export async function suggestAnswers(form: FormData) {
  const c = await ctx(form);
  const key = t(form, "key") as QuestionKey;
  if (!questionByKey(key)) go(story(c.id, "cards"), { error: "Unknown question." });
  const r = await runStoryAction<{ suggestions: { answer: string; why: string }[] }>(c.supabase, c.s, { kind: "suggest", key });
  const back = story(c.id, "cards", `&q=${key}`);
  if (!r.ok) go(back, { error: r.reason });
  const suggestions = (r.data.suggestions ?? []).slice(0, 4).map((x) => ({ answer: clip(x.answer, 600), why: clip(x.why, 300) }));
  await c.supabase
    .from("studio_story_answers")
    .upsert(
      {
        project_id: c.id,
        question_key: key,
        suggestions,
        answer: c.s.answers[key]?.answer ?? null,
        source: c.s.answers[key]?.source ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,question_key" },
    );
  revalidatePath(`/studio/projects/${c.id}/story`);
  go(back, { ok: `Suggestions ready (${r.note})` });
}

export async function saveAnswer(form: FormData) {
  const c = await ctx(form);
  const key = t(form, "key") as QuestionKey;
  if (!questionByKey(key)) go(story(c.id, "cards"), { error: "Unknown question." });
  const own = t(form, "own");
  const pickIdx = t(form, "pick");
  const picked = pickIdx !== "" ? c.s.answers[key]?.suggestions?.[Number(pickIdx)]?.answer : undefined;
  const current = c.s.answers[key]?.answer ?? "";
  const answer = own && own !== current ? own : picked ?? (own || "");
  const source = own && own !== current ? "own" : picked ? "suggestion" : c.s.answers[key]?.source ?? "own";
  if (!answer) go(story(c.id, "cards", `&q=${key}`), { error: "Pick a suggestion or write your own answer." });
  await c.supabase
    .from("studio_story_answers")
    .upsert(
      {
        project_id: c.id,
        question_key: key,
        answer: clip(answer, 1000),
        source,
        suggestions: c.s.answers[key]?.suggestions ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,question_key" },
    );
  await done(c, `Answer changed: ${key}`);
  const i = QUESTION_KEYS.indexOf(key);
  const next = QUESTION_KEYS.slice(i + 1).find((k) => !c.s.answers[k]?.answer?.trim()) ?? QUESTION_KEYS[i + 1];
  if (next) go(story(c.id, "cards", `&q=${next}`), { ok: "Saved." });
  go(story(c.id, "why"), { ok: "All questions answered. Next: the Why? pass." });
}

// ---------------------------------------------------------------- Why? pass

export async function runWhyPass(form: FormData) {
  const c = await ctx(form);
  const r = await runStoryAction<{ items: { item: string; question: string }[] }>(c.supabase, c.s, { kind: "why_pass" });
  if (!r.ok) go(story(c.id, "why"), { error: r.reason });
  const existing = new Set(c.s.whys.map((w) => w.item.toLowerCase()));
  const fresh = (r.data.items ?? [])
    .slice(0, 8)
    .filter((x) => x.item?.trim() && !existing.has(x.item.toLowerCase()))
    .map((x, i) => ({
      project_id: c.id,
      position: c.s.whys.length + i,
      item: clip(x.item, 200),
      question: clip(x.question, 300),
    }));
  if (fresh.length) await c.supabase.from("studio_why_items").insert(fresh);
  await done(c, "Why? pass run");
  go(story(c.id, "why"), {
    ok: fresh.length ? `${fresh.length} item${fresh.length === 1 ? "" : "s"} need a reason (${r.note})` : `Nothing new is missing a reason (${r.note})`,
  });
}

export async function saveWhyReasons(form: FormData) {
  const c = await ctx(form);
  for (const w of c.s.whys) {
    const reason = t(form, `reason_${w.id}`);
    if (reason !== (w.reason ?? "")) {
      await c.supabase.from("studio_why_items").update({ reason: clip(reason, 500) || null }).eq("id", w.id);
    }
  }
  await done(c, "Why? reasons edited");
  go(story(c.id, "why"), { ok: "Reasons saved." });
}

export async function deleteWhyItem(form: FormData) {
  const c = await ctx(form);
  await c.supabase.from("studio_why_items").delete().eq("id", t(form, "why_id")).eq("project_id", c.id);
  await done(c, "Why? item removed");
  go(story(c.id, "why"), { ok: "Removed." });
}

// ---------------------------------------------------------------- One-line test

export async function saveOneLine(form: FormData) {
  const c = await ctx(form);
  const sentence = clip(t(form, "one_line"), 600);
  await c.supabase
    .from("studio_projects")
    .update({ one_line: sentence || null, one_line_check: sentence === c.s.project.one_line ? c.s.project.one_line_check : null })
    .eq("id", c.id);
  await done(c, "One-line test edited");
  go(story(c.id, "oneline"), { ok: "Saved. Run the check to confirm it passes." });
}

export async function checkOneLine(form: FormData) {
  const c = await ctx(form);
  const typed = t(form, "one_line");
  if (typed && typed !== c.s.project.one_line) {
    await c.supabase.from("studio_projects").update({ one_line: clip(typed, 600), one_line_check: null }).eq("id", c.id);
    c.s.project.one_line = clip(typed, 600);
  }
  const r = await runStoryAction<{ sentence: string; passes: boolean; problems: string[] }>(c.supabase, c.s, { kind: "one_line" });
  if (!r.ok) go(story(c.id, "oneline"), { error: r.reason });
  const problems = (r.data.problems ?? []).slice(0, 6).map((p) => clip(p, 300));
  const update: Record<string, unknown> = { one_line_check: { passes: Boolean(r.data.passes), problems, suggested: clip(r.data.sentence ?? "", 600) } };
  if (!c.s.project.one_line) update.one_line = clip(r.data.sentence ?? "", 600); // first draft only; never overwrite Tom's
  await c.supabase.from("studio_projects").update(update).eq("id", c.id);
  await done(c, "One-line test checked");
  go(story(c.id, "oneline"), { ok: `${r.data.passes ? "Passes." : "Doesn't pass yet: see the notes."} (${r.note})` });
}

export async function useSuggestedOneLine(form: FormData) {
  const c = await ctx(form);
  const suggested = (c.s.project.one_line_check as { suggested?: string } | null)?.suggested;
  if (!suggested) go(story(c.id, "oneline"), { error: "There's no suggested sentence yet." });
  await c.supabase.from("studio_projects").update({ one_line: suggested, one_line_check: null }).eq("id", c.id);
  await done(c, "One-line test replaced with Claude's suggestion");
  go(story(c.id, "oneline"), { ok: "Suggestion copied in. Run the check again." });
}

// ---------------------------------------------------------------- Characters

type DraftChar = {
  name: string;
  role: string;
  backstory: string;
  want: string;
  fear: string;
  flaw: string;
  voice: string;
  look: { silhouette: string; colours: { name: string; hex: string }[]; signature: string };
  props: string[];
  costume_always: string;
  costume_never: string;
  guardrails: string[];
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function draftCharacters(form: FormData) {
  const c = await ctx(form);
  const r = await runStoryAction<{ characters: DraftChar[] }>(c.supabase, c.s, { kind: "characters" });
  if (!r.ok) go(story(c.id, "characters"), { error: r.reason });
  const existing = new Set(c.s.characters.map((x) => x.name.toLowerCase()));
  const rows = (r.data.characters ?? [])
    .slice(0, 8)
    .filter((x) => x.name?.trim() && !existing.has(x.name.toLowerCase()))
    .map((x, i) => ({
      project_id: c.id,
      position: c.s.characters.length + i,
      name: clip(x.name, 80),
      role: clip(x.role ?? "", 80),
      sheet: {
        backstory: clip(x.backstory ?? "", 1000),
        want: clip(x.want ?? "", 300),
        fear: clip(x.fear ?? "", 300),
        flaw: clip(x.flaw ?? "", 300),
        voice: clip(x.voice ?? "", 300),
        look: {
          silhouette: clip(x.look?.silhouette ?? "", 300),
          colours: (x.look?.colours ?? []).filter((k) => HEX.test(k.hex)).slice(0, 6).map((k) => ({ name: clip(k.name, 40), hex: k.hex.toUpperCase() })),
          signature: clip(x.look?.signature ?? "", 300),
        },
        props: (x.props ?? []).slice(0, 8).map((p) => clip(p, 80)),
        costume_always: clip(x.costume_always ?? "", 300),
        costume_never: clip(x.costume_never ?? "", 300),
        guardrails: (x.guardrails ?? []).slice(0, 8).map((g) => clip(g, 200)),
      },
    }));
  if (rows.length) await c.supabase.from("studio_characters").insert(rows);
  await done(c, "Character sheets drafted");
  go(story(c.id, "characters"), {
    ok: rows.length ? `${rows.length} character sheet${rows.length === 1 ? "" : "s"} drafted. Edit anything (${r.note})` : `No new characters (${r.note})`,
  });
}

const lines = (s: string, max: number, n: number) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, n)
    .map((x) => clip(x, max));

export async function saveCharacter(form: FormData) {
  const c = await ctx(form);
  const id = t(form, "character_id");
  const name = clip(t(form, "name"), 80);
  const back = story(c.id, "characters", `&c=${id}`);
  if (!name) go(back, { error: "A character needs a name." });
  const colours = lines(t(form, "colours"), 60, 6)
    .map((l) => {
      const m = l.match(/^(.*?)[\s:–-]*\s*(#[0-9a-fA-F]{6})$/);
      return m ? { name: clip(m[1].trim() || "Colour", 40), hex: m[2].toUpperCase() } : null;
    })
    .filter((x): x is { name: string; hex: string } => x !== null);
  const sheet = {
    backstory: clip(t(form, "backstory"), 1000),
    want: clip(t(form, "want"), 300),
    fear: clip(t(form, "fear"), 300),
    flaw: clip(t(form, "flaw"), 300),
    voice: clip(t(form, "voice"), 300),
    look: { silhouette: clip(t(form, "silhouette"), 300), colours, signature: clip(t(form, "signature"), 300) },
    props: lines(t(form, "props"), 80, 8),
    costume_always: clip(t(form, "costume_always"), 300),
    costume_never: clip(t(form, "costume_never"), 300),
    guardrails: lines(t(form, "guardrails"), 200, 8),
  };
  const { error } = await c.supabase
    .from("studio_characters")
    .update({ name, role: clip(t(form, "role"), 80), sheet, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("project_id", c.id);
  if (error) go(back, { error: "Couldn't save the character." });
  await done(c, `Character edited: ${name}`);
  go(back, { ok: `${name} saved.` });
}

export async function addCharacter(form: FormData) {
  const c = await ctx(form);
  const { data } = await c.supabase
    .from("studio_characters")
    .insert({ project_id: c.id, position: c.s.characters.length, name: "New character", role: "", sheet: {} })
    .select("id")
    .single();
  await done(c, "Character added");
  go(story(c.id, "characters", data ? `&c=${data.id}` : ""), { ok: "Character added. Fill in the sheet." });
}

export async function deleteCharacter(form: FormData) {
  const c = await ctx(form);
  if (t(form, "confirm") !== "delete") go(story(c.id, "characters", `&c=${t(form, "character_id")}`), { error: "Type delete to confirm." });
  await c.supabase.from("studio_characters").delete().eq("id", t(form, "character_id")).eq("project_id", c.id);
  await done(c, "Character deleted");
  go(story(c.id, "characters"), { ok: "Character deleted." });
}

// ---------------------------------------------------------------- Season plot

export async function draftPlot(form: FormData) {
  const c = await ctx(form);
  const r = await runStoryAction<{
    season_summary: string;
    destination: string;
    milestones: { title: string; description: string }[];
    suggestions: { text: string; why: string }[];
  }>(c.supabase, c.s, { kind: "plot" });
  if (!r.ok) go(story(c.id, "plot"), { error: r.reason });
  const serial = c.s.project.format === "serial";
  const update: Record<string, unknown> = {};
  if (!c.s.project.season_summary) update.season_summary = clip(r.data.season_summary ?? "", 2000);
  if (serial && !c.s.project.destination) update.destination = clip(r.data.destination ?? "", 500);
  if (Object.keys(update).length) await c.supabase.from("studio_projects").update(update).eq("id", c.id);
  if (serial && c.s.milestones.length === 0) {
    const ms = (r.data.milestones ?? []).slice(0, 5).map((m, i) => ({
      project_id: c.id,
      position: i + 1,
      title: clip(m.title, 120),
      description: clip(m.description ?? "", 400),
    }));
    if (ms.length) await c.supabase.from("studio_milestones").insert(ms);
  }
  const sg = (r.data.suggestions ?? []).slice(0, 5).map((x) => ({
    project_id: c.id,
    kind: "plotline",
    text: clip(x.text, 400),
    why: clip(x.why ?? "", 300),
  }));
  if (sg.length) await c.supabase.from("studio_suggestions").insert(sg);
  await done(c, "Season plot drafted");
  go(story(c.id, "plot"), { ok: `Plot drafted. Anything you'd already written was kept (${r.note})` });
}

export async function savePlot(form: FormData) {
  const c = await ctx(form);
  await c.supabase
    .from("studio_projects")
    .update({ season_summary: clip(t(form, "season_summary"), 2000) || null, destination: clip(t(form, "destination"), 500) || null })
    .eq("id", c.id);
  if (c.s.project.format === "serial") {
    const ms = lines(t(form, "milestones"), 400, 5);
    await c.supabase.from("studio_milestones").delete().eq("project_id", c.id);
    if (ms.length) {
      await c.supabase.from("studio_milestones").insert(
        ms.map((m, i) => {
          const [title, ...rest] = m.split(/\s[–-]\s|:\s/);
          return { project_id: c.id, position: i + 1, title: clip(title.trim(), 120), description: clip(rest.join(" - ").trim(), 400) };
        }),
      );
    }
  }
  await done(c, "Season plot edited");
  go(story(c.id, "plot"), { ok: "Plot saved." });
}

export async function acceptSuggestion(form: FormData) {
  const c = await ctx(form);
  await c.supabase.from("studio_suggestions").update({ status: "accepted" }).eq("id", t(form, "suggestion_id")).eq("project_id", c.id);
  await done(c, "Suggestion accepted");
  go(story(c.id, "plot"), { ok: "Accepted. Fold it into your answers where it fits." });
}

export async function rejectSuggestion(form: FormData) {
  const c = await ctx(form);
  await c.supabase.from("studio_suggestions").update({ status: "rejected" }).eq("id", t(form, "suggestion_id")).eq("project_id", c.id);
  await done(c, "Suggestion rejected");
  go(story(c.id, "plot"), { ok: "Rejected." });
}

// ---------------------------------------------------------------- Gate: Story approved

export async function approveStory(form: FormData) {
  const c = await ctx(form);
  const gaps = storyGaps(c.s);
  if (gaps.length) go(story(c.id, "approve"), { error: "Not ready yet: see the list below." });
  const fp = fingerprint(c.s);
  const note = clip(t(form, "note"), 500) || null;
  const now = new Date().toISOString();
  let gateId = c.s.gate?.id;
  if (gateId) {
    await c.supabase
      .from("studio_gates")
      .update({ state: "approved", fingerprint: fp, approved_by: c.user.id, approved_at: now, note, updated_at: now })
      .eq("id", gateId);
  } else {
    const { data } = await c.supabase
      .from("studio_gates")
      .insert({ project_id: c.id, gate: "story_approved", state: "approved", fingerprint: fp, approved_by: c.user.id, approved_at: now, note })
      .select("id")
      .single();
    gateId = data?.id;
  }
  if (!gateId) go(story(c.id, "approve"), { error: "Couldn't record the approval." });
  await c.supabase.from("studio_gate_events").insert({ gate_id: gateId, action: "approved", actor: c.user.id, note, fingerprint: fp });
  revalidatePath(`/studio/projects/${c.id}`, "layout");
  go(story(c.id, "approve"), { ok: "Story approved. Recorded with your name, the time and your note." });
}

export async function reopenStory(form: FormData) {
  const c = await ctx(form);
  if (!c.s.gate) go(story(c.id, "approve"), {});
  await c.supabase.from("studio_gates").update({ state: "open", updated_at: new Date().toISOString() }).eq("id", c.s.gate!.id);
  await c.supabase.from("studio_gate_events").insert({ gate_id: c.s.gate!.id, action: "reopened", actor: c.user.id, note: clip(t(form, "note"), 500) || null });
  revalidatePath(`/studio/projects/${c.id}`, "layout");
  go(story(c.id, "approve"), { ok: "Story reopened for changes." });
}
