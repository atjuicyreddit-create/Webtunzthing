"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiClaude, aiImageStart } from "@/lib/studio/ai/aiCall";
import { removeStudioFolder } from "@/lib/studio/assets/storage";
import { requireStudio } from "@/lib/studio/auth";
import { morningBrewAvailable, parseMorningBrew } from "@/lib/studio/seed/morningBrew";
import { formatUsd, getStudioSettings } from "@/lib/studio/settings";

// One server action per button (a button's name/value doesn't reach actions here).
// Every action re-checks access; the database rules (is_admin) apply as well.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function back(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(`${path}${path.includes("?") ? "&" : "?"}${q}`);
}

// ---------------------------------------------------------------- projects

export async function createProject(form: FormData) {
  const { supabase } = await requireStudio();
  const title = text(form, "title");
  if (!title) back("/studio", { error: "Please give the project a title." });
  const { data, error } = await supabase
    .from("studio_projects")
    .insert({
      title: title.slice(0, 120),
      format: text(form, "format") === "one_off" ? "one_off" : "serial",
      is_test: form.get("is_test") === "on",
    })
    .select("id")
    .single();
  if (error || !data) back("/studio", { error: "Couldn't create the project. Has the Stage 0 database update been run?" });
  revalidatePath("/studio");
  redirect(`/studio/projects/${data.id}?created=1`);
}

export async function renameProject(form: FormData) {
  const { supabase } = await requireStudio();
  const id = text(form, "id");
  const title = text(form, "title");
  const here = `/studio/projects/${id}`;
  if (!title) back(here, { error: "The title can't be empty." });
  const { error } = await supabase
    .from("studio_projects")
    .update({
      title: title.slice(0, 120),
      format: text(form, "format") === "one_off" ? "one_off" : "serial",
    })
    .eq("id", id);
  if (error) back(here, { error: "Couldn't save the project." });
  revalidatePath("/studio");
  back(here, { saved: "1" });
}

export async function deleteProject(form: FormData) {
  const { supabase } = await requireStudio();
  const id = text(form, "id");
  if (text(form, "confirm") !== "delete") back(`/studio/projects/${id}`, { error: "Type delete to confirm." });
  const { error } = await supabase.from("studio_projects").delete().eq("id", id);
  if (error) back(`/studio/projects/${id}`, { error: "Couldn't delete the project." });
  // The project's images live in the private bucket under projects/<id>/; delete them too.
  await removeStudioFolder(supabase, `projects/${id}`);
  revalidatePath("/studio");
  back("/studio", { deleted: "1" });
}

// ---------------------------------------------------------------- Morning Brew test import (local only)

export async function importMorningBrew(form: FormData) {
  const { supabase } = await requireStudio();
  void form;
  if (!morningBrewAvailable()) {
    back("/studio", { error: "The Morning Brew files aren't on this computer. The import only works locally (studio-reference/ isn't deployed)." });
  }
  const mb = parseMorningBrew();
  const { data: project, error } = await supabase
    .from("studio_projects")
    .insert({
      title: "Morning Brew (test import)",
      is_test: true,
      format: "serial",
      idea: mb.idea,
      logline: mb.oneLine,
      one_line: mb.oneLine,
      episodes_planned: 1,
    })
    .select("id")
    .single();
  if (error || !project) back("/studio", { error: "Couldn't create the test project. Have migrations 0005 to 0008 been run?" });
  const pid = project.id;

  const answers = Object.entries(mb.answers)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ project_id: pid, question_key: k, answer: v.slice(0, 1000), source: "own" }));
  if (answers.length) await supabase.from("studio_story_answers").insert(answers);
  if (mb.characters.length) {
    await supabase
      .from("studio_characters")
      .insert(mb.characters.map((c, i) => ({ project_id: pid, position: i, name: c.name, role: c.role, sheet: c.sheet })));
  }

  const { data: ep } = await supabase.from("studio_episodes").insert({ project_id: pid, number: 1, title: "Morning Brew" }).select("id").single();
  if (!ep) back("/studio", { error: "Couldn't create the test episode." });
  await supabase.from("studio_acts").insert({ project_id: pid, episode_id: ep.id, position: 1, title: "Episode 1" });
  const { data: script } = await supabase
    .from("studio_scripts")
    .insert({ project_id: pid, episode_id: ep.id, version: 1, changelog: "Imported from story.md v3.5 (not marked final)" })
    .select("id")
    .single();
  if (script) {
    const keys = mb.panels.map((_, i) => `p${String(i + 1).padStart(2, "0")}`);
    await supabase.from("studio_script_panels").insert(
      mb.panels.map((p, i) => ({
        script_id: script.id,
        panel_key: keys[i],
        position: i + 1,
        title: p.title.slice(0, 120),
        shot: p.shot.slice(0, 120) || null,
        // Everyone named in the visual or speaking ("Mallow" matches "Great-Aunt Mallow").
        characters: mb.characters
          .filter((c) => {
            const short = c.name.split(/\s+/).pop() ?? c.name;
            const said = p.dialogue.some((d) => d.speaker.toLowerCase().includes(short.toLowerCase()));
            return said || new RegExp(`\\b(${c.name}|${short})\\b`, "i").test(p.action);
          })
          .map((c) => c.name),
        action: p.action.slice(0, 2000),
        caption: p.caption.slice(0, 200) || null,
        dialogue: p.dialogue,
        size: p.size,
        gap_after: p.gap_after,
        clock: p.clock || null,
        matches_key: p.matches > 0 && p.matches <= i ? keys[p.matches - 1] : null,
        text_items: p.caption ? [{ text: p.caption, how: "lettered" }] : [],
      })),
    );
  }
  await supabase.from("studio_forks").insert({
    project_id: pid,
    episode_id: ep.id,
    question: mb.fork.question || null,
    in_bounds: mb.fork.in_bounds || null,
    locked: mb.fork.locked || null,
    backup_pick: mb.fork.backup_pick || null,
    branches: [],
  });
  revalidatePath("/studio");
  redirect(`/studio/projects/${pid}/script?ep=${ep.id}&ok=${encodeURIComponent(`Imported Morning Brew as a test project: ${mb.panels.length} panels, ${mb.characters.length} characters. Every gate is open.`)}`);
}

// ---------------------------------------------------------------- settings

function num(f: FormData, k: string, min: number, max: number): number | null {
  const v = Number(text(f, k));
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export async function saveSettings(form: FormData) {
  const { supabase } = await requireStudio("/studio/settings");
  const here = "/studio/settings";

  const models = {
    story: text(form, "model_story"),
    small: text(form, "model_small"),
    vision: text(form, "model_vision"),
    image: text(form, "model_image"),
  };
  if (Object.values(models).some((m) => !/^[a-z0-9][a-z0-9.\-_]{1,63}$/.test(m))) {
    back(here, { error: "Model ids may only use lowercase letters, numbers, dots and dashes." });
  }

  let prices: unknown;
  try {
    prices = JSON.parse(text(form, "prices"));
  } catch {
    back(here, { error: "The price table isn't valid JSON." });
  }
  const p = prices as { claude?: Record<string, unknown>; image?: Record<string, unknown> };
  if (!p || typeof p !== "object" || typeof p.claude !== "object" || typeof p.image !== "object") {
    back(here, { error: 'The price table needs a "claude" section and an "image" section.' });
  }
  for (const [model, v] of Object.entries(p.claude ?? {})) {
    const c = v as Record<string, unknown>;
    if (!["input", "output", "cache_read"].every((k) => typeof c?.[k] === "number" && (c[k] as number) >= 0)) {
      back(here, { error: `Claude price for ${model} needs input, output and cache_read numbers.` });
    }
  }
  for (const [key, v] of Object.entries(p.image ?? {})) {
    if (typeof v !== "number" || v < 0) back(here, { error: `Image price for ${key} must be a number.` });
  }
  if (!(p.claude as Record<string, unknown>)[models.story] || !(p.claude as Record<string, unknown>)[models.small] || !(p.claude as Record<string, unknown>)[models.vision]) {
    back(here, { error: "Every Claude model you pick needs a price in the table." });
  }

  const caps = {
    episode_image_cap_usd: num(form, "episode_image_cap_usd", 0, 1000),
    episode_image_cap_gens: num(form, "episode_image_cap_gens", 0, 10000),
    episode_claude_cap_usd: num(form, "episode_claude_cap_usd", 0, 1000),
    session_cap_usd: num(form, "session_cap_usd", 0, 10000),
    warn_at: num(form, "warn_at_percent", 1, 100),
  };
  if (Object.values(caps).some((v) => v === null)) back(here, { error: "Check the limits: each must be a number in range." });

  const { error } = await supabase
    .from("studio_settings")
    .update({
      models,
      prices,
      episode_image_cap_usd: caps.episode_image_cap_usd,
      episode_image_cap_gens: Math.round(caps.episode_image_cap_gens!),
      episode_claude_cap_usd: caps.episode_claude_cap_usd,
      session_cap_usd: caps.session_cap_usd,
      warn_at: caps.warn_at! / 100,
      dry_run: form.get("dry_run") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) back(here, { error: "Couldn't save the settings." });
  revalidatePath("/studio", "layout");
  back(here, { saved: "1" });
}

// ---------------------------------------------------------------- gateway tests

export async function testClaudeCall(form: FormData) {
  const { supabase } = await requireStudio("/studio/settings");
  const here = "/studio/settings";
  const settings = await getStudioSettings(supabase);
  if (settings && !settings.dry_run && form.get("confirm_spend") !== "on") {
    back(here, { error: "Dry-run is off, so this test costs real money. Tick the box to confirm first." });
  }
  const r = await aiClaude({
    supabase,
    purpose: "Settings: test call",
    role: "small",
    maxTokens: 64,
    effort: "low",
    messages: [{ role: "user", content: "Reply with exactly: Pathtoon Studio is connected." }],
  });
  if (!r.ok) back(here, { error: r.reason });
  back(here, {
    test: `${r.dryRun ? "Dry run logged" : "Claude replied"} (${r.model}). Estimate ${formatUsd(r.estimatedUsd)}, charged ${r.dryRun ? "$0" : formatUsd(r.costUsd)}.${r.dryRun ? "" : ` Reply: "${r.text.slice(0, 80)}"`}`,
    ...(r.warn ? { warn: `You've used ${r.percent}% of a limit.` } : {}),
  });
}

export async function testImageCall(form: FormData) {
  const { supabase } = await requireStudio("/studio/settings");
  const here = "/studio/settings";
  void form;
  // A ledger test only. Real images are made on the Assets page, where they're tracked as jobs.
  const settings = await getStudioSettings(supabase);
  if (!settings?.dry_run) back(here, { error: "This test only runs in dry-run. Real images are made on a project's Assets page." });
  const r = await aiImageStart({
    supabase,
    purpose: "Settings: test image (dry run)",
    size: "1K",
    aspect: "1:1",
    prompt: "Test only. No image is generated.",
  });
  if (!r.ok) back(here, { error: r.reason });
  back(here, { test: `[Dry run] No image was made. Estimated cost if real: ${formatUsd(r.estimatedUsd)}.` });
}
