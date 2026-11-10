export type Series = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  cover_url: string | null;
};

export type Episode = {
  id: string;
  series_id: string;
  number: number;
  title: string;
  synopsis: string | null;
  status: "draft" | "published";
  published_at: string | null;
  // Used from Stage 2 (voting). Stored now so the schema doesn't change later.
  vote_closes_at: string | null;
  hide_vote_counts: boolean;
};

export type Panel = {
  id: string;
  episode_id: string;
  position: number;
  image_url: string;
  /** Pixel width of the slice as drawn for the site. Always 800. */
  width: number;
  height: number;
  /** Empty scroll AFTER this panel, in 800px-wide pixels (scaled on small screens). */
  gap_after: number;
  alt: string | null;
};

export type EpisodeWithPanels = Episode & { panels: Panel[] };

export type EpisodePage = {
  series: Series;
  episode: EpisodeWithPanels;
  previous: Pick<Episode, "number" | "title"> | null;
  next: Pick<Episode, "number" | "title"> | null;
  /** True when this is the newest published episode (comments/voting live here). */
  isLatest: boolean;
};
