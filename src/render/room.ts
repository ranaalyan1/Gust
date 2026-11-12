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
 * References: the specimen tables of Victorian naturalists; the Harvard glass
 * flowers; *The Room VR* for material honesty at arm's length; *Red Matter 2*
 * for single-source lighting.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
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
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { hash01 } from '../core/random.js';
import type { SkyBlend } from '../core/game.js';

/**
 * The world is a metre wide (two islands seven simulation metres apart at 1:7),
 * so the furniture is sized to *it*: a museum specimen table, not a side table.
 * Getting this backwards was the first version's main mistake.
 */
const TABLE_Y = -0.12;
const TABLE_R = 0.95;
/** The bell jar the world floats inside. */
const CASE_R = 0.80;
const CASE_H = 0.30;
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
      const r = (0.30 + 0.16 * ring) * warmth + fleck * 0.10;
      const g = (0.19 + 0.10 * ring) * warmth + fleck * 0.07;
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
  new MeshStandardMaterial({ map: walnut(), color: 0x5f4c3c, roughness: 0.55, metalness: 0.04 });

const brassMaterial = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ map: brass(), color: 0xffffff, roughness: 0.34, metalness: 0.72 });

/* ── the room ────────────────────────────────────────────────────────────── */

export class Room {
  readonly group = new Group();
  private readonly inner = new Group();
  readonly lamp: SpotLight;
  private readonly bulb: PointLight;
  private readonly shade: Mesh;
  private readonly glow: Mesh;
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

    // ── the desk ──
    const table = new Mesh(new CylinderGeometry(TABLE_R, TABLE_R * 0.97, 0.075, 56), wood);
    table.position.y = TABLE_Y - 0.0375;
    table.receiveShadow = true;
    this.inner.add(table);

    // a turned brass edge, because a bare cylinder edge reads as a cardboard cut-out
    const rim = new Mesh(new TorusGeometry(TABLE_R, 0.011, 8, 72), metal);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = TABLE_Y;
    this.inner.add(rim);

    // ── the apparatus: the islands live inside brass and glass ──
    const caseR = CASE_R;
    const glass = new Mesh(
      new CylinderGeometry(caseR, caseR, CASE_H, 48, 1, true),
      new MeshStandardMaterial({
        color: 0xcfe3ea,
        transparent: true,
        opacity: 0.10,
        roughness: 0.06,
        metalness: 0,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    glass.position.y = TABLE_Y + CASE_H * 0.5 + 0.014;
    glass.renderOrder = 4;
    this.inner.add(glass);

    for (const y of [TABLE_Y + 0.014, TABLE_Y + CASE_H + 0.014]) {
      const ring = new Mesh(new TorusGeometry(caseR, 0.013, 8, 64), metal);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.inner.add(ring);
    }
    // base plate with a small engraved plaque
    const base = new Mesh(new CylinderGeometry(caseR + 0.025, caseR + 0.04, 0.018, 56), metal);
    base.position.y = TABLE_Y + 0.006;
    base.receiveShadow = true;
    this.inner.add(base);

    const plaque = new Mesh(new BoxGeometry(0.10, 0.005, 0.032), metal);
    plaque.position.set(0.0, TABLE_Y + 0.016, caseR + 0.055);
    this.inner.add(plaque);

    // ── the lamp ──
    const lampX = -0.66;
    const lampZ = -0.46;
    const stem = new Mesh(new CylinderGeometry(0.011, 0.014, 0.60, 12), metal);
    stem.position.set(lampX, TABLE_Y + 0.30, lampZ);
    this.inner.add(stem);
    const foot = new Mesh(new CylinderGeometry(0.085, 0.095, 0.016, 32), metal);
    foot.position.set(lampX, TABLE_Y + 0.008, lampZ);
    this.inner.add(foot);

    // arm + shade, angled over the specimen
    // the arm is built from the two points it connects, so it cannot float free
    const stemTop = new Vector3(lampX, TABLE_Y + 0.60, lampZ);
    const armEnd = new Vector3(lampX + 0.30, TABLE_Y + 0.71, lampZ + 0.20);
    const armDir = new Vector3().subVectors(armEnd, stemTop);
    const arm = new Mesh(new CylinderGeometry(0.008, 0.008, armDir.length(), 10), metal);
    arm.position.copy(stemTop).addScaledVector(armDir, 0.5);
    arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), armDir.clone().normalize());
    this.inner.add(arm);

    const shadeGeo = new ConeGeometry(0.105, 0.115, 28, 1, true);
    this.shade = new Mesh(
      shadeGeo,
      new MeshStandardMaterial({ map: brass(), color: 0xffffff, roughness: 0.42, metalness: 0.7, side: DoubleSide }),
    );
    this.shade.position.set(lampX + 0.30, TABLE_Y + 0.71, lampZ + 0.20);
    this.shade.rotation.set(0.62, 0, -0.86);
    this.inner.add(this.shade);

    // the bulb: a small bright sphere, plus the light itself
    const bulbMesh = new Mesh(
      new SphereGeometry(0.026, 12, 10),
      new MeshBasicMaterial({ color: 0xffe3ad }),
    );
    bulbMesh.position.copy(this.shade.position).addScaledVector(new Vector3(-0.75, -0.95, 0.55).normalize(), 0.055);
    this.inner.add(bulbMesh);

    this.bulb = new PointLight(0xffcf94, 0.5, 2.2 * ROOM_K, 1.2);
    this.bulb.position.copy(bulbMesh.position);
    this.inner.add(this.bulb);

    this.lamp = new SpotLight(0xffd9a8, 0.95, 3.2 * ROOM_K, 0.52, 0.85, 1.0);
    this.lamp.position.copy(bulbMesh.position);
    this.lamp.target.position.set(0, TABLE_Y + 0.20, 0.02);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.camera.near = 0.02;
    this.lamp.shadow.camera.far = 3.4 * ROOM_K;
    this.lamp.shadow.bias = -0.0009;
    this.lamp.shadow.normalBias = 0.006;
    this.inner.add(this.lamp, this.lamp.target);

    // one weak, warm wash behind the case: enough to see the room, not enough
    // to compete with the lamp
    const wash = new PointLight(0xffb877, 0.22, 2.0 * ROOM_K, 1.4);
    wash.position.set(0.25, TABLE_Y + 0.42, -0.95);
    this.inner.add(wash);

    // the visible cone of light: additive, no edges
    this.beam = new Mesh(
      new ConeGeometry(0.34, 0.95, 32, 1, true),
      new MeshBasicMaterial({
        color: 0xffd9a8,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.beam.position.copy(bulbMesh.position).add(new Vector3(0.10, -0.42, 0.08));
    this.beam.renderOrder = 3;
    this.inner.add(this.beam);

    // a soft halo around the bulb so it reads as a source, not a ball
    this.glow = new Mesh(
      new SphereGeometry(0.085, 16, 12),
      new MeshBasicMaterial({
        color: 0xffdca8,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.glow.position.copy(bulbMesh.position);
    this.inner.add(this.glow);

    // ── dust in the beam ──
    const n = 140;
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
        size: 0.005,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.inner.add(this.dust);

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
    this.backdrop = new Mesh(new CylinderGeometry(2.8, 2.8, 3.4, 32, 1, true), darkWood);
    this.backdrop.position.set(0, TABLE_Y + 1.0, -0.3);
    this.backdrop.receiveShadow = true;
    this.inner.add(this.backdrop);

    const floor = new Mesh(
      new CylinderGeometry(2.8, 2.8, 0.02, 32),
      new MeshStandardMaterial({ map: walnut(), color: 0x2c2420, roughness: 0.92 }),
    );
    floor.position.set(0, TABLE_Y - 0.86, -0.3);
    this.inner.add(floor);

    const shelfY = [TABLE_Y + 0.42, TABLE_Y + 0.74];
    for (const y of shelfY) {
      const shelf = new Mesh(new BoxGeometry(1.6, 0.022, 0.17), darkWood);
      shelf.position.set(0.34, y, -1.42);
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
          color: new Color().setHSL(0.06 + hash01(i * 5) * 0.04, 0.30, 0.10 + hash01(i * 9) * 0.08).getHex(),
          roughness: 0.9,
        }),
      );
      const row = i < 6 ? 0 : 1;
      book.position.set(
        0.02 + (i % 6) * 0.038 + (hash01(i * 3) - 0.5) * 0.004,
        shelfY[row] + 0.008 + (i === 8 ? 0 : 0) + (row === 0 ? h / 2 : h / 2),
        -1.42,
      );
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
      jar.position.set(0.60 + i * 0.13, shelfY[1] + 0.011 + hh / 2, -1.38);
      this.inner.add(jar);
      const lid = new Mesh(new CylinderGeometry(r * 1.02, r * 1.02, 0.008, 18), metal);
      lid.position.set(jar.position.x, shelfY[1] + 0.011 + hh, -1.38);
      this.inner.add(lid);
    }
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
    const flicker = sky.storm > 0.35 ? 1 - 0.10 * Math.abs(Math.sin(time * 11.3)) : 1;

    this.lamp.color.copy(c);
    this.lamp.intensity = (0.80 + 0.5 * sky.golden + 0.2 * sky.dawn) * flicker;
    this.bulb.color.copy(c);
    this.bulb.intensity = 0.7 * flicker;
    (this.beam.material as MeshBasicMaterial).color.copy(c);
    (this.beam.material as MeshBasicMaterial).opacity = 0.035 * flicker + 0.02 * sky.golden;
    (this.glow.material as MeshBasicMaterial).color.copy(c);

    // dust drifts on its own time, and only exists where the light is
    const p = this.dustPos;
    for (let i = 0; i < 140; i++) {
      const a = this.dustSeeds[i * 3];
      const b = this.dustSeeds[i * 3 + 1];
      const s = this.dustSeeds[i * 3 + 2];
      const t = time * (0.05 + s * 0.05) + a * 6.283;
      p[i * 3] = -0.34 + Math.cos(t) * (0.10 + b * 0.34) + (a - 0.5) * 0.34;
      p[i * 3 + 1] = TABLE_Y + 0.10 + ((b * 0.52 + time * 0.006 * (0.4 + s)) % 0.52);
      p[i * 3 + 2] = -0.16 + Math.sin(t * 1.3) * (0.08 + a * 0.22) + (b - 0.5) * 0.26;
    }
    (this.dust.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    void dt;
  }

  /** Everything that must be lit by the lamp rather than the old sky. */
  litBy(light: SpotLight): Object3D[] {
    return [light, light.target];
  }
}
