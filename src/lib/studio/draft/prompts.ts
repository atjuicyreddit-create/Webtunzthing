import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiClaude, estimateClaudeUsd } from "../ai/aiCall";
import type { StudioSettings } from "../settings";
import { SYSTEM } from "../story/prompts";
import { QUESTIONS, type QuestionKey } from "../story/questions";
import type { Project } from "../story/story";
import type { Blank, DraftBody, DraftRow, Health, Portfolio, Quickstart } from "./types";

// The story writer's one Claude request. A first read turns Tom's telling into a draft; an
// update applies his answers and change request to the current draft and keeps the rest.

export type DraftInput = {
  project: Project;
  quickstart: Quickstart;
  telling: string;
  prev: DraftRow | null;
  change: string;
};

export type DraftReply = DraftBody & { portfolio: Portfolio; health: Health; changes: string[] };

const str = { type: "string" } as const;
const bool = { type: "boolean" } as const;
const int = { type: "integer" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

// Kept flat on purpose: a deeply nested schema is rejected ("compiled grammar is too large").
// The reply is converted to the stored shape (portfolio, health) in toReply().
const SCHEMA = obj({
  synopsis: str,
  beats: arr(obj({ id: str, heading: str, text: str })),
  blanks: arr(obj({ id: str, beat_id: str, question: str, kind: { type: "string", enum: ["plot", "detail"] }, guess: str, options: arr(str) })),
  entries: arr(obj({ kind: { type: "string", enum: ["character", "place", "object"] }, name: str, role: str, facts: arr(obj({ text: str, from: str, guessed: bool })) })),
  mysteries: arr(str),
  spine: arr(obj({ key: str, text: str })),
  one_line: str,
  one_line_passes: bool,
  notes: arr(obj({ weak: bool, text: str })),
  panels_estimate: int,
  episode_split: str,
  changes: arr(str),
});

type RawEntry = { kind: "character" | "place" | "object"; name: string; role: string; facts: { text: string; from: string; guessed: boolean }[] };
type RawReply = DraftBody & {
  entries: RawEntry[];
  mysteries: string[];
  spine: { key: string; text: string }[];
  one_line: string;
  one_line_passes: boolean;
  notes: { weak: boolean; text: string }[];
  panels_estimate: number;
  episode_split: string;
  changes: string[];
};

function toReply(r: RawReply): DraftReply {
  const pick = (k: RawEntry["kind"]) => (r.entries ?? []).filter((e) => e.kind === k).map(({ name, role, facts }) => ({ name, role, facts: facts ?? [] }));
  const spine = Object.fromEntries(QUESTIONS.map((q) => [q.key, r.spine?.find((x) => x.key === q.key)?.text ?? ""])) as Record<QuestionKey, string>;
  return {
    synopsis: r.synopsis,
    beats: r.beats,
    blanks: r.blanks,
    portfolio: { characters: pick("character"), places: pick("place"), objects: pick("object"), mysteries: (r.mysteries ?? []).map((text) => ({ text, from: "" })) },
    health: {
      spine,
      one_line: r.one_line,
      one_line_passes: !!r.one_line_passes,
      notes: (r.notes ?? []).map((n) => ({ level: n.weak ? "weak" : "ok", text: n.text })),
      panels_estimate: r.panels_estimate,
      episode_split: r.episode_split,
    },
    changes: r.changes ?? [],
  };
}

/** The stored shape back to the reply shape, for the dry run. */
function toRaw(d: DraftReply): RawReply {
  return {
    synopsis: d.synopsis,
    beats: d.beats,
    blanks: d.blanks,
    entries: [
      ...d.portfolio.characters.map((e) => ({ ...e, kind: "character" as const })),
      ...d.portfolio.places.map((e) => ({ ...e, kind: "place" as const })),
      ...d.portfolio.objects.map((e) => ({ ...e, kind: "object" as const })),
    ],
    mysteries: d.portfolio.mysteries.map((m) => m.text),
    spine: Object.entries(d.health.spine).map(([key, text]) => ({ key, text })),
    one_line: d.health.one_line,
    one_line_passes: d.health.one_line_passes,
    notes: d.health.notes.map((n) => ({ weak: n.level === "weak", text: n.text })),
    panels_estimate: d.health.panels_estimate,
    episode_split: d.health.episode_split,
    changes: d.changes,
  };
}

const RULES = `How to write the draft:
1. Tom's telling is the source. Keep his events, their order and every detail he gives. Never add a plot event he didn't write. Where the logic has a hole, add a blank instead of filling it.
2. Beats: 8 to 20, in order. Each has a short heading (3 to 6 words) and 1 to 4 sentences in the present tense, written so it could be drawn. Draft short dialogue in quotes where a character would speak (under 12 words a line). No sound effects.
3. Blanks: put the marker [[id]] in the beat text exactly where the blank sits (ids like b1, b2).
   - kind "plot": anything that changes what happens or why (motives, identities, causes, how a problem gets solved, what a character decides). Never decide these. Give your best guess in "guess" and 2 or 3 genuinely different "options". At most 6 plot blanks open at once, most important first.
   - kind "detail": small things (time of day, weather, what a room or outfit looks like). Pick a sensible guess; the draft reads using it. 2 or 3 options too.
   - Only ask what matters for the logic or for drawing the panels. Don't ask about things Tom already said.
4. Portfolio ("entries" and "mysteries"): every character, place and object mentioned, each with facts. "from" quotes the few words of Tom's telling (or his answers) it came from. "guessed" is true when you inferred it rather than Tom saying it. Mysteries are the open questions the story raises on purpose (keep them open; don't solve them).
5. Health: fill "spine" with one item per key (lead, want, why_today, obstacle, flaw, need, stakes, ending, world_rules) from the story as it stands ("" where it isn't there yet). one_line follows "[Lead] wants [X] because [Y], but [flaw/obstacle], so [ending]."; one_line_passes says whether the story really supports it. Give 2 to 5 short notes against the story guidelines (weak = true for a real problem, false for something working). panels_estimate is roughly one panel per drawable moment. If it's over about 22 panels, episode_split names the beat where episode 1 should end and why; otherwise "".
6. synopsis: one sentence saying what this story is about.`;

function context(i: DraftInput): string {
  const p = i.project;
  const q = i.quickstart;
  return [
    `Working title: ${p.title}`,
    `Format: ${p.format === "serial" ? "serial (each episode ends on a reader vote)" : "one-off"}`,
    p.tone ? `Tone: ${p.tone}` : null,
    p.audience ? `Audience: ${p.audience}` : null,
    "",
    "Quick start (Tom's words):",
    `- What it's about: ${q.about || "(not given)"}`,
    `- Where it's set: ${q.setting || "(not given)"}`,
    `- Main character: ${q.lead || "(not given)"}`,
    `- Their backstory: ${q.backstory || "(not given)"}`,
    "",
    "Tom's telling of the episode (his own words, typos and all):",
    i.telling,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

export function buildDraftRequest(i: DraftInput) {
  const ctx = context(i);
  let task: string;
  if (!i.prev) {
    task = `${RULES}\n\nThis is the first read. Write the draft, blanks, portfolio and health from scratch. "changes" is an empty list.`;
  } else {
    const answered = i.prev.draft.blanks.filter((b) => b.answer?.trim());
    const open = i.prev.draft.blanks.filter((b) => !b.answer?.trim());
    task = [
      RULES,
      "",
      "This is an update. The current draft is below. Make only the changes that Tom's answers, his change request and any edits to his telling require.",
      "Keep every beat that isn't affected word for word, with the same id. Write each answered blank into its beat (drop the marker and the blank). Keep the ids of blanks still open. New blanks get new ids.",
      'Update the portfolio and health to match. In "changes", list what you changed in short lines Tom can scan.',
      "",
      `Current synopsis: ${i.prev.draft.synopsis}`,
      "Current beats:",
      ...i.prev.draft.beats.map((b) => `[${b.id}] ${b.heading}: ${b.text}`),
      answered.length ? "\nTom's answers to blanks (write these in):" : "",
      ...answered.map((b) => `[${b.id}] ${b.question} → ${b.answer}`),
      open.length ? "\nBlanks still open (keep unless the change makes them pointless):" : "",
      ...open.map((b) => `[${b.id}] (${b.kind}, beat ${b.beat_id}) ${b.question} · guess: ${b.guess} · options: ${b.options.join(" | ")}`),
      "\nCurrent portfolio:",
      JSON.stringify(i.prev.portfolio),
      "",
      i.change ? `Tom's change request (do this): ${i.change}` : "Tom has no change request this time; just write in his answers and tidy what they affect.",
    ].join("\n");
  }
  return {
    purpose: i.prev ? `Story writer: update to version ${i.prev.version + 1}` : "Story writer: first read",
    system: SYSTEM,
    user: `${ctx}\n\n${task}`,
    maxTokens: 20000,
    effort: "medium" as const,
    schema: SCHEMA,
  };
}

export function estimateDraft(settings: StudioSettings | null, i: DraftInput): number | null {
  if (!settings) return null;
  const r = buildDraftRequest(i);
  return estimateClaudeUsd(settings, settings.models.story, r.system, [{ role: "user", content: r.user }], r.maxTokens);
}

/** What a dry run returns: a rough draft built from Tom's own sentences, so every screen can be tried for free. */
function dryRunReply(i: DraftInput): DraftReply {
  const sentences = i.telling
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const groups: string[][] = [];
  for (let k = 0; k < sentences.length && groups.length < 12; k += 2) groups.push(sentences.slice(k, k + 2));
  if (!groups.length) groups.push(["(dry run) Nothing told yet."]);
  const prevBlanks = i.prev?.draft.blanks ?? [];
  const answered = prevBlanks.filter((b) => b.answer?.trim());
  const beats = groups.map((g, n) => ({ id: `s${n + 1}`, heading: `Beat ${n + 1} (dry run)`, text: g.join(" ") }));
  const blanks: Omit<Blank, "answer">[] = [];
  if (!answered.some((b) => b.id === "b1")) {
    beats[0].text += " The reason is [[b1]].";
    blanks.push({ id: "b1", beat_id: "s1", question: "(dry run) Why does this start today?", kind: "plot", guess: "a placeholder reason", options: ["Option A", "Option B"] });
  }
  if (answered.length) beats[beats.length - 1].text += ` (Answers written in: ${answered.map((b) => b.answer).join("; ")}.)`;
  beats[Math.min(1, beats.length - 1)].text += " It is [[b2]].";
  blanks.push({ id: "b2", beat_id: beats[Math.min(1, beats.length - 1)].id, question: "(dry run) What time of day is it?", kind: "detail", guess: "late evening", options: ["late evening", "midday"] });
  const lead = i.quickstart.lead.split(/[,.]/)[0]?.trim() || "The lead";
  const spine = Object.fromEntries(QUESTIONS.map((q) => [q.key, ""])) as Record<QuestionKey, string>;
  spine.lead = lead;
  return {
    synopsis: i.quickstart.about || "(dry run) What this story is about.",
    beats,
    blanks: blanks as Blank[],
    portfolio: {
      characters: [{ name: lead, role: "lead", facts: [{ text: i.quickstart.backstory || "(dry run) backstory", from: "quick start", guessed: false }] }],
      places: i.quickstart.setting ? [{ name: i.quickstart.setting, role: "", facts: [{ text: "Where the story is set", from: "quick start", guessed: false }] }] : [],
      objects: [],
      mysteries: [{ text: "(dry run) An open question the story raises", from: "telling" }],
    },
    health: {
      spine,
      one_line: `${lead} wants something because of today, but a flaw gets in the way, so it ends somewhere new. (dry run)`,
      one_line_passes: false,
      notes: [{ level: "weak", text: "Dry run: switch dry-run off in Settings for Claude's real read." }],
      panels_estimate: beats.length * 2,
      episode_split: "",
    },
    changes: i.prev ? [`(dry run) Would apply: ${i.change || "your answers"}`] : [],
  };
}

export type DraftResult = { ok: true; reply: DraftReply; note: string; ledgerId: string } | { ok: false; reason: string };

export async function runDraft(supabase: SupabaseClient, i: DraftInput): Promise<DraftResult> {
  const req = buildDraftRequest(i);
  const r = await aiClaude({
    supabase,
    projectId: i.project.id,
    purpose: req.purpose,
    role: "story",
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    maxTokens: req.maxTokens,
    effort: req.effort,
    schema: req.schema,
    dryRunText: JSON.stringify(toRaw(dryRunReply(i))),
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.truncated) return { ok: false, reason: "Claude's answer was cut off (too long). Try a shorter telling, or split it into two episodes." };
  let reply: DraftReply;
  try {
    reply = toReply(JSON.parse(r.text) as RawReply);
  } catch {
    return { ok: false, reason: "Claude's answer couldn't be read. Please try again (the cost was logged)." };
  }
  if (!Array.isArray(reply.beats) || !reply.beats.length) return { ok: false, reason: "Claude returned an empty draft. Please try again." };
  const cost = r.dryRun ? "dry run, $0" : r.costUsd < 0.01 ? `$${r.costUsd.toFixed(4)}` : `$${r.costUsd.toFixed(2)}`;
  const warn = r.warn ? `; you've used ${r.percent}% of a limit` : "";
  return { ok: true, reply, note: `${cost}${warn}`, ledgerId: r.ledgerId };
}
