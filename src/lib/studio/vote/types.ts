// Shared by server and browser (no server-only imports).

export type Verdict = "pass" | "near" | "veto";
export const BREAKS = ["in_bounds", "locked", "guardrail", "world_rule", "house_rule", "destination", "instructs_checker"] as const;
export type Break = (typeof BREAKS)[number];
export const BREAK_LABEL: Record<Break, string> = {
  in_bounds: "Out of bounds",
  locked: "Breaks a locked line",
  guardrail: "Breaks a character guardrail",
  world_rule: "Breaks a world rule",
  house_rule: "Breaks a house rule",
  destination: "Changes the destination",
  instructs_checker: "Tries to instruct the checker",
};

/** A live comment, read from the public `comments` table (never written). */
export type LiveComment = { id: string; author_name: string | null; body: string; created_at: string };

export type SkipReason = "empty" | "duplicate" | "over_cap";
export type Flag = "short" | "link";

export type Prepared = LiveComment & { skipped: SkipReason | null; flags: Flag[]; n: number | null };

export type ForkSnapshot = {
  question: string;
  in_bounds: string;
  locked: string;
  backup_pick: string;
  branches: { title: string; summary: string; rejoins: string }[];
};

export type Decision = {
  kind: "comment" | "backup";
  vote_comment_id?: string;
  route: string;
  you_chose: string;
  credit: string | null;
  branch: string;
  rejoins: string;
  override_note?: string;
};

export type Round = {
  id: string;
  episode_id: string;
  source_episode_id: string | null;
  status: "screened" | "decided";
  fork_snapshot: ForkSnapshot;
  summary: string | null;
  screened_at: string;
  decision: Decision | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
};

export type VoteComment = {
  id: string;
  round_id: string;
  comment_id: string | null;
  author_name: string | null;
  body: string;
  posted_at: string | null;
  skipped_reason: SkipReason | null;
  flags: Flag[];
  verdict: Verdict | null;
  reason: string | null;
  breaks: Break[];
  adjusted: string | null;
  label: string | null;
  branch: string | null;
  unsafe: boolean;
  suggested_rank: number | null;
  tom_adjusted: string | null;
  tom_label: string | null;
  tom_branch: string | null;
};

export const ROUND_COLS = "id,episode_id,source_episode_id,status,fork_snapshot,summary,screened_at,decision,decided_by,decided_at,note";
export const VOTE_COMMENT_COLS =
  "id,round_id,comment_id,author_name,body,posted_at,skipped_reason,flags,verdict,reason,breaks,adjusted,label,branch,unsafe,suggested_rank,tom_adjusted,tom_label,tom_branch";

export type ReaderRoute = {
  route: string;
  you_chose: string;
  credit: string | null;
  branch: string;
  rejoins: string;
  round_id: string;
  from_episode: number;
  decided_at: string;
};

export const NONE_FITS = "none fits";
