import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";
import type { ScriptPanel } from "../script/types";
import { MASTER_WIDTH, MIN_TEXT, SAFE_MARGIN, type LetterEl } from "./types";

// Lettering in code (text is never AI-drawn). Ported from letter_v3.py: caption box, speech
// balloon with tail, pinned note with checklist, plaque, label patch, wall clock, pocket watch.
// Text is turned into vector outlines with the bundled fonts (opentype.js), then the whole
// layer is laid over the art with sharp. No system fonts are needed, so it works on Vercel.
// Fonts (decided): Comic Relief Bold for speech, Patrick Hand for captions, Kalam Bold for notes and labels.

const INK = "#141414";
const YELLOW = "#FFE878";
const WHITE = "#FFFFFF";
const CREAM = "#FFFAF0";
const HAND = "#483024";
const PAPER = "rgba(236,222,190,0.93)";
const PLAQUE = "#C4A06E";
const CLOCK_FACE = "#F5F0E6";
const CLOCK_INK = "#322319";

type Fonts = { speech: opentype.Font; caption: opentype.Font; note: opentype.Font };
let cache: Fonts | null = null;
function fonts(): Fonts {
  if (cache) return cache;
  const dir = path.join(process.cwd(), "src", "fonts", "lettering");
  const load = (f: string) => {
    const b = fs.readFileSync(path.join(dir, f));
    return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  cache = { speech: load("ComicRelief-Bold.ttf"), caption: load("PatrickHand-Regular.ttf"), note: load("Kalam-Bold.ttf") };
  return cache;
}

const width = (f: opentype.Font, t: string, size: number) => f.getAdvanceWidth(t, size);

function wrap(f: opentype.Font, text: string, size: number, maxw: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (width(f, t, size) <= maxw || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** One line of text as a filled outline. `y` is the vertical centre of the line. */
function textEl(f: opentype.Font, t: string, x: number, y: number, size: number, anchor: "start" | "middle" | "end", fill: string) {
  const w = width(f, t, size);
  const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const baseline = y + size * 0.34;
  return `<path d="${f.getPath(t, left, baseline, size).toPathData(2)}" fill="${fill}"/>`;
}

function lines(f: opentype.Font, ls: string[], cx: number, cy: number, size: number, fill: string, gap = 1.15) {
  const lh = size * gap;
  const top = cy - (ls.length * lh) / 2 + lh / 2;
  return ls.map((l, i) => textEl(f, l, cx, top + i * lh, size, "middle", fill)).join("");
}

function clockSvg(cx: number, cy: number, r: number, time: string): string {
  const m = time.match(/(\d{1,2})[:.](\d{2})/);
  const hour = m ? Number(m[1]) : 12;
  const minute = m ? Number(m[2]) : 0;
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${CLOCK_FACE}" stroke="${CLOCK_INK}" stroke-width="4"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    s += `<line x1="${cx + (r - 10) * Math.sin(a)}" y1="${cy - (r - 10) * Math.cos(a)}" x2="${cx + (r - 3) * Math.sin(a)}" y2="${cy - (r - 3) * Math.cos(a)}" stroke="${CLOCK_INK}" stroke-width="2"/>`;
  }
  const ha = (((hour % 12) * 30 + minute * 0.5) * Math.PI) / 180;
  const ma = (minute * 6 * Math.PI) / 180;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + 0.55 * r * Math.sin(ha)}" y2="${cy - 0.55 * r * Math.cos(ha)}" stroke="${CLOCK_INK}" stroke-width="5" stroke-linecap="round"/>`;
  s += `<line x1="${cx}" y1="${cy}" x2="${cx + 0.78 * r * Math.sin(ma)}" y2="${cy - 0.78 * r * Math.cos(ma)}" stroke="${CLOCK_INK}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="4" fill="${CLOCK_INK}"/>`;
  return s;
}

/** The text an element will show: its own text, or the script's when left blank. */
export function resolveText(el: LetterEl, panel: ScriptPanel): string {
  if (el.kind === "caption") return el.text.trim() || panel.caption?.trim() || "";
  if (el.kind === "balloon") return el.text.trim() || panel.dialogue[el.line - 1]?.line?.trim() || "";
  if (el.kind === "clock" || el.kind === "watch") return el.time.trim() || panel.clock?.trim() || "";
  return "";
}

/** Starting layout from the script: a caption box at the top, a balloon per line, a clock if the panel has one. */
export function defaultLayout(panel: ScriptPanel): LetterEl[] {
  const out: LetterEl[] = [];
  if (panel.caption?.trim()) out.push({ kind: "caption", text: "", cx: 800, cy: 200, maxw: 1240, size: 48 });
  panel.dialogue.forEach((_, i) => out.push({ kind: "balloon", text: "", line: i + 1, cx: 1100, cy: 700 + i * 300, tx: 850, ty: 1050 + i * 300, size: 56 }));
  if (panel.clock?.trim()) out.push({ kind: "clock", time: "", cx: 1300, cy: 360, r: 90 });
  return out;
}

export function layoutHash(layout: LetterEl[], panel: ScriptPanel, takeId: string): string {
  const texts = layout.map((el) => resolveText(el, panel));
  return createHash("sha256").update(JSON.stringify({ layout, texts, takeId })).digest("hex").slice(0, 24);
}

/** Builds the lettering layer for an image of size W x H (W = 1600). Returns SVG plus warnings. */
export function lettersSvg(layout: LetterEl[], panel: ScriptPanel, W: number, H: number): { svg: string; warnings: string[] } {
  const f = fonts();
  const warnings: string[] = [];
  let body = "";
  const clampBox = (x0: number, y0: number, x1: number, y1: number) => {
    let dx = 0;
    let dy = 0;
    if (x0 < SAFE_MARGIN) dx = SAFE_MARGIN - x0;
    else if (x1 > W - SAFE_MARGIN) dx = W - SAFE_MARGIN - x1;
    if (y0 < SAFE_MARGIN) dy = SAFE_MARGIN - y0;
    else if (y1 > H - SAFE_MARGIN) dy = H - SAFE_MARGIN - y1;
    return { dx, dy };
  };
  const outside = (x0: number, y0: number, x1: number, y1: number) => x0 < SAFE_MARGIN || y0 < SAFE_MARGIN || x1 > W - SAFE_MARGIN || y1 > H - SAFE_MARGIN;

  layout.forEach((el, i) => {
    const n = `Element ${i + 1}`;
    switch (el.kind) {
      case "caption": {
        const text = resolveText(el, panel).toUpperCase();
        if (!text) return void warnings.push(`${n}: the script has no caption for this caption box.`);
        if (el.size < MIN_TEXT) warnings.push(`${n}: caption text ${el.size}px is under ${MIN_TEXT}px (24px on a phone).`);
        const ls = wrap(f.caption, text, el.size, el.maxw);
        const tw = Math.max(...ls.map((l) => width(f.caption, l, el.size)));
        const th = ls.length * el.size * 1.15;
        const pad = 28;
        let x0 = el.cx - tw / 2 - pad, x1 = el.cx + tw / 2 + pad, y0 = el.cy - th / 2 - pad * 0.7, y1 = el.cy + th / 2 + pad * 0.7;
        const { dx, dy } = clampBox(x0, y0, x1, y1);
        x0 += dx; x1 += dx; y0 += dy; y1 += dy;
        body += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="6" fill="${YELLOW}" stroke="${INK}" stroke-width="5"/>`;
        body += lines(f.caption, ls, el.cx + dx, el.cy + dy, el.size, INK);
        return;
      }
      case "balloon": {
        const text = resolveText(el, panel).toUpperCase().replace(/…/g, "...");
        if (!text) return void warnings.push(`${n}: script line ${el.line} doesn't exist.`);
        if (el.size < MIN_TEXT) warnings.push(`${n}: balloon text ${el.size}px is under ${MIN_TEXT}px (24px on a phone).`);
        const ls = wrap(f.speech, text, el.size, 520);
        const tw = Math.max(...ls.map((l) => width(f.speech, l, el.size)));
        const th = ls.length * el.size * 1.15;
        const rx = tw / 2 + 44, ry = th / 2 + 28;
        const { dx, dy } = clampBox(el.cx - rx, el.cy - ry, el.cx + rx, el.cy + ry);
        const cx = el.cx + dx, cy = el.cy + dy;
        let tx = el.tx, ty = el.ty;
        const dist = Math.hypot(tx - cx, ty - cy) || 1;
        const maxTail = Math.max(rx, ry) * 0.75 + 40;
        if (dist > maxTail) { tx = cx + ((tx - cx) * maxTail) / dist; ty = cy + ((ty - cy) * maxTail) / dist; }
        const ang = Math.atan2(ty - cy, tx - cx);
        const a1 = [cx + rx * 0.92 * Math.cos(ang - 0.22), cy + ry * 0.92 * Math.sin(ang - 0.22)];
        const a2 = [cx + rx * 0.92 * Math.cos(ang + 0.22), cy + ry * 0.92 * Math.sin(ang + 0.22)];
        body += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${WHITE}" stroke="${INK}" stroke-width="5"/>`;
        body += `<polygon points="${a1.join(",")} ${a2.join(",")} ${tx},${ty}" fill="${WHITE}"/>`;
        body += `<line x1="${a1[0]}" y1="${a1[1]}" x2="${tx}" y2="${ty}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
        body += `<line x1="${a2[0]}" y1="${a2[1]}" x2="${tx}" y2="${ty}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
        body += lines(f.speech, ls, cx, cy, el.size, INK);
        return;
      }
      case "clock":
      case "watch": {
        const time = resolveText(el, panel);
        if (!time) warnings.push(`${n}: no time set and the script panel has no clock.`);
        if (outside(el.cx - el.r, el.cy - el.r, el.cx + el.r, el.cy + el.r)) warnings.push(`${n}: the ${el.kind} reaches into the outer margin.`);
        body += clockSvg(el.cx, el.cy, el.r, time);
        return;
      }
      case "plaque": {
        let size = el.size;
        while (size > 10 && width(f.note, el.text, size) > el.w - 20) size -= 1;
        body += `<rect x="${el.cx - el.w / 2}" y="${el.cy - el.h / 2}" width="${el.w}" height="${el.h}" rx="6" fill="${PLAQUE}" stroke="#462D1E" stroke-width="3"/>`;
        body += textEl(f.note, el.text, el.cx, el.cy, size, "middle", HAND);
        return;
      }
      case "label": {
        const ls = el.lines.split("\n").map((x) => x.trim()).filter(Boolean);
        body += `<rect x="${el.cx - el.w / 2}" y="${el.cy - el.h / 2}" width="${el.w}" height="${el.h}" rx="8" fill="${CREAM}" stroke="#3C2D23" stroke-width="3"/>`;
        const sizes = ls.map((_, j) => (j === 0 ? el.size : Math.round(el.size * 0.6)));
        const total = sizes.reduce((a, b) => a + b * 1.15, 0);
        let y = el.cy - total / 2;
        ls.forEach((l, j) => {
          let s = sizes[j];
          while (s > 8 && width(f.note, l, s) > el.w - 14) s -= 1;
          body += textEl(f.note, l, el.cx, y + (sizes[j] * 1.15) / 2, s, "middle", HAND);
          y += sizes[j] * 1.15;
        });
        return;
      }
      case "note": {
        const header = el.header.split("\n").map((x) => x.trim()).filter(Boolean);
        const items = el.items.split("\n").map((x) => x.trim()).filter(Boolean);
        const hs = Math.round(el.size * 1.1);
        body += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="6" fill="${PAPER}"/>`;
        let y = el.y + 14 + hs / 2;
        for (const h of header) { body += textEl(f.note, h, el.x + el.w / 2, y, hs, "middle", HAND); y += hs + 6; }
        y += 4 - hs / 2;
        body += `<line x1="${el.x + 12}" y1="${y}" x2="${el.x + el.w - 12}" y2="${y}" stroke="#8C6E50" stroke-width="2"/>`;
        y += 10;
        for (const it of items) {
          const bx = el.x + 14, by = y + 2;
          body += `<rect x="${bx}" y="${by}" width="16" height="16" fill="none" stroke="${HAND}" stroke-width="2"/>`;
          if (el.ticked) body += `<polyline points="${bx + 3},${by + 8} ${bx + 7},${by + 13} ${bx + 14},${by + 3}" fill="none" stroke="#287832" stroke-width="3"/>`;
          body += textEl(f.note, it, bx + 24, y + el.size / 2 + 2, el.size, "start", HAND);
          y += el.size + 8;
        }
        if (el.signed.trim()) body += textEl(f.note, el.signed, el.x + el.w - 14, y + 4 + el.size / 2, Math.max(14, el.size - 2), "end", HAND);
        if (y > el.y + el.h) warnings.push(`${n}: the note's text runs past its bottom edge; make it taller.`);
        return;
      }
      case "shortnote": {
        body += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="5" fill="${PAPER}"/>`;
        const ls = wrap(f.note, el.text, el.size, el.w - 24);
        body += lines(f.note, ls, el.x + el.w / 2, el.y + el.h / 2, el.size, HAND);
        return;
      }
    }
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`, warnings };
}

/** Letters one panel: resize the art to 1600 wide, lay the lettering over it, return a PNG. */
export async function letterPanel(art: Uint8Array, layout: LetterEl[], panel: ScriptPanel) {
  const base = await sharp(art).rotate().resize({ width: MASTER_WIDTH }).flatten({ background: "#ffffff" }).png().toBuffer();
  const meta = await sharp(base).metadata();
  const W = meta.width ?? MASTER_WIDTH;
  const H = meta.height ?? MASTER_WIDTH;
  const { svg, warnings } = lettersSvg(layout, panel, W, H);
  const bytes = await sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png({ compressionLevel: 8 }).toBuffer();
  return { bytes: new Uint8Array(bytes), warnings, width: W, height: H };
}
