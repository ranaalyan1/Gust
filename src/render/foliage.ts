/**
 * THE WORLD AS INSTRUMENT — everything that grows, and so everything that
 * shows the wind: grass tufts, flowers and trees.
 *
 * Each plant samples the analytic wind field at its own position every frame
 * and leans with it through a small spring, so a sweep of the hand visibly
 * rolls across an island as a wave. Three instanced meshes, three draw calls.
 */
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from '@iwsdk/core';
import type { WindField } from '../core/wind.js';
import { type Vec3, vec3 } from '../core/vec3.js';
import { islandCoord, islandTop } from '../core/terrain.js';
import { createRng, hash01 } from '../core/random.js';
import { type Garden, type GardenPlant, plantGrowth } from '../core/garden.js';
import { FlatBuilder, shade } from './build.js';
import type { IslandView } from './islands.js';

export const MAX_GRASS = 1100;
const MAX_FLOWERS = 420;
const MAX_TREES = 40;

type Kind = 'grass' | 'flower' | 'tree';

interface Plant {
  kind: Kind;
  view: IslandView;
  /** Simulation-space root position. */
  x: number;
  y: number;
  z: number;
  /** Island-local position (for bloom reveal). */
  lx: number;
  lz: number;
  size: number;
  /** 0..1 extra growth (garden plants ease in after a bloom). */
  grown: number;
  hue: number;
  /** Spring state: current lean (sim m/s of wind it has "absorbed"). */
  bx: number;
  bz: number;
  vx: number;
  vz: number;
  phase: number;
  /** Plants that belong to the lush state are hidden until the bloom reaches them. */
  needsBloom: boolean;
  shown: number;
  /** Seconds this plant waits after being revealed before popping (cascade timing). */
  delay: number;
}

function grassGeometry(): BufferGeometry {
  const b = new FlatBuilder();
  const c = new Color(1, 1, 1);
  const dark = new Color(0.84, 0.9, 0.8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const r = i === 0 ? 0 : 0.34;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const w = 0.16;
    const h = i === 0 ? 1 : 0.62 + 0.12 * i;
    const dx = Math.cos(a + 1.57) * w, dz = Math.sin(a + 1.57) * w;
    const lean = 0.22;
    b.tri(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean, i % 2 ? dark : c);
  }
  return b.build();
}

function flowerGeometry(): BufferGeometry {
  const b = new FlatBuilder();
  const stem = new Color(0.36, 0.62, 0.3);
  const petal = new Color(1, 1, 1);
  const heart = new Color(1.0, 0.82, 0.25);
  const w = 0.045;
  b.tri(-w, 0, 0, w, 0, 0, 0, 0.72, 0, stem);
  b.tri(0, 0, -w, 0, 0, w, 0, 0.72, 0, stem);
  const cy = 0.74;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2;
    const a1 = ((i + 0.72) / 5) * Math.PI * 2;
    const r = 0.3;
    b.tri(0, cy, 0, Math.cos(a0) * r, cy + 0.1, Math.sin(a0) * r, Math.cos(a1) * r, cy + 0.1, Math.sin(a1) * r, petal);
  }
  const s = 0.09;
  b.tri(-s, cy + 0.03, -s, s, cy + 0.03, -s, 0, cy + 0.12, s, heart);
  return b.build();
}

function treeGeometry(): BufferGeometry {
  const b = new FlatBuilder();
  const bark = new Color(0.45, 0.31, 0.24);
  const tmp = new Color();
  const add = (geo: BufferGeometry, ox: number, oy: number, oz: number, base: Color, vary: number, key: number) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      shade(tmp, base, (hash01(key + i * 7) - 0.5) * vary + (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) * 0.06);
      b.tri(
        p.getX(i) + ox, p.getY(i) + oy, p.getZ(i) + oz,
        p.getX(i + 1) + ox, p.getY(i + 1) + oy, p.getZ(i + 1) + oz,
        p.getX(i + 2) + ox, p.getY(i + 2) + oy, p.getZ(i + 2) + oz,
        tmp.clone(),
      );
    }
  };
  const trunk = new CylinderGeometry(0.045, 0.085, 0.62, 5, 1, true);
  add(trunk, 0, 0.31, 0, bark, 0.12, 1);
  // canopy is white: instance colour tints it (leaf green, blossom pink, autumn gold)
  const white = new Color(1, 1, 1);
  add(new IcosahedronGeometry(0.36, 0), 0, 0.82, 0, white, 0.2, 11);
  add(new IcosahedronGeometry(0.26, 0), 0.22, 0.66, 0.08, white, 0.2, 23);
  add(new IcosahedronGeometry(0.24, 0), -0.2, 0.7, -0.1, white, 0.2, 37);
  return b.build();
}

/** Patches a Lambert material so instances lean by a per-instance `aBend` attribute. */
function bendMaterial(material: MeshLambertMaterial, time: { value: number }): MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBend;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hh = transformed.y * transformed.y;
        float amt = length(aBend.xz);
        float fl = sin(uTime * (7.0 + amt * 3.0) + aBend.y) * min(amt, 1.2) * 0.22;
        transformed.x += (aBend.x * (1.0 + fl)) * hh;
        transformed.z += (aBend.z * (1.0 + fl)) * hh;
        transformed.y -= min(amt, 1.4) * hh * 0.32;`,
      );
  };
  return material;
}

const FLOWER_COLORS = [0xff6f91, 0xffc75f, 0xf9f871, 0xff9671, 0xd65db1, 0xffffff, 0x9bf6ff, 0xffadad];
const LEAF = new Color(0x6fc45a);
const LEAF_DRY = new Color(0x8f8a70);
const GRASS_LUSH = new Color(0xa6e06a);
const GRASS_DRY = new Color(0xc9b99a);

const m4 = new Matrix4();
const q = new Quaternion();
const v3a = new Vector3();
const v3b = new Vector3();
const up = new Vector3(0, 1, 0);
const col = new Color();
const colB = new Color();
const wind: Vec3 = vec3();
const probe: Vec3 = vec3();

export interface PetalEmitter {
  (x: number, y: number, z: number, vx: number, vy: number, vz: number, color: Color): void;
}

export class Foliage {
  readonly group = new Group();
  private readonly plants: Plant[] = [];
  private readonly grass: InstancedMesh;
  private readonly flowers: InstancedMesh;
  private readonly trees: InstancedMesh;
  private readonly bend: Record<Kind, InstancedBufferAttribute>;
  private readonly time = { value: 0 };
  private dirty = true;
  private cursor = 0;
  /** Grass density multiplier (shrink numbers, never polish). */
  density = 1;

  constructor() {
    const mk = (geo: BufferGeometry, max: number, soft: boolean) => {
      // blades and petals are lit as if they were the ground they grow from
      // (normals straight up), so a meadow reads as one soft surface
      if (soft) {
        const nrm = geo.getAttribute('normal');
        for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      }
      const mat = bendMaterial(
        soft ? new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }) : new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
        this.time,
      );
      const mesh = new InstancedMesh(geo, mat, max);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      const attr = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
      attr.setUsage(DynamicDrawUsage);
      geo.setAttribute('aBend', attr);
      this.group.add(mesh);
      return { mesh, attr };
    };
    const g = mk(grassGeometry(), MAX_GRASS, true);
    const f = mk(flowerGeometry(), MAX_FLOWERS, true);
    const t = mk(treeGeometry(), MAX_TREES, false);
    this.grass = g.mesh;
    this.flowers = f.mesh;
    this.trees = t.mesh;
    this.bend = { grass: g.attr, flower: f.attr, tree: t.attr };
  }

  /** Remove every plant whose island is no longer shown. */
  prune(keep: (view: IslandView) => boolean): void {
    for (let i = this.plants.length - 1; i >= 0; i--) if (!keep(this.plants[i].view)) this.plants.splice(i, 1);
    this.dirty = true;
  }

  private add(kind: Kind, view: IslandView, lx: number, lz: number, size: number, hue: number, needsBloom: boolean, delay = 0): Plant | null {
    const island = view.island;
    const x = island.center.x + lx;
    const z = island.center.z + lz;
    const c = islandCoord(island, x, z);
    if (c > 0.93) return null;
    const plant: Plant = {
      kind, view, x, y: islandTop(island, x, z, c) - 0.01, z, lx, lz, size, grown: 1, hue,
      bx: 0, bz: 0, vx: 0, vz: 0, phase: hash01(x * 91.7 + z * 53.3) * 6.283,
      needsBloom, shown: needsBloom && !view.lush ? 0 : 1, delay,
    };
    this.plants.push(plant);
    this.dirty = true;
    return plant;
  }

  /** Scatter grass, wild flowers and (optionally) trees over an island. */
  populate(view: IslandView, options: { trees: number; flowers: number; keepClear?: { x: number; z: number; r: number }[] }): void {
    const island = view.island;
    const rng = createRng(island.shapeSeed * 13 + 5);
    const area = island.rx * island.rz;
    const clear = (lx: number, lz: number) =>
      (options.keepClear ?? []).some((k) => Math.hypot(lx - k.x, lz - k.z) < k.r);
    const spot = (maxC: number): [number, number] => {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * maxC;
      return [Math.cos(a) * r * island.rx, Math.sin(a) * r * island.rz];
    };
    let treesPlaced = 0;
    const grassCount = Math.round(area * 62 * this.density);
    for (let i = 0; i < grassCount; i++) {
      const [lx, lz] = spot(0.95);
      this.add('grass', view, lx, lz, 0.11 + rng() * 0.13, rng(), false);
    }
    for (let i = 0; i < options.flowers; i++) {
      const [lx, lz] = spot(0.86);
      if (clear(lx, lz)) continue;
      this.add('flower', view, lx, lz, 0.2 + rng() * 0.13, rng(), true, rng() * 0.5);
    }
    for (let i = 0; i < options.trees * 3 && treesPlaced < options.trees; i++) {
      // trees stand at the back of the island so they never hide the seed
      const a = -Math.PI * (0.15 + 0.7 * rng());
      const r = 0.45 + rng() * 0.32;
      const lx = Math.cos(a) * r * island.rx, lz = Math.sin(a) * r * island.rz;
      // never in front of or directly behind the dandelion: it must read against the sky
      if ((options.keepClear ?? []).some((kc) => Math.abs(lx - kc.x) < 0.75)) continue;
      if (this.add('tree', view, lx, lz, 0.85 + rng() * 0.6, 0.3 + rng() * 0.12, true, 0.3 + rng() * 0.6)) treesPlaced++;
    }
  }

  /** Plant the persistent garden on a home island. `fresh` plants (this run's) pop in one by one. */
  plantGarden(view: IslandView, garden: Garden, freshFromRun = -1): void {
    garden.plants.forEach((p: GardenPlant, i: number) => {
      const growth = plantGrowth(garden, p);
      const fresh = p.run === freshFromRun;
      const kind: Kind = p.kind === 'tree' ? 'tree' : 'flower';
      const size = p.kind === 'tree' ? 1.25 * growth : p.kind === 'bush' ? 0.52 * growth : 0.34 * growth;
      const plant = this.add(kind, view, p.x, p.z, size, p.hue, fresh, fresh ? 0.25 + (i % 30) * 0.12 : 0);
      if (plant && fresh) plant.shown = 0;
      if (plant && !fresh) plant.needsBloom = false;
      if (plant && p.kind === 'tree') plant.hue = 2 + p.hue; // garden trees blossom
    });
  }

  private write(full: boolean): void {
    const counts: Record<Kind, number> = { grass: 0, flower: 0, tree: 0 };
    const max: Record<Kind, number> = { grass: MAX_GRASS, flower: MAX_FLOWERS, tree: MAX_TREES };
    const mesh: Record<Kind, InstancedMesh> = { grass: this.grass, flower: this.flowers, tree: this.trees };
    for (const p of this.plants) {
      const i = counts[p.kind];
      if (i >= max[p.kind]) continue;
      counts[p.kind]++;
      if (!full && p.kind !== 'tree') continue;
      const lush = p.view.lush ? Math.min(1, Math.max(0, (p.view.bloom.w - Math.hypot(p.lx - p.view.bloom.x, p.lz - p.view.bloom.y)) / 0.5)) : 0;
      const s0 = p.shown;
      // ease-out-back: plants overshoot as they pop
      const pop = s0 <= 0 ? 0 : s0 >= 1 ? 1 : 1 + 2.2 * Math.pow(s0 - 1, 3) + 1.2 * Math.pow(s0 - 1, 2);
      let scale = p.size * pop;
      if (p.kind === 'grass') scale = p.size * (0.62 + 0.38 * lush);
      if (p.kind !== 'tree') {
        m4.makeScale(scale, scale, scale);
        m4.setPosition(p.x, p.y, p.z);
      } else {
        // trees sway as a whole: tilt about the root toward the wind
        const tilt = Math.min(0.5, Math.hypot(p.bx, p.bz) * 0.075);
        if (tilt > 1e-4) {
          v3a.set(p.bz, 0, -p.bx).normalize();
          q.setFromAxisAngle(v3a, tilt);
        } else q.identity();
        v3b.set(scale, scale, scale);
        m4.compose(v3a.set(p.x, p.y, p.z), q, v3b);
      }
      mesh[p.kind].setMatrixAt(i, m4);
      if (p.kind === 'grass') {
        col.copy(GRASS_DRY).lerp(GRASS_LUSH, lush);
        shade(col, col, (p.hue - 0.5) * 0.3);
      } else if (p.kind === 'flower') {
        col.setHex(FLOWER_COLORS[Math.floor(p.hue * FLOWER_COLORS.length) % FLOWER_COLORS.length]);
      } else if (p.hue >= 2) {
        col.setHex(FLOWER_COLORS[Math.floor((p.hue - 2) * 5) % 5]).lerp(colB.setRGB(1, 1, 1), 0.25);
      } else {
        col.copy(LEAF_DRY).lerp(LEAF, p.view.lush ? 1 : 0);
        shade(col, col, (p.hue - 0.36) * 1.2);
      }
      mesh[p.kind].setColorAt(i, col);
    }
    for (const k of ['grass', 'flower', 'tree'] as const) {
      mesh[k].count = counts[k];
      if (!full && k !== 'tree') continue;
      mesh[k].instanceMatrix.needsUpdate = true;
      if (mesh[k].instanceColor) mesh[k].instanceColor!.needsUpdate = true;
    }
  }

  /**
   * Read the wind, lean, and (when a gust is strong enough) shed petals.
   * `budget` limits how many plants re-sample the field this frame.
   */
  update(field: WindField, dt: number, time: number, emitPetal: PetalEmitter | null, budget = 700): void {
    this.time.value = time;
    const plants = this.plants;
    const n = plants.length;
    if (n === 0) {
      this.grass.count = this.flowers.count = this.trees.count = 0;
      return;
    }
    let animating = this.dirty;
    let swaying = false;
    // 1) sample the field for a rolling subset (everything, if within budget)
    const samples = Math.min(n, budget);
    for (let s = 0; s < samples; s++) {
      const p = plants[(this.cursor + s) % n];
      probe.x = p.x;
      probe.y = p.y + (p.kind === 'tree' ? 0.8 * p.size : 0.15);
      probe.z = p.z;
      field.sample(probe, wind);
      p.vx = wind.x;
      p.vz = wind.z;
      if (emitPetal && p.kind !== 'grass' && p.shown >= 1) {
        const speed = Math.hypot(wind.x, wind.z);
        if (speed > 3.2 && Math.random() < (speed - 3.2) * 0.02) {
          col.setHex(p.kind === 'tree' && p.hue < 2 ? 0x9fdc6a : FLOWER_COLORS[Math.floor((p.hue % 1) * FLOWER_COLORS.length) % FLOWER_COLORS.length]);
          emitPetal(probe.x, probe.y + (p.kind === 'tree' ? 0.1 : 0.05), probe.z, wind.x * 0.5, 0.6 + wind.y * 0.4, wind.z * 0.5, col);
        }
      }
    }
    this.cursor = (this.cursor + samples) % n;

    // 2) spring toward the sampled wind and write the lean
    const k = 1 - Math.exp(-9 * dt);
    const kt = 1 - Math.exp(-3.5 * dt);
    const idx: Record<Kind, number> = { grass: 0, flower: 0, tree: 0 };
    const max: Record<Kind, number> = { grass: MAX_GRASS, flower: MAX_FLOWERS, tree: MAX_TREES };
    for (let i = 0; i < n; i++) {
      const p = plants[i];
      const kk = p.kind === 'tree' ? kt : k;
      p.bx += (p.vx - p.bx) * kk;
      p.bz += (p.vz - p.bz) * kk;
      // reveal with the bloom wave
      if (p.shown < 1) {
        const view = p.view;
        if (!p.needsBloom) p.shown = 1;
        else if (view.lush) {
          const reach = view.bloom.w - Math.hypot(p.lx - view.bloom.x, p.lz - view.bloom.y);
          if (reach > 0) {
            if (p.delay > 0) p.delay -= dt;
            else p.shown = Math.min(1, p.shown + dt * 2.2);
          }
        }
        animating = true;
      }
      const j = idx[p.kind]++;
      if (j >= max[p.kind]) continue;
      const arr = this.bend[p.kind].array as Float32Array;
      const gain = p.kind === 'grass' ? 0.2 : p.kind === 'flower' ? 0.16 : 0;
      arr[j * 3] = p.bx * gain;
      arr[j * 3 + 1] = p.phase;
      arr[j * 3 + 2] = p.bz * gain;
      if (p.kind === 'tree' && (Math.abs(p.bx) > 0.02 || Math.abs(p.bz) > 0.02)) swaying = true;
    }
    this.bend.grass.needsUpdate = true;
    this.bend.flower.needsUpdate = true;
    // islands mid-bloom recolour their grass
    for (let i = 0; i < n && !animating; i += 37) {
      const v = plants[i].view;
      if (v.lush && v.bloom.w < v.bloomTarget) animating = true;
    }
    if (animating) {
      this.write(true);
      this.dirty = false;
    } else if (swaying) {
      this.write(false);
    }
  }

  get count(): number {
    return this.plants.length;
  }
}
