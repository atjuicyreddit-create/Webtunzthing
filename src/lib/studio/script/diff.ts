import type { ScriptPanel } from "./types";

// Compare two versions panel by panel, using the permanent panel_key.

const FIELDS: (keyof ScriptPanel)[] = [
  "title", "shot", "camera", "characters", "action", "caption", "dialogue", "size", "gap_after", "props", "clock", "matches_key", "text_items", "notes",
];
const LABEL: Partial<Record<keyof ScriptPanel, string>> = {
  action: "visual",
  gap_after: "gap after",
  matches_key: "matches panel",
  text_items: "text in art",
};

export type PanelDiff =
  | { kind: "added"; key: string; title: string; to: number }
  | { kind: "removed"; key: string; title: string; from: number }
  | { kind: "changed"; key: string; title: string; from: number; to: number; fields: { field: string; before: string; after: string }[] };

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) {
    return (
      v
        .map((x) =>
          typeof x === "object" && x
            ? "speaker" in x
              ? `${(x as { speaker: string }).speaker}: ${(x as { line: string }).line}`
              : "name" in x
                ? [(x as { name: string }).name, (x as { location?: string }).location, (x as { state?: string }).state].filter(Boolean).join(" / ")
                : "text" in x
                  ? `${(x as { text: string }).text} (${(x as { how: string }).how})`
                  : JSON.stringify(x)
            : String(x),
        )
        .join("; ") || "—"
    );
  }
  return String(v);
};

export function diffScripts(before: ScriptPanel[], after: ScriptPanel[]): PanelDiff[] {
  const out: PanelDiff[] = [];
  const b = new Map(before.map((p, i) => [p.panel_key, { p, i }]));
  const a = new Map(after.map((p, i) => [p.panel_key, { p, i }]));
  after.forEach((p, i) => {
    const old = b.get(p.panel_key);
    if (!old) {
      out.push({ kind: "added", key: p.panel_key, title: p.title, to: i + 1 });
      return;
    }
    const fields = FIELDS.filter((f) => show(old.p[f]) !== show(p[f])).map((f) => ({
      field: LABEL[f] ?? String(f),
      before: show(old.p[f]),
      after: show(p[f]),
    }));
    if (fields.length || old.i !== i) out.push({ kind: "changed", key: p.panel_key, title: p.title, from: old.i + 1, to: i + 1, fields });
  });
  before.forEach((p, i) => {
    if (!a.has(p.panel_key)) out.push({ kind: "removed", key: p.panel_key, title: p.title, from: i + 1 });
  });
  return out;
}
