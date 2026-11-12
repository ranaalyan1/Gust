import { describe, expect, it } from 'vitest';
import {
  WindField,
  createShockwave,
  createStream,
  createThermal,
  createVortex,
  sampleSource,
} from '../src/core/wind.js';
import { createRng } from '../src/core/random.js';
import { cross, dot, length, vec3 } from '../src/core/vec3.js';

const out = vec3();

describe('stream', () => {
  const stream = createStream({ origin: vec3(0, 0, 0), direction: vec3(1, 0, 0), strength: 5, radius: 2 });

  it('blows downstream, never upstream', () => {
    const rng = createRng(1);
    for (let i = 0; i < 2000; i++) {
      const p = vec3((rng() - 0.5) * 6, (rng() - 0.5) * 6, (rng() - 0.5) * 6);
      sampleSource(stream, p, out);
      // flow always has a non-negative component along the stream direction
      expect(dot(out, stream.direction)).toBeGreaterThanOrEqual(0);
      // and nothing at all behind the origin
      if (p.x <= 0) expect(length(out)).toBe(0);
    }
    expect(sampleSource(stream, vec3(0.5, 0, 0), out).x).toBeGreaterThan(0);
  });

  it('fades with distance and stops at the hard radius', () => {
    let last = Infinity;
    for (let d = 0.3; d < 2; d += 0.1) {
      const v = sampleSource(stream, vec3(d, 0, 0), out).x;
      expect(v).toBeLessThan(last);
      expect(v).toBeGreaterThan(0);
      last = v;
    }
    expect(length(sampleSource(stream, vec3(2.0, 0, 0), out))).toBe(0);
    expect(length(sampleSource(stream, vec3(3.0, 0, 0), out))).toBe(0);
  });

  it('is strongest on its axis (alignment squared)', () => {
    const onAxis = sampleSource(stream, vec3(1, 0, 0), out).x;
    const offAxis = sampleSource(stream, vec3(Math.SQRT1_2, Math.SQRT1_2, 0), out).x; // same distance, 45° off
    expect(offAxis).toBeLessThan(onAxis);
    expect(offAxis).toBeGreaterThan(0);
  });

  it('never exceeds its strength and is continuous across the origin plane', () => {
    const rng = createRng(2);
    for (let i = 0; i < 2000; i++) {
      const p = vec3((rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4);
      expect(length(sampleSource(stream, p, out))).toBeLessThanOrEqual(5 + 1e-9);
    }
    expect(length(sampleSource(stream, vec3(1e-4, 0.5, 0), out))).toBeLessThan(0.05);
  });
});

describe('field', () => {
  it('opposite sources cancel', () => {
    const field = new WindField();
    field.add(createStream({ origin: vec3(-1, 0, 0), direction: vec3(1, 0, 0), strength: 4, radius: 3 }));
    field.add(createStream({ origin: vec3(1, 0, 0), direction: vec3(-1, 0, 0), strength: 4, radius: 3 }));
    expect(length(field.sample(vec3(0, 0, 0), out))).toBeLessThan(1e-9);
    // off-centre the nearer source wins
    expect(field.sample(vec3(-0.5, 0, 0), out).x).toBeGreaterThan(0);
    expect(field.sample(vec3(0.5, 0, 0), out).x).toBeLessThan(0);
  });

  it('is the linear sum of its sources', () => {
    const a = createStream({ origin: vec3(-1, 0, 0), direction: vec3(1, 0, 0), strength: 3, radius: 3 });
    const b = createThermal({ base: vec3(0, -1, 0), radius: 1, height: 4, strength: 2 });
    const field = new WindField();
    field.add(a);
    field.add(b);
    const p = vec3(0.1, 0.4, 0.1);
    const va = { ...sampleSource(a, p, vec3()) };
    const vb = { ...sampleSource(b, p, vec3()) };
    field.sample(p, out);
    expect(out.x).toBeCloseTo(va.x + vb.x, 10);
    expect(out.y).toBeCloseTo(va.y + vb.y, 10);
    expect(out.z).toBeCloseTo(va.z + vb.z, 10);
  });

  it('still air is exactly still', () => {
    expect(length(new WindField().sample(vec3(3, 1, -2), out))).toBe(0);
  });

  it('ambient wind is uniform; shelters calm the weather but never the player', () => {
    const field = new WindField();
    field.ambient.x = -3;
    field.shelters.push({ min: vec3(-1, -1, -1), max: vec3(1, 1, 1), feather: 0.2 });
    expect(field.sample(vec3(5, 0, 0), out).x).toBeCloseTo(-3);
    expect(field.sample(vec3(0, 0, 0), out).x).toBeCloseTo(0);
    const hand = field.add(createStream({ origin: vec3(-0.5, 0, 0), direction: vec3(1, 0, 0), strength: 4, radius: 2 }));
    const inside = field.sample(vec3(0, 0, 0), out).x;
    expect(inside).toBeCloseTo(sampleSource(hand, vec3(0, 0, 0), vec3()).x);
    expect(inside).toBeGreaterThan(1);
  });

  it('turbulence is bounded, zero-mean and divergence-free', () => {
    const field = new WindField();
    field.turbulence = 1.5;
    const rng = createRng(7);
    const mean = vec3();
    const N = 4000;
    const h = 1e-4;
    const a = vec3();
    const b = vec3();
    for (let i = 0; i < N; i++) {
      field.time = rng() * 100;
      const p = vec3((rng() - 0.5) * 20, (rng() - 0.5) * 20, (rng() - 0.5) * 20);
      field.sample(p, out);
      expect(length(out)).toBeLessThanOrEqual(1.5 * Math.sqrt(3) + 1e-9);
      mean.x += out.x / N;
      mean.y += out.y / N;
      mean.z += out.z / N;
      if (i < 200) {
        const dudx = (field.sample(vec3(p.x + h, p.y, p.z), a).x - field.sample(vec3(p.x - h, p.y, p.z), b).x) / (2 * h);
        const dvdy = (field.sample(vec3(p.x, p.y + h, p.z), a).y - field.sample(vec3(p.x, p.y - h, p.z), b).y) / (2 * h);
        const dwdz = (field.sample(vec3(p.x, p.y, p.z + h), a).z - field.sample(vec3(p.x, p.y, p.z - h), b).z) / (2 * h);
        expect(Math.abs(dudx + dvdy + dwdz)).toBeLessThan(1e-6);
      }
    }
    expect(length(mean)).toBeLessThan(0.08);
  });

  it('sampling is deterministic and allocation-stable', () => {
    const make = () => {
      const f = new WindField();
      f.turbulence = 0.7;
      f.ambient.z = 0.4;
      f.add(createVortex({ center: vec3(0, 1, 0), strength: 5 }));
      f.advance(1.234);
      return f;
    };
    const p = vec3(0.3, 1.2, -0.4);
    expect({ ...make().sample(p, vec3()) }).toEqual({ ...make().sample(p, vec3()) });
  });
});

describe('vortex', () => {
  const vortex = createVortex({ center: vec3(0, 0, 0), axis: vec3(0, 1, 0), strength: 5, radius: 2, coreRadius: 0.4, inflow: 0, lift: 0 });

  it('swirls tangentially around its axis (right-hand rule)', () => {
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      const p = vec3(Math.cos(angle) * 0.8, 0.2, Math.sin(angle) * 0.8);
      sampleSource(vortex, p, out);
      const radial = vec3(p.x, 0, p.z);
      expect(Math.abs(dot(out, radial))).toBeLessThan(1e-9); // no radial component
      expect(Math.abs(out.y)).toBeLessThan(1e-9);
      expect(cross(vec3(), radial, out).y).toBeGreaterThan(0); // counter-clockwise seen from +axis
    }
  });

  it('peaks at the core radius and is calm at the centre and beyond the rim', () => {
    const at = (r: number) => length(sampleSource(vortex, vec3(r, 0, 0), out));
    expect(at(0)).toBe(0);
    expect(at(0.4)).toBeGreaterThan(at(0.2));
    expect(at(0.4)).toBeGreaterThan(at(0.8));
    expect(at(0.4)).toBeCloseTo(5, 5);
    expect(at(2)).toBe(0);
    expect(length(sampleSource(vortex, vec3(0.4, 5, 0), out))).toBe(0);
  });

  it('inflow pulls toward the axis and lift carries upward', () => {
    const w = createVortex({ center: vec3(), axis: vec3(0, 1, 0), strength: 5, inflow: 0.5, lift: 3 });
    sampleSource(w, vec3(0.8, 0, 0), out);
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeGreaterThan(0);
  });
});

describe('thermal', () => {
  const thermal = createThermal({ base: vec3(0, 0, 0), radius: 1, height: 4, strength: 3, entrain: 0 });

  it('rises vertically inside the column only', () => {
    sampleSource(thermal, vec3(0, 1.5, 0), out);
    expect(out.y).toBeCloseTo(3, 5);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
    expect(length(sampleSource(thermal, vec3(1.01, 1.5, 0), out))).toBe(0);
    expect(length(sampleSource(thermal, vec3(0, 4.01, 0), out))).toBe(0);
    expect(length(sampleSource(thermal, vec3(0, -0.5, 0), out))).toBe(0);
  });

  it('is strongest on the axis', () => {
    const c = sampleSource(thermal, vec3(0, 2, 0), out).y;
    const e = sampleSource(thermal, vec3(0.7, 2, 0), out).y;
    expect(c).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(0);
  });

  it('negative strength is a downdraft', () => {
    const sink = createThermal({ base: vec3(), radius: 1, height: 4, strength: -2, entrain: 0 });
    expect(sampleSource(sink, vec3(0, 2, 0), out).y).toBeCloseTo(-2, 5);
  });
});

describe('shockwave', () => {
  it('is an expanding ring pushing outward that decays with age', () => {
    const field = new WindField();
    const wave = field.add(createShockwave({ center: vec3(), strength: 8, speed: 10, thickness: 0.5, duration: 1 }));
    field.advance(0.1); // ring radius 1
    const atRing = { ...field.sample(vec3(1, 0, 0), vec3()) };
    expect(atRing.x).toBeGreaterThan(5);
    expect(Math.abs(atRing.y) + Math.abs(atRing.z)).toBeLessThan(1e-9);
    expect(field.sample(vec3(-1, 0, 0), out).x).toBeLessThan(-5); // outward on every side
    expect(length(field.sample(vec3(4, 0, 0), out))).toBeLessThan(1e-3); // not there yet
    field.advance(0.3); // ring radius 4
    const later = field.sample(vec3(4, 0, 0), out).x;
    expect(later).toBeGreaterThan(0);
    expect(later).toBeLessThan(atRing.x); // age-based decay
    expect(length(field.sample(vec3(1, 0, 0), vec3()))).toBeLessThan(1e-3); // the ring has passed
    field.advance(0.7);
    expect(field.sources.includes(wave)).toBe(false); // spent waves are removed
    expect(length(field.sample(vec3(4, 0, 0), out))).toBe(0);
  });
});
