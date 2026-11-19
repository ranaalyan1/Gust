import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURES, FIXED_DT, Game, createHandSample, usableHand } from '../src/core/index.js';

const gestures = { ...DEFAULT_GESTURES, unitScale: 7 };

function handAt(x: number, z = 0.2) {
  const s = createHandSample();
  s.position.x = x;
  s.position.y = 1.0;
  s.position.z = z;
  return s;
}

describe('a glitched hand pose never reaches the seed', () => {
  it('usableHand passes a finite hand and rejects any non-finite coordinate', () => {
    const ok = handAt(0.1);
    expect(usableHand(ok)).toBe(ok);
    expect(usableHand(null)).toBeNull();
    const nan = handAt(0.1);
    nan.position.x = Number.NaN;
    expect(usableHand(nan)).toBeNull();
    const inf = handAt(0.1);
    inf.velocity.z = Number.POSITIVE_INFINITY;
    expect(usableHand(inf)).toBeNull();
  });

  it('one NaN pose leaves the seed finite, and the game still responds afterwards', () => {
    const game = new Game({ gestures, seed: 2 });
    for (let i = 0; i < 600; i++) {
      const left = i === 120 ? (() => { const s = handAt(0); s.position.x = Number.NaN; return s; })() : handAt(Math.sin(i * 0.2) * 0.5);
      game.step(FIXED_DT, left, null);
      game.events.length = 0;
      const seed = game.seeds[0];
      expect(Number.isFinite(seed.pos.x) && Number.isFinite(seed.pos.z) && Number.isFinite(seed.pluck)).toBe(true);
    }
  });
});
