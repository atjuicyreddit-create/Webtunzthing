// Shared by server and browser (no server-only imports).

export type Scene = {
  id: string;
  episode_id: string;
  act_id: string;
  position: number;
  title: string;
  purpose: string | null;
  beat: string | null;
  characters: string[];
  location: string | null;
  props_introduced: string[];
  props_used: string[];
  plants: string[];
  payoffs: string[];
  chain: string | null;
  chain_step: number | null;
  reader_choice: string | null;
};

export type Act = { id: string; episode_id: string; position: number; title: string; scenes: Scene[] };

export type Episode = {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  milestone_id: string | null;
  /** The reader vote that leads into this episode (Stage 8), if decided. */
  reader_route?: { route: string; you_chose: string; credit: string | null; branch: string; rejoins: string; round_id: string; from_episode: number; decided_at: string } | null;
  acts: Act[];
};

/** Board order sent to the server after a drag: each act's scene ids, top to bottom. */
export type BoardOrder = { actId: string; sceneIds: string[] }[];

export type Warning = {
  kind: "prop_before_intro" | "steps_out_of_order" | "plant_no_payoff" | "payoff_no_plant" | "no_purpose";
  sceneId: string;
  message: string;
};
