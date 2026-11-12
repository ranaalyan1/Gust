/**
 * THE PEN
 *
 * A single-stroke hand, drawn as polylines in an em box, then rendered with the
 * ink rasteriser. It is not a font: there are no outlines, no hinting, no
 * texture atlas. A letter is a handful of pen paths, and the uneven hand comes
 * from the renderer — pressure that varies along the stroke, a nib that lifts
 * and leaves a dot, a baseline that never quite settles.
 *
 * Coordinates: y up, baseline at 0, x-height 0.5, ascender 1.0, descender −0.4.
 *
 * Capitals are small caps of the same hand. That is what a clerk writing on a
 * label actually did — and it is what an engraver cut into brass.
 */
import type { InkBuffer } from './ink.js';

export interface Glyph {
  /** Advance width in em. */
  adv: number;
  /** One array of [x, y, x, y, …] per pen stroke. */
  strokes: readonly (readonly number[])[];
}

const X_HEIGHT = 0.5;
const CAP_HEIGHT = 0.64;

/** `x y x y … | x y …` — spaces separate coordinates, `|` separates strokes. */
function g(adv: number, path: string): Glyph {
  const strokes = path.split('|').map((s) => s.trim().split(/[\s,]+/).map(Number));
  return { adv, strokes };
}

const GLYPHS: Record<string, Glyph> = {
  a: g(0.5, '0.40 0.50 0.36 0.26 0.33 0.08 0.22 0.00 0.10 0.06 0.05 0.22 0.09 0.40 0.20 0.50 0.31 0.46 0.37 0.34 0.38 0.20'),
  b: g(0.48, '0.10 1.00 0.09 0.30 0.08 0.02 | 0.09 0.24 0.18 0.06 0.30 0.00 0.40 0.09 0.42 0.28 0.34 0.46 0.21 0.50 0.10 0.40'),
  c: g(0.44, '0.38 0.42 0.31 0.49 0.18 0.49 0.07 0.38 0.04 0.22 0.10 0.07 0.22 0.00 0.33 0.03 0.40 0.10'),
  d: g(0.5, '0.42 1.00 0.39 0.30 0.37 0.04 | 0.41 0.28 0.33 0.08 0.21 0.00 0.09 0.08 0.04 0.24 0.09 0.42 0.20 0.50 0.32 0.45 0.39 0.32'),
  e: g(0.44, '0.05 0.26 0.38 0.31 0.37 0.15 0.27 0.03 0.14 0.04 0.05 0.17 0.06 0.35 0.16 0.47 0.29 0.48 0.38 0.42'),
  f: g(0.34, '0.32 0.98 0.25 0.84 0.21 0.50 0.17 0.10 0.11 -0.12 0.03 -0.18 | 0.03 0.52 0.30 0.54'),
  g: g(0.48, '0.40 0.46 0.36 0.22 0.30 0.06 0.19 0.01 0.08 0.09 0.06 0.24 0.13 0.36 0.25 0.40 0.36 0.34 | 0.41 0.46 0.38 -0.10 0.32 -0.28 0.22 -0.36 0.10 -0.34 0.04 -0.26'),
  h: g(0.48, '0.10 1.00 0.09 0.34 0.08 0.02 | 0.09 0.28 0.17 0.45 0.28 0.50 0.38 0.42 0.38 0.02'),
  i: g(0.22, '0.12 0.44 0.11 0.02 | 0.13 0.62 0.14 0.64'),
  j: g(0.24, '0.15 0.44 0.12 -0.12 0.07 -0.28 -0.01 -0.34 | 0.16 0.62 0.17 0.64'),
  k: g(0.42, '0.09 1.00 0.08 0.36 0.07 0.02 | 0.34 0.48 0.20 0.30 0.08 0.24 | 0.14 0.26 0.38 0.02'),
  l: g(0.24, '0.12 0.99 0.10 0.20 0.11 0.04 0.17 0.00 0.23 0.04'),
  m: g(0.58, '0.08 0.44 0.07 0.02 | 0.07 0.30 0.14 0.46 0.21 0.48 0.25 0.38 0.25 0.02 | 0.25 0.30 0.33 0.46 0.40 0.48 0.44 0.38 0.44 0.02'),
  n: g(0.46, '0.08 0.44 0.07 0.02 | 0.07 0.28 0.15 0.45 0.27 0.50 0.37 0.42 0.37 0.02'),
  o: g(0.46, '0.30 0.48 0.39 0.37 0.37 0.16 0.26 0.02 0.13 0.02 0.05 0.16 0.06 0.36 0.16 0.48 0.28 0.49'),
  p: g(0.48, '0.10 0.46 0.08 -0.14 0.05 -0.36 | 0.09 0.26 0.17 0.44 0.30 0.49 0.41 0.38 0.41 0.18 0.31 0.03 0.18 0.02 0.10 0.14'),
  q: g(0.48, '0.40 0.46 0.36 0.20 0.28 0.03 0.16 0.01 0.06 0.12 0.07 0.30 0.16 0.45 0.29 0.48 0.39 0.40 | 0.40 0.46 0.36 -0.16 0.33 -0.36'),
  r: g(0.34, '0.08 0.44 0.07 0.02 | 0.07 0.26 0.14 0.44 0.24 0.50 0.32 0.44'),
  s: g(0.4, '0.35 0.42 0.26 0.49 0.14 0.48 0.06 0.38 0.10 0.28 0.21 0.24 0.32 0.20 0.37 0.10 0.29 0.01 0.15 0.00 0.04 0.06'),
  t: g(0.34, '0.16 0.84 0.14 0.24 0.15 0.05 0.21 0.00 0.30 0.02 | 0.02 0.56 0.30 0.58'),
  u: g(0.48, '0.07 0.44 0.08 0.16 0.13 0.03 0.24 0.00 0.34 0.09 0.39 0.30 | 0.39 0.44 0.38 0.10 0.41 0.02'),
  v: g(0.42, '0.04 0.44 0.16 0.06 0.19 0.00 0.26 0.16 0.38 0.46'),
  w: g(0.58, '0.03 0.44 0.13 0.05 0.17 0.00 0.25 0.22 0.30 0.24 0.37 0.02 0.41 0.00 0.50 0.26 0.55 0.46'),
  x: g(0.42, '0.06 0.44 0.36 0.03 | 0.35 0.44 0.05 0.02'),
  y: g(0.44, '0.04 0.44 0.15 0.10 0.20 0.00 | 0.38 0.44 0.30 0.12 0.22 -0.10 0.14 -0.30 0.06 -0.36 -0.01 -0.32'),
  z: g(0.42, '0.05 0.44 0.34 0.44 0.06 0.05 0.37 0.02'),
  '0': g(0.42, '0.22 0.62 0.33 0.48 0.33 0.15 0.21 0.00 0.09 0.14 0.09 0.46 0.20 0.62 0.30 0.50'),
  '1': g(0.42, '0.10 0.48 0.20 0.62 0.20 0.00 | 0.06 0.00 0.32 0.00'),
  '2': g(0.42, '0.06 0.50 0.14 0.61 0.26 0.61 0.34 0.49 0.30 0.35 0.08 0.02 0.36 0.02'),
  '3': g(0.42, '0.06 0.54 0.18 0.62 0.29 0.58 0.31 0.44 0.20 0.34 0.31 0.26 0.32 0.10 0.21 0.00 0.08 0.03'),
  '4': g(0.42, '0.27 0.00 0.27 0.62 0.04 0.17 0.36 0.17'),
  '5': g(0.42, '0.32 0.62 0.11 0.62 0.09 0.36 0.21 0.39 0.32 0.30 0.30 0.10 0.18 0.00 0.06 0.04'),
  '6': g(0.42, '0.32 0.58 0.19 0.55 0.09 0.38 0.09 0.13 0.19 0.00 0.30 0.07 0.33 0.22 0.24 0.34 0.11 0.31 0.08 0.18'),
  '7': g(0.42, '0.06 0.62 0.36 0.62 0.16 0.00'),
  '8': g(0.42, '0.20 0.34 0.09 0.44 0.11 0.57 0.21 0.62 0.31 0.55 0.30 0.41 0.19 0.34 0.08 0.24 0.08 0.08 0.19 0.00 0.31 0.08 0.31 0.24 0.20 0.34'),
  '9': g(0.42, '0.10 0.04 0.23 0.07 0.32 0.25 0.30 0.50 0.19 0.62 0.08 0.56 0.07 0.42 0.17 0.32 0.29 0.37'),
  '.': g(0.18, '0.09 0.02 0.10 0.04'),
  ',': g(0.18, '0.10 0.06 0.07 -0.08'),
  ':': g(0.18, '0.09 0.02 0.10 0.03 | 0.10 0.28 0.11 0.29'),
  ';': g(0.18, '0.10 0.28 0.11 0.29 | 0.10 0.06 0.07 -0.08'),
  '-': g(0.3, '0.04 0.28 0.26 0.28'),
  '\u2013': g(0.4, '0.04 0.28 0.36 0.28'),
  '\u2014': g(0.52, '0.03 0.28 0.48 0.28'),
  '/': g(0.34, '0.30 0.62 0.03 -0.04'),
  '(': g(0.24, '0.20 0.70 0.10 0.50 0.09 0.26 0.15 -0.06 0.22 -0.14'),
  ')': g(0.24, '0.04 0.70 0.14 0.50 0.15 0.26 0.09 -0.06 0.02 -0.14'),
  "'": g(0.14, '0.08 0.62 0.07 0.50'),
  '"': g(0.2, '0.07 0.62 0.06 0.50 | 0.15 0.62 0.14 0.50'),
  '!': g(0.2, '0.09 0.62 0.10 0.20 | 0.10 0.02 0.11 0.04'),
  '?': g(0.36, '0.05 0.52 0.13 0.61 0.25 0.60 0.30 0.49 0.23 0.38 0.15 0.32 0.15 0.22 | 0.15 0.02 0.16 0.04'),
};

export interface PenStyle {
  /** Pixels per em. */
  size: number;
  /** Nib radius in em. */
  weight?: number;
  /** Italic lean: x shifts by `slant * y`. */
  slant?: number;
  /** 0 = typeset, 1 = a hurried hand. */
  jitter?: number;
  seed?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  /** Small caps, as on a label or an engraved plate. */
  caps?: boolean;
  /** Per-letter baselines drift down the line. */
  drift?: number;
  align?: 'left' | 'center' | 'right';
  /** Overall opacity of the ink. */
  alpha?: number;
}

const DEFAULTS = {
  weight: 0.05,
  slant: 0.17,
  jitter: 0.55,
  letterSpacing: 0.012,
  wordSpacing: 0.16,
  caps: false,
  drift: 0.012,
  align: 'left' as const,
  alpha: 1,
};

const advanceOf = (ch: string, s: Required<PenStyle>): number => {
  if (ch === ' ') return 0.22 + s.wordSpacing;
  const glyph = GLYPHS[ch.toLowerCase()];
  if (!glyph) return 0.26 + s.letterSpacing;
  const k = s.caps ? CAP_HEIGHT / X_HEIGHT : 1;
  return glyph.adv * k + s.letterSpacing;
};

/** Width of a line, in pixels. */
export function measure(text: string, style: PenStyle): number {
  const s = { ...DEFAULTS, ...style } as Required<PenStyle>;
  let w = 0;
  for (const ch of text) w += advanceOf(ch, s);
  return w * s.size;
}

/** Chaikin: two passes turn six points into a drawn curve. */
function smooth(points: number[], passes = 2): number[] {
  let pts = points;
  for (let pass = 0; pass < passes; pass++) {
    if (pts.length < 6) return pts;
    const out: number[] = [pts[0], pts[1]];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x0 = pts[i];
      const y0 = pts[i + 1];
      const x1 = pts[i + 2];
      const y1 = pts[i + 3];
      out.push(x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25);
      out.push(x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75);
    }
    out.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Write one line with its baseline at `y`. Returns the width drawn, so callers
 * can chain, centre, or right-align.
 */
export function write(buf: InkBuffer, text: string, x: number, y: number, style: PenStyle): number {
  const s = { ...DEFAULTS, ...style } as Required<PenStyle>;
  const seed = s.seed ?? 1;
  const width = measure(text, style);
  let pen = x;
  if (s.align === 'center') pen = x - width / 2;
  else if (s.align === 'right') pen = x - width;
  const start = pen;

  let index = 0;
  for (const raw of text) {
    const ch = raw;
    index++;
    const glyph = GLYPHS[ch.toLowerCase()];
    if (!glyph) {
      pen += advanceOf(ch, s) * s.size;
      continue;
    }
    const k = s.caps ? CAP_HEIGHT / X_HEIGHT : 1;
    // an uneven hand: each letter sits a little differently
    const r1 = hashish(index * 7 + seed * 131);
    const r2 = hashish(index * 13 + seed * 977);
    const r3 = hashish(index * 29 + seed * 37);
    const wobble = (r1 - 0.5) * 0.035 * s.jitter;
    const tilt = (r2 - 0.5) * 0.055 * s.jitter;
    const squeeze = 1 + (r3 - 0.5) * 0.05 * s.jitter;
    const drift = ((index / Math.max(1, text.length)) - 0.5) * s.drift * s.jitter;
    const bx = pen;
    const by = y + (wobble + drift) * s.size;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);

    for (const stroke of glyph.strokes) {
      const pts = smooth(stroke as number[]);
      let px = 0;
      let py = 0;
      let first = true;
      let j = 0;
      for (let i = 0; i < pts.length; i += 2) {
        // em -> px: small caps scale the glyph, slant shears it, then tilt
        const ex = pts[i] * squeeze + pts[i + 1] * s.slant;
        const ey = pts[i + 1] * k;
        const sx = ex * cos - ey * sin;
        const sy = ex * sin + ey * cos;
        const cx = bx + sx * s.size;
        const cy = by - sy * s.size;
        if (!first) {
          // pressure: the nib rides light in the middle of a fast stroke
          const t = j / Math.max(1, pts.length / 2 - 1);
          const pressure = 0.86 + 0.2 * Math.sin(t * Math.PI) * (0.6 + 0.4 * r1);
          const nib = Math.max(0.35, s.weight * s.size * pressure);
          buf.segment(px, py, cx, cy, nib, s.alpha * (0.9 + 0.1 * r2));
        }
        px = cx;
        py = cy;
        first = false;
        j++;
      }
      // the nib lifts: a small pool of ink at the end of the stroke
      if (s.jitter > 0.15 && !first) {
        buf.splat(px, py, Math.max(0.5, s.weight * s.size * 1.05), s.alpha * 0.3);
      }
    }
    pen += advanceOf(ch, s) * s.size;
  }
  return pen - start;
}

/** Deterministic 0..1 from an integer, without importing the sim's RNG table. */
function hashish(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Every character the hand can draw, for tests and for the dev preview. */
export const PEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
export const PEN_DIGITS = '0123456789';
