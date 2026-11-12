// The story writer: Tom tells the episode in his own words; Claude keeps a draft with blanks,
// a portfolio of every detail mentioned, and a story-health read. One row per version.

import type { QuestionKey } from "../story/questions";

export type Quickstart = { about: string; setting: string; lead: string; backstory: string };

export type Beat = { id: string; heading: string; text: string };

/** "plot" blanks change what happens or why, so Claude never decides them. "detail" blanks are small and use Claude's guess until Tom changes it. */
export type Blank = {
  id: string;
  beat_id: string;
  question: string;
  kind: "plot" | "detail";
  guess: string;
  options: string[];
  answer: string | null;
};

export type Fact = { text: string; from: string; guessed: boolean };
export type Entry = { name: string; role: string; facts: Fact[] };
export type Mystery = { text: string; from: string };
export type Portfolio = { characters: Entry[]; places: Entry[]; objects: Entry[]; mysteries: Mystery[] };

export type Health = {
  spine: Record<QuestionKey, string>;
  one_line: string;
  one_line_passes: boolean;
  notes: { level: "ok" | "weak"; text: string }[];
  panels_estimate: number;
  episode_split: string;
};

export type DraftBody = { synopsis: string; beats: Beat[]; blanks: Blank[] };

export type DraftRow = {
  id: string;
  version: number;
  quickstart: Quickstart;
  telling: string;
  draft: DraftBody;
  portfolio: Portfolio;
  health: Health | null;
  change_request: string | null;
  changes: string[];
  created_at: string;
};

export const EMPTY_PORTFOLIO: Portfolio = { characters: [], places: [], objects: [], mysteries: [] };

/** Plot blanks Tom still has to answer before the story can be locked. */
export const openPlotBlanks = (d: DraftBody | undefined) => (d?.blanks ?? []).filter((b) => b.kind === "plot" && !b.answer?.trim());

/** Beat text with every [[id]] marker replaced by Tom's answer, else Claude's guess. */
export function resolveBeat(text: string, blanks: Blank[]): string {
  return text.replace(/\[\[([a-z0-9_-]+)\]\]/gi, (_, id: string) => {
    const b = blanks.find((x) => x.id === id);
    return b ? b.answer?.trim() || b.guess || "…" : "";
  });
}

/** Normalises a stored row (older or partial JSON) so the page never trips over a missing field. */
export function normaliseRow(r: Record<string, unknown>): DraftRow {
  const draft = (r.draft ?? {}) as Partial<DraftBody>;
  const qs = (r.quickstart ?? {}) as Partial<Quickstart>;
  const pf = (r.portfolio ?? {}) as Partial<Portfolio>;
  const health = r.health && Object.keys(r.health as object).length ? (r.health as Health) : null;
  return {
    id: String(r.id),
    version: Number(r.version),
    quickstart: { about: qs.about ?? "", setting: qs.setting ?? "", lead: qs.lead ?? "", backstory: qs.backstory ?? "" },
    telling: String(r.telling ?? ""),
    draft: { synopsis: draft.synopsis ?? "", beats: draft.beats ?? [], blanks: draft.blanks ?? [] },
    portfolio: {
      characters: pf.characters ?? [],
      places: pf.places ?? [],
      objects: pf.objects ?? [],
      mysteries: pf.mysteries ?? [],
    },
    health,
    change_request: (r.change_request as string | null) ?? null,
    changes: Array.isArray(r.changes) ? (r.changes as string[]) : [],
    created_at: String(r.created_at ?? ""),
  };
}
