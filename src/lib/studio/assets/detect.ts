import type { Scene } from "../structure/types";
import type { Prop, ScriptPanel } from "../script/types";
import type { AssetKind } from "./types";

// Free, in code: which characters, locations and props the FINAL scripts need.
// Characters come from each panel's character list, props from each panel's props,
// locations from the structure board's scenes. Panel numbers are 1-based.

export type DetectedAsset = {
  kind: AssetKind;
  name: string;
  description: string;
  character_id: string | null;
  scope: "series" | "act";
  act_id: string | null;
  uses: Record<string, number[]>;
};

const key = (kind: AssetKind, name: string) => `${kind}:${name.trim().toLowerCase()}`;

export function detectAssets(input: {
  scripts: { episodeId: string; panels: ScriptPanel[] }[];
  characters: { id: string; name: string }[];
  props: Prop[];
  scenes: Scene[];
}): DetectedAsset[] {
  const out = new Map<string, DetectedAsset>();
  const cast = new Map(input.characters.map((c) => [c.name.trim().toLowerCase(), c]));
  const propInfo = new Map(input.props.map((p) => [p.name.trim().toLowerCase(), p]));

  const add = (kind: AssetKind, rawName: string, ep: string, panel: number | null, extra: Partial<DetectedAsset> = {}) => {
    const name = rawName.trim().slice(0, 80);
    if (!name) return;
    const k = key(kind, name);
    let a = out.get(k);
    if (!a) {
      a = {
        kind,
        name,
        description: "",
        character_id: null,
        scope: "series",
        act_id: null,
        uses: {},
        ...extra,
      };
      out.set(k, a);
    }
    const list = (a.uses[ep] ??= []);
    if (panel !== null && !list.includes(panel)) list.push(panel);
  };

  for (const s of input.scripts) {
    s.panels.forEach((p, i) => {
      for (const c of p.characters) {
        const sheet = cast.get(c.trim().toLowerCase());
        add("character", sheet?.name ?? c, s.episodeId, i + 1, { character_id: sheet?.id ?? null });
      }
      for (const pr of p.props) {
        const info = propInfo.get(pr.name.trim().toLowerCase());
        add("prop", info?.name ?? pr.name, s.episodeId, i + 1, {
          description: [info?.rule, info?.owner ? `Belongs to ${info.owner}.` : ""].filter(Boolean).join(" "),
        });
      }
    });
  }

  // Locations (and props first shown in a scene) come from the structure board, tied to that act.
  const scriptEpisodes = new Set(input.scripts.map((s) => s.episodeId));
  for (const sc of input.scenes) {
    if (!scriptEpisodes.has(sc.episode_id)) continue;
    if (sc.location?.trim()) add("location", sc.location, sc.episode_id, null, { scope: "act", act_id: sc.act_id });
    for (const pr of sc.props_introduced) {
      const k = key("prop", pr);
      if (out.has(k)) continue;
      const info = propInfo.get(pr.trim().toLowerCase());
      add("prop", info?.name ?? pr, sc.episode_id, null, { scope: "act", act_id: sc.act_id, description: info?.rule ?? "" });
    }
  }

  for (const a of out.values()) for (const ep of Object.keys(a.uses)) a.uses[ep].sort((x, y) => x - y);
  const order: Record<AssetKind, number> = { character: 0, location: 1, prop: 2 };
  return [...out.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}
