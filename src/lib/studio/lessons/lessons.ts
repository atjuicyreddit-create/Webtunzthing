import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// The lessons memory. Only approved + active lessons are ever used. Art lessons go into
// image prompts and vision QA; writing lessons go into the script check.

export type Lesson = {
  id: string;
  stage: string;
  problem: string;
  cause: string | null;
  fix: string | null;
  lesson: string;
  tag: "writing" | "art";
  theme: string | null;
  scope: "global" | "series" | "character";
  scope_ref: string | null;
  project_id: string | null;
  status: "proposed" | "approved" | "rejected";
  active: boolean;
  source: string | null;
  is_key: boolean;
  entry_ref: string | null;
  created_at: string;
};

export const LESSON_COLS = "id,stage,problem,cause,fix,lesson,tag,theme,scope,scope_ref,project_id,status,active,source,is_key,entry_ref,created_at";

/** Active lessons that apply: global ones, this project's series ones, and character ones for the named characters. */
export async function activeLessons(
  supabase: SupabaseClient,
  tag: "writing" | "art",
  projectId: string,
  characterNames: string[] = [],
): Promise<Lesson[]> {
  const { data } = await supabase.from("studio_lessons").select(LESSON_COLS).eq("tag", tag).eq("status", "approved").eq("active", true);
  const names = new Set(characterNames.map((n) => n.trim().toLowerCase()));
  return ((data ?? []) as Lesson[])
    .filter((l) => {
      if (l.scope === "global") return true;
      if (l.scope === "series") return !l.project_id || l.project_id === projectId;
      return Boolean(l.scope_ref && names.has(l.scope_ref.trim().toLowerCase())) && (!l.project_id || l.project_id === projectId);
    })
    .sort((a, b) => Number(b.is_key) - Number(a.is_key) || a.created_at.localeCompare(b.created_at));
}

// ------------------------------------------------------------------ EDIT-LOG.md import (local only)

const EDIT_LOG = path.join(process.cwd(), "studio-reference", "EDIT-LOG.md");

export function editLogAvailable(): boolean {
  return fs.existsSync(EDIT_LOG);
}

export type EditLogEntry = {
  entry_ref: string;
  stage: string;
  problem: string;
  cause: string;
  fix: string;
  lesson: string;
  theme: string;
  gens: number | null;
  kie_usd: number | null;
  tag: "writing" | "art";
};

/** Reads the fixed field format: "### date · comic · stage · panel" then "- Field: value" lines. */
export function parseEditLog(): EditLogEntry[] {
  const text = fs.readFileSync(EDIT_LOG, "utf8");
  const body = text.replace(/```[\s\S]*?```/g, ""); // skip the format example
  const out: EditLogEntry[] = [];
  for (const block of body.split(/\n### /).slice(1)) {
    const head = block.split("\n")[0].trim();
    const parts = head.split("·").map((x) => x.trim());
    if (parts.length < 3) continue;
    const f = (name: string) => block.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1].trim() ?? "";
    const lesson = f("Lesson");
    if (!lesson) continue;
    const cause = f("Cause").toLowerCase();
    const theme = f("Theme").toLowerCase().split(/[\s|,]+/)[0] || "process";
    const stage = parts[2] ?? "";
    const writing = cause === "script" || /script|story/i.test(stage);
    const gens = Number(f("Gens"));
    const usd = Number(f("KIE_usd").replace(/[^0-9.]/g, ""));
    out.push({
      entry_ref: head.slice(0, 200),
      stage: stage.slice(0, 120) || "panels",
      problem: f("Problem").slice(0, 1000) || "(no problem recorded)",
      cause: cause.slice(0, 40),
      fix: f("Fix").slice(0, 1000),
      lesson: lesson.slice(0, 500),
      theme,
      gens: Number.isFinite(gens) && f("Gens") !== "" ? Math.round(gens) : null,
      kie_usd: Number.isFinite(usd) && f("KIE_usd") !== "" ? usd : null,
      tag: writing ? "writing" : "art",
    });
  }
  return out;
}
