import type { Episode, Scene, Warning } from "./types";

// Live checks over the reading order (episode, then act, then scene). Pure functions,
// so the board can re-run them instantly while you drag.

const norm = (s: string) => s.trim().toLowerCase();

export function readingOrder(episodes: Episode[]): Scene[] {
  return [...episodes]
    .sort((a, b) => a.number - b.number)
    .flatMap((e) => [...e.acts].sort((a, b) => a.position - b.position).flatMap((a) => a.scenes));
}

export function sceneLabel(episodes: Episode[], sceneId: string): string {
  for (const e of episodes) {
    for (const a of e.acts) {
      const i = a.scenes.findIndex((s) => s.id === sceneId);
      if (i !== -1) return `Ep ${e.number}${a.title ? ` · ${a.title}` : ""} · scene ${i + 1}`;
    }
  }
  return "a scene";
}

export function structureWarnings(episodes: Episode[]): Warning[] {
  const order = readingOrder(episodes);
  const out: Warning[] = [];
  const introduced = new Set<string>();
  const chainLast = new Map<string, { step: number; title: string }>();

  // 1. props used before they're introduced; 2. real-world steps out of order; 5. no purpose
  for (const s of order) {
    const name = s.title || "Untitled scene";
    for (const p of s.props_introduced) introduced.add(norm(p));
    for (const p of s.props_used) {
      if (p.trim() && !introduced.has(norm(p))) {
        out.push({
          kind: "prop_before_intro",
          sceneId: s.id,
          message: `“${p}” is used in “${name}” before it's introduced.`,
        });
      }
    }
    if (s.chain?.trim() && s.chain_step !== null && s.chain_step !== undefined) {
      const key = norm(s.chain);
      const last = chainLast.get(key);
      if (last && s.chain_step < last.step) {
        out.push({
          kind: "steps_out_of_order",
          sceneId: s.id,
          message: `“${s.chain}” step ${s.chain_step} in “${name}” comes after step ${last.step} in “${last.title}”.`,
        });
      }
      if (!last || s.chain_step >= last.step) chainLast.set(key, { step: s.chain_step, title: name });
    }
    if (!s.purpose?.trim()) {
      out.push({ kind: "no_purpose", sceneId: s.id, message: `“${name}” has no purpose (which spine point or milestone it serves).` });
    }
  }

  // 3. plants with no later payoff; 4. payoffs with no earlier plant
  order.forEach((s, i) => {
    const name = s.title || "Untitled scene";
    for (const p of s.plants) {
      if (!p.trim()) continue;
      const paid = order.slice(i + 1).some((t) => t.payoffs.some((x) => norm(x) === norm(p)));
      if (!paid) out.push({ kind: "plant_no_payoff", sceneId: s.id, message: `The plant “${p}” in “${name}” is never paid off.` });
    }
    for (const p of s.payoffs) {
      if (!p.trim()) continue;
      const planted = order.slice(0, i).some((t) => t.plants.some((x) => norm(x) === norm(p)));
      if (!planted) out.push({ kind: "payoff_no_plant", sceneId: s.id, message: `The payoff “${p}” in “${name}” has no earlier plant.` });
    }
  });

  return out;
}
