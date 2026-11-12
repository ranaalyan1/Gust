/**
 * TERRAIN — the solid parts of the floating world, as pure analytic shapes.
 *
 * Islands are height functions over a wobbly elliptical footprint; rocks are
 * rounded boxes and spheres. The renderer builds its meshes from these very
 * functions, so what the player sees is exactly what the seed collides with.
 */
import { type Vec3, vec3 } from './vec3.js';
import { hash01 } from './random.js';

export interface Island {
  id: number;
  /** Footprint centre; `y` is the nominal height of the top surface. */
  center: Vec3;
  /** Footprint radii along x and z (m). */
  rx: number;
  rz: number;
  /** Depth of the rocky underside below the top at the centre (m). */
  depth: number;
  /** Hill amplitude on the top surface (m). */
  hills: number;
  /** Drives the footprint wobble and the hills; same seed -> same island. */
  shapeSeed: number;
  /** Fertile islands take root: a seed that touches their top is planted. */
  fertile: boolean;
}

export interface SphereObstacle {
  kind: 'sphere';
  center: Vec3;
  radius: number;
}

export interface BoxObstacle {
  kind: 'box';
  center: Vec3;
  /** Half extents (m). */
  half: Vec3;
  /** Corner rounding radius (m). */
  round: number;
}

export type Obstacle = SphereObstacle | BoxObstacle;

export interface Terrain {
  islands: Island[];
  obstacles: Obstacle[];
  /** Below this height a seed is lost to the cloud sea. */
  killY: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function createIsland(init: Partial<Island> & { id: number }): Island {
  return {
    id: init.id,
    center: init.center ?? vec3(),
    rx: init.rx ?? 1.6,
    rz: init.rz ?? 1.3,
    depth: init.depth ?? 1.6,
    hills: init.hills ?? 0.12,
    shapeSeed: init.shapeSeed ?? init.id * 7919 + 13,
    fertile: init.fertile ?? false,
  };
}

/** Radius multiplier of the footprint at angle `theta` — a soft, lumpy coastline. */
export function islandRim(island: Island, theta: number): number {
  const s = island.shapeSeed;
  const p3 = hash01(s + 1) * 6.283;
  const p5 = hash01(s + 2) * 6.283;
  const p2 = hash01(s + 3) * 6.283;
  return 1 + 0.1 * Math.sin(3 * theta + p3) + 0.055 * Math.sin(5 * theta + p5) + 0.07 * Math.sin(2 * theta + p2);
}

/**
 * Normalised radial coordinate of (x, z) within the island footprint:
 * 0 at the centre, 1 on the coastline, > 1 outside.
 */
export function islandCoord(island: Island, x: number, z: number): number {
  const dx = (x - island.center.x) / island.rx;
  const dz = (z - island.center.z) / island.rz;
  const rho = Math.sqrt(dx * dx + dz * dz);
  if (rho < 1e-6) return 0;
  return rho / islandRim(island, Math.atan2(dz, dx));
}

/** Height of the top surface at (x, z). Meaningful where `islandCoord < 1`. */
export function islandTop(island: Island, x: number, z: number, coord = islandCoord(island, x, z)): number {
  const s = island.shapeSeed;
  const lx = x - island.center.x;
  const lz = z - island.center.z;
  const a = hash01(s + 11) * 6.283;
  const b = hash01(s + 12) * 6.283;
  const c = hash01(s + 13) * 6.283;
  const bumps =
    0.55 * Math.sin(1.9 * lx + a) * Math.cos(1.5 * lz + b) + 0.45 * Math.sin(1.1 * (lx - lz) + c);
  const c2 = coord * coord;
  // hills flatten toward the coast, which then rolls off like a worn cliff edge
  return island.center.y + island.hills * bumps * (1 - c2) - 0.16 * c2 * c2;
}

/** Height of the rocky underside at (x, z). */
export function islandBottom(island: Island, x: number, z: number, coord = islandCoord(island, x, z)): number {
  const c = coord > 1 ? 1 : coord;
  return islandTop(island, x, z, coord) - (0.14 + island.depth * Math.pow(1 - c * c, 0.85));
}

/** Signed distance to an obstacle (negative inside). */
export function obstacleDistance(o: Obstacle, p: Vec3): number {
  if (o.kind === 'sphere') {
    const dx = p.x - o.center.x;
    const dy = p.y - o.center.y;
    const dz = p.z - o.center.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - o.radius;
  }
  const r = o.round;
  const qx = Math.abs(p.x - o.center.x) - (o.half.x - r);
  const qy = Math.abs(p.y - o.center.y) - (o.half.y - r);
  const qz = Math.abs(p.z - o.center.z) - (o.half.z - r);
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return outside + inside - r;
}

const EPS = 1e-3;
const probe = vec3();

/** Outward unit normal of an obstacle at `p` (central differences of the distance field). */
export function obstacleNormal(o: Obstacle, p: Vec3, out: Vec3): Vec3 {
  if (o.kind === 'sphere') {
    out.x = p.x - o.center.x;
    out.y = p.y - o.center.y;
    out.z = p.z - o.center.z;
  } else {
    probe.y = p.y;
    probe.z = p.z;
    probe.x = p.x + EPS;
    const xp = obstacleDistance(o, probe);
    probe.x = p.x - EPS;
    const xm = obstacleDistance(o, probe);
    probe.x = p.x;
    probe.y = p.y + EPS;
    const yp = obstacleDistance(o, probe);
    probe.y = p.y - EPS;
    const ym = obstacleDistance(o, probe);
    probe.y = p.y;
    probe.z = p.z + EPS;
    const zp = obstacleDistance(o, probe);
    probe.z = p.z - EPS;
    const zm = obstacleDistance(o, probe);
    out.x = xp - xm;
    out.y = yp - ym;
    out.z = zp - zm;
  }
  const l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  if (l < 1e-9) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
  } else {
    out.x /= l;
    out.y /= l;
    out.z /= l;
  }
  return out;
}

export interface Contact {
  hit: boolean;
  /** Outward surface normal at the contact. */
  normal: Vec3;
  /** Island touched from above, if any. */
  island: Island | null;
  /** True when the contact is the top of a fertile island. */
  fertile: boolean;
}

export const createContact = (): Contact => ({ hit: false, normal: vec3(0, 1, 0), island: null, fertile: false });

const normalScratch = vec3();

/**
 * Resolve a small sphere at `pos` against the terrain: push it out of anything
 * solid and report the contact. Velocity response is the caller's business.
 */
export function resolveTerrain(terrain: Terrain, pos: Vec3, radius: number, contact: Contact): Contact {
  contact.hit = false;
  contact.island = null;
  contact.fertile = false;

  const islands = terrain.islands;
  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i];
    if (Math.abs(pos.x - isl.center.x) > isl.rx * 1.3 || Math.abs(pos.z - isl.center.z) > isl.rz * 1.3) continue;
    const coord = islandCoord(isl, pos.x, pos.z);
    if (coord >= 1) continue;
    const top = islandTop(isl, pos.x, pos.z, coord);
    if (pos.y >= top + radius) continue;
    const bottom = islandBottom(isl, pos.x, pos.z, coord);
    if (pos.y <= bottom - radius) continue;
    contact.hit = true;
    if (pos.y > (top + bottom) * 0.5) {
      pos.y = top + radius;
      contact.normal.x = 0;
      contact.normal.y = 1;
      contact.normal.z = 0;
      contact.island = isl;
      contact.fertile = isl.fertile;
    } else {
      pos.y = bottom - radius;
      contact.normal.x = 0;
      contact.normal.y = -1;
      contact.normal.z = 0;
    }
  }

  const obstacles = terrain.obstacles;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const d = obstacleDistance(o, pos);
    if (d >= radius) continue;
    obstacleNormal(o, pos, normalScratch);
    const push = radius - d;
    pos.x += normalScratch.x * push;
    pos.y += normalScratch.y * push;
    pos.z += normalScratch.z * push;
    contact.hit = true;
    contact.normal.x = normalScratch.x;
    contact.normal.y = normalScratch.y;
    contact.normal.z = normalScratch.z;
    contact.island = null;
    contact.fertile = false;
  }
  return contact;
}

/** True once a point has left the playable volume for good. */
export function isOutOfWorld(terrain: Terrain, p: Vec3): boolean {
  return p.y < terrain.killY || p.x < terrain.minX || p.x > terrain.maxX || p.z < terrain.minZ || p.z > terrain.maxZ;
}

/**
 * Height of the highest solid surface under (x, z) at or below `fromY`, or
 * `-Infinity` over open sky. Used for blob shadows and for placing plants.
 */
export function groundBelow(terrain: Terrain, x: number, z: number, fromY = Infinity): number {
  let best = -Infinity;
  for (let i = 0; i < terrain.islands.length; i++) {
    const isl = terrain.islands[i];
    const coord = islandCoord(isl, x, z);
    if (coord >= 1) continue;
    const top = islandTop(isl, x, z, coord);
    if (top <= fromY + 1e-3 && top > best) best = top;
  }
  for (let i = 0; i < terrain.obstacles.length; i++) {
    const o = terrain.obstacles[i];
    if (o.kind === 'box') {
      if (Math.abs(x - o.center.x) > o.half.x || Math.abs(z - o.center.z) > o.half.z) continue;
      const top = o.center.y + o.half.y;
      if (top <= fromY + 1e-3 && top > best) best = top;
    } else {
      const dx = x - o.center.x;
      const dz = z - o.center.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > o.radius * o.radius) continue;
      const top = o.center.y + Math.sqrt(o.radius * o.radius - d2);
      if (top <= fromY + 1e-3 && top > best) best = top;
    }
  }
  return best;
}
