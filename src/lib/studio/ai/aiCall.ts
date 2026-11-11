import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claudeCostUsd,
  getStudioSettings,
  type StudioSettings,
} from "../settings";

// The ONE gateway for every paid AI call in the studio (Claude and images).
// No other file may import the Anthropic SDK or call KIE.
//
// Every call: estimate -> reserve against the caps (in the database, under a lock)
// -> dry-run or real call -> record actual cost -> return the result + ledger id.
// Keys are read from the environment on the server and never logged or returned.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AiResult =
  | {
      ok: true;
      text: string;
      ledgerId: string;
      dryRun: boolean;
      estimatedUsd: number;
      costUsd: number;
      warn: boolean;
      percent: number;
      truncated?: boolean;
      model: string;
    }
  | { ok: false; reason: string; ledgerId?: string };

type Common = {
  supabase: SupabaseClient;
  projectId?: string | null;
  episodeId?: string | null;
  purpose: string;
};

export type ClaudeCall = Common & {
  /** Which configured model to use. Ignored if `model` is given. */
  role?: "story" | "small" | "vision";
  model?: string;
  system?: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  maxTokens?: number;
  effort?: Effort;
  /** What a dry run returns instead of calling Claude. */
  dryRunText?: string;
};

function promptForLog(system: string | undefined, messages: Anthropic.Beta.BetaMessageParam[]) {
  const last = messages[messages.length - 1];
  const lastText =
    typeof last?.content === "string"
      ? last.content
      : (last?.content ?? [])
          .map((b) => ("text" in b && typeof b.text === "string" ? b.text : `[${b.type}]`))
          .join("\n");
  return `${system ? `SYSTEM: ${system.slice(0, 500)}\n` : ""}${lastText}`.slice(0, 4000);
}

function messagesChars(system: string | undefined, messages: Anthropic.Beta.BetaMessageParam[]) {
  let n = (system ?? "").length;
  for (const m of messages) {
    if (typeof m.content === "string") n += m.content.length;
    else
      for (const b of m.content ?? []) {
        if ("text" in b && typeof b.text === "string") n += b.text.length;
        else if (b.type === "image") n += 1600 * 3; // ~1,600 tokens per image, a safe upper guess
        else n += 200;
      }
  }
  return n;
}

async function reserve(
  c: Common,
  kind: "claude" | "image",
  model: string,
  size: string | null,
  prompt: string,
  estimatedUsd: number,
) {
  const { data, error } = await c.supabase.rpc("studio_reserve_ai_call", {
    p_project_id: c.projectId ?? null,
    p_episode_id: c.episodeId ?? null,
    p_kind: kind,
    p_purpose: c.purpose,
    p_model: model,
    p_size: size,
    p_prompt: prompt,
    // Ledger stores 4 decimals; round UP so a real cost is never recorded as $0.
    p_estimated_usd: Math.ceil(estimatedUsd * 10_000) / 10_000,
  });
  if (error) {
    return {
      ok: false as const,
      reason: "The studio cost ledger isn't reachable. Has the Stage 0 database update been run?",
    };
  }
  const result = data as
    | { ok: true; id: string; dry_run: boolean; warn: boolean; percent: number }
    | { ok: false; reason: string };
  // The database writes amounts with 4 decimals ("$2.5000"); show them as money.
  if (!result.ok) result.reason = result.reason.replace(/\$(\d+\.\d\d)\d\d\b/g, "$$$1");
  return result;
}

async function finish(
  supabase: SupabaseClient,
  id: string,
  status: "done" | "failed",
  f: {
    actualUsd?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    creditsBefore?: number | null;
    creditsAfter?: number | null;
    error?: string;
  },
) {
  await supabase.rpc("studio_finish_ai_call", {
    p_id: id,
    p_status: status,
    p_actual_usd: f.actualUsd === undefined ? null : Math.ceil(f.actualUsd * 10_000) / 10_000,
    p_input_tokens: f.input ?? null,
    p_output_tokens: f.output ?? null,
    p_cache_read_tokens: f.cacheRead ?? null,
    p_credits_before: f.creditsBefore ?? null,
    p_credits_after: f.creditsAfter ?? null,
    p_error: f.error ?? null,
  });
}

/** Estimate what a Claude call could cost at most (input estimate + full max_tokens output). */
export function estimateClaudeUsd(
  settings: StudioSettings,
  model: string,
  system: string | undefined,
  messages: Anthropic.Beta.BetaMessageParam[],
  maxTokens: number,
): number | null {
  const price = settings.prices.claude[model];
  if (!price) return null;
  return claudeCostUsd(price, { input: Math.ceil(messagesChars(system, messages) / 3), output: maxTokens });
}

export async function aiClaude(call: ClaudeCall): Promise<AiResult> {
  const settings = await getStudioSettings(call.supabase);
  if (!settings) {
    return { ok: false, reason: "Studio settings are missing. Has the Stage 0 database update been run?" };
  }
  const model = call.model ?? settings.models[call.role ?? "story"];
  const maxTokens = call.maxTokens ?? 16000;
  const estimatedUsd = estimateClaudeUsd(settings, model, call.system, call.messages, maxTokens);
  if (estimatedUsd === null) {
    return { ok: false, reason: `No price is set for ${model}. Add it in Studio settings first.` };
  }

  const r = await reserve(call, "claude", model, null, promptForLog(call.system, call.messages), estimatedUsd);
  if (!r.ok) return { ok: false, reason: r.reason };

  if (r.dry_run) {
    return {
      ok: true,
      text: call.dryRunText ?? `[Dry run] Claude (${model}) was not called. Estimated cost if real: up to $${estimatedUsd.toFixed(4)}.`,
      ledgerId: r.id,
      dryRun: true,
      estimatedUsd,
      costUsd: 0,
      warn: r.warn,
      percent: r.percent,
      model,
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    await finish(call.supabase, r.id, "failed", { actualUsd: 0, error: "ANTHROPIC_API_KEY is not set" });
    return { ok: false, reason: "The Claude key isn't set up yet. See /studio/health.", ledgerId: r.id };
  }

  try {
    const client = new Anthropic();
    // Haiku has no server-side fallback; the others fall back automatically on a policy decline.
    const useFallback = !model.startsWith("claude-haiku");
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(call.system
        ? { system: [{ type: "text" as const, text: call.system, cache_control: { type: "ephemeral" as const } }] }
        : {}),
      messages: call.messages,
      ...(call.effort ? { output_config: { effort: call.effort } } : {}),
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const msg = await stream.finalMessage();

    const servedBy = msg.model || model;
    const price = settings.prices.claude[servedBy] ?? settings.prices.claude[model];
    const usage = msg.usage;
    const actualUsd = claudeCostUsd(price, {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    });
    await finish(call.supabase, r.id, "done", {
      actualUsd,
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
    });

    if (msg.stop_reason === "refusal") {
      return {
        ok: false,
        reason: "Claude declined this request. Try rewording it. (The cost was still logged.)",
        ledgerId: r.id,
      };
    }
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return {
      ok: true,
      text,
      ledgerId: r.id,
      dryRun: false,
      estimatedUsd,
      costUsd: actualUsd,
      warn: r.warn,
      percent: r.percent,
      truncated: msg.stop_reason === "max_tokens",
      model: servedBy,
    };
  } catch (e) {
    let reason = "Claude couldn't be reached. Please try again.";
    if (e instanceof Anthropic.AuthenticationError) reason = "The Claude key was rejected. Check it on /studio/health.";
    else if (e instanceof Anthropic.RateLimitError) reason = "Claude is busy (rate limit). Wait a minute and try again.";
    else if (e instanceof Anthropic.BadRequestError) reason = "Claude rejected the request as invalid.";
    else if (e instanceof Anthropic.APIError) reason = `Claude returned an error (${e.status ?? "unknown"}).`;
    const detail = e instanceof Anthropic.APIError ? `${e.status} ${e.name}` : e instanceof Error ? e.name : "error";
    await finish(call.supabase, r.id, "failed", { actualUsd: 0, error: detail });
    return { ok: false, reason, ledgerId: r.id };
  }
}

/** Free key check for /studio/health: looks a model up, generates nothing, logs nothing. */
export async function checkClaudeKey(
  model: string,
): Promise<{ status: "ok" | "missing" | "problem"; detail: string }> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return { status: "missing", detail: "ANTHROPIC_API_KEY is not set. See README, Pathtoon Studio, step 2." };
  }
  try {
    const client = new Anthropic({ timeout: 8000, maxRetries: 0 });
    const m = await client.models.retrieve(model);
    return { status: "ok", detail: `Key works. ${m.display_name} is available.` };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { status: "problem", detail: "The key was rejected. Create a new one and replace it." };
    }
    if (e instanceof Anthropic.NotFoundError) {
      return { status: "problem", detail: `Key works, but the model "${model}" wasn't found. Check Studio settings.` };
    }
    return { status: "problem", detail: "Couldn't reach Anthropic right now." };
  }
}

export type ImageCall = Common & {
  model?: string;
  size: "1K" | "2K";
  prompt: string;
};

/** Images (KIE). Dry-run works now; real generation arrives in Stage 4. */
export async function aiImage(call: ImageCall): Promise<AiResult> {
  const settings = await getStudioSettings(call.supabase);
  if (!settings) {
    return { ok: false, reason: "Studio settings are missing. Has the Stage 0 database update been run?" };
  }
  const model = call.model ?? settings.models.image;
  const price = settings.prices.image[`${model}:${call.size}`];
  if (price === undefined) {
    return { ok: false, reason: `No price is set for ${model} at ${call.size}. Add it in Studio settings first.` };
  }
  if (!settings.dry_run) {
    return { ok: false, reason: "Real image generation is switched on in Stage 4. Use dry-run for now." };
  }
  const r = await reserve(call, "image", model, call.size, call.prompt.slice(0, 4000), price);
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    text: `[Dry run] ${model} at ${call.size} was not called. Estimated cost if real: $${price.toFixed(2)}.`,
    ledgerId: r.id,
    dryRun: true,
    estimatedUsd: price,
    costUsd: 0,
    warn: r.warn,
    percent: r.percent,
    model,
  };
}
