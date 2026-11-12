/**
 * THE MIX — wind in, sound out.
 *
 * These are the mappings between the simulation and the synthesiser, kept pure
 * and separate from Web Audio so they can be tested without a browser. The
 * point of the whole audio pass is here: the score should be driven by the same
 * field the grass and the rain read, not by a parallel set of numbers.
 *
 * Everything is 0..1 or a frequency in Hz; the caller owns the nodes.
 */

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** How open the world's air bed is, from its own speed and the storm. */
export function airCutoff(ambient: number, storm: number): number {
  const a = clamp01(ambient / 3.2);
  return 220 + 460 * a + 240 * clamp01(storm);
}

/** The hand-wind layer: brightness rises with the sweep, not linearly. */
export function handCutoff(energy: number): number {
  const e = clamp01(energy / 9);
  return 260 + 1500 * Math.pow(e, 0.8);
}

/**
 * The chord's brightness.
 *
 * Calm air keeps the pad closed and warm; a blow opens it so the harmony
 * carries the same energy the player is pushing through the world. Turbulence
 * counts for less than speed — it is texture, not force.
 */
export function padOpenness(wind: number, turbulence: number): number {
  return clamp01((wind + 0.55 * turbulence) / 3.4);
}

export function padCutoff(wind: number, turbulence: number, storm: number): number {
  const open = padOpenness(wind, turbulence);
  return 420 + 1700 * open + 300 * clamp01(storm);
}

/** Gusts swell the harmony briefly, then it settles again. */
export function gustSwell(strength: number): number {
  return clamp01(strength / 10) * 0.55;
}

/**
 * Where the air bed sits in the stereo field.
 *
 * The prevailing wind has a direction; a listener inside it hears it lean that
 * way. Below a walking-pace breeze the direction is meaningless noise, so it
 * centres.
 */
export function windPan(windX: number, speed: number): number {
  if (speed < 0.25) return 0;
  return clamp((windX / speed) * 0.55, -0.55, 0.55);
}

/** Stereo spread of the pads: they lean slightly against the wind. */
export function padPan(windX: number, speed: number): number {
  const p = windPan(windX, speed);
  return p === 0 ? 0 : -p * 0.45; // avoid -0 when the air is calm
}

/**
 * How much the world bed should duck while the player is making wind, so the
 * player's own gesture is always the loudest thing in the mix.
 */
export function worldDuck(handEnergy: number): number {
  return 1 - 0.45 * clamp01(handEnergy / 8);
}
