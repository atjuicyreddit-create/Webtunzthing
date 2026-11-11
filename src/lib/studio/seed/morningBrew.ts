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

// ------------------------------------------------------------------ Stage 5: masters + lettering positions

const PACK = path.join(process.cwd(), "studio-reference", "studio-assets", "morning-brew-test-pack");

export function morningBrewMastersAvailable(): boolean {
  return fs.existsSync(path.join(PACK, "panels-unlettered", "p01.jpg")) && fs.existsSync(path.join(PACK, "script", "letter_reference.py"));
}

/** Panel n (1-based): the unlettered master and the old lettered panel, when present. */
export function readMorningBrewMaster(n: number) {
  const name = `p${String(n).padStart(2, "0")}.jpg`;
  const un = path.join(PACK, "panels-unlettered", name);
  const let_ = path.join(PACK, "panels", name);
  return {
    unlettered: fs.existsSync(un) ? new Uint8Array(fs.readFileSync(un)) : null,
    lettered: fs.existsSync(let_) ? new Uint8Array(fs.readFileSync(let_)) : null,
  };
}

type El = import("../panels/types").LetterEl;

const STR = /(['"])((?:\\.|(?!\1).)*)\1/g;
const strings = (s: string) => [...s.matchAll(STR)].map((m) => m[2].replace(/\\(['"])/g, "$1"));
const num = (s: string | undefined, d = 0) => (s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) ? Math.round(Number(s)) : d);
const kw = (args: string, name: string) => args.match(new RegExp(`${name}\\s*=\\s*([\\w.()\\s,-]+?)(?:,\\s*\\w+\\s*=|\\)?$)`))?.[1]?.trim();

/** Reads letter_reference.py (positions at 1600 px) into lettering elements per panel. Reference only: it's parsed, never run. */
export function parseLetterReference(): Record<number, El[]> {
  const src = fs.readFileSync(path.join(PACK, "script", "letter_reference.py"), "utf8");
  const v3 = fs.readFileSync(path.join(PACK, "script", "letter_v3.py"), "utf8");
  const constList = (name: string) => strings(v3.match(new RegExp(`^${name}\\s*=\\s*\\[([^\\]]*)\\]`, "m"))?.[1] ?? "");
  const HEADER = constList("HEADER");
  const CHECKLIST = constList("CHECKLIST");

  const out: Record<number, El[]> = {};
  for (const block of src.split(/\ndef /).slice(1)) {
    const m = block.match(/^p(\d{2})\(im\):/);
    if (!m) continue;
    const n = Number(m[1]);
    const els: El[] = [];
    // Join calls that continue over several lines (count brackets outside strings).
    const joined: string[] = [];
    let buf = "";
    for (const raw of block.split("\n").slice(1)) {
      buf = buf ? `${buf} ${raw.trim()}` : raw.trim();
      const bare = buf.replace(STR, "");
      if ((bare.match(/\(/g) ?? []).length <= (bare.match(/\)/g) ?? []).length) {
        joined.push(buf);
        buf = "";
      }
    }
    for (const line of joined) {
      const call = line.trim().match(/^(\w+)\(im,\s*(.*)\)\s*$/);
      if (!call) continue;
      const [, fn, args] = call;
      const nums = args.replace(STR, '""').split(",").map((x) => x.trim());
      const s = strings(args);
      if (fn === "classic_caption_box") {
        els.push({ kind: "caption", text: s[0] ?? "", cx: num(nums[1]), cy: num(nums[2]), maxw: num(nums[3], 1240), size: num(kw(args, "sz"), 48) });
      } else if (fn === "western_balloon") {
        const tail = args.match(/\((\d+),\s*(\d+)\)/);
        els.push({ kind: "balloon", text: s[0] ?? "", line: 1, cx: num(nums[1]), cy: num(nums[2]), tx: num(tail?.[1]), ty: num(tail?.[2]), size: num(kw(args, "sz"), 56) });
      } else if (fn === "paint_clock" || fn === "paint_watch") {
        els.push({ kind: fn === "paint_clock" ? "clock" : "watch", time: `${num(nums[2])}:${String(num(nums[3])).padStart(2, "0")}`, cx: num(nums[0]), cy: num(nums[1]), r: num(kw(args, "r"), 60) });
      } else if (fn === "plaque") {
        els.push({ kind: "plaque", text: s[0] ?? "", cx: num(nums[0]), cy: num(nums[1]), w: num(kw(args, "w"), 340), h: num(kw(args, "h"), 64), size: 28 });
      } else if (fn === "paint_label") {
        const box = args.match(/box=\((\d+),\s*(\d+)\)/);
        const sizes = [...args.matchAll(/['"],\s*(\d+)\)/g)].map((x) => Number(x[1]));
        els.push({ kind: "label", lines: s.join("\n"), cx: num(nums[0]), cy: num(nums[1]), w: num(box?.[1], 200), h: num(box?.[2], 80), size: sizes[0] ?? 28 });
      } else if (fn === "letter_note") {
        const header = /HEADER/.test(args) ? HEADER : strings(args.match(/\[([^\]]*)\]/)?.[1] ?? "");
        const signed = strings(args.replace(/\[[^\]]*\]/, "")).pop() ?? "";
        els.push({
          kind: "note", header: header.join("\n"), items: CHECKLIST.join("\n"), signed, ticked: /ticked=True/.test(args),
          x: num(nums[0]), y: num(nums[1]), w: num(nums[2], 260), h: num(nums[3], 360), size: num(kw(args, "item_sz"), 20),
        });
      } else if (fn === "short_note") {
        els.push({ kind: "shortnote", text: s[0] ?? "", x: num(nums[0]), y: num(nums[1]), w: num(nums[2], 200), h: num(nums[3], 100), size: num(kw(args, "sz"), 26) });
      } else if (fn === "swift_label") {
        els.push({ kind: "label", lines: "SWIFTNESS\nBEANS\npotion ingredient\n— do not eat", cx: num(nums[0]), cy: num(nums[1]), w: num(nums[2], 92), h: num(nums[3], 64), size: 14 });
      }
    }
    out[n] = els;
  }
  return out;
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

  const COSTUME_LOCKS: Record<string, { costume_always: string; costume_never: string }> = {
    pudding: {
      costume_always: "a striped nightcap with its tail and bobble, exactly one upright feather, and dungarees (an apron only where the script says)",
      costume_never: "pyjamas, a blanket, shoes or a second feather",
    },
    "great-aunt mallow": {
      costume_always: "a pointed witch's hat and half-moon glasses",
      costume_never: "an apron or a modern outfit",
    },
  };
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
        // characters.md has no costume lock; these come from PIPELINE-RULES.md (signature details and exclusions).
        ...(COSTUME_LOCKS[name.toLowerCase()] ?? {}),
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
