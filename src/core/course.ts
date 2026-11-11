/**
 * COURSES — turning a mission into a stretch of playable sky.
 *
 * The world is one continuous ribbon of floating islands. Each course spans
 * from one island to the next; the island a seed lands on becomes the place
 * the next seed grows from. Everything here is deterministic data: islands,
 * rocks, thermals, hostile drafts. No rendering, no randomness beyond a seed.
 */
import { type Vec3, clamp01, vec3 } from './vec3.js';
import { type Island, type Obstacle, type Terrain, createIsland, islandTop } from './terrain.js';
import { type Shelter, type StreamSource, type ThermalSource, createStream, createThermal } from './wind.js';
import { type Mission, STAGES, type StageKind } from './mission.js';
import { hash01 } from './random.js';

/** Shape of the home island: the same island closes one run and opens the next. */
export const HOME_SHAPE_SEED = 1618;
export const HOME_RX = 2.1;
export const HOME_RZ = 1.7;

/** Distance between island centres for each stage (m). */
export const STAGE_LENGTH: Record<StageKind, number> = {
  canyon: 7.0,
  tunnel: 7.4,
  crossing: 9.2,
  burst: 6.9,
};

/** Top-surface height of each stage's goal island (m). */
const GOAL_HEIGHT: Record<StageKind, number> = {
  canyon: 0.5,
  tunnel: 0.3,
  crossing: 0.8,
  burst: 0.0,
};

/** A hostile draft that switches on and off on a rhythm (lightning counts the beat). */
export interface PulsedDraft {
  stream: StreamSource;
  /** Peak strength (m/s). */
  strength: number;
  /** Seconds per cycle and how long the draft blows within it. */
  period: number;
  blow: number;
  /** Seconds of warning before each blow (the flash, the howl). */
  telegraph: number;
  /** Offset into the cycle at course start (s). */
  phase: number;
}

/** A helpful thermal that ignites once the seed has come far enough. */
export interface CourseThermal {
  source: ThermalSource;
  strength: number;
  /** Course progress (0..1) at which this thermal ignites. 0 = lit from the start. */
  igniteAt: number;
  /** 0..1 eased ignition level, advanced by the game. */
  level: number;
}

export interface Course {
  stage: number;
  kind: StageKind;
  mission: Mission;
  start: Island;
  goal: Island;
  terrain: Terrain;
  /** Where the dandelion head sits (seeds are anchored around it). */
  dandelion: Vec3;
  /** Radius of the dandelion head (m). */
  headRadius: number;
  seedCount: number;
  /** Height where the air thins: the soft roof of the flight (m). */
  ceiling: number;
  /** x of the launch point and of the goal, for progress. */
  startX: number;
  goalX: number;
  /** Prevailing wind at full exposure (m/s). */
  ambient: Vec3;
  /** Turbulence amplitude (m/s). */
  turbulence: number;
  /** 0..1 rain at the start of the course. */
  rain: number;
  /** True if the weather clears as the seed advances (the crossing). */
  clears: boolean;
  thermals: CourseThermal[];
  /** Steady weather sources: downdrafts, crosswinds. */
  steady: (StreamSource | ThermalSource)[];
  pulses: PulsedDraft[];
  shelters: Shelter[];
  /** Mid-gap point where the sky may raise a helping thermal. */
  assistPoint: Vec3;
}

export function courseProgress(course: Course, x: number): number {
  return clamp01((x - course.startX) / (course.goalX - course.startX));
}

/** 0..1 envelope of a pulsed draft at course time `t`: smooth on, smooth off. */
export function pulseEnvelope(p: PulsedDraft, t: number): number {
  const c = (((t + p.phase) % p.period) + p.period) % p.period;
  const start = p.period - p.blow;
  if (c < start) return 0;
  const u = (c - start) / p.blow;
  const attack = clamp01(u / 0.18);
  const release = clamp01((1 - u) / 0.25);
  const e = Math.min(attack, release);
  return e * e * (3 - 2 * e);
}

/** 0..1 warning level before a pulse (rises through the telegraph window, holds while blowing). */
export function pulseWarning(p: PulsedDraft, t: number): number {
  const c = (((t + p.phase) % p.period) + p.period) % p.period;
  const start = p.period - p.blow;
  if (c >= start) return 1;
  return clamp01((c - (start - p.telegraph)) / p.telegraph);
}

/** The island every run starts from and returns to. */
export function createHomeIsland(id: number, x: number): Island {
  return createIsland({
    id,
    center: vec3(x, 0, 0),
    rx: HOME_RX,
    rz: HOME_RZ,
    depth: 2.1,
    hills: 0.1,
    shapeSeed: HOME_SHAPE_SEED,
    fertile: false,
  });
}

export interface CourseOptions {
  stage: number;
  mission: Mission;
  /** The island the seed leaves from (the previous goal). */
  start: Island;
  /** Id for the goal island. */
  goalId: number;
  /** Seeds released in the finale. */
  flockSize: number;
  /** Varies island shapes between runs. */
  seed: number;
}

export function buildCourse(opts: CourseOptions): Course {
  const kind = STAGES[opts.stage];
  const { mission } = opts;
  const start: Island = { ...opts.start, center: { ...opts.start.center }, fertile: false };
  const x0 = start.center.x;
  const x1 = x0 + STAGE_LENGTH[kind];
  const amb = mission.ambientWind;
  const tur = mission.turbulence;
  const has = (h: string) => (mission.hazards as string[]).includes(h);

  const goal: Island =
    kind === 'burst'
      ? { ...createHomeIsland(opts.goalId, x1), fertile: true }
      : createIsland({
          id: opts.goalId,
          center: vec3(x1, GOAL_HEIGHT[kind], 0),
          rx: 1.45 + 0.15 * hash01(opts.seed + opts.stage * 31),
          rz: 1.25 + 0.15 * hash01(opts.seed + opts.stage * 37),
          depth: 1.5 + 0.5 * hash01(opts.seed + opts.stage * 41),
          hills: 0.12,
          shapeSeed: (opts.seed * 131 + opts.stage * 977 + 7) >>> 0,
          fertile: true,
        });

  const gapStart = x0 + start.rx;
  const gapEnd = x1 - goal.rx;
  const gapMid = (gapStart + gapEnd) * 0.5;

  const islands: Island[] = [start, goal];
  const obstacles: Obstacle[] = [];
  const thermals: CourseThermal[] = [];
  const steady: (StreamSource | ThermalSource)[] = [];
  const pulses: PulsedDraft[] = [];
  const shelters: Shelter[] = [];
  const ambient = vec3();
  let turbulence = 0.15 + tur * 1.1;
  let rain = 0;
  let clears = false;
  let seedCount = 1;
  let headRadius = 0.16;

  // the dandelion stands on the launch side of the start island
  const dx = x0 + start.rx * 0.38;
  const dz = 0.15;
  const stemTop = islandTop(start, dx, dz) + 1.0;
  const dandelion = vec3(dx, stemTop, dz);

  const addThermals = (count: number, yBase: number, staged: boolean) => {
    for (let i = 0; i < count; i++) {
      const u = (i + 1) / (count + 1);
      const tx = gapStart + (gapEnd - gapStart) * u;
      const tz = (hash01(opts.seed + i * 17 + opts.stage) - 0.5) * 0.8;
      const strength = 3.3 + 0.5 * hash01(opts.seed + i * 29);
      thermals.push({
        source: createThermal({
          base: vec3(tx, yBase, tz),
          radius: 0.78,
          height: 5.2,
          strength: 0,
          entrain: 0.3,
          weather: true,
          piercing: true,
          enabled: false,
          tag: 'weather:thermal',
        }),
        strength,
        igniteAt: staged ? Math.max(0, u - 0.3) : 0,
        level: 0,
      });
    }
  };

  switch (kind) {
    case 'canyon': {
      // ACT 1 — a canyon that sinks: only a sustained updraft carries a seed over.
      ambient.x = 0.35 * amb;
      ambient.z = 0.25 * amb;
      if (has('downdraft')) {
        steady.push(
          createThermal({
            base: vec3(gapMid, -3.0, 0),
            radius: 1.25,
            height: 6.5,
            strength: -(0.7 + 0.9 * amb),
            entrain: 0,
            weather: true,
            tag: 'weather:sink',
          }),
        );
      }
      addThermals(mission.thermalCount, -1.6, false);
      break;
    }
    case 'tunnel': {
      // ACT 2 — a cut-away stone gate. Storm outside, shelter inside, and a
      // back-draft that breathes through it: time your gusts between breaths.
      const cx = x0 + 3.75;
      const half = 1.5;
      obstacles.push(
        { kind: 'box', center: vec3(cx, -0.55, -0.1), half: vec3(half, 0.75, 1.1), round: 0.12 }, // floor
        { kind: 'box', center: vec3(cx, 2.8, -0.1), half: vec3(half, 1.0, 1.1), round: 0.12 }, // roof
        { kind: 'box', center: vec3(cx, 1.0, -0.98), half: vec3(half, 0.85, 0.22), round: 0.08 }, // back wall
      );
      shelters.push({ min: vec3(cx - half - 0.1, 0.1, -0.9), max: vec3(cx + half + 0.1, 1.9, 1.15), feather: 0.35 });
      ambient.x = -(0.5 + 1.0 * amb);
      rain = has('rain') ? 0.55 + 0.45 * amb : 0.25;
      turbulence = 0.3 + tur * 1.3;
      const strength = 4.2 + 2.6 * amb;
      pulses.push({
        stream: createStream({
          origin: vec3(cx + half + 0.9, 1.0, 0.1),
          direction: vec3(-1, 0, 0),
          strength: 0,
          radius: 6.2,
          weather: true,
          piercing: true,
          tag: 'weather:pulse',
        }),
        strength,
        period: 5.4,
        blow: 1.7,
        telegraph: 0.9,
        phase: 1.2,
      });
      if (has('crosswind')) {
        steady.push(
          createStream({
            origin: vec3(x0 + 1.9, 1.2, -2.8),
            direction: vec3(0, 0, 1),
            strength: 1.2 + 1.5 * amb,
            radius: 4,
            weather: true,
            tag: 'weather:crosswind',
          }),
        );
      }
      addThermals(Math.min(mission.thermalCount, 1), -1.6, false);
      if (thermals.length > 0) thermals[0].source.base.x = x0 + start.rx + 0.35; // before the gate mouth
      break;
    }
    case 'crossing': {
      // ACT 2 -> 3 — a long open sky. Crosswinds shear it; the storm clears as
      // the seed advances and thermals ignite one by one like stepping stones.
      clears = true;
      ambient.x = -(0.4 + 0.9 * amb);
      rain = has('rain') ? 0.5 + 0.4 * amb : 0.2;
      turbulence = 0.3 + tur * 1.2;
      // a bare spire to rest on, a third of the way over
      const sx = gapStart + (gapEnd - gapStart) * 0.36;
      obstacles.push({ kind: 'box', center: vec3(sx, -0.75, -0.25), half: vec3(0.36, 0.95, 0.36), round: 0.14 });
      const cross = 1.6 + 1.9 * amb;
      steady.push(
        createStream({
          origin: vec3(gapStart + (gapEnd - gapStart) * 0.22, 1.2, -2.9),
          direction: vec3(0, 0, 1),
          strength: has('crosswind') ? cross : cross * 0.5,
          radius: 4.6,
          weather: true,
          tag: 'weather:crosswind',
        }),
        createStream({
          origin: vec3(gapStart + (gapEnd - gapStart) * 0.68, 1.2, 2.9),
          direction: vec3(0, 0, -1),
          strength: has('crosswind') ? cross : cross * 0.5,
          radius: 4.6,
          weather: true,
          tag: 'weather:crosswind',
        }),
      );
      if (has('gustFront')) {
        pulses.push({
          stream: createStream({
            origin: vec3(gapEnd + 0.5, 1.4, 0),
            direction: vec3(-1, 0, 0),
            strength: 0,
            radius: 5.5,
            weather: true,
            tag: 'weather:pulse',
          }),
          strength: 3.2 + 2 * amb,
          period: 6.5,
          blow: 1.6,
          telegraph: 1.0,
          phase: 2.5,
        });
      }
      addThermals(Math.max(2, mission.thermalCount), -1.8, true);
      break;
    }
    case 'burst': {
      // ACT 3 — the finale: a whole flock, warm pillars of air, and home.
      seedCount = Math.max(12, Math.min(30, Math.round(opts.flockSize)));
      headRadius = 0.34;
      dandelion.y = islandTop(start, dx, dz) + 1.35;
      ambient.x = 0.25 + 0.45 * amb;
      turbulence = 0.2 + tur * 0.9;
      if (has('crosswind')) {
        steady.push(
          createStream({
            origin: vec3(gapMid, 1.3, -2.9),
            direction: vec3(0, 0, 1),
            strength: 1 + 1.4 * amb,
            radius: 4.4,
            weather: true,
            tag: 'weather:crosswind',
          }),
        );
      }
      addThermals(Math.max(3, mission.thermalCount), -1.8, false);
      break;
    }
  }

  const minX = x0 - start.rx - 3.5;
  const maxX = x1 + goal.rx + 3.5;
  const terrain: Terrain = { islands, obstacles, killY: -3.4, minX, maxX, minZ: -3.6, maxZ: 3.6 };

  return {
    stage: opts.stage,
    kind,
    mission,
    start,
    goal,
    terrain,
    dandelion,
    headRadius,
    seedCount,
    ceiling: Math.max(dandelion.y, goal.center.y) + 3.4,
    startX: dandelion.x,
    goalX: x1 - goal.rx * 0.55,
    ambient,
    turbulence,
    rain,
    clears,
    thermals,
    steady,
    pulses,
    shelters,
    assistPoint: vec3(gapMid, -1.7, 0),
  };
}

/** Anchor of flock seed `i` of `n` on a dandelion head (a Fibonacci sphere, upper two thirds). */
export function seedAnchor(course: Course, i: number, n: number, out: Vec3): Vec3 {
  if (n <= 1) {
    out.x = course.dandelion.x;
    out.y = course.dandelion.y + course.headRadius;
    out.z = course.dandelion.z;
    return out;
  }
  const golden = 2.399963229728653;
  const y = 1 - (i / (n - 1)) * 1.45; // 1 .. -0.45
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * golden;
  out.x = course.dandelion.x + Math.cos(a) * r * course.headRadius;
  out.y = course.dandelion.y + y * course.headRadius;
  out.z = course.dandelion.z + Math.sin(a) * r * course.headRadius;
  return out;
}
