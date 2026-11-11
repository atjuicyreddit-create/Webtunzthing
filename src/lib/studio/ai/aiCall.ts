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
  /** JSON schema for a structured reply (Claude returns JSON text matching it). */
  schema?: Record<string, unknown>;
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
      ...(call.effort || call.schema
        ? {
            output_config: {
              ...(call.effort ? { effort: call.effort } : {}),
              ...(call.schema ? { format: { type: "json_schema" as const, schema: call.schema } } : {}),
            },
          }
        : {}),
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

// ====================================================================== images (KIE)
//
// KIE works as: create a task -> poll it -> download the result. Checked against KIE's docs
// (docs.kie.ai, Nov 2026): POST /api/v1/jobs/createTask {model, input{prompt, image_input[],
// aspect_ratio, resolution, output_format}}, GET /api/v1/jobs/recordInfo?taskId= (state
// waiting|queuing|generating|success|fail, resultJson {resultUrls}, creditsConsumed),
// GET /api/v1/chat/credit (balance in data). Errors come back as HTTP 200 with a body code,
// so every reply's `code` is checked. Uploaded reference files are deleted by KIE after 24h.

const KIE = "https://api.kie.ai";
const KIE_UPLOAD_HOSTS = ["https://kieai.redpandaai.co", "https://api.kie.ai"];

type KieReply<T> = { code?: number; msg?: string; data?: T };

async function kieFetch<T>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<KieReply<T> | null> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${process.env.KIE_API_KEY ?? ""}`, ...(init.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await r.json().catch(() => null)) as KieReply<T> | null;
    if (!body) return { code: r.status, msg: `HTTP ${r.status}` };
    return body;
  } catch {
    return null;
  }
}

/** Plain-words reason for a KIE error code. Never includes the key or the raw reply. */
function kieReason(code: number | undefined): string {
  switch (code) {
    case 401:
      return "KIE rejected the key. Check it on /studio/health.";
    case 402:
      return "The KIE account is out of credits. Top up on kie.ai, then try again.";
    case 429:
      return "KIE is busy (rate limit). Wait a minute and try again.";
    case 422:
      return "KIE said the request was invalid.";
    case 433:
    case 455:
    case 505:
      return "KIE couldn't take this request right now.";
    default:
      return `KIE returned an error${code ? ` (${code})` : ""}.`;
  }
}

/** The KIE credit balance, or null if it can't be read. Free. */
async function kieCredits(): Promise<number | null> {
  const r = await kieFetch<number>(`${KIE}/api/v1/chat/credit`, {}, 8000);
  return r?.code === 200 && typeof r.data === "number" ? r.data : null;
}

async function kieUpload(ref: { name: string; bytes: Uint8Array; type: string }): Promise<string | null> {
  for (const host of KIE_UPLOAD_HOSTS) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(ref.bytes)], { type: ref.type }), ref.name);
    form.append("uploadPath", "pathtoon-studio");
    form.append("fileName", ref.name);
    const r = await kieFetch<{ downloadUrl?: string }>(`${host}/api/file-stream-upload`, { method: "POST", body: form }, 30000);
    if (r?.code === 200 && r.data?.downloadUrl) return r.data.downloadUrl;
  }
  return null;
}

export type ImageRef = { name: string; bytes: Uint8Array; type: string };

export type ImageCall = Common & {
  model?: string;
  size: "1K" | "2K";
  aspect: string;
  prompt: string;
  /** Reference images (already read from the studio bucket). Uploaded to KIE first, in this order. */
  references?: ImageRef[];
};

export type ImageStart =
  | { ok: true; dryRun: true; ledgerId: string; estimatedUsd: number; warn: boolean; percent: number; model: string }
  | {
      ok: true;
      dryRun: false;
      ledgerId: string;
      taskId: string;
      creditsBefore: number | null;
      estimatedUsd: number;
      warn: boolean;
      percent: number;
      model: string;
    }
  | { ok: false; reason: string; ledgerId?: string };

/** What one image would cost, from the price table. */
export function imagePrice(settings: StudioSettings, size: "1K" | "2K", model?: string): number | null {
  const m = model ?? settings.models.image;
  const p = settings.prices.image[`${m}:${size}`];
  return p === undefined ? null : Number(p);
}

/** Reserve the cost and start one image task. Returns at once; poll with aiImagePoll. */
export async function aiImageStart(call: ImageCall): Promise<ImageStart> {
  const settings = await getStudioSettings(call.supabase);
  if (!settings) {
    return { ok: false, reason: "Studio settings are missing. Has the Stage 0 database update been run?" };
  }
  const model = call.model ?? settings.models.image;
  const price = imagePrice(settings, call.size, model);
  if (price === null) {
    return { ok: false, reason: `No price is set for ${model} at ${call.size}. Add it in Studio settings first.` };
  }
  const refNote = call.references?.length ? `\n[references: ${call.references.map((r) => r.name).join(", ")}]` : "";
  const r = await reserve(call, "image", model, call.size, `${call.prompt}${refNote}`.slice(0, 4000), price);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.dry_run) {
    return { ok: true, dryRun: true, ledgerId: r.id, estimatedUsd: price, warn: r.warn, percent: r.percent, model };
  }

  if (!process.env.KIE_API_KEY?.trim()) {
    await finish(call.supabase, r.id, "failed", { actualUsd: 0, error: "KIE_API_KEY is not set" });
    return { ok: false, reason: "The KIE key isn't set up. See /studio/health.", ledgerId: r.id };
  }

  const creditsBefore = await kieCredits();
  const rate = settings.kie_usd_per_credit || 0.005;
  if (creditsBefore !== null && creditsBefore * rate < price) {
    await finish(call.supabase, r.id, "failed", { actualUsd: 0, creditsBefore, error: "KIE balance too low" });
    return { ok: false, reason: "The KIE balance is too low for this image. Top up on kie.ai first.", ledgerId: r.id };
  }

  const imageInput: string[] = [];
  for (const ref of call.references ?? []) {
    const url = await kieUpload(ref);
    if (!url) {
      await finish(call.supabase, r.id, "failed", { actualUsd: 0, creditsBefore, error: "reference upload failed" });
      return { ok: false, reason: `Couldn't send the reference image "${ref.name}" to KIE. Nothing was generated or charged.`, ledgerId: r.id };
    }
    imageInput.push(url);
  }

  const created = await kieFetch<{ taskId?: string }>(`${KIE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: {
        prompt: call.prompt.slice(0, 20000),
        ...(imageInput.length ? { image_input: imageInput.slice(0, 14) } : {}),
        aspect_ratio: call.aspect,
        resolution: call.size,
        output_format: "png",
      },
    }),
  });
  if (!created || created.code !== 200 || !created.data?.taskId) {
    await finish(call.supabase, r.id, "failed", { actualUsd: 0, creditsBefore, error: `createTask ${created?.code ?? "no reply"}` });
    return { ok: false, reason: created ? kieReason(created.code) : "KIE couldn't be reached. Nothing was charged.", ledgerId: r.id };
  }
  return {
    ok: true,
    dryRun: false,
    ledgerId: r.id,
    taskId: created.data.taskId,
    creditsBefore,
    estimatedUsd: price,
    warn: r.warn,
    percent: r.percent,
    model,
  };
}

export type ImagePoll =
  | { state: "pending" }
  | { state: "done"; bytes: Uint8Array; contentType: string; costUsd: number; creditsAfter: number | null; topup: boolean }
  | { state: "failed"; reason: string; costUsd: number };

type KieRecord = {
  state?: string;
  resultJson?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
  creditsConsumed?: number | null;
};

/** Check a running image task once. On success, downloads the image and records the real cost. */
export async function aiImagePoll(p: {
  supabase: SupabaseClient;
  ledgerId: string;
  taskId: string;
  creditsBefore: number | null;
  estimatedUsd: number;
}): Promise<ImagePoll> {
  const rec = await kieFetch<KieRecord>(`${KIE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(p.taskId)}`, {}, 10000);
  if (!rec) return { state: "pending" }; // network blip: try again on the next poll
  if (rec.code !== 200) {
    if (rec.code === 429 || (rec.code ?? 0) >= 500) return { state: "pending" };
    await finish(p.supabase, p.ledgerId, "failed", { actualUsd: 0, creditsBefore: p.creditsBefore, error: `recordInfo ${rec.code}` });
    return { state: "failed", reason: kieReason(rec.code), costUsd: 0 };
  }
  const d = rec.data ?? {};
  const settings = await getStudioSettings(p.supabase);
  const rate = settings?.kie_usd_per_credit || 0.005;
  const consumedUsd = typeof d.creditsConsumed === "number" && d.creditsConsumed >= 0 ? d.creditsConsumed * rate : null;

  if (d.state === "fail") {
    const creditsAfter = await kieCredits();
    const cost = consumedUsd ?? 0;
    await finish(p.supabase, p.ledgerId, "failed", {
      actualUsd: cost,
      creditsBefore: p.creditsBefore,
      creditsAfter,
      error: `KIE failed ${d.failCode ?? ""}: ${(d.failMsg ?? "").slice(0, 200)}`,
    });
    return { state: "failed", reason: `KIE couldn't make this image${d.failMsg ? `: ${d.failMsg.slice(0, 160)}` : "."}`, costUsd: cost };
  }
  if (d.state !== "success") return { state: "pending" };

  let url: string | undefined;
  try {
    url = (JSON.parse(d.resultJson ?? "{}") as { resultUrls?: string[] }).resultUrls?.[0];
  } catch {
    url = undefined;
  }
  const creditsAfter = await kieCredits();
  // Cost: what KIE says it consumed; else the balance drop; else the estimate. Never negative.
  const drop = p.creditsBefore !== null && creditsAfter !== null ? (p.creditsBefore - creditsAfter) * rate : null;
  const cost = consumedUsd ?? (drop !== null && drop > 0 ? drop : p.estimatedUsd);
  const topup = p.creditsBefore !== null && creditsAfter !== null && creditsAfter > p.creditsBefore;

  let bytes: Uint8Array | null = null;
  let contentType = "image/png";
  if (url) {
    try {
      const img = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (img.ok) {
        bytes = new Uint8Array(await img.arrayBuffer());
        contentType = img.headers.get("content-type")?.split(";")[0] || contentType;
      }
    } catch {
      bytes = null;
    }
  }
  if (!bytes) {
    // KIE keeps results for 14 days, but we only keep what we've stored. Charged either way.
    await finish(p.supabase, p.ledgerId, "failed", {
      actualUsd: cost,
      creditsBefore: p.creditsBefore,
      creditsAfter,
      error: "image made but download failed",
    });
    return { state: "failed", reason: "KIE made the image, but it couldn't be downloaded. The cost was logged.", costUsd: cost };
  }
  await finish(p.supabase, p.ledgerId, "done", {
    actualUsd: cost,
    creditsBefore: p.creditsBefore,
    creditsAfter,
    ...(topup ? { error: "Balance went up during this call: a top-up, not counted as spend." } : {}),
  });
  return { state: "done", bytes, contentType, costUsd: cost, creditsAfter, topup };
}

/** Give up on a task that never finished (it may still have been charged by KIE). */
export async function aiImageAbandon(supabase: SupabaseClient, ledgerId: string, creditsBefore: number | null) {
  const creditsAfter = await kieCredits();
  await finish(supabase, ledgerId, "failed", { actualUsd: 0, creditsBefore, creditsAfter, error: "timed out waiting for KIE" });
}

/** Free key check for /studio/health: reads the credit balance, generates nothing. */
export async function checkKieKey(rate: number): Promise<{ status: "ok" | "missing" | "problem"; detail: string }> {
  if (!process.env.KIE_API_KEY?.trim()) return { status: "missing", detail: "KIE_API_KEY is not set." };
  const r = await kieFetch<number>(`${KIE}/api/v1/chat/credit`, {}, 8000);
  if (!r) return { status: "problem", detail: "Couldn't reach KIE right now." };
  if (r.code === 200 && typeof r.data === "number") {
    return { status: "ok", detail: `Key works. Balance: ${r.data} credits (about $${(r.data * rate).toFixed(2)}).` };
  }
  return { status: "problem", detail: kieReason(r.code) };
}
