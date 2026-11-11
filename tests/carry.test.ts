import { describe, expect, it } from 'vitest';
import { HandWind } from '../src/core/gestures.js';
import { type HandSample, createHandSample } from '../src/core/hands.js';
import { WindField } from '../src/core/wind.js';
import { FIXED_DT } from '../src/core/stepper.js';
import { vec3 } from '../src/core/vec3.js';
import { DEFAULT_SEED_PARAMS, createSeed, stepSeed } from '../src/core/seed.js';

const dt = FIXED_DT;
const calm = { ...DEFAULT_SEED_PARAMS, flutter: 0 };

function hand(x: number, y: number, z: number, n = vec3(0, 1, 0)): HandSample {
  const h = createHandSample();
  h.position = vec3(x, y, z);
  h.palmNormal = n;
  return h;
}

/** Cupped hands held still at height `y`, palms tipped by `lean` toward +x. */
function cup(hw: HandWind, y: number, lean = 0) {
  const l = Math.hypot(lean, 1);
  const n = () => vec3(lean / l, 1 / l, 0);
  hw.update(hand(0, y, -0.3, n()), hand(0, y, 0.3, n()), dt);
}

describe('carrying: the cupped-hands updraft is a jet the seed hovers on', () => {
  it('a seed settles at a steady height above still palms instead of climbing forever', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    const seed = createSeed(vec3(0, 0.6, 0), 0.3, 'flying');
    let top = -Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      cup(hw, 0);
      stepSeed(seed, field, dt, calm);
      if (seed.pos.y > top) top = seed.pos.y;
    }
    expect(top).toBeLessThan(2.4); // the old column carried it past 9 m
    expect(seed.pos.y).toBeGreaterThan(0.9);
    expect(seed.pos.y).toBeLessThan(2.0);
    expect(Math.abs(seed.vel.y)).toBeLessThan(0.15); // hovering
    expect(Math.hypot(seed.pos.x, seed.pos.z)).toBeLessThan(0.25); // and held on the axis
  });

  it('raising the hands raises the seed with them', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    const seed = createSeed(vec3(0, 0.6, 0), 0.3, 'flying');
    for (let i = 0; i < 60 * 4; i++) {
      cup(hw, 0);
      stepSeed(seed, field, dt, calm);
    }
    const low = seed.pos.y;
    for (let i = 0; i < 60 * 5; i++) {
      cup(hw, Math.min(1, (i * dt) / 2)); // lift the hands 1 m over two seconds, then hold
      stepSeed(seed, field, dt, calm);
    }
    expect(seed.pos.y - low).toBeGreaterThan(0.75);
    expect(seed.pos.y - low).toBeLessThan(1.25);
  });

  it('tipping the palms tips the jet: the seed is carried the way they lean', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    for (let i = 0; i < 60; i++) cup(hw, 0, 0.5);
    const w = field.sample(vec3(0, 0.8, 0), vec3());
    expect(w.x).toBeGreaterThan(1);
    expect(w.y).toBeGreaterThan(w.x);
    // level palms give no sideways push at all
    const field2 = new WindField();
    const hw2 = new HandWind(field2);
    for (let i = 0; i < 60; i++) cup(hw2, 0);
    expect(Math.abs(field2.sample(vec3(0, 0.8, 0), vec3()).x)).toBeLessThan(1e-6);
  });
});

describe('thin air: a soft ceiling keeps the seed in the world', () => {
  it('an endless strong updraft cannot carry a seed far past the ceiling', () => {
    const field = new WindField();
    field.ambient.y = 6; // rising air everywhere, far stronger than the fall
    const seed = createSeed(vec3(0, 0, 0), 0.3, 'flying');
    const env = { rain: 0, terrain: null, ceiling: 3 };
    for (let i = 0; i < 60 * 12; i++) stepSeed(seed, field, dt, calm, env);
    expect(seed.pos.y).toBeGreaterThan(3);
    expect(seed.pos.y).toBeLessThan(5.2);
    // without a ceiling the same air carries it away
    const free = createSeed(vec3(0, 0, 0), 0.3, 'flying');
    for (let i = 0; i < 60 * 12; i++) stepSeed(free, field, dt, calm);
    expect(free.pos.y).toBeGreaterThan(30);
  });
});
