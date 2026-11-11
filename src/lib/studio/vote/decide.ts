import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Milestone } from "../story/story";
import type { Decision, ReaderRoute, Round } from "./types";

/** The studio episode after this one, created if it doesn't exist yet. */
export async function ensureNextEpisode(supabase: SupabaseClient, projectId: string, number: number) {
  const { data: found } = await supabase.from("studio_episodes").select("id,number,summary").eq("project_id", projectId).eq("number", number + 1).maybeSingle();
  if (found) return found as { id: string; number: number; summary: string | null };
  const { data: made } = await supabase
    .from("studio_episodes")
    .insert({ project_id: projectId, number: number + 1, title: `Episode ${number + 1}` })
    .select("id,number,summary")
    .single();
  return (made as { id: string; number: number; summary: string | null } | null) ?? null;
}

/** Marks the next episode's Script final (and the gates after it, via the database cascade) stale. */
async function staleNextScript(supabase: SupabaseClient, projectId: string, episodeId: string, userId: string, note: string) {
  const { data: gate } = await supabase
    .from("studio_gates")
    .select("id,state")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("gate", "script_final")
    .maybeSingle();
  if (gate?.state !== "approved") return false;
  await supabase.from("studio_gates").update({ state: "stale", updated_at: new Date().toISOString() }).eq("id", gate.id);
  await supabase.from("studio_gate_events").insert({ gate_id: gate.id, action: "stale", actor: userId, note });
  return true;
}

const SUMMARY_PREFIX = "Readers chose:";

/** Feeds a decision into episode N+1: its reader route, summary (if Tom hasn't written one) and milestone. */
export async function feedNextEpisode(
  supabase: SupabaseClient,
  p: { projectId: string; episodeNumber: number; round: Round; decision: Decision; milestones: Milestone[]; userId: string; decidedAt: string },
): Promise<{ id: string; number: number; staled: boolean } | null> {
  const next = await ensureNextEpisode(supabase, p.projectId, p.episodeNumber);
  if (!next) return null;
  const route: ReaderRoute = {
    route: p.decision.route,
    you_chose: p.decision.you_chose,
    credit: p.decision.credit,
    branch: p.decision.branch,
    rejoins: p.decision.rejoins,
    round_id: p.round.id,
    from_episode: p.episodeNumber,
    decided_at: p.decidedAt,
  };
  const branch = p.round.fork_snapshot.branches.find((b) => b.title === p.decision.branch);
  const rejoin = (p.decision.rejoins || "").toLowerCase();
  const milestone = rejoin ? p.milestones.find((m) => m.title.toLowerCase().includes(rejoin) || rejoin.includes(m.title.toLowerCase())) : undefined;
  const patch: Record<string, unknown> = { reader_route: route };
  if (!next.summary?.trim() || next.summary.startsWith(SUMMARY_PREFIX)) {
    patch.summary = `${SUMMARY_PREFIX} ${p.decision.route}${branch ? ` (branch: ${branch.title}${branch.summary ? `, ${branch.summary}` : ""})` : ""}`.slice(0, 600);
  }
  if (milestone) patch.milestone_id = milestone.id;
  await supabase.from("studio_episodes").update(patch).eq("id", next.id);
  const staled = await staleNextScript(supabase, p.projectId, next.id, p.userId, `Reader vote decided: ${p.decision.you_chose}`);
  return { id: next.id, number: next.number, staled };
}

/** Undoes the feed when a decision is reopened. */
export async function unfeedNextEpisode(supabase: SupabaseClient, projectId: string, episodeNumber: number, roundId: string, userId: string) {
  const { data: next } = await supabase
    .from("studio_episodes")
    .select("id,summary,reader_route")
    .eq("project_id", projectId)
    .eq("number", episodeNumber + 1)
    .maybeSingle();
  if (!next) return false;
  const route = next.reader_route as ReaderRoute | null;
  if (route && route.round_id !== roundId) return false;
  const patch: Record<string, unknown> = { reader_route: null };
  if ((next.summary as string | null)?.startsWith(SUMMARY_PREFIX)) patch.summary = null;
  await supabase.from("studio_episodes").update(patch).eq("id", next.id);
  return staleNextScript(supabase, projectId, next.id as string, userId, "Reader vote reopened");
}
