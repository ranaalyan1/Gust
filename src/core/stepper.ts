/**
 * FIXED TIMESTEP
 *
 * Physics always advances in identical 1/60 s steps, no matter whether the
 * display runs at 60, 72, 90 or 120 Hz, or hitches. Frame rate changes how
 * often we look at the simulation, never how it feels.
 */
export const FIXED_DT = 1 / 60;

export class FixedStepper {
  readonly dt: number;
  /** Never simulate more than this many steps per frame (avoids the spiral of death). */
  readonly maxSteps: number;
  /** 0..1 fraction of a step left over — use it to interpolate rendering. */
  alpha = 0;
  /** Total fixed steps taken. */
  steps = 0;
  private accumulator = 0;

  constructor(dt = FIXED_DT, maxSteps = 5) {
    this.dt = dt;
    this.maxSteps = maxSteps;
  }

  /** Simulated time (s). */
  get time(): number {
    return this.steps * this.dt;
  }

  /** How many steps `advance(frameDelta)` is about to run (to spread per-frame input across them). */
  pending(frameDelta: number): number {
    if (!(frameDelta > 0)) return 0;
    const acc = Math.min(this.accumulator + frameDelta, this.dt * this.maxSteps);
    return Math.floor((acc + 1e-9) / this.dt);
  }

  /** Feed real elapsed time; `step` is called zero or more times with the fixed dt. */
  advance(frameDelta: number, step: (dt: number) => void): number {
    if (!(frameDelta > 0)) return 0;
    this.accumulator += frameDelta;
    const cap = this.dt * this.maxSteps;
    if (this.accumulator > cap) this.accumulator = cap; // drop time rather than spiral
    let n = 0;
    // the tiny epsilon keeps 60 Hz frames from alternating 0 and 2 steps on float error
    while (this.accumulator >= this.dt - 1e-9) {
      step(this.dt);
      this.accumulator -= this.dt;
      this.steps++;
      n++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    this.alpha = this.accumulator / this.dt;
    return n;
  }
}
