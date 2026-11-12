/**
 * HANDS BECOME WIND
 *
 * The one and only input type of the game is the HandSample. Tracked hands,
 * controllers, the mouse-as-hand fallback and the scripted ghost player all
 * produce HandSamples; the physics never knows — or cares — which.
 */
import { type Vec3, clamp, damp, smoothstep, vec3 } from './vec3.js';
import type { StreamSource } from './wind.js';

export interface HandSample {
  /** Palm centre, in simulation space (m). */
  position: Vec3;
  /** Unit vector pointing out of the palm. */
  palmNormal: Vec3;
  /** Palm velocity (m/s). */
  velocity: Vec3;
}

export const createHandSample = (): HandSample => ({
  position: vec3(),
  palmNormal: vec3(0, 1, 0),
  velocity: vec3(),
});

export function copyHandSample(out: HandSample, a: HandSample): HandSample {
  out.position.x = a.position.x;
  out.position.y = a.position.y;
  out.position.z = a.position.z;
  out.palmNormal.x = a.palmNormal.x;
  out.palmNormal.y = a.palmNormal.y;
  out.palmNormal.z = a.palmNormal.z;
  out.velocity.x = a.velocity.x;
  out.velocity.y = a.velocity.y;
  out.velocity.z = a.velocity.z;
  return out;
}

export interface HandWindParams {
  /** Air speed of a resting open palm, along its normal (m/s). */
  baseStrength: number;
  /** Air speed added per m/s of hand speed, along the motion. */
  velocityGain: number;
  /** Hand speed at which a movement counts as a sweep (m/s). */
  sweepThreshold: number;
  /** Reach of a hand's wind (m). */
  radius: number;
  /** Hard cap on stream strength (m/s). */
  maxStrength: number;
}

/** The tuning anchors from the design spec. */
export const DEFAULT_HAND_WIND: HandWindParams = {
  baseStrength: 1.2,
  velocityGain: 0.9,
  sweepThreshold: 0.8,
  radius: 1.5,
  maxStrength: 16,
};

/**
 * Turn a hand into a stream source (written in place, no allocation).
 *
 *   still palm  -> a steady stream along the palm normal at `baseStrength`
 *   fast sweep  -> a gust along the motion, growing with hand speed
 *
 * The two blend smoothly around `sweepThreshold`, so there is no mode switch to
 * feel: wind = normal * base + velocity * gain * sweepiness.
 * Returns the sweepiness in [0, 1] (0 = resting palm, 1 = full gust).
 */
export function handToStream(hand: HandSample, params: HandWindParams, out: StreamSource, gain = 1): number {
  const v = hand.velocity;
  const n = hand.palmNormal;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const sweep = smoothstep(params.sweepThreshold * 0.5, params.sweepThreshold * 1.5, speed);
  const g = params.velocityGain * sweep;
  let wx = n.x * params.baseStrength + v.x * g;
  let wy = n.y * params.baseStrength + v.y * g;
  let wz = n.z * params.baseStrength + v.z * g;
  let strength = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (strength < 1e-6) {
    wx = n.x;
    wy = n.y;
    wz = n.z;
    strength = 0;
  } else {
    const inv = 1 / strength;
    wx *= inv;
    wy *= inv;
    wz *= inv;
  }
  out.origin.x = hand.position.x;
  out.origin.y = hand.position.y;
  out.origin.z = hand.position.z;
  out.direction.x = wx;
  out.direction.y = wy;
  out.direction.z = wz;
  out.strength = clamp(strength, 0, params.maxStrength) * gain;
  out.radius = params.radius;
  return sweep;
}

/**
 * Turns raw palm poses into clean HandSamples: velocity by finite differences,
 * low-passed so tracking jitter never becomes wind, with teleports (tracking
 * loss / re-acquisition) rejected instead of turned into hurricanes.
 */
export class HandFilter {
  readonly sample: HandSample = createHandSample();
  /** Smoothing rate for velocity (1/s). Higher = snappier, noisier. */
  velocityRate = 22;
  /** Smoothing rate for the palm normal (1/s). */
  normalRate = 28;
  /** Jumps faster than this (m/s) are treated as tracking glitches. */
  maxSpeed = 60;
  private primed = false;
  private readonly last: Vec3 = vec3();

  reset(): void {
    this.primed = false;
    this.sample.velocity.x = this.sample.velocity.y = this.sample.velocity.z = 0;
  }

  /** Feed one raw pose. `dt` is the time since the previous pose. */
  update(position: Vec3, palmNormal: Vec3, dt: number): HandSample {
    const s = this.sample;
    if (!this.primed || dt <= 0) {
      this.primed = true;
      s.velocity.x = s.velocity.y = s.velocity.z = 0;
      s.palmNormal.x = palmNormal.x;
      s.palmNormal.y = palmNormal.y;
      s.palmNormal.z = palmNormal.z;
    } else {
      const rx = (position.x - this.last.x) / dt;
      const ry = (position.y - this.last.y) / dt;
      const rz = (position.z - this.last.z) / dt;
      const raw2 = rx * rx + ry * ry + rz * rz;
      if (raw2 < this.maxSpeed * this.maxSpeed) {
        const k = damp(this.velocityRate, dt);
        s.velocity.x += (rx - s.velocity.x) * k;
        s.velocity.y += (ry - s.velocity.y) * k;
        s.velocity.z += (rz - s.velocity.z) * k;
      }
      const kn = damp(this.normalRate, dt);
      const n = s.palmNormal;
      n.x += (palmNormal.x - n.x) * kn;
      n.y += (palmNormal.y - n.y) * kn;
      n.z += (palmNormal.z - n.z) * kn;
      const l = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      if (l > 1e-6) {
        n.x /= l;
        n.y /= l;
        n.z /= l;
      } else {
        n.x = palmNormal.x;
        n.y = palmNormal.y;
        n.z = palmNormal.z;
      }
    }
    s.position.x = this.last.x = position.x;
    s.position.y = this.last.y = position.y;
    s.position.z = this.last.z = position.z;
    return s;
  }
}
