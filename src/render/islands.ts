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

const RINGS = 12;
const SEGS = 62;

const GRASS = new Color(0x4c6234);
const GRASS_2 = new Color(0x6a7f42);
const DRY = new Color(0x9c8a63);
const DRY_2 = new Color(0x7d7150);
const EARTH = new Color(0x51362a);
const ROCK = new Color(0x6a5f5e);
/** The pale, dry lip where turf gives way to rock, all the way round. */
const COAST = new Color(0x8e7c5c);
/** Sunlit crowns, and the damp hollows between them. */
const CROWN = new Color(0x86a355);
const CROWN_DRY = new Color(0xa89a70);
const HOLLOW = new Color(0x36462a);
/**
 * Beds. Rock is laid down in courses, and courses are what the eye counts on
 * the underside of a floating island. Colour only: the silhouette is already
 * doing the work, and cutting extra ledges into it just made the thing look
 * like a decorated cake.
 */
const STRATA = [
  new Color(0x7d6852),
  new Color(0x584a3c),
  new Color(0x6f5741),
  new Color(0x453d36),
  new Color(0x5f5142),
];
const ROCK_DEEP = new Color(0x3b3333);
/** Wet moss, the dark green that only grows in the shade of a rock. */
const MOSS_DARK = new Color(0x36441f);
/** Lichen: the pale crust that takes the windward face and nothing else. */
const CRUST = new Color(0x9aa187);
const BARE = new Color(0x6b573f);
const STONE = new Color(0x77695b);

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
  /**
   * Visual height of the turf. The collision surface is analytic; this adds a
   * hand's-width of undulation — hummocks and the dip where water would run —
   * because a flat-shaded disc with grass on it still reads as a disc.
   */
  const topOf = (c: number, th: number) => islandTop(island, cx + px(c, th), cz + pz(c, th), c) - island.center.y;
  const top = (c: number, th: number) => {
    const base = topOf(c, th);
    if (c > 0.985) return base;
    const bump = Math.sin(th * 5.0 + island.shapeSeed * 2.3) * Math.cos(c * 6.4 + island.shapeSeed) * 0.010
      + Math.sin(th * 11.0 + 1.7) * 0.005;
    return base + bump * Math.min(1, c * 2.2);
  };
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
    // ── top: grass, with a pale sandy lip and a ragged edge at the coast ──
    for (let r = 0; r < RINGS; r++) {
      const ca = Math.pow(r / RINGS, 0.8);
      const cb = Math.pow((r + 1) / RINGS, 0.8);
      const v = rnd(s, r, 1);
      // Patches, not noise. Ground is not evenly speckled: it is moss in the
      // folds and scoured bare on the shoulders, in patches a hand wide.
      const pxw = px((ca + cb) * 0.5, (ta + tb) * 0.5);
      const pzw = pz((ca + cb) * 0.5, (ta + tb) * 0.5);
      const seedA = hash01(island.shapeSeed + 31) * 6.283;
      const seedB = hash01(island.shapeSeed + 37) * 6.283;
      // two scales of patch: broad moss/shade zones, and the finer mottling a
      // hand's width across that stops a field reading as one printed green
      const patch = Math.sin(pxw * 9.3 + seedA) * Math.cos(pzw * 8.1 + seedB)
        + 0.5 * Math.sin((pxw - pzw) * 5.7)
        + 0.32 * Math.sin(pxw * 21.0 + seedB) * Math.cos(pzw * 18.0 + seedA);
      const bare = Math.max(0, patch - 0.5) * 0.9;
      const moss = Math.max(0, -patch - 0.3) * 1.05;
      const coast = r === RINGS - 1;
      shade(c2, v > 0.5 ? GRASS : GRASS_2, (v - 0.5) * 0.22);
      shade(c1, v > 0.5 ? DRY : DRY_2, (v - 0.5) * 0.18);
      if (coast) {
        // a thin band of dry sand, then soil: the eye reads a coastline as a
        // sequence of materials, not as one green edge
        c2.lerp(COAST, 0.75);
        c1.lerp(COAST, 0.5);
      } else if (r === RINGS - 2) {
        c2.lerp(COAST, 0.18);
        c1.lerp(COAST, 0.12);
      }
      // and the patches, before the coast takes over
      c2.lerp(MOSS_DARK, Math.min(0.55, moss));
      c1.lerp(BARE, Math.min(0.5, bare));
      // Form. A slope facing the light is a stop brighter than a hollow, and a
      // crown of turf catches the sky; without this the top of an island is one
      // value whatever shape it is, which is why it read as a painted plate.
      const rise = top((ca + cb) * 0.5, (ta + tb) * 0.5) - top(0.02, 0);
      const crown = Math.max(-1, Math.min(1, rise * 6.5));
      c2.lerp(CROWN, Math.max(0, crown) * 0.30);
      c2.lerp(HOLLOW, Math.max(0, -crown) * 0.42);
      c1.lerp(CROWN_DRY, Math.max(0, crown) * 0.22);
      c1.lerp(HOLLOW, Math.max(0, -crown) * 0.3);
      // the coastline is not an ellipse: break the rim outward and back in,
      // by about a hand's width, in long wavelengths
      const wobble = coast ? 1 + (Math.sin(ta * 3.0 + island.shapeSeed) * 0.045 + Math.sin(ta * 7.0 + 1.7) * 0.025) : 1;
      quad(top, ca * wobble, cb * wobble, ta, tb, c1.clone(), c2.clone(), false);
    }
    // ── cliff: turf lip, soil, then the rock it all stands on ──
    //
    // One band reads as the side of a coin. Three bands — turf overhanging a
    // pale soil lip, the lip overhanging the first course of stone, stone
    // stepping back into the dark — read as a piece of ground that was lifted
    // out of the world with everything still attached.
    {
      const bands = [
        { k: 1.052, dy: 0.0, drop: 0.028, col: COAST, mix: 0.35 },
        { k: 1.018, dy: 0.026, drop: 0.055, col: STRATA[1], mix: 0.55 },
        { k: 0.986, dy: 0.05, drop: 0.06, col: STRATA[3], mix: 0.7 },
      ];
      for (let band = 0; band < bands.length; band++) {
        const bb = bands[band];
        const wob = 1 + (Math.sin(ta * 2.0 + island.shapeSeed + band) * 0.03 + Math.sin(ta * 5.0 + band * 2.1) * 0.02);
        const ax = px(1, ta) * wob, az = pz(1, ta) * wob;
        const bx = px(1, tb) * wob, bz = pz(1, tb) * wob;
        const yTop = top(1, ta) - bb.dy;
        const yBotA = bot(1, ta) - 0.02 - bb.drop;
        c1.copy(EARTH).lerp(bb.col, bb.mix);
        if (hash01(island.shapeSeed + s * 53 + band * 7) > 0.7) c1.lerp(CRUST, 0.22);
        shade(c1, c1, (rnd(s, 40 + band, 2) - 0.5) * 0.22);
        const col = c1.clone();
        b.tri(ax, yTop, az, bx, top(1, tb) - bb.dy, bz, bx * bb.k, yBotA, bz * bb.k, col);
        b.tri(ax, yTop, az, bx * bb.k, yBotA, bz * bb.k, ax * bb.k, yBotA, az * bb.k, col);
      }
    }
    // ── underside: craggy rock tapering to a point ──
    const UNDER = 6;
    // vertex of the underside grid; the crag offset is keyed by the vertex so neighbours share it (no cracks)
    const U = (r: number, seg: number, out: number[]) => {
      const th = ((seg % SEGS) / SEGS) * Math.PI * 2;
      const c = 1 - r / UNDER;
      const depth = r / UNDER;
      const jag = r === 0 || r === UNDER ? 0 : (rnd(seg % SEGS, r, 5) - 0.5) * 0.34 * island.depth * (1 - depth * 0.6);
      const wob = r === 0 || r === UNDER ? 1 : 1 + (rnd(seg % SEGS, r, 9) - 0.5) * 0.3;
      // the first ring hangs under the lip, then the rock pulls in beneath it
      const rk = r === 0 ? 1.045 : 0.94 - 0.035 * (r / UNDER);
      out[0] = px(c, th) * rk * wob;
      out[1] = bot(c, th) - (r === 0 ? 0.02 : 0) - Math.abs(jag) * 0.6 + jag * 0.4;
      out[2] = pz(c, th) * rk * wob;
    };
    const A: number[] = [], B: number[] = [], C: number[] = [], D: number[] = [];
    for (let r = 0; r < UNDER; r++) {
      const depth = (r + 0.5) / UNDER;
      U(r, s, A);
      U(r, s + 1, B);
      U(r + 1, s, C);
      U(r + 1, s + 1, D);
      // each ring lands on a bed boundary, and the boundary is not flat: the
      // beds dip and rise around the island, which is what makes them read as
      // strata rather than as banding in a shader
      const bedF = (depth + (rnd(s, 0, 12) - 0.5) * 0.34) * STRATA.length;
      const bi = Math.max(0, Math.min(STRATA.length - 1, Math.floor(bedF)));
      const frac = Math.max(0, Math.min(1, bedF - bi));
      c1.copy(STRATA[bi]);
      if (bi < STRATA.length - 1 && frac > 0.72) c1.lerp(STRATA[bi + 1], (frac - 0.72) / 0.28);
      c1.lerp(ROCK_DEEP, Math.pow(depth, 2.4) * 0.7);
      shade(c1, c1, (rnd(s, r, 3) - 0.5) * 0.26);
      b.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], c1.clone());
      if (r < UNDER - 1) {
        shade(c1, c1, (rnd(s, r, 4) - 0.5) * 0.2);
        b.tri(B[0], B[1], B[2], D[0], D[1], D[2], C[0], C[1], C[2], c1.clone());
      }
    }
  }

  // Stones breaking through the turf on the weather side. Half-buried, because
  // a stone lying on the ground is a prop and a stone coming out of the ground
  // is geology.
  const stones: Mesh[] = [];
  const stoneCount = 5 + Math.floor(hash01(island.shapeSeed + 61) * 4);
  for (let i = 0; i < stoneCount; i++) {
    const th = (i / stoneCount) * Math.PI * 2 + hash01(island.shapeSeed + i * 7) * 0.9;
    const c = 0.58 + hash01(island.shapeSeed + i * 11) * 0.34;
    const sx = px(c, th);
    const sz = pz(c, th);
    const sy = top(c, th);
    const r = 0.022 + hash01(island.shapeSeed + i * 13) * 0.03;
    const geo = new IcosahedronGeometry(r, 0);
    const pos = geo.getAttribute('position') as Float32BufferAttribute;
    // squash and jitter the icosahedron so it is not an icosahedron
    for (let k = 0; k < pos.count; k++) {
      const f = 0.72 + hash01(island.shapeSeed + i * 17 + k) * 0.6;
      pos.setXYZ(k, pos.getX(k) * f * 1.25, pos.getY(k) * f * 0.72, pos.getZ(k) * f * 1.15);
    }
    geo.computeVertexNormals();
    const shade2 = 0.82 + hash01(island.shapeSeed + i * 19) * 0.45;
    const mat = new MeshLambertMaterial({
      color: new Color(STONE.r * shade2, STONE.g * shade2, STONE.b * shade2),
      flatShading: true,
    });
    const m = new Mesh(geo, mat);
    m.position.set(sx, sy - r * 0.35, sz);
    m.rotation.set(hash01(island.shapeSeed + i * 23) * 3.0, hash01(island.shapeSeed + i * 29) * 3.0, 0);
    stones.push(m);
  }

  const bloom = new Vector4(0, 0, 0, lush ? 99 : -1);
  const material = islandMaterial(bloom);
  const mesh = new Mesh(b.build(true), material);
  const group = new Group();
  group.position.set(island.center.x, island.center.y, island.center.z);
  group.add(mesh);
  for (const st of stones) group.add(st);
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
const LICHEN = new Color(0x968a72);

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
  // Every box gets chiselled. A middle-height obstacle used to keep its six
  // flat faces and read as a green cube sitting in a specimen case; the only
  // face that stays true to the collision box is the one the seed flies past.
  const role = !box ? 0 : o.center.y - hy > 1.2 ? 1 : -1;
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
      // t: 0 on the face the seed flies past, 1 at the far tip.
      //
      // Clamped, because a vertex a float's width above the box took v past 1,
      // made t negative, and `pow(t, 1.6)` of a negative number is NaN — which
      // quietly deleted a third of the storm gate's back wall.
      const t = Math.max(0, Math.min(1, role < 0 ? (1 - v) * 0.5 : (1 + v) * 0.5));
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
    // stone is laid in courses: a warm bed, a pale bed, a dark seam. The
    // colour follows y rather than the face, so the bands run round the rock
    // the way sediment does.
    const course = (y / Math.max(0.001, hy)) * 3.4 + key * 0.7;
    const bed = Math.floor(course);
    if (bed % 3 === 0) c1.copy(STONE).lerp(LICHEN, 0.18);
    else if (bed % 3 === 1) c1.copy(STONE).lerp(ROCK_DEEP, 0.28);
    else c1.copy(STONE).lerp(MOSS_DARK, 0.22);
    c1.lerp(ROCK_DEEP, 0.34 - 0.34 * Math.min(1, Math.max(-1, y / hy)));
    // wet, shaded rock under an overhang: the underside stays cold and dark
    if (up < -0.35) c1.lerp(new Color(0.10, 0.12, 0.11), 0.45);
    // anything that faces the sky gathers moss — but only out in the weather.
    // The floor of the storm gate was turning mint green because it, too, faces
    // up; a walked stone floor wears smooth instead.
    if (up > 0.6) {
      if (y > 1.4) c1.lerp(MOSS, 0.35 + 0.35 * h);
      else c1.lerp(STONE, 0.25).lerp(LICHEN, 0.12 + 0.1 * h);
    }
    // a hairline of dark in the seams between courses
    if (Math.abs(course - Math.round(course)) < 0.06) c1.lerp(ROCK_DEEP, 0.4);
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
