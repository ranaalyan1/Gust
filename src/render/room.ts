/**
 * THE ROOM — a naturalist's desk, at night, with one lamp on.
 *
 * This is the whole reason for the change: a floating island over a pastel sky
 * is a stock image. The same islands, held in a brass-and-glass apparatus on a
 * walnut desk, under one warm lamp, become a *thing someone owns*. Scale,
 * warmth and a single light source do more for presence than any amount of
 * post-processing.
 *
 * Everything here is procedural — wood grain, brass wear, glass, dust — so it
 * ships with no textures and no models, and still runs at headset frame rates.
 *
 * The desk's paperwork lives in `marks.ts`: it is the part of the room that
 * remembers the player.
 *
 * References: the specimen tables of Victorian naturalists; the Harvard glass
 * flowers; *The Room VR* for material honesty at arm's length; *Red Matter 2*
 * for single-source lighting.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CircleGeometry,
  CylinderGeometry,
  type CubeTexture,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  LinearFilter,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  RGBAFormat,
  RepeatWrapping,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { hash01 } from '../core/random.js';
import type { SkyBlend } from '../core/game.js';
import type { Journal } from '../core/journal.js';
import { glassMaterial } from './glass.js';
import { DeskMarks } from './marks.js';
import { blobTexture } from './blob.js';

/**
 * The world is a metre wide (two islands seven simulation metres apart at 1:7),
 * so the furniture is sized to *it*: a museum specimen table, not a side table.
 * Getting this backwards was the first version's main mistake.
 */
const TABLE_Y = -0.12;
const TABLE_R = 1.35;
/** The bell jar the world floats inside. */
const CASE_R = 0.50;
const CASE_H = 0.34;
/** Dome spring: how flat the top of the jar is, 1 = a hemisphere. */
const DOME = 0.62;
/**
 * The room is authored at a comfortable drafting scale and then shrunk as one
 * object, so its proportions stay right when the world's scale changes.
 */
const ROOM_K = 7 / 18;

/* ── procedural textures ─────────────────────────────────────────────────── */

let woodTex: DataTexture | null = null;
let grainTex: DataTexture | null = null;

/** Walnut: broad grain rings across the length, finer pores along it. */
function walnut(): DataTexture {
  if (woodTex) return woodTex;
  const w = 256;
  const h = 256;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // growth rings, warped so they are not machined-straight
      const warp = Math.sin(v * 21.0 + Math.sin(u * 6.3) * 1.4) * 0.5 + 0.5;
      const ring = Math.pow(warp, 2.2);
      // pores
      const pore = hash01(x * 73 + y * 151);
      const fleck = pore > 0.93 ? (pore - 0.93) * 2.6 : 0;
      const warmth = 0.82 + 0.18 * Math.sin(u * 3.1 + v * 1.7);
      const r = (0.30 + 0.16 * ring) * warmth + fleck * 0.1;
      const g = (0.19 + 0.1 * ring) * warmth + fleck * 0.07;
      const b = (0.12 + 0.06 * ring) * warmth + fleck * 0.05;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, r * 255);
      data[i + 1] = Math.min(255, g * 255);
      data[i + 2] = Math.min(255, b * 255);
      data[i + 3] = 255;
    }
  }
  woodTex = new DataTexture(data, w, h, RGBAFormat);
  woodTex.wrapS = woodTex.wrapT = RepeatWrapping;
  woodTex.repeat.set(7.5, 7.5);
  woodTex.magFilter = LinearFilter;
  woodTex.minFilter = LinearFilter;
  woodTex.needsUpdate = true;
  return woodTex;
}

/**
 * The wall behind the desk: vertical boards, tongue and groove, each board a
 * slightly different piece of the same tree. A flat gradient behind a lit case
 * reads as a studio backdrop; boards read as a room with a date on it.
 */
let wallTex: DataTexture | null = null;
function panelling(): DataTexture {
  if (wallTex) return wallTex;
  const w = 512;
  const h = 256;
  const data = new Uint8Array(w * h * 4);
  const boards = 9;
  for (let x = 0; x < w; x++) {
    const bu = (x / w) * boards;
    const board = Math.floor(bu);
    const f = bu - board;
    const tone = 0.72 + hash01(board * 37 + 5) * 0.5;
    // the seam: a dark groove, one pixel of light on its left shoulder
    const seam = f < 0.045 ? 0.25 : f < 0.075 ? 1.35 : 1.0;
    for (let y = 0; y < h; y++) {
      const v = y / h;
      // long grain: streaks that run the height of the board, plus a little fine noise
      const streak = Math.sin(v * 60.0 + hash01(board * 11) * 9.0 + Math.sin(v * 7.0) * 2.0) * 0.5 + 0.5;
      const fine = hash01(x * 17 + y * 91) * 0.12;
      const shade = tone * (0.86 + streak * 0.16 + fine) * seam;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, shade * 96);
      data[i + 1] = Math.min(255, shade * 78);
      data[i + 2] = Math.min(255, shade * 62);
      data[i + 3] = 255;
    }
  }
  wallTex = new DataTexture(data, w, h, RGBAFormat);
  wallTex.wrapS = wallTex.wrapT = RepeatWrapping;
  wallTex.repeat.set(2.4, 1);
  wallTex.magFilter = LinearFilter;
  wallTex.minFilter = LinearFilter;
  wallTex.needsUpdate = true;
  return wallTex;
}

/** Brass: mostly even, with tarnish pooling and faint scratches. */
function brass(): DataTexture {
  if (grainTex) return grainTex;
  const w = 128;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = hash01(x * 31 + y * 97) * 0.5 + hash01(x * 7 + y * 13) * 0.5;
      const scratch = Math.sin((x * 0.9 + y * 0.2) * 0.7 + n * 6.0) * 0.05;
      const tarnish = Math.pow(n, 3.0) * 0.35;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, (0.78 - tarnish + scratch) * 255);
      data[i + 1] = Math.min(255, (0.58 - tarnish * 0.9 + scratch) * 255);
      data[i + 2] = Math.min(255, (0.26 - tarnish * 0.6 + scratch) * 255);
      data[i + 3] = 255;
    }
  }
  grainTex = new DataTexture(data, w, h, RGBAFormat);
  grainTex.wrapS = grainTex.wrapT = RepeatWrapping;
  grainTex.magFilter = LinearFilter;
  grainTex.minFilter = LinearFilter;
  grainTex.needsUpdate = true;
  return grainTex;
}

/** A dried coffee ring: dark at the lip, almost clear in the middle. */
let stainTex: CanvasTexture | null = null;
function ringStain(): CanvasTexture {
  if (stainTex) return stainTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  for (let i = 0; i < 900; i++) {
    const a = hash01(i * 3 + 1) * Math.PI * 2;
    const rr = c * (0.62 + hash01(i * 7 + 2) * 0.3);
    const w = 1.2 + hash01(i * 11) * 3.4;
    ctx.fillStyle = `rgba(74, 44, 22, ${0.05 + hash01(i * 17) * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * rr, c + Math.sin(a) * rr, w, w * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  stainTex = new CanvasTexture(canvas);
  return stainTex;
}

const woodMaterial = (): MeshStandardMaterial =>
  // A waxed desk is glossy, and the gloss is a long, soft reflection of the
  // bulb. Roughness 0.62 turned the varnish into sandpaper and the whole top
  // of the picture into one brown value.
  new MeshStandardMaterial({ map: walnut(), color: 0x4e3a2d, roughness: 0.44, metalness: 0.05 });

const brassMaterial = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ map: brass(), color: 0xffffff, roughness: 0.34, metalness: 0.72 });

/* ── the room ────────────────────────────────────────────────────────────── */

export class Room {
  readonly group = new Group();
  private readonly inner = new Group();
  readonly marks: DeskMarks;
  /** Materials that need something to reflect. */
  private readonly shiny: MeshStandardMaterial[] = [];
  readonly lamp: SpotLight;
  private readonly bulb: PointLight;
  /** The bulb mesh, so the lens flare can be attached to a real position. */
  private bulbMesh!: Mesh;
  private readonly shade: Mesh;
  private readonly glow: Sprite;
  private readonly dust: Points;
  private readonly dustPos: Float32Array;
  private readonly dustSeeds: Float32Array;
  private readonly backdrop: Mesh;

  constructor() {
    this.inner.scale.setScalar(ROOM_K);
    this.group.add(this.inner);
    const wood = woodMaterial();
    const metal = brassMaterial();
    const darkBrass = new MeshStandardMaterial({ map: brass(), color: 0x8a7134, roughness: 0.46, metalness: 0.66 });
    this.shiny.push(metal, darkBrass);

    // ── the desk ──
    const table = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R * 0.98, 0.085, 72), wood);
    table.position.y = TABLE_Y - 0.0425;
    table.receiveShadow = true;
    this.inner.add(table);

    // a turned brass edge, because a bare cylinder edge reads as a cardboard cut-out
    const rim = new Mesh(new TorusGeometry(TABLE_R, 0.013, 8, 96), metal);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE_Y;
    this.inner.add(rim);

    // a leather blotter under the book, square to the room: the desk has a
    // working side and a display side, and only one of them is round
    const blotter = new Mesh(
      new BoxGeometry(1.02, 0.014, 0.76),
      new MeshStandardMaterial({ color: 0x22301f, roughness: 0.72, metalness: 0 }),
    );
    blotter.position.set(CASE_R + 0.44, TABLE_Y + 0.007, CASE_R + 0.72);
    blotter.rotation.y = -0.46;
    blotter.receiveShadow = true;
    this.inner.add(blotter);
    const blotterEdge = new Mesh(
      new BoxGeometry(1.04, 0.0045, 0.025),
      new MeshStandardMaterial({ color: 0x6b6244, roughness: 0.9 }),
    );
    blotterEdge.position.set(blotter.position.x, TABLE_Y + 0.0148, blotter.position.z - 0.38);
    blotterEdge.rotation.y = blotter.rotation.y;
    this.inner.add(blotterEdge);

    // where the bulb ends up, in the room's own frame: the glass needs to know
    // what it is reflecting before it is built
    const lampX0 = -1.04;
    const stemH0 = 0.78;
    const lampBulbLocal = new Vector3(
      lampX0 + 0.44 + 0.02 + Math.sin(-0.62) * -0.085,
      TABLE_Y + stemH0 + 0.16 - 0.055,
      -0.70 + 0.28 + 0.02,
    );

    // ── the apparatus: the islands live inside brass and glass ──
    // A bell jar, not a cylinder: a wall, a domed top, a knob, and a brass
    // collar where the two meet. The silhouette is what makes it read as a
    // vessel rather than a hoop.
    // A bell jar, not a cylinder: a wall, a domed top, a knob, and a brass
    // collar where the two meet. The silhouette is what makes it read as a
    // vessel rather than a hoop. The glass itself is hand-authored — see
    // glass.ts for why an env-mapped standard material turns into a milk jug.
    const glassMat = glassMaterial();
    // the bulb sits at a known point, so the reflection can be exactly there
    (glassMat.uniforms.uBulb.value as Vector3).set(lampBulbLocal.x, lampBulbLocal.y, lampBulbLocal.z);
    const wall = new Mesh(new CylinderGeometry(CASE_R, CASE_R * 1.005, CASE_H, 64, 1, true), glassMat);
    wall.position.y = TABLE_Y + CASE_H * 0.5 + 0.016;
    wall.renderOrder = 4;
    this.inner.add(wall);

    const dome = new Mesh(new SphereGeometry(CASE_R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    dome.scale.y = DOME;
    dome.position.y = TABLE_Y + CASE_H + 0.016;
    dome.renderOrder = 4;
    this.inner.add(dome);

    // the collar
    const collar = new Mesh(new TorusGeometry(CASE_R, 0.0085, 8, 72), metal);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = TABLE_Y + CASE_H + 0.016;
    this.inner.add(collar);

    // the knob on top, and the ring the jar stands in
    const neck = new Mesh(new CylinderGeometry(0.028, 0.036, 0.03, 20), metal);
    neck.position.y = TABLE_Y + CASE_H + 0.016 + CASE_R * DOME + 0.012;
    this.inner.add(neck);
    const knob = new Mesh(new SphereGeometry(0.038, 20, 14), metal);
    knob.position.y = neck.position.y + 0.036;
    this.inner.add(knob);

    const jarFoot = new Mesh(new TorusGeometry(CASE_R, 0.0085, 8, 80), darkBrass);
    jarFoot.rotation.x = Math.PI / 2;
    jarFoot.position.y = TABLE_Y + 0.019;
    this.inner.add(jarFoot);

    // base plate, cut to take the jar
    const base = new Mesh(new CylinderGeometry(CASE_R + 0.028, CASE_R + 0.045, 0.024, 72), darkBrass);
    base.position.y = TABLE_Y + 0.012;
    base.receiveShadow = true;
    this.inner.add(base);
    // a turned step, so the dish reads as machined rather than poured
    const step = new Mesh(new CylinderGeometry(CASE_R + 0.006, CASE_R + 0.014, 0.012, 72), darkBrass);
    step.position.y = TABLE_Y + 0.028;
    step.receiveShadow = true;
    this.inner.add(step);
    // the shadow the whole apparatus throws on the desk: without it the base
    // sits on the table rather than on it
    this.blob(0, 0, CASE_R + 0.16, TABLE_Y + 0.0018, 0.55);
    this.blob(0, 0, CASE_R + 0.42, TABLE_Y + 0.0012, 0.3);
    const bevel = new Mesh(new TorusGeometry(CASE_R + 0.05, 0.006, 6, 80), metal);
    bevel.rotation.x = Math.PI / 2;
    bevel.position.y = TABLE_Y + 0.026;
    this.inner.add(bevel);

    // the bed the specimen floats over: dark, close-napped, slightly dusty
    const bedMat = new MeshStandardMaterial({ color: 0x1f1b18, roughness: 1.0, metalness: 0 });
    const bed = new Mesh(new CylinderGeometry(CASE_R - 0.014, CASE_R - 0.022, 0.012, 64), bedMat);
    bed.position.y = TABLE_Y + 0.038;
    bed.receiveShadow = true;
    this.inner.add(bed);
    const bedLip = new Mesh(new TorusGeometry(CASE_R - 0.014, 0.0055, 6, 72), bedMat);
    bedLip.rotation.x = Math.PI / 2;
    bedLip.position.y = TABLE_Y + 0.044;
    this.inner.add(bedLip);

    // the specimen card, propped against the inside of the glass: every case in
    // every museum has one, and it is always slightly crooked
    const cardTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 80;
      const g = c.getContext('2d')!;
      g.fillStyle = '#d9cdaf';
      g.fillRect(0, 0, 128, 80);
      g.strokeStyle = 'rgba(60,45,30,0.55)';
      g.lineWidth = 1;
      g.strokeRect(5, 5, 118, 70);
      g.fillStyle = 'rgba(48,36,26,0.9)';
      g.font = 'italic 15px Georgia, serif';
      g.fillText('No. 41', 14, 30);
      g.font = '11px Georgia, serif';
      g.fillText('Antirrhinum arborescens', 14, 48);
      g.fillText('coll. 21.iv', 14, 64);
      return new CanvasTexture(c);
    })();
    const card = new Mesh(
      new PlaneGeometry(0.085, 0.053),
      new MeshStandardMaterial({ map: cardTex, roughness: 0.95, side: DoubleSide }),
    );
    card.position.set(0.30, TABLE_Y + 0.072, -0.335);
    card.rotation.set(-0.16, -0.42, 0.05);
    card.castShadow = true;
    this.inner.add(card);

    // Glass does not pass light cleanly: it scatters a little of it, and that
    // scatter is the only thing lighting the middle of a specimen case from
    // inside. This is a cheat for that scatter, held strictly inside the jar so
    // it can never reach the desk and flatten the lamp's shadow.
    const glassFill = new PointLight(0xffd2a0, 0.55, 0.30, 1.6);
    glassFill.position.set(-0.02, TABLE_Y + CASE_H * 0.62, 0.02);
    this.inner.add(glassFill);

    // a scatter of small stones on the bed: no specimen case was ever arranged
    // without loose grit in the bottom of it
    const gritMat = new MeshStandardMaterial({ color: 0x6f665d, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 22; i++) {
      const a = hash01(i * 5 + 2) * Math.PI * 2;
      const rr = 0.15 + hash01(i * 9 + 4) * 0.31;
      const g = new Mesh(new IcosahedronGeometry(0.006 + hash01(i * 3) * 0.009, 0), gritMat);
      g.position.set(Math.cos(a) * rr, TABLE_Y + 0.045 + hash01(i * 7) * 0.004, Math.sin(a) * rr);
      g.rotation.set(hash01(i * 11) * 3.0, hash01(i * 13) * 3.0, hash01(i * 17) * 3.0);
      g.castShadow = true;
      g.receiveShadow = true;
      this.inner.add(g);
    }

    // light does not stop at glass. The lamp comes in from the left, so the
    // velvet under the specimen carries a bright, soft-edged pool that is
    // brighter than the rest of the bed and warmer by a stop, and the jar's own
    // wall cuts a shadow arc across it. Without this the inside of the case is
    // lit by nothing in particular.
    const pool = new Mesh(
      new CircleGeometry(CASE_R - 0.03, 48),
      new MeshBasicMaterial({
        map: blobTexture(),
        color: 0xffce90,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(1.0, 0.82, 1);
    pool.position.set(-0.075, TABLE_Y + 0.0455, 0.015);
    pool.renderOrder = 1;
    this.inner.add(pool);

    // ── the lamp ──
    const lampX = -1.04;
    const lampZ = -0.70;
    const stemH = 0.78;
    const stem = new Mesh(new CylinderGeometry(0.011, 0.015, stemH, 12), metal);
    stem.position.set(lampX, TABLE_Y + stemH * 0.5, lampZ);
    this.inner.add(stem);
    const foot = new Mesh(new CylinderGeometry(0.10, 0.112, 0.018, 40), metal);
    foot.position.set(lampX, TABLE_Y + 0.009, lampZ);
    this.inner.add(foot);

    // arm + shade, angled over the specimen
    // the arm is built from the two points it connects, so it cannot float free
    const stemTop = new Vector3(lampX, TABLE_Y + stemH, lampZ);
    const armEnd = new Vector3(lampX + 0.44, TABLE_Y + stemH + 0.14, lampZ + 0.28);
    const armDir = new Vector3().subVectors(armEnd, stemTop);
    const arm = new Mesh(new CylinderGeometry(0.008, 0.008, armDir.length(), 10), metal);
    arm.position.copy(stemTop).addScaledVector(armDir, 0.5);
    arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), armDir.clone().normalize());
    this.inner.add(arm);

    const shadePos = armEnd.clone().add(new Vector3(0.02, 0.02, 0.02));
    const shadeGeo = new ConeGeometry(0.135, 0.15, 32, 1, true);
    const shadeMat = new MeshStandardMaterial({ map: brass(), color: 0xa8843c, roughness: 0.5, metalness: 0.62, side: DoubleSide });
    this.shiny.push(shadeMat);
    this.shade = new Mesh(shadeGeo, shadeMat);
    this.shade.position.copy(shadePos);
    // point the shade's mouth down and in toward the case
    this.shade.rotation.set(0.5, 0.1, -0.62);
    this.shade.castShadow = true;
    this.inner.add(this.shade);

    // the inside of a lit shade is the brightest thing in the room after the
    // bulb: without this the shade reads as a black cut-out from behind
    const shadeIn = new Mesh(
      new ConeGeometry(0.128, 0.142, 32, 1, true),
      new MeshBasicMaterial({ color: 0xffd7a0, side: BackSide, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    shadeIn.position.copy(shadePos);
    shadeIn.rotation.copy(this.shade.rotation);
    this.inner.add(shadeIn);

    // the bulb: a small bright sphere, plus the light itself
    const mouth = new Vector3(0, -0.085, 0).applyEuler(this.shade.rotation);
    const bulbMesh = new Mesh(new SphereGeometry(0.028, 14, 12), new MeshBasicMaterial({ color: 0xffe6b8 }));
    this.bulbMesh = bulbMesh;
    bulbMesh.position.copy(shadePos).add(mouth);
    this.inner.add(bulbMesh);

    this.bulb = new PointLight(0xffcf94, 0.6, 2.6 * ROOM_K, 1.2);
    this.bulb.position.copy(bulbMesh.position);
    this.inner.add(this.bulb);

    this.lamp = new SpotLight(0xffd9a8, 1.15, 3.6 * ROOM_K, 0.58, 0.9, 1.0);
    this.lamp.position.copy(bulbMesh.position).add(new Vector3(0, 0.01, 0));
    this.lamp.target.position.set(0, TABLE_Y + 0.24, 0.02);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.camera.near = 0.02;
    this.lamp.shadow.camera.far = 3.8 * ROOM_K;
    this.lamp.shadow.bias = -0.0009;
    this.lamp.shadow.normalBias = 0.006;
    this.inner.add(this.lamp, this.lamp.target);

    // one weak, warm wash behind the case: enough to see the room, not enough
    // to compete with the lamp
    const wash = new PointLight(0xffb877, 0.75, 3.0 * ROOM_K, 1.3);
    wash.position.set(0.35, TABLE_Y + 0.5, -1.1);
    this.inner.add(wash);

    // the bounce: a dim, warm light from the reader's side of the desk, the way
    // paper and hands throw light back. Without it the near edge goes to black
    // and the desk reads as a stage that ends.
    const bounce = new PointLight(0xffe0c0, 0.5, 2.6 * ROOM_K, 1.0);
    bounce.position.set(0.15, TABLE_Y + 0.62, CASE_R + 0.9);
    this.inner.add(bounce);

    // Cold light from a window on the right. Without it every surface in the
    // room is the same orange and the picture reads as a colour grade rather
    // than as a place. Warm lamp against cool daylight is the oldest lighting
    // trick there is, and it is the one this frame was missing.
    const windowLight = new PointLight(0x8fb4d8, 2.4, 5.0 * ROOM_K, 1.0);
    // The window itself is off-frame to the right and always will be: the room is
    // a metre and a bit across and the camera is aimed at the desk. What you see
    // is not the window, it is its falloff — the cold wash down the panelling and
    // the raw edge it cuts on the ledger.
    windowLight.position.set(1.95, TABLE_Y + 1.05, -1.70);
    this.inner.add(windowLight);
    // and a hard, low rim from the same side, to draw a cold line down the
    // right shoulder of the dome and the brass
    const rimLight = new PointLight(0xa8c8e8, 1.5, 3.0 * ROOM_K, 1.2);
    rimLight.position.set(0.95, TABLE_Y + 0.42, -0.55);
    this.inner.add(rimLight);

    // the halo: a radial gradient sprite, which is what a bright point does to
    // a lens. A translucent sphere reads as a bubble.
    this.glow = new Sprite(
      new SpriteMaterial({
        map: blobTexture(),
        color: 0xffdca8,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.glow.scale.setScalar(0.52);
    this.glow.position.copy(bulbMesh.position);
    this.inner.add(this.glow);

    // ── dust in the beam ──
    const n = 110;
    this.dustPos = new Float32Array(n * 3);
    this.dustSeeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.dustSeeds[i * 3] = hash01(i * 11 + 1);
      this.dustSeeds[i * 3 + 1] = hash01(i * 11 + 2);
      this.dustSeeds[i * 3 + 2] = hash01(i * 11 + 3);
    }
    const dg = new BufferGeometry();
    const dp = new BufferAttribute(this.dustPos, 3);
    dp.setUsage(DynamicDrawUsage);
    dg.setAttribute('position', dp);
    this.dust = new Points(
      dg,
      new PointsMaterial({
        color: 0xffe6c0,
        size: 0.0032,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.inner.add(this.dust);

    // ── the paperwork: the ledger, the slips, the plaque, the husks ──
    this.marks = new DeskMarks({ tableY: TABLE_Y, caseR: CASE_R });
    this.inner.add(this.marks.group);

    // ── the dark behind it: shelves, books, jars ──
    const darkWood = new MeshStandardMaterial({
      map: panelling(),
      color: 0x7a6f66,
      roughness: 0.94,
      metalness: 0.0,
      side: DoubleSide, // seen from the inside
    });
    // A four-walled room, not a painted flat: the first version's wall had a
    // visible edge and the whole thing read as a stage set.
    this.backdrop = new Mesh(new CylinderGeometry(2.8, 2.8, 3.4, 40, 1, true), darkWood);
    this.backdrop.position.set(0, TABLE_Y + 1.0, -0.3);
    this.backdrop.receiveShadow = true;
    this.inner.add(this.backdrop);

    const floor = new Mesh(
      new CylinderGeometry(2.8, 2.8, 0.02, 40),
      new MeshStandardMaterial({ map: walnut(), color: 0x2c2420, roughness: 0.92 }),
    );
    floor.position.set(0, TABLE_Y - 0.86, -0.3);
    this.inner.add(floor);

    const shelfY = [TABLE_Y + 0.46, TABLE_Y + 0.80];
    for (const y of shelfY) {
      const shelf = new Mesh(new BoxGeometry(1.5, 0.022, 0.17), darkWood);
      shelf.position.set(0.30, y, -1.52);
      this.inner.add(shelf);
    }

    // books: cloth and calf, different heights, one of them read to death. A row
    // of identical pale spines is the tell of a scene built from a loop.
    const hides = [0x4a2a24, 0x2f3a2c, 0x3b3143, 0x5a4326, 0x24303a, 0x6b2f28, 0x3d3527];
    let bx = 0.02;
    for (let i = 0; i < 11; i++) {
      const h = 0.105 + hash01(i * 17 + 3) * 0.075;
      const w = 0.017 + hash01(i * 17 + 5) * 0.024;
      const d = 0.125 + hash01(i * 17 + 7) * 0.05;
      const row = i < 7 ? 0 : 1;
      const book = new Mesh(
        new BoxGeometry(w, h, d),
        new MeshStandardMaterial({
          color: hides[i % hides.length],
          roughness: 0.72 + hash01(i * 31) * 0.22,
        }),
      );
      book.position.set(bx + w / 2, shelfY[row] + 0.008 + h / 2, -1.52 + (hash01(i * 3) - 0.5) * 0.02);
      book.rotation.z = (hash01(i * 23) - 0.5) * 0.1;
      book.castShadow = true;
      book.receiveShadow = true;
      this.inner.add(book);
      // gold bands on a couple of them: the only thing on that wall that catches
      // the lamp
      if (i === 1 || i === 4) {
        for (const by of [-h * 0.28, h * 0.24]) {
          const band = new Mesh(new BoxGeometry(w + 0.0014, 0.004, d * 1.002), metal);
          band.position.set(book.position.x, book.position.y + by, book.position.z);
          band.rotation.z = book.rotation.z;
          this.inner.add(band);
        }
      }
      bx += w + 0.0025 + hash01(i * 41) * 0.006;
      // one book left lying flat, mid-shelf, where a hand put it down
      if (i === 6) {
        for (let k = 0; k < 2; k++) {
          const flat = new Mesh(new BoxGeometry(0.13 - k * 0.012, 0.022, 0.1), new MeshStandardMaterial({ color: hides[(i + k + 2) % hides.length], roughness: 0.8 }));
          flat.position.set(bx + 0.09, shelfY[row] + 0.021 + k * 0.023, -1.51);
          flat.rotation.y = 0.06 + k * 0.03;
          flat.castShadow = true;
          flat.receiveShadow = true;
          this.inner.add(flat);
        }
      }
    }

    // a couple of specimen jars, glass with brass lids
    for (let i = 0; i < 2; i++) {
      const r = 0.042 + i * 0.012;
      const hh = 0.11 + i * 0.03;
      const jar = new Mesh(
        new CylinderGeometry(r, r * 0.95, hh, 18),
        glassMaterial({ rim: 0x8fa6ae }),
      );
      jar.position.set(0.58 + i * 0.13, shelfY[1] + 0.011 + hh / 2, -1.48);
      this.inner.add(jar);
      const lid = new Mesh(new CylinderGeometry(r * 1.02, r * 1.02, 0.008, 18), metal);
      lid.position.set(jar.position.x, shelfY[1] + 0.011 + hh, -1.48);
      this.inner.add(lid);
    }

    // ── the near edge: what a working desk has on it that a render does not ──
    //
    // The bottom of the picture was empty varnished wood, and empty foreground
    // is the single biggest tell that a frame was built rather than taken.
    // These sit at the table's near lip, where the lens sees them out of focus.

    // a pencil, chewed, laid down mid-sentence
    const pencil = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.0085, 0.0085, 0.42, 6), new MeshStandardMaterial({ color: 0x8a5a1e, roughness: 0.7 }));
    shaft.rotation.z = Math.PI / 2;
    pencil.add(shaft);
    const ferrule = new Mesh(new CylinderGeometry(0.0092, 0.0092, 0.03, 8), metal);
    ferrule.rotation.z = Math.PI / 2;
    ferrule.position.x = 0.20;
    pencil.add(ferrule);
    const eraser = new Mesh(new CylinderGeometry(0.0083, 0.0083, 0.02, 8), new MeshStandardMaterial({ color: 0xb8735c, roughness: 0.95 }));
    eraser.rotation.z = Math.PI / 2;
    eraser.position.x = 0.225;
    pencil.add(eraser);
    const tip = new Mesh(new ConeGeometry(0.0085, 0.045, 8), new MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.3 }));
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = -0.232;
    pencil.add(tip);
    pencil.position.set(-0.74, TABLE_Y + 0.0148, 0.66);
    pencil.rotation.set(0, 0.42, 0.02);
    this.inner.add(pencil);

    // a stack of index cards, squared up by hand and not quite square
    const cardMat = new MeshStandardMaterial({ color: 0xd8cead, roughness: 0.96, side: DoubleSide });
    for (let i = 0; i < 5; i++) {
      const card = new Mesh(new BoxGeometry(0.115, 0.0022, 0.075), cardMat);
      card.position.set(
        -0.60 + (hash01(i * 13) - 0.5) * 0.012,
        TABLE_Y + 0.0065 + i * 0.0026,
        0.95 + (hash01(i * 29) - 0.5) * 0.01,
      );
      card.rotation.y = -0.5 + (hash01(i * 7) - 0.5) * 0.075;
      card.castShadow = true;
      this.inner.add(card);
    }

    // a cup stood here ten minutes ago
    const cupRing = new Mesh(
      new CircleGeometry(0.085, 40),
      new MeshStandardMaterial({ map: ringStain(), color: 0xffffff, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false }),
    );
    cupRing.rotation.x = -Math.PI / 2;
    cupRing.position.set(0.62, TABLE_Y + 0.0042, 0.72);
    this.inner.add(cupRing);

    // a hand lens, laid down face up. Three primitives, and the whole desk
    // becomes somebody's.
    const lensGroup = new Group();
    const lensRing = new Mesh(new TorusGeometry(0.062, 0.0075, 10, 36), metal);
    lensGroup.add(lensRing);
    const lensGlass = new Mesh(new CircleGeometry(0.06, 36), glassMaterial({ rim: 0xa8bdc6, tint: 0x24503a }));
    lensGroup.add(lensGlass);
    const lensGlass2 = new Mesh(new CircleGeometry(0.06, 36), glassMaterial({ rim: 0xa8bdc6, tint: 0x24503a }));
    lensGlass2.rotation.y = Math.PI;
    lensGroup.add(lensGlass2);
    const handle = new Mesh(new CylinderGeometry(0.0085, 0.0075, 0.19, 12), darkBrass);
    handle.position.set(0, -0.13, 0);
    lensGroup.add(handle);
    const collar2 = new Mesh(new CylinderGeometry(0.011, 0.011, 0.018, 12), metal);
    collar2.position.set(0, -0.068, 0);
    lensGroup.add(collar2);
    lensGroup.position.set(-0.63, TABLE_Y + 0.0075, 0.16);
    lensGroup.rotation.set(-Math.PI / 2 + 0.06, 0.2, 0.9);
    this.inner.add(lensGroup);

    // Everything casts. A single spot light and twelve shadow casters is not a
    // photograph; it is a product shot with the shadow switched off. The reason
    // the desk read as a flat brown field was that nothing in the room was
    // throwing anything onto it.
    this.inner.traverse((o) => {
      const mesh = o as Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const mat = mesh.material as { transparent?: boolean; blending?: number } | Array<{ transparent?: boolean }>;
      const m = Array.isArray(mat) ? mat[0] : mat;
      // additive glass and sprites throw no shadow, and neither does the wall
      if (m && m.transparent === true) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      if (mesh === this.backdrop) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    // a single sheet left on the desk, half under the pad's edge
    const sheet = new Mesh(
      new PlaneGeometry(0.30, 0.38),
      new MeshStandardMaterial({ color: 0xcfc2a2, roughness: 0.95, side: DoubleSide }),
    );
    sheet.rotation.set(-Math.PI / 2, 0, 0.5);
    sheet.position.set(TABLE_R - 0.28, TABLE_Y + 0.0035, -0.62);
    this.inner.add(sheet);
  }

  /** Where the bulb is, in world space, for the lens flare. */
  bulbWorld(out: Vector3): Vector3 {
    return this.bulbMesh.getWorldPosition(out);
  }

  /**
   * Give every metal and the glass a room to reflect. Without this, brass is a
   * diffuse ochre and glass is a grey film: metal is *only* its reflections.
   */
  applyEnvironment(env: CubeTexture | Texture): void {
    for (const m of this.shiny) {
      m.envMap = env;
      // a 128px cube of one warm lamp is a strong light: keep it as a glint,
      // not a second key light
      m.envMapIntensity = 0.30;
      m.needsUpdate = true;
    }
  }

  /** Lay a soft shadow on the desk, where something stands. */
  private blob(x: number, z: number, r: number, y: number, opacity: number): void {
    const mesh = new Mesh(
      new PlaneGeometry(r * 2, r * 2),
      new MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity, depthWrite: false, color: 0x120f0c }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    this.inner.add(mesh);
  }

  /** Rewrite the ledger. */
  setJournal(journal: Journal): void {
    this.marks.setJournal(journal);
  }

  /** Cut the keeper's name into the brass. */
  setKeeper(name: string): void {
    this.marks.setKeeper(name);
  }

  /**
   * Position the room under the diorama and set the lamp for the act.
   * Called once per frame; touches no allocations.
   */
  update(dt: number, origin: Vector3, sky: SkyBlend, time: number): void {
    this.group.position.copy(origin);

    // The three "skies" become three qualities of lamplight, because in a room
    // there is no sky: dawn is low and warm, the storm is cold and guttering,
    // golden hour is bright and steady.
    const warm = new Color(0xffd9a8);
    const cold = new Color(0xa9c2dd);
    const gold = new Color(0xffc073);
    const c = warm.clone().multiplyScalar(sky.dawn);
    c.add(cold.clone().multiplyScalar(sky.storm));
    c.add(gold.clone().multiplyScalar(sky.golden));
    const flicker = sky.storm > 0.35 ? 1 - 0.1 * Math.abs(Math.sin(time * 11.3)) : 1;

    this.lamp.color.copy(c);
    this.lamp.intensity = (0.95 + 0.55 * sky.golden + 0.22 * sky.dawn) * flicker;
    this.bulb.color.copy(c);
    this.bulb.intensity = 0.75 * flicker;
    (this.glow.material as SpriteMaterial).color.copy(c);

    // dust drifts on its own time, and only exists where the light is
    const p = this.dustPos;
    for (let i = 0; i < 110; i++) {
      const a = this.dustSeeds[i * 3];
      const b = this.dustSeeds[i * 3 + 1];
      const s = this.dustSeeds[i * 3 + 2];
      const t = time * (0.05 + s * 0.05) + a * 6.283;
      p[i * 3] = -0.5 + Math.cos(t) * (0.1 + b * 0.26) + (a - 0.5) * 0.3;
      p[i * 3 + 1] = TABLE_Y + 0.06 + (b * 0.62 + time * 0.006 * (0.4 + s)) % 0.62;
      p[i * 3 + 2] = -0.28 + Math.sin(t * 1.3) * (0.08 + a * 0.22) + (b - 0.5) * 0.26;
    }
    (this.dust.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    void dt;
  }

  /** Everything that must be lit by the lamp rather than the old sky. */
  litBy(light: SpotLight): Object3D[] {
    return [light, light.target];
  }
}
