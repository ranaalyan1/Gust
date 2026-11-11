/** Deterministic PRNG + hashing. Same seed -> same world, in Node and in the headset. */

export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for layout and feel. Returns [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash -> [0, 1). Stateless; handy for per-instance variation. */
export function hash01(n: number): number {
  let h = (n | 0) * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const rangeRng = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
