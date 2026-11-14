/**
 * FRAME GUARD — degrade the knobs, never the picture.
 *
 * On a headset the game cannot measure itself and trust the number: a rolling
 * average of the last 90 frames is what a player feels, and one bad frame is a
 * tracked hand that vanished for a moment, not a reason to throw away the
 * shadows.
 *
 * So this is generous and slow to act: a stretch must stay over budget for two
 * full seconds before the tier drops, and it never comes back up by itself
 * (oscillating quality is worse than slightly low quality). Tiers only change
 * knobs that need no shader recompile — see `applyTier` in systems/gust.ts.
 *
 * Pure, headless, and tested in tests/perf.test.ts.
 */
export interface FrameGuardOptions {
  /** Frames in the rolling average. */
  window?: number;
  /** Average frame time above this (milliseconds) counts as missing frames. */
  budgetMs?: number;
  /** Seconds of sustained slowness before the tier drops. */
  sustain?: number;
  /** Lowest tier we are allowed to reach (0 = full quality). */
  maxTier?: number;
  /** Frames ignored at the start, while shaders compile. */
  warmup?: number;
}

export class FrameGuard {
  /** Current tier. 0 is full quality. */
  tier = 0;

  private readonly window: number;
  private readonly budget: number;
  private readonly sustain: number;
  private readonly maxTier: number;
  private readonly warmup: number;

  private samples: number[] = [];
  private slowFor = 0;
  private seen = 0;
  private slowStreak = 0;

  constructor(opts: FrameGuardOptions = {}) {
    this.window = Math.max(8, opts.window ?? 90);
    this.budget = Math.max(2, opts.budgetMs ?? 13.9); // 72 Hz with a little room
    this.sustain = Math.max(0, opts.sustain ?? 2);
    this.maxTier = Math.max(0, opts.maxTier ?? 2);
    this.warmup = Math.max(0, opts.warmup ?? 90);
  }

  /** Average of the last window, in milliseconds. NaN until there is one. */
  get average(): number {
    if (this.samples.length === 0) return Number.NaN;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return (sum / this.samples.length) * 1000;
  }

  /** Call once per rendered frame. Returns the new tier when it changes. */
  push(dt: number): number | null {
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.seen++;
    if (this.seen <= this.warmup) return null;

    this.samples.push(dt);
    if (this.samples.length < this.window) return null;

    const avgMs = this.average;
    this.samples = [];

    if (avgMs <= this.budget) {
      this.slowFor = 0;
      this.slowStreak = 0;
      return null;
    }
    this.slowFor += (avgMs / 1000) * this.window;
    this.slowStreak++;
    // two consecutive slow windows, or one long one
    if (this.slowFor < this.sustain || this.slowStreak < 2) return null;
    if (this.tier >= this.maxTier) return null;
    this.tier++;
    this.slowFor = 0;
    this.slowStreak = 0;
    return this.tier;
  }

  /** Forget the history — after a pause, a resume is not a slow frame. */
  reset(): void {
    this.samples = [];
    this.slowFor = 0;
    this.slowStreak = 0;
    this.seen = 0;
  }
}
