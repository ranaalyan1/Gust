import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURES, HandWind } from '../src/core/gestures.js';
import { type HandSample, createHandSample } from '../src/core/hands.js';
import { WindField } from '../src/core/wind.js';
import { FIXED_DT } from '../src/core/stepper.js';
import { dot, length, vec3 } from '../src/core/vec3.js';
import { createSeed, stepSeed } from '../src/core/seed.js';

const dt = FIXED_DT;

function hand(x: number, y: number, z: number, n = vec3(0, 1, 0), v = vec3()): HandSample {
  const h = createHandSample();
  h.position = vec3(x, y, z);
  h.palmNormal = n;
  h.velocity = v;
  return h;
}

/** A hand tracing a circle of radius r at angular speed w about an axis. */
function circling(t: number, r: number, w: number, plane: 'xz' | 'xy' = 'xz'): HandSample {
  const c = Math.cos(w * t);
  const s = Math.sin(w * t);
  return plane === 'xz'
    ? hand(r * c, 1, r * s, vec3(0, -1, 0), vec3(-r * w * s, 0, r * w * c))
    : hand(r * c, 1 + r * s, 0, vec3(0, 0, -1), vec3(-r * w * s, r * w * c, 0));
}

const types = (hw: HandWind) => hw.events.map((e) => e.type);

describe('verbs 1 + 2: palm and sweep', () => {
  it('a still open palm makes a steady stream along its normal', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    hw.update(hand(0, 0, 0, vec3(1, 0, 0)), null, dt);
    const w = field.sample(vec3(0.5, 0, 0), vec3());
    expect(w.x).toBeGreaterThan(0.3);
    expect(Math.abs(w.y) + Math.abs(w.z)).toBeLessThan(1e-9);
    expect(hw.sweep[0]).toBe(0);
    expect(hw.events.length).toBe(0);
  });

  it('a fast sweep raises one gust event and a much stronger wind', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    hw.update(hand(0, 0, 0, vec3(0, 1, 0)), null, dt);
    const rest = length(field.sample(vec3(0, 0.5, 0), vec3()));
    let gusts = 0;
    for (let i = 0; i < 10; i++) {
      hw.update(hand(0, 0, 0, vec3(0, 1, 0), vec3(4, 0, 0)), null, dt);
      gusts += hw.events.filter((e) => e.type === 'gust').length;
    }
    expect(gusts).toBe(1);
    const gust = field.sample(vec3(0.5, 0, 0), vec3());
    expect(gust.x).toBeGreaterThan(rest * 2);
    expect(hw.energy).toBeGreaterThan(3);
  });

  it('a hand that vanishes takes its wind with it', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    hw.update(hand(0, 0, 0, vec3(1, 0, 0)), null, dt);
    hw.update(null, null, dt);
    expect(length(field.sample(vec3(0.5, 0, 0), vec3()))).toBe(0);
    expect(hw.energy).toBe(0);
  });
});

describe('verb 3: both palms up -> updraft', () => {
  it('builds a rising column between the hands that can lift the seed', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    let announced = 0;
    for (let i = 0; i < 60; i++) {
      hw.update(hand(-0.3, 0, 0), hand(0.3, 0, 0), dt);
      announced += types(hw).filter((t) => t === 'updraft').length;
    }
    expect(announced).toBe(1);
    expect(hw.updraftLevel).toBe(1);
    const w = field.sample(vec3(0, 1.0, 0), vec3());
    expect(w.y).toBeGreaterThan(9.81 / 4); // stronger than the seed's terminal fall
    // a seed released above the hands climbs
    const seed = createSeed(vec3(0, 0.8, 0), 0.3, 'flying');
    for (let i = 0; i < 90; i++) {
      hw.update(hand(-0.3, 0, 0), hand(0.3, 0, 0), dt);
      stepSeed(seed, field, dt);
    }
    expect(seed.pos.y).toBeGreaterThan(0.9);
  });

  it('needs BOTH palms up', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    for (let i = 0; i < 60; i++) hw.update(hand(-0.3, 0, 0), hand(0.3, 0, 0, vec3(1, 0, 0)), dt);
    expect(hw.updraftLevel).toBe(0);
    for (let i = 0; i < 60; i++) hw.update(hand(-0.3, 0, 0), null, dt);
    expect(hw.updraftLevel).toBe(0);
  });

  it('raising the hands strengthens it; letting go lets it linger, then fade', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    for (let i = 0; i < 60; i++) hw.update(hand(-0.3, 0, 0), hand(0.3, 0, 0), dt);
    const calm = hw.updraft.strength;
    for (let i = 0; i < 30; i++) hw.update(hand(-0.3, 0, 0, vec3(0, 1, 0), vec3(0, 3, 0)), hand(0.3, 0, 0, vec3(0, 1, 0), vec3(0, 3, 0)), dt);
    expect(hw.updraft.strength).toBeGreaterThan(calm);
    hw.update(null, null, dt);
    expect(hw.updraft.strength).toBeGreaterThan(calm * 0.5); // lingers
    for (let i = 0; i < 120; i++) hw.update(null, null, dt);
    expect(hw.updraft.strength).toBe(0); // then fades
  });
});

describe('verb 4: clap -> shockwave', () => {
  function clap(hw: HandWind, speed = 2): number {
    let claps = 0;
    for (let i = 0; i < 40; i++) {
      const half = Math.max(0.02, 0.4 - (i * dt * speed) / 2 - 0);
      const moving = half > 0.02;
      const v = moving ? speed / 2 : 0;
      hw.update(hand(-half, 1, 0, vec3(1, 0, 0), vec3(v, 0, 0)), hand(half, 1, 0, vec3(-1, 0, 0), vec3(-v, 0, 0)), dt);
      claps += types(hw).filter((t) => t === 'clap').length;
      hw.field.advance(dt);
    }
    return claps;
  }

  it('fires exactly once when the palms meet fast', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    expect(clap(hw)).toBe(1);
  });

  it('pushes everything outward in an expanding ring', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    // hands meet, then get out of the way
    for (let i = 0; i < 60 && !types(hw).includes('clap'); i++) {
      const half = Math.max(0.02, 0.4 - i * dt);
      hw.update(hand(-half, 1, 0, vec3(1, 0, 0), vec3(1, 0, 0)), hand(half, 1, 0, vec3(-1, 0, 0), vec3(-1, 0, 0)), dt);
    }
    hw.update(null, null, dt);
    let sawUp = false;
    let sawSide = false;
    for (let i = 0; i < 30; i++) {
      field.advance(dt);
      if (field.sample(vec3(0, 3, 0), vec3()).y > 1) sawUp = true;
      if (field.sample(vec3(0, 1, 2.5), vec3()).z > 1) sawSide = true;
      const p = vec3(1.2, 1.9, -0.7);
      const w = field.sample(p, vec3());
      expect(dot(w, vec3(p.x, p.y - 1, p.z))).toBeGreaterThanOrEqual(0); // always away from the clap
    }
    expect(sawUp && sawSide).toBe(true);
    for (let i = 0; i < 60; i++) field.advance(dt);
    expect(length(field.sample(vec3(0, 3, 0), vec3()))).toBe(0); // and it is gone
  });

  it('slowly bringing the hands together is not a clap', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    let claps = 0;
    for (let i = 0; i < 600; i++) {
      const half = Math.max(0.02, 0.4 - i * dt * 0.05);
      hw.update(hand(-half, 1, 0, vec3(1, 0, 0), vec3(0.05, 0, 0)), hand(half, 1, 0, vec3(-1, 0, 0), vec3(-0.05, 0, 0)), dt);
      claps += types(hw).filter((t) => t === 'clap').length;
    }
    expect(claps).toBe(0);
  });

  it('must re-open the hands before clapping again', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    expect(clap(hw)).toBe(1);
    // palms stay together and jitter: no machine-gun claps
    let extra = 0;
    for (let i = 0; i < 120; i++) {
      hw.update(hand(-0.02, 1, 0, vec3(1, 0, 0), vec3(2, 0, 0)), hand(0.02, 1, 0, vec3(-1, 0, 0), vec3(-2, 0, 0)), dt);
      extra += types(hw).filter((t) => t === 'clap').length;
    }
    expect(extra).toBe(0);
    expect(clap(hw)).toBe(1);
  });
});

describe('verb 5: circular motion -> whirlwind', () => {
  it('stirring raises a vortex around the stirred circle', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    let announced = 0;
    for (let i = 0; i < 150; i++) {
      hw.update(null, circling(i * dt, 0.15, 7), dt);
      announced += types(hw).filter((t) => t === 'whirl').length;
    }
    expect(announced).toBe(1);
    expect(hw.whirlLevel).toBeGreaterThan(0.9);
    expect(hw.vortex.strength).toBeGreaterThan(3);
    // centred on the circle, spinning the way the hand went
    expect(Math.hypot(hw.vortex.center.x, hw.vortex.center.z)).toBeLessThan(0.08);
    expect(Math.abs(hw.vortex.axis.y)).toBeGreaterThan(0.95);
    const w = field.samplePlayer(vec3(0.6, 1, 0), vec3());
    const handVelAtSamePhase = circling(0, 0.15, 7).velocity; // hand at +x moves along +z
    expect(Math.sign(w.z)).toBe(Math.sign(handVelAtSamePhase.z));
  });

  it('works in any plane (a mouse circles in the screen plane)', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    for (let i = 0; i < 150; i++) hw.update(circling(i * dt, 0.2, 6, 'xy'), null, dt);
    expect(hw.whirlLevel).toBeGreaterThan(0.9);
    expect(Math.abs(hw.vortex.axis.z)).toBeGreaterThan(0.95);
  });

  it('a straight sweep or a back-and-forth wiggle is not a whirlwind', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    for (let i = 0; i < 120; i++) hw.update(hand(i * dt * 2, 1, 0, vec3(0, 1, 0), vec3(2, 0, 0)), null, dt);
    expect(hw.whirlLevel).toBe(0);
    for (let i = 0; i < 300; i++) {
      const t = i * dt;
      hw.update(hand(0.2 * Math.sin(8 * t), 1, 0.02 * Math.sin(16 * t), vec3(0, 1, 0), vec3(1.6 * Math.cos(8 * t), 0, 0.32 * Math.cos(16 * t))), null, dt);
    }
    expect(hw.whirlLevel).toBe(0);
  });

  it('lingers after the hand stops, then dies away', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    for (let i = 0; i < 150; i++) hw.update(null, circling(i * dt, 0.15, 7), dt);
    for (let i = 0; i < 60; i++) hw.update(null, hand(0.15, 1, 0), dt);
    expect(hw.vortex.strength).toBeGreaterThan(1); // still turning a second later
    for (let i = 0; i < 60 * 4; i++) hw.update(null, hand(0.15, 1, 0), dt);
    expect(hw.vortex.strength).toBe(0);
    expect(hw.vortex.enabled).toBe(false);
  });

  it('captures a seed into orbit instead of flinging it away', () => {
    const field = new WindField();
    const hw = new HandWind(field);
    const seed = createSeed(vec3(0.5, 1, 0), 0.3, 'flying');
    let swept = 0;
    let lastAngle = Math.atan2(seed.pos.z, seed.pos.x);
    for (let i = 0; i < 60 * 8; i++) {
      hw.update(null, circling(i * dt, 0.15, 7), dt);
      if (i > 120) {
        stepSeed(seed, field, dt);
        const a = Math.atan2(seed.pos.z, seed.pos.x);
        let d = a - lastAngle;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        swept += d;
        lastAngle = a;
      }
    }
    expect(Math.abs(swept)).toBeGreaterThan(Math.PI * 2); // at least one full orbit
    expect(Math.hypot(seed.pos.x, seed.pos.z)).toBeLessThan(hw.vortex.radius); // still inside
    expect(seed.pos.y).toBeGreaterThan(-1); // and held aloft
  });
});

describe('unit scale (miniature worlds)', () => {
  it('scales human-sized thresholds into simulation space', () => {
    const field = new WindField();
    const hw = new HandWind(field, { ...DEFAULT_GESTURES, unitScale: 7 });
    // palms 0.3 real metres apart = 2.1 sim metres: still an updraft
    for (let i = 0; i < 60; i++) hw.update(hand(-1.05, 0, 0), hand(1.05, 0, 0), dt);
    expect(hw.updraftLevel).toBe(1);
  });
});
