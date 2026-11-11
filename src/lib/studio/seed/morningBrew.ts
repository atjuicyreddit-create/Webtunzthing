import "server-only";
import fs from "node:fs";
import path from "node:path";

// Reads the Morning Brew test material from studio-reference/ on THIS computer.
// That folder is git-ignored and never deployed, so the import only works locally.

const DIR = path.join(process.cwd(), "studio-reference", "morning-brew");

export function morningBrewAvailable(): boolean {
  return fs.existsSync(path.join(DIR, "story.md")) && fs.existsSync(path.join(DIR, "characters.md"));
}

// The three approved reference sheets from the test pack (Stage 4 import, test project only).
const REFS_DIR = path.join(process.cwd(), "studio-reference", "studio-assets", "morning-brew-test-pack", "refs");
const REFS = [
  { file: "01-pudding-character-v5.jpg", kind: "character" as const, name: "Pudding" },
  { file: "02-kitchen-v4.jpg", kind: "location" as const, name: "Kitchen" },
  { file: "03-great-aunt-mallow.jpg", kind: "character" as const, name: "Great-Aunt Mallow" },
];

export function morningBrewRefsAvailable(): boolean {
  return REFS.every((r) => fs.existsSync(path.join(REFS_DIR, r.file)));
}

export function readMorningBrewRefs() {
  return REFS.map((r) => ({ ...r, bytes: new Uint8Array(fs.readFileSync(path.join(REFS_DIR, r.file))) }));
}

const clean = (s: string) =>
  s
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type ParsedPanel = {
  title: string;
  size: "small" | "mid" | "tall";
  action: string;
  caption: string;
  dialogue: { speaker: string; line: string }[];
  clock: string;
  matches: number; // 1-based panel number, 0 = none
  gap_after: number;
  shot: string;
};

export type ParsedMorningBrew = {
  idea: string;
  answers: Record<string, string>;
  oneLine: string;
  lead: string;
  characters: { name: string; role: string; sheet: Record<string, unknown> }[];
  panels: ParsedPanel[];
  fork: { question: string; in_bounds: string; locked: string; backup_pick: string };
};

export function parseMorningBrew(): ParsedMorningBrew {
  const story = fs.readFileSync(path.join(DIR, "story.md"), "utf8");
  const chars = fs.readFileSync(path.join(DIR, "characters.md"), "utf8");

  const bullet = (label: string) => {
    const m = story.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n- \\*\\*|\\n---|\\n##)`));
    return m ? clean(m[1]) : "";
  };
  const lead = clean(story.match(/\*\*Lead:\*\*\s*(.+)/)?.[1] ?? "");
  const answers: Record<string, string> = {
    lead,
    want: bullet("Want"),
    why_today: bullet("Why today"),
    flaw: bullet("Flaw"),
    ending: bullet("Ending"),
  };
  const world = chars.match(/## The kitchen magic \(world rules\)\s*([\s\S]*)$/)?.[1] ?? "";
  answers.world_rules = clean(world.split("\n").filter((l) => l.trim().startsWith("-")).join(" "));

  // Characters: "## Name (role)" then "- **Field:** text" bullets.
  const characters: ParsedMorningBrew["characters"] = [];
  for (const block of chars.split(/\n## /).slice(1)) {
    const head = block.split("\n")[0];
    if (/world rules/i.test(head)) continue;
    const name = head.replace(/\(.*\)/, "").trim();
    const role = head.match(/\((.*)\)/)?.[1] ?? "";
    const f = (label: string) => clean(block.match(new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)`))?.[1] ?? "");
    characters.push({
      name,
      role: role || (characters.length === 0 ? "lead" : ""),
      sheet: {
        backstory: [f("Who"), f("Backstory")].filter(Boolean).join(" "),
        want: f("Wants?"),
        fear: f("Fears"),
        flaw: f("Flaw"),
        voice: f("Voice"),
        guardrails: name.toLowerCase() === "pudding" ? ['Only says "…quack" or "Ahh."', "Never smiles"] : [],
      },
    });
  }

  const panels: ParsedPanel[] = [];
  const parts = story.split(/\n### /).slice(1);
  let fork = { question: "", in_bounds: "", locked: "", backup_pick: "" };
  for (const part of parts) {
    const head = part.split("\n")[0];
    const body = part.slice(head.length);
    if (/^End card/i.test(head)) {
      const g = (label: string) => clean(body.match(new RegExp(`\\*\\*${label}[^:]*:\\*\\*\\s*(.+)`))?.[1] ?? "");
      fork = { question: g("Question"), in_bounds: g("In bounds"), locked: g("Locked"), backup_pick: g("Backup pick") };
      continue;
    }
    const m = head.match(/^Panel\s+(\d+):\s*(.*)$/);
    if (!m) continue;
    const title = m[2].replace(/\s*\(.*\)\s*$/, "").trim();
    const sizeNote = (m[2].match(/\(([^)]*)\)/)?.[1] ?? "").toLowerCase();
    const size: ParsedPanel["size"] = sizeNote.includes("tall") ? "tall" : sizeNote.includes("small") ? "small" : "mid";
    const visualRaw = body.match(/\*Visual:\*\s*([\s\S]*?)(?=\n\*\*|$)/)?.[1] ?? "";
    const bold = [...visualRaw.matchAll(/\*\*(\d{1,2}:\d{2})\*\*/g)].map((x) => x[1]);
    const clocks = bold.length ? bold : [...visualRaw.matchAll(/\bat (\d{1,2}:\d{2})\b/g)].map((x) => x[1]);
    const caption = clean(body.match(/\*\*Caption:\*\*\s*(.+)/)?.[1] ?? "");
    const dialogue = [...body.matchAll(/\*\*([A-Z][A-Za-z' -]+):\*\*\s*(.+)/g)]
      .filter((x) => !/^(Caption|Visual)$/i.test(x[1]))
      .map((x) => ({ speaker: x[1].trim(), line: clean(x[2]) }));
    const matches = Number(visualRaw.match(/same [^.]*? as Panel (\d+)/i)?.[1] ?? 0);
    panels.push({
      title,
      size,
      action: clean(visualRaw),
      caption,
      dialogue,
      clock: clocks[clocks.length - 1] ?? "",
      matches,
      gap_after: /big gap/i.test(m[2]) || /long empty gap/i.test(visualRaw) ? 1200 : 250,
      // The bracket after the heading holds the shot note, e.g. "interior, next morning" or "tall panel".
      shot: clean(m[2].match(/\(([^)]*)\)/)?.[1] ?? ""),
    });
  }
  if (panels.length) panels[panels.length - 1].gap_after = 0;

  const ideaLine = clean(story.match(/\*\*Format:\*\*\s*(.+)/)?.[1] ?? "");
  return { idea: ideaLine, answers, oneLine: bullet("One-line test"), lead, characters, panels, fork };
}
