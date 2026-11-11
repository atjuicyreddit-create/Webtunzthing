import "server-only";
import type { Effort } from "../ai/aiCall";
import { HOUSE_RULES, STORY_GUIDELINES } from "./guidelines";
import { QUESTIONS, questionByKey, type QuestionKey } from "./questions";
import type { Story } from "./story";

// Every Claude request the story builder makes is built here, so the page can show the
// cost estimate for exactly the request the button will send.

export type StoryAction =
  | { kind: "loglines" }
  | { kind: "read_idea" }
  | { kind: "suggest"; key: QuestionKey }
  | { kind: "why_pass" }
  | { kind: "one_line" }
  | { kind: "characters" }
  | { kind: "plot" };

export type BuiltRequest = {
  purpose: string;
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
  schema: Record<string, unknown>;
  dryRun: unknown;
};

// Stable first (cached): role, guidelines, house rules. Changing material goes in `user`.
const SYSTEM = `You are the story editor inside Pathtoon Studio, helping Tom, a solo creator, turn an idea into a vertical-scroll comic.
Follow the story guidelines and house rules below exactly. They are the source of every question and check.
Write in British English. Be concrete, short and specific to this story; no generic advice.
Never invent real people, real brands or existing characters. Never suggest sound effects.
When you suggest options, make them genuinely different from each other.

=== STORY GUIDELINES ===
${STORY_GUIDELINES}

=== HOUSE RULES ===
${HOUSE_RULES}`;

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: unknown) => ({ type: "array", items });

function context(s: Story, opts: { includeCharacters?: boolean } = {}): string {
  const p = s.project;
  const lines = [
    `Working title: ${p.title}`,
    `Format: ${p.format === "serial" ? "serial (each episode ends on a scoped reader vote)" : "one-off"}`,
    p.idea ? `Idea: ${p.idea}` : null,
    p.tone ? `Tone: ${p.tone}` : null,
    p.audience ? `Audience: ${p.audience}` : null,
    p.episodes_planned ? `Planned length: ${p.episodes_planned} episode(s)` : null,
    p.logline ? `Chosen logline: ${p.logline}` : null,
  ].filter(Boolean);
  const answered = QUESTIONS.filter((q) => s.answers[q.key]?.answer?.trim());
  if (answered.length) {
    lines.push("", "Story answers so far:");
    for (const q of answered) lines.push(`- ${q.title} ${s.answers[q.key]!.answer}`);
  }
  const whys = s.whys.filter((w) => w.reason?.trim());
  if (whys.length) {
    lines.push("", "Reasons Tom has given:");
    for (const w of whys) lines.push(`- ${w.question} ${w.reason}`);
  }
  if (p.one_line) lines.push("", `One-line test: ${p.one_line}`);
  if (opts.includeCharacters && s.characters.length) {
    lines.push("", "Characters:");
    for (const c of s.characters) {
      lines.push(`- ${c.name} (${c.role}): want ${c.sheet.want ?? "?"}; flaw ${c.sheet.flaw ?? "?"}; voice ${c.sheet.voice ?? "?"}`);
    }
  }
  return lines.join("\n");
}

const DRY = "(dry run)";

export function buildRequest(s: Story, a: StoryAction): BuiltRequest {
  const ctx = context(s, { includeCharacters: a.kind === "plot" || a.kind === "why_pass" });

  switch (a.kind) {
    case "loglines":
      return {
        purpose: "Idea: three loglines",
        system: SYSTEM,
        user: `${ctx}\n\nWrite exactly three loglines for this idea, each one sentence that names the lead, the want and what goes wrong. Make them different takes. For each, add one line on why it works.`,
        maxTokens: 6000,
        effort: "medium",
        schema: obj({ loglines: arr(obj({ text: str, why: str })) }),
        dryRun: {
          loglines: [1, 2, 3].map((n) => ({
            text: `Example logline ${n} ${DRY}: a lead wants something today, but their flaw gets in the way.`,
            why: `Placeholder reason ${n}. Switch dry-run off for real suggestions.`,
          })),
        },
      };

    case "read_idea":
      return {
        purpose: "Story: read the idea for answers",
        system: SYSTEM,
        user: `${ctx}\n\nThese are the story builder's questions:\n${QUESTIONS.map((q) => `- ${q.key}: ${q.title}`).join("\n")}\n\nReturn an entry only for questions the idea or logline ALREADY answers clearly. Quote or tightly paraphrase what Tom wrote; don't invent. Skip anything you'd have to guess.`,
        maxTokens: 6000,
        effort: "medium",
        schema: obj({ answers: arr(obj({ key: { type: "string", enum: QUESTIONS.map((q) => q.key) }, answer: str })) }),
        dryRun: { answers: [{ key: "lead", answer: `The lead from the idea ${DRY}` }] },
      };

    case "suggest": {
      const q = questionByKey(a.key)!;
      return {
        purpose: `Story: suggest answers (${q.key})`,
        system: SYSTEM,
        user: `${ctx}\n\nQuestion: ${q.title}\nGuideline: ${q.help}\n\nSuggest 3 or 4 genuinely different answers that fit everything above. Each answer is one or two sentences. Add a one-line "why this works" for each.`,
        maxTokens: 6000,
        effort: "medium",
        schema: obj({ suggestions: arr(obj({ answer: str, why: str })) }),
        dryRun: {
          suggestions: [1, 2, 3].map((n) => ({
            answer: `Example answer ${n} to "${q.title}" ${DRY}`,
            why: `Placeholder reason ${n}.`,
          })),
        },
      };
    }

    case "why_pass":
      return {
        purpose: "Story: Why? pass",
        system: SYSTEM,
        user: `${ctx}\n\nGuideline 4b: every action and every object needs a reason to be there. List every action, object or bit of magic in this story that doesn't have a reason yet (up to 8). For each, give the item and the question to ask Tom, e.g. "Why are the potions in his kitchen?". If everything has a reason, return an empty list.`,
        maxTokens: 8000,
        effort: "high",
        schema: obj({ items: arr(obj({ item: str, question: str })) }),
        dryRun: {
          items: [
            { item: `an object in the story ${DRY}`, question: `Why is it there? ${DRY}` },
            { item: `the lead's main action ${DRY}`, question: `Why do they do it right now? ${DRY}` },
          ],
        },
      };

    case "one_line":
      return {
        purpose: s.project.one_line ? "Story: check the one-line test" : "Story: draft the one-line test",
        system: SYSTEM,
        user: `${ctx}\n\nThe one-line test: "[Lead] wants [X] because [why today], but [flaw] leads to [ending]."\n${
          s.project.one_line
            ? `Check Tom's sentence above as written. It passes only if it follows the pattern, reads cleanly, matches the answers, and the ending comes from the flaw, not luck. If it fails, list each problem in one short line and give an improved sentence. If it passes, return it unchanged.`
            : `Write the sentence from the answers, then check it the same way.`
        }`,
        maxTokens: 8000,
        effort: "high",
        schema: obj({ sentence: str, passes: { type: "boolean" }, problems: arr(str) }),
        dryRun: {
          sentence: s.project.one_line ?? `The lead wants X because of today's deadline, but their flaw leads to the ending ${DRY}.`,
          passes: true,
          problems: [],
        },
      };

    case "characters":
      return {
        purpose: "Story: draft character sheets",
        system: SYSTEM,
        user: `${ctx}\n\nDraft a character sheet for the lead and each other character the story needs (keep the cast small). For each: name, role, backstory, want, fear, flaw, voice, look (silhouette, 2 to 4 colours with hex codes, signature details), signature props, costume_always (what they always wear), costume_never (what they never wear), and guardrails (hard rules like "only says '…quack' or 'Ahh.'" or "never smiles"). Keep the existing names if any were given.`,
        maxTokens: 12000,
        effort: "high",
        schema: obj({
          characters: arr(
            obj({
              name: str,
              role: str,
              backstory: str,
              want: str,
              fear: str,
              flaw: str,
              voice: str,
              look: obj({ silhouette: str, colours: arr(obj({ name: str, hex: str })), signature: str }),
              props: arr(str),
              costume_always: str,
              costume_never: str,
              guardrails: arr(str),
            }),
          ),
        }),
        dryRun: {
          characters: [
            {
              name: `Lead ${DRY}`,
              role: "lead",
              backstory: "Placeholder backstory.",
              want: s.answers.want?.answer ?? "Placeholder want.",
              fear: "Placeholder fear.",
              flaw: s.answers.flaw?.answer ?? "Placeholder flaw.",
              voice: "Short lines.",
              look: { silhouette: "Round and small.", colours: [{ name: "Ink", hex: "#0E1016" }, { name: "Paper", hex: "#F3F0E8" }], signature: "A hat." },
              props: ["a mug"],
              costume_always: "a hat",
              costume_never: "shoes",
              guardrails: ["never shouts"],
            },
          ],
        },
      };

    case "plot":
      return {
        purpose: "Story: season plot and suggestions",
        system: SYSTEM,
        user: `${ctx}\n\n${
          s.project.format === "serial"
            ? `This is a serial. Give: a season summary (one short paragraph); a fixed destination (where the lead ends up by the season's end, which votes can never change); 3 to 5 ordered growth milestones (each a title and one line) so the flaw is never cured early; and 3 to 5 suggestions to strengthen the story (stakes, a missing setup, an unpaid plant, a weak ending, a cast member to cut), each with one line on why.`
            : `This is a one-off. Give: a summary (one short paragraph); leave destination empty and milestones empty; and 3 to 5 suggestions to strengthen the story (stakes, a missing setup, an unpaid plant, a weak ending, a cast member to cut), each with one line on why.`
        }`,
        maxTokens: 12000,
        effort: "high",
        schema: obj({
          season_summary: str,
          destination: str,
          milestones: arr(obj({ title: str, description: str })),
          suggestions: arr(obj({ text: str, why: str })),
        }),
        dryRun: {
          season_summary: `A placeholder season summary ${DRY}.`,
          destination: s.project.format === "serial" ? `Placeholder destination ${DRY}` : "",
          milestones:
            s.project.format === "serial"
              ? [1, 2, 3].map((n) => ({ title: `Milestone ${n} ${DRY}`, description: "Placeholder step." }))
              : [],
          suggestions: [
            { text: `Raise the stakes ${DRY}`, why: "Placeholder." },
            { text: `Plant the twist earlier ${DRY}`, why: "Placeholder." },
            { text: `Cut a character ${DRY}`, why: "Placeholder." },
          ],
        },
      };
  }
}
