import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiClaude, estimateClaudeUsd, type Effort } from "../ai/aiCall";
import { activeLessons } from "../lessons/lessons";
import type { StudioSettings } from "../settings";
import { SYSTEM, storyContext } from "../story/prompts";
import type { Story } from "../story/story";
import type { Episode } from "../structure/types";
import { readerRouteText } from "../vote/route";
import { CHECKS, type Fork, type Prop, type ScriptPanel } from "./types";

export type ScriptAction = { kind: "draft" } | { kind: "check" };

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

export type DraftScript = {
  panels: {
    title: string;
    shot: string;
    camera: string;
    characters: string[];
    action: string;
    caption: string;
    dialogue: { speaker: string; line: string }[];
    size: "small" | "mid" | "tall";
    gap_after: number;
    props: { name: string; location: string; state: string }[];
    clock: string;
    matches_panel: number;
    text_items: { text: string; how: "lettered" | "model" }[];
    notes?: string;
  }[];
  prop_table: { name: string; owner: string; rule: string }[];
  fork: { question: string; in_bounds: string; locked: string; backup_pick: string; branches: { title: string; summary: string; rejoins: string }[] };
};

function characterLocks(s: Story): string {
  return s.characters
    .map(
      (c) =>
        `- ${c.name} (${c.role}): voice ${c.sheet.voice ?? "?"}; always wears ${c.sheet.costume_always ?? "?"}; never wears ${c.sheet.costume_never ?? "?"}; guardrails: ${(c.sheet.guardrails ?? []).join("; ") || "none"}`,
    )
    .join("\n");
}

function scriptText(panels: ScriptPanel[], fork: Fork | null, props: Prop[], serial: boolean): string {
  const keyNum = new Map(panels.map((p, i) => [p.panel_key, i + 1]));
  const lines = panels.map((p, i) => {
    const d = p.dialogue.map((x) => `${x.speaker}: "${x.line}"`).join(" ");
    return [
      `Panel ${i + 1}: ${p.title} (${p.size}, gap after ${p.gap_after}px)`,
      `  Visual: ${[p.shot, p.camera].filter(Boolean).join(", ")}${p.shot || p.camera ? ". " : ""}${p.action ?? ""}`,
      p.characters.length ? `  Characters: ${p.characters.join(", ")}` : null,
      p.caption ? `  Caption: ${p.caption}` : null,
      d ? `  Dialogue: ${d}` : null,
      p.props.length ? `  Props: ${p.props.map((x) => [x.name, x.location, x.state].filter(Boolean).join(" / ")).join("; ")}` : null,
      p.clock ? `  Clock: ${p.clock}` : null,
      p.matches_key ? `  Matches panel ${keyNum.get(p.matches_key) ?? "?"}` : null,
      p.text_items.length ? `  Text in art: ${p.text_items.map((t) => `${t.text} (${t.how})`).join("; ")}` : null,
      p.notes ? `  Notes: ${p.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const propTable = props.length ? `\nProp table:\n${props.map((p) => `- ${p.name}: owner ${p.owner ?? "?"}; ${p.rule ?? ""}`).join("\n")}` : "";
  const end = serial
    ? `\nEnd card (vote): question: ${fork?.question ?? "—"}; in bounds: ${fork?.in_bounds ?? "—"}; locked: ${fork?.locked ?? "—"}; backup pick: ${fork?.backup_pick ?? "—"}; branches: ${(fork?.branches ?? []).map((b) => `${b.title} (rejoins ${b.rejoins})`).join("; ") || "—"}`
    : "";
  return lines.join("\n") + propTable + end;
}

function build(
  s: Story,
  episode: Episode,
  a: ScriptAction,
  current: { panels: ScriptPanel[]; fork: Fork | null; props: Prop[] },
) {
  const serial = s.project.format === "serial";
  const ctx = storyContext(s, { includeCharacters: true });
  const scenes = episode.acts
    .flatMap((x) => x.scenes.map((sc) => `- [${x.title}] ${sc.title}: ${sc.beat ?? ""} (purpose: ${sc.purpose ?? "?"}; props introduced: ${sc.props_introduced.join(", ") || "-"}; used: ${sc.props_used.join(", ") || "-"}${sc.chain ? `; step ${sc.chain_step} of ${sc.chain}` : ""}${sc.reader_choice ? `; vote: ${sc.reader_choice}` : ""})`))
    .join("\n");
  const milestone = s.milestones.find((m) => m.id === episode.milestone_id);
  const route = readerRouteText(episode.reader_route);

  if (a.kind === "draft") {
    return {
      purpose: `Script: draft episode ${episode.number}`,
      user: `${ctx}\n\nCharacter locks and voice guardrails:\n${characterLocks(s)}\n\nEpisode ${episode.number}: ${episode.title}${episode.summary ? ` — ${episode.summary}` : ""}${milestone ? `\nMilestone this episode reaches: ${milestone.title}` : ""}${route ? `\n\n${route}\n` : ""}\nScenes, in order:\n${scenes || "(no scenes yet: invent a tight structure from the story)"}\n
Write the script panel by panel, in the Morning Brew format. For each panel: title; shot (e.g. "exterior, establishing" or "close-up"); camera; characters in it;
action (the visual, specific enough to draw); caption (7 words or fewer, only what the picture can't show, "" if none); dialogue (within each character's voice guardrails);
size (small, mid or tall); gap_after in px at 800 wide (150-300 same scene, 500-800 scene jump, 1000+ before the punchline); props in the panel with location and state;
clock time if a clock is visible (e.g. "6:43", "" if none); matches_panel (the number of an EARLIER panel whose camera this repeats, 0 if none);
text_items: every piece of text in the art, marked "lettered" (added in code) or "model" (only short prop labels may be drawn by the image model);
notes: start with the render-risk tag "Risk: low|medium|high · Takes: N" (about 2 takes a panel; a size change is high with 4 to 6), then any staging notes.
Follow section 7 of the guidelines (comic production): one complex physical action per panel, a close-up or callout for any label over 4 words,
never describe anything as "X-shaped", name exactly which limb pokes through a window or door, and keep one camera side when something moves inside to outside.
No sound effects. Real-world steps in order. Plant before payoff. Hook in panel 1, a big gap before the twist, a button at the end.
Also give a prop table (name, owner, rule) for every story prop${serial ? `, and the vote end card: a scoped question, what's in bounds, what's locked, a backup pick (used if there are too few comments), and 2 or 3 branches, each with the milestone it rejoins` : ` (fork: leave every field empty and branches empty)`}.`,
      maxTokens: 32000,
      effort: "high" as Effort,
      schema: obj({
        panels: arr(
          obj({
            title: str,
            shot: str,
            camera: str,
            characters: strArr,
            action: str,
            caption: str,
            dialogue: arr(obj({ speaker: str, line: str })),
            size: { type: "string", enum: ["small", "mid", "tall"] },
            gap_after: { type: "integer" },
            props: arr(obj({ name: str, location: str, state: str })),
            clock: str,
            matches_panel: { type: "integer" },
            text_items: arr(obj({ text: str, how: { type: "string", enum: ["lettered", "model"] } })),
            notes: str,
          }),
        ),
        prop_table: arr(obj({ name: str, owner: str, rule: str })),
        fork: obj({ question: str, in_bounds: str, locked: str, backup_pick: str, branches: arr(obj({ title: str, summary: str, rejoins: str })) }),
      }),
      dryRun: {
        panels: [
          { title: "Hook (dry run)", shot: "exterior, establishing", camera: "wide", characters: [], action: "A placeholder opening image.", caption: "Somewhere. Far too early.", dialogue: [], size: "tall", gap_after: 250, props: [], clock: "", matches_panel: 0, text_items: [{ text: "Somewhere. Far too early.", how: "lettered" }], notes: "Risk: low · Takes: 2" },
          { title: "Setup (dry run)", shot: "interior", camera: "mid", characters: s.characters[0] ? [s.characters[0].name] : [], action: "The lead sees the deadline.", caption: "This caption is deliberately far too long for the rule.", dialogue: [], size: "mid", gap_after: 250, props: [{ name: "note", location: "door", state: "pinned" }], clock: "6:40", matches_panel: 0, text_items: [], notes: "Risk: medium · Takes: 2" },
          { title: "Button (dry run)", shot: "exterior", camera: "wide", characters: [], action: "Same angle as panel 1, later.", caption: "", dialogue: [], size: "tall", gap_after: 0, props: [], clock: "6:30", matches_panel: 1, text_items: [], notes: "" },
        ],
        prop_table: [{ name: "note", owner: "Placeholder", rule: "Pinned to the door (dry run)." }],
        fork: serial
          ? { question: "What happens next? (dry run)", in_bounds: "Anything at home.", locked: "The destination.", backup_pick: "", branches: [{ title: "Branch A", summary: "Placeholder.", rejoins: "Milestone 1" }] }
          : { question: "", in_bounds: "", locked: "", backup_pick: "", branches: [] },
      },
    };
  }

  return {
    purpose: `Script: check episode ${episode.number}`,
    user: `${ctx}\n\nCharacter locks and voice guardrails:\n${characterLocks(s)}\n\nSCRIPT, episode ${episode.number} (${serial ? "serial" : "one-off"}):\n${scriptText(current.panels, current.fork, current.props, serial)}\n${route ? `\n${route}\n(Also check the script follows this reader choice; report it under the closest check key.)\n` : ""}
Run the script check. For EACH of these keys give pass, fail or na (na only when it truly doesn't apply, e.g. "vote" for a one-off), the panel numbers involved,
and a one-line note saying exactly what's wrong and where, or why it passes. Do NOT rewrite the script and do not suggest that you'll fix it; Tom decides.
${CHECKS.map((c) => `- ${c.key}: ${c.label}`).join("\n")}
Finish with a two-sentence summary.`,
    // Medium effort: at "high" a 15-panel check spent 13-16K tokens mostly thinking and was cut off once
    // (charged in full). The checklist answer itself is short.
    maxTokens: 24000,
    effort: "medium" as Effort,
    schema: obj({
      summary: str,
      items: arr(obj({ key: { type: "string", enum: CHECKS.map((c) => c.key) }, status: { type: "string", enum: ["pass", "fail", "na"] }, panels: { type: "array", items: { type: "integer" } }, note: str })),
    }),
    dryRun: {
      summary: "Placeholder check (dry run). Switch dry-run off for a real check.",
      items: CHECKS.map((c, i) => ({ key: c.key, status: i === 0 ? "fail" : c.key === "vote" && !serial ? "na" : "pass", panels: i === 0 ? [1, 2] : [], note: i === 0 ? "Placeholder failure to show how fails look (dry run)." : "Placeholder (dry run)." })),
    },
  };
}

type Current = { panels: ScriptPanel[]; fork: Fork | null; props: Prop[] };

export function estimateScriptAction(settings: StudioSettings | null, s: Story, ep: Episode, a: ScriptAction, cur: Current) {
  if (!settings) return null;
  const req = build(s, ep, a, cur);
  return estimateClaudeUsd(settings, settings.models.story, SYSTEM, [{ role: "user", content: req.user }], req.maxTokens);
}

export async function runScriptAction<T>(
  supabase: SupabaseClient,
  s: Story,
  ep: Episode,
  a: ScriptAction,
  cur: Current,
): Promise<{ ok: true; data: T; note: string } | { ok: false; reason: string }> {
  const req = build(s, ep, a, cur);
  // Approved, active writing lessons go into the script check and the draft.
  const lessons = await activeLessons(supabase, "writing", s.project.id, s.characters.map((c) => c.name));
  const user = lessons.length ? `${req.user}\n\nACTIVE WRITING LESSONS (also check against these):\n${lessons.map((l) => `- ${l.lesson}`).join("\n")}` : req.user;
  const r = await aiClaude({
    supabase,
    projectId: s.project.id,
    episodeId: ep.id,
    purpose: req.purpose,
    role: "story",
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    maxTokens: req.maxTokens,
    effort: req.effort,
    schema: req.schema,
    dryRunText: JSON.stringify(req.dryRun),
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.truncated) return { ok: false, reason: "Claude's answer was cut off (too long). Please try again." };
  try {
    const data = JSON.parse(r.text) as T;
    const cost = r.dryRun ? "dry run, $0" : r.costUsd < 0.01 ? `$${r.costUsd.toFixed(4)}` : `$${r.costUsd.toFixed(2)}`;
    return { ok: true, data, note: `${cost}.${r.warn ? ` You've used ${r.percent}% of a limit.` : ""}` };
  } catch {
    return { ok: false, reason: "Claude's answer couldn't be read. Please try again (the cost was logged)." };
  }
}
