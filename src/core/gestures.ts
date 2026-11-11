/**
 * HAND VERBS — the entire control scheme, recognised from HandSamples alone.
 *
 *   1. open palm, still        -> steady stream along the palm normal
 *   2. fast sweep              -> gust along the motion
 *   3. both palms up together  -> updraft column
 *   4. clap                    -> shockwave ring
 *   5. circular motion         -> whirlwind you can orbit the seed with
 *
 * `HandWind` owns a few persistent sources inside a WindField and reshapes them
 * every fixed step. It allocates nothing after construction (claps reuse a
 * small pool) and has no idea whether the hands are real.
 */
import { type Vec3, clamp, clamp01, damp, vec3 } from './vec3.js';
import { DEFAULT_HAND_WIND, type HandSample, type HandWindParams, handToStream } from './hands.js';
import {
  type ShockwaveSource,
  type StreamSource,
  type ThermalSource,
  type VortexSource,
  type WindField,
  createShockwave,
  createStream,
  createThermal,
  createVortex,
} from './wind.js';

export interface GestureParams {
  hand: HandWindParams;
  /**
   * Simulation metres per metre of real hand travel. Human-scale thresholds
   * below (marked "hand m") are multiplied by this, so the same recogniser
   * works for a 1:1 world and for a miniature diorama.
   */
  unitScale: number;

  // ── updraft: both palms up together ──
  /** Minimum upward component of each palm normal. */
  updraftPalmUp: number;
  /** Max horizontal distance between the palms (hand m). */
  updraftMaxSeparation: number;
  /** Max height difference between the palms (hand m). */
  updraftMaxHeightDiff: number;
  /** Seconds to build to full strength / to fade once released. */
  updraftAttack: number;
  updraftRelease: number;
  /** Column strength (m/s) at rest, and per m/s of raising the hands. */
  updraftStrength: number;
  updraftRaiseGain: number;
  updraftMaxStrength: number;
  updraftHeight: number;
  /** Inward draw of the column: a seed over cupped hands is pulled to their centre and follows them. */
  updraftEntrain: number;

  // ── clap ──
  /** Palms closer than this have met (hand m). */
  clapDistance: number;
  /** Palms must separate past this before the next clap (hand m). */
  clapRearmDistance: number;
  /** Minimum closing speed just before contact (hand m/s). */
  clapMinClosingSpeed: number;
  clapCooldown: number;
  clapStrength: number;
  clapSpeed: number;
  clapThickness: number;
  clapDuration: number;

  // ── whirlwind: circular motion ──
  /** Hand must move at least this fast to be "stirring" (hand m/s). */
  whirlMinSpeed: number;
  /** Accepted radius of the stirred circle (hand m). */
  whirlMinRadius: number;
  whirlMaxRadius: number;
  /** Turns of continuous circling needed to raise a whirlwind. */
  whirlTurns: number;
  whirlStrength: number;
  /** Extra tangential speed per m/s of hand speed. */
  whirlSpeedGain: number;
  whirlMaxStrength: number;
  whirlRadius: number;
  whirlCore: number;
  whirlHalfHeight: number;
  whirlInflow: number;
  whirlLift: number;
  /** Seconds a whirlwind lingers once the hand stops stirring. */
  whirlRelease: number;
}

export const DEFAULT_GESTURES: GestureParams = {
  hand: DEFAULT_HAND_WIND,
  unitScale: 1,

  updraftPalmUp: 0.55,
  updraftMaxSeparation: 0.75,
  updraftMaxHeightDiff: 0.3,
  updraftAttack: 0.35,
  updraftRelease: 1.1,
  updraftStrength: 3.6,
  updraftRaiseGain: 0.45,
  updraftMaxStrength: 8,
  updraftHeight: 4.5,
  updraftEntrain: 0.45,

  clapDistance: 0.11,
  clapRearmDistance: 0.2,
  clapMinClosingSpeed: 0.8,
  clapCooldown: 0.4,
  clapStrength: 9,
  clapSpeed: 9,
  clapThickness: 0.55,
  clapDuration: 1.0,

  whirlMinSpeed: 0.3,
  whirlMinRadius: 0.025,
  whirlMaxRadius: 0.45,
  whirlTurns: 0.9,
  whirlStrength: 5,
  whirlSpeedGain: 0.25,
  whirlMaxStrength: 8,
  whirlRadius: 1.9,
  whirlCore: 0.4,
  whirlHalfHeight: 1.8,
  whirlInflow: 0.78,
  whirlLift: 3.4,
  whirlRelease: 2.6,
};

export type GestureEvent =
  | { type: 'gust'; hand: 0 | 1; strength: number; position: Vec3 }
  | { type: 'clap'; strength: number; position: Vec3 }
  | { type: 'updraft'; strength: number; position: Vec3 }
  | { type: 'whirl'; strength: number; position: Vec3 };

/** Per-hand state of the circular-motion recogniser. */
class Stir {
  readonly prevDir: Vec3 = vec3();
  hasPrev = false;
  /** Leaky running average of the rotation axis. */
  readonly axis: Vec3 = vec3();
  /** Smoothed centre of the stirred circle. */
  readonly center: Vec3 = vec3();
  hasCenter = false;
  /** Accumulated continuous turning (rad). */
  turn = 0;
  speed = 0;

  reset(): void {
    this.hasPrev = false;
    this.hasCenter = false;
    this.turn = 0;
    this.axis.x = this.axis.y = this.axis.z = 0;
  }

  update(hand: HandSample, p: GestureParams, dt: number): void {
    const v = hand.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    this.speed = speed;
    const minSpeed = p.whirlMinSpeed * p.unitScale;
    // continuous circling only: turning leaks away when the hand hesitates
    this.turn *= Math.exp(-0.7 * dt);
    if (speed < minSpeed) {
      this.turn *= Math.exp(-4 * dt);
      this.hasPrev = false;
      return;
    }
    const dx = v.x / speed;
    const dy = v.y / speed;
    const dz = v.z / speed;
    if (this.hasPrev) {
      const pd = this.prevDir;
      const cx = pd.y * dz - pd.z * dy;
      const cy = pd.z * dx - pd.x * dz;
      const cz = pd.x * dy - pd.y * dx;
      const sin = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const cos = pd.x * dx + pd.y * dy + pd.z * dz;
      const dTheta = Math.atan2(sin, cos);
      if (sin > 1e-6 && dTheta > 1e-5) {
        const radius = (speed * dt) / dTheta;
        const ix = cx / sin;
        const iy = cy / sin;
        const iz = cz / sin;
        const a = this.axis;
        const al = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        const agree = al > 1e-3 ? (ix * a.x + iy * a.y + iz * a.z) / al : 1;
        const k = damp(5, dt);
        a.x += (ix - a.x) * k;
        a.y += (iy - a.y) * k;
        a.z += (iz - a.z) * k;
        const okRadius = radius > p.whirlMinRadius * p.unitScale && radius < p.whirlMaxRadius * p.unitScale;
        if (okRadius && agree > 0.4) {
          this.turn += dTheta;
          // the circle's centre lies to the inside of the turn: axis x direction
          const nx = iy * dz - iz * dy;
          const ny = iz * dx - ix * dz;
          const nz = ix * dy - iy * dx;
          const px = hand.position.x + nx * radius;
          const py = hand.position.y + ny * radius;
          const pz = hand.position.z + nz * radius;
          if (!this.hasCenter) {
            this.center.x = px;
            this.center.y = py;
            this.center.z = pz;
            this.hasCenter = true;
          } else {
            const kc = damp(4, dt);
            this.center.x += (px - this.center.x) * kc;
            this.center.y += (py - this.center.y) * kc;
            this.center.z += (pz - this.center.z) * kc;
          }
        } else if (agree < 0) {
          // reversed direction: this is a wiggle, not a stir
          this.turn *= Math.exp(-10 * dt);
        } else {
          this.turn *= Math.exp(-2.5 * dt);
        }
      }
    }
    this.prevDir.x = dx;
    this.prevDir.y = dy;
    this.prevDir.z = dz;
    this.hasPrev = true;
  }
}

const CLAP_POOL = 4;

export class HandWind {
  readonly params: GestureParams;
  readonly field: WindField;

  /** One stream per hand: [left, right]. */
  readonly streams: [StreamSource, StreamSource];
  readonly updraft: ThermalSource;
  readonly vortex: VortexSource;

  /** 0..1 sweepiness of each hand this step (0 resting palm, 1 full gust). */
  readonly sweep: [number, number] = [0, 0];
  /** 0..1 charge of the two-palm updraft. */
  updraftLevel = 0;
  /** 0..1 life of the whirlwind. */
  whirlLevel = 0;
  /** Peak air speed the player is producing right now (m/s) — for audio and feedback. */
  energy = 0;
  /** Events raised during the last update. Cleared at the start of each update. */
  readonly events: GestureEvent[] = [];

  private readonly stirs: [Stir, Stir] = [new Stir(), new Stir()];
  private whirlOwner = -1;
  private readonly gustCooldown: [number, number] = [0, 0];
  private readonly wasSweeping: [boolean, boolean] = [false, false];
  private clapArmed = true;
  private clapCooldown = 0;
  private peakClosing = 0;
  private updraftAnnounced = false;
  private whirlAnnounced = false;
  private readonly clapPool: ShockwaveSource[] = [];
  private clapIndex = 0;
  private readonly eventPositions: Vec3[] = [];
  private eventPosIndex = 0;

  constructor(field: WindField, params: GestureParams = DEFAULT_GESTURES) {
    this.field = field;
    this.params = params;
    this.streams = [
      field.add(createStream({ strength: 0, enabled: false, tag: 'hand:left' })),
      field.add(createStream({ strength: 0, enabled: false, tag: 'hand:right' })),
    ];
    this.updraft = field.add(createThermal({ strength: 0, enabled: false, tag: 'hand:updraft' }));
    this.vortex = field.add(createVortex({ strength: 0, enabled: false, tag: 'hand:whirl' }));
    for (let i = 0; i < CLAP_POOL; i++) this.clapPool.push(createShockwave({ tag: 'hand:clap' }));
    for (let i = 0; i < 8; i++) this.eventPositions.push(vec3());
  }

  /** Re-register the persistent sources after `field.clear()`. */
  attach(): void {
    const f = this.field;
    for (const s of [this.streams[0], this.streams[1], this.updraft, this.vortex]) {
      if (f.sources.indexOf(s) < 0) f.add(s);
    }
  }

  private eventPos(x: number, y: number, z: number): Vec3 {
    const p = this.eventPositions[this.eventPosIndex];
    this.eventPosIndex = (this.eventPosIndex + 1) % this.eventPositions.length;
    p.x = x;
    p.y = y;
    p.z = z;
    return p;
  }

  /** Spawn a shockwave at a point (used by the clap and available to adapters). */
  shock(x: number, y: number, z: number, strength: number): ShockwaveSource {
    const p = this.params;
    const s = this.clapPool[this.clapIndex];
    this.clapIndex = (this.clapIndex + 1) % CLAP_POOL;
    this.field.remove(s);
    s.center.x = x;
    s.center.y = y;
    s.center.z = z;
    s.strength = strength;
    s.speed = p.clapSpeed;
    s.thickness = p.clapThickness;
    s.duration = p.clapDuration;
    s.age = 0;
    this.field.add(s);
    return s;
  }

  /**
   * Feed this step's hands (null = not tracked) and reshape the wind.
   * Call once per fixed physics step, before stepping seeds.
   */
  update(left: HandSample | null, right: HandSample | null, dt: number): void {
    const p = this.params;
    const scale = p.unitScale;
    this.events.length = 0;
    let energy = 0;

    // ── verbs 1 + 2: palm stream and sweep gust ──────────────────────────────
    // A stirring hand lends its air to the whirlwind instead of batting the seed about.
    for (let i = 0; i < 2; i++) {
      const hand = i === 0 ? left : right;
      const stream = this.streams[i];
      this.gustCooldown[i] -= dt;
      if (hand === null) {
        stream.enabled = false;
        stream.strength = 0;
        this.sweep[i] = 0;
        this.wasSweeping[i] = false;
        this.stirs[i].reset();
        continue;
      }
      const stirring = this.whirlOwner === i ? clamp01(this.whirlLevel) : 0;
      stream.enabled = true;
      const sweep = handToStream(hand, p.hand, stream, 1 - 0.6 * stirring);
      this.sweep[i] = sweep;
      if (stream.strength > energy) energy = stream.strength;
      const sweeping = sweep > 0.6;
      if (sweeping && !this.wasSweeping[i] && this.gustCooldown[i] <= 0) {
        this.gustCooldown[i] = 0.25;
        this.events.push({
          type: 'gust',
          hand: i as 0 | 1,
          strength: stream.strength,
          position: this.eventPos(hand.position.x, hand.position.y, hand.position.z),
        });
      }
      this.wasSweeping[i] = sweeping;
      this.stirs[i].update(hand, p, dt);
    }

    // ── verb 3: both palms up -> updraft ─────────────────────────────────────
    let lifting = false;
    if (left !== null && right !== null) {
      const dx = left.position.x - right.position.x;
      const dz = left.position.z - right.position.z;
      const sep = Math.sqrt(dx * dx + dz * dz);
      const dy = Math.abs(left.position.y - right.position.y);
      lifting =
        left.palmNormal.y > p.updraftPalmUp &&
        right.palmNormal.y > p.updraftPalmUp &&
        sep < p.updraftMaxSeparation * scale &&
        dy < p.updraftMaxHeightDiff * scale;
      if (lifting) {
        const up = this.updraft;
        const tx = (left.position.x + right.position.x) * 0.5;
        const tz = (left.position.z + right.position.z) * 0.5;
        const ty = Math.min(left.position.y, right.position.y);
        if (this.updraftLevel < 0.05) {
          up.base.x = tx;
          up.base.y = ty;
          up.base.z = tz;
        } else {
          const k = damp(14, dt);
          up.base.x += (tx - up.base.x) * k;
          up.base.y += (ty - up.base.y) * k;
          up.base.z += (tz - up.base.z) * k;
        }
        up.radius = clamp(sep * 0.5 + 0.7, 0.8, 1.7);
        const raise = Math.max(0, (left.velocity.y + right.velocity.y) * 0.5);
        const target = clamp(p.updraftStrength + p.updraftRaiseGain * raise, 0, p.updraftMaxStrength);
        this.updraftTarget += (target - this.updraftTarget) * damp(8, dt);
      }
    }
    this.updraftLevel = clamp01(this.updraftLevel + (lifting ? dt / p.updraftAttack : -dt / p.updraftRelease));
    {
      const up = this.updraft;
      up.height = p.updraftHeight;
      up.entrain = p.updraftEntrain;
      // ease-in so the column swells rather than snaps
      const level = this.updraftLevel * this.updraftLevel * (3 - 2 * this.updraftLevel);
      up.strength = this.updraftTarget * level;
      up.enabled = up.strength > 0.01;
      if (up.strength > energy) energy = up.strength;
      if (lifting && this.updraftLevel > 0.5 && !this.updraftAnnounced) {
        this.updraftAnnounced = true;
        this.events.push({
          type: 'updraft',
          strength: this.updraftTarget,
          position: this.eventPos(up.base.x, up.base.y, up.base.z),
        });
      }
      if (this.updraftLevel <= 0.05) this.updraftAnnounced = false;
    }

    // ── verb 4: clap -> shockwave ────────────────────────────────────────────
    this.clapCooldown -= dt;
    this.peakClosing *= Math.exp(-9 * dt);
    if (left !== null && right !== null) {
      const dx = left.position.x - right.position.x;
      const dy = left.position.y - right.position.y;
      const dz = left.position.z - right.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 1e-6) {
        const closing =
          -((left.velocity.x - right.velocity.x) * dx +
            (left.velocity.y - right.velocity.y) * dy +
            (left.velocity.z - right.velocity.z) * dz) / dist;
        if (closing > this.peakClosing) this.peakClosing = closing;
      }
      if (dist > p.clapRearmDistance * scale) this.clapArmed = true;
      if (
        this.clapArmed &&
        this.clapCooldown <= 0 &&
        dist < p.clapDistance * scale &&
        this.peakClosing > p.clapMinClosingSpeed * scale
      ) {
        this.clapArmed = false;
        this.clapCooldown = p.clapCooldown;
        const cx = (left.position.x + right.position.x) * 0.5;
        const cy = (left.position.y + right.position.y) * 0.5;
        const cz = (left.position.z + right.position.z) * 0.5;
        // a harder clap makes a harder ring
        const hardness = clamp(this.peakClosing / (p.clapMinClosingSpeed * scale * 3), 0.6, 1.5);
        const strength = p.clapStrength * hardness;
        this.shock(cx, cy, cz, strength);
        this.peakClosing = 0;
        this.events.push({ type: 'clap', strength, position: this.eventPos(cx, cy, cz) });
        if (strength > energy) energy = strength;
      }
    } else {
      this.clapArmed = true;
    }

    // ── verb 5: circular motion -> whirlwind ─────────────────────────────────
    const need = p.whirlTurns * 6.283;
    if (this.whirlOwner >= 0) {
      const stir = this.stirs[this.whirlOwner];
      const hand = this.whirlOwner === 0 ? left : right;
      if (hand === null || stir.turn < need * 0.45) this.whirlOwner = -1;
    }
    if (this.whirlOwner < 0) {
      for (let i = 0; i < 2; i++) {
        if (this.stirs[i].turn >= need && this.stirs[i].hasCenter) {
          this.whirlOwner = i;
          break;
        }
      }
    }
    const vortex = this.vortex;
    if (this.whirlOwner >= 0) {
      const stir = this.stirs[this.whirlOwner];
      const a = stir.axis;
      const al = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (al > 1e-3) {
        const first = this.whirlLevel < 0.05;
        const k = first ? 1 : damp(6, dt);
        vortex.axis.x += (a.x / al - vortex.axis.x) * k;
        vortex.axis.y += (a.y / al - vortex.axis.y) * k;
        vortex.axis.z += (a.z / al - vortex.axis.z) * k;
        const vl = Math.sqrt(
          vortex.axis.x * vortex.axis.x + vortex.axis.y * vortex.axis.y + vortex.axis.z * vortex.axis.z,
        );
        if (vl > 1e-6) {
          vortex.axis.x /= vl;
          vortex.axis.y /= vl;
          vortex.axis.z /= vl;
        }
        const kc = first ? 1 : damp(5, dt);
        vortex.center.x += (stir.center.x - vortex.center.x) * kc;
        vortex.center.y += (stir.center.y - vortex.center.y) * kc;
        vortex.center.z += (stir.center.z - vortex.center.z) * kc;
      }
      const target = clamp(p.whirlStrength + p.whirlSpeedGain * stir.speed, 0, p.whirlMaxStrength);
      this.whirlTarget += (target - this.whirlTarget) * damp(5, dt);
      this.whirlLevel = clamp01(this.whirlLevel + dt / 0.45);
      if (!this.whirlAnnounced && this.whirlLevel > 0.4) {
        this.whirlAnnounced = true;
        this.events.push({
          type: 'whirl',
          strength: this.whirlTarget,
          position: this.eventPos(vortex.center.x, vortex.center.y, vortex.center.z),
        });
      }
    } else {
      this.whirlLevel = clamp01(this.whirlLevel - dt / p.whirlRelease);
      if (this.whirlLevel <= 0.02) this.whirlAnnounced = false;
    }
    vortex.radius = p.whirlRadius;
    vortex.coreRadius = p.whirlCore;
    vortex.halfHeight = p.whirlHalfHeight;
    vortex.inflow = p.whirlInflow;
    vortex.strength = this.whirlTarget * this.whirlLevel;
    vortex.lift = p.whirlLift * this.whirlLevel;
    vortex.enabled = this.whirlLevel > 0.01;
    if (vortex.strength > energy) energy = vortex.strength;

    this.energy = energy;
  }

  private updraftTarget = DEFAULT_GESTURES.updraftStrength;
  private whirlTarget = DEFAULT_GESTURES.whirlStrength;
}
