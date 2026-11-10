import data from "../../data/morning-brew.json";
import type { EpisodeWithPanels, Series } from "./types";

// Demo mode: used automatically when Supabase keys are not set yet, so the
// reader works the moment you run `npm run dev`.

export const DEMO_SERIES: Series = {
  id: "demo-series",
  slug: data.series.slug,
  title: data.series.title,
  tagline: data.series.tagline,
  description: data.series.description,
  cover_url: null,
};

export const DEMO_EPISODES: EpisodeWithPanels[] = [
  {
    id: "demo-episode-1",
    series_id: DEMO_SERIES.id,
    number: data.episode.number,
    title: data.episode.title,
    synopsis: data.episode.synopsis,
    status: "published",
    published_at: "2026-11-10T09:00:00Z",
    vote_closes_at: null,
    hide_vote_counts: false,
    panels: data.panels.map((p) => ({
      id: `demo-panel-${p.position}`,
      episode_id: "demo-episode-1",
      position: p.position,
      image_url: placeholderUrl(p.position, p.height),
      width: 800,
      height: p.height,
      gap_after: p.gap_after,
      alt: `Placeholder for panel ${p.position}`,
    })),
  },
];

export function placeholderUrl(position: number, height: number): string {
  return `/api/placeholder/${position}?h=${height}`;
}
