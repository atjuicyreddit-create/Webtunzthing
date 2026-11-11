import type { Fork, FreeIssue, Prop, ScriptPanel } from "./types";

// Free checks that run in code (no Claude, no cost). They never change the script.

export const MAX_CAPTION_WORDS = 7;

// Common sound-effect words. "…quack" is a character's voice in Morning Brew, so it isn't listed.
const SFX = [
  "bang", "boom", "crash", "whoosh", "pow", "splash", "thud", "zap", "bonk", "kaboom", "smash", "slam",
  "whirr", "whirrr", "vroom", "sizzle", "ding", "buzz", "beep", "tick-tock", "clang", "splat", "swoosh",
  "wham", "bam", "kapow", "fwoosh", "hiss", "thwack", "whack", "clatter", "rumble", "ka-ching", "kerplunk", "zoom",
];
export const SFX_RE = new RegExp(`(^|[^a-z])(${SFX.map((w) => w.replace("-", "\\-")).join("|")})($|[^a-z])`, "i");

export function wordCount(s: string | null | undefined): number {
  return (s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function minutes(clock: string | null): number | null {
  const m = (clock ?? "").match(/(\d{1,2})[:.](\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const NEW_DAY = /(next|following)\s+(morning|day|night|evening)|days?\s+later|the\s+next\s+day/i;

export function freeChecks(
  panels: ScriptPanel[],
  opts: { props: Prop[]; characters: string[]; fork: Fork | null; serial: boolean },
): FreeIssue[] {
  const out: FreeIssue[] = [];
  const keys = new Map(panels.map((p, i) => [p.panel_key, i]));
  const propNames = new Set(opts.props.map((p) => p.name.trim().toLowerCase()));
  const cast = new Set(opts.characters.map((c) => c.trim().toLowerCase()));
  let lastClock: { min: number; n: number } | null = null;

  panels.forEach((p, i) => {
    const n = i + 1;
    if (!p.action?.trim()) out.push({ panel: n, message: "No visual yet." });
    const words = wordCount(p.caption);
    if (words > MAX_CAPTION_WORDS) out.push({ panel: n, message: `Caption is ${words} words (max ${MAX_CAPTION_WORDS}).` });
    const texts = [p.caption ?? "", ...p.dialogue.map((d) => d.line)];
    for (const t of texts) {
      const m = t.match(SFX_RE);
      if (m) out.push({ panel: n, message: `“${m[2]}” looks like a sound effect. House rule: no sound effects.` });
    }
    if (p.dialogue.length + (p.caption?.trim() ? 1 : 0) > 3) out.push({ panel: n, message: "More than 3 text items in one panel." });

    const min = minutes(p.clock);
    if (min !== null) {
      const newDay = NEW_DAY.test(`${p.action ?? ""} ${p.notes ?? ""} ${p.title} ${p.shot ?? ""}`);
      if (lastClock && min < lastClock.min && !newDay) {
        out.push({ panel: n, message: `Clock goes backwards (${p.clock} after panel ${lastClock.n}). Say "next morning" in the visual if it's a new day.` });
      }
      lastClock = { min, n };
    }

    if (p.matches_key) {
      const j = keys.get(p.matches_key);
      if (j === undefined) out.push({ panel: n, message: "“Matches panel” points to a panel that no longer exists." });
      else if (j >= i) out.push({ panel: n, message: `“Matches panel” should point to an earlier panel (it points to panel ${j + 1}).` });
    }

    if (propNames.size) {
      for (const pr of p.props) {
        if (pr.name.trim() && !propNames.has(pr.name.trim().toLowerCase())) {
          out.push({ panel: n, message: `Prop “${pr.name}” isn't in the prop table.` });
        }
      }
    }
    if (cast.size) {
      for (const c of p.characters) {
        if (c.trim() && !cast.has(c.trim().toLowerCase())) out.push({ panel: n, message: `“${c}” has no character sheet.` });
      }
    }
    for (const t of p.text_items) {
      if (t.how === "model" && wordCount(t.text) > 4) {
        out.push({ panel: n, message: `“${t.text}” is drawn by the image model but is long. Only short prop labels may be drawn; letter it in code.` });
      }
    }
  });

  if (opts.serial) {
    if (!opts.fork?.question?.trim()) out.push({ panel: null, message: "Serial episode: the end card needs a vote question." });
    if (!opts.fork?.backup_pick?.trim()) out.push({ panel: null, message: "Serial episode: the end card needs a backup pick." });
    if ((opts.fork?.branches?.length ?? 0) < 2) out.push({ panel: null, message: "Serial episode: prepare 2 or 3 branches for the vote." });
  }
  if (panels.length === 0) out.push({ panel: null, message: "The script has no panels yet." });
  return out;
}
