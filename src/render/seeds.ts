/**
 * THE SEED — the one thing the player loves and can never touch.
 *
 * A dandelion achene under a parachute of filaments, with a living glow. Up to
 * a few dozen are drawn with one instanced mesh plus one point cloud, straight
 * from the simulation's interpolated state. Also the dandelion it waits on.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MultiplyBlending,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import type { Seed } from '../core/seed.js';
import type { Course } from '../core/course.js';
import { islandTop } from '../core/terrain.js';
import { FlatBuilder } from './build.js';
import { blobShadowMaterial, blobTexture } from './blob.js';

export const MAX_SEEDS = 48;

function seedGeometry(): BufferGeometry {
  const b = new FlatBuilder();
  const achene = new Color(0.55, 0.36, 0.2);
  const stalk = new Color(0.95, 0.93, 0.85);
  const fluff = new Color(1, 1, 1);
  const fluff2 = new Color(0.9, 0.95, 1.0);
  // achene: a tiny diamond hanging below the origin
  const r = 0.022;
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * 6.283, a1 = ((i + 1) / 4) * 6.283;
    b.tri(Math.cos(a0) * r, -0.06, Math.sin(a0) * r, Math.cos(a1) * r, -0.06, Math.sin(a1) * r, 0, -0.13, 0, achene);
    b.tri(Math.cos(a1) * r, -0.06, Math.sin(a1) * r, Math.cos(a0) * r, -0.06, Math.sin(a0) * r, 0, 0.0, 0, achene);
  }
  // stalk
  const w = 0.006;
  b.tri(-w, 0, 0, w, 0, 0, 0, 0.17, 0, stalk);
  b.tri(0, 0, -w, 0, 0, w, 0, 0.17, 0, stalk);
  // pappus: an open umbrella of filaments
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 6.283;
    const tilt = i % 2 === 0 ? 0.19 : 0.15;
    const rise = i % 2 === 0 ? 0.25 : 0.29;
    const tx = Math.cos(a) * tilt, tz = Math.sin(a) * tilt;
    const sx = Math.cos(a + 1.57) * 0.008, sz = Math.sin(a + 1.57) * 0.008;
    b.tri(-sx, 0.17, -sz, sx, 0.17, sz, tx, rise, tz, i % 2 ? fluff : fluff2);
    // a tuft at the tip of each filament
    const t = 0.022;
    b.tri(tx - sx * 3, rise - t * 0.3, tz - sz * 3, tx + sx * 3, rise - t * 0.3, tz + sz * 3, tx * 1.12, rise + t, tz * 1.12, fluff);
  }
  return b.build();
}

const m4 = new Matrix4();
const qa = new Quaternion();
const qb = new Quaternion();
const up = new Vector3(0, 1, 0);
const axis = new Vector3();
const pos = new Vector3();
const scl = new Vector3();
const shadowPos = new Vector3();
/** CircleGeometry faces +Z; lay it flat on the ground. */
const flatQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

export class SeedViews {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  /**
   * A soft blob under each seed, projected onto whatever is below it. Without
   * it a seed reads as a sticker on the sky; with it, the eye knows exactly how
   * high it is. (Reference: Half-Life: Alyx's object shadows, Moss's seeds.)
   */
  private readonly shadow: InstancedMesh;
  /** Where each seed was last frame, to derive velocity without touching the core. */
  private readonly lastPos = new Float32Array(MAX_SEEDS * 3);
  private readonly squash = new Float32Array(MAX_SEEDS);
  private readonly wasStatus: string[] = [];
  private lastTime = 0;
  private readonly glow: Points;
  private readonly glowPos: Float32Array;
  private readonly glowColor: Float32Array;
  private readonly glowSize: Float32Array;
  private readonly glowGeometry = new BufferGeometry();
  private readonly glowMaterial: ShaderMaterial;
  readonly glowTint = new Color(1.0, 0.86, 0.5);

  constructor() {
    const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false });
    this.mesh = new InstancedMesh(seedGeometry(), material, MAX_SEEDS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.renderOrder = 25;
    this.group.add(this.mesh);

    // Blob shadows. Multiply blending darkens whatever is behind, which is what
    // a shadow does — an additive disc would glow instead.
    const shadowMat = blobShadowMaterial();
    this.shadow = new InstancedMesh(new CircleGeometry(1, 16), shadowMat, MAX_SEEDS);
    this.shadow.count = 0;
    this.shadow.frustumCulled = false;
    this.shadow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadow.renderOrder = 6;
    this.group.add(this.shadow);

    this.glowPos = new Float32Array(MAX_SEEDS * 3);
    this.glowColor = new Float32Array(MAX_SEEDS * 3);
    this.glowSize = new Float32Array(MAX_SEEDS);
    const pa = new BufferAttribute(this.glowPos, 3);
    const ca = new BufferAttribute(this.glowColor, 3);
    const sa = new BufferAttribute(this.glowSize, 1);
    for (const a of [pa, ca, sa]) a.setUsage(DynamicDrawUsage);
    this.glowGeometry.setAttribute('position', pa);
    this.glowGeometry.setAttribute('color', ca);
    this.glowGeometry.setAttribute('size', sa);
    this.glowMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale * projectionMatrix[1][1] / max(0.001, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float halo = pow(1.0 - d, 3.0) * 0.3;
          float core = smoothstep(0.12, 0.0, d) * 0.3;
          gl_FragColor = vec4(vColor * (halo + core), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.glow = new Points(this.glowGeometry, this.glowMaterial);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 40;
    this.group.add(this.glow);
  }

  setScale(pixelHeight: number, worldScale: number): void {
    this.glowMaterial.uniforms.uScale.value = pixelHeight * 0.5 * worldScale;
  }

  /** `alpha` is the fixed-step interpolation factor; `head` is the dandelion head centre. */
  update(
    seeds: readonly Seed[],
    alpha: number,
    time: number,
    head: { x: number; y: number; z: number },
    flock: boolean,
    groundAt?: (x: number, z: number, fromY: number) => number,
  ): void {
    const dt = Math.min(0.1, Math.max(1e-4, time - this.lastTime));
    this.lastTime = time;
    let n = 0;
    let shadows = 0;
    for (let i = 0; i < seeds.length && n < MAX_SEEDS; i++) {
      const s = seeds[i];
      pos.set(
        s.prevPos.x + (s.pos.x - s.prevPos.x) * alpha,
        s.prevPos.y + (s.pos.y - s.prevPos.y) * alpha,
        s.prevPos.z + (s.pos.z - s.prevPos.z) * alpha,
      );
      axis.set(
        s.prevAxis.x + (s.axis.x - s.prevAxis.x) * alpha,
        s.prevAxis.y + (s.axis.y - s.prevAxis.y) * alpha,
        s.prevAxis.z + (s.axis.z - s.prevAxis.z) * alpha,
      );
      let scale = flock ? 1.0 : 1.5;
      let glow = 0.55 + 0.45 * Math.min(1.6, s.glow);
      // a slow heartbeat so the seed feels alive even in dead air
      glow *= 0.86 + 0.14 * Math.sin(time * 2.6 + s.variation * 6.283);
      if (s.status === 'attached') {
        // attached seeds point away from the dandelion head, and tremble as the wind works them loose
        const dx = s.anchor.x - head.x, dy = s.anchor.y - head.y, dz = s.anchor.z - head.z;
        const l = Math.hypot(dx, dy, dz);
        if (l > 1e-4) {
          const tremble = s.pluck * 0.5;
          axis.set(
            dx / l + axis.x * 0.25 + Math.sin(time * 31 + i) * tremble,
            dy / l + axis.y * 0.25,
            dz / l + axis.z * 0.25 + Math.cos(time * 27 + i * 2) * tremble,
          );
        }
        glow *= flock ? 0.16 : 1; // a full head glows as one, not as twenty
      } else if (s.status === 'planted') {
        // the seed sinks into the soil and its light goes into the ground
        const t = Math.min(1, s.restTime / 1.4);
        scale *= 1 - 0.75 * t;
        pos.y -= 0.05 * t;
        glow *= 1 + 2.2 * Math.max(0, 1 - s.restTime * 2.2) - Math.min(1, s.restTime / 2.4);
        if (glow < 0) glow = 0;
      } else if (s.status === 'lost') {
        const t = Math.min(1, s.restTime / 2.4);
        scale *= 1 - t;
        glow *= 1 - t;
      }
      if (flock && s.status === 'flying') glow *= 0.42;
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      axis.normalize();

      // ── feel: stretch with speed, squash on the pop ──
      // A body moving through air deforms; a body that has just been released
      // squashes first. Both are read by the eye as weight, and neither changes
      // the simulation by a millimetre.
      const j = n * 3;
      const dx = pos.x - this.lastPos[j];
      const dy = pos.y - this.lastPos[j + 1];
      const dz = pos.z - this.lastPos[j + 2];
      const speed = Math.hypot(dx, dy, dz) / dt;
      this.lastPos[j] = pos.x;
      this.lastPos[j + 1] = pos.y;
      this.lastPos[j + 2] = pos.z;

      // Release: attached -> flying. Give it a short squeeze.
      if (this.wasStatus[n] === 'attached' && s.status === 'flying') this.squash[n] = 0.16;
      this.wasStatus[n] = s.status;
      const pop = Math.max(0, this.squash[n]);
      this.squash[n] = Math.max(0, pop - dt);

      const stretch = s.status === 'flying' ? Math.min(0.5, Math.max(0, speed - 0.3) * 0.16) : 0;
      const popT = pop > 0 ? pop / 0.16 : 0; // 1 -> 0
      const along = 1 + stretch - 0.3 * popT;
      const across = 1 / Math.sqrt(along) * (1 + 0.4 * popT);
      scl.set(scale * across, scale * along, scale * across);

      qa.setFromUnitVectors(up, axis);
      qb.setFromAxisAngle(up, s.spin);
      qa.multiply(qb);
      m4.compose(pos, qa, scl);
      this.mesh.setMatrixAt(n, m4);

      // ── its shadow, on whatever is underneath ──
      if (groundAt) {
        const gy = groundAt(pos.x, pos.z, pos.y);
        if (Number.isFinite(gy)) {
          const h = Math.max(0, pos.y - gy) / 30; // world metres (the world is 1:30)
          const fade = Math.max(0, 1 - h / 0.32) * Math.min(1, 0.25 + s.glow * 0.35);
          if (fade > 0.01) {
            const r = (flock ? 0.06 : 0.11) * (1 + h * 2.2) * scale * fade;
            scl.set(r, r, r);
            shadowPos.set(pos.x, gy + 0.004, pos.z);
            m4.compose(shadowPos, flatQ, scl);
            this.shadow.setMatrixAt(shadows, m4);
            shadows++;
          }
        }
      }
      // the light sits in the pappus, a little above the achene
      this.glowPos[j] = pos.x + axis.x * 0.16 * scale;
      this.glowPos[j + 1] = pos.y + axis.y * 0.16 * scale;
      this.glowPos[j + 2] = pos.z + axis.z * 0.16 * scale;
      this.glowColor[j] = this.glowTint.r * glow;
      this.glowColor[j + 1] = this.glowTint.g * glow;
      this.glowColor[j + 2] = this.glowTint.b * glow;
      this.glowSize[n] = (flock ? 0.6 : 1.0) * (0.8 + 0.25 * Math.min(glow, 2.5)) * (scale > 0.02 ? 1 : 0);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadow.count = shadows;
    this.shadow.instanceMatrix.needsUpdate = true;
    this.glowGeometry.setDrawRange(0, n);
    this.glowGeometry.attributes.position.needsUpdate = true;
    this.glowGeometry.attributes.color.needsUpdate = true;
    this.glowGeometry.attributes.size.needsUpdate = true;
  }
}

/** The dandelion a course's seeds wait on: a bent stem, a few leaves, a receptacle. */
export function buildDandelion(course: Course): Group {
  const g = new Group();
  const d = course.dandelion;
  const ground = islandTop(course.start, d.x, d.z);
  const h = d.y - ground;
  const burst = course.seedCount > 1;
  const headY = burst ? h : h + course.headRadius - 0.12;
  // the puff the seeds actually sit in: bigger than the anchor sphere, because
  // a dandelion in seed is mostly air, and the air is the beautiful part
  const puffR = Math.max(0.33, course.headRadius * 2.15);

  const stemMat = new MeshLambertMaterial({ color: 0x77a24e, flatShading: true });
  // stem: four leaning segments, thinner at the top
  const segs = 5;
  let px = 0.16, py = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x1 = 0.16 * (1 - t1) * (1 - t1);
    const y1 = headY * t1;
    const len = Math.hypot(x1 - px, y1 - py);
    const seg = new Mesh(new CylinderGeometry(0.055 - 0.018 * t1, 0.068 - 0.018 * t0, len, 8, 1, true), stemMat);
    seg.position.set((px + x1) / 2, (py + y1) / 2, 0);
    seg.rotation.z = Math.atan2(px - x1, y1 - py);
    g.add(seg);
    px = x1;
    py = y1;
  }

  // leaves: a rosette of long, toothed blades at the base
  const b = new FlatBuilder();
  const leaf = new Color(0x4b8a3a), leaf2 = new Color(0x63a84c);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.283 + 0.3;
    const L = 0.42 + (i % 2) * 0.16;
    const cx = Math.cos(a), cz = Math.sin(a);
    const sx = Math.cos(a + 1.57) * 0.075, sz = Math.sin(a + 1.57) * 0.075;
    const c = i % 2 ? leaf : leaf2;
    // a blade with two teeth, bent down along its length
    b.tri(0.16, 0.01, 0, 0.16 + cx * L * 0.5 + sx, 0.09, cz * L * 0.5 + sz, 0.16 + cx * L, 0.03, cz * L, c);
    b.tri(0.16, 0.01, 0, 0.16 + cx * L, 0.03, cz * L, 0.16 + cx * L * 0.5 - sx, 0.09, cz * L * 0.5 - sz, c);
    b.tri(0.16 + cx * L * 0.5 + sx, 0.09, cz * L * 0.5 + sz, 0.16 + cx * L * 0.92 + sx * 1.6, 0.10, cz * L * 0.92 + sz * 1.6, 0.16 + cx * L, 0.03, cz * L, c);
  }
  const leaves = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
  g.add(leaves);

  // ── the seed head ──
  const core = new Mesh(
    new IcosahedronGeometry(Math.max(0.055, course.headRadius * 0.5), 1),
    new MeshLambertMaterial({ color: 0xd8cfa8, flatShading: true }),
  );
  core.position.set(0, headY, 0);
  g.add(core);

  // The pappus: a hundred fine filaments on a sphere, cream at the root and
  // white at the tip. This is the thing the whole first act is about, so it gets
  // real geometry rather than a sprite.
  const puff = new FlatBuilder();
  const rootC = new Color(0.86, 0.83, 0.70);
  const tipC = new Color(1.0, 0.99, 0.94);
  const N = 74;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    // upper three quarters of the sphere, thinning underneath
    const y = 1 - (i / (N - 1)) * 1.55;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden;
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r, dy = y;
    const bx = dx * 0.05, by = headY + dy * 0.05, bz = dz * 0.05;
    const tx = dx * puffR, ty = headY + dy * puffR * 0.92, tz = dz * puffR;
    // a filament is a needle: wide at the root, a hair at the tip
    const w = 0.0065;
    const ux = -dz * w, uz = dx * w;
    puff.tri3(bx - ux, by, bz - uz, bx + ux, by, bz + uz, tx, ty, tz, rootC, rootC, tipC);
    // and a tiny fork at the end: the barbs that catch the air
    puff.tri3(tx, ty, tz, tx + dx * 0.035 + ux * 2.4, ty + dy * 0.035, tz + dz * 0.035 + uz * 2.4, tx + dx * 0.05, ty + dy * 0.05, tz + dz * 0.05, tipC, tipC, tipC);
  }
  const puffMesh = new Mesh(
    puff.build(),
    new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide, transparent: true, opacity: 0.96 }),
  );
  g.add(puffMesh);

  // a breath of light in the head, so the first thing the player sees in the
  // case is the brightest thing in it
  const glow = new Sprite(
    new SpriteMaterial({
      map: blobTexture(),
      color: 0xffe9b8,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  glow.position.set(0, headY, 0);
  glow.scale.setScalar(puffR * 3.1);
  g.add(glow);

  g.position.set(d.x, ground, d.z);
  return g;
}
