/**
 * GUST — the thin shell.
 *
 * Everything that matters (wind, seed, gestures, courses, the Weather Mind,
 * the garden) lives in src/core and knows nothing about WebXR. This system is
 * the adapter between that core and the headset / the browser:
 *
 *   input   tracked hands | controllers | mouse | touch  ->  HandSample
 *   time    variable frames                              ->  fixed 1/60 steps
 *   output  game state + events                          ->  meshes, light, sound
 *   net     "missionRequest"                             ->  /api/mission -> game
 *   disk    "runComplete"                                ->  localStorage
 */
import { Color, Group, Matrix4, Mesh, PerspectiveCamera, Vector2, Vector3, createSystem, NoToneMapping, IcosahedronGeometry, type ShaderMaterial } from '@iwsdk/core';
import {
  DEFAULT_GESTURES,
  FIXED_DT,
  FixedStepper,
  GARDEN_STORAGE_KEY,
  Game,
  type GameEvent,
  GhostPlayer,
  HOME_SHAPE_SEED,
  HandFilter,
  type HandSample,
  type Course,
  type Cue,
  type Island,
  type MissionRequest,
  PointerHands,
  type PointerState,
  adaptMission,
  fallbackMission,
  parseGarden,
  serializeGarden,
  validateMission,
  vec3,
} from '../core/index.js';
import { PointerInput } from '../input/pointer.js';
import { XRHands } from '../input/xrHands.js';
import { GustAudio } from '../audio/audio.js';
import { Sky } from '../render/sky.js';
import { type IslandView, buildIslandView, buildObstacle, startBloom, updateBloom } from '../render/islands.js';
import { Foliage } from '../render/foliage.js';
import { Particles, Rain, type StreakSpawn, WindStreaks } from '../render/air.js';
import { SeedViews, buildDandelion } from '../render/seeds.js';
import { Birds, CloudSea, PalmMarker, ShockRings, Sunbeam, ThermalColumn, softLightMaterial } from '../render/extras.js';

/** Simulation metres per real metre: the world is a 1:7 miniature. */
const UNIT = 7;
const S = 1 / UNIT;
/** Radius of the palm markers, in simulation metres. */
const PALM = 0.3;

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const flag = (k: string) => params.has(k) && params.get(k) !== '0';
const num = (k: string, fallback: number) => {
  const v = Number(params.get(k));
  return params.has(k) && Number.isFinite(v) ? v : fallback;
};

const v2 = new Vector2();
const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const toSim = new Matrix4();
const tmpColor = new Color();
const GOLD = new Color(1.0, 0.82, 0.42);
const WARM = new Color(1.0, 0.93, 0.7);
const WHITE = new Color(1, 1, 1);
const SKYBLUE = new Color(0.62, 0.8, 1.0);
const FIREFLY = new Color(0.9, 1.0, 0.45);
const PETALS = [0xff8fab, 0xffc971, 0xfff3b0, 0xffffff, 0xf7a8d8].map((c) => new Color(c));

export class GustSystem extends createSystem({}) {
  private game!: Game;
  private readonly stepper = new FixedStepper();
  private readonly ghost = new GhostPlayer();
  private autoplay = flag('ghost');
  private readonly audio = new GustAudio();

  // input
  private pointer!: PointerInput;
  private readonly pointerHands = new PointerHands();
  private readonly pointerState: PointerState = { x: 0, y: 0, z: 0, present: false, held: false };
  private readonly xrHands = new XRHands();
  private readonly filters: [HandFilter, HandFilter] = [new HandFilter(), new HandFilter()];
  private readonly rawPos = [vec3(), vec3()];
  private readonly rawNormal = [vec3(0, 1, 0), vec3(0, 1, 0)];
  private readonly rawActive = [false, false];
  // headset poses arrive once per frame; physics may step several times per frame.
  // The pose is spread across those steps so a hand moves smoothly, never in jumps.
  private readonly xrFrom = [vec3(), vec3()];
  private readonly xrTo = [vec3(), vec3()];
  private readonly xrKnown = [false, false];
  private subIndex = 0;
  private subCount = 1;
  private readonly live: [HandSample | null, HandSample | null] = [null, null];
  private planeZ = 0;

  // scene
  private readonly root = new Group();
  private sky!: Sky;
  private readonly islandViews = new Map<number, IslandView>();
  private readonly courseProps = new Group();
  private nextProps: Group | null = null;
  private foliage!: Foliage;
  private streaks!: WindStreaks;
  private sparks!: Particles;
  private petals!: Particles;
  private rain!: Rain;
  private seeds!: SeedViews;
  private clouds!: CloudSea;
  private birds!: Birds;
  private rings!: ShockRings;
  private sunbeam!: Sunbeam;
  private readonly thermals: ThermalColumn[] = [];
  private reliefColumn!: ThermalColumn;
  private breath!: Mesh;
  private readonly palms: [PalmMarker, PalmMarker] = [new PalmMarker(0xffffff, PALM), new PalmMarker(0xffffff, PALM)];
  private readonly hintPalms: [PalmMarker, PalmMarker] = [new PalmMarker(0xffd27a, PALM), new PalmMarker(0xffd27a, PALM)];
  private readonly spawn: StreakSpawn = {
    cx: 0, cy: 1, cz: 0,
    hands: [
      { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, active: false },
      { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, active: false },
    ],
    hotspots: [],
  };

  // placement of the diorama in the real world
  private readonly anchor = new Vector3(0, 1.0, -0.6);
  private yaw = 0;
  private wasPresenting = false;
  private anchored = false;
  private driftTime = 0;
  private viewX = 0;
  private viewY = 1;
  private frameW = 6.2;

  // teaching + moods
  private idle = 0;
  private hintLevel = 0;
  private everPlucked = false;
  private usedUpdraft = false;
  private fireflies = 0;
  private petalShower = 0;
  private rainBias = 0;
  private lightningDelay = -1;
  private trailClock = 0;
  private hud: HTMLElement | null = null;
  private hudState = '';
  private bloomSpeed = 1.5;
  private missionSerial = 0;
  private readonly speed = Math.max(1, Math.min(12, Math.round(num('speed', 1))));
  private time = 0;

  init(): void {
    const renderer = this.renderer;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0x101820, 1);

    // ── the game ──
    let saved: string | null = null;
    try {
      if (flag('reset')) localStorage.removeItem(GARDEN_STORAGE_KEY);
      saved = localStorage.getItem(GARDEN_STORAGE_KEY);
    } catch {
      saved = null; // private mode etc.: the garden simply lives for this visit
    }
    const quality = num('quality', 1);
    this.game = new Game({
      gestures: { ...DEFAULT_GESTURES, unitScale: UNIT },
      garden: parseGarden(saved),
      flockSize: num('flock', quality < 1 ? 12 : 22),
      seed: 3 + Math.floor(num('seed', 0)),
      startStage: num('stage', 0),
    });

    // ── the scene ──
    this.world.createTransformEntity(this.root);
    this.root.scale.setScalar(S);
    this.sky = new Sky(this.scene);
    this.world.createTransformEntity(this.sky.group);

    this.foliage = new Foliage();
    this.foliage.density = quality;
    this.streaks = new WindStreaks(quality < 1 ? 260 : 440);
    this.sparks = new Particles(520, true);
    this.petals = new Particles(220, false);
    this.rain = new Rain(quality < 1 ? 160 : 280);
    this.seeds = new SeedViews();
    this.clouds = new CloudSea();
    this.birds = new Birds();
    this.rings = new ShockRings();
    this.sunbeam = new Sunbeam();
    this.reliefColumn = new ThermalColumn(0.9, 5.4, 0xfff0b8);
    this.breath = new Mesh(
      new IcosahedronGeometry(0.6, 3),
      softLightMaterial(0xbfe0ff, 2.6),
    );
    this.breath.visible = false;
    this.root.add(
      this.clouds.mesh,
      this.courseProps,
      this.foliage.group,
      this.sunbeam.mesh,
      this.reliefColumn.group,
      this.breath,
      this.birds.mesh,
      this.rain.object,
      this.petals.object,
      this.streaks.object,
      this.rings.group,
      this.seeds.group,
      this.sparks.object,
    );
    for (const p of [...this.palms, ...this.hintPalms]) this.root.add(p.group);

    // ── input ──
    this.pointer = new PointerInput(renderer.domElement);
    this.pointer.onFirstGesture = () => this.audio.start();
    this.audio.muted = flag('mute');
    this.cleanupFuncs.push(() => this.pointer.dispose());
    this.buildHud();

    this.birds.roost(this.game.course.goal.center.x, 2.6, -2.2);
    this.viewX = (this.game.course.dandelion.x + this.game.course.goal.center.x) * 0.5;
    this.viewY = this.viewHeight();
    this.drain();

    (window as unknown as { __gust: unknown }).__gust = { game: this.game, system: this };
  }

  // ── placement ──────────────────────────────────────────────────────────────

  private viewHeight(): number {
    // follow the seed's height only partly: the islands should feel like ground
    return 0.95 + 0.42 * (this.game.focus.y - 0.95);
  }

  private place(dt: number, presenting: boolean): void {
    const game = this.game;
    const course = game.nextCourse ?? game.course;
    const span = course.goal.center.x - course.dandelion.x;
    const mid = course.dandelion.x + span * 0.5;
    // headset: the seed stays within arm's reach. desktop: the whole crossing stays in frame.
    // In the headset the world slides only HALF as far as the seed travels: a seed
    // drawn toward still hands really does arrive at them (a world that kept pace
    // with it would be a treadmill), and nothing is ever more than a reach away.
    let targetX = mid + (game.focus.x - mid) * 0.5;
    if (!presenting) {
      const t = game.phase === 'travel' ? game.travel * game.travel * (3 - 2 * game.travel) : 1;
      const from = game.phase === 'travel' ? game.course.goal.center.x : mid;
      targetX = (from + (mid - from) * t) * 0.72 + game.focus.x * 0.28;
    }
    const k = 1 - Math.exp(-(presenting ? 2.5 : 3) * dt);
    this.viewX += (targetX - this.viewX) * k;
    this.viewY += (this.viewHeight() - this.viewY) * k;

    if (presenting) {
      // seat the diorama in front of the player, just below eye level
      const head = this.player.head;
      head.getWorldPosition(va);
      head.getWorldDirection(vb); // +z of the head (pointing backward out of the face)
      vb.y = 0;
      const valid = va.y > 0.25 && vb.lengthSq() > 1e-4;
      if (valid) {
        vb.normalize().negate(); // forward
        vc.copy(va).addScaledVector(vb, 0.58);
        vc.y = va.y - 0.3;
        const off = Math.hypot(vc.x - this.anchor.x, vc.z - this.anchor.z) + Math.abs(vc.y - this.anchor.y) * 1.3;
        if (!this.anchored) {
          this.anchor.copy(vc);
          this.yaw = Math.atan2(-vb.x, -vb.z);
          this.anchored = true;
          this.driftTime = 0;
        } else if (off > 0.55) {
          // the player has really moved (sat down, turned the chair): follow, gently
          this.driftTime += dt;
          if (this.driftTime > 1.6) {
            const kk = 1 - Math.exp(-1.5 * dt);
            this.anchor.lerp(vc, kk);
            let d = Math.atan2(-vb.x, -vb.z) - this.yaw;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            this.yaw += d * kk;
          }
        } else {
          this.driftTime = 0;
        }
      }
    } else {
      this.anchored = false;
      this.anchor.set(0, 1.0, -0.6);
      this.yaw = 0;
      // frame the diorama: wide enough for the course, tall enough for the flight
      const cam = this.camera as PerspectiveCamera;
      if (cam.fov !== 40) {
        cam.fov = 40;
        cam.updateProjectionMatrix();
      }
      const tanV = Math.tan((cam.fov * Math.PI) / 360);
      const halfW = span * 0.5 + 2.7;
      this.frameW += (halfW - this.frameW) * (1 - Math.exp(-1.5 * dt));
      const dist = Math.max((this.frameW * S) / (tanV * cam.aspect), (3.0 * S) / tanV);
      const px = this.pointer.present ? this.pointer.x : 0;
      const py = this.pointer.present ? this.pointer.y : 0;
      cam.position.set(this.anchor.x + px * 0.035, this.anchor.y + dist * 0.2 + py * 0.015, this.anchor.z + dist * 0.98);
      cam.lookAt(this.anchor.x, this.anchor.y + 0.035, this.anchor.z);
    }

    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const lx = -this.viewX * S, ly = -this.viewY * S;
    this.root.rotation.set(0, this.yaw, 0);
    this.root.position.set(this.anchor.x + lx * cos, this.anchor.y + ly, this.anchor.z - lx * sin);
    this.root.updateMatrixWorld(true);
    toSim.copy(this.root.matrixWorld).invert();
  }

  // ── input -> raw palm poses in simulation space ────────────────────────────

  private readInput(presenting: boolean, dt: number): void {
    this.rawActive[0] = this.rawActive[1] = false;
    if (presenting) {
      this.xrHands.update(this.renderer.xr.getFrame() as XRFrame | null, this.renderer.xr.getReferenceSpace(), dt);
      const palms = [this.xrHands.left, this.xrHands.right];
      for (let i = 0; i < 2; i++) {
        const p = palms[i];
        if (!p.active) continue;
        va.copy(p.position).applyMatrix4(this.player.matrixWorld).applyMatrix4(toSim);
        vb.copy(p.normal).transformDirection(this.player.matrixWorld).transformDirection(toSim);
        const from = this.xrFrom[i], to = this.xrTo[i];
        if (this.xrKnown[i]) {
          from.x = to.x;
          from.y = to.y;
          from.z = to.z;
        } else {
          from.x = va.x;
          from.y = va.y;
          from.z = va.z;
        }
        to.x = va.x;
        to.y = va.y;
        to.z = va.z;
        this.rawNormal[i].x = vb.x;
        this.rawNormal[i].y = vb.y;
        this.rawNormal[i].z = vb.z;
        this.rawActive[i] = true;
      }
      this.xrKnown[0] = this.rawActive[0];
      this.xrKnown[1] = this.rawActive[1];
      this.pointerState.present = false;
      return;
    }
    // mouse / touch: cast the pointer onto the plane the seed is flying in
    const ps = this.pointerState;
    const lead = this.game.lead;
    const targetZ = lead ? lead.pos.z * 0.85 : this.game.course.dandelion.z;
    this.planeZ += (targetZ - this.planeZ) * 0.08;
    ps.present = false;
    if (this.pointer.present) {
      const cam = this.camera;
      cam.getWorldPosition(va).applyMatrix4(toSim);
      vb.set(this.pointer.x, this.pointer.y, 0.5).unproject(cam).applyMatrix4(toSim).sub(va);
      if (Math.abs(vb.z) > 1e-5) {
        const t = (this.planeZ - va.z) / vb.z;
        if (t > 0) {
          ps.x = va.x + vb.x * t;
          ps.y = va.y + vb.y * t;
          ps.z = this.planeZ;
          ps.present = true;
        }
      }
    }
    ps.held = this.pointer.held;
    if (this.pointer.clap) {
      this.pointer.clap = false;
      if (ps.present) this.pointerHands.clap();
    }
  }

  private readonly step = (dt: number): void => {
    const game = this.game;
    if (this.autoplay) {
      this.ghost.update(game, dt);
      this.live[0] = this.ghost.left;
      this.live[1] = this.ghost.right;
    } else {
      if (!this.wasPresenting) {
        this.pointerHands.step(this.pointerState, dt, UNIT);
        const raw = [this.pointerHands.left, this.pointerHands.right];
        for (let i = 0; i < 2; i++) {
          this.rawActive[i] = raw[i].active;
          if (!raw[i].active) continue;
          this.rawPos[i].x = raw[i].position.x;
          this.rawPos[i].y = raw[i].position.y;
          this.rawPos[i].z = raw[i].position.z;
          this.rawNormal[i].x = raw[i].palmNormal.x;
          this.rawNormal[i].y = raw[i].palmNormal.y;
          this.rawNormal[i].z = raw[i].palmNormal.z;
        }
      }
      else {
        this.subIndex++;
        const f = Math.min(1, this.subIndex / this.subCount);
        for (let i = 0; i < 2; i++) {
          if (!this.rawActive[i]) continue;
          const from = this.xrFrom[i], to = this.xrTo[i];
          this.rawPos[i].x = from.x + (to.x - from.x) * f;
          this.rawPos[i].y = from.y + (to.y - from.y) * f;
          this.rawPos[i].z = from.z + (to.z - from.z) * f;
        }
      }
      for (let i = 0; i < 2; i++) {
        if (this.rawActive[i]) this.live[i] = this.filters[i].update(this.rawPos[i], this.rawNormal[i], dt);
        else {
          this.filters[i].reset();
          this.live[i] = null;
        }
      }
    }
    game.step(dt, this.live[0], this.live[1]);
    this.drain();
  };

  // ── game events -> the world's performance ─────────────────────────────────

  private pan(x: number): number {
    return (x - this.viewX) / 4.5;
  }

  private drain(): void {
    const events = this.game.events;
    for (let i = 0; i < events.length; i++) this.on(events[i]);
    events.length = 0;
  }

  private on(e: GameEvent): void {
    const game = this.game;
    switch (e.type) {
      case 'stageStart':
        this.enterCourse(e.course);
        break;
      case 'travelStart':
        this.prepareCourse(e.to);
        this.audio.travel();
        break;
      case 'gesture': {
        const g = e.gesture;
        if (g.type === 'gust') this.audio.gust(g.strength, this.pan(g.position.x));
        else if (g.type === 'clap') {
          this.audio.clap(this.pan(g.position.x));
          this.rings.fire(g.position.x, g.position.y, g.position.z, game.hands.params.clapSpeed, game.hands.params.clapDuration);
          this.birds.scatter(g.position.x, g.position.y, g.position.z, 1);
          this.burst(g.position.x, g.position.y, g.position.z, 18, 4.5, WHITE, 0.07, 0.6);
        } else if (g.type === 'whirl') this.audio.whirl();
        else if (g.type === 'updraft') {
          this.audio.updraft();
          this.usedUpdraft = true;
        }
        break;
      }
      case 'pluck':
        if (e.first) {
          this.audio.pluck(this.pan(e.seed.pos.x));
          this.everPlucked = true;
        }
        this.burst(e.seed.pos.x, e.seed.pos.y, e.seed.pos.z, e.first ? 14 : 3, 1.6, WARM, 0.06, 0.9);
        break;
      case 'lost':
        this.audio.lost(this.pan(e.seed.pos.x));
        break;
      case 'respawn':
      case 'regrow':
        this.audio.respawn();
        this.burst(game.course.dandelion.x, game.course.dandelion.y + 0.15, game.course.dandelion.z, 10, 0.9, WARM, 0.05, 1.1);
        break;
      case 'planted': {
        const p = e.seed.pos;
        this.audio.plant(this.pan(p.x));
        this.burst(p.x, p.y + 0.05, p.z, 22, 2.4, GOLD, 0.075, 1.3);
        for (let k = 0; k < 8; k++) this.petal(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5);
        const view = this.islandViews.get(e.island.id);
        if (view && game.course.seedCount === 1) {
          this.bloomSpeed = 1.5;
          startBloom(view, p.x - e.island.center.x, p.z - e.island.center.z);
        }
        break;
      }
      case 'stageClear': {
        this.audio.bloom(e.grand);
        this.sunbeam.target = 1;
        const view = this.islandViews.get(e.course.goal.id);
        if (view && !view.lush) {
          // the flock's bloom starts where the first seed landed and takes the whole island
          const first = game.seeds.find((s) => s.status === 'planted');
          this.bloomSpeed = 0.9;
          startBloom(view, first ? first.pos.x - view.island.center.x : 0, first ? first.pos.z - view.island.center.z : 0);
        }
        this.fireflies = e.grand ? 12 : 4;
        this.petalShower = e.grand ? 9 : 2.5;
        this.birds.guide(
          [
            { x: e.course.goal.center.x - 2.5, y: 2.2, z: -1.5 },
            { x: e.course.goal.center.x, y: 1.6, z: 0.6 },
            { x: e.course.goal.center.x + 2.5, y: 2.6, z: -1.2 },
          ],
          5,
        );
        break;
      }
      case 'runComplete': {
        try {
          localStorage.setItem(GARDEN_STORAGE_KEY, serializeGarden(e.garden));
        } catch {
          /* storage unavailable: the garden lasts for this visit only */
        }
        const view = this.islandViews.get(game.course.goal.id);
        if (view) this.foliage.plantGarden(view, e.garden, e.garden.runs - 1);
        break;
      }
      case 'missionRequest':
        void this.requestMission(e.request);
        break;
      case 'pulse':
        break;
      case 'ignite':
        this.audio.ignite(this.pan(e.thermal.source.base.x));
        this.burst(e.thermal.source.base.x, e.thermal.source.base.y + 1.2, e.thermal.source.base.z, 16, 1.2, GOLD, 0.06, 1.6);
        break;
      case 'lightning':
        this.strike(1);
        break;
      case 'cue':
        this.perform(e.cue);
        break;
    }
  }

  /** The narrative beat is never shown as text: the world acts it out. */
  private perform(cue: Cue): void {
    const c = this.game.course;
    switch (cue) {
      case 'birds_guide':
        this.birds.guide(
          [
            { x: c.dandelion.x - 1.5, y: c.dandelion.y + 0.9, z: -0.6 },
            { x: (c.dandelion.x + c.goal.center.x) / 2, y: c.dandelion.y + 1.3, z: 0.2 },
            { x: c.goal.center.x, y: c.goal.center.y + 1.3, z: -0.3 },
          ],
          7,
        );
        break;
      case 'birds_scatter':
        this.birds.scatter(c.dandelion.x + 2, 1, 0, 0.8);
        break;
      case 'lightning':
        this.lightningDelay = 2.2;
        break;
      case 'sunbeam':
      case 'clouds_part':
        this.sunbeam.target = 0.7;
        break;
      case 'clouds_gather':
        this.sunbeam.target = 0;
        break;
      case 'rain_swell':
        this.rainBias = 0.35;
        break;
      case 'rain_ease':
        this.rainBias = -0.3;
        break;
      case 'petals':
        this.petalShower = Math.max(this.petalShower, 5);
        break;
      case 'fireflies':
        this.fireflies = Math.max(this.fireflies, 8);
        break;
      case 'wind_hush':
        break;
    }
  }

  private strike(power: number): void {
    this.sky.strike(power);
    this.audio.thunder(power);
    this.birds.scatter(this.viewX, 3, -1, 0.6);
  }

  private burst(x: number, y: number, z: number, n: number, speed: number, color: Color, size: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.sparks.emit(x, y, z, Math.cos(a) * r * sp, u * sp + speed * 0.3, Math.sin(a) * r * sp, color, {
        life: life * (0.6 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.7), drag: 2.4, gravity: -0.2, twinkle: 0.5,
      });
    }
  }

  private readonly petal = (x: number, y: number, z: number, vx: number, vy: number, vz: number, color?: Color): void => {
    this.petals.emit(x, y, z, vx, vy, vz, color ?? PETALS[(Math.random() * PETALS.length) | 0], {
      life: 2.6 + Math.random() * 2, size: 0.07 + Math.random() * 0.04, windFollow: 0.7, gravity: 0.9, shrink: 0.6,
    });
  };

  // ── courses -> scenery ─────────────────────────────────────────────────────

  private ensureIsland(island: Island, lush: boolean, course: Course, isStart: boolean): IslandView {
    let view = this.islandViews.get(island.id);
    if (view) return view;
    view = buildIslandView(island, lush);
    this.islandViews.set(island.id, view);
    this.root.add(view.group);
    const home = island.shapeSeed === HOME_SHAPE_SEED;
    const d = course.dandelion;
    this.foliage.populate(view, {
      trees: home ? 1 : lush ? 2 : 2,
      flowers: home ? 10 : 22,
      // where this island's dandelion stands, or will stand once the seed has taken root
      keepClear: [isStart ? { x: d.x - island.center.x, z: d.z - island.center.z, r: 0.5 } : { x: island.rx * 0.38, z: 0, r: 0.5 }],
    });
    if (home) this.foliage.plantGarden(view, this.game.garden, -1);
    return view;
  }

  private buildProps(course: Course): Group {
    const g = new Group();
    course.terrain.obstacles.forEach((o, i) => g.add(buildObstacle(o, course.goal.id * 100 + i)));
    g.add(buildDandelion(course));
    return g;
  }

  /** The next course exists in the distance while the world travels toward it. */
  private prepareCourse(course: Course): void {
    this.ensureIsland(course.start, true, course, true);
    this.ensureIsland(course.goal, false, course, false);
    this.nextProps = this.buildProps(course);
    this.courseProps.add(this.nextProps);
  }

  private enterCourse(course: Course): void {
    this.ensureIsland(course.start, true, course, true);
    this.ensureIsland(course.goal, false, course, false);
    // keep only this course's scenery
    for (const child of [...this.courseProps.children]) if (child !== this.nextProps) this.courseProps.remove(child);
    if (!this.nextProps) this.courseProps.add(this.buildProps(course));
    this.nextProps = null;
    for (const [id, view] of this.islandViews) {
      if (id === course.start.id || id === course.goal.id) continue;
      this.root.remove(view.group);
      this.islandViews.delete(id);
    }
    this.foliage.prune((v) => this.islandViews.get(v.island.id) === v);
    // thermals
    for (const t of this.thermals) this.root.remove(t.group);
    this.thermals.length = 0;
    for (const t of course.thermals) {
      const col = new ThermalColumn(t.source.radius, t.source.height);
      this.thermals.push(col);
      this.root.add(col.group);
    }
    this.sunbeam.target = course.kind === 'burst' ? 0.6 : 0;
    this.fireflies = 0;
    this.rainBias = 0;
    this.usedUpdraft = false;
    this.idle = 0;
    this.birds.roost(course.goal.center.x - 1, course.goal.center.y + 2.4, -2.4);
  }

  // ── the Weather Mind's voice: /api/mission ─────────────────────────────────

  private async requestMission(request: MissionRequest): Promise<void> {
    const serial = ++this.missionSerial;
    const game = this.game;
    const offline = () => {
      if (serial !== this.missionSerial) return;
      if (game.provideMission(adaptMission(fallbackMission(request.stage, request.run + request.losses), request), 'offline')) {
        console.info(`[weather mind] offline — "${game.awaitingMission ? '' : 'hand-written mission'}" for stage ${request.stage}`);
      }
    };
    if (flag('offline') || typeof fetch !== 'function') return offline();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('api/mission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!res.ok) return offline();
      const body = (await res.json()) as { source?: string; mission?: unknown; model?: string };
      const mission = validateMission(body.mission, request.stage);
      if (!mission) return offline();
      if (serial !== this.missionSerial) return;
      const source = body.source === 'gemini' ? 'gemini' : 'fallback';
      if (game.provideMission(mission, source)) {
        console.info(`[weather mind] ${source}${body.model ? ` (${body.model})` : ''} — "${mission.name}": ${mission.narrativeBeat}`);
      }
    } catch {
      offline();
    } finally {
      clearTimeout(timer);
    }
  }

  // ── desktop hint (three icons' worth of words; never shown in the headset) ─

  private buildHud(): void {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:0;right:0;bottom:22px;text-align:center;pointer-events:none;font:500 14px/1.4 ui-rounded,"Segoe UI",system-ui,sans-serif;' +
      'letter-spacing:.08em;color:#fff;text-shadow:0 1px 10px rgba(20,30,60,.55);opacity:0;transition:opacity 1.2s ease;z-index:5;';
    document.body.appendChild(el);
    this.hud = el;
    this.cleanupFuncs.push(() => el.remove());
  }

  private updateHud(presenting: boolean): void {
    if (!this.hud) return;
    const game = this.game;
    let text = '';
    if (!presenting && !this.autoplay) {
      if (!this.everPlucked) text = game.phaseTime > 3 ? 'sweep across the dandelion' : '';
      else if (game.stage === 0 && game.run === this.game.garden.runs && game.phase === 'flight' && !this.usedUpdraft) text = 'hold to cup your hands beneath it';
      else if (game.stage === 0 && game.phase === 'flight') text = 'carry it to the far island';
      else if (game.stage === 1 && game.phase !== 'bloom' && game.mind.losses >= 1) text = 'wait for the gate to exhale';
    }
    if (text !== this.hudState) {
      this.hudState = text;
      if (text) this.hud.textContent = text;
      this.hud.style.opacity = text ? '0.92' : '0';
    }
  }

  // ── the frame ──────────────────────────────────────────────────────────────

  update(delta: number): void {
    const dt = Math.min(0.1, Math.max(0, delta));
    this.time += dt;
    const time = this.time;
    const game = this.game;
    const presenting = this.renderer.xr.isPresenting;
    if (presenting && !this.wasPresenting) {
      this.audio.start();
      this.anchored = false;
    }
    this.wasPresenting = presenting;

    this.place(dt, presenting);
    this.readInput(presenting, dt);
    // ?speed=N fast-forwards the simulation (for testing and time-lapses)
    this.subIndex = 0;
    this.subCount = Math.max(1, this.stepper.pending(dt) * this.speed);
    for (let i = 0; i < this.speed; i++) this.stepper.advance(dt, this.step);
    const alpha = this.stepper.alpha;
    const course = game.course;
    const field = game.field;

    // point sizes are in metres: tell the point shaders how tall the view is in pixels
    let pixels = this.renderer.getDrawingBufferSize(v2).y;
    if (presenting) {
      const eye = this.renderer.xr.getCamera().cameras[0];
      if (eye && eye.viewport.w > 0) pixels = eye.viewport.w;
    }
    this.sparks.setScale(pixels, S);
    this.petals.setScale(pixels, S);
    this.seeds.setScale(pixels, S);

    // ── sky, light, weather ──
    this.camera.getWorldPosition(va);
    this.sky.update(game.sky, dt, va.x, va.y, va.z);
    if (this.lightningDelay >= 0) {
      this.lightningDelay -= dt;
      if (this.lightningDelay < 0 && game.sky.storm > 0.4) this.strike(0.9);
    }
    this.clouds.update(this.viewX, time, 0, this.sky.cloud, this.sky.cloudShade);
    const rainLevel = Math.max(0, Math.min(1, game.rain * (1 + this.rainBias)));
    const shelters = course.shelters;
    this.rain.update(dt, rainLevel, this.viewX, this.viewY, field.ambient.x * 1.5 - 1.2 * game.sky.storm, field.ambient.z * 1.5, (x, y, z) => {
      for (let i = 0; i < shelters.length; i++) {
        const s = shelters[i];
        if (x > s.min.x && x < s.max.x && z > s.min.z - 0.4 && z < s.max.z && y < s.max.y + 1.2) return true;
      }
      return false;
    });

    // ── islands and everything growing on them ──
    for (const view of this.islandViews.values()) updateBloom(view, dt, this.bloomSpeed);
    this.foliage.update(field, dt, time, this.petal);

    // ── hands ──
    const hands = game.hands;
    for (let i = 0; i < 2; i++) {
      const h = this.live[i];
      // in the headset the player's real hands are already visible
      const show = !presenting || this.autoplay;
      this.palms[i].update(show ? h : null, hands.streams[i].enabled ? hands.streams[i].strength : 0, dt);
      const sp = this.spawn.hands[i];
      sp.active = h !== null;
      if (h) {
        sp.x = h.position.x;
        sp.y = h.position.y;
        sp.z = h.position.z;
        sp.nx = h.palmNormal.x;
        sp.ny = h.palmNormal.y;
        sp.nz = h.palmNormal.z;
      }
    }
    this.teach(dt, presenting);

    // ── the air itself ──
    const spawn = this.spawn;
    spawn.cx = this.viewX;
    spawn.cy = this.viewY + 0.3;
    spawn.cz = 0;
    spawn.hotspots.length = 0;
    for (let i = 0; i < course.thermals.length; i++) {
      const t = course.thermals[i];
      const b = t.source.base;
      this.thermals[i]?.update(b.x, b.y, b.z, t.level, time + i * 0.37);
      if (t.level > 0.2) spawn.hotspots.push({ x: b.x, y: b.y, z: b.z, r: t.source.radius, h: t.source.height * 0.8 });
      if (t.level > 0.2 && Math.random() < dt * 9 * t.level) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * t.source.radius * 0.8;
        this.sparks.emit(b.x + Math.cos(a) * r, b.y + Math.random() * 1.5, b.z + Math.sin(a) * r, 0, 0.6, 0, GOLD, {
          life: 2.6, size: 0.045, windFollow: 1, twinkle: 0.6,
        });
      }
    }
    const relief = game.reliefThermal;
    const reliefLevel = relief.enabled ? Math.min(1, relief.strength / 3) : 0;
    this.reliefColumn.update(relief.base.x, relief.base.y, relief.base.z, reliefLevel, time);
    if (reliefLevel > 0.2) spawn.hotspots.push({ x: relief.base.x, y: relief.base.y, z: relief.base.z, r: relief.radius, h: relief.height * 0.8 });
    const aw = game.assistWind;
    if (aw.enabled && aw.strength > 0.4) spawn.hotspots.push({ x: aw.origin.x + 0.4, y: aw.origin.y, z: aw.origin.z, r: 0.7, h: 1.2 });
    let breath = 0;
    for (const p of course.pulses) {
      const o = p.stream.origin;
      if (game.pulse > 0.05) {
        spawn.hotspots.push({ x: o.x - 1.6, y: o.y - 0.5, z: o.z, r: 1.3, h: 1.0 });
        spawn.hotspots.push({ x: o.x - 3.2, y: o.y - 0.5, z: o.z, r: 1.1, h: 1.0 });
      }
      breath = Math.max(game.pulseWarning, game.pulse * 0.6);
      this.breath.position.set(o.x, o.y, o.z);
      if (game.pulseWarning > 0.1 && Math.random() < dt * 40) {
        // the gate inhales: motes are drawn toward its far mouth before it blows
        const a = Math.random() * 6.283, r = 0.8 + Math.random() * 0.9;
        const sx = o.x - 0.3 - Math.random() * 1.2, sy = o.y + Math.sin(a) * r * 0.6, sz = o.z + Math.cos(a) * r * 0.7;
        this.sparks.emit(sx, sy, sz, (o.x - sx) * 1.6, (o.y - sy) * 1.6, (o.z - sz) * 1.6, SKYBLUE, { life: 0.6, size: 0.05, drag: 0 });
      }
    }
    this.breath.visible = breath > 0.02;
    if (this.breath.visible) {
      (this.breath.material as ShaderMaterial).uniforms.uOpacity.value = 0.5 * breath;
      this.breath.scale.setScalar(0.7 + 0.5 * breath + 0.06 * Math.sin(time * 14));
    }
    this.streaks.weatherColor.copy(this.sky.sunColor).lerp(WHITE, 0.25);
    this.streaks.update(field, dt, spawn, 1);
    this.rings.update(dt);

    // ── seeds ──
    this.seeds.update(game.seeds, alpha, time, course.dandelion, course.seedCount > 1);
    this.trailClock += dt;
    if (this.trailClock > 0.028) {
      this.trailClock = 0;
      for (let i = 0; i < game.seeds.length; i++) {
        const s = game.seeds[i];
        if (s.status !== 'flying') continue;
        if (course.seedCount > 1 && Math.random() < 0.5) continue;
        tmpColor.copy(GOLD).lerp(WHITE, Math.min(1, s.glow * 0.5));
        this.sparks.emit(
          s.pos.x + (Math.random() - 0.5) * 0.05, s.pos.y + 0.12 + (Math.random() - 0.5) * 0.05, s.pos.z + (Math.random() - 0.5) * 0.05,
          s.vel.x * 0.15, s.vel.y * 0.15 - 0.1, s.vel.z * 0.15, tmpColor,
          { life: 0.7 + 0.5 * Math.random(), size: 0.035 + 0.02 * Math.min(1.5, s.glow), drag: 2, twinkle: 0.4 },
        );
      }
    }

    // ── mood pieces ──
    const goal = course.goal;
    if (this.fireflies > 0) {
      this.fireflies -= dt;
      if (Math.random() < dt * 14) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random());
        this.sparks.emit(goal.center.x + Math.cos(a) * r * goal.rx, goal.center.y + 0.15 + Math.random() * 0.9, goal.center.z + Math.sin(a) * r * goal.rz,
          (Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3, FIREFLY, { life: 2.8, size: 0.05, windFollow: 0.4, twinkle: 0.9 });
      }
    }
    if (this.petalShower > 0) {
      this.petalShower -= dt;
      if (Math.random() < dt * 16) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random());
        this.petal(goal.center.x + Math.cos(a) * r * goal.rx, goal.center.y + 0.2 + Math.random() * 0.4, goal.center.z + Math.sin(a) * r * goal.rz,
          (Math.random() - 0.5) * 1.2, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2);
      }
    }
    this.sunbeam.update(goal.center.x, goal.center.y, goal.center.z, dt, this.sky.sunColor);
    this.birds.update(dt, time);
    this.sparks.update(field, dt, time);
    this.petals.update(field, dt, time);

    // ── sound ──
    const lead = game.lead;
    this.audio.update(dt, {
      handEnergy: hands.energy,
      seedAir: lead ? Math.hypot(lead.airflow.x, lead.airflow.y, lead.airflow.z) : 0,
      ambient: Math.hypot(field.ambient.x, field.ambient.z) + field.turbulence,
      rain: rainLevel,
      dawn: game.sky.dawn,
      storm: game.sky.storm,
      golden: game.sky.golden,
      pulse: game.pulse,
      pulseWarning: game.pulseWarning,
      pan: lead ? this.pan(lead.pos.x) : 0,
    });
    this.updateHud(presenting);
  }

  /**
   * Teaching without words: if the player hesitates, a pair of golden ghost
   * hands performs the gesture the moment calls for. They make no wind.
   */
  private teach(dt: number, presenting: boolean): void {
    const game = this.game;
    const active = this.live[0] !== null || this.live[1] !== null;
    const making = game.hands.energy > 2;
    let want = false;
    if (!this.autoplay) {
      if (game.phase === 'awaiting') {
        this.idle = making ? Math.max(0, this.idle - dt * 2) : this.idle + dt;
        want = this.idle > (this.everPlucked ? 9 : active ? 6 : 3.5);
      } else if (game.phase === 'flight' && game.course.seedCount === 1) {
        // lost seeds without ever finding the updraft: show the cupped hands under the seed
        want = game.mind.losses >= 1 && !this.usedUpdraft && game.lead !== null;
        this.idle = 0;
      }
    }
    this.hintLevel += ((want ? 1 : 0) - this.hintLevel) * (1 - Math.exp(-3 * dt));
    const show = this.hintLevel > 0.03;
    if (show) this.ghost.update(game, dt);
    this.hintPalms[0].update(show ? this.ghost.left : null, 3, dt, this.hintLevel * 0.8);
    this.hintPalms[1].update(show ? this.ghost.right : null, 3, dt, this.hintLevel * 0.8);
    void presenting;
  }
}
