/**
 * THE GAME — the whole of GUST as a deterministic, headless state machine.
 *
 *   awaiting  the seed waits on its dandelion for the player's first breath
 *   flight    only wind moves it now
 *   bloom     it touched fertile ground: the island blooms, the next mission is requested
 *   travel    the world slides on; the island you bloomed becomes the next launch
 *
 * Four stages make a run (canyon -> tunnel -> crossing -> dandelion burst) and
 * a run folds into the persistent garden. The shell feeds HandSamples in and
 * reads state and events out; nothing here knows about WebXR, the DOM, three.js
 * scenes, audio or the network. The same class runs in the headset and in the
 * unit tests, where a scripted ghost plays it start to finish.
 */
import { type Vec3, clamp01, damp, vec3 } from './vec3.js';
import { type StreamSource, type ThermalSource, WindField, createStream, createThermal } from './wind.js';
import { DEFAULT_SEED_PARAMS, type Seed, type SeedEnvironment, type SeedParams, createSeed, stepSeed } from './seed.js';
import type { HandSample } from './hands.js';
import { DEFAULT_GESTURES, type GestureEvent, type GestureParams, HandWind } from './gestures.js';
import {
  type Course,
  type CourseThermal,
  buildCourse,
  courseProgress,
  createHomeIsland,
  pulseEnvelope,
  pulseWarning,
  seedAnchor,
} from './course.js';
import {
  type Cue,
  type Mission,
  type MissionRequest,
  STAGE_COUNT,
  adaptMission,
  fallbackMission,
} from './mission.js';
import { WeatherMind } from './weatherMind.js';
import { type Garden, emptyGarden, recordRun } from './garden.js';
import { createRng, hash01, type Rng } from './random.js';
import type { Island } from './terrain.js';

export type Phase = 'awaiting' | 'flight' | 'bloom' | 'travel';
export type MissionSource = 'gemini' | 'fallback' | 'offline';

export type GameEvent =
  | { type: 'gesture'; gesture: GestureEvent }
  | { type: 'pluck'; seed: Seed; first: boolean }
  | { type: 'lost'; seed: Seed }
  | { type: 'planted'; seed: Seed; island: Island; count: number; need: number }
  | { type: 'respawn' }
  | { type: 'regrow' }
  | { type: 'stageClear'; stage: number; grand: boolean; course: Course }
  | { type: 'missionRequest'; request: MissionRequest }
  | { type: 'travelStart'; from: Course; to: Course }
  | { type: 'stageStart'; stage: number; run: number; course: Course }
  | { type: 'runComplete'; garden: Garden; landed: number; flock: number }
  | { type: 'pulse'; index: number; strength: number }
  | { type: 'ignite'; thermal: CourseThermal }
  | { type: 'lightning' }
  | { type: 'cue'; cue: Cue };

export interface GameOptions {
  /** Seeds released by the finale's dandelion (12-30). */
  flockSize?: number;
  gestures?: GestureParams;
  seedParams?: SeedParams;
  /** The saved garden, if any. */
  garden?: Garden;
  /** Seeds island shapes and ambient timing. */
  seed?: number;
  /** Begin at this stage (0..3) instead of the first. For demos and tests. */
  startStage?: number;
}

/** Sky colour weights; they always sum to 1. */
export interface SkyBlend {
  dawn: number;
  storm: number;
  golden: number;
}

const BLOOM_TIME = 5.2;
const GRAND_BLOOM_TIME = 12;
const TRAVEL_TIME = 4.2;
/** If no mission has arrived this long after asking, the hand-written bank answers. */
export const MISSION_TIMEOUT = 8.5;
const RESPAWN_DELAY = 1.5;
/** Par time per stage (s) — only used to estimate mastery. */
const PAR = [22, 38, 45, 60];
/** Fraction of the flock that must come home for the island to bloom. */
export const FLOCK_NEED = 0.4;
/** Beyond this |z| the sky nudges a lone seed back toward the player's reach. */
const CORRIDOR = 1.45;

export class Game {
  readonly field = new WindField();
  readonly hands: HandWind;
  readonly mind = new WeatherMind();
  readonly seedParams: SeedParams;
  readonly flockSize: number;

  /** Live seeds of the current course (attached, flying, and those resting where they ended). */
  readonly seeds: Seed[] = [];
  /** Events since the shell last drained them. The shell reads, then sets `length = 0`. */
  readonly events: GameEvent[] = [];

  course!: Course;
  /** The course being travelled to (only during `travel`). */
  nextCourse: Course | null = null;
  phase: Phase = 'awaiting';
  /** Seconds in the current phase. */
  phaseTime = 0;
  /** 0..1 progress of the slide to the next course. */
  travel = 0;
  /** Stage index within the run (0..3) and completed runs. */
  stage = 0;
  run = 0;
  garden: Garden;
  time = 0;
  /** Seconds since this course's weather started. */
  courseTime = 0;

  // ── readouts for the shell (rendering, audio) ──
  /** Smoothed point of interest: where the camera and the diorama should centre. */
  readonly focus: Vec3 = vec3();
  readonly sky: SkyBlend = { dawn: 1, storm: 0, golden: 0 };
  /** 0..1 rain falling right now. */
  rain = 0;
  /** 0..1 how far the storm has cleared on a clearing course. */
  clearing = 0;
  /** 0..1 best progress of any seed toward the goal. */
  progress = 0;
  /** 0..1 strongest hostile draft blowing right now, and the warning before it. */
  pulse = 0;
  pulseWarning = 0;
  /** Seeds planted so far in the finale, and how many are needed. */
  planted = 0;
  need = 1;
  /** The seed the sky is watching most closely (null when none is in the air). */
  lead: Seed | null = null;
  /** Where the latest mission came from. */
  missionSource: MissionSource = 'offline';

  private readonly rng: Rng;
  private readonly worldSeed: number;
  private islandId = 1;
  readonly assistWind: StreamSource;
  readonly reliefThermal: ThermalSource;
  private readonly guardian: StreamSource;
  private steadyBase: number[] = [];
  private pulseWarned: boolean[] = [];
  private hazardScale = 1;
  private respawnTimer = 0;
  private flightTime = 0;
  private sinceLastPlant = 0;
  private anyReleased = false;
  private nextMission: Mission | null = null;
  private pendingRequest: MissionRequest | null = null;
  private missionWait = 0;
  private lightningTimer = 5;
  private readonly landings: { x: number; z: number }[] = [];
  private readonly env: SeedEnvironment = { rain: 0, terrain: null };
  private readonly skyFrom: SkyBlend = { dawn: 1, storm: 0, golden: 0 };
  private readonly anchorScratch: Vec3 = vec3();

  constructor(options: GameOptions = {}) {
    this.flockSize = Math.max(12, Math.min(30, Math.round(options.flockSize ?? 20)));
    this.seedParams = options.seedParams ?? DEFAULT_SEED_PARAMS;
    this.garden = options.garden ?? emptyGarden();
    this.run = this.garden.runs;
    this.worldSeed = options.seed ?? 1;
    this.rng = createRng(this.worldSeed * 7919 + 17);
    this.hands = new HandWind(this.field, options.gestures ?? DEFAULT_GESTURES);
    this.assistWind = createStream({ strength: 0, radius: 5, enabled: false, weather: true, piercing: true, tag: 'weather:assist' });
    this.reliefThermal = createThermal({ strength: 0, radius: 0.9, height: 5.4, entrain: 0.3, enabled: false, weather: true, piercing: true, tag: 'weather:relief' });
    this.guardian = createStream({ strength: 0, radius: 3.2, enabled: false, weather: true, piercing: true, tag: 'weather:guardian' });

    const home = createHomeIsland(this.islandId++, 0);
    const s0 = Math.max(0, Math.min(STAGE_COUNT - 1, Math.round(options.startStage ?? 0))) || 0;
    const first = buildCourse({
      stage: s0,
      mission: fallbackMission(s0, this.run),
      start: home,
      goalId: this.islandId++,
      flockSize: this.flockSize,
      seed: this.courseSeed(s0),
    });
    this.installCourse(first);
    this.focus.x = first.dandelion.x;
    this.focus.y = first.dandelion.y;
    this.focus.z = first.dandelion.z;
  }

  private courseSeed(stage: number): number {
    return (this.worldSeed * 1000003 + this.run * 9176 + stage * 613) >>> 0;
  }

  /** True while the game is waiting for the shell to deliver a mission. */
  get awaitingMission(): boolean {
    return this.pendingRequest !== null && this.nextMission === null;
  }

  /**
   * Deliver the next mission (already validated). Called by the shell when the
   * Weather Mind answers. Late or unsolicited answers are ignored.
   */
  provideMission(mission: Mission, source: MissionSource): boolean {
    if (this.pendingRequest === null || this.nextMission !== null) return false;
    this.nextMission = mission;
    this.missionSource = source;
    return true;
  }

  // ── course installation ────────────────────────────────────────────────────

  private installCourse(course: Course): void {
    const f = this.field;
    f.clear();
    this.hands.attach();
    f.add(this.assistWind);
    f.add(this.reliefThermal);
    f.add(this.guardian);
    this.assistWind.enabled = this.reliefThermal.enabled = this.guardian.enabled = false;
    this.reliefThermal.base.x = course.assistPoint.x;
    this.reliefThermal.base.y = course.assistPoint.y;
    this.reliefThermal.base.z = course.assistPoint.z;
    this.steadyBase = [];
    for (const s of course.steady) {
      this.steadyBase.push(s.strength);
      f.add(s);
    }
    for (const t of course.thermals) f.add(t.source);
    this.pulseWarned = [];
    for (const p of course.pulses) {
      f.add(p.stream);
      this.pulseWarned.push(false);
    }
    for (const s of course.shelters) f.shelters.push(s);

    this.course = course;
    this.stage = course.stage;
    this.courseTime = 0;
    this.hazardScale = 1;
    this.clearing = 0;
    this.progress = 0;
    this.planted = 0;
    this.need = Math.max(1, Math.ceil(course.seedCount * FLOCK_NEED));
    this.landings.length = 0;
    this.sinceLastPlant = 0;
    this.seeds.length = 0;
    this.spawnSeeds();
    this.phase = 'awaiting';
    this.phaseTime = 0;
    this.mind.beginStage((course.mission.ambientWind + course.mission.turbulence) * 0.5);
    this.events.push({ type: 'stageStart', stage: course.stage, run: this.run, course });
    for (const cue of course.mission.cues) this.events.push({ type: 'cue', cue });
  }

  private spawnSeeds(): void {
    const c = this.course;
    for (let i = 0; i < c.seedCount; i++) {
      seedAnchor(c, i, c.seedCount, this.anchorScratch);
      this.seeds.push(createSeed(this.anchorScratch, hash01(this.time * 60 + i * 97 + c.stage * 13 + this.run * 7)));
    }
    this.anyReleased = false;
    this.flightTime = 0;
  }

  // ── the fixed step ─────────────────────────────────────────────────────────

  /** Advance the whole world by one fixed step. `null` hands are simply not there. */
  step(dt: number, left: HandSample | null, right: HandSample | null): void {
    this.time += dt;
    this.phaseTime += dt;
    this.courseTime += dt;
    this.field.advance(dt);
    this.hands.update(left, right, dt);
    for (let i = 0; i < this.hands.events.length; i++) {
      this.events.push({ type: 'gesture', gesture: this.hands.events[i] });
    }

    this.updateWeather(dt);
    this.stepSeeds(dt);
    this.updatePhase(dt);
    this.updateFocus(dt);
  }

  private updateWeather(dt: number): void {
    const c = this.course;
    const mind = this.mind;
    const f = this.field;
    const playing = this.phase === 'awaiting' || this.phase === 'flight';

    // once the seed is home the sky relaxes
    this.hazardScale += ((playing ? 1 : 0.15) - this.hazardScale) * damp(1.2, dt);
    const hz = this.hazardScale;

    if (c.clears) {
      if (this.progress > this.clearing) this.clearing += (this.progress - this.clearing) * damp(0.9, dt);
      if (!playing) this.clearing += (1 - this.clearing) * damp(0.8, dt);
    } else {
      this.clearing = 0;
    }
    const storm = 1 - this.clearing;

    mind.step(dt, { progress: this.progress, flying: this.phase === 'flight', handEnergy: this.hands.energy });
    const hostility = mind.hostility * hz;

    // prevailing wind: headwinds answer to the Mind, tailwinds are a gift
    const ambientScale = (c.ambient.x < 0 ? hostility : 1) * (c.clears ? 0.25 + 0.75 * storm : 1);
    f.ambient.x = c.ambient.x * ambientScale;
    f.ambient.y = c.ambient.y;
    f.ambient.z = c.ambient.z * ambientScale;
    f.turbulence = c.turbulence * mind.roughness * (c.clears ? 0.5 + 0.5 * storm : 1) * (0.4 + 0.6 * hz);
    this.rain = c.rain * storm * (0.3 + 0.7 * hz);

    for (let i = 0; i < c.steady.length; i++) {
      const s = c.steady[i];
      const base = this.steadyBase[i];
      // crosswinds and sinks are hostile; they fade with the storm on clearing courses
      s.strength = base * hostility * (c.clears ? 0.3 + 0.7 * storm : 1);
    }

    let pulse = 0;
    let warning = 0;
    for (let i = 0; i < c.pulses.length; i++) {
      const p = c.pulses[i];
      const env = pulseEnvelope(p, this.courseTime);
      const strength = p.strength * env * hostility * (c.clears ? storm : 1);
      p.stream.strength = strength;
      p.stream.enabled = strength > 0.01;
      const w = pulseWarning(p, this.courseTime) * hz;
      if (w > 0.05 && !this.pulseWarned[i]) {
        this.pulseWarned[i] = true;
        if (playing) this.events.push({ type: 'pulse', index: i, strength: p.strength * hostility });
      } else if (w <= 0.01) {
        this.pulseWarned[i] = false;
      }
      if (env > pulse) pulse = env;
      if (w > warning) warning = w;
    }
    this.pulse = pulse * hz;
    this.pulseWarning = warning;

    for (let i = 0; i < c.thermals.length; i++) {
      const t = c.thermals[i];
      const lit = this.progress >= t.igniteAt || !playing;
      if (lit && t.level === 0) this.events.push({ type: 'ignite', thermal: t });
      if (lit) t.level = Math.min(1, t.level + dt / 1.4);
      const e = t.level * t.level * (3 - 2 * t.level);
      t.source.strength = t.strength * e;
      t.source.enabled = e > 0.01;
    }

    // ambient lightning in a storm (pulses bring their own)
    if (this.sky.storm > 0.5 && (c.mission.hazards as string[]).includes('lightning')) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 6 + this.rng() * 9;
        this.events.push({ type: 'lightning' });
      }
    }

    // ── the Mind's visible help ──
    const lead = this.lead;
    const aw = this.assistWind;
    const tail = playing ? mind.tailwind : 0;
    if (lead !== null && tail > 0.05) {
      // the sky's breath gathers behind and below the seed and leans toward the goal
      const k = damp(3, dt);
      aw.origin.x += (lead.pos.x - 1.7 - aw.origin.x) * k;
      aw.origin.y += (lead.pos.y - 0.9 - aw.origin.y) * k;
      aw.origin.z += (lead.pos.z - aw.origin.z) * k;
      aw.direction.x = 0.83;
      aw.direction.y = 0.55;
      aw.direction.z = 0;
      aw.strength = tail;
      aw.enabled = true;
    } else {
      aw.strength *= Math.exp(-3 * dt);
      aw.enabled = aw.strength > 0.05;
    }
    const relief = playing ? mind.reliefThermal : 0;
    this.reliefThermal.strength += (relief - this.reliefThermal.strength) * damp(1.5, dt);
    this.reliefThermal.enabled = this.reliefThermal.strength > 0.05;

    // a lone seed drifting out of reach is breathed back toward the player's hands
    const g = this.guardian;
    if (lead !== null && c.seedCount === 1 && Math.abs(lead.pos.z) > CORRIDOR) {
      const side = lead.pos.z > 0 ? 1 : -1;
      g.origin.x = lead.pos.x;
      g.origin.y = lead.pos.y - 0.25;
      g.origin.z = lead.pos.z + side * 1.1;
      g.direction.x = 0;
      g.direction.y = 0.35;
      g.direction.z = -side * 0.94;
      g.strength = Math.min(7, (Math.abs(lead.pos.z) - CORRIDOR) * 7);
      g.enabled = true;
    } else {
      g.strength = 0;
      g.enabled = false;
    }

    // sky colours
    const sky = this.sky;
    if (this.phase === 'travel' && this.nextCourse !== null) {
      const t = this.travel * this.travel * (3 - 2 * this.travel);
      const to = initialSky(this.nextCourse);
      sky.dawn = this.skyFrom.dawn + (to.dawn - this.skyFrom.dawn) * t;
      sky.storm = this.skyFrom.storm + (to.storm - this.skyFrom.storm) * t;
      sky.golden = this.skyFrom.golden + (to.golden - this.skyFrom.golden) * t;
    } else if (c.kind === 'canyon') {
      sky.dawn = 1;
      sky.storm = 0;
      sky.golden = 0;
    } else if (c.kind === 'tunnel') {
      sky.dawn = 0;
      sky.storm = 1;
      sky.golden = 0;
    } else if (c.kind === 'crossing') {
      sky.dawn = 0;
      sky.storm = storm;
      sky.golden = this.clearing;
    } else {
      sky.dawn = 0;
      sky.storm = 0;
      sky.golden = 1;
    }
  }

  private stepSeeds(dt: number): void {
    const c = this.course;
    const seeds = this.seeds;
    const env = this.env;
    env.terrain = c.terrain;
    env.ceiling = c.ceiling;
    let best = 0;
    let lead: Seed | null = null;
    let leadScore = -Infinity;
    const flock = c.seedCount > 1;

    for (let i = seeds.length - 1; i >= 0; i--) {
      const s = seeds[i];
      const before = s.status;
      env.rain = this.rain > 0 && before === 'flying' ? this.rain * this.field.exposure(s.pos) : 0;
      // once a head has begun to shed, the rest hang by a thread: the next breath takes them all
      if (flock && this.anyReleased && before === 'attached' && s.pluck < 0.8) s.pluck = 0.8;
      const after = stepSeed(s, this.field, dt, this.seedParams, env);

      if (before === 'attached' && after === 'flying') {
        const first = !this.anyReleased;
        this.anyReleased = true;
        this.events.push({ type: 'pluck', seed: s, first });
        if (first && flock) {
          // one seed lets go and the whole head is ready to follow
          for (let j = 0; j < seeds.length; j++) {
            if (seeds[j].status === 'attached' && seeds[j].pluck < 0.6) seeds[j].pluck = 0.6;
          }
        }
      } else if (before === 'flying' && after === 'planted') {
        this.planted++;
        this.sinceLastPlant = 0;
        this.landings.push({ x: s.pos.x - c.goal.center.x, z: s.pos.z - c.goal.center.z });
        this.events.push({ type: 'planted', seed: s, island: c.goal, count: this.planted, need: this.need });
      } else if (before === 'flying' && after === 'lost') {
        this.events.push({ type: 'lost', seed: s });
        if (!flock) this.mind.onLoss();
      }

      if (after === 'lost' && s.restTime > 2.6) {
        seeds.splice(i, 1);
        continue;
      }
      if (after === 'flying') {
        const p = courseProgress(c, s.pos.x);
        if (p > best) best = p;
        // in a flock the sky watches whoever is in most trouble; alone, the one seed
        const score = flock ? -s.pos.y - p * 2 : p;
        if (score > leadScore) {
          leadScore = score;
          lead = s;
        }
      }
    }
    this.lead = lead;
    if (lead !== null) this.progress = best;
    else if (this.phase === 'awaiting') this.progress = 0;
  }

  private count(status: Seed['status']): number {
    let n = 0;
    for (let i = 0; i < this.seeds.length; i++) if (this.seeds[i].status === status) n++;
    return n;
  }

  private updatePhase(dt: number): void {
    const c = this.course;
    const flock = c.seedCount > 1;

    if (this.phase === 'awaiting' || this.phase === 'flight') {
      const attached = this.count('attached');
      const flying = this.count('flying');
      if (this.phase === 'awaiting' && this.anyReleased) {
        this.phase = 'flight';
        this.phaseTime = 0;
      }
      if (this.phase === 'flight') {
        this.flightTime += dt;
        this.sinceLastPlant += dt;
      }

      if (!flock) {
        if (this.planted > 0) {
          this.clearStage(false);
        } else if (attached === 0 && flying === 0) {
          // the seed is gone; after a breath the dandelion offers another
          this.respawnTimer += dt;
          if (this.respawnTimer >= RESPAWN_DELAY) {
            this.respawnTimer = 0;
            this.spawnSeeds();
            this.phase = 'awaiting';
            this.phaseTime = 0;
            this.events.push({ type: 'respawn' });
          }
        }
      } else if (this.phase === 'flight') {
        const settled = attached === 0 && flying === 0;
        const enough = this.planted >= this.need;
        const lingering = enough && this.sinceLastPlant > (attached === 0 ? 6 : 12);
        const overtime = this.flightTime > 80;
        if (settled || lingering || overtime) {
          for (let i = 0; i < this.seeds.length; i++) {
            const s = this.seeds[i];
            if (s.status === 'flying' || s.status === 'attached') {
              // stragglers are let go of, not snapped away: they drift off and fade
              s.status = 'lost';
              s.restTime = 0;
            }
          }
          if (enough) {
            this.clearStage(true);
          } else {
            // not enough came home: the dandelion grows a fresh head and the sky leans in
            this.mind.onLoss();
            this.spawnSeeds();
            this.phase = 'awaiting';
            this.phaseTime = 0;
            this.events.push({ type: 'regrow' });
          }
        }
      }
      return;
    }

    if (this.phase === 'bloom') {
      this.missionWait += dt;
      const duration = c.kind === 'burst' ? GRAND_BLOOM_TIME : BLOOM_TIME;
      if (this.phaseTime < duration) return;
      if (this.nextMission === null) {
        if (this.missionWait < MISSION_TIMEOUT) return; // still listening for the Mind
        // silence: the hand-written bank answers, shaped by how the player flew
        const request = this.pendingRequest!;
        this.nextMission = adaptMission(fallbackMission(request.stage, request.run + Math.floor(this.rng() * 2)), request);
        this.missionSource = 'offline';
      }
      this.beginTravel();
      return;
    }

    if (this.phase === 'travel') {
      this.travel = clamp01(this.travel + dt / TRAVEL_TIME);
      if (this.travel >= 1 && this.nextCourse !== null) {
        const next = this.nextCourse;
        this.nextCourse = null;
        this.travel = 0;
        this.installCourse(next);
      }
    }
  }

  private clearStage(grand: boolean): void {
    const c = this.course;
    this.phase = 'bloom';
    this.phaseTime = 0;
    this.respawnTimer = 0;
    this.mind.onSuccess(PAR[c.stage]);
    this.events.push({ type: 'stageClear', stage: c.stage, grand, course: c });
    if (grand) {
      this.garden = recordRun(this.garden, this.landings);
      this.events.push({ type: 'runComplete', garden: this.garden, landed: this.landings.length, flock: c.seedCount });
    }
    const nextStage = (c.stage + 1) % STAGE_COUNT;
    const nextRun = grand ? this.run + 1 : this.run;
    const request = this.mind.report(nextStage, nextRun, this.garden.plants.length, c.mission.name);
    this.pendingRequest = request;
    this.nextMission = null;
    this.missionWait = 0;
    this.events.push({ type: 'missionRequest', request });
  }

  private beginTravel(): void {
    const c = this.course;
    const request = this.pendingRequest!;
    const mission = this.nextMission!;
    this.pendingRequest = null;
    this.nextMission = null;
    if (c.kind === 'burst') this.run++;
    const next = buildCourse({
      stage: request.stage,
      mission,
      start: c.goal,
      goalId: this.islandId++,
      flockSize: this.flockSize,
      seed: this.courseSeed(request.stage),
    });
    this.nextCourse = next;
    this.phase = 'travel';
    this.phaseTime = 0;
    this.travel = 0;
    this.skyFrom.dawn = this.sky.dawn;
    this.skyFrom.storm = this.sky.storm;
    this.skyFrom.golden = this.sky.golden;
    this.events.push({ type: 'travelStart', from: c, to: next });
  }

  private updateFocus(dt: number): void {
    const c = this.course;
    let tx: number;
    let ty: number;
    let tz = 0;
    if (this.phase === 'travel' && this.nextCourse !== null) {
      const t = this.travel * this.travel * (3 - 2 * this.travel);
      tx = c.goal.center.x + (this.nextCourse.dandelion.x - c.goal.center.x) * t;
      ty = c.goal.center.y + 0.8 + (this.nextCourse.dandelion.y - 0.2 - c.goal.center.y - 0.8) * t;
    } else if (this.phase === 'bloom') {
      tx = c.goal.center.x;
      ty = c.goal.center.y + 0.8;
    } else if (this.lead !== null && c.seedCount === 1) {
      tx = this.lead.pos.x;
      ty = this.lead.pos.y;
      tz = this.lead.pos.z * 0.5;
    } else if (this.phase === 'flight' && c.seedCount > 1) {
      // follow the middle of the flock
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < this.seeds.length; i++) {
        const s = this.seeds[i];
        if (s.status !== 'flying') continue;
        sx += s.pos.x;
        sy += s.pos.y;
        n++;
      }
      if (n > 0) {
        tx = sx / n;
        ty = sy / n;
      } else {
        tx = c.goal.center.x;
        ty = c.goal.center.y + 0.8;
      }
    } else {
      tx = c.dandelion.x + 0.6;
      ty = c.dandelion.y - 0.1;
    }
    const k = damp(this.phase === 'flight' ? 2.2 : 1.6, dt);
    this.focus.x += (tx - this.focus.x) * k;
    this.focus.y += (ty - this.focus.y) * k;
    this.focus.z += (tz - this.focus.z) * k;
  }
}

function initialSky(course: Course): SkyBlend {
  switch (course.kind) {
    case 'canyon':
      return { dawn: 1, storm: 0, golden: 0 };
    case 'burst':
      return { dawn: 0, storm: 0, golden: 1 };
    default:
      return { dawn: 0, storm: 1, golden: 0 };
  }
}
