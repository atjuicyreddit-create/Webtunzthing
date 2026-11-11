import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUESTIONS } from "./questions";

export type Project = {
  id: string;
  title: string;
  is_test: boolean;
  format: "one_off" | "serial";
  idea: string | null;
  tone: string | null;
  audience: string | null;
  episodes_planned: number | null;
  loglines: { text: string; why: string }[];
  logline: string | null;
  one_line: string | null;
  one_line_check: { passes: boolean; problems: string[] } | null;
  season_summary: string | null;
  destination: string | null;
};

export type Answer = {
  question_key: string;
  answer: string | null;
  source: "suggestion" | "own" | "from_idea" | null;
  suggestions: { answer: string; why: string }[];
};

export type CharacterSheet = {
  backstory?: string;
  want?: string;
  fear?: string;
  flaw?: string;
  voice?: string;
  look?: { silhouette?: string; colours?: { name: string; hex: string }[]; signature?: string };
  props?: string[];
  costume_always?: string;
  costume_never?: string;
  guardrails?: string[];
};

export type Character = { id: string; position: number; name: string; role: string; sheet: CharacterSheet };
export type WhyItem = { id: string; position: number; item: string; question: string; reason: string | null };
export type Milestone = { id: string; position: number; title: string; description: string | null };
export type Suggestion = { id: string; kind: string; text: string; why: string | null; status: "pending" | "accepted" | "rejected" };
export type Gate = {
  id: string;
  state: "open" | "approved" | "stale";
  fingerprint: string | null;
  approved_at: string | null;
  note: string | null;
};

export type Story = {
  project: Project;
  answers: Record<string, Answer>;
  whys: WhyItem[];
  characters: Character[];
  milestones: Milestone[];
  suggestions: Suggestion[];
  gate: Gate | null;
};

export async function loadStory(supabase: SupabaseClient, projectId: string): Promise<Story | null> {
  const { data: project } = await supabase.from("studio_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const [answers, whys, characters, milestones, suggestions, gate] = await Promise.all([
    supabase.from("studio_story_answers").select("question_key,answer,source,suggestions").eq("project_id", projectId),
    supabase.from("studio_why_items").select("id,position,item,question,reason").eq("project_id", projectId).order("position"),
    supabase.from("studio_characters").select("id,position,name,role,sheet").eq("project_id", projectId).order("position"),
    supabase.from("studio_milestones").select("id,position,title,description").eq("project_id", projectId).order("position"),
    supabase.from("studio_suggestions").select("id,kind,text,why,status").eq("project_id", projectId).order("created_at"),
    supabase
      .from("studio_gates")
      .select("id,state,fingerprint,approved_at,note")
      .eq("project_id", projectId)
      .eq("gate", "story_approved")
      .is("episode_id", null)
      .maybeSingle(),
  ]);
  const map: Record<string, Answer> = {};
  for (const a of (answers.data ?? []) as Answer[]) map[a.question_key] = a;
  return {
    project: { ...project, loglines: project.loglines ?? [] } as Project,
    answers: map,
    whys: (whys.data ?? []) as WhyItem[],
    characters: (characters.data ?? []) as Character[],
    milestones: (milestones.data ?? []) as Milestone[],
    suggestions: (suggestions.data ?? []) as Suggestion[],
    gate: (gate.data as Gate) ?? null,
  };
}

/** Everything Tom approves at the Story gate, in a stable order. */
export function storyContent(s: Story) {
  return {
    format: s.project.format,
    idea: s.project.idea ?? "",
    logline: s.project.logline ?? "",
    answers: QUESTIONS.map((q) => [q.key, s.answers[q.key]?.answer ?? ""]),
    whys: s.whys.map((w) => [w.item, w.reason ?? ""]),
    one_line: s.project.one_line ?? "",
    characters: s.characters.map((c) => ({ name: c.name, role: c.role, sheet: c.sheet })),
    season_summary: s.project.season_summary ?? "",
    destination: s.project.destination ?? "",
    milestones: s.milestones.map((m) => [m.title, m.description ?? ""]),
    accepted: s.suggestions.filter((x) => x.status === "accepted").map((x) => x.text),
  };
}

export function fingerprint(s: Story): string {
  return createHash("sha256").update(JSON.stringify(storyContent(s))).digest("hex").slice(0, 32);
}

/** What still blocks approval (empty list = ready). */
export function storyGaps(s: Story): string[] {
  const gaps: string[] = [];
  if (!s.project.logline?.trim()) gaps.push("Pick or write a logline (Idea).");
  for (const q of QUESTIONS) if (!s.answers[q.key]?.answer?.trim()) gaps.push(`Answer: ${q.title}`);
  if (s.whys.some((w) => !w.reason?.trim())) gaps.push("Give a reason for every item in the Why? pass.");
  if (!s.project.one_line?.trim()) gaps.push("Write the one-line test.");
  else if (!s.project.one_line_check?.passes) gaps.push("The one-line test needs to pass Claude's check (or edit it until it does).");
  if (s.characters.length === 0) gaps.push("Add at least the lead's character sheet.");
  if (s.project.format === "serial") {
    if (!s.project.destination?.trim()) gaps.push("Set the season's destination.");
    if (s.milestones.length < 3 || s.milestones.length > 5) gaps.push("Set 3 to 5 growth milestones.");
  }
  if (s.suggestions.some((x) => x.status === "pending")) gaps.push("Accept or reject each plot suggestion.");
  return gaps;
}

/** Writes a version snapshot and, if the approved story changed, marks the gate stale. */
export async function afterStoryChange(supabase: SupabaseClient, projectId: string, reason: string, userId: string) {
  const s = await loadStory(supabase, projectId);
  if (!s) return;
  const fp = fingerprint(s);

  const { data: last } = await supabase
    .from("studio_versions")
    .select("version,snapshot")
    .eq("item_type", "story")
    .eq("item_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastFp = (last?.snapshot as { fingerprint?: string } | null)?.fingerprint;
  if (lastFp !== fp) {
    await supabase.from("studio_versions").insert({
      project_id: projectId,
      item_type: "story",
      item_id: projectId,
      version: (last?.version ?? 0) + 1,
      snapshot: { fingerprint: fp, content: storyContent(s) },
      reason,
      created_by: userId,
    });
  }

  // The story is upstream of every script: an approved script no longer matches a changed story.
  if (lastFp !== undefined && lastFp !== fp) {
    const { data: scriptGates } = await supabase
      .from("studio_gates")
      .select("id")
      .eq("project_id", projectId)
      .eq("gate", "script_final")
      .eq("state", "approved");
    for (const g of scriptGates ?? []) {
      await supabase.from("studio_gates").update({ state: "stale", updated_at: new Date().toISOString() }).eq("id", g.id);
      await supabase.from("studio_gate_events").insert({ gate_id: g.id, action: "stale", actor: userId, note: `Story changed: ${reason}`, fingerprint: fp });
    }
  }

  if (s.gate?.state === "approved" && s.gate.fingerprint !== fp) {
    await supabase
      .from("studio_gates")
      .update({ state: "stale", updated_at: new Date().toISOString() })
      .eq("id", s.gate.id);
    await supabase.from("studio_gate_events").insert({
      gate_id: s.gate.id,
      action: "stale",
      actor: userId,
      note: `Story changed after approval: ${reason}`,
      fingerprint: fp,
    });
  }
}
