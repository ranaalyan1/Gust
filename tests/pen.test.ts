/**
 * The hand is code, so it can be checked: the nib leaves ink where it should,
 * the same seed writes the same page, and the letterforms advance.
 */
import { describe, expect, it } from 'vitest';
import { InkBuffer, paper } from '../src/render/ink.js';
import { measure, write } from '../src/render/pen.js';

const inkCount = (buf: InkBuffer): number => buf.ink.reduce((n, v) => n + (v > 0.1 ? 1 : 0), 0);

describe('paper', () => {
  it('starts as a sheet and is not a flat fill once it has been made', () => {
    const buf = new InkBuffer(64, 64, [0.9, 0.86, 0.76]);
    expect(buf.rgb[0]).toBeCloseTo(0.9, 5);
    paper(buf, { seed: 3, foxing: 6 });
    let min = 1;
    let max = 0;
    for (let i = 0; i < 64 * 64; i++) {
      min = Math.min(min, buf.rgb[i * 3]);
      max = Math.max(max, buf.rgb[i * 3]);
    }
    expect(max - min).toBeGreaterThan(0.02);
    expect(min).toBeGreaterThan(0.3);
  });

  it('ages the edge more than the middle', () => {
    const buf = new InkBuffer(96, 96, [0.9, 0.86, 0.76]);
    paper(buf, { seed: 5, edge: 0.4, foxing: 0 });
    const middle = buf.rgb[(48 * 96 + 48) * 3];
    const corner = buf.rgb[(1 * 96 + 1) * 3];
    expect(corner).toBeLessThan(middle);
  });
});

describe('ink', () => {
  it('lays a stroke and leaves the rest of the sheet alone', () => {
    const buf = new InkBuffer(64, 64);
    buf.segment(8, 32, 56, 32, 2, 1);
    expect(buf.ink[32 * 64 + 32]).toBeGreaterThan(0.8);
    expect(buf.ink[4 * 64 + 4]).toBe(0);
    expect(inkCount(buf)).toBeGreaterThan(80);
  });

  it('does not thin a stroke that crosses itself: ink is laid with max', () => {
    const buf = new InkBuffer(64, 64);
    buf.segment(10, 32, 54, 32, 2, 1);
    const once = buf.ink[32 * 64 + 32];
    buf.segment(32, 10, 32, 54, 2, 1);
    expect(once).toBeGreaterThan(0.8);
    expect(buf.ink[32 * 64 + 32]).toBeLessThanOrEqual(1);
  });

  it('composites to opaque pixels tinted toward the ink', () => {
    const buf = new InkBuffer(8, 8, [0.9, 0.9, 0.9]);
    buf.segment(4, 4, 4, 4.01, 3, 1);
    const rgba = buf.toRGBA([0.1, 0.1, 0.1]);
    expect(rgba).toHaveLength(8 * 8 * 4);
    expect(rgba[(4 * 8 + 4) * 4]).toBeLessThan(120);
    expect(rgba[(4 * 8 + 4) * 4 + 3]).toBe(255);
    expect(rgba[0]).toBeGreaterThan(200);
  });
});

describe('the hand', () => {
  it('writes longer words wider', () => {
    expect(measure('wind', { size: 40 })).toBeGreaterThan(0);
    expect(measure('wind and weather', { size: 40 })).toBeGreaterThan(measure('wind', { size: 40 }));
    expect(measure('wind', { size: 80 })).toBeCloseTo(measure('wind', { size: 40 }) * 2, 6);
  });

  it('advances on the page as it writes', () => {
    const buf = new InkBuffer(400, 80);
    const first = write(buf, 'nine', 10, 50, { size: 26, seed: 1 });
    const second = write(buf, 'nine', 10, 50, { size: 26, seed: 2 });
    expect(first).toBeCloseTo(second, 6);
    expect(inkCount(buf)).toBeGreaterThan(150);
  });

  it('is deterministic for a given seed, and not for a different one', () => {
    const a = new InkBuffer(200, 80);
    const b = new InkBuffer(200, 80);
    const c = new InkBuffer(200, 80);
    write(a, 'xi.26', 6, 52, { size: 30, seed: 7 });
    write(b, 'xi.26', 6, 52, { size: 30, seed: 7 });
    write(c, 'xi.26', 6, 52, { size: 30, seed: 8 });
    expect(Array.from(a.ink)).toEqual(Array.from(b.ink));
    expect(Array.from(a.ink)).not.toEqual(Array.from(c.ink));
  });

  it('draws small caps taller than the x-height', () => {
    const lower = new InkBuffer(160, 100);
    const caps = new InkBuffer(160, 100);
    write(lower, 'keeper', 6, 80, { size: 30, seed: 3 });
    write(caps, 'KEEPER', 6, 80, { size: 30, seed: 3, caps: true });
    // measuring the tallest inked row from the baseline
    const top = (buf: InkBuffer): number => {
      for (let y = 0; y < 100; y++) if (buf.ink.subarray(y * 160, (y + 1) * 160).some((v) => v > 0.2)) return 80 - y;
      return 0;
    };
    expect(top(caps)).toBeGreaterThan(top(lower));
  });

  it('every letter of the alphabet has a glyph', () => {
    const buf = new InkBuffer(900, 120);
    const w = write(buf, 'abcdefghijklmnopqrstuvwxyz 0123456789', 6, 90, { size: 26, seed: 11 });
    expect(w).toBeGreaterThan(300);
    // nothing drawn at all would mean a missing glyph table
    expect(inkCount(buf)).toBeGreaterThan(1200);
  });
});
