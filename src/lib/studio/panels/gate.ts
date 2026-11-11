import "server-only";
import { createHash } from "node:crypto";
import { layoutHash } from "./letter";
import type { PanelContext } from "./panels";
import { scriptHash } from "./prompt";

export type PanelState = {
  chosen: boolean;
  oldScript: boolean;
  lettered: boolean; // lettered from the chosen image with the current layout and script text
  letterStale: boolean; // lettered once, but something changed since
};

export function panelState(pc: PanelContext, key: string): PanelState {
  const p = pc.panels.find((x) => x.panel_key === key);
  const row = pc.rows.get(key);
  const take = row?.chosen_take_id ? pc.takes.find((x) => x.id === row.chosen_take_id) : null;
  const current = Boolean(p && take && row?.lettered_path && row.lettered_take_id === take.id && row.lettered_hash === layoutHash(row.letter_layout ?? [], p, take.id));
  return {
    chosen: Boolean(take),
    oldScript: Boolean(p && take?.script_hash && take.script_hash !== scriptHash(p)),
    lettered: current,
    letterStale: Boolean(row?.lettered_path) && !current,
  };
}

/** What the Panels approved gate signs off, and what still blocks it. */
export function panelsFingerprint(pc: PanelContext): { fp: string; problems: string[] } {
  const problems: string[] = [];
  const body = pc.panels.map((p, i) => {
    const s = panelState(pc, p.panel_key);
    const row = pc.rows.get(p.panel_key);
    if (!s.chosen) problems.push(`panel ${i + 1} has no chosen image`);
    else {
      if (s.oldScript) problems.push(`panel ${i + 1}'s image was drawn from an older script`);
      if (!s.lettered) problems.push(`panel ${i + 1} needs lettering${s.letterStale ? " again" : ""}`);
    }
    return { k: p.panel_key, t: row?.chosen_take_id ?? null, l: row?.lettered_hash ?? null };
  });
  return { fp: createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32), problems };
}
