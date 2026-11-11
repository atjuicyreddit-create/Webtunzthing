import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiClaude, estimateClaudeUsd } from "../ai/aiCall";
import type { StudioSettings } from "../settings";
import { buildRequest, type StoryAction } from "./prompts";
import type { Story } from "./story";

/** Upper-bound cost of the request a story button would send (shown on the button). */
export function estimateStoryAction(settings: StudioSettings | null, s: Story, a: StoryAction): number | null {
  if (!settings) return null;
  const req = buildRequest(s, a);
  return estimateClaudeUsd(settings, settings.models.story, req.system, [{ role: "user", content: req.user }], req.maxTokens);
}

export type RunResult<T> =
  | { ok: true; data: T; note: string }
  | { ok: false; reason: string };

/** Sends one story request through the gateway and parses Claude's JSON reply. */
export async function runStoryAction<T>(supabase: SupabaseClient, s: Story, a: StoryAction): Promise<RunResult<T>> {
  const req = buildRequest(s, a);
  const r = await aiClaude({
    supabase,
    projectId: s.project.id,
    purpose: req.purpose,
    role: "story",
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    maxTokens: req.maxTokens,
    effort: req.effort,
    schema: req.schema,
    dryRunText: JSON.stringify(req.dryRun),
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.truncated) return { ok: false, reason: "Claude's answer was cut off (too long). Please try again." };
  let data: T;
  try {
    data = JSON.parse(r.text) as T;
  } catch {
    return { ok: false, reason: "Claude's answer couldn't be read. Please try again (the cost was logged)." };
  }
  const cost = r.dryRun ? "dry run, $0" : r.costUsd < 0.01 ? `$${r.costUsd.toFixed(4)}` : `$${r.costUsd.toFixed(2)}`;
  const warn = r.warn ? ` You've used ${r.percent}% of a limit.` : "";
  return { ok: true, data, note: `${cost}.${warn}` };
}
