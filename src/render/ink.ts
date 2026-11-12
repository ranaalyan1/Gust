/**
 * INK ON PAPER
 *
 * The desk needs handwriting: specimen labels, a ledger of every seed that
 * came home, a name engraved in brass. There is no font and no canvas here —
 * the whole thing is a few hundred kilobytes of code, and a text atlas would
 * be an asset pipeline for eleven words.
 *
 * So this is a small software rasteriser, the same way the wood grain and the
 * brass tarnish are generated. It knows two things:
 *
 *   - `paper()` fills a buffer with a plausible sheet: laid fibres, uneven
 *     sizing, foxing, the darker deckle at the edge.
 *   - `segment()` lays down ink with a round nib and anti-aliased edges, and
 *     ink is written with `max`, not addition, so overlapping strokes darken
 *     to a wet edge instead of doubling.
 *
 * Everything is deterministic from a seed, so the same desk is the same desk on
 * every load, and tests can call it in Node without a DOM.
 */
import { DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from '@iwsdk/core';
import { hash01 } from '../core/random.js';

export type RGB = readonly [number, number, number];

/** Cheap, stable value noise: bilinear over a hashed lattice. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const h = (ix: number, iy: number): number => hash01((ix * 374761393 + iy * 668265263 + seed * 1442695040) | 0);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export class InkBuffer {
  readonly w: number;
  readonly h: number;
  /** Paper colour per pixel, 0..1 sRGB. */
  readonly rgb: Float32Array;
  /** How much ink sits on the pixel, 0..1. */
  readonly ink: Float32Array;

  constructor(w: number, h: number, fill: RGB = [0.86, 0.82, 0.72]) {
    this.w = w;
    this.h = h;
    this.rgb = new Float32Array(w * h * 3);
    this.ink = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      this.rgb[i * 3] = fill[0];
      this.rgb[i * 3 + 1] = fill[1];
      this.rgb[i * 3 + 2] = fill[2];
    }
  }

  /** Multiply one pixel's paper brightness (soft shadow, gradient, stain). */
  shade(x: number, y: number, mul: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.rgb[i] *= mul;
    this.rgb[i + 1] *= mul;
    this.rgb[i + 2] *= mul;
  }

  /** Mix a tint into one pixel's paper (foxing, tea, dust). */
  tint(x: number, y: number, color: RGB, amount: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || amount <= 0) return;
    const i = (y * this.w + x) * 3;
    const a = Math.min(1, amount);
    this.rgb[i] += (color[0] - this.rgb[i]) * a;
    this.rgb[i + 1] += (color[1] - this.rgb[i + 1]) * a;
    this.rgb[i + 2] += (color[2] - this.rgb[i + 2]) * a;
  }

  /** Add ink coverage with `max`, so a stroke crossed twice keeps one wet edge. */
  put(x: number, y: number, cov: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || cov <= 0) return;
    const i = y * this.w + x;
    if (cov > this.ink[i]) this.ink[i] = cov > 1 ? 1 : cov;
  }

  /** A round nib travelling from one point to the next. */
  segment(x0: number, y0: number, x1: number, y1: number, r: number, alpha: number): void {
    if (r <= 0 || alpha <= 0) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - (x0 + dx * t);
        const qy = py - (y0 + dy * t);
        const d = Math.sqrt(qx * qx + qy * qy);
        // nib edge: one pixel of anti-aliasing, slightly soft on the outside
        const cov = r + 0.5 - d;
        if (cov > 0) this.put(x, y, (cov > 1 ? 1 : cov) * alpha);
      }
    }
  }

  /** A drop let fall from the nib: denser in the middle, feathered at the rim. */
  splat(x: number, y: number, r: number, alpha: number): void {
    const minX = Math.max(0, Math.floor(x - r));
    const maxX = Math.min(this.w - 1, Math.ceil(x + r));
    const minY = Math.max(0, Math.floor(y - r));
    const maxY = Math.min(this.h - 1, Math.ceil(y + r));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / r;
        if (d >= 1) continue;
        this.put(px, py, alpha * (1 - d) * (1 - d * 0.4));
      }
    }
  }

  /** Flatten to RGBA, ink composited with a touch of feathering at the edges. */
  toRGBA(inkColor: RGB = [0.13, 0.11, 0.1]): Uint8Array {
    const out = new Uint8Array(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      const a = this.ink[i];
      const r = this.rgb[i * 3];
      const g = this.rgb[i * 3 + 1];
      const b = this.rgb[i * 3 + 2];
      // a damp edge stays pale: ink thins where the nib lifts
      const wet = 0.86 + 0.14 * Math.min(1, a * 2.2);
      out[i * 4] = Math.min(255, (r + (inkColor[0] * wet - r) * a) * 255);
      out[i * 4 + 1] = Math.min(255, (g + (inkColor[1] * wet - g) * a) * 255);
      out[i * 4 + 2] = Math.min(255, (b + (inkColor[2] * wet - b) * a) * 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  /** `flip` turns the sheet over for planes that are laid flat on the desk. */
  texture(inkColor?: RGB, flip = false): DataTexture {
    let data = this.toRGBA(inkColor);
    if (flip) {
      const row = this.w * 4;
      const out = new Uint8Array(data.length);
      for (let y = 0; y < this.h; y++) out.set(data.subarray((this.h - 1 - y) * row, (this.h - y) * row), y * row);
      data = out;
    }
    const tex = new DataTexture(data, this.w, this.h, RGBAFormat);
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }
}

export interface PaperOptions {
  tone?: RGB;
  seed?: number;
  /** Laid fibres: faint lines left by the mould. */
  fibres?: number;
  /** Age spots. */
  foxing?: number;
  /** How much the sheet is darkened at its edge. */
  edge?: number;
  /** Coarse grain, 0..1. */
  grain?: number;
}

/** Fill a buffer with a plausible sheet of paper. */
export function paper(buf: InkBuffer, o: PaperOptions = {}): void {
  const seed = o.seed ?? 1;
  const tone = o.tone ?? [0.88, 0.84, 0.73];
  const fibres = o.fibres ?? 220;
  const foxing = o.foxing ?? 14;
  const edge = o.edge ?? 0.22;
  const grain = o.grain ?? 1;
  const { w, h } = buf;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // two scales of variation: the sheet's own unevenness, then the pulp
      const coarse = valueNoise(x / 96, y / 96, seed) - 0.5;
      const fine = valueNoise(x / 7, y / 7, seed + 17) - 0.5;
      const mul = 1 + (coarse * 0.055 + fine * 0.03) * grain;
      const i = (y * w + x) * 3;
      buf.rgb[i] = Math.min(1, tone[0] * mul);
      buf.rgb[i + 1] = Math.min(1, tone[1] * mul);
      buf.rgb[i + 2] = Math.min(1, tone[2] * mul);
    }
  }

  // laid lines, very faint and slightly wavy
  for (let f = 0; f < fibres; f++) {
    const y0 = hash01(f * 31 + seed * 7) * h;
    const amp = (hash01(f * 17 + 3) - 0.5) * 3.2;
    const len = 40 + hash01(f * 13 + 5) * w * 0.7;
    const x0 = hash01(f * 23 + 9) * w - len * 0.3;
    const dark = hash01(f * 29 + 11) > 0.45;
    for (let x = 0; x < len; x++) {
      const px = Math.round(x0 + x);
      const py = Math.round(y0 + Math.sin((x / len) * 3.1 + f) * amp);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const fade = Math.sin((x / len) * Math.PI);
      buf.shade(px, py, 1 + (dark ? -0.022 : 0.018) * fade);
    }
  }

  // foxing: soft brown age spots, a few of them, never regular
  for (let s = 0; s < foxing; s++) {
    const cx = hash01(s * 37 + seed) * w;
    const cy = hash01(s * 41 + seed + 2) * h;
    const r = 2 + hash01(s * 53 + 7) * 9;
    const amt = 0.05 + hash01(s * 59 + 3) * 0.1;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(w - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        buf.tint(x, y, [0.55, 0.42, 0.27], amt * (1 - d) * (1 - d));
      }
    }
  }

  // the edge ages faster than the middle, and a trimmed deckle is darker still
  if (edge > 0) {
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = Math.abs(x - cx) / cx;
        const ny = Math.abs(y - cy) / cy;
        const r = Math.max(nx, ny);
        if (r > 0.72) buf.shade(x, y, 1 - edge * Math.pow((r - 0.72) / 0.28, 2.2));
      }
    }
    for (let x = 0; x < w; x++) {
      buf.shade(x, 0, 0.82);
      buf.shade(x, h - 1, 0.86);
    }
    for (let y = 0; y < h; y++) {
      buf.shade(0, y, 0.82);
      buf.shade(w - 1, y, 0.86);
    }
  }
}

/** Faint ruled lines, as a clerk would rule a ledger. */
export function ruled(buf: InkBuffer, opts: { top: number; bottom: number; left: number; right: number; spacing: number; margin?: number; alpha?: number }): void {
  const a = opts.alpha ?? 0.16;
  for (let y = opts.top; y <= opts.bottom; y += opts.spacing) {
    buf.segment(opts.left, y, opts.right, y, 0.7, a);
  }
  if (opts.margin !== undefined) {
    buf.segment(opts.margin, opts.top - 10, opts.margin, opts.bottom + 6, 0.55, a * 0.9);
  }
}
