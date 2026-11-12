/**
 * The mix is a set of pure mappings between the wind field and the
 * synthesiser, so the parts of the audio that can be checked without a
 * speaker are checked here: monotonicity, clamping and direction.
 */
import { describe, expect, it } from 'vitest';
import {
  airCutoff,
  clamp,
  clamp01,
  gustSwell,
  handCutoff,
  padCutoff,
  padPan,
  windPan,
  worldDuck,
} from '../src/audio/mix.js';

describe('mix', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });

  it('opens the air bed with wind and storm, inside a sane band', () => {
    expect(airCutoff(0, 0)).toBe(220);
    expect(airCutoff(1, 0)).toBeGreaterThan(airCutoff(0, 0));
    expect(airCutoff(3.2, 0)).toBeGreaterThan(airCutoff(1, 0));
    // floors and ceilings hold even for silly input
    expect(airCutoff(-10, -10)).toBe(220);
    expect(airCutoff(1e6, 1e6)).toBe(920);
  });

  it('brightens the hand wind with the sweep', () => {
    expect(handCutoff(0)).toBe(260);
    expect(handCutoff(4)).toBeGreaterThan(handCutoff(1));
    expect(handCutoff(1000)).toBe(1760);
  });

  it('opens the chord with wind and turbulence, but turbulence counts less', () => {
    const windOnly = padCutoff(2, 0, 0);
    const sameEnergyAsTurbulence = padCutoff(0, 2 / 0.55, 0);
    expect(windOnly).toBeGreaterThan(padCutoff(0, 0, 0));
    expect(windOnly).toBeGreaterThanOrEqual(sameEnergyAsTurbulence);
    expect(padCutoff(1e6, 1e6, 1)).toBe(420 + 1700 + 300);
  });

  it('swells on a gust, and only a little', () => {
    expect(gustSwell(0)).toBe(0);
    expect(gustSwell(5)).toBeGreaterThan(0);
    expect(gustSwell(1000)).toBeCloseTo(0.55, 6);
  });

  it('pans the air with the wind direction and centres in calm air', () => {
    expect(windPan(0, 0)).toBe(0);
    expect(windPan(2, 0.1)).toBe(0); // too slow to have a direction
    expect(windPan(1, 1)).toBeGreaterThan(0);
    expect(windPan(-1, 1)).toBeLessThan(0);
    expect(Math.abs(windPan(10, 1))).toBeLessThanOrEqual(0.55);
  });

  it('leans the chord against the wind, so the mix does not all move together', () => {
    expect(Math.sign(padPan(1, 1))).toBe(-Math.sign(windPan(1, 1)));
    expect(padPan(1, 0.05)).toBe(0);
  });

  it('ducks the world bed under the player’s own wind', () => {
    expect(worldDuck(0)).toBe(1);
    expect(worldDuck(4)).toBeLessThan(1);
    expect(worldDuck(1000)).toBeGreaterThan(0);
  });
});
