import { SFX_RE } from "../script/checks";
import type { CharacterSheet } from "../story/story";
import type { AssetKind } from "./types";

// Asset image prompts. Built in code (free) from the character sheet / prop table.
// The style block and the "must not appear" block are added at generation time, so they
// can't be edited away. Text is never AI-drawn: labels stay blank and are lettered later.

export const STYLE_BLOCK =
  "STYLE: clean bold-outline cartoon art for a vertical scroll comic. Flat colours with soft cel shading, warm light, readable at phone size. Original design, not based on any existing character or brand.";

export function mustNotBlock(kind: AssetKind, name: string): string {
  const base =
    "MUST NOT APPEAR: any text, letters, numbers, words, logos, signatures, watermarks, speech bubbles, captions or sound effects. Labels and signs stay blank.";
  if (kind === "character") return `${base} Only one character in the image: ${name}. No other characters, no extra copies.`;
  return `${base} No characters or people.`;
}

const visualRules = (sheet?: CharacterSheet | null) =>
  (sheet?.guardrails ?? []).filter((g) => !/["“”]|\bsays?\b|\bspeak|\bvoice|\bline/i.test(g));

export function templatePrompt(kind: AssetKind, name: string, description: string, sheet?: CharacterSheet | null): string {
  if (kind === "character") {
    const look = sheet?.look ?? {};
    const colours = (look.colours ?? []).map((c) => `${c.name} ${c.hex}`).join(", ");
    return [
      `Character design sheet of ${name}.`,
      look.silhouette ? `Body and silhouette: ${look.silhouette}.` : description ? `${description}` : "",
      colours ? `Colours: ${colours}.` : "",
      look.signature ? `Signature details: ${look.signature}.` : "",
      sheet?.costume_always ? `Always wears: ${sheet.costume_always}.` : "",
      sheet?.costume_never ? `Never wears: ${sheet.costume_never}.` : "",
      // Only visual guardrails belong in an image prompt; voice rules ("only says …") would invite drawn text.
      visualRules(sheet).length ? `Rules: ${visualRules(sheet).join("; ")}.` : "",
      "Full body, front view and three-quarter view side by side, neutral standing pose, plain light grey background.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (kind === "location") {
    return [
      `Establishing view of the location: ${name}.`,
      description || "",
      "Wide shot, eye level, fixed furniture clearly placed so it can be matched in later panels. Empty of characters.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    `Prop study of ${name}.`,
    description || "",
    "One object, centred, three-quarter view, plain light grey background. Any label on it is blank.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The exact text sent to the image model. */
export function fullPrompt(kind: AssetKind, name: string, prompt: string): string {
  return `${STYLE_BLOCK}\n\n${prompt.trim()}\n\n${mustNotBlock(kind, name)}`;
}

const BANNED = ["speech bubble", "speech balloon", "caption", "logo", "watermark", "signature", "lettering", "font"];

/** Free check before any spend. Errors block generation; warnings are shown. */
export function lintPrompt(kind: AssetKind, name: string, prompt: string, castNames: string[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const p = prompt.toLowerCase();
  if (!prompt.trim()) errors.push("The prompt is empty.");
  for (const w of BANNED) if (p.includes(w)) errors.push(`Mentions “${w}”. Text and lettering are never drawn by the model.`);
  const sfx = prompt.match(SFX_RE);
  if (sfx) errors.push(`“${sfx[2]}” looks like a sound effect. House rule: no sound effects.`);
  // An extra character's name in the prompt invites an extra character into the image.
  // Checks the full name and the short one ("Mallow" for "Great-Aunt Mallow").
  const own = new Set(name.toLowerCase().split(/[\s-]+/));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const other of castNames) {
    if (other.trim().toLowerCase() === name.trim().toLowerCase()) continue;
    const short = other.trim().split(/\s+/).pop() ?? "";
    const forms = [other.trim(), ...(short.length >= 3 && !own.has(short.toLowerCase()) ? [short] : [])];
    if (forms.some((f) => new RegExp(`\\b${esc(f)}\\b`, "i").test(prompt))) {
      errors.push(`Mentions ${other}, who isn't this asset. Naming another character tends to add them to the picture.`);
    }
  }
  if (/\d{1,2}:\d{2}/.test(prompt)) errors.push("Has a clock time. Clocks are painted in code, never by the model.");
  if (/[“"][^”"]{2,}[”"]/.test(prompt)) warnings.push("Has words in quotes. The model may try to draw them as text.");
  if (prompt.length > 1500) warnings.push(`Long prompt (${prompt.length} characters). Shorter prompts are followed more closely.`);
  return { errors, warnings };
}
