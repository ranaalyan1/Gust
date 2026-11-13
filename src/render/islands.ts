/**
 * ISLANDS — the floating diorama, meshed directly from the same analytic
 * functions the collision code uses (islandRim / islandTop / islandBottom), so
 * what the seed touches is exactly what you see.
 *
 * Every island carries two colour sets: dormant and lush. A bloom is a wave
 * that travels across the island from the spot where the seed took root,
 * switching one for the other in the fragment shader.
 */
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  Vector4,
} from '@iwsdk/core';
import { type Island, type Obstacle, islandBottom, islandRim, islandTop } from '../core/terrain.js';
import { hash01 } from '../core/random.js';
import { FlatBuilder, shade } from './build.js';

const RINGS = 7;
const SEGS = 30;

const GRASS = new Color(0x51603a);
const GRASS_2 = new Color(0x66743f);
const DRY = new Color(0x9c8a6a);
const DRY_2 = new Color(0x84765c);
const EARTH = new Color(0x5a3d2b);
const ROCK = new Color(0x6a5f5e);
const ROCK_DEEP = new Color(0x3b3333);
const STONE = new Color(0x6f6660);

const c1 = new Color();
const c2 = new Color();

export interface IslandView {
  island: Island;
  group: Group;
  material: MeshLambertMaterial;
  /** Local (x, z) the bloom spreads from and its current radius (m). */
  bloom: Vector4;
  bloomTarget: number;
  /** True once this island has bloomed (or was born lush). */
  lush: boolean;
  /** Seconds since the bloom began (for the wave front glow). */
  bloomAge: number;
}

function islandMaterial(bloom: Vector4): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBloom = { value: bloom };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 lush;\nvarying vec3 vLush;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLush = lush;\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uBloom;\nvarying vec3 vLush;\nvarying vec3 vLocal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bd = distance(vLocal.xz, uBloom.xy) + vLocal.y * -0.35;
        float bl = 1.0 - smoothstep(uBloom.w - 0.3, uBloom.w, bd);
        float front = smoothstep(uBloom.w - 0.5, uBloom.w - 0.05, bd) * bl * uBloom.z;
        diffuseColor.rgb = mix(diffuseColor.rgb, vLush, bl);
        diffuseColor.rgb += vec3(1.0, 0.86, 0.45) * front * 1.4;`,
      );
  };
  return m;
}

export function buildIslandView(island: Island, lush: boolean): IslandView {
  const b = new FlatBuilder();
  const cx = island.center.x;
  const cz = island.center.z;
  // local-space sample helpers (the mesh is positioned at the island centre)
  const px = (c: number, th: number) => c * islandRim(island, th) * island.rx * Math.cos(th);
  const pz = (c: number, th: number) => c * islandRim(island, th) * island.rz * Math.sin(th);
  const top = (c: number, th: number) => islandTop(island, cx + px(c, th), cz + pz(c, th), c) - island.center.y;
  const bot = (c: number, th: number) => islandBottom(island, cx + px(c, th), cz + pz(c, th), c) - island.center.y;
  const rnd = (i: number, j: number, k: number) => hash01(island.shapeSeed * 3 + i * 131 + j * 17 + k);

  const quad = (
    f: (c: number, th: number) => number,
    ca: number, cb: number, ta: number, tb: number,
    colA: Color, lushA: Color, flip: boolean, jitter = 0, key = 0,
  ) => {
    const j = (c: number, t: number) => (jitter === 0 ? 1 : 1 + (hash01(key + Math.round(c * 50) * 7 + Math.round(t * 100)) - 0.5) * jitter);
    const ax = px(ca, ta) * j(ca, ta), az = pz(ca, ta) * j(ca, ta), ay = f(ca, ta);
    const bx = px(cb, ta) * j(cb, ta), bz = pz(cb, ta) * j(cb, ta), by = f(cb, ta);
    const dx = px(cb, tb) * j(cb, tb), dz = pz(cb, tb) * j(cb, tb), dy = f(cb, tb);
    const ex = px(ca, tb) * j(ca, tb), ez = pz(ca, tb) * j(ca, tb), ey = f(ca, tb);
    if (!flip) {
      if (ca > 0) b.tri(ax, ay, az, ex, ey, ez, bx, by, bz, colA, lushA);
      b.tri(bx, by, bz, ex, ey, ez, dx, dy, dz, colA, lushA);
    } else {
      if (ca > 0) b.tri(ax, ay, az, bx, by, bz, ex, ey, ez, colA, lushA);
      b.tri(bx, by, bz, dx, dy, dz, ex, ey, ez, colA, lushA);
    }
  };

  for (let s = 0; s < SEGS; s++) {
    const ta = (s / SEGS) * Math.PI * 2;
    const tb = ((s + 1) / SEGS) * Math.PI * 2;
    // ── top: grass, with an earthy lip at the coast ──
    for (let r = 0; r < RINGS; r++) {
      const ca = Math.pow(r / RINGS, 0.8);
      const cb = Math.pow((r + 1) / RINGS, 0.8);
      const v = rnd(s, r, 1);
      const coast = r === RINGS - 1;
      shade(c2, v > 0.5 ? GRASS : GRASS_2, (v - 0.5) * 0.22);
      shade(c1, v > 0.5 ? DRY : DRY_2, (v - 0.5) * 0.18);
      if (coast) {
        c2.lerp(EARTH, 0.55);
        c1.lerp(EARTH, 0.35);
      }
      quad(top, ca, cb, ta, tb, c1.clone(), c2.clone(), false);
    }
    // ── cliff band ──
    {
      const ax = px(1, ta), az = pz(1, ta), bx = px(1, tb), bz = pz(1, tb);
      shade(c1, EARTH, (rnd(s, 40, 2) - 0.5) * 0.25);
      const col = c1.clone();
      const k = 0.94;
      b.tri(ax, top(1, ta), az, bx, top(1, tb), bz, ax * k, bot(1, ta) - 0.1, az * k, col);
      b.tri(bx, top(1, tb), bz, bx * k, bot(1, tb) - 0.1, bz * k, ax * k, bot(1, ta) - 0.1, az * k, col);
    }
    // ── underside: craggy rock tapering to a point ──
    const UNDER = 5;
    const k = 0.94; // tucked slightly under the cliff band
    // vertex of the underside grid; the crag offset is keyed by the vertex so neighbours share it (no cracks)
    const U = (r: number, seg: number, out: number[]) => {
      const th = ((seg % SEGS) / SEGS) * Math.PI * 2;
      const c = 1 - r / UNDER;
      const depth = r / UNDER;
      const jag = r === 0 || r === UNDER ? 0 : (rnd(seg % SEGS, r, 5) - 0.5) * 0.34 * island.depth * (1 - depth * 0.6);
      const wob = r === 0 || r === UNDER ? 1 : 1 + (rnd(seg % SEGS, r, 9) - 0.5) * 0.3;
      out[0] = px(c, th) * k * wob;
      out[1] = bot(c, th) - (r === 0 ? 0.1 : 0) - Math.abs(jag) * 0.6 + jag * 0.4;
      out[2] = pz(c, th) * k * wob;
    };
    const A: number[] = [], B: number[] = [], C: number[] = [], D: number[] = [];
    for (let r = 0; r < UNDER; r++) {
      const depth = (r + 0.5) / UNDER;
      U(r, s, A);
      U(r, s + 1, B);
      U(r + 1, s, C);
      U(r + 1, s + 1, D);
      c1.copy(ROCK).lerp(ROCK_DEEP, depth);
      shade(c1, c1, (rnd(s, r, 3) - 0.5) * 0.3);
      b.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], c1.clone());
      if (r < UNDER - 1) {
        shade(c1, c1, (rnd(s, r, 4) - 0.5) * 0.2);
        b.tri(B[0], B[1], B[2], D[0], D[1], D[2], C[0], C[1], C[2], c1.clone());
      }
    }
  }

  const bloom = new Vector4(0, 0, 0, lush ? 99 : -1);
  const material = islandMaterial(bloom);
  const mesh = new Mesh(b.build(true), material);
  const group = new Group();
  group.position.set(island.center.x, island.center.y, island.center.z);
  group.add(mesh);
  return { island, group, material, bloom, bloomTarget: lush ? 99 : -1, lush, bloomAge: 0 };
}

/** Start the bloom wave from a local point on the island. */
export function startBloom(view: IslandView, localX: number, localZ: number): void {
  if (view.lush) return;
  view.lush = true;
  view.bloom.set(localX, localZ, 1, 0);
  view.bloomTarget = Math.max(view.island.rx, view.island.rz) * 2.6 + 1;
  view.bloomAge = 0;
}

export function updateBloom(view: IslandView, dt: number, speed = 1.5): void {
  if (!view.lush || view.bloom.w >= view.bloomTarget) return;
  view.bloomAge += dt;
  view.bloom.w = Math.min(view.bloomTarget, view.bloom.w + dt * speed);
  if (view.bloom.w >= view.bloomTarget) view.bloom.z = 0;
}

const MOSS = new Color(0x556b3e);
const LICHEN = new Color(0x9a9282);

/**
 * Stone obstacles: the storm gate's slabs and the spires. A collision box is a
 * box; what is drawn is weathered rock carved out of it — never larger than the
 * box, so nothing ever collides with air that looks empty from outside it.
 *   below the flight line -> tapers downward like an island's root
 *   above the flight line -> tapers upward into a broken crown
 */
export function buildObstacle(o: Obstacle, key: number): Mesh {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  let geometry;
  if (o.kind === 'box') {
    const sx = Math.max(2, Math.round(o.half.x * 4.5));
    const sy = Math.max(3, Math.round(o.half.y * 5));
    const sz = Math.max(2, Math.round(o.half.z * 4.5));
    geometry = new BoxGeometry(o.half.x * 2, o.half.y * 2, o.half.z * 2, sx, sy, sz).toNonIndexed();
  } else {
    geometry = new IcosahedronGeometry(o.radius, 1);
  }
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const box = o.kind === 'box';
  const hx = box ? o.half.x : o.radius, hy = box ? o.half.y : o.radius, hz = box ? o.half.z : o.radius;
  // which way does this rock taper? (walls only get chiselled)
  const role = !box ? 0 : o.center.y - hy > 1.2 ? 1 : o.center.y < 0 ? -1 : 0;
  const hashAt = (x: number, y: number, z: number, salt: number) =>
    hash01(key * 7 + salt + Math.round(x * 37) * 3 + Math.round(y * 41) * 5 + Math.round(z * 43) * 7);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const h = hashAt(x, y, z, 0);
    const h2 = hashAt(x, y, z, 11);
    const u = x / hx, v = y / hy, w = z / hz;
    let k = 1 - h * 0.07;
    let ny = y * (1 - h * 0.03);
    if (role !== 0) {
      // t: 0 on the face the seed flies past, 1 at the far tip
      const t = role < 0 ? (1 - v) * 0.5 : (1 + v) * 0.5;
      k = 1 - 0.62 * Math.pow(t, 1.6) - h * 0.1 * (0.3 + t);
      // strata: ledges step in and out a little
      k -= 0.05 * (Math.sin(v * 9 + key) > 0.3 ? 1 : 0) * t;
      // the far tip is broken, not flat
      ny = y + (role < 0 ? 1 : -1) * h2 * 0.5 * hy * t * t;
      if (t < 0.02) ny = y; // the flight-side face stays true to the collision box
    }
    // soften the vertical corners
    if (Math.abs(u) > 0.98 && Math.abs(w) > 0.98) k *= 0.93;
    pos.setXYZ(i, x * k, ny, z * k);
  }
  geometry.computeVertexNormals();
  const nrm = geometry.getAttribute('normal');
  for (let i = 0; i < pos.count; i += 3) {
    const h = hash01(key * 3 + i * 11);
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const up = (nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)) / 3;
    c1.copy(STONE).lerp(ROCK_DEEP, 0.35 - 0.35 * Math.min(1, Math.max(-1, y / hy)));
    // bands of paler stone
    if (Math.sin((y / hy) * 7 + key * 1.3) > 0.55) c1.lerp(LICHEN, 0.22);
    // anything that faces the sky gathers moss
    if (up > 0.6) c1.lerp(MOSS, 0.35 + 0.35 * h);
    shade(c1, c1, (h - 0.5) * 0.24);
    for (let j = 0; j < 3; j++) {
      colors[(i + j) * 3] = c1.r;
      colors[(i + j) * 3 + 1] = c1.g;
      colors[(i + j) * 3 + 2] = c1.b;
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mesh = new Mesh(geometry, material);
  mesh.position.set(o.center.x, o.center.y, o.center.z);
  return mesh;
}
