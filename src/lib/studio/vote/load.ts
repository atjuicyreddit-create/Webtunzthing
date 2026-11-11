import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listVersions, loadFork, loadPanels } from "../script/script";
import type { ScriptPanel } from "../script/types";
import type { ForkSnapshot, LiveComment, ReaderRoute, Round, VoteComment } from "./types";
import { ROUND_COLS, VOTE_COMMENT_COLS } from "./types";

export type VoteEpisode = {
  id: string;
  number: number;
  title: string;
  comment_source_episode_id: string | null;
  reader_route: ReaderRoute | null;
};

export type LiveEpisode = {
  id: string;
  number: number;
  title: string;
  status: string;
  vote_closes_at: string | null;
  series: { id: string; title: string; slug: string } | null;
};

/** null = the Stage 8 database update hasn't been run (the new columns are missing). */
export async function loadVoteEpisodes(supabase: SupabaseClient, projectId: string): Promise<VoteEpisode[] | null> {
  const { data, error } = await supabase
    .from("studio_episodes")
    .select("id,number,title,comment_source_episode_id,reader_route")
    .eq("project_id", projectId)
    .order("number");
  if (error) return null;
  return (data ?? []) as VoteEpisode[];
}

export function forkSnapshot(f: Awaited<ReturnType<typeof loadFork>>): ForkSnapshot | null {
  if (!f) return null;
  return {
    question: f.question ?? "",
    in_bounds: f.in_bounds ?? "",
    locked: f.locked ?? "",
    backup_pick: f.backup_pick ?? "",
    branches: (f.branches ?? []).filter((b) => b.title?.trim()),
  };
}

/** READ-ONLY. The live episode (and its series) whose comments are read. */
export async function loadLiveEpisode(supabase: SupabaseClient, episodeId: string | null): Promise<LiveEpisode | null> {
  if (!episodeId) return null;
  const { data } = await supabase
    .from("episodes")
    .select("id,number,title,status,vote_closes_at,series:series_id(id,title,slug)")
    .eq("id", episodeId)
    .maybeSingle();
  return (data as unknown as LiveEpisode) ?? null;
}

/** READ-ONLY. Every live episode, for the link picker. */
export async function listLiveEpisodes(supabase: SupabaseClient): Promise<LiveEpisode[]> {
  const { data } = await supabase
    .from("episodes")
    .select("id,number,title,status,vote_closes_at,series:series_id(id,title,slug)")
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as unknown as LiveEpisode[]).sort(
    (a, b) => (a.series?.title ?? "").localeCompare(b.series?.title ?? "") || a.number - b.number,
  );
}

/** READ-ONLY. The live comments on one episode, oldest first. */
export async function loadLiveComments(supabase: SupabaseClient, episodeId: string | null): Promise<LiveComment[]> {
  if (!episodeId) return [];
  const { data } = await supabase
    .from("comments")
    .select("id,author_name,body,created_at")
    .eq("episode_id", episodeId)
    .order("created_at")
    .limit(500);
  return (data ?? []) as LiveComment[];
}

export async function loadRounds(supabase: SupabaseClient, episodeId: string): Promise<Round[]> {
  const { data } = await supabase.from("studio_vote_rounds").select(ROUND_COLS).eq("episode_id", episodeId).order("screened_at", { ascending: false }).limit(20);
  return (data ?? []) as Round[];
}

export async function loadRoundComments(supabase: SupabaseClient, roundId: string): Promise<VoteComment[]> {
  const { data } = await supabase.from("studio_vote_comments").select(VOTE_COMMENT_COLS).eq("round_id", roundId);
  const rows = (data ?? []) as VoteComment[];
  // Claude's suggested order first, then the rest oldest first.
  return rows.sort((a, b) => {
    const ra = a.suggested_rank && a.suggested_rank > 0 ? a.suggested_rank : 9999;
    const rb = b.suggested_rank && b.suggested_rank > 0 ? b.suggested_rank : 9999;
    return ra - rb || (a.posted_at ?? "").localeCompare(b.posted_at ?? "");
  });
}

/** The latest script of an episode (what already happened), for Claude's context. */
export async function latestScriptPanels(supabase: SupabaseClient, episodeId: string): Promise<ScriptPanel[]> {
  const versions = await listVersions(supabase, episodeId);
  return versions[0] ? loadPanels(supabase, versions[0].id) : [];
}
