import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  STAGES,
  STAGE_COUNT,
  WindField,
  buildCourse,
  courseProgress,
  createContact,
  createHomeIsland,
  createIsland,
  createSeed,
  fallbackMission,
  groundBelow,
  isOutOfWorld,
  islandTop,
  pulseEnvelope,
  pulseWarning,
  releaseSeed,
  resolveTerrain,
  seedAnchor,
  stepSeed,
  vec3,
  DEFAULT_SEED_PARAMS,
  type Terrain,
} from '../src/core/index.js';

const flatWorld = (fertile: boolean): Terrain => ({
  islands: [createIsland({ id: 1, center: vec3(0, 0, 0), rx: 2, rz: 2, depth: 1.5, hills: 0, shapeSeed: 3, fertile })],
  obstacles: [],
  killY: -4,
  minX: -10,
  maxX: 10,
  minZ: -10,
  maxZ: 10,
});

describe('terrain', () => {
  it('a seed resting on an island is pushed out to the surface, never through it', () => {
    const t = flatWorld(false);
    const c = createContact();
    const p = vec3(0.3, -0.2, 0.1);
    resolveTerrain(t, p, 0.07, c);
    expect(c.hit).toBe(true);
    expect(p.y).toBeGreaterThanOrEqual(islandTop(t.islands[0], 0.3, 0.1) + 0.069);
    expect(c.normal.y).toBeGreaterThan(0.7);
  });

  it('reports no contact in open air', () => {
    const c = createContact();
    resolveTerrain(flatWorld(false), vec3(0, 3, 0), 0.07, c);
    expect(c.hit).toBe(false);
  });

  it('groundBelow finds the island top, and nothing over the void', () => {
    const t = flatWorld(false);
    expect(groundBelow(t, 0, 0)).toBeCloseTo(islandTop(t.islands[0], 0, 0), 5);
    expect(groundBelow(t, 8, 8)).toBe(-Infinity);
  });

  it('knows when something has left the world', () => {
    const t = flatWorld(false);
    expect(isOutOfWorld(t, vec3(0, 1, 0))).toBe(false);
    expect(isOutOfWorld(t, vec3(0, -5, 0))).toBe(true);
    expect(isOutOfWorld(t, vec3(11, 1, 0))).toBe(true);
  });

  it('a seed falling onto fertile ground plants itself; onto bare rock it only rests', () => {
    for (const fertile of [true, false]) {
      const t = flatWorld(fertile);
      const field = new WindField();
      const seed = createSeed(vec3(0, 1.2, 0), 0.4);
      releaseSeed(seed);
      for (let i = 0; i < 60 * 6; i++) stepSeed(seed, field, FIXED_DT, DEFAULT_SEED_PARAMS, { rain: 0, terrain: t });
      expect(seed.status).toBe(fertile ? 'planted' : 'flying');
      expect(seed.pos.y).toBeGreaterThan(-0.1);
      expect(seed.pos.y).toBeLessThan(0.6);
    }
  });

  it('a seed that falls past the islands is lost to the clouds', () => {
    const t = flatWorld(true);
    const seed = createSeed(vec3(6, 1, 0), 0.4);
    releaseSeed(seed);
    const field = new WindField();
    for (let i = 0; i < 60 * 6 && seed.status === 'flying'; i++) stepSeed(seed, field, FIXED_DT, DEFAULT_SEED_PARAMS, { rain: 0, terrain: t });
    expect(seed.status).toBe('lost');
  });

  it('rain presses a flying seed down', () => {
    const field = new WindField();
    const dry = createSeed(vec3(0, 50, 0), 0.4);
    const wet = createSeed(vec3(0, 50, 0), 0.4);
    releaseSeed(dry);
    releaseSeed(wet);
    const p = { ...DEFAULT_SEED_PARAMS, flutter: 0 };
    for (let i = 0; i < 180; i++) {
      stepSeed(dry, field, FIXED_DT, p, { rain: 0, terrain: null });
      stepSeed(wet, field, FIXED_DT, p, { rain: 1, terrain: null });
    }
    expect(wet.vel.y).toBeLessThan(dry.vel.y - 0.2);
  });
});

describe('courses — every stage is a well-formed, playable world', () => {
  const build = (stage: number, variant = 0, flock = 20) =>
    buildCourse({ stage, mission: fallbackMission(stage, variant), start: createHomeIsland(1, 0), goalId: 2, flockSize: flock, seed: 11 + stage });

  it('builds all four stages from every fallback mission', () => {
    for (let stage = 0; stage < STAGE_COUNT; stage++) {
      for (const variant of [0, 1]) {
        const c = build(stage, variant);
        expect(c.kind).toBe(STAGES[stage]);
        expect(c.goalX).toBeGreaterThan(c.startX + 3);
        expect(c.goal.fertile).toBe(true);
        expect(c.terrain.islands).toContain(c.start);
        expect(c.terrain.islands).toContain(c.goal);
        // the launch point is inside the world and above its island
        expect(isOutOfWorld(c.terrain, c.dandelion)).toBe(false);
        expect(c.dandelion.y).toBeGreaterThan(groundBelow(c.terrain, c.dandelion.x, c.dandelion.z));
        // the goal is inside the world too
        expect(isOutOfWorld(c.terrain, vec3(c.goal.center.x, c.goal.center.y + 0.5, c.goal.center.z))).toBe(false);
        for (const v of [c.turbulence, c.rain, c.ambient.x, c.ambient.y, c.ambient.z]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('teaches one thing per stage', () => {
    const canyon = build(0);
    const tunnel = build(1);
    const crossing = build(2);
    const burst = build(3);
    expect(canyon.seedCount).toBe(1);
    expect(canyon.pulses.length).toBe(0);
    expect(canyon.rain).toBe(0);
    expect(tunnel.pulses.length).toBeGreaterThan(0); // timed gusts
    expect(tunnel.shelters.length).toBeGreaterThan(0); // somewhere to wait
    expect(tunnel.rain).toBeGreaterThan(0);
    expect(crossing.clears).toBe(true); // storm breaks into golden hour
    expect(crossing.goalX - crossing.startX).toBeGreaterThan(tunnel.goalX - tunnel.startX);
    expect(burst.seedCount).toBe(20);
    expect(burst.thermals.length).toBeGreaterThanOrEqual(3);
  });

  it('clamps the flock to 12..30 seeds', () => {
    expect(build(3, 0, 3).seedCount).toBe(12);
    expect(build(3, 0, 999).seedCount).toBe(30);
  });

  it('never spawns a seed inside rock', () => {
    for (let stage = 0; stage < STAGE_COUNT; stage++) {
      const c = build(stage);
      const contact = createContact();
      const out = vec3();
      for (let i = 0; i < c.seedCount; i++) {
        seedAnchor(c, i, c.seedCount, out);
        const before = { ...out };
        resolveTerrain(c.terrain, out, 0.07, contact);
        expect(contact.hit).toBe(false);
        expect(out).toEqual(before);
      }
    }
  });

  it('progress runs 0..1 from launch to goal', () => {
    const c = build(0);
    expect(courseProgress(c, c.startX)).toBe(0);
    expect(courseProgress(c, c.goalX)).toBe(1);
    expect(courseProgress(c, c.startX - 5)).toBe(0);
    expect(courseProgress(c, c.goalX + 5)).toBe(1);
    expect(courseProgress(c, (c.startX + c.goalX) / 2)).toBeCloseTo(0.5, 5);
  });

  it('pulsed drafts are fair: always telegraphed, always leaving a window', () => {
    const c = build(1);
    for (const p of c.pulses) {
      let blowing = 0;
      let calm = 0;
      let warnedBeforeBlow = true;
      let prevEnv = 0;
      const steps = Math.round((p.period * 3) / FIXED_DT);
      for (let i = 0; i < steps; i++) {
        const t = i * FIXED_DT;
        const env = pulseEnvelope(p, t);
        const warn = pulseWarning(p, t);
        expect(env).toBeGreaterThanOrEqual(0);
        expect(env).toBeLessThanOrEqual(1);
        if (env > 0.05) blowing++;
        else calm++;
        // the instant a blow begins, the warning must already have been showing
        if (prevEnv <= 0.05 && env > 0.05 && i > 0 && pulseWarning(p, t - 0.3) < 0.2) warnedBeforeBlow = false;
        expect(warn).toBeGreaterThanOrEqual(0);
        prevEnv = env;
      }
      expect(warnedBeforeBlow).toBe(true);
      expect(calm * FIXED_DT / 3).toBeGreaterThan(2); // > 2 s of calm in every cycle
      expect(blowing).toBeGreaterThan(0);
    }
  });
});
