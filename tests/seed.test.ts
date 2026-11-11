import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED_PARAMS, STILL_AIR, createSeed, stepSeed } from '../src/core/seed.js';
import { WindField, createShockwave, createStream, createThermal, createVortex } from '../src/core/wind.js';
import { FIXED_DT } from '../src/core/stepper.js';
import { isFiniteVec, length, vec3 } from '../src/core/vec3.js';
import { createRng } from '../src/core/random.js';

const dt = FIXED_DT;
const flying = (x = 0, y = 0, z = 0, variation = 0.3) => createSeed(vec3(x, y, z), variation, 'flying');
const TERMINAL = DEFAULT_SEED_PARAMS.gravity / DEFAULT_SEED_PARAMS.drag; // 2.4525 m/s

describe('seed in still air', () => {
  it('reaches terminal velocity (~2.45 m/s, a dandelion)', () => {
    const field = new WindField();
    const seed = flying(0, 100, 0);
    for (let i = 0; i < 60 * 3; i++) stepSeed(seed, field, dt);
    let mean = 0;
    const N = 60 * 4;
    for (let i = 0; i < N; i++) {
      stepSeed(seed, field, dt);
      mean += seed.vel.y / N;
    }
    expect(TERMINAL).toBeCloseTo(2.4525, 4);
    expect(mean).toBeGreaterThan(-TERMINAL * 1.03);
    expect(mean).toBeLessThan(-TERMINAL * 0.97);
  });

  it('settles to exactly g/drag without flutter', () => {
    const field = new WindField();
    const seed = flying(0, 100, 0);
    const params = { ...DEFAULT_SEED_PARAMS, flutter: 0 };
    for (let i = 0; i < 600; i++) stepSeed(seed, field, dt, params);
    expect(seed.vel.y).toBeCloseTo(-TERMINAL, 6);
    expect(seed.vel.x).toBe(0);
    expect(seed.vel.z).toBe(0);
  });

  it('flutters side to side without drifting (feel adds no net thrust)', () => {
    const field = new WindField();
    const seed = flying(0, 100, 0);
    let maxLateral = 0;
    for (let i = 0; i < 60 * 20; i++) {
      stepSeed(seed, field, dt);
      maxLateral = Math.max(maxLateral, Math.hypot(seed.pos.x, seed.pos.z));
    }
    expect(maxLateral).toBeGreaterThan(0.01); // it is visibly alive…
    expect(maxLateral).toBeLessThan(0.3); // …but it does not wander off
  });

  it('rides parachute-up: the pappus trails above the achene', () => {
    const field = new WindField();
    const seed = flying(0, 100, 0);
    for (let i = 0; i < 300; i++) stepSeed(seed, field, dt);
    expect(seed.axis.y).toBeGreaterThan(0.9);
    expect(length(seed.axis)).toBeCloseTo(1, 6);
  });
});

describe('seed in wind', () => {
  it('is carried by the wind', () => {
    const field = new WindField();
    field.ambient.x = 3;
    const seed = flying(0, 100, 0);
    for (let i = 0; i < 60 * 2; i++) stepSeed(seed, field, dt);
    let mean = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepSeed(seed, field, dt);
      mean += seed.vel.x / 240;
    }
    expect(seed.pos.x).toBeGreaterThan(14);
    // it ends up moving WITH the air (flutter swings around the mean)
    expect(mean).toBeGreaterThan(2.9);
    expect(mean).toBeLessThan(3.1);
  });

  it('hovers when the updraft matches terminal velocity and climbs when it exceeds it', () => {
    const hover = new WindField();
    hover.ambient.y = TERMINAL;
    const a = flying(0, 10, 0);
    const params = { ...DEFAULT_SEED_PARAMS, flutter: 0 };
    for (let i = 0; i < 600; i++) stepSeed(a, hover, dt, params);
    expect(Math.abs(a.vel.y)).toBeLessThan(1e-6);

    const lift = new WindField();
    lift.add(createThermal({ base: vec3(0, 0, 0), radius: 1.2, height: 6, strength: 4 }));
    const b = flying(0, 1, 0);
    for (let i = 0; i < 120; i++) stepSeed(b, lift, dt);
    expect(b.pos.y).toBeGreaterThan(1.5);
  });

  it('is pushed away by a stream and leans into it', () => {
    const field = new WindField();
    field.add(createStream({ origin: vec3(-0.5, 0, 0), direction: vec3(1, 0, 0), strength: 6, radius: 2 }));
    const seed = flying(0, 0, 0);
    for (let i = 0; i < 12; i++) stepSeed(seed, field, dt);
    expect(seed.vel.x).toBeGreaterThan(0.5);
    expect(seed.axis.x).toBeGreaterThan(0.05); // pappus swings downstream
  });

  it('never explodes under constant wind', () => {
    const field = new WindField();
    field.ambient.x = 12;
    field.ambient.y = 3;
    const seed = flying(0, 0, 0);
    let maxSpeed = 0;
    for (let i = 0; i < 60 * 60; i++) {
      stepSeed(seed, field, dt);
      maxSpeed = Math.max(maxSpeed, length(seed.vel));
      expect(isFiniteVec(seed.pos)).toBe(true);
    }
    // bounded by the wind itself plus terminal fall and a flutter margin
    expect(maxSpeed).toBeLessThan(Math.hypot(12, 3) + TERMINAL + 2);
  });

  it('stays finite and bounded in a violent, chaotic field', () => {
    const rng = createRng(42);
    const field = new WindField();
    field.turbulence = 6;
    field.add(createVortex({ center: vec3(0, 0, 0), strength: 30, radius: 3, lift: 6 }));
    field.add(createStream({ origin: vec3(-1, 0, 0), direction: vec3(1, 0, 0), strength: 40, radius: 4 }));
    const seeds = Array.from({ length: 20 }, () => flying(rng() - 0.5, rng() - 0.5, rng() - 0.5, rng()));
    for (let i = 0; i < 60 * 20; i++) {
      if (i % 30 === 0) field.add(createShockwave({ center: vec3(rng() - 0.5, rng() - 0.5, 0), strength: 40 }));
      field.advance(dt);
      for (const s of seeds) {
        stepSeed(s, field, dt);
        expect(isFiniteVec(s.pos)).toBe(true);
        expect(isFiniteVec(s.axis)).toBe(true);
        expect(length(s.vel)).toBeLessThanOrEqual(DEFAULT_SEED_PARAMS.maxSpeed + 1e-6);
        expect(Number.isFinite(s.glow)).toBe(true);
      }
    }
  });

  it('rain makes the seed heavier', () => {
    const field = new WindField();
    const dry = flying(0, 100, 0);
    const wet = flying(0, 100, 0);
    for (let i = 0; i < 300; i++) {
      stepSeed(dry, field, dt, DEFAULT_SEED_PARAMS, STILL_AIR);
      stepSeed(wet, field, dt, DEFAULT_SEED_PARAMS, { rain: 1, terrain: null });
    }
    expect(wet.pos.y).toBeLessThan(dry.pos.y - 1);
  });

  it('is deterministic', () => {
    const run = () => {
      const field = new WindField();
      field.turbulence = 1;
      field.add(createVortex({ center: vec3(0.5, 0, 0), strength: 5, lift: 3 }));
      const seed = flying(0, 0, 0, 0.42);
      for (let i = 0; i < 500; i++) {
        field.advance(dt);
        stepSeed(seed, field, dt);
      }
      return { ...seed.pos };
    };
    expect(run()).toEqual(run());
  });
});

describe('seed on its dandelion', () => {
  it('waits forever in still air and in weather alone', () => {
    const field = new WindField();
    field.ambient.x = 6; // a storm can shake it…
    field.turbulence = 2;
    const seed = createSeed(vec3(0, 1, 0));
    for (let i = 0; i < 60 * 30; i++) {
      field.advance(dt);
      stepSeed(seed, field, dt);
    }
    expect(seed.status).toBe('attached'); // …but only the player can free it
    expect(seed.pos.y).toBeCloseTo(1, 6);
  });

  it('is plucked by the player\'s wind and leaves with the gust', () => {
    const field = new WindField();
    field.add(createStream({ origin: vec3(-0.6, 1, 0), direction: vec3(1, 0, 0), strength: 6, radius: 2 }));
    const seed = createSeed(vec3(0, 1, 0));
    let steps = 0;
    while (seed.status === 'attached' && steps < 600) {
      stepSeed(seed, field, dt);
      steps++;
    }
    expect(seed.status).toBe('flying');
    expect(steps * dt).toBeLessThan(1); // magic within a second of the first gesture
    expect(seed.vel.x).toBeGreaterThan(0);
  });

  it('a faint breath is not enough', () => {
    const field = new WindField();
    field.add(createStream({ origin: vec3(-1.2, 1, 0), direction: vec3(1, 0, 0), strength: 1.2, radius: 1.5 }));
    const seed = createSeed(vec3(0, 1, 0));
    for (let i = 0; i < 600; i++) stepSeed(seed, field, dt);
    expect(seed.status).toBe('attached');
  });
});
