/**
 * THE PERSISTENT GARDEN
 *
 * Every completed run grows the world. The garden is plain data — where each
 * seed of each finale came down on the home island — so it can be stored in
 * localStorage, validated on load, and replayed as living plants that sway in
 * the very same wind field: your history is physically playable.
 *
 * This module is pure. The storage adapter lives in the shell.
 */
import { hash01 } from './random.js';

export const GARDEN_VERSION = 1;
export const GARDEN_STORAGE_KEY = 'gust.garden.v1';
export const MAX_PLANTS = 96;
const MAX_TREES = 14;

export type PlantKind = 'flower' | 'bush' | 'tree';
const KINDS: readonly PlantKind[] = ['flower', 'bush', 'tree'];

export interface GardenPlant {
  /** Position relative to the home island's centre (m). */
  x: number;
  z: number;
  kind: PlantKind;
  /** 0..1 — picks the blossom colour. */
  hue: number;
  /** Index of the run that planted it (0 = first). Older plants are bigger. */
  run: number;
}

export interface Garden {
  version: number;
  /** Completed runs. */
  runs: number;
  plants: GardenPlant[];
  /** Seeds brought home across all runs. */
  seedsPlanted: number;
  /** Most seeds brought home in a single finale. */
  bestFlock: number;
}

export const emptyGarden = (): Garden => ({ version: GARDEN_VERSION, runs: 0, plants: [], seedsPlanted: 0, bestFlock: 0 });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parse stored garden data. Never throws; anything suspicious yields a clean, empty garden. */
export function parseGarden(json: string | null | undefined): Garden {
  if (!json) return emptyGarden();
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object' || raw.version !== GARDEN_VERSION) return emptyGarden();
    const garden = emptyGarden();
    garden.runs = finite(raw.runs) ? Math.max(0, Math.min(99999, Math.floor(raw.runs))) : 0;
    garden.seedsPlanted = finite(raw.seedsPlanted) ? Math.max(0, Math.floor(raw.seedsPlanted)) : 0;
    garden.bestFlock = finite(raw.bestFlock) ? Math.max(0, Math.floor(raw.bestFlock)) : 0;
    if (Array.isArray(raw.plants)) {
      for (const p of raw.plants.slice(0, MAX_PLANTS)) {
        if (p === null || typeof p !== 'object') continue;
        const q = p as Record<string, unknown>;
        if (!finite(q.x) || !finite(q.z) || Math.abs(q.x) > 4 || Math.abs(q.z) > 4) continue;
        const kind = KINDS.includes(q.kind as PlantKind) ? (q.kind as PlantKind) : 'flower';
        garden.plants.push({
          x: q.x,
          z: q.z,
          kind,
          hue: finite(q.hue) ? Math.max(0, Math.min(1, q.hue)) : 0.5,
          run: finite(q.run) ? Math.max(0, Math.min(garden.runs, Math.floor(q.run))) : 0,
        });
      }
    }
    return garden;
  } catch {
    return emptyGarden();
  }
}

export function serializeGarden(garden: Garden): string {
  return JSON.stringify({
    ...garden,
    plants: garden.plants.map((p) => ({
      x: Math.round(p.x * 1000) / 1000,
      z: Math.round(p.z * 1000) / 1000,
      kind: p.kind,
      hue: Math.round(p.hue * 100) / 100,
      run: p.run,
    })),
  });
}

/**
 * Fold one completed run into the garden (returns a new garden).
 * `landings` are where the finale's seeds took root, relative to the home
 * island's centre. The first becomes a tree, every fifth a bush, the rest flowers.
 */
export function recordRun(garden: Garden, landings: readonly { x: number; z: number }[]): Garden {
  const run = garden.runs;
  const plants = garden.plants.slice();
  let trees = plants.filter((p) => p.kind === 'tree').length;
  landings.forEach((spot, i) => {
    let kind: PlantKind = i === 0 ? 'tree' : i % 5 === 4 ? 'bush' : 'flower';
    if (kind === 'tree') {
      // trees need room, and a garden only holds so many
      const crowded = plants.some((p) => p.kind === 'tree' && Math.hypot(p.x - spot.x, p.z - spot.z) < 0.55);
      if (crowded || trees >= MAX_TREES) kind = 'bush';
      else trees++;
    }
    plants.push({ x: spot.x, z: spot.z, kind, hue: hash01(run * 977 + i * 131 + 5), run });
  });
  // when the garden is full, the oldest flowers make way; trees are forever
  while (plants.length > MAX_PLANTS) {
    let drop = plants.findIndex((p) => p.kind === 'flower');
    if (drop < 0) drop = plants.findIndex((p) => p.kind === 'bush');
    if (drop < 0) drop = 0;
    plants.splice(drop, 1);
  }
  return {
    version: GARDEN_VERSION,
    runs: run + 1,
    plants,
    seedsPlanted: garden.seedsPlanted + landings.length,
    bestFlock: Math.max(garden.bestFlock, landings.length),
  };
}

/** Size multiplier of a plant given how many runs ago it was planted. Grows, then settles. */
export function plantGrowth(garden: Garden, plant: GardenPlant): number {
  const age = Math.max(0, garden.runs - plant.run); // 1 right after its own run
  const mature = plant.kind === 'tree' ? 5 : plant.kind === 'bush' ? 3 : 2;
  const t = Math.min(1, age / mature);
  return 0.45 + 0.55 * (1 - (1 - t) * (1 - t));
}
