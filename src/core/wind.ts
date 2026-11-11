/**
 * THE WIND FIELD
 *
 * An analytic sum of sources, evaluated on demand at any point. There is no
 * grid, no solver, no allocation: sampling is a handful of dot products per
 * source, so the seed, thirty flock seeds, hundreds of grass tufts, petals,
 * rain and audio can all read the very same air every frame.
 *
 * Four source types make up everything the player and the weather can do:
 *
 *   stream     directional cone       (a palm, a sweep, a storm front)
 *   vortex     tangential swirl       (the whirlwind)
 *   thermal    vertical rising column (two palms up, golden-hour thermals)
 *   shockwave  expanding ring impulse (the clap)
 *
 * Units are SI: metres, seconds, metres/second.
 */
import { type Vec3, clamp01, smoothstep, vec3 } from './vec3.js';

interface SourceBase {
  /** Disabled sources contribute nothing but stay registered (no churn). */
  enabled?: boolean;
  /**
   * Weather sources belong to the sky rather than the player. They are
   * attenuated inside shelter volumes (a tunnel is calm when a storm is not).
   */
  weather?: boolean;
  /** A weather source that ignores shelters (a draft that blows THROUGH the tunnel). */
  piercing?: boolean;
  /** Free-form tag for adapters (e.g. 'hand:left', 'assist'). Never read by the physics. */
  tag?: string;
}

/** Directional cone: strength * alignment^2 * (1 - d/R)^2, zero behind the origin and beyond R. */
export interface StreamSource extends SourceBase {
  kind: 'stream';
  origin: Vec3;
  /** Unit vector. */
  direction: Vec3;
  /** Air speed on the axis at the origin (m/s). */
  strength: number;
  /** Hard radius of influence (m). */
  radius: number;
}

/** Swirl around an axis with a Rankine core, optional inflow (capture) and lift. */
export interface VortexSource extends SourceBase {
  kind: 'vortex';
  center: Vec3;
  /** Unit vector; right-hand rule gives the spin direction. */
  axis: Vec3;
  /** Peak tangential speed, reached at `coreRadius` (m/s). */
  strength: number;
  radius: number;
  coreRadius: number;
  /** Extent along the axis either side of the centre (m). */
  halfHeight: number;
  /** Inward pull as a fraction of tangential speed. Lets bodies settle into orbit. */
  inflow: number;
  /** World-up air speed in the funnel (m/s). A whirlwind carries what it catches. */
  lift: number;
}

/** Vertical column of rising (or, with negative strength, sinking) air. */
export interface ThermalSource extends SourceBase {
  kind: 'thermal';
  /** Centre of the column's foot. */
  base: Vec3;
  radius: number;
  height: number;
  /** Peak vertical speed on the axis (m/s). Negative = downdraft. */
  strength: number;
  /** Gentle inward draw at the foot, as a fraction of strength. */
  entrain: number;
}

/** A ring of outward air that expands at `speed` and fades with age. */
export interface ShockwaveSource extends SourceBase {
  kind: 'shockwave';
  center: Vec3;
  strength: number;
  /** Ring expansion speed (m/s). */
  speed: number;
  /** Gaussian half-thickness of the ring (m). */
  thickness: number;
  /** Lifetime (s). The field removes the source once age >= duration. */
  duration: number;
  age: number;
}

export type WindSource = StreamSource | VortexSource | ThermalSource | ShockwaveSource;

/** Axis-aligned calm pocket: weather is attenuated inside, feathered at the faces. */
export interface Shelter {
  min: Vec3;
  max: Vec3;
  /** Width of the soft edge (m). */
  feather: number;
}

// ── source factories (sane defaults; callers may mutate the result in place) ──

export function createStream(init: Partial<StreamSource> = {}): StreamSource {
  return {
    kind: 'stream',
    origin: init.origin ?? vec3(),
    direction: init.direction ?? vec3(0, 1, 0),
    strength: init.strength ?? 1,
    radius: init.radius ?? 1.5,
    enabled: init.enabled ?? true,
    weather: init.weather ?? false,
    tag: init.tag,
  };
}

export function createVortex(init: Partial<VortexSource> = {}): VortexSource {
  return {
    kind: 'vortex',
    center: init.center ?? vec3(),
    axis: init.axis ?? vec3(0, 1, 0),
    strength: init.strength ?? 4,
    radius: init.radius ?? 1.8,
    coreRadius: init.coreRadius ?? 0.35,
    halfHeight: init.halfHeight ?? 1.6,
    inflow: init.inflow ?? 0.5,
    lift: init.lift ?? 0,
    enabled: init.enabled ?? true,
    weather: init.weather ?? false,
    tag: init.tag,
  };
}

export function createThermal(init: Partial<ThermalSource> = {}): ThermalSource {
  return {
    kind: 'thermal',
    base: init.base ?? vec3(),
    radius: init.radius ?? 0.8,
    height: init.height ?? 4,
    strength: init.strength ?? 3,
    entrain: init.entrain ?? 0.25,
    enabled: init.enabled ?? true,
    weather: init.weather ?? false,
    tag: init.tag,
  };
}

export function createShockwave(init: Partial<ShockwaveSource> = {}): ShockwaveSource {
  return {
    kind: 'shockwave',
    center: init.center ?? vec3(),
    strength: init.strength ?? 8,
    speed: init.speed ?? 9,
    thickness: init.thickness ?? 0.5,
    duration: init.duration ?? 0.9,
    age: init.age ?? 0,
    enabled: init.enabled ?? true,
    weather: init.weather ?? false,
    tag: init.tag,
  };
}

// ── per-source evaluation (each ADDS into `out`, scaled by `gain`) ───────────

/** Fraction of R by which the cone's virtual apex sits behind the origin (gives the cone a mouth). */
const STREAM_APEX = 0.2;
/** Fraction of R over which the flow ramps up in front of the origin plane (keeps the field continuous). */
const STREAM_MOUTH = 0.08;

function addStream(s: StreamSource, p: Vec3, out: Vec3, gain: number): void {
  const rx = p.x - s.origin.x;
  const ry = p.y - s.origin.y;
  const rz = p.z - s.origin.z;
  const d = s.direction;
  const along = rx * d.x + ry * d.y + rz * d.z;
  if (along <= 0) return; // wind never blows upstream
  const d2 = rx * rx + ry * ry + rz * rz;
  const R = s.radius;
  if (d2 >= R * R) return; // hard radius
  const dist = Math.sqrt(d2);
  const apex = STREAM_APEX * R;
  // cosine of the angle off-axis, measured from the virtual apex
  const alignment = (along + apex) / Math.sqrt(d2 + 2 * along * apex + apex * apex);
  const fall = 1 - dist / R;
  const mouth = clamp01(along / (STREAM_MOUTH * R));
  const mag = s.strength * alignment * alignment * fall * fall * mouth * gain;
  out.x += d.x * mag;
  out.y += d.y * mag;
  out.z += d.z * mag;
}

function addVortex(s: VortexSource, p: Vec3, out: Vec3, gain: number): void {
  const rx = p.x - s.center.x;
  const ry = p.y - s.center.y;
  const rz = p.z - s.center.z;
  const a = s.axis;
  const h = rx * a.x + ry * a.y + rz * a.z;
  const hh = s.halfHeight;
  if (h <= -hh || h >= hh) return;
  // radial vector from the axis
  const qx = rx - a.x * h;
  const qy = ry - a.y * h;
  const qz = rz - a.z * h;
  const rho2 = qx * qx + qy * qy + qz * qz;
  const R = s.radius;
  if (rho2 >= R * R) return;
  const rho = Math.sqrt(rho2);
  const hn = h / hh;
  const hfade = 1 - hn * hn;
  const edge = 1 - smoothstep(0.6 * R, R, rho);
  const k = hfade * edge * gain;
  // the funnel carries what it catches: lift across the whole disc, fading at rim and caps
  if (s.lift !== 0) out.y += s.lift * k;
  if (rho < 1e-6) return;
  const inv = 1 / rho;
  const core = s.coreRadius;
  const rankine = rho < core ? rho / core : core / rho;
  const vt = s.strength * rankine * k;
  // tangent = axis x radial
  const tx = (a.y * qz - a.z * qy) * inv;
  const ty = (a.z * qx - a.x * qz) * inv;
  const tz = (a.x * qy - a.y * qx) * inv;
  const vin = -s.inflow * vt * inv;
  out.x += tx * vt + qx * vin;
  out.y += ty * vt + qy * vin;
  out.z += tz * vt + qz * vin;
}

function addThermal(s: ThermalSource, p: Vec3, out: Vec3, gain: number): void {
  const dx = p.x - s.base.x;
  const dz = p.z - s.base.z;
  const rho2 = dx * dx + dz * dz;
  const R = s.radius;
  if (rho2 >= R * R) return;
  const h = p.y - s.base.y;
  if (h <= -0.2 || h >= s.height) return;
  const n = 1 - rho2 / (R * R);
  const radial = n * n;
  const vertical = smoothstep(-0.2, 0.3, h) * (1 - smoothstep(0.7 * s.height, s.height, h));
  const w = s.strength * radial * vertical * gain;
  out.y += w;
  if (s.entrain !== 0 && rho2 > 1e-10) {
    // air is drawn in toward the foot of the column
    const rho = Math.sqrt(rho2);
    const x = rho / R;
    const low = 1 - smoothstep(0.35 * s.height, 0.8 * s.height, h);
    const vin = (-s.entrain * s.strength * 4 * x * (1 - x) * low * smoothstep(-0.2, 0.3, h) * gain) / rho;
    out.x += dx * vin;
    out.z += dz * vin;
  }
}

function addShockwave(s: ShockwaveSource, p: Vec3, out: Vec3, gain: number): void {
  if (s.age >= s.duration || s.age < 0) return;
  const rx = p.x - s.center.x;
  const ry = p.y - s.center.y;
  const rz = p.z - s.center.z;
  const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const x = (dist - s.speed * s.age) / s.thickness;
  if (x > 2.6 || x < -2.6) return;
  const life = 1 - s.age / s.duration;
  const mag = s.strength * Math.exp(-x * x) * life * life * gain;
  if (dist < 1e-6) {
    out.y += mag;
    return;
  }
  const inv = mag / dist;
  out.x += rx * inv;
  out.y += ry * inv;
  out.z += rz * inv;
}

/** Add one source's contribution at `p` into `out`. */
export function addSource(s: WindSource, p: Vec3, out: Vec3, gain = 1): void {
  switch (s.kind) {
    case 'stream':
      addStream(s, p, out, gain);
      break;
    case 'vortex':
      addVortex(s, p, out, gain);
      break;
    case 'thermal':
      addThermal(s, p, out, gain);
      break;
    case 'shockwave':
      addShockwave(s, p, out, gain);
      break;
  }
}

/** Evaluate a single source in isolation. */
export function sampleSource(s: WindSource, p: Vec3, out: Vec3): Vec3 {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  addSource(s, p, out);
  return out;
}

// ── turbulence: two octaves of a time-drifting ABC flow ──────────────────────
// Each component never depends on its own coordinate, so the flow is exactly
// divergence-free: it stirs and shears, it never creates or destroys air.

const K1 = 1.31;
const K2 = 2.87;

function addTurbulence(p: Vec3, t: number, amp: number, out: Vec3): void {
  const x = p.x;
  const y = p.y;
  const z = p.z;
  const a = amp * 0.62;
  const b = amp * 0.38;
  out.x += a * (Math.sin(K1 * y + 0.71 * t) + Math.cos(K1 * z - 0.53 * t + 1.3)) * 0.5;
  out.y += a * (Math.sin(K1 * z + 0.37 * t + 2.1) + Math.cos(K1 * x - 0.71 * t)) * 0.5;
  out.z += a * (Math.sin(K1 * x + 0.53 * t + 4.0) + Math.cos(K1 * y - 0.37 * t + 0.6)) * 0.5;
  out.x += b * (Math.sin(K2 * y - 1.63 * t + 0.4) + Math.cos(K2 * z + 1.21 * t)) * 0.5;
  out.y += b * (Math.sin(K2 * z - 1.21 * t + 5.2) + Math.cos(K2 * x + 1.9 * t + 1.1)) * 0.5;
  out.z += b * (Math.sin(K2 * x - 1.9 * t) + Math.cos(K2 * y + 1.63 * t + 3.3)) * 0.5;
}

/**
 * The air of the world: player-made and weather-made sources, a uniform ambient
 * wind, analytic turbulence, and calm shelter pockets.
 */
export class WindField {
  readonly sources: WindSource[] = [];
  readonly shelters: Shelter[] = [];
  /** Uniform prevailing wind (m/s). Belongs to the weather. */
  readonly ambient: Vec3 = vec3();
  /** Turbulence amplitude (m/s). */
  turbulence = 0;
  /** Field clock (s); drives turbulence drift. */
  time = 0;

  private readonly weatherScratch: Vec3 = vec3();

  add<T extends WindSource>(source: T): T {
    this.sources.push(source);
    return source;
  }

  remove(source: WindSource): void {
    const i = this.sources.indexOf(source);
    if (i >= 0) this.sources.splice(i, 1);
  }

  clear(): void {
    this.sources.length = 0;
    this.shelters.length = 0;
    this.ambient.x = this.ambient.y = this.ambient.z = 0;
    this.turbulence = 0;
  }

  /** Remove every source whose tag starts with `prefix`. */
  removeTagged(prefix: string): void {
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const tag = this.sources[i].tag;
      if (tag !== undefined && tag.startsWith(prefix)) this.sources.splice(i, 1);
    }
  }

  /** 1 in the open, 0 deep inside a shelter. */
  exposure(p: Vec3): number {
    let exposure = 1;
    for (let i = 0; i < this.shelters.length; i++) {
      const s = this.shelters[i];
      const f = s.feather > 1e-6 ? s.feather : 1e-6;
      const ix = Math.min(p.x - s.min.x, s.max.x - p.x);
      const iy = Math.min(p.y - s.min.y, s.max.y - p.y);
      const iz = Math.min(p.z - s.min.z, s.max.z - p.z);
      const inside = Math.min(ix, iy, iz);
      if (inside <= 0) continue;
      const e = 1 - smoothstep(0, f, inside);
      if (e < exposure) exposure = e;
    }
    return exposure;
  }

  /** Wind velocity at `p`, written into `out`. Allocation-free. */
  sample(p: Vec3, out: Vec3): Vec3 {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    const w = this.weatherScratch;
    w.x = this.ambient.x;
    w.y = this.ambient.y;
    w.z = this.ambient.z;
    if (this.turbulence > 0) addTurbulence(p, this.time, this.turbulence, w);
    const sources = this.sources;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s.enabled === false) continue;
      addSource(s, p, s.weather && !s.piercing ? w : out);
    }
    const exposure = this.shelters.length > 0 ? this.exposure(p) : 1;
    out.x += w.x * exposure;
    out.y += w.y * exposure;
    out.z += w.z * exposure;
    return out;
  }

  /** Only what the player made (hands and gestures). Used for feedback, never for physics. */
  samplePlayer(p: Vec3, out: Vec3): Vec3 {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    const sources = this.sources;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s.enabled === false || s.weather) continue;
      addSource(s, p, out);
    }
    return out;
  }

  /** Advance the field clock, age shockwaves and drop the dead ones. */
  advance(dt: number): void {
    this.time += dt;
    const sources = this.sources;
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      if (s.kind !== 'shockwave') continue;
      s.age += dt;
      if (s.age >= s.duration) sources.splice(i, 1);
    }
  }
}
