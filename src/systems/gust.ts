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
import { Color, CubeCamera, Group, LinearMipmapLinearFilter, Matrix4, Mesh, PerspectiveCamera, Vector2, Vector3, WebGLCubeRenderTarget, createSystem, IcosahedronGeometry, type ShaderMaterial } from '@iwsdk/core';
import {
  DEFAULT_GESTURES,
  FIXED_DT,
  FixedStepper,
  FrameGuard,
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
  groundBelow,
  parseGarden,
  serializeGarden,
  validateMission,
  vec3,
} from '../core/index.js';
import { Overlay, diagMode, markOnce, marks } from '../boot/diag.js';
import { disarmStartupGuard } from '../boot/guard.js';
import { PointerInput } from '../input/pointer.js';
import { HAND_BONES, HAND_JOINTS, XRHands } from '../input/xrHands.js';
import { GustAudio } from '../audio/audio.js';
import { Sky } from '../render/sky.js';
import { configureRenderer, configureSunShadows, dressScene } from '../render/look.js';
import { Room } from '../render/room.js';
import { Post } from '../render/post.js';
import { HandView } from '../render/handView.js';
import {
  JOURNAL_STORAGE_KEY,
  type Journal,
  entryFor,
  firstBook,
  addEntry,
  parseJournal,
  sanitizeKeeper,
  serializeJournal,
  today,
} from '../core/journal.js';
import { type IslandView, buildIslandView, buildObstacle, startBloom, updateBloom } from '../render/islands.js';
import { Foliage } from '../render/foliage.js';
import { Particles, Rain, type StreakSpawn, WindStreaks } from '../render/air.js';
import { SeedViews, buildDandelion } from '../render/seeds.js';
import { Birds, CloudSea, PalmMarker, PalmShadow, ShockRings, Sunbeam, ThermalColumn, softLightMaterial } from '../render/extras.js';

/**
 * Simulation metres per real metre.
 *
 * 1:7 made the world a metre wide — a playset, not a specimen. At 1:18 the same
 * cross-island course is about 39 cm across, which is what fits under a bell
 * jar on a desk. Gesture thresholds scale with this number, so the *physical*
 * feel of a sweep is unchanged: only the size of the world it moves.
 */
const UNIT = 30;
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
// In a room lit by one lamp, a pure white petal is the brightest object in the
// frame and the eye goes straight to it. Cream, not white.
const PETALS = [0xff8fab, 0xffc971, 0xfff3b0, 0xf3e2c0, 0xf7a8d8].map((c) => new Color(c));

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
  /**
   * The player's hands, drawn. Two draw calls per hand, and only in a session:
   * on the desk the mouse is the hand and the marker says so.
   */
  private readonly handViews = [0, 1].map(() => {
    const v = new HandView(HAND_JOINTS.length, HAND_BONES.length, 0xffe0b0, 0.9);
    v.boneTable = HAND_BONES;
    v.setVisible(false);
    return v;
  });
  /** ?perf=1 / ?diag=1 — measured numbers, never shown to a player. */
  private readonly overlay = new Overlay(diagMode());
  /** The XR frame-time monitor: degrades knobs, never the picture. */
  private readonly frames = new FrameGuard({ budgetMs: 13.9, sustain: 2, maxTier: 2 });
  private shadowEvery = 1;
  private frameCount = 0;
  private fpsSmoothed = 60;
  private inkEnds = 0;
  private closeAt = 0;
  private spokeHint = false;
  private handLostSince = [-1, -1];
  private handReacquired = 0;
  private shadowCasters = 0;
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
  private room!: Room;
  private journal!: Journal;
  private post: Post | null = null;
  private readonly roomAt = new Vector3();
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
  /** The shadow each palm throws on the diorama, so hands feel like objects in the room. */
  private readonly palmShadows: [PalmShadow, PalmShadow] = [new PalmShadow(PALM), new PalmShadow(PALM)];
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
  private vignette: HTMLElement | null = null;
  private hudState = '';
  private bloomSpeed = 1.5;
  private missionSerial = 0;
  private spokeEntry = false;
  private spokeHome = false;
  private lastSpokenLoss = -99;
  private readonly speed = Math.max(1, Math.min(12, Math.round(num('speed', 1))));
  private time = 0;

  init(): void {
    const renderer = this.renderer;
    renderer.setClearColor(0x101820, 1);

    // ── the game ──
    let saved: string | null = null;
    try {
      if (flag('reset')) localStorage.removeItem(GARDEN_STORAGE_KEY);
      saved = localStorage.getItem(GARDEN_STORAGE_KEY);
    } catch {
      saved = null; // private mode etc.: the garden simply lives for this visit
    }
    // the keeper's book: the ledger on the desk is this data, in ink
    let savedBook: string | null = null;
    try {
      if (flag('reset')) localStorage.removeItem(JOURNAL_STORAGE_KEY);
      savedBook = localStorage.getItem(JOURNAL_STORAGE_KEY);
    } catch {
      savedBook = null;
    }
    let book = savedBook ? parseJournal(savedBook) : firstBook();
    const keeper = params.get('keeper');
    if (keeper) book = { ...book, keeper: sanitizeKeeper(keeper) };
    this.journal = book;

    const quality = num('quality', 1);
    configureRenderer(renderer, { quality });
    // Shadows are drawn on a cadence the frame monitor owns (see applyTier), so
    // the renderer must not update them on its own. Manual reset keeps the
    // draw-call and triangle counts honest across the post pass.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.info.autoReset = false;
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

    // The specimen desk. The islands are no longer a landscape in the sky; they
    // are an object on a table, under one lamp, inside brass and glass.
    this.room = new Room();
    this.room.setJournal(this.journal);
    this.room.setKeeper(this.journal.keeper);
    this.scene.add(this.room.group);
    this.world.createTransformEntity(this.room.group);

    // Brass and glass are nothing but their reflections, and a room has no HDR
    // sky to borrow. Render the room into a small cube once, hand it to the
    // metal, and never pay for it again.
    {
      const cube = new WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
      const cubeCam = new CubeCamera(0.02, 8, cube);
      cubeCam.position.set(this.anchor.x, this.anchor.y - 0.01, this.anchor.z + 0.05);
      this.scene.add(cubeCam);
      this.room.group.visible = false;
      cubeCam.update(this.renderer, this.scene);
      this.room.group.visible = true;
      this.scene.remove(cubeCam);
      this.room.applyEnvironment(cube.texture);
    }

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
    for (const s of this.palmShadows) this.root.add(s.mesh);
    for (const v of this.handViews) this.scene.add(v.group);

    // Light the diorama like an object on a table: one sun with a real shadow,
    // a rim on every silhouette, filmic exposure. See src/render/look.ts.
    configureSunShadows(this.sky.sun);
    dressScene(this.root);
    this.scene.traverse((o: { castShadow?: boolean }) => {
      if (o.castShadow) this.shadowCasters++;
    });

    // In the room the lamp is the only real light: the old sky sun stops
    // casting, the dome goes away, and the cloud sea has nothing to do.
    this.sky.hideDome();
    this.sky.sun.castShadow = false;
    this.clouds.mesh.visible = false;
    this.birds.mesh.visible = false; // gulls belong outdoors; the dust is the life in here
    renderer.setClearColor(0x0a0806, 1);

    // ── input ──
    this.pointer = new PointerInput(renderer.domElement);
    this.pointer.onFirstGesture = () => {
      this.audio.start();
      // the room has a voice, and it has been waiting for you to put your
      // hands on the desk
      if (!this.spokeEntry) {
        this.spokeEntry = true;
        this.audio.say('entry');
      }
    };
    this.audio.muted = flag('mute');
    this.cleanupFuncs.push(() => this.pointer.dispose());
    this.buildHud();

    this.birds.roost(this.game.course.goal.center.x, 2.6, -2.2);
    this.viewX = (this.game.course.dandelion.x + this.game.course.goal.center.x) * 0.5;
    this.viewY = this.viewHeight();
    this.drain();

    // Starting mid-course (or returning after a pause) must never leave the
    // title card floating over live play: it is an intro, not a watermark.
    if (this.game.stage > 0 && typeof document !== 'undefined') {
      document.body.classList.add('gust-playing');
    }

    // ── the lens ──
    // In the browser the frame goes through a real focal plane; in a headset it
    // does not, because an eye can focus for itself. Taking the loop over is a
    // dozen lines — the SDK's own loop is mirrored here exactly, with the post
    // pass inserted where `renderer.render` used to be.
    if (!flag('raw') && typeof window !== 'undefined') {
      this.post = new Post(renderer, this.scene, this.camera as PerspectiveCamera, { debug: num('postdebug', 0) });
      const size = new Vector2();
      const world = this.world;
      let last = performance.now();
      let elapsed = 0;
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        let dt = (now - last) / 1000;
        last = now;
        if (!(dt > 0)) dt = 1 / 72;
        if (dt > 0.25) dt = 0.25;
        elapsed += dt;
        // one frame's worth of statistics, counted from here
        this.frameCount++;
        renderer.info.reset();
        renderer.shadowMap.needsUpdate = this.frameCount % this.shadowEvery === 0;
        world.update(dt, elapsed);
        const frame = renderer.xr.getFrame?.();
        if (frame) world.runXRFrameCallbacks(frame, dt, elapsed);
        if (!renderer.xr.isPresenting) {
          renderer.getDrawingBufferSize(size);
          this.post?.setSize(size.x, size.y);
          const focus = this.camera.position.distanceTo(this.roomAt);
          if (this.post) {
            this.room.bulbWorld(this.post.lampWorld);
            this.post.lampPresent = true;
          }
          this.post?.render(dt, Math.max(0.2, focus));
        } else {
          renderer.render(world.scene, world.camera);
        }
        this.afterRender(dt);
      });
    }

    // The system is listening for hands, controllers, pointers and the XR
    // button: from here a player can act.
    markOnce('interactive');
    (window as unknown as { __gust: unknown }).__gust = { game: this.game, system: this };
  }

  // ── measurement ────────────────────────────────────────────────────────────

  private perfCalls = 0;
  private perfTris = 0;

  /**
   * Everything the frame told us. The first rendered frame is also the moment
   * the start-up guard lets go: after this, a stray rejection is a bug, not a
   * failed load, and an apology over a running game would be worse than the bug.
   */
  private afterRender(dt: number): void {
    const info = this.renderer.info.render;
    this.perfCalls = info.calls;
    this.perfTris = info.triangles;
    if (this.frameCount === 1) {
      markOnce('first-frame');
      disarmStartupGuard();
      const frame = marks['first-frame'] ?? 0;
      const live = marks.interactive ?? frame;
      console.info(
        `[gust] cold start ${frame.toFixed(0)} ms to first frame, ${live.toFixed(0)} ms to interactive` +
          (this.overlay.active ? '' : ' (add ?perf=1 for live numbers)'),
      );
    }
    if (dt > 0) this.fpsSmoothed += (1 / dt - this.fpsSmoothed) * 0.08;
    // The frame monitor is a headset instrument: on a desk the picture is worth
    // more than the frame, and there is no fixed refresh to miss.
    if (this.renderer.xr.isPresenting) {
      const tier = this.frames.push(dt);
      if (tier !== null) this.applyTier(tier);
    }
  }

  /**
   * Degrade the knobs that need no shader recompile, in this order: shadow
   * cadence, then wind streaks, then foveation. The lamp's shadow of the jar and
   * of the player's hand is the picture — it goes last, and at tier 2 it is
   * still being drawn, only every third frame.
   */
  private applyTier(tier: number): void {
    this.shadowEvery = tier >= 2 ? 3 : tier >= 1 ? 2 : 1;
    this.streaks.setDensity(tier >= 2 ? 0.45 : tier >= 1 ? 0.7 : 1);
    try {
      this.renderer.xr.setFoveation(tier >= 2 ? 0.55 : 0);
    } catch {
      /* foveation is optional and unimplemented on some runtimes */
    }
  }

  private diagLines(): string[] {
    const game = this.game;
    const lines: string[] = [];
    const ms = 1000 / Math.max(1e-3, this.fpsSmoothed);
    lines.push(`fps ${this.fpsSmoothed.toFixed(0).padStart(3)}  frame ${ms.toFixed(1)} ms`);
    lines.push(`calls ${this.perfCalls}  tris ${(this.perfTris / 1000).toFixed(1)}k  casters ${this.shadowCasters}`);
    if (this.overlay.mode !== 'diag') return lines;
    const first = marks['first-frame'];
    lines.push(`cold start ${first === undefined ? '—' : first.toFixed(0) + ' ms'}`);
    lines.push(`act ${game.stage + 1}/4  ${game.phase}  tier ${this.frames.tier}  shadows 1/${this.shadowEvery}`);
    const hand = this.renderer.xr.isPresenting ? 'xr' : 'desk';
    const lost = this.handLostSince.map((t, i) => (t >= 0 && !this.live[i] ? `L${i ? 'R' : 'L'} lost ${(this.time - t).toFixed(1)}s` : '')).filter(Boolean);
    lines.push(`hands ${hand}  ${this.live[0] ? 'L✓' : 'L·'} ${this.live[1] ? 'R✓' : 'R·'}  re-acquired ${this.handReacquired}${lost.length ? '  ' + lost.join(' ') : ''}`);
    const pluck = marks.firstPluck;
    lines.push(`first pluck ${pluck === undefined ? '—' : pluck.toFixed(0) + ' ms'}`);
    return lines;
  }

  // ── placement ──────────────────────────────────────────────────────────────

  private viewHeight(): number {
    // Follow the seed's height only a little. The desk is furniture: in the room
    // the camera does the following, and the world stays where the case holds it.
    return 0.95 + 0.12 * (this.game.focus.y - 0.95);
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
        vc.copy(va).addScaledVector(vb, 0.86);
        vc.y = va.y - 0.24;
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
      const px = this.pointer.present ? this.pointer.x : 0;
      const py = this.pointer.present ? this.pointer.y : 0;
      // A chair at the desk, not a crane over a course: the eye sits a hand's
      // width above the table and a forearm back from the glass, so the case
      // fills the frame and the ledger falls away at the bottom right.
      // The pointer nudges the eye a few millimetres, which is enough parallax
      // for the desk to read as a place with depth.
      const eyeZ = this.anchor.z + 0.755;
      cam.position.set(this.anchor.x + 0.05 + px * 0.02, this.anchor.y + 0.168 + py * 0.012, eyeZ);
      // Off-centre, on purpose. A centred subject is a screenshot; a subject
      // held in the left third, with the desk's working edge down the right, is
      // a picture. The eye also looks a hand's width past the glass, at the
      // shelf behind it, which drops the horizon into the top third.
      cam.lookAt(this.anchor.x + 0.062, this.anchor.y + 0.034, this.anchor.z - 0.05);
      // a degree of roll. Nobody holds a camera level, and the eye reads the
      // lean long before it can name it.
      cam.rotateZ(0.014);
      void span;
    }

    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const lx = -this.viewX * S, ly = -this.viewY * S;
    this.root.rotation.set(0, this.yaw, 0);
    this.root.position.set(this.anchor.x + lx * cos, this.anchor.y + ly, this.anchor.z - lx * sin);
    this.root.updateMatrixWorld(true);
    toSim.copy(this.root.matrixWorld).invert();
  }

  // ── input -> raw palm poses in simulation space ────────────────────────────

  private readInput(presenting: boolean): void {
    this.rawActive[0] = this.rawActive[1] = false;
    if (presenting) {
      this.xrHands.update(this.renderer.xr.getFrame() as XRFrame | null, this.renderer.xr.getReferenceSpace());
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
        // The tick that turns a movement into a confirmed gesture. Both hands
        // feel a two-handed gesture; one hand feels its own sweep. Tracked
        // hands have no actuator and simply do not tick.
        const tick = (side: 'left' | 'right', power: number) => {
          if (this.autoplay) return;
          this.xrHands.pulse(side, Math.min(0.8, 0.18 + power * 0.5), 16);
        };
        if (g.type === 'gust') {
          this.audio.gust(g.strength, this.pan(g.position.x));
          tick(g.hand === 0 ? 'left' : 'right', Math.min(1, g.strength / 6));
        } else if (g.type === 'clap') {
          this.audio.clap(this.pan(g.position.x));
          this.rings.fire(g.position.x, g.position.y, g.position.z, game.hands.params.clapSpeed, game.hands.params.clapDuration);
          this.birds.scatter(g.position.x, g.position.y, g.position.z, 1);
          this.burst(g.position.x, g.position.y, g.position.z, 18, 4.5, WHITE, 0.07, 0.6);
          tick('left', 0.9);
          tick('right', 0.9);
        } else if (g.type === 'whirl') {
          this.audio.whirl();
          tick('left', 0.4);
          tick('right', 0.4);
        } else if (g.type === 'updraft') {
          this.audio.updraft();
          this.usedUpdraft = true;
          tick('left', 0.3);
          tick('right', 0.3);
        }
        break;
      }
      case 'pluck':
        if (e.first) {
          markOnce('firstPluck');
          this.audio.pluck(this.pan(e.seed.pos.x));
          this.everPlucked = true;
          if (typeof document !== 'undefined') document.body.classList.add('gust-playing'); // the title drifts away
        }
        this.burst(e.seed.pos.x, e.seed.pos.y, e.seed.pos.z, e.first ? 14 : 3, 1.6, WARM, 0.06, 0.9);
        break;
      case 'lost':
        this.audio.lost(this.pan(e.seed.pos.x));
        // the line is short and consoling, but nobody wants to hear it twelve
        // times in a minute
        if (this.time - this.lastSpokenLoss > 18) {
          this.lastSpokenLoss = this.time;
          this.audio.say('lost');
        }
        break;
      case 'respawn':
      case 'regrow':
        this.audio.respawn();
        this.burst(game.course.dandelion.x, game.course.dandelion.y + 0.15, game.course.dandelion.z, 10, 0.9, WARM, 0.05, 1.1);
        break;
      case 'planted': {
        const p = e.seed.pos;
        // the first seed to reach the far island gets a word
        if (!this.spokeHome && e.island.id === game.course.goal.id) {
          this.spokeHome = true;
          this.audio.say('home');
        }
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
        // No line here. "The book is written" said four times a run is a
        // sound effect; it is said once, when the ink is actually drying.
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
        // and the run goes into the book, in the keeper's own hand
        const ambient = game.field.ambient;
        this.journal = addEntry(
          this.journal,
          entryFor({
            day: today(),
            seeds: e.landed,
            x: ambient.x,
            z: ambient.z,
            air: Math.min(1, Math.hypot(ambient.x, ambient.z) / 2.2),
            course: game.course.mission.name,
          }),
        );
        try {
          localStorage.setItem(JOURNAL_STORAGE_KEY, serializeJournal(this.journal));
        } catch {
          /* the book lasts for this visit only */
        }
        // The last twenty seconds are the picture: the pen writes the line in
        // front of the player, the blot pools when it is lifted, and only then
        // does the room speak. The entry is already in memory and in storage;
        // this is the moment it becomes the keeper's book.
        this.room.writeJournal(this.journal);
        this.inkEnds = this.time + Room.INK_SECONDS;
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
        this.audio.say(`s${Math.max(0, Math.min(3, request.stage))}`);
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
        this.audio.say(`s${Math.max(0, Math.min(3, request.stage))}`);
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

    // A lens vignette for the flat screen only. In a headset there is no lens
    // border to imitate, so it is switched off the moment a session starts.
    const vig = document.createElement('div');
    vig.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:1;transition:opacity .5s ease;' +
      'background:radial-gradient(ellipse 78% 78% at 50% 46%, rgba(6,8,18,0) 55%, rgba(6,8,18,.34) 100%);';
    document.body.appendChild(vig);
    this.vignette = vig;
    this.cleanupFuncs.push(() => vig.remove());
  }

  private updateHud(presenting: boolean): void {
    if (this.vignette) this.vignette.style.opacity = presenting ? '0' : '1';
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

    if (!this.post && this.frameCount === 0) {
      // no post chain (?raw=1): the SDK's own loop draws, so release the guard here
      markOnce('first-frame');
      this.frameCount = 1;
      disarmStartupGuard();
    }
    this.place(dt, presenting);
    this.readInput(presenting);
    // a hand that goes away and comes back is worth counting: it is the whole
    // difference between a tracked session and a broken one
    for (let i = 0; i < 2; i++) {
      if (this.live[i]) {
        if (this.handLostSince[i] >= 0) {
          this.handReacquired++;
          this.handLostSince[i] = -1;
        }
      } else if (this.handLostSince[i] < 0) {
        this.handLostSince[i] = this.time;
      }
    }
    if (this.overlay.active) this.overlay.set(this.time, this.diagLines());

    // ── the voice, at the moments that matter ──
    // In a headset there is no first pointer gesture, so the entry line waited
    // forever. It waits for a hand instead, and for the lamp to be up.
    if (!this.spokeEntry && presenting && this.time > 2.2 && (this.live[0] || this.live[1])) {
      this.spokeEntry = true;
      this.audio.say('entry');
    }
    // the ink dries, then the book is spoken of, then the last word in the room
    if (this.inkEnds > 0 && this.time >= this.inkEnds) {
      this.inkEnds = 0;
      this.audio.say('written');
      this.closeAt = this.time + 1.8;
    }
    if (this.closeAt > 0 && this.time >= this.closeAt) {
      this.closeAt = 0;
      this.audio.say('close');
    }
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
    // the score follows the act, not the timer: the sky is the clock
    this.audio.setMood(game.sky.storm > 0.45 ? 'storm' : game.sky.golden > 0.55 ? 'golden' : 'dawn');

    // ── the room owns the light ──
    // Root space puts simulation x=0 at the root's origin; the case has to sit
    // over the middle of the course instead, so map the view centre out.
    this.roomAt.set(this.viewX, 0.18, 0);
    this.root.localToWorld(this.roomAt);
    this.room.update(dt, this.roomAt, game.sky, time);
    // A trace of sky survives at a high window, so faces never go black — but
    // only a trace. Every tenth of ambient light is a tenth of the lamp's
    // shadow removed, and the whole picture is the lamp's shadow.
    this.sky.sun.intensity = 0.035;
    this.sky.hemi.intensity = 0.085;
    this.sky.hemi.color.setRGB(0.72, 0.79, 0.95);
    this.sky.fog.color.setRGB(0.010, 0.0085, 0.0075);
    this.sky.fog.near = 0.7;
    this.sky.fog.far = 3.4;
    if (this.lightningDelay >= 0) {
      this.lightningDelay -= dt;
      if (this.lightningDelay < 0 && game.sky.storm > 0.4) this.strike(0.9);
    }
    this.clouds.update(this.viewX, time, 0, this.sky.cloud, this.sky.cloudShade, this.sky.fog);
    // The desk is indoors. Rain falling across a study, through the glass of a
    // bell jar, is the fastest way to break the frame there is. Weather in this
    // game belongs to the specimens — the wind in the case, the petals on it —
    // and not to the room they are standing in.
    const rainLevel = 0;
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
      // the tracked hand itself (not a marker): beads on the joints, in world space
      {
        const palm = i === 0 ? this.xrHands.left : this.xrHands.right;
        const view = this.handViews[i];
        view.update(
          palm.joints ?? [],
          palm.jointValid ?? [],
          this.player.matrixWorld,
          presenting && palm.active && palm.isHand,
        );
      }
      // In the headset the player's real hands are visible, so the drawn palm
      // markers would be a second pair of hands. Their SHADOWS are the opposite:
      // a real hand does not cast anything onto a diorama through a bell jar, and
      // a hand crossing the island with its shadow under it is the image this
      // game is for. So the markers stay hidden and the shadows are drawn.
      const showMarkers = !presenting || this.autoplay;
      this.palms[i].update(showMarkers ? h : null, hands.streams[i].enabled ? hands.streams[i].strength : 0, dt);
      // ground the hand: a palm over an island darkens it
      const shadow = this.palmShadows[i];
      if (h) {
        const ground = groundBelow(game.course.terrain, h.position.x, h.position.z, h.position.y);
        // Off an island there is still a surface under the hand: the case floor.
        // A hand crossing the water between the islands should darken it, which
        // is most of what makes the gesture feel attached to the world.
        const overIsland = Number.isFinite(ground);
        const gy = overIsland ? ground : 0;
        // Heights are in simulation units (1:30). A real hand 20 cm above the
        // table is 6 of them; convert to metres before deciding how strong a
        // shadow a hand at that distance would throw.
        const height = Math.max(0, h.position.y - gy) * S;
        const fade = overIsland ? 0.5 : 0.62;
        // In a session the hand is further away and always present: keep it felt,
        // not heavy.
        const k = presenting ? 0.8 : 1;
        shadow.place(
          h.position.x,
          gy,
          h.position.z,
          1 + height * 2.2,
          Math.max(0, 1 - height / fade) * k,
        );
      } else {
        shadow.place(0, 0, 0, 1, 0);
      }

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
    this.seeds.update(game.seeds, alpha, time, course.dandelion, course.seedCount > 1, (x, z, fromY) =>
      groundBelow(course.terrain, x, z, fromY),
    );
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
    // There is no sunbeam indoors: the lamp is the only shaft of light, and it
    // is already geometry.
    this.sunbeam.mesh.visible = false;
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
      // the same field the grass, the rain and the seed read
      windX: field.ambient.x,
      windZ: field.ambient.z,
      turbulence: field.turbulence,
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
    // The hint is a pair of golden hands, not a sentence across the sky, so the
    // recording is used once: the first time the game decides to teach, the room
    // also says what the hands are for. After that it would be nagging.
    if (show && !this.spokeHint) {
      this.spokeHint = true;
      this.audio.say('hint');
    }
    if (show) this.ghost.update(game, dt);
    this.hintPalms[0].update(show ? this.ghost.left : null, 3, dt, this.hintLevel * 0.8);
    this.hintPalms[1].update(show ? this.ghost.right : null, 3, dt, this.hintLevel * 0.8);
    void presenting;
  }
}
