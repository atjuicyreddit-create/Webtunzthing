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

// ---- Comic production (STORY-GUIDELINES section 7, learned from Episode 2) ----

/** "Risk: high · Takes: 5" in a panel's notes (rule 10). */
export function riskTag(notes: string | null | undefined): { risk: "low" | "medium" | "high" | null; takes: number | null } {
  const r = (notes ?? "").match(/\brisk\s*[:=]\s*(low|medium|high)\b/i);
  const t = (notes ?? "").match(/\btakes?\s*[:=]\s*(\d{1,2})/i);
  return { risk: r ? (r[1].toLowerCase() as "low" | "medium" | "high") : null, takes: t ? Number(t[1]) : null };
}

// Words that describe a size CHANGE happening in the panel (not a character who is simply big).
const SIZE_CHANGE = /\b(grows?|growing|grew|grown|shrinks?|shrinking|shrank|shrunk|swells?|swelling|swelled|stretching|changes size|getting (bigger|smaller)|half size|three poses)\b/i;
const X_SHAPED = /\b[a-z]+-shaped\b/i;
const LIMB_THROUGH = /\b(foot|feet|leg|legs|wing|wings|head|arm|arms|tail|beak|bill)\b[^.]{0,60}\b(out of|through|sticking out|poking out|pokes out|out through)\b[^.]{0,30}\b(window|door|doorway|frame|roof|chimney)\b/i;
// "his left foot", "both wings", "his head": exact. "one foot" isn't (which one?).
const LIMB_NAMED = /\b(left|right|both)\s+(foot|feet|leg|legs|wing|wings|arm|arms)\b|\b(his|her|its)\s+(head|tail|beak|bill)\b/i;
const INSIDE_OUT = /\b(pops? out|lands? (in|on) the (garden|lawn)|out of the (window|door)|through the (window|door)|into the garden|out into)\b/i;
const CAMERA_SIDE = /\b(inside|outside|interior|exterior|camera side|from the (garden|kitchen|lawn|street))\b/i;
const CLOSE_UP = /\b(close-?up|insert|callout|call-out|zoom)\b/i;

/** The production checks for one panel (rules 1-6, 8 and 10). Exported for tests. */
export function productionIssues(p: ScriptPanel, n: number): FreeIssue[] {
  const out: FreeIssue[] = [];
  const visual = `${p.action ?? ""}`;
  const tag = riskTag(p.notes);
  // Rule 10 (and 8): every panel needs a render risk and a take budget.
  if (!tag.risk || tag.takes === null) {
    out.push({ panel: n, message: "No render-risk tag. Add “Risk: low|medium|high · Takes: N” to the panel's notes (plan about 2 takes)." });
  } else if (tag.takes < 2 && tag.risk !== "low") {
    out.push({ panel: n, message: `Take budget is ${tag.takes}. Plan about 2 takes a panel (1 only for low-risk panels).` });
  }
  // Rule 1: size changes.
  if (SIZE_CHANGE.test(visual) && (tag.risk !== "high" || (tag.takes ?? 0) < 4)) {
    out.push({ panel: n, message: "A character changes size here. Flag it “Risk: high” and budget 4 to 6 takes." });
  }
  // Rule 4: never "X-shaped".
  const shaped = visual.match(X_SHAPED);
  if (shaped) out.push({ panel: n, message: `“${shaped[0]}”: the image model draws the thing itself. Describe the actual shape instead.` });
  // Rule 5: limbs through openings.
  if (LIMB_THROUGH.test(visual) && !LIMB_NAMED.test(visual)) {
    out.push({ panel: n, message: "A limb pokes through an opening. Say exactly which one (e.g. “his left foot”) and check no extra feet or wings appear." });
  }
  // Rule 6: inside to outside needs a fixed camera side.
  if (INSIDE_OUT.test(visual) && !CAMERA_SIDE.test(`${p.camera ?? ""} ${p.shot ?? ""}`)) {
    out.push({ panel: n, message: "Something moves from inside to outside. Fix one camera side (inside or outside) in the shot or camera field and keep it." });
  }
  // Rule 3: long labels need a close-up or callout.
  // (Captions sit in their own lettered box and always read; this rule is for signs and labels in the scene.)
  const caption = (p.caption ?? "").trim().toLowerCase();
  for (const t of p.text_items) {
    if (caption && t.text.trim().toLowerCase() === caption) continue;
    if (t.how === "lettered" && wordCount(t.text.replace(/\//g, " ")) > 4 && !CLOSE_UP.test(`${p.shot ?? ""} ${p.camera ?? ""} ${p.notes ?? ""}`)) {
      out.push({ panel: n, message: `“${t.text.slice(0, 40)}${t.text.length > 40 ? "…" : ""}” is over 4 words. Plan a close-up or a callout box, or it won't read.` });
    }
  }
  return out;
}

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
    out.push(...productionIssues(p, n));
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
