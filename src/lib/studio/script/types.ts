// Shared by server and browser (no server-only imports).

export type Dialogue = { speaker: string; line: string };
export type PanelProp = { name: string; location?: string; state?: string };
export type TextItem = { text: string; how: "lettered" | "model" };

export type ScriptPanel = {
  id: string;
  panel_key: string;
  position: number;
  title: string;
  shot: string | null;
  camera: string | null;
  characters: string[];
  action: string | null;
  caption: string | null;
  dialogue: Dialogue[];
  size: "small" | "mid" | "tall";
  gap_after: number;
  props: PanelProp[];
  clock: string | null;
  matches_key: string | null;
  text_items: TextItem[];
  notes: string | null;
};

export type ScriptVersion = {
  id: string;
  version: number;
  changelog: string;
  created_at: string;
  check_result: CheckResult | null;
  checked_at: string | null;
};

export type Fork = {
  id?: string;
  question: string | null;
  in_bounds: string | null;
  locked: string | null;
  backup_pick: string | null;
  branches: { title: string; summary: string; rejoins: string }[];
};

export type Prop = { id: string; name: string; owner: string | null; rule: string | null };

export const CHECKS = [
  { key: "want_why", label: "Want and why are visible within 2 panels" },
  { key: "ending_flaw", label: "The ending comes from the flaw, not luck" },
  { key: "plants", label: "Every plant pays off" },
  { key: "gags", label: "Gags escalate in threes, each with a reaction beat" },
  { key: "no_sfx", label: "No sound effects" },
  { key: "steps", label: "Real-world steps are in order" },
  { key: "why", label: "Every action has a why" },
  { key: "danger", label: "The lingering danger stays visible" },
  { key: "props", label: "Prop table and continuity (owner, location, state per panel)" },
  { key: "matched", label: "Matched angles show the right props" },
  { key: "clock", label: "Clock times move forwards" },
  { key: "costume", label: "Costume locks are kept" },
  { key: "text", label: "Not too much text per panel" },
  { key: "vote", label: "Serial: ends on a scoped vote question with a backup" },
  { key: "format", label: "Format decided (one-off or serial, and the end card)" },
  { key: "pacing", label: "Hook in panel 1, a gap before the twist, a button at the end" },
  {
    key: "production",
    label:
      "Comic production (guidelines section 7): size changes flagged with 4-6 takes; one complex physical action per panel (split crowded panels); labels over 4 words get a close-up or callout; nothing described as 'X-shaped'; any limb through a window or door is named exactly; one camera side kept when something moves inside to outside; every panel has a render risk and a take budget (about 2 takes a panel)",
  },
] as const;
export type CheckKey = (typeof CHECKS)[number]["key"];

export type CheckItem = { key: CheckKey; status: "pass" | "fail" | "na"; panels: number[]; note: string };
export type CheckResult = { summary: string; items: CheckItem[] };

export type FreeIssue = { panel: number | null; message: string };
