import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ClaudePrice = { input: number; output: number; cache_read: number };

export type StudioSettings = {
  models: { story: string; small: string; vision: string; image: string };
  prices: { claude: Record<string, ClaudePrice>; image: Record<string, number> };
  episode_image_cap_usd: number;
  episode_image_cap_gens: number;
  episode_claude_cap_usd: number;
  session_cap_usd: number;
  warn_at: number;
  dry_run: boolean;
  /** KIE bills in credits; this turns credits into dollars for the ledger (added in Stage 4). */
  kie_usd_per_credit: number;
  updated_at: string;
};

export async function getStudioSettings(supabase: SupabaseClient): Promise<StudioSettings | null> {
  const { data } = await supabase.from("studio_settings").select("*").eq("id", 1).maybeSingle();
  if (!data) return null;
  return {
    ...data,
    episode_image_cap_usd: Number(data.episode_image_cap_usd),
    episode_claude_cap_usd: Number(data.episode_claude_cap_usd),
    session_cap_usd: Number(data.session_cap_usd),
    warn_at: Number(data.warn_at),
    kie_usd_per_credit: data.kie_usd_per_credit === undefined ? 0.005 : Number(data.kie_usd_per_credit),
  } as StudioSettings;
}

// Rough token count for cost estimates (real counts come back from the API afterwards).
// ~3 characters per token errs on the high side, so estimates are a little pessimistic.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function claudeCostUsd(
  price: ClaudePrice,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): number {
  const perM = 1_000_000;
  return (
    (usage.input * price.input) / perM +
    ((usage.cacheWrite ?? 0) * price.input * 1.25) / perM +
    ((usage.cacheRead ?? 0) * price.cache_read) / perM +
    (usage.output * price.output) / perM
  );
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v > 0 && v < 0.0001) return "under $0.0001";
  return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}
