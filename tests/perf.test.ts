import { describe, expect, it } from 'vitest';
import { FrameGuard } from '../src/core/index.js';

const feed = (g: FrameGuard, ms: number, frames: number): number[] => {
  const tiers: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t = g.push(ms / 1000);
    if (t !== null) tiers.push(t);
  }
  return tiers;
};

describe('FrameGuard', () => {
  it('ignores the warm-up, however slow the first frames are', () => {
    const g = new FrameGuard({ warmup: 60, window: 20, sustain: 1 });
    expect(feed(g, 30, 60)).toEqual([]);
    expect(g.tier).toBe(0);
  });

  it('never degrades while frames are inside budget', () => {
    const g = new FrameGuard({ warmup: 10, window: 20, sustain: 1 });
    expect(feed(g, 11, 600)).toEqual([]);
    expect(g.tier).toBe(0);
  });

  it('drops a tier only after the slowness is sustained', () => {
    const g = new FrameGuard({ warmup: 10, window: 20, sustain: 2 });
    // a single slow window is a hitch, not a trend
    feed(g, 30, 30);
    expect(g.tier).toBe(0);
    const tiers = feed(g, 30, 200);
    expect(tiers[0]).toBe(1);
  });

  it('stops at the ceiling', () => {
    const g = new FrameGuard({ warmup: 0, window: 10, sustain: 1, maxTier: 2 });
    feed(g, 40, 3000);
    expect(g.tier).toBe(2);
  });

  it('does not climb back up on its own', () => {
    const g = new FrameGuard({ warmup: 0, window: 10, sustain: 1 });
    feed(g, 40, 400);
    const tier = g.tier;
    expect(tier).toBeGreaterThan(0);
    expect(feed(g, 6, 1000)).toEqual([]);
    expect(g.tier).toBe(tier);
  });

  it('resets cleanly, so a resume is not a slow frame', () => {
    const g = new FrameGuard({ warmup: 0, window: 10, sustain: 1 });
    feed(g, 40, 400);
    g.reset();
    expect(g.tier).toBeGreaterThan(0);
    expect(feed(g, 8, 10)).toEqual([]);
    expect(Number.isNaN(new FrameGuard().average)).toBe(true);
  });

  it('rejects nonsense deltas rather than poisoning the average', () => {
    const g = new FrameGuard({ warmup: 0, window: 4, sustain: 1 });
    g.push(0);
    g.push(-1);
    g.push(Number.NaN);
    expect(Number.isNaN(g.average)).toBe(true);
    expect(g.tier).toBe(0);
  });
});
