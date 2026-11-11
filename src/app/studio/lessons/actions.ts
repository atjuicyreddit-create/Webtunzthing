"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudio } from "@/lib/studio/auth";
import { editLogAvailable, parseEditLog } from "@/lib/studio/lessons/lessons";
import { withParams } from "@/lib/studio/url";

// One server action per button. A lesson only takes effect once Tom approves it AND it's on.

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const here = "/studio/lessons";
function go(params: Record<string, string>, hash = ""): never {
  redirect(withParams(`${here}${hash}`, params));
}

export async function importEditLog(form: FormData) {
  const { supabase } = await requireStudio(here);
  void form;
  if (!editLogAvailable()) go({ error: "EDIT-LOG.md isn't on this computer. The import only works locally." });
  const entries = parseEditLog();
  const { data: existing } = await supabase.from("studio_lessons").select("entry_ref").not("entry_ref", "is", null);
  const have = new Set((existing ?? []).map((r) => r.entry_ref as string));
  const rows = entries
    .filter((e) => !have.has(e.entry_ref))
    .map((e) => ({
      stage: e.stage, problem: e.problem, cause: e.cause || null, fix: e.fix || null, lesson: e.lesson, tag: e.tag,
      theme: e.theme, scope: "global", status: "proposed", active: false, source: "EDIT-LOG.md", entry_ref: e.entry_ref,
      gens: e.gens, kie_usd: e.kie_usd,
    }));
  if (rows.length) {
    const { error } = await supabase.from("studio_lessons").insert(rows);
    if (error) go({ error: "Couldn't import the lessons. Has the Stage 5 database update been run?" });
  }
  revalidatePath(here);
  go({ ok: `Read ${entries.length} entries from EDIT-LOG.md: ${rows.length} new, ${entries.length - rows.length} already here. They start switched off until you approve them.` });
}

export async function approveLesson(form: FormData) {
  const { supabase } = await requireStudio(here);
  await supabase.from("studio_lessons").update({ status: "approved", active: true }).eq("id", t(form, "id"));
  revalidatePath(here);
  go({ ok: "Approved and switched on. It now goes into the matching prompts." }, `#l-${t(form, "id")}`);
}

export async function rejectLesson(form: FormData) {
  const { supabase } = await requireStudio(here);
  await supabase.from("studio_lessons").update({ status: "rejected", active: false }).eq("id", t(form, "id"));
  revalidatePath(here);
  go({ ok: "Rejected. It's kept for the record but never used." }, `#l-${t(form, "id")}`);
}

export async function toggleLesson(form: FormData) {
  const { supabase } = await requireStudio(here);
  const { data } = await supabase.from("studio_lessons").select("active,status").eq("id", t(form, "id")).maybeSingle();
  if (!data) go({ error: "That lesson doesn't exist." });
  if (data.status !== "approved") go({ error: "Approve a lesson before switching it on." });
  await supabase.from("studio_lessons").update({ active: !data.active }).eq("id", t(form, "id"));
  revalidatePath(here);
  go({ ok: data.active ? "Switched off." : "Switched on." }, `#l-${t(form, "id")}`);
}

export async function saveLesson(form: FormData) {
  const { supabase } = await requireStudio(here);
  const lesson = t(form, "lesson").slice(0, 500);
  if (!lesson) go({ error: "The lesson can't be empty." });
  const scope = ["global", "series", "character"].includes(t(form, "scope")) ? t(form, "scope") : "global";
  const tag = t(form, "tag") === "writing" ? "writing" : "art";
  await supabase
    .from("studio_lessons")
    .update({ lesson, scope, scope_ref: scope === "character" ? t(form, "scope_ref").slice(0, 80) || null : null, tag })
    .eq("id", t(form, "id"));
  revalidatePath(here);
  go({ ok: "Lesson saved." }, `#l-${t(form, "id")}`);
}

export async function addLesson(form: FormData) {
  const { supabase } = await requireStudio(here);
  const lesson = t(form, "lesson").slice(0, 500);
  if (!lesson) go({ error: "Write the lesson in one sentence." });
  await supabase.from("studio_lessons").insert({
    stage: "manual", problem: t(form, "problem").slice(0, 1000) || lesson, lesson, tag: t(form, "tag") === "writing" ? "writing" : "art",
    scope: "global", status: "proposed", active: false, source: "tom",
  });
  revalidatePath(here);
  go({ ok: "Lesson added as proposed. Approve it to switch it on." });
}
