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
  CylinderGeometry,
  type CubeTexture,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LinearFilter,
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
  woodTex.repeat.set(2.2, 2.2);
  woodTex.magFilter = LinearFilter;
  woodTex.minFilter = LinearFilter;
  woodTex.needsUpdate = true;
  return woodTex;
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

const woodMaterial = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ map: walnut(), color: 0x5a4536, roughness: 0.62, metalness: 0.03 });

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
  private readonly shade: Mesh;
  private readonly glow: Sprite;
  private readonly beam: Mesh;
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

    // ── the apparatus: the islands live inside brass and glass ──
    // A bell jar, not a cylinder: a wall, a domed top, a knob, and a brass
    // collar where the two meet. The silhouette is what makes it read as a
    // vessel rather than a hoop.
    const glassMat = new MeshStandardMaterial({
      color: 0xc2d6de,
      transparent: true,
      opacity: 0.03,
      roughness: 0.02,
      metalness: 0.0,
      side: DoubleSide,
      depthWrite: false,
    });
    // Glass is a fresnel object: barely there face-on, a bright rim at the
    // silhouette. Without that rim a jar is a grey film and the whole case
    // reads as a hoop standing on a table.
    glassMat.envMapIntensity = 1.4;
    glassMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlassN;\nvarying vec3 vGlassV;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n vGlassN = normalize(mat3(modelMatrix) * normal);\n vGlassV = cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlassN;\nvarying vec3 vGlassV;')
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          float fres = pow(1.0 - clamp(dot(normalize(vGlassN), normalize(vGlassV)), 0.0, 1.0), 2.6);
          gl_FragColor.a = clamp(0.018 + fres * 0.55, 0.0, 0.82);
          gl_FragColor.rgb += vec3(0.5, 0.58, 0.62) * fres * 0.16;`,
        );
    };
    this.shiny.push(glassMat);
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
    const bedMat = new MeshStandardMaterial({ color: 0x2c2620, roughness: 0.98, metalness: 0 });
    const bed = new Mesh(new CylinderGeometry(CASE_R - 0.014, CASE_R - 0.022, 0.012, 64), bedMat);
    bed.position.y = TABLE_Y + 0.038;
    bed.receiveShadow = true;
    this.inner.add(bed);
    const bedLip = new Mesh(new TorusGeometry(CASE_R - 0.014, 0.0055, 6, 72), bedMat);
    bedLip.rotation.x = Math.PI / 2;
    bedLip.position.y = TABLE_Y + 0.044;
    this.inner.add(bedLip);

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

    // the visible cone of light: additive, no edges
    this.beam = new Mesh(
      new ConeGeometry(0.42, 1.05, 32, 1, true),
      new MeshBasicMaterial({
        color: 0xffd9a8,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    // the cone's mouth widens downward: sit it between the bulb and the table
    this.beam.position.copy(bulbMesh.position).add(new Vector3(0.16, -0.44, 0.09));
    this.beam.rotation.set(0.12, 0, -0.34);
    this.beam.renderOrder = 3;
    this.inner.add(this.beam);

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
      map: walnut(),
      color: 0x3a322c,
      roughness: 0.85,
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

    // books: different heights and hides, leaning a little
    for (let i = 0; i < 9; i++) {
      const h = 0.12 + hash01(i * 17 + 3) * 0.07;
      const w = 0.022 + hash01(i * 17 + 5) * 0.016;
      const d = 0.13 + hash01(i * 17 + 7) * 0.04;
      const book = new Mesh(
        new BoxGeometry(w, h, d),
        new MeshStandardMaterial({
          color: new Color().setHSL(0.06 + hash01(i * 5) * 0.04, 0.3, 0.1 + hash01(i * 9) * 0.08).getHex(),
          roughness: 0.9,
        }),
      );
      const row = i < 6 ? 0 : 1;
      book.position.set(0.02 + (i % 6) * 0.038 + (hash01(i * 3) - 0.5) * 0.004, shelfY[row] + 0.008 + h / 2, -1.52);
      book.rotation.z = (hash01(i * 23) - 0.5) * 0.06;
      book.castShadow = true;
      this.inner.add(book);
    }

    // a couple of specimen jars, glass with brass lids
    for (let i = 0; i < 2; i++) {
      const r = 0.042 + i * 0.012;
      const hh = 0.11 + i * 0.03;
      const jar = new Mesh(
        new CylinderGeometry(r, r * 0.95, hh, 18),
        new MeshStandardMaterial({
          color: 0xbcd2cf,
          transparent: true,
          opacity: 0.22,
          roughness: 0.08,
          metalness: 0,
          side: DoubleSide,
        }),
      );
      jar.position.set(0.58 + i * 0.13, shelfY[1] + 0.011 + hh / 2, -1.48);
      this.inner.add(jar);
      const lid = new Mesh(new CylinderGeometry(r * 1.02, r * 1.02, 0.008, 18), metal);
      lid.position.set(jar.position.x, shelfY[1] + 0.011 + hh, -1.48);
      this.inner.add(lid);
    }

    // a single sheet left on the desk, half under the pad's edge
    const sheet = new Mesh(
      new PlaneGeometry(0.30, 0.38),
      new MeshStandardMaterial({ color: 0xcfc2a2, roughness: 0.95, side: DoubleSide }),
    );
    sheet.rotation.set(-Math.PI / 2, 0, 0.5);
    sheet.position.set(TABLE_R - 0.28, TABLE_Y + 0.0035, -0.62);
    this.inner.add(sheet);
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
    (this.beam.material as MeshBasicMaterial).color.copy(c);
    (this.beam.material as MeshBasicMaterial).opacity = 0.032 * flicker + 0.018 * sky.golden;
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
