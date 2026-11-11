import "server-only";
import { createHash } from "node:crypto";
import { SFX_RE } from "../script/checks";
import type { Prop, ScriptPanel } from "../script/types";
import type { Character, CharacterSheet } from "../story/story";
import type { Asset } from "../assets/types";
import type { Lesson } from "../lessons/lessons";

// Panel prompts, built from fixed blocks in the pipeline's order (PIPELINE-RULES 1.6):
// 1 style, 2 expression / eye direction, 3 action (cause -> effect) and shot, 4 character +
// costume lock (only characters in the panel), 5 setting, 6 props, 7 clock, 8 must not appear,
// 9 caption space. Then the matched-shot line, any fix instruction, and the active lessons.

export const PANEL_STYLE =
  "STYLE: clean bold-outline cartoon art for a vertical scroll comic. Simple, minimal background with soft flat shading and clean outlines, warm light, readable at phone size. Original art, not based on any existing character or brand.";

export type Block = { name: string; text: string };
export type BuiltPrompt = {
  prompt: string;
  blocks: Block[];
  refs: { label: string; path: string }[];
  lessons: { id: string; lesson: string }[];
  hash: string;
  missingRefs: string[];
};

const sentence = (s: string) => (s.trim() ? (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`) : "");
const visualRules = (sheet?: CharacterSheet | null) =>
  (sheet?.guardrails ?? []).filter((g) => !/["“”]|\bsays?\b|\bspeak|\bvoice|\bline/i.test(g));

export function costumeLock(name: string, sheet?: CharacterSheet | null): string {
  const look = sheet?.look ?? {};
  const colours = (look.colours ?? []).map((c) => `${c.name} ${c.hex}`).join(", ");
  return [
    `${name.toUpperCase()}:`,
    look.silhouette ? sentence(look.silhouette) : "",
    colours ? `Colours: ${colours}.` : "",
    look.signature ? `Signature details: ${sentence(look.signature)}` : "",
    sheet?.costume_always ? `COSTUME LOCK: always wears ${sentence(sheet.costume_always)}` : "",
    sheet?.costume_never ? `Never wears ${sentence(sheet.costume_never)}` : "",
    visualRules(sheet).length ? `Rules: ${visualRules(sheet).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const hasLock = (sheet?: CharacterSheet | null) => Boolean(sheet?.costume_always?.trim() || sheet?.costume_never?.trim());

/** What a take was drawn from. A different hash later means the script panel changed. */
export function scriptHash(p: ScriptPanel): string {
  const body = { a: p.action, c: p.characters, pr: p.props, s: p.shot, cam: p.camera, cl: p.clock, t: p.text_items, sz: p.size, m: p.matches_key, cap: p.caption, d: p.dialogue };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 24);
}

const mentions = (text: string, name: string) => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const short = name.trim().split(/\s+/).pop() ?? name;
  return [name.trim(), short.length >= 3 ? short : ""].filter(Boolean).some((f) => new RegExp(`\\b${esc(f)}\\b`, "i").test(text));
};

export function buildPanelPrompt(input: {
  panel: ScriptPanel;
  characters: Character[];
  props: Prop[];
  episodeAssets: Asset[];
  pickedPaths: Record<string, string | null>; // asset id -> picked image path
  direction: string | null;
  lessons: Lesson[];
  matched: { number: number; path: string | null } | null;
  fix: { path: string; change: string } | null;
}): BuiltPrompt {
  const p = input.panel;
  const inPanel = input.characters.filter((c) => p.characters.some((n) => n.trim().toLowerCase() === c.name.trim().toLowerCase()));
  const unknown = p.characters.filter((n) => !input.characters.some((c) => c.name.trim().toLowerCase() === n.trim().toLowerCase()));
  const refs: { label: string; path: string }[] = [];
  const missingRefs: string[] = [];

  // References, in order: the image being fixed, then the matched panel, then characters, setting, props.
  if (input.fix) refs.push({ label: "The image being fixed", path: input.fix.path });
  if (input.matched?.path) refs.push({ label: `Panel ${input.matched.number} (camera to match)`, path: input.matched.path });
  else if (input.matched) missingRefs.push(`Panel ${input.matched.number} has no chosen image yet, so the camera can't be matched.`);
  const charAssets = input.episodeAssets.filter((a) => a.kind === "character");
  for (const c of inPanel) {
    const a = charAssets.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    const path = a ? input.pickedPaths[a.id] : null;
    if (path) refs.push({ label: `${c.name} design`, path });
    else if (a?.status !== "not_needed") missingRefs.push(`${c.name} has no picked design, so no reference is sent.`);
  }
  const locations = input.episodeAssets.filter((a) => a.kind === "location" && input.pickedPaths[a.id]);
  const placeText = `${p.shot ?? ""} ${p.action ?? ""} ${p.title}`;
  // A named location wins. Otherwise the only location is assumed, unless the shot is outside (an exterior
  // panel must not get the kitchen as its reference).
  const outside = /\b(exterior|outside|outdoors)\b/i.test(placeText);
  const setting = locations.find((l) => mentions(placeText, l.name)) ?? (locations.length === 1 && !outside ? locations[0] : null);
  if (setting) refs.push({ label: `${setting.name} (setting)`, path: input.pickedPaths[setting.id]! });
  const propAssets = input.episodeAssets.filter((a) => a.kind === "prop" && input.pickedPaths[a.id]);
  for (const pr of p.props) {
    const a = propAssets.find((x) => x.name.trim().toLowerCase() === pr.name.trim().toLowerCase());
    if (a) refs.push({ label: `${a.name} design`, path: input.pickedPaths[a.id]! });
  }

  const refIndex = (label: string) => refs.findIndex((r) => r.label === label) + 1;
  const modelText = p.text_items.filter((t) => t.how === "model").map((t) => t.text);
  const propInfo = new Map(input.props.map((x) => [x.name.trim().toLowerCase(), x]));

  const blocks: Block[] = [];
  blocks.push({ name: "1. Style", text: PANEL_STYLE });
  if (input.direction?.trim()) blocks.push({ name: "2. Expression", text: `EXPRESSION FIRST: ${sentence(input.direction)}` });
  blocks.push({
    name: "3. Action and shot",
    text: [`SHOT: ${[p.shot, p.camera].filter(Boolean).join(", ") || "medium shot"}.`, `ACTION: ${sentence(p.action ?? "")}`].join(" "),
  });
  if (inPanel.length) {
    blocks.push({
      name: "4. Characters and costume locks",
      text: inPanel
        .map((c) => {
          const n = refIndex(`${c.name} design`);
          return `${costumeLock(c.name, c.sheet)}${n ? ` Use reference ${n} as ${c.name}'s exact design.` : ""}`;
        })
        .join("\n"),
    });
  }
  if (setting) {
    const n = refIndex(`${setting.name} (setting)`);
    blocks.push({
      name: "5. Setting",
      text: `SETTING: ${setting.name}${setting.description ? `: ${sentence(setting.description)}` : "."} Keep the fixed furniture exactly where it is in reference ${n}.`,
    });
  }
  if (p.props.length) {
    blocks.push({
      name: "6. Props",
      text:
        "PROPS: " +
        p.props
          .map((pr) => {
            const info = propInfo.get(pr.name.trim().toLowerCase());
            const label = modelText.find((t) => t.toLowerCase().includes(pr.name.toLowerCase()));
            const n = refIndex(`${info?.name ?? pr.name} design`);
            return [
              `${pr.name}${pr.location ? ` (${pr.location})` : ""}${pr.state ? `, ${pr.state}` : ""}`,
              label ? `label reads exactly "${label}"` : "blank label",
              n ? `as in reference ${n}` : "",
            ]
              .filter(Boolean)
              .join(", ");
          })
          .join("; ") +
        ".",
    });
  }
  if (p.clock?.trim()) blocks.push({ name: "7. Clock", text: "CLOCK: a blank round clock face in its usual spot, with no hands and no numbers (the time is painted in later)." });
  const castLine = inPanel.length || unknown.length ? `Only these characters: ${[...inPanel.map((c) => c.name), ...unknown].join(", ")}. No other characters and no extra copies.` : "No characters.";
  blocks.push({
    name: "8. Must not appear",
    text: `MUST NOT APPEAR: speech bubbles, captions, sound effects, any text, letters or numbers${modelText.length ? ` (except the label text given above)` : ""}, logos, watermarks. ${castLine}`,
  });
  const space: string[] = [];
  // Worded as composition, not "leave space": a live test drew a literal empty white band with a border.
  if (p.caption?.trim()) space.push("frame the shot so the top fifth of the picture is calm, uncluttered background (wall, ceiling or sky) that is part of the same scene");
  if (p.dialogue.length) space.push("keep some calm background beside the speaker's head");
  if (space.length) blocks.push({ name: "9. Space for lettering", text: `COMPOSITION: ${space.join("; ")}. Full-bleed artwork, edge to edge: no borders, frames, gutters or empty bands.` });
  if (input.matched) blocks.push({ name: "Matched shot", text: `MATCHED SHOT: same camera, same framing, same distance as reference ${refIndex(`Panel ${input.matched.number} (camera to match)`) || 1}.` });
  if (input.fix) blocks.push({ name: "Fix", text: `EDIT of reference 1: keep everything identical, and change only this: ${sentence(input.fix.change)}` });
  const lessons = input.lessons.map((l) => ({ id: l.id, lesson: l.lesson }));
  if (lessons.length) blocks.push({ name: "Lessons", text: `LESSONS: ${lessons.map((l) => sentence(l.lesson)).join(" ")}` });

  const prompt = blocks.map((b) => b.text).join("\n\n");
  const hash = createHash("sha256").update(JSON.stringify({ prompt, refs })).digest("hex").slice(0, 24);
  return { prompt, blocks, refs, lessons, hash, missingRefs };
}

const BANNED = ["filter", "pyjamas", "pajamas", "logo", "watermark", "speech bubble", "caption", "lettering"];

/** Free, before any spend (PIPELINE-RULES 1.6 prompt lint). */
export function lintPanelPrompt(
  built: BuiltPrompt,
  panel: ScriptPanel,
  characters: Character[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Words only matter where they describe the picture, not in the "must not appear" block or the locks.
  const described = built.blocks.filter((b) => /^(2|3|5|6)\.|Fix/.test(b.name)).map((b) => b.text).join(" ");
  if (!panel.action?.trim()) errors.push("The script panel has no visual (action) yet.");
  for (const w of BANNED) if (new RegExp(`\\b${w}`, "i").test(described)) errors.push(`Describes “${w}”. Never describe what you don't want in the picture.`);
  const sfx = described.match(SFX_RE);
  if (sfx) errors.push(`“${sfx[2]}” looks like a sound effect. House rule: no sound effects.`);
  if (/\b\d{1,2}[:.]\d{2}\b/.test(described)) errors.push("Has a clock time in the visual. Clocks are painted in code; remove the time from the action text.");
  const inPanel = new Set(panel.characters.map((c) => c.trim().toLowerCase()));
  for (const c of characters) {
    if (inPanel.has(c.name.trim().toLowerCase())) {
      if (!hasLock(c.sheet)) errors.push(`${c.name} has no costume lock. Add "always wears" and "never wears" to the character sheet first.`);
      continue;
    }
    if (mentions(described, c.name)) errors.push(`Mentions ${c.name}, who isn't in this panel. Add them to the panel's characters, or reword.`);
  }
  for (const m of built.missingRefs) warnings.push(m);
  if (/[“"][^”"]{2,}[”"]/.test(described.replace(/label reads exactly "[^"]*"/g, ""))) warnings.push("Has words in quotes. The model may draw them as text.");
  if (built.prompt.length > 3000) warnings.push(`Long prompt (${built.prompt.length} characters). Shorter prompts are followed more closely.`);
  for (const c of characters) if (inPanel.has(c.name.trim().toLowerCase()) && c.sheet.costume_never && /\b(pyjamas|pajamas|filter)\b/i.test(c.sheet.costume_never)) {
    warnings.push(`${c.name}'s "never wears" names an object. Locks are required, but naming things can still invite them; check the result.`);
  }
  return { errors, warnings };
}
