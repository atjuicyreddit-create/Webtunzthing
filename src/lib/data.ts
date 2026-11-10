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
