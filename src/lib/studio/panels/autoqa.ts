import "server-only";
import sharp from "sharp";
import type { CharacterSheet } from "../story/story";
import { RATIO_BY_SIZE, type AutoCheck, type PanelSize } from "./types";

// Free QA checks in code (PIPELINE-RULES 1.8, automatic part). They never change anything.
// Tesseract isn't available on Vercel, so stray text is left to Claude's vision check.

/** 64-bit difference hash: tiny greyscale image, compare neighbouring pixels. */
export async function dHash(img: Uint8Array): Promise<string> {
  const { data } = await sharp(img).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  return bits;
}

export const hamming = (a: string, b: string) => {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
};

const hexRgb = (hex: string) => {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

export async function autoQa(
  img: Uint8Array,
  opts: {
    size: PanelSize;
    characters: { name: string; sheet: CharacterSheet }[];
    pair?: { number: number; bytes: Uint8Array } | null; // camera-match partner's chosen image
    earlier?: { label: string; bytes: Uint8Array }[]; // earlier takes / reference designs
  },
): Promise<AutoCheck[]> {
  const out: AutoCheck[] = [];
  const meta = await sharp(img).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const want = RATIO_BY_SIZE[opts.size];
  const ratio = h ? w / h : 0;
  const ratioOk = Math.abs(ratio - want) / want < 0.04;
  out.push({ name: "Shape", ok: ratioOk, note: ratioOk ? `${w}×${h} matches a ${opts.size} panel.` : `${w}×${h} doesn't match a ${opts.size} panel (expected about ${want.toFixed(2)} wide per 1 tall).` });
  out.push({ name: "Size", ok: w >= 1500, note: w >= 1500 ? `${w}px wide, enough for a 1600px master.` : `Only ${w}px wide; the master is 1600px, so it will be upscaled.` });

  const stats = await sharp(img).stats();
  const alpha = meta.hasAlpha ? stats.channels[3] : null;
  const transparent = Boolean(alpha && alpha.min < 250);
  out.push({ name: "No transparency", ok: !transparent, note: transparent ? "Has transparent areas." : "Fully opaque." });
  const rgb = stats.channels.slice(0, 3);
  const mean = rgb.reduce((a, c) => a + c.mean, 0) / 3;
  const sd = rgb.reduce((a, c) => a + c.stdev, 0) / 3;
  const blank = (mean > 245 && sd < 10) || sd < 4;
  out.push({ name: "Not blank", ok: !blank, note: blank ? "Looks blank or nearly white." : "Has content." });

  // Key colours from each character's sheet should appear somewhere (catches an off-model palette).
  const small = await sharp(img).removeAlpha().resize(96, 96, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const px = small.info.width * small.info.height;
  for (const c of opts.characters) {
    for (const col of c.sheet.look?.colours ?? []) {
      const target = hexRgb(col.hex);
      if (!target) continue;
      let hits = 0;
      for (let i = 0; i < small.data.length; i += small.info.channels) {
        const d = Math.hypot(small.data[i] - target[0], small.data[i + 1] - target[1], small.data[i + 2] - target[2]);
        if (d < 48) hits++;
      }
      const share = hits / px;
      out.push({
        name: `${c.name}: ${col.name}`,
        ok: share >= 0.002,
        note: share >= 0.002 ? `${col.hex} found (${(share * 100).toFixed(1)}% of the image).` : `${col.hex} is barely there. Check ${c.name} is on-model.`,
      });
    }
  }

  const mine = await dHash(img);
  if (opts.pair) {
    const d = hamming(mine, await dHash(opts.pair.bytes));
    out.push({
      name: `Camera match with panel ${opts.pair.number}`,
      ok: d <= 24,
      note: d <= 24 ? `Close to panel ${opts.pair.number} (difference ${d} of 64).` : `Quite different from panel ${opts.pair.number} (difference ${d} of 64): the camera may have broken.`,
    });
  }
  for (const e of opts.earlier ?? []) {
    const d = hamming(mine, await dHash(e.bytes));
    if (d <= 4) out.push({ name: "Not a copy", ok: false, note: `Almost identical to ${e.label} (difference ${d} of 64): a copy, not a redraw.` });
  }
  return out;
}
