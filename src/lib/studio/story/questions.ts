// The story builder's question cards, in the spine order from the brief and
// STORY-GUIDELINES.md section 1. "affects" drives the "this change affects…" note.

export type QuestionKey =
  | "lead"
  | "want"
  | "why_today"
  | "obstacle"
  | "flaw"
  | "need"
  | "stakes"
  | "ending"
  | "world_rules";

export type Question = {
  key: QuestionKey;
  title: string;
  help: string;
  affects: string[];
};

export const QUESTIONS: Question[] = [
  {
    key: "lead",
    title: "Who's the lead, and what's odd about them?",
    help: "Within two panels the reader should know who the lead is and what's odd about them.",
    affects: ["Want", "Flaw", "Character sheets"],
  },
  {
    key: "want",
    title: "What does the lead want?",
    help: "One concrete thing the reader can see on the page.",
    affects: ["Why today", "Ending", "One-line test"],
  },
  {
    key: "why_today",
    title: "Why do they want it today?",
    help: "A deadline, a stake or a promise the reader can see.",
    affects: ["Stakes", "One-line test"],
  },
  {
    key: "obstacle",
    title: "What stands in the way?",
    help: "It should come from the world or from the lead's own flaw.",
    affects: ["Ending", "Structure"],
  },
  {
    key: "flaw",
    title: "What one trait causes the trouble?",
    help: "Lazy, greedy, proud, sleepy… The ending should come out of this trait.",
    affects: ["Ending", "One-line test", "Character sheets", "Milestones"],
  },
  {
    key: "need",
    title: "What do they actually need, versus what they want?",
    help: "The want is what they chase; the need is what would really fix them.",
    affects: ["Ending", "Destination", "Milestones"],
  },
  {
    key: "stakes",
    title: "What happens if they fail?",
    help: "Something the reader can picture and care about.",
    affects: ["Ending"],
  },
  {
    key: "ending",
    title: "How does it end?",
    help: "The flaw causes it, never luck: the win backfires, or the miss is better or worse.",
    affects: ["One-line test", "Destination"],
  },
  {
    key: "world_rules",
    title: "What are the world's rules?",
    help: "How the magic or tech works, whose things are where, and what can never happen.",
    affects: ["Why? pass", "Character sheets"],
  },
];

export const QUESTION_KEYS = QUESTIONS.map((q) => q.key);

export function questionByKey(key: string): Question | undefined {
  return QUESTIONS.find((q) => q.key === key);
}

export const STORY_STEPS = [
  { key: "cards", label: "Questions" },
  { key: "why", label: "Why? pass" },
  { key: "oneline", label: "One-line test" },
  { key: "characters", label: "Characters" },
  { key: "plot", label: "Season plot" },
  { key: "approve", label: "Approve" },
] as const;
export type StoryStep = (typeof STORY_STEPS)[number]["key"];
