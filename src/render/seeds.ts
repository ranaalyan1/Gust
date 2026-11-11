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
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import type { Seed } from '../core/seed.js';
import type { Course } from '../core/course.js';
import { islandTop } from '../core/terrain.js';
import { FlatBuilder } from './build.js';

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

export class SeedViews {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
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
  update(seeds: readonly Seed[], alpha: number, time: number, head: { x: number; y: number; z: number }, flock: boolean): void {
    let n = 0;
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
      qa.setFromUnitVectors(up, axis);
      qb.setFromAxisAngle(up, s.spin);
      qa.multiply(qb);
      scl.set(scale, scale, scale);
      m4.compose(pos, qa, scl);
      this.mesh.setMatrixAt(n, m4);
      const j = n * 3;
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
  const stemMat = new MeshLambertMaterial({ color: 0x6fae4a, flatShading: true });
  // stem: three leaning segments
  const segs = 4;
  let px = 0.14, py = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x1 = 0.14 * (1 - t1) * (1 - t1);
    const y1 = (course.seedCount > 1 ? h : h + course.headRadius - 0.12) * t1;
    const len = Math.hypot(x1 - px, y1 - py);
    const seg = new Mesh(new CylinderGeometry(0.022 - 0.008 * t1, 0.026 - 0.008 * t0, len, 5, 1, true), stemMat);
    seg.position.set((px + x1) / 2, (py + y1) / 2, 0);
    seg.rotation.z = Math.atan2(px - x1, y1 - py);
    g.add(seg);
    px = x1;
    py = y1;
  }
  // leaves: a rosette of jagged blades at the base
  const b = new FlatBuilder();
  const leaf = new Color(0x4f9a3e), leaf2 = new Color(0x66b24c);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.283 + 0.3;
    const L = 0.34 + (i % 2) * 0.1;
    const cx = Math.cos(a), cz = Math.sin(a);
    const sx = Math.cos(a + 1.57) * 0.07, sz = Math.sin(a + 1.57) * 0.07;
    b.tri(0.14, 0.01, 0, 0.14 + cx * L * 0.55 + sx, 0.1, cz * L * 0.55 + sz, 0.14 + cx * L, 0.04, cz * L, i % 2 ? leaf : leaf2);
    b.tri(0.14, 0.01, 0, 0.14 + cx * L, 0.04, cz * L, 0.14 + cx * L * 0.55 - sx, 0.1, cz * L * 0.55 - sz, i % 2 ? leaf2 : leaf);
  }
  const leaves = new Mesh(b.build(), new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
  g.add(leaves);
  // receptacle
  const head = new Mesh(
    new IcosahedronGeometry(course.seedCount > 1 ? course.headRadius * 0.62 : 0.075, 1),
    new MeshLambertMaterial({ color: 0xe9e2c4, flatShading: true }),
  );
  head.position.set(0, course.seedCount > 1 ? h : h + course.headRadius - 0.12, 0);
  g.add(head);
  g.position.set(d.x, ground, d.z);
  return g;
}
