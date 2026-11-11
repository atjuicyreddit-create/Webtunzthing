// Shared by server and browser (no server-only imports).

export type PanelSize = "small" | "mid" | "tall";
export const ASPECT_BY_SIZE: Record<PanelSize, string> = { tall: "9:16", mid: "3:4", small: "4:3" };
export const RATIO_BY_SIZE: Record<PanelSize, number> = { tall: 9 / 16, mid: 3 / 4, small: 4 / 3 };

/** Masters are lettered at 1600 px wide; they publish at 800. */
export const MASTER_WIDTH = 1600;
/** Nothing in the outer 40 px at 800 wide = 80 px at 1600. */
export const SAFE_MARGIN = 80;
/** Speech and caption text at least 24 px at 800 wide = 48 px at 1600. */
export const MIN_TEXT = 48;

// ------------------------------------------------------------------ lettering elements
// Positions are at 1600 px wide. Empty text means "use the script" (caption, line N, clock time),
// so a wording change in the script re-letters without moving anything.

export type LetterEl =
  | { kind: "caption"; text: string; cx: number; cy: number; maxw: number; size: number }
  | { kind: "balloon"; text: string; line: number; cx: number; cy: number; tx: number; ty: number; size: number }
  | { kind: "clock"; time: string; cx: number; cy: number; r: number }
  | { kind: "watch"; time: string; cx: number; cy: number; r: number }
  | { kind: "plaque"; text: string; cx: number; cy: number; w: number; h: number; size: number }
  | { kind: "label"; lines: string; cx: number; cy: number; w: number; h: number; size: number }
  | { kind: "note"; header: string; items: string; signed: string; ticked: boolean; x: number; y: number; w: number; h: number; size: number }
  | { kind: "shortnote"; text: string; x: number; y: number; w: number; h: number; size: number };

export type LetterKind = LetterEl["kind"];

export const LETTER_LABEL: Record<LetterKind, string> = {
  caption: "Caption box",
  balloon: "Speech balloon",
  clock: "Wall clock",
  watch: "Pocket watch",
  plaque: "Plaque",
  label: "Jar label patch",
  note: "Pinned note with checklist",
  shortnote: "Short note",
};

/** Field list per kind, for the editor (n = number, t = text, l = multi-line, b = yes/no). */
export const LETTER_FIELDS: Record<LetterKind, [string, "n" | "t" | "l" | "b", string][]> = {
  caption: [["text", "t", "Text (blank = the script's caption)"], ["cx", "n", "Centre x"], ["cy", "n", "Centre y"], ["maxw", "n", "Max width"], ["size", "n", "Text size"]],
  balloon: [["text", "t", "Text (blank = script line)"], ["line", "n", "Script line no."], ["cx", "n", "Centre x"], ["cy", "n", "Centre y"], ["tx", "n", "Tail tip x"], ["ty", "n", "Tail tip y"], ["size", "n", "Text size"]],
  clock: [["time", "t", "Time (blank = the script's clock)"], ["cx", "n", "Centre x"], ["cy", "n", "Centre y"], ["r", "n", "Radius"]],
  watch: [["time", "t", "Time (blank = the script's clock)"], ["cx", "n", "Centre x"], ["cy", "n", "Centre y"], ["r", "n", "Radius"]],
  plaque: [["text", "t", "Text"], ["cx", "n", "Centre x"], ["cy", "n", "Centre y"], ["w", "n", "Width"], ["h", "n", "Height"], ["size", "n", "Text size"]],
  label: [["lines", "l", "Lines (first line largest)"], ["cx", "n", "Centre x"], ["cy", "n", "Centre y"], ["w", "n", "Width"], ["h", "n", "Height"], ["size", "n", "First line size"]],
  note: [["header", "l", "Header lines"], ["items", "l", "Checklist items"], ["signed", "t", "Signed"], ["ticked", "b", "Ticked"], ["x", "n", "Left"], ["y", "n", "Top"], ["w", "n", "Width"], ["h", "n", "Height"], ["size", "n", "Item size"]],
  shortnote: [["text", "t", "Text"], ["x", "n", "Left"], ["y", "n", "Top"], ["w", "n", "Width"], ["h", "n", "Height"], ["size", "n", "Text size"]],
};

export function defaultElement(kind: LetterKind): LetterEl {
  switch (kind) {
    case "caption": return { kind, text: "", cx: 800, cy: 200, maxw: 1240, size: 48 };
    case "balloon": return { kind, text: "", line: 1, cx: 1100, cy: 700, tx: 900, ty: 1000, size: 56 };
    case "clock": return { kind, time: "", cx: 1300, cy: 320, r: 90 };
    case "watch": return { kind, time: "", cx: 800, cy: 1200, r: 36 };
    case "plaque": return { kind, text: "PLAQUE", cx: 800, cy: 500, w: 360, h: 64, size: 28 };
    case "label": return { kind, lines: "LABEL", cx: 800, cy: 900, w: 200, h: 80, size: 28 };
    case "note": return { kind, header: "NOTE", items: "item one\nitem two", signed: "", ticked: false, x: 160, y: 700, w: 260, h: 360, size: 22 };
    case "shortnote": return { kind, text: "Note", x: 600, y: 900, w: 200, h: 100, size: 28 };
  }
}

// ------------------------------------------------------------------ manual QA (PIPELINE-RULES 1.8)

export const QA_TICKS: { key: string; label: string }[] = [
  { key: "anatomy", label: "Anatomy: right number of heads, eyes, wings, feet. No stray limbs." },
  { key: "costume", label: "Costume lock and signature details are all there." },
  { key: "props", label: "Props are where the prop table says, and nothing unrequested appears." },
  { key: "expression", label: "The expression or eye direction reads at thumbnail size." },
  { key: "gag", label: "The gag is at least as strong as the previous version." },
  { key: "camera", label: "The camera matches its pair (or this panel has no pair)." },
];

export type AutoCheck = { name: string; ok: boolean; note: string };
export type VisionFinding = { kind: string; severity: "high" | "medium" | "low"; note: string; lesson: string };
export type VisionQa = { summary: string; findings: VisionFinding[]; model: string; cost: string };

export type PanelRow = {
  id: string;
  episode_id: string;
  panel_key: string;
  chosen_take_id: string | null;
  direction: string | null;
  precheck: { ok: boolean; issues: string[]; note: string } | null;
  precheck_hash: string | null;
  letter_layout: LetterEl[];
  lettered_path: string | null;
  lettered_take_id: string | null;
  lettered_hash: string | null;
  lettered_at: string | null;
  compare_path: string | null;
  qa: VisionQa | null;
  qa_at: string | null;
  qa_lettered_path: string | null;
};

export const PANEL_ROW_COLS =
  "id,episode_id,panel_key,chosen_take_id,direction,precheck,precheck_hash,letter_layout,lettered_path,lettered_take_id,lettered_hash,lettered_at,compare_path,qa,qa_at,qa_lettered_path";

export type PanelTake = {
  id: string;
  panel_key: string | null;
  episode_id: string | null;
  kind: "exploration" | "final" | "imported";
  status: "pending" | "ready" | "failed" | "dry_run";
  prompt: string;
  model: string | null;
  size: string | null;
  aspect: string | null;
  cost_usd: number;
  storage_path: string | null;
  comment: string | null;
  error: string | null;
  job_id: string | null;
  created_at: string;
  lessons_applied: { id: string; lesson: string }[];
  refs: { label: string; path: string }[];
  parent_take_id: string | null;
  change_note: string | null;
  script_hash: string | null;
  auto_qa: AutoCheck[] | null;
  qa_ticks: Record<string, boolean>;
  qa_ticked: boolean;
  rejected: boolean;
  reject_reason: string | null;
};

export const PANEL_TAKE_COLS =
  "id,panel_key,episode_id,kind,status,prompt,model,size,aspect,cost_usd,storage_path,comment,error,job_id,created_at,lessons_applied,refs,parent_take_id,change_note,script_hash,auto_qa,qa_ticks,qa_ticked,rejected,reject_reason";
