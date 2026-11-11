/**
 * THE SEED
 *
 * A free point mass: gravity pulls it down, drag pulls it toward the air around
 * it. That is the whole of its motion — it is never held, attached to a hand,
 * or teleported. Only wind moves it.
 *
 *   a = g + drag * (wind - velocity)        terminal fall = g / drag ≈ 2.45 m/s
 *
 * Everything else here is FEEL: a flutter that swings it side to side as it
 * falls, a pappus that trails into the airflow and overshoots when the wind
 * turns, a spin that picks up in shear, and a glow that brightens when the air
 * is alive. Feel never adds net thrust: the flutter is zero-mean.
 */
import { type Vec3, clamp01, damp, vec3 } from './vec3.js';
import type { WindField } from './wind.js';
import { type Contact, type Terrain, createContact, isOutOfWorld, resolveTerrain } from './terrain.js';

export interface SeedParams {
  /** m/s², positive down. */
  gravity: number;
  /** 1/s. Pull toward the relative airflow. */
  drag: number;
  /** Lateral flutter acceleration per m/s of relative airflow. */
  flutter: number;
  /** Base flutter frequency (Hz). */
  flutterHz: number;
  /** Spring pulling the pappus axis into the airflow (1/s²) and its damping (1/s). */
  axisSpring: number;
  axisDamping: number;
  /** Extra downward acceleration at rain = 1 (m/s²). A wet seed is a heavy seed. */
  rainAccel: number;
  /** Collision radius (m). */
  radius: number;
  /** Fraction of normal velocity kept on impact. */
  restitution: number;
  /** Tangential velocity decay while touching a surface (1/s). */
  friction: number;
  /** Player wind speed (m/s) above which a seed starts to tear loose from its dandelion. */
  pluckThreshold: number;
  /** Safety clamp on speed (m/s). */
  maxSpeed: number;
}

export const DEFAULT_SEED_PARAMS: SeedParams = {
  gravity: 9.81,
  drag: 4.0,
  flutter: 1.3,
  flutterHz: 1.15,
  axisSpring: 58,
  axisDamping: 4.6,
  rainAccel: 1.5,
  radius: 0.07,
  restitution: 0.12,
  friction: 7,
  pluckThreshold: 1.0,
  maxSpeed: 40,
};

export type SeedStatus =
  /** Still on its dandelion, waiting for the player's first breath. */
  | 'attached'
  | 'flying'
  /** Touched fertile ground and took root. */
  | 'planted'
  /** Fell into the cloud sea or left the world. */
  | 'lost';

export interface Seed {
  id: number;
  status: SeedStatus;
  pos: Vec3;
  vel: Vec3;
  /** Position before the last step, for render interpolation. */
  prevPos: Vec3;
  /** Unit axis from the achene to the pappus (the "parachute"). */
  axis: Vec3;
  prevAxis: Vec3;
  axisVel: Vec3;
  /** Rotation about `axis` (rad) and its rate (rad/s). */
  spin: number;
  spinRate: number;
  /** Flutter oscillator phase (rad). */
  phase: number;
  /** 0..~1.6: how alive the air around the seed is. Drives glow, trail, sound. */
  glow: number;
  /** Wind at the seed and the air's velocity relative to it (last step). */
  wind: Vec3;
  airflow: Vec3;
  /** Smoothed local shear magnitude (1/s). */
  shear: number;
  /** Seconds since release (or since creation while attached). */
  age: number;
  /** True while touching terrain this step. */
  touching: boolean;
  /** Where the seed sits while attached. */
  anchor: Vec3;
  /** 0..1 progress of tearing loose from the dandelion. */
  pluck: number;
  /** Per-seed constant in [0, 1): detunes flutter so a flock never moves in lockstep. */
  variation: number;
  /** Seconds since the seed was planted or lost (for fades). */
  restTime: number;
  /** Island the seed took root on. */
  plantedOn: number;
}

let nextSeedId = 1;

export function createSeed(anchor: Vec3, variation = 0.5, status: SeedStatus = 'attached'): Seed {
  return {
    id: nextSeedId++,
    status,
    pos: vec3(anchor.x, anchor.y, anchor.z),
    vel: vec3(),
    prevPos: vec3(anchor.x, anchor.y, anchor.z),
    axis: vec3(0, 1, 0),
    prevAxis: vec3(0, 1, 0),
    axisVel: vec3(),
    spin: variation * 6.283,
    spinRate: 0,
    phase: variation * 6.283,
    glow: 0.5,
    wind: vec3(),
    airflow: vec3(),
    shear: 0,
    age: 0,
    touching: false,
    anchor: vec3(anchor.x, anchor.y, anchor.z),
    pluck: 0,
    variation,
    restTime: 0,
    plantedOn: -1,
  };
}

export interface SeedEnvironment {
  /** 0..1 rain intensity at the seed. */
  rain: number;
  terrain: Terrain | null;
}

export const STILL_AIR: SeedEnvironment = { rain: 0, terrain: null };

const probe = vec3();
const windProbe = vec3();
const e1 = vec3();
const e2 = vec3();
const target = vec3();
const contact: Contact = createContact();

/** Distance along the pappus axis at which shear is probed (m). */
const SHEAR_PROBE = 0.22;

function stepAxis(seed: Seed, tx: number, ty: number, tz: number, params: SeedParams, dt: number): void {
  const ax = seed.axis;
  const av = seed.axisVel;
  const k = params.axisSpring;
  const c = params.axisDamping;
  av.x += (k * (tx - ax.x) - c * av.x) * dt;
  av.y += (k * (ty - ax.y) - c * av.y) * dt;
  av.z += (k * (tz - ax.z) - c * av.z) * dt;
  ax.x += av.x * dt;
  ax.y += av.y * dt;
  ax.z += av.z * dt;
  const l = Math.sqrt(ax.x * ax.x + ax.y * ax.y + ax.z * ax.z);
  if (l < 1e-6) {
    ax.x = 0;
    ax.y = 1;
    ax.z = 0;
  } else {
    ax.x /= l;
    ax.y /= l;
    ax.z /= l;
  }
}

/** Release an attached seed into the air with an initial velocity. */
export function releaseSeed(seed: Seed, vx = 0, vy = 0, vz = 0): void {
  if (seed.status !== 'attached') return;
  seed.status = 'flying';
  seed.vel.x = vx;
  seed.vel.y = vy;
  seed.vel.z = vz;
  seed.age = 0;
  seed.pluck = 1;
}

/**
 * Advance one seed by `dt` (semi-implicit Euler: velocity first, then position).
 * Returns the seed's status after the step.
 */
export function stepSeed(
  seed: Seed,
  field: WindField,
  dt: number,
  params: SeedParams = DEFAULT_SEED_PARAMS,
  env: SeedEnvironment = STILL_AIR,
): SeedStatus {
  seed.prevPos.x = seed.pos.x;
  seed.prevPos.y = seed.pos.y;
  seed.prevPos.z = seed.pos.z;
  seed.prevAxis.x = seed.axis.x;
  seed.prevAxis.y = seed.axis.y;
  seed.prevAxis.z = seed.axis.z;
  seed.age += dt;

  if (seed.status === 'planted' || seed.status === 'lost') {
    seed.restTime += dt;
    if (seed.status === 'lost') {
      // keep drifting down into the clouds while it fades — no teleport, no pop
      seed.vel.y -= params.gravity * 0.2 * dt;
      seed.pos.x += seed.vel.x * dt;
      seed.pos.y += seed.vel.y * dt;
      seed.pos.z += seed.vel.z * dt;
    }
    seed.glow += (0 - seed.glow) * damp(1.5, dt);
    return seed.status;
  }

  const wind = seed.wind;

  if (seed.status === 'attached') {
    // Only the PLAYER's wind can pluck a seed: weather may tug at it, never free it.
    field.samplePlayer(seed.anchor, windProbe);
    const playerSpeed = Math.sqrt(windProbe.x * windProbe.x + windProbe.y * windProbe.y + windProbe.z * windProbe.z);
    field.sample(seed.anchor, wind);
    seed.airflow.x = wind.x;
    seed.airflow.y = wind.y;
    seed.airflow.z = wind.z;
    const over = playerSpeed - params.pluckThreshold;
    // one decent sweep is enough: magic must happen on the very first gesture
    if (over > 0) seed.pluck += over * 7 * dt;
    else seed.pluck -= 0.5 * dt;
    seed.pluck = clamp01(seed.pluck);
    // strain against the stem: lean and tremble with the wind
    seed.phase += 6.283 * (params.flutterHz * 2 + playerSpeed * 0.5) * dt;
    const tremble = 0.05 * seed.pluck * Math.sin(seed.phase * 3.1);
    stepAxis(seed, wind.x * 0.3 + tremble, 1, wind.z * 0.3 - tremble, params, dt);
    seed.pos.x = seed.anchor.x + seed.axis.x * 0.02;
    seed.pos.y = seed.anchor.y;
    seed.pos.z = seed.anchor.z + seed.axis.z * 0.02;
    const glowTarget = 0.5 + 0.7 * seed.pluck + 0.12 * Math.sin(seed.age * 2.2 + seed.variation * 6.283);
    seed.glow += (glowTarget - seed.glow) * damp(8, dt);
    if (seed.pluck >= 1) releaseSeed(seed, wind.x * 0.35, wind.y * 0.35, wind.z * 0.35);
    return seed.status;
  }

  // ── flying ────────────────────────────────────────────────────────────────
  const pos = seed.pos;
  const vel = seed.vel;
  field.sample(pos, wind);

  // local shear: how differently the air moves a pappus-length away
  probe.x = pos.x + seed.axis.x * SHEAR_PROBE;
  probe.y = pos.y + seed.axis.y * SHEAR_PROBE;
  probe.z = pos.z + seed.axis.z * SHEAR_PROBE;
  field.sample(probe, windProbe);
  const sx = windProbe.x - wind.x;
  const sy = windProbe.y - wind.y;
  const sz = windProbe.z - wind.z;
  const shearNow = Math.sqrt(sx * sx + sy * sy + sz * sz) / SHEAR_PROBE;
  seed.shear += (shearNow - seed.shear) * damp(10, dt);

  const rel = seed.airflow;
  rel.x = wind.x - vel.x;
  rel.y = wind.y - vel.y;
  rel.z = wind.z - vel.z;
  const relSpeed = Math.sqrt(rel.x * rel.x + rel.y * rel.y + rel.z * rel.z);

  let ax = params.drag * rel.x;
  let ay = params.drag * rel.y - params.gravity - env.rain * params.rainAccel;
  let az = params.drag * rel.z;

  // flutter: a zero-mean lateral swing, perpendicular to the airflow
  if (relSpeed > 1e-4 && params.flutter > 0) {
    const inv = 1 / relSpeed;
    const nx = rel.x * inv;
    const ny = rel.y * inv;
    const nz = rel.z * inv;
    // e1 = n x (a stable reference axis), e2 = n x e1
    if (Math.abs(ny) < 0.9) {
      e1.x = -nz;
      e1.y = 0;
      e1.z = nx;
    } else {
      e1.x = 0;
      e1.y = nz;
      e1.z = -ny;
    }
    const l1 = 1 / Math.sqrt(e1.x * e1.x + e1.y * e1.y + e1.z * e1.z);
    e1.x *= l1;
    e1.y *= l1;
    e1.z *= l1;
    e2.x = ny * e1.z - nz * e1.y;
    e2.y = nz * e1.x - nx * e1.z;
    e2.z = nx * e1.y - ny * e1.x;
    seed.phase += 6.283 * (params.flutterHz * (0.85 + 0.3 * seed.variation) + 0.2 * relSpeed) * dt;
    const amp = params.flutter * Math.min(relSpeed, 6) * (1 + Math.min(seed.shear, 6) * 0.35);
    const f1 = amp * Math.sin(seed.phase);
    const f2 = amp * 0.6 * Math.sin(seed.phase * 0.618 + seed.variation * 6.283);
    ax += e1.x * f1 + e2.x * f2;
    ay += e1.y * f1 + e2.y * f2;
    az += e1.z * f1 + e2.z * f2;
  }

  // semi-implicit Euler: velocity first, position from the NEW velocity
  vel.x += ax * dt;
  vel.y += ay * dt;
  vel.z += az * dt;
  const speed2 = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
  if (speed2 > params.maxSpeed * params.maxSpeed) {
    const s = params.maxSpeed / Math.sqrt(speed2);
    vel.x *= s;
    vel.y *= s;
    vel.z *= s;
  }
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;

  // ── terrain ───────────────────────────────────────────────────────────────
  seed.touching = false;
  const terrain = env.terrain;
  if (terrain !== null) {
    resolveTerrain(terrain, pos, params.radius, contact);
    if (contact.hit) {
      seed.touching = true;
      const n = contact.normal;
      const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
      if (vn < 0) {
        const j = (1 + params.restitution) * vn;
        vel.x -= n.x * j;
        vel.y -= n.y * j;
        vel.z -= n.z * j;
      }
      const keep = Math.exp(-params.friction * dt);
      vel.x *= keep;
      vel.y *= keep;
      vel.z *= keep;
      if (contact.fertile && contact.island !== null) {
        seed.status = 'planted';
        seed.plantedOn = contact.island.id;
        seed.restTime = 0;
        vel.x = vel.y = vel.z = 0;
        return seed.status;
      }
    }
    if (isOutOfWorld(terrain, pos)) {
      seed.status = 'lost';
      seed.restTime = 0;
      return seed.status;
    }
  }

  // ── feel: the pappus trails into the airflow, with spring overshoot ────────
  // In still air the airflow is straight up (the seed is falling), so the
  // parachute rides above the achene. A gust swings it downstream.
  const bias = 1.4;
  target.x = rel.x;
  target.y = rel.y + bias;
  target.z = rel.z;
  const tl = Math.sqrt(target.x * target.x + target.y * target.y + target.z * target.z);
  if (tl > 1e-6) {
    target.x /= tl;
    target.y /= tl;
    target.z /= tl;
  } else {
    target.x = 0;
    target.y = 1;
    target.z = 0;
  }
  // shear kicks the axis around: turbulence you can see
  const kick = Math.min(seed.shear, 8) * 0.9 * dt;
  seed.axisVel.x += kick * Math.sin(seed.phase * 1.7);
  seed.axisVel.z += kick * Math.cos(seed.phase * 1.3);
  stepAxis(seed, target.x, target.y, target.z, params, dt);

  const spinTarget = (0.6 + relSpeed * 1.1 + seed.shear * 1.5) * (seed.variation < 0.5 ? 1 : -1);
  seed.spinRate += (spinTarget - seed.spinRate) * damp(3, dt);
  seed.spin += seed.spinRate * dt;

  const breath = 0.14 * Math.sin(seed.age * 2.8 + seed.variation * 6.283);
  const glowTarget = 0.62 + 0.55 * clamp01(relSpeed / 6) + 0.35 * clamp01(seed.shear / 5) + breath;
  seed.glow += (glowTarget - seed.glow) * damp(6, dt);

  return seed.status;
}

/** Interpolated render position between the previous and current physics states. */
export function seedRenderPosition(seed: Seed, alpha: number, out: Vec3): Vec3 {
  out.x = seed.prevPos.x + (seed.pos.x - seed.prevPos.x) * alpha;
  out.y = seed.prevPos.y + (seed.pos.y - seed.prevPos.y) * alpha;
  out.z = seed.prevPos.z + (seed.pos.z - seed.prevPos.z) * alpha;
  return out;
}
