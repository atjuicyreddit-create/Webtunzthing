// Free checks, in code, before any spend. Pure functions (no database, no AI).
import type { Flag, ForkSnapshot, LiveComment, Prepared } from "./types";

export const CLIP = 500;

/** Strips control characters and squashes whitespace, then clips. Used for what's sent to Claude. */
export function cleanText(s: string, max = CLIP): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const norm = (s: string) => cleanText(s, 2000).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();

/**
 * Oldest first. Drops empty comments and exact duplicates (keeps the earliest), flags very short
 * ones and ones with a link, and numbers the first `max` valid ones 1..n for Claude.
 */
export function prepareComments(comments: LiveComment[], max: number): Prepared[] {
  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const seen = new Set<string>();
  let n = 0;
  return sorted.map((c) => {
    const key = norm(c.body);
    const flags: Flag[] = [];
    if (key && key.split(/\s+/).length < 3) flags.push("short");
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|uk|ly|gg)\b/i.test(c.body)) flags.push("link");
    if (!key) return { ...c, skipped: "empty" as const, flags, n: null };
    if (seen.has(key)) return { ...c, skipped: "duplicate" as const, flags, n: null };
    seen.add(key);
    if (n >= max) return { ...c, skipped: "over_cap" as const, flags, n: null };
    n += 1;
    return { ...c, skipped: null, flags, n };
  });
}

/** What blocks a screening (empty list = ready). */
export function readiness(p: {
  fork: ForkSnapshot | null;
  destination: string | null;
  milestones: number;
  serial: boolean;
  linked: boolean;
}): string[] {
  const out: string[] = [];
  if (!p.serial) out.push("Reader votes are for serial comics. This project is a one-off.");
  if (!p.linked) out.push("Link the live episode whose comments should be read.");
  if (!p.fork?.question.trim()) out.push("The episode's end card has no vote question (Script page, end card).");
  if (!p.fork?.branches.length) out.push("The end card has no prepared branches (Script page, end card). Claude needs them to map a comment.");
  if (!p.destination?.trim()) out.push("The season has no destination (Story builder, season plot).");
  if (p.milestones < 1) out.push("The season has no milestones (Story builder, season plot).");
  return out;
}

/** "You chose…" lines are lettered: keep them to 7 words or fewer, like captions. */
export function youChose(label: string): string {
  const words = cleanText(label, 80).replace(/^you chose[:,]?\s*/i, "").replace(/[.!]+$/, "").split(/\s+/).filter(Boolean);
  return `You chose: ${words.slice(0, 5).join(" ")}.`;
}
