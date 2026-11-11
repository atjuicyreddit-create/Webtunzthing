import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiClaude, estimateClaudeUsd, type Effort } from "../ai/aiCall";
import type { StudioSettings } from "../settings";
import { SYSTEM, storyContext } from "../story/prompts";
import type { Story } from "../story/story";
import type { Episode } from "./types";
import { readingOrder } from "./warnings";
import { readerRouteText } from "../vote/route";

export type StructureAction = { kind: "draft" } | { kind: "reorder" };

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: unknown) => ({ type: "array", items });

const sceneSchema = obj({
  title: str,
  purpose: str,
  beat: str,
  characters: strArr,
  location: str,
  props_introduced: strArr,
  props_used: strArr,
  plants: strArr,
  payoffs: strArr,
  chain: str,
  chain_step: { type: "integer" },
  reader_choice: str,
});

export type DraftScene = {
  title: string;
  purpose: string;
  beat: string;
  characters: string[];
  location: string;
  props_introduced: string[];
  props_used: string[];
  plants: string[];
  payoffs: string[];
  chain: string;
  chain_step: number;
  reader_choice: string;
};
export type DraftStructure = {
  episodes: { title: string; summary: string; milestone: string; acts: { title: string; scenes: DraftScene[] }[] }[];
};
export type ReorderReply = {
  summary: string;
  episodes: { episode_id: string; acts: { act_id: string; scene_ids: string[] }[] }[];
  reasons: { scene_id: string; why: string }[];
};

function describeBoard(episodes: Episode[]): string {
  const lines: string[] = [];
  for (const e of episodes) {
    lines.push(`Episode ${e.number} [episode_id=${e.id}]: ${e.title}`);
    for (const a of e.acts) {
      lines.push(`  Act [act_id=${a.id}]: ${a.title || "(untitled)"}`);
      for (const s of a.scenes) {
        lines.push(
          `    Scene [scene_id=${s.id}] "${s.title}" — purpose: ${s.purpose ?? "none"}; beat: ${s.beat ?? ""}; ` +
            `introduces: ${s.props_introduced.join(", ") || "-"}; uses: ${s.props_used.join(", ") || "-"}; ` +
            `plants: ${s.plants.join(", ") || "-"}; pays off: ${s.payoffs.join(", ") || "-"}` +
            (s.chain ? `; step ${s.chain_step} of "${s.chain}"` : ""),
        );
      }
    }
  }
  return lines.join("\n");
}

function build(s: Story, episodes: Episode[], a: StructureAction) {
  const ctx = storyContext(s, { includeCharacters: true });
  const milestones = s.milestones.map((m, i) => `${i + 1}. ${m.title}${m.description ? ` — ${m.description}` : ""}`).join("\n");
  const plan = s.project.episodes_planned ?? (s.project.format === "serial" ? 3 : 1);
  const routes = episodes
    .filter((e) => e.reader_route?.route)
    .map((e) => `Episode ${e.number}: ${readerRouteText(e.reader_route)}`)
    .join("\n\n");

  if (a.kind === "draft") {
    return {
      purpose: "Structure: draft from the story",
      user: `${ctx}\n${milestones ? `\nMilestones:\n${milestones}\n` : ""}${s.project.destination ? `Destination: ${s.project.destination}\n` : ""}${routes ? `\nReader votes already decided (follow these):\n${routes}\n` : ""}
Draft the structure: ${plan} episode(s), each with 2 or 3 acts, each act with 2 to 4 scenes.
For every scene give: title, purpose (which spine point or milestone it serves, e.g. "Want", "Flaw", "Milestone 1"), beat (one line),
characters, location, props_introduced (props first shown here), props_used (props used here), plants (set-ups planted here),
payoffs (set-ups paid off here, using the SAME words as the plant), chain and chain_step for any real-world sequence
(e.g. chain "coffee", steps beans=1, grind=2, boil=3, brew=4; use "" and 0 when none), and reader_choice
(the vote question on the last scene of a serial episode, otherwise ""). For each episode give its milestone title ("" if none).
Keep real-world steps in order, introduce props before they're used, and pay off every plant.`,
      maxTokens: 24000,
      effort: "high" as Effort,
      schema: obj({
        episodes: arr(obj({ title: str, summary: str, milestone: str, acts: arr(obj({ title: str, scenes: arr(sceneSchema) })) })),
      }),
      dryRun: {
        episodes: [
          {
            title: "Episode 1 (dry run)",
            summary: "Placeholder summary.",
            milestone: s.milestones[0]?.title ?? "",
            acts: [
              {
                title: "Setup",
                scenes: [
                  { title: "Hook", purpose: "Want", beat: "The lead wants something.", characters: [], location: "Home", props_introduced: ["note"], props_used: [], plants: ["the jar"], payoffs: [], chain: "", chain_step: 0, reader_choice: "" },
                  { title: "Grind", purpose: "Flaw", beat: "Step two happens first (deliberate test).", characters: [], location: "Kitchen", props_introduced: [], props_used: ["grinder"], plants: [], payoffs: [], chain: "coffee", chain_step: 2, reader_choice: "" },
                ],
              },
              {
                title: "Payoff",
                scenes: [
                  { title: "Beans", purpose: "", beat: "Step one (out of order on purpose).", characters: [], location: "Kitchen", props_introduced: ["grinder"], props_used: [], plants: [], payoffs: [], chain: "coffee", chain_step: 1, reader_choice: "" },
                  { title: "Button", purpose: "Ending", beat: "It backfires.", characters: [], location: "Kitchen", props_introduced: [], props_used: ["note"], plants: [], payoffs: [], chain: "", chain_step: 0, reader_choice: "What does the lead do next?" },
                ],
              },
            ],
          },
        ],
      },
    };
  }

  const order = readingOrder(episodes);
  const first = episodes.find((e) => e.acts.some((x) => x.scenes.length > 1));
  const dryEpisodes = episodes.map((e) => ({
    episode_id: e.id,
    acts: e.acts.map((x) => {
      const ids = x.scenes.map((sc) => sc.id);
      if (e.id === first?.id && x.scenes.length > 1 && x.id === first.acts.find((y) => y.scenes.length > 1)?.id) {
        [ids[0], ids[1]] = [ids[1], ids[0]];
      }
      return { act_id: x.id, scene_ids: ids };
    }),
  }));
  return {
    purpose: "Structure: suggest a reorder",
    user: `${ctx}\n\nCurrent structure (reading order):\n${describeBoard(episodes)}\n
Suggest a better order of scenes. You may move scenes between acts WITHIN the same episode, but keep every scene,
every act and every episode exactly once, and don't move scenes between episodes. Fix real-world step order, props used
before they're introduced, payoffs before their plants, and pacing. If the order is already right, return it unchanged.
Return the full order using the ids exactly as given, a one-paragraph summary, and a one-line reason for each scene you moved.`,
    maxTokens: 16000,
    effort: "high" as Effort,
    schema: obj({
      summary: str,
      episodes: arr(obj({ episode_id: str, acts: arr(obj({ act_id: str, scene_ids: strArr })) })),
      reasons: arr(obj({ scene_id: str, why: str })),
    }),
    dryRun: {
      summary: `Placeholder reorder (dry run): swaps the first two scenes of one act. ${order.length} scenes considered.`,
      episodes: dryEpisodes,
      reasons: first ? [{ scene_id: first.acts.find((y) => y.scenes.length > 1)!.scenes[0].id, why: "Placeholder reason (dry run)." }] : [],
    },
  };
}

export function estimateStructureAction(settings: StudioSettings | null, s: Story, episodes: Episode[], a: StructureAction) {
  if (!settings) return null;
  const req = build(s, episodes, a);
  return estimateClaudeUsd(settings, settings.models.story, SYSTEM, [{ role: "user", content: req.user }], req.maxTokens);
}

export async function runStructureAction<T>(
  supabase: SupabaseClient,
  s: Story,
  episodes: Episode[],
  a: StructureAction,
): Promise<{ ok: true; data: T; note: string } | { ok: false; reason: string }> {
  const req = build(s, episodes, a);
  const r = await aiClaude({
    supabase,
    projectId: s.project.id,
    purpose: req.purpose,
    role: "story",
    system: SYSTEM,
    messages: [{ role: "user", content: req.user }],
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
