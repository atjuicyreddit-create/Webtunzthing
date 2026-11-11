import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiClaude, estimateClaudeUsd } from "../ai/aiCall";
import type { StudioSettings } from "../settings";
import { HOUSE_RULES } from "../story/guidelines";
import { STYLE_BLOCK, mustNotBlock } from "./prompts";
import type { Asset } from "./types";

// Turns Tom's comment on one option into a revised prompt (a small Claude job).
// The result is a suggestion: Tom sees old and new side by side and accepts or rejects it.

const SYSTEM = `You revise image-generation prompts for character, location and prop design sheets in an original comic.
Change only what the comment asks for, one thing at a time where possible, and keep everything else word for word.
Never add text, letters, labels, logos, speech bubbles, captions, sound effects, clock times or other characters' names to the prompt.
Never reference existing characters, brands or artists. Write in British English.
The style block and the "must not appear" block are added automatically; don't repeat them.

House rules:
${HOUSE_RULES}`;

function userText(asset: Asset, comment: string) {
  return `Asset: ${asset.name} (${asset.kind}).
Fixed blocks added automatically:
${STYLE_BLOCK}
${mustNotBlock(asset.kind, asset.name)}

Current prompt:
${asset.prompt}

Tom's comment on the latest option:
${comment}

Return the revised prompt and a short list of exactly what you changed.`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "changes"],
  properties: { prompt: { type: "string" }, changes: { type: "array", items: { type: "string" } } },
};

export function estimateRevise(settings: StudioSettings, asset: Asset, comment: string) {
  return estimateClaudeUsd(settings, settings.models.small, SYSTEM, [{ role: "user", content: userText(asset, comment || "x".repeat(200)) }], 2000);
}

export async function revisePrompt(
  supabase: SupabaseClient,
  asset: Asset,
  episodeId: string,
  comment: string,
): Promise<{ ok: true; prompt: string; changes: string[]; note: string } | { ok: false; reason: string }> {
  const r = await aiClaude({
    supabase,
    projectId: asset.project_id,
    episodeId,
    purpose: `Asset: revise prompt for ${asset.name}`,
    role: "small",
    system: SYSTEM,
    messages: [{ role: "user", content: userText(asset, comment) }],
    maxTokens: 2000,
    effort: "low",
    schema: SCHEMA,
    dryRunText: JSON.stringify({ prompt: `${asset.prompt} (Dry run: revised for “${comment.slice(0, 60)}”.)`, changes: ["Placeholder change (dry run)."] }),
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.truncated) return { ok: false, reason: "Claude's answer was cut off. Please try again." };
  try {
    const data = JSON.parse(r.text) as { prompt: string; changes: string[] };
    const cost = r.dryRun ? "dry run, $0" : r.costUsd < 0.01 ? `$${r.costUsd.toFixed(4)}` : `$${r.costUsd.toFixed(2)}`;
    return { ok: true, prompt: data.prompt.slice(0, 3000), changes: (data.changes ?? []).slice(0, 8), note: `${cost}.${r.warn ? ` You've used ${r.percent}% of a limit.` : ""}` };
  } catch {
    return { ok: false, reason: "Claude's answer couldn't be read. Please try again (the cost was logged)." };
  }
}
