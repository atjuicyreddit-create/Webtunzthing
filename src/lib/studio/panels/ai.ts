import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiClaude, estimateClaudeUsd, type Effort } from "../ai/aiCall";
import type { Lesson } from "../lessons/lessons";
import type { ScriptPanel } from "../script/types";
import type { StudioSettings } from "../settings";
import type { Character } from "../story/story";
import { costumeLock } from "./prompt";
import type { BuiltPrompt } from "./prompt";
import type { VisionFinding } from "./types";

// Claude never fixes anything here: the pre-check and the vision QA return notes Tom reads.

const money = (r: { dryRun: boolean; costUsd: number; warn: boolean; percent: number }) =>
  `${r.dryRun ? "dry run, $0" : r.costUsd < 0.01 ? `$${r.costUsd.toFixed(4)}` : `$${r.costUsd.toFixed(2)}`}.${r.warn ? ` You've used ${r.percent}% of a limit.` : ""}`;

function panelText(p: ScriptPanel, n: number) {
  return [
    `Panel ${n}: ${p.title} (${p.size})`,
    `Shot: ${[p.shot, p.camera].filter(Boolean).join(", ") || "-"}`,
    `Characters: ${p.characters.join(", ") || "none"}`,
    `Visual: ${p.action ?? ""}`,
    p.props.length ? `Props: ${p.props.map((x) => `${x.name}${x.location ? ` @ ${x.location}` : ""}${x.state ? ` (${x.state})` : ""}`).join("; ")}` : "",
    p.clock ? `Clock reads: ${p.clock}` : "",
    p.caption ? `Caption: ${p.caption}` : "",
    p.dialogue.length ? `Dialogue: ${p.dialogue.map((d) => `${d.speaker}: ${d.line}`).join(" / ")}` : "",
    p.text_items.length ? `Text in art: ${p.text_items.map((t) => `${t.text} (${t.how === "model" ? "drawn by the model" : "lettered in code"})`).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ------------------------------------------------------------------ pre-check (before any spend)

const PRE_SYSTEM = `You check image-generation prompts for an original vertical scroll comic before any money is spent.
Report problems only; never rewrite the prompt. Look for: anything described that shouldn't appear (naming an unwanted object invites it),
characters mentioned who aren't in the panel, missing costume locks, clock times or words the model might draw as text,
two actions in one panel, a matched shot without "same camera" wording, and anything that contradicts the script panel.
Write in British English, one short sentence per issue.`;

const PRE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "issues"],
  properties: { ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
};

const preUser = (built: BuiltPrompt, panel: ScriptPanel, n: number, lint: string[]) =>
  `SCRIPT PANEL\n${panelText(panel, n)}\n\nPROMPT (blocks in order)\n${built.blocks.map((b) => `[${b.name}]\n${b.text}`).join("\n\n")}\n\nREFERENCES SENT, in order: ${built.refs.map((r, i) => `${i + 1}. ${r.label}`).join("; ") || "none"}\n\nFree lint already found: ${lint.join(" | ") || "nothing"}`;

export function estimatePrecheck(settings: StudioSettings, built: BuiltPrompt, panel: ScriptPanel, n: number) {
  return estimateClaudeUsd(settings, settings.models.small, PRE_SYSTEM, [{ role: "user", content: preUser(built, panel, n, []) }], 1500);
}

export async function precheckPrompt(
  supabase: SupabaseClient,
  ids: { projectId: string; episodeId: string },
  built: BuiltPrompt,
  panel: ScriptPanel,
  n: number,
  lint: string[],
): Promise<{ ok: true; result: { ok: boolean; issues: string[]; note: string } } | { ok: false; reason: string }> {
  const r = await aiClaude({
    supabase,
    projectId: ids.projectId,
    episodeId: ids.episodeId,
    purpose: `Panel ${n}: prompt pre-check`,
    role: "small",
    system: PRE_SYSTEM,
    messages: [{ role: "user", content: preUser(built, panel, n, lint) }],
    maxTokens: 1500,
    effort: "low",
    schema: PRE_SCHEMA,
    dryRunText: JSON.stringify({ ok: true, issues: ["Placeholder check (dry run). Switch dry-run off for a real check."] }),
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  try {
    const d = JSON.parse(r.text) as { ok: boolean; issues: string[] };
    return { ok: true, result: { ok: Boolean(d.ok), issues: (d.issues ?? []).slice(0, 10).map((x) => x.slice(0, 300)), note: money(r) } };
  } catch {
    return { ok: false, reason: "Claude's answer couldn't be read. Please try again (the cost was logged)." };
  }
}

// ------------------------------------------------------------------ vision QA (per lettered panel)

export const FINDING_KINDS = ["costume_drift", "missing_prop", "wrong_clock", "extra_character", "garbled_text", "expression", "unrequested", "lettering", "other"] as const;

const QA_SYSTEM = `You are the QA reviewer for an original vertical scroll comic. You look at ONE finished, lettered panel and compare it with its
script panel, the character locks and the active lessons. List real problems only: costume drift, a missing or misplaced prop, a clock showing
the wrong time, an extra or missing character, garbled or stray text in the art (only the listed labels and the code-lettered caption, balloons,
clocks and notes are allowed), an expression that doesn't fit the beat, an unrequested object or inset, or lettering that covers a face or is hard to read.
Never suggest you will fix anything; Tom decides. For each problem also write a one-sentence lesson that would prevent it next time.
If the panel is fine, return no findings. British English.`;

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "note", "lesson"],
        properties: {
          kind: { type: "string", enum: [...FINDING_KINDS] },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string" },
          lesson: { type: "string" },
        },
      },
    },
  },
};

const qaText = (panel: ScriptPanel, n: number, characters: Character[], lessons: Lesson[]) => {
  const inPanel = characters.filter((c) => panel.characters.some((x) => x.toLowerCase() === c.name.toLowerCase()));
  return `SCRIPT PANEL\n${panelText(panel, n)}\n\nCHARACTER LOCKS\n${inPanel.map((c) => costumeLock(c.name, c.sheet)).join("\n") || "No characters should appear."}\n\nACTIVE ART LESSONS\n${lessons.map((l) => `- ${l.lesson}`).join("\n") || "none"}\n\nReview the attached lettered panel.`;
};

export function estimateVision(settings: StudioSettings, panel: ScriptPanel, n: number, characters: Character[], lessons: Lesson[]) {
  return estimateClaudeUsd(
    settings,
    settings.models.vision,
    QA_SYSTEM,
    [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "" } }, { type: "text", text: qaText(panel, n, characters, lessons) }] }],
    4000,
  );
}

export async function visionQa(
  supabase: SupabaseClient,
  ids: { projectId: string; episodeId: string },
  lettered: Uint8Array,
  panel: ScriptPanel,
  n: number,
  characters: Character[],
  lessons: Lesson[],
): Promise<{ ok: true; summary: string; findings: VisionFinding[]; model: string; note: string } | { ok: false; reason: string }> {
  // 800 px wide is what readers see; it also keeps the image cost down.
  const jpeg = await sharp(lettered).resize({ width: 800 }).jpeg({ quality: 82 }).toBuffer();
  const r = await aiClaude({
    supabase,
    projectId: ids.projectId,
    episodeId: ids.episodeId,
    purpose: `Panel ${n}: vision QA`,
    role: "vision",
    system: QA_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: qaText(panel, n, characters, lessons) },
        ],
      },
    ],
    maxTokens: 4000,
    effort: "medium" as Effort,
    schema: QA_SCHEMA,
    dryRunText: JSON.stringify({
      summary: "Placeholder review (dry run). Switch dry-run off for a real look at the panel.",
      findings: [{ kind: "other", severity: "low", note: "Placeholder finding to show how findings look (dry run).", lesson: "Placeholder lesson (dry run)." }],
    }),
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.truncated) return { ok: false, reason: "Claude's answer was cut off. Please try again." };
  try {
    const d = JSON.parse(r.text) as { summary: string; findings: VisionFinding[] };
    return {
      ok: true,
      summary: (d.summary ?? "").slice(0, 600),
      findings: (d.findings ?? []).slice(0, 12).map((f) => ({ ...f, note: f.note.slice(0, 400), lesson: f.lesson.slice(0, 300) })),
      model: r.model,
      note: money(r),
    };
  } catch {
    return { ok: false, reason: "Claude's answer couldn't be read. Please try again (the cost was logged)." };
  }
}
