// Shared by server and browser (no server-only imports).

export type AssetKind = "character" | "location" | "prop";
export type AssetStatus = "needs_design" | "picked" | "not_needed";
export type Aspect = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export const ASPECTS: Aspect[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];

export type Asset = {
  id: string;
  project_id: string;
  kind: AssetKind;
  scope: "series" | "act";
  act_id: string | null;
  character_id: string | null;
  name: string;
  description: string | null;
  prompt: string;
  aspect: Aspect;
  status: AssetStatus;
  picked_take_id: string | null;
  reference_path: string | null;
  /** episode id -> panel numbers where it appears, from the final scripts. */
  uses: Record<string, number[]>;
  updated_at: string;
};

export type TakeStatus = "pending" | "ready" | "failed" | "dry_run";

export type Take = {
  id: string;
  asset_id: string | null;
  episode_id: string | null;
  kind: "exploration" | "final" | "imported";
  status: TakeStatus;
  prompt: string;
  model: string | null;
  size: string | null;
  aspect: string | null;
  cost_usd: number;
  storage_path: string | null;
  comment: string | null;
  error: string | null;
  job_id: string | null;
  created_at: string;
};

export const ASSET_COLS =
  "id,project_id,kind,scope,act_id,character_id,name,description,prompt,aspect,status,picked_take_id,reference_path,uses,updated_at";
export const TAKE_COLS = "id,asset_id,episode_id,kind,status,prompt,model,size,aspect,cost_usd,storage_path,comment,error,job_id,created_at";

export const KIND_LABEL: Record<AssetKind, string> = { character: "Character", location: "Location", prop: "Prop" };
export const DEFAULT_ASPECT: Record<AssetKind, Aspect> = { character: "3:4", location: "16:9", prop: "1:1" };
