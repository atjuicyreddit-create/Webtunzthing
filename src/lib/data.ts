import { hasSupabaseEnv } from "./env";
import { createClient } from "./supabase/server";
import { DEMO_EPISODES, DEMO_SERIES } from "./demo";
import type { Episode, EpisodePage, Series } from "./types";

// All reads go through here. With Supabase configured they hit the database
// (Row Level Security hides drafts from readers). Without it, demo data is used.

export const isDemoMode = () => !hasSupabaseEnv();

export type SeriesEpisode = Pick<
  Episode,
  "number" | "title" | "synopsis" | "published_at" | "status" | "access" | "early_until"
>;

export type Profile = { role: "reader" | "admin"; plan: "free" | "supporter" };

export async function getAllSeries(): Promise<Series[]> {
  if (isDemoMode()) return [DEMO_SERIES];
  const supabase = await createClient();
  const { data } = await supabase
    .from("series")
    .select("*")
    .order("created_at", { ascending: true });
  return (data as Series[]) ?? [];
}

export async function getSeriesPage(slug: string): Promise<{
  series: Series;
  episodes: SeriesEpisode[];
} | null> {
  if (isDemoMode()) {
    if (slug !== DEMO_SERIES.slug) return null;
    return { series: DEMO_SERIES, episodes: DEMO_EPISODES };
  }
  const supabase = await createClient();
  const { data: series } = await supabase
    .from("series")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!series) return null;
  const { data: episodes } = await supabase
    .from("episodes")
    .select("number,title,synopsis,published_at,status,access,early_until")
    .eq("series_id", series.id)
    .order("number", { ascending: true });
  return { series: series as Series, episodes: episodes ?? [] };
}

export async function getEpisodePage(
  slug: string,
  number: number,
): Promise<EpisodePage | null> {
  if (isDemoMode()) {
    if (slug !== DEMO_SERIES.slug) return null;
    return buildPage(DEMO_SERIES, DEMO_EPISODES, number);
  }

  const supabase = await createClient();
  const { data: series } = await supabase
    .from("series")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!series) return null;

  const { data: episodes } = await supabase
    .from("episodes")
    .select("*, panels(*)")
    .eq("series_id", series.id)
    .order("number", { ascending: true });
  if (!episodes) return null;

  const withSortedPanels = episodes.map((e) => ({
    ...e,
    panels: [...(e.panels ?? [])].sort((a, b) => a.position - b.position),
  }));
  return buildPage(series as Series, withSortedPanels, number);
}

function buildPage(
  series: Series,
  episodes: EpisodePage["episode"][],
  number: number,
): EpisodePage | null {
  const index = episodes.findIndex((e) => e.number === number);
  if (index === -1) return null;
  const prev = episodes[index - 1];
  const next = episodes[index + 1];
  return {
    series,
    episode: episodes[index],
    previous: prev ? { number: prev.number, title: prev.title } : null,
    next: next ? { number: next.number, title: next.title } : null,
    isLatest: index === episodes.length - 1,
  };
}

export async function getCurrentUser() {
  if (isDemoMode()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export type Comment = {
  id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

export async function getComments(episodeId: string): Promise<Comment[]> {
  if (isDemoMode()) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("comments")
    .select("id,user_id,author_name,body,created_at")
    .eq("episode_id", episodeId)
    .order("created_at", { ascending: true })
    .limit(500);
  return (data as Comment[]) ?? [];
}

// One picture per series for the home page: its cover if set, otherwise the
// first panel of its first readable episode. Locked panels are hidden by the
// database, so a paid-early episode never leaks its art here.
export async function getSeriesThumbnails(): Promise<Record<string, string>> {
  if (isDemoMode()) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("episodes")
    .select("series_id,number,panels(image_url,position)")
    .order("number", { ascending: true })
    .order("position", { referencedTable: "panels", ascending: true })
    .limit(1, { referencedTable: "panels" });
  const out: Record<string, string> = {};
  for (const e of (data ?? []) as {
    series_id: string;
    panels: { image_url: string }[] | null;
  }[]) {
    const first = e.panels?.[0]?.image_url;
    if (first && !out[e.series_id]) out[e.series_id] = first;
  }
  return out;
}

// The signed-in person's role and plan (null when signed out or in demo mode).
export async function getProfile(): Promise<Profile | null> {
  if (isDemoMode()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("role,plan")
    .eq("id", user.id)
    .maybeSingle();
  return (data as Profile) ?? null;
}
