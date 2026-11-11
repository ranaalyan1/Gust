import { describe, expect, it } from 'vitest';
import { DEFAULT_HAND_WIND, HandFilter, createHandSample, handToStream } from '../src/core/hands.js';
import { createStream, sampleSource } from '../src/core/wind.js';
import { dot, length, vec3 } from '../src/core/vec3.js';
import { createRng } from '../src/core/random.js';

const P = DEFAULT_HAND_WIND;

describe('hand -> wind', () => {
  it('uses the tuning anchors from the spec', () => {
    expect(P.baseStrength).toBeCloseTo(1.2);
    expect(P.velocityGain).toBeCloseTo(0.9);
    expect(P.sweepThreshold).toBeCloseTo(0.8);
    expect(P.radius).toBeCloseTo(1.5);
  });

  it('still palm -> steady stream along the palm normal', () => {
    const hand = createHandSample();
    hand.position = vec3(1, 2, 3);
    hand.palmNormal = vec3(0, 0, -1);
    const stream = createStream();
    const sweep = handToStream(hand, P, stream);
    expect(sweep).toBe(0);
    expect(stream.direction).toEqual({ x: 0, y: 0, z: -1 });
    expect(stream.strength).toBeCloseTo(1.2);
    expect(stream.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(stream.radius).toBeCloseTo(1.5);
    // and the air in front of the palm actually moves that way
    const w = sampleSource(stream, vec3(1, 2, 2.6), vec3());
    expect(w.z).toBeLessThan(0);
    expect(Math.abs(w.x) + Math.abs(w.y)).toBeLessThan(1e-9);
  });

  it('fast sweep -> gust along the motion, stronger than a resting palm', () => {
    const hand = createHandSample();
    hand.palmNormal = vec3(0, 1, 0);
    hand.velocity = vec3(3, 0, 0);
    const stream = createStream();
    const sweep = handToStream(hand, P, stream);
    expect(sweep).toBe(1);
    expect(stream.strength).toBeGreaterThan(P.baseStrength * 2);
    expect(stream.direction.x).toBeGreaterThan(0.9); // along the motion
    expect(length(stream.direction)).toBeCloseTo(1, 9);
  });

  it('gust strength scales with hand speed', () => {
    const stream = createStream();
    let last = 0;
    for (const speed of [1.5, 2, 3, 5, 8]) {
      const hand = createHandSample();
      hand.velocity = vec3(speed, 0, 0);
      handToStream(hand, P, stream);
      expect(stream.strength).toBeGreaterThan(last);
      last = stream.strength;
    }
  });

  it('blends smoothly around the sweep threshold (no mode switch to feel)', () => {
    const stream = createStream();
    let prevStrength = -1;
    let prevDirX = -1;
    for (let speed = 0; speed <= 3; speed += 0.01) {
      const hand = createHandSample();
      hand.velocity = vec3(speed, 0, 0);
      handToStream(hand, P, stream);
      if (prevStrength >= 0) {
        expect(Math.abs(stream.strength - prevStrength)).toBeLessThan(0.05);
        expect(Math.abs(stream.direction.x - prevDirX)).toBeLessThan(0.05);
      }
      prevStrength = stream.strength;
      prevDirX = stream.direction.x;
    }
  });

  it('is capped: no hand speed can make an infinite gust', () => {
    const hand = createHandSample();
    hand.velocity = vec3(500, 0, 0);
    const stream = createStream();
    handToStream(hand, P, stream);
    expect(stream.strength).toBeLessThanOrEqual(P.maxStrength);
  });
});

describe('hand filter', () => {
  it('recovers velocity from positions', () => {
    const f = new HandFilter();
    const n = vec3(0, 1, 0);
    for (let i = 0; i < 120; i++) f.update(vec3(i * 2 / 60, 0, 0), n, 1 / 60);
    expect(f.sample.velocity.x).toBeCloseTo(2, 2);
    expect(f.sample.velocity.y).toBeCloseTo(0, 6);
  });

  it('a still but jittery hand makes almost no wind', () => {
    const f = new HandFilter();
    const rng = createRng(3);
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      // 1.5 mm of tracking noise at 72 Hz
      f.update(vec3((rng() - 0.5) * 0.003, (rng() - 0.5) * 0.003, (rng() - 0.5) * 0.003), vec3(0, 1, 0), 1 / 72);
      if (i > 10) peak = Math.max(peak, length(f.sample.velocity));
    }
    expect(peak).toBeLessThan(0.15);
  });

  it('ignores tracking teleports', () => {
    const f = new HandFilter();
    const n = vec3(0, 1, 0);
    for (let i = 0; i < 30; i++) f.update(vec3(0, 0, 0), n, 1 / 60);
    f.update(vec3(5, 0, 0), n, 1 / 60); // hand re-acquired somewhere else
    expect(length(f.sample.velocity)).toBeLessThan(0.01);
    expect(f.sample.position.x).toBe(5);
  });

  it('keeps the palm normal unit length while it turns', () => {
    const f = new HandFilter();
    for (let i = 0; i < 200; i++) {
      const a = i * 0.05;
      f.update(vec3(), vec3(Math.cos(a), Math.sin(a), 0), 1 / 60);
      expect(length(f.sample.palmNormal)).toBeCloseTo(1, 6);
    }
    expect(dot(f.sample.palmNormal, vec3(Math.cos(199 * 0.05), Math.sin(199 * 0.05), 0))).toBeGreaterThan(0.95);
  });
});
